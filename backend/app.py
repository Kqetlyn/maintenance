"""
Standalone Maintenance Dashboard — Flask backend.
Serves only the Maintenance page and its required API endpoints.
"""

from datetime import datetime, timedelta
from functools import wraps
from urllib.parse import urlparse
from flask import Flask, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from markupsafe import escape
import os
import secrets

# ── SQLite database layer (Phase 1) ──────────────────────────────────────────
# db.init_db() is called at startup to create data/dashboard.db and all tables
# if they don't already exist. No existing Excel logic is removed.
import db as _db
import auth as _auth

# ── Service imports ─────────────────────────────────────────────────────────────
# The legacy maintenance overview / utility / equipment builders are no longer
# imported here — those endpoints were removed. PM Schedule, Spare Parts and
# Downtime have their own services below.
from pm_schedule_service import build_pm_schedule_payload
from pm_schedule_overrides import save_override as save_pm_override
from pm_planner_store import (
    get_asset_catalog,
    create_tasks as create_planner_tasks,
    update_task as update_planner_task,
    delete_task as delete_planner_task,
)
from pm_schedule_sources import (
    get_pm_schedule_last_synced,
)
from spare_parts_service import (
    build_spare_parts_payload,
    build_project_transactions_payload,
    build_all_years_transactions_payload,
    build_external_po_payload,
    build_asset_parts_intelligence_context,
    import_spare_inventory_file,
    import_external_po_file,
    import_project_transactions_file,
    get_maintenance_import_status,
)
# downtime_service is needed by the Maintenance "Analysis" and "Downtime" tabs
# (/api/downtime?period=all_years&work_orders_only=1) and by spare_parts_service
from downtime_service import (
    build_downtime_payload,
    build_inactive_critical_machines_payload,
    build_mtbf_work_order_history_payload,
    clear_work_order_runtime_caches,
    get_work_order_import_status,
    import_work_order_file,
    get_last_import_stats,
)
try:
    from mira.api import mira_bp
except Exception as mira_import_error:
    mira_bp = None
else:
    mira_import_error = None

# ── Path configuration ────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
# DATA_DIR can be overridden via environment variable for deployed environments
DATA_DIR = os.environ.get("DATA_DIR") or os.path.abspath(os.path.join(BASE_DIR, "..", "data"))
os.makedirs(DATA_DIR, exist_ok=True)
ASSET_MASTER_RELATIVE_PATH = os.path.join("master", "Asset_Master.xlsx")

def _persisted_secret_key() -> str:
    """Session-signing key that survives restarts without any deployment config.

    An env var always wins if set. Otherwise, reuse a key saved on disk from a
    prior boot; if none exists yet, generate one and save it (atomically, so
    concurrent workers starting at the same time can't each write a different
    key and end up disagreeing on it). This is what makes sessions consistent
    across worker processes and across redeploys with zero required setup.
    """
    env_key = os.environ.get("DASHBOARD_SECRET_KEY") or os.environ.get("SECRET_KEY")
    if env_key:
        return env_key
    key_path = os.path.join(DATA_DIR, ".dashboard_secret_key")
    try:
        with open(key_path, "r", encoding="utf-8") as fh:
            existing = fh.read().strip()
        if existing:
            return existing
    except FileNotFoundError:
        pass
    new_key = secrets.token_hex(32)
    tmp_path = f"{key_path}.{os.getpid()}.tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as fh:
            fh.write(new_key)
        os.replace(tmp_path, key_path)  # atomic on POSIX and Windows
    except OSError:
        pass
    # Re-read rather than trust `new_key`: if another process/worker won the
    # race and replaced the file first, everyone must converge on ITS value.
    try:
        with open(key_path, "r", encoding="utf-8") as fh:
            return fh.read().strip() or new_key
    except OSError:
        return new_key


# ── App setup ─────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=FRONTEND_DIR)
app.config.update(
    SECRET_KEY=_persisted_secret_key(),
    PERMANENT_SESSION_LIFETIME=timedelta(minutes=int(os.environ.get("DASHBOARD_SESSION_TIMEOUT_MINUTES", "60"))),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)
if os.environ.get("DASHBOARD_COOKIE_SECURE", "").lower() in {"1", "true", "yes"}:
    app.config["SESSION_COOKIE_SECURE"] = True
try:
    _auth.ensure_users_table()
    _seeded_users = _auth.seed_initial_users_from_env()
    if not (os.environ.get("DASHBOARD_MANAGEMENT_PASSWORD") or os.environ.get("DASHBOARD_STAFF_PASSWORD")):
        _seeded_users.extend(_auth.ensure_default_users("0000"))
    if _seeded_users:
        print(f"[auth] Created initial user(s): {', '.join(_seeded_users)}")
except Exception as _auth_exc:
    print(f"[auth] WARNING: could not initialise users table - {_auth_exc}")
APP_VERSION = "2026-06-08-stabilise-1"
_BACKEND_START = datetime.now()

import json as _json
import time as _time
import threading as _threading
import gzip as _gzip
import hashlib as _hashlib

# Disk-backed gzip response cache for the heavy pages (downtime ~32 MB,
# pm-schedule ~13 MB, spare-parts). Building these takes 10-100s and serving them
# uncompressed is slow. We build once, store the GZIPPED bytes on disk, and serve
# them directly — so loads are instant, and the cache survives restarts and any
# in-memory churn (which previously defeated the cache). A background thread
# refreshes the default payloads so a cold build never lands on a user request.
_CACHE_DIR = os.path.join(DATA_DIR, "_dashboard_cache")
try:
    os.makedirs(_CACHE_DIR, exist_ok=True)
except Exception:
    pass
_CACHE_TTL = 600.0
_CACHE_STALE_TTL = float(os.environ.get("MIRA_CACHE_STALE_TTL_SECONDS", "86400"))
_PM_SCHEDULE_CACHE_SCHEMA = "pm-schedule-v2-no-duplicate-all"
_BUILD_LOCKS = {}
_BUILD_LOCKS_GUARD = _threading.Lock()
_REFRESHING_KEYS = set()
_REFRESHING_KEYS_GUARD = _threading.Lock()
_REFRESH_TARGETS = []          # [(key, builder)] rebuilt periodically in the background


_PUBLIC_PATHS = {"/login", "/access-denied"}
_PUBLIC_STATIC_PREFIXES = ("/shared/assets/",)
_PUBLIC_STATIC_EXTENSIONS = (".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".woff", ".woff2", ".ttf", ".map")


def _is_api_request():
    return request.path.startswith("/api/")


def _json_error(message, status=403):
    return jsonify({"ok": False, "error": message, "message": message}), status


def current_user():
    user_id = session.get("user_id")
    user = _auth.get_user_by_id(user_id) if user_id else None
    if not user or not int(user.get("is_active") or 0):
        session.clear()
        return None
    user.pop("password_hash", None)
    user["permissions"] = sorted(_auth.get_user_permissions(user))
    return user


def current_role():
    user = current_user()
    return user.get("role") if user else None


def login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not current_user():
            if _is_api_request():
                return _json_error("Login required.", 401)
            return redirect(url_for("login", next=request.full_path.rstrip("?")))
        return view_func(*args, **kwargs)
    return wrapper


def roles_required(roles):
    allowed = {str(role).strip().lower() for role in roles}

    def decorator(view_func):
        @wraps(view_func)
        def wrapper(*args, **kwargs):
            user = current_user()
            if not user:
                if _is_api_request():
                    return _json_error("Login required.", 401)
                return redirect(url_for("login", next=request.full_path.rstrip("?")))
            if user.get("role") not in allowed:
                if _is_api_request():
                    return _json_error("Access denied.", 403)
                return redirect(url_for("access_denied", next=request.full_path.rstrip("?")))
            return view_func(*args, **kwargs)
        return wrapper
    return decorator


def role_required(role):
    return roles_required([role])


def permission_required(permission):
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(*args, **kwargs):
            user = current_user()
            if not user:
                if _is_api_request():
                    return _json_error("Login required.", 401)
                return redirect(url_for("login", next=request.full_path.rstrip("?")))
            if permission not in set(user.get("permissions") or []):
                if _is_api_request():
                    return _json_error("Access denied.", 403)
                return redirect(url_for("access_denied", next=request.full_path.rstrip("?")))
            return view_func(*args, **kwargs)
        return wrapper
    return decorator


def _requested_dashboard_view(default="mira_overview"):
    return (request.args.get("view") or default or "").strip().lower()


def _is_safe_local_next(target):
    if not target:
        return False
    parsed = urlparse(target)
    return not parsed.scheme and not parsed.netloc and target.startswith("/")


def _permission_for_dashboard_view(view):
    view = (view or "").strip().lower()
    if view == "overview":
        return "mira_overview"
    if view == "pm_schedule":
        return "pm_schedule"
    if view == "equipment":
        return "utility"
    if view in {"mira_overview", "spare_parts", "downtime", "analysis", "utility"}:
        return view
    return "mira_overview"


def _permissions_for_path(path):
    clean_path = (path or "/").split("?", 1)[0]
    lower_path = clean_path.lower()

    if lower_path in {"/", "/maintenance", "/maintenance/", "/maintenance/index.html"}:
        if not str(request.args.get("view", "")).strip():
            return set(_auth.VALID_PERMISSIONS)
        return {_permission_for_dashboard_view(_requested_dashboard_view())}
    if lower_path in {"/downtime", "/downtime/", "/downtime/index.html"}:
        return {"downtime"}
    if lower_path in {"/management/users", "/management/users/"}:
        return {"manage_users"}
    if lower_path == "/shared/navbar.html":
        return set(_auth.VALID_PERMISSIONS)
    if lower_path.endswith(".html"):
        return {"mira_overview"}

    if lower_path == "/api/auth/session":
        return set(_auth.VALID_PERMISSIONS)
    if lower_path == "/api/asset-list":
        return {"pm_schedule", "downtime", "analysis", "mira_overview"}
    if lower_path.startswith("/api/downtime"):
        return {"downtime"}
    if lower_path in {"/api/maintenance/pm-schedule", "/api/maintenance/pm-assets"}:
        return {"pm_schedule"}
    if lower_path.startswith("/api/maintenance/pm-schedule/"):
        return {"pm_schedule"}
    if lower_path in {
        "/api/maintenance/summary",
        "/api/maintenance/records",
        "/api/maintenance/ttr-mttr",
        "/api/maintenance/data-quality",
    }:
        return {"analysis", "downtime", "mira_overview"}
    if lower_path == "/api/maintenance/critical-machines/inactive":
        return {"downtime"}
    if lower_path in {"/api/import/validate", "/api/import/last-result", "/api/import/quality-summary", "/api/import/repair-quality-flags"}:
        return {"downtime"}
    if lower_path in {"/api/page-sync/maintenance", "/api/page-sync/downtime"}:
        return {"pm_schedule", "downtime", "mira_overview"}
    if lower_path.startswith("/api/spare-parts"):
        return {"spare_parts"}
    if lower_path in {
        "/api/maintenance/spare_parts",
        "/api/maintenance/import-status",
        "/api/maintenance/project_transactions_all",
        "/api/maintenance/external_po",
        "/api/maintenance/asset-parts-intelligence",
    }:
        return {"spare_parts"}
    if lower_path == "/api/maintenance/project_transactions":
        return {"spare_parts", "downtime"}
    if lower_path.startswith("/api/maintenance/import/"):
        return {"spare_parts"}
    if lower_path.startswith("/api/mira"):
        return {"mira_overview"}
    if lower_path in {"/api/refresh-data", "/api/db/status", "/api/db/sync-asset-master"}:
        return {"manage_users"}
    if lower_path.startswith("/api/"):
        return {"mira_overview"}

    return set(_auth.VALID_PERMISSIONS)


def _user_has_any_permission(user, permissions):
    allowed = set(user.get("permissions") or [])
    return bool(allowed.intersection(set(permissions or [])))


def _is_public_request():
    path = request.path
    lower_path = path.lower()
    if lower_path in _PUBLIC_PATHS:
        return True
    if lower_path.startswith(_PUBLIC_STATIC_PREFIXES):
        return True
    if lower_path.endswith(_PUBLIC_STATIC_EXTENSIONS) and not lower_path.endswith(".html"):
        return True
    return False


def _default_page_for_role(role):
    return "/?view=pm_schedule" if role == "public" else "/?view=mira_overview"


def _default_page_for_user(user):
    permissions = set((user or {}).get("permissions") or [])
    for permission, target in (
        ("mira_overview", "/?view=mira_overview"),
        ("pm_schedule", "/?view=pm_schedule"),
        ("downtime", "/?view=downtime"),
        ("spare_parts", "/?view=spare_parts"),
        ("analysis", "/?view=analysis"),
        ("utility", "/?view=utility"),
        ("manage_users", "/management/users"),
    ):
        if permission in permissions:
            return target
    return url_for("access_denied")


def _can_access_next(target, user):
    if not _is_safe_local_next(target):
        return False
    with app.test_request_context(target):
        return _user_has_any_permission(user, _permissions_for_path(request.path))


def _deny_for_request(message="Access denied."):
    if _is_api_request():
        return _json_error(message, 403)
    return redirect(url_for("access_denied", next=request.full_path.rstrip("?")))


@app.before_request
def enforce_login_and_roles():
    try:
        _auth.ensure_users_table()
    except Exception as exc:
        if _is_api_request():
            return _json_error(f"Authentication database unavailable: {exc}", 500)
        raise

    if _is_public_request():
        return None

    user = current_user()
    if not user:
        if _is_api_request():
            return _json_error("Login required.", 401)
        return redirect(url_for("login", next=request.full_path.rstrip("?")))

    session.permanent = True
    required_permissions = _permissions_for_path(request.path)
    if not _user_has_any_permission(user, required_permissions):
        return _deny_for_request()
    return None


def _inject_auth_context(html):
    user = current_user() or {}
    role = user.get("role") or ""
    username = user.get("username") or ""
    permissions = sorted(user.get("permissions") or [])
    safe_role = str(escape(role))
    safe_username = str(escape(username))
    mira_config = "window.MIRA_CONFIG=Object.assign({},window.MIRA_CONFIG||{},{enabled:false});" if "mira_overview" not in permissions else ""
    auth_script = (
        "<script>"
        f"window.DASHBOARD_AUTH={{username:{_json.dumps(username)},role:{_json.dumps(role)},permissions:{_json.dumps(permissions)}}};"
        f"{mira_config}"
        "</script>"
        "<style>"
        "[data-permission]:not(.permission-visible){display:none!important;}"
        "</style>"
    )
    html = html.replace("</head>", f"{auth_script}\n</head>", 1)
    html = html.replace("<body ", f"<body data-user-role=\"{safe_role}\" data-username=\"{safe_username}\" ", 1)
    return html


def _serve_html_with_auth(directory, filename):
    path = os.path.join(directory, filename)
    with open(path, "r", encoding="utf-8") as fh:
        html = fh.read()
    return app.response_class(_inject_auth_context(html), mimetype="text/html")


def _navbar_html():
    user = current_user() or {}
    role = user.get("role") or ""
    username = user.get("username") or ""
    permissions = set(user.get("permissions") or [])
    safe_username = str(escape(username))
    safe_role = str(escape(role))
    dashboard_href = _default_page_for_user(user)
    nav_items = ""
    if permissions.intersection({"mira_overview", "pm_schedule", "downtime", "spare_parts", "analysis", "utility"}):
        nav_items += f"""
    <div class="nav-item"><button class="nav-btn" data-nav-view="dashboard" onclick="location.href='{dashboard_href}'">Dashboard</button></div>
"""
    if "manage_users" in permissions:
        nav_items += """
    <div class="nav-item"><button class="nav-btn" data-nav-view="users" onclick="location.href='/management/users'">Users</button></div>
"""
    return f"""<header class="top-header">
    <div class="brand">
        <img src="/shared/assets/SATS_Logo.png" class="brand-logo" alt="SATS Logo">
        <div class="pulse"></div>
        <h1 class="brand-title">Monitoring System <span class="brand-subtitle">| Stage 2</span></h1>
        <span class="brand-ai-note" title="This dashboard was built with AI assistance.">Made with AI</span>
    </div>
    <div id="clock" class="header-clock"></div>
</header>

<nav class="main-nav">
{nav_items}
    <div class="nav-spacer"></div>
    <div class="nav-user" title="{safe_username}">{safe_username} <span>{safe_role}</span></div>
    <form class="nav-logout-form" action="/logout" method="post">
        <button class="nav-btn nav-logout-btn" type="submit">Logout</button>
    </form>
</nav>"""


def _cache_path(key):
    return os.path.join(_CACHE_DIR, _hashlib.md5(repr(key).encode("utf-8")).hexdigest() + ".json.gz")


def _cache_fresh(path, ttl):
    try:
        return os.path.exists(path) and (_time.time() - os.path.getmtime(path)) < ttl
    except OSError:
        return False


def _env_truthy(name, default="0"):
    return str(os.environ.get(name, default)).strip().lower() in {"1", "true", "yes", "on"}


def _write_cache(key, builder):
    gz = _gzip.compress(_json.dumps(builder(), default=str, separators=(",", ":")).encode("utf-8"), 5)
    path = _cache_path(key)
    try:
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(gz)
        os.replace(tmp, path)
    except Exception:
        pass
    return gz


def _gzip_resp(gz, accepts_gzip, cache_state=None):
    if accepts_gzip:
        resp = app.response_class(gz, mimetype="application/json")
        resp.headers["Content-Encoding"] = "gzip"
        resp.headers["Content-Length"] = str(len(gz))
        resp.headers["Vary"] = "Accept-Encoding"
        if cache_state:
            resp.headers["X-Dashboard-Cache"] = cache_state
        return resp
    resp = app.response_class(_gzip.decompress(gz), mimetype="application/json")
    if cache_state:
        resp.headers["X-Dashboard-Cache"] = cache_state
    return resp


def _refresh_cache_async(key, builder):
    with _REFRESHING_KEYS_GUARD:
        if key in _REFRESHING_KEYS:
            return
        _REFRESHING_KEYS.add(key)

    def run():
        try:
            _write_cache(key, builder)
        except Exception as exc:
            print(f"[cache] background refresh failed for {key}: {exc}")
        finally:
            with _REFRESHING_KEYS_GUARD:
                _REFRESHING_KEYS.discard(key)

    _threading.Thread(target=run, name="cache-refresh", daemon=True).start()


def _cached_json(key, builder, ttl=_CACHE_TTL):
    accepts = "gzip" in request.headers.get("Accept-Encoding", "").lower()
    path = _cache_path(key)
    if _cache_fresh(path, ttl):
        try:
            with open(path, "rb") as fh:
                return _gzip_resp(fh.read(), accepts, "hit")
        except OSError:
            pass
    if _env_truthy("MIRA_SERVE_STALE_CACHE", "1") and _cache_fresh(path, _CACHE_STALE_TTL):
        try:
            with open(path, "rb") as fh:
                gz = fh.read()
            _refresh_cache_async(key, builder)
            return _gzip_resp(gz, accepts, "stale")
        except OSError:
            pass
    # Single-flight: one build per key; concurrent requests wait and reuse it.
    with _BUILD_LOCKS_GUARD:
        lock = _BUILD_LOCKS.setdefault(key, _threading.Lock())
    with lock:
        if _cache_fresh(path, ttl):
            try:
                with open(path, "rb") as fh:
                    return _gzip_resp(fh.read(), accepts, "hit")
            except OSError:
                pass
        gz = _write_cache(key, builder)
    return _gzip_resp(gz, accepts, "miss")


def _register_refresh(key, builder):
    _REFRESH_TARGETS.append((key, builder))


def _background_refresher():
    """Optionally rebuild default heavy payloads on a schedule.

    Disabled by default for deployed servers because these builds are CPU-heavy
    and previously made first boot unusable. Set MIRA_ENABLE_CACHE_WARMER=1 to
    enable scheduled warming, and MIRA_WARM_ON_STARTUP=1 to run it immediately.
    """
    if not _env_truthy("MIRA_ENABLE_CACHE_WARMER", "0"):
        print("[cache] background warmer disabled (set MIRA_ENABLE_CACHE_WARMER=1 to enable).")
        return

    def loop():
        if not _env_truthy("MIRA_WARM_ON_STARTUP", "0"):
            _time.sleep(max(60.0, _CACHE_TTL * 0.5))
        while True:
            for key, builder in list(_REFRESH_TARGETS):
                try:
                    path = _cache_path(key)
                    if not _cache_fresh(path, _CACHE_TTL):
                        _write_cache(key, builder)
                except Exception:
                    pass
            _time.sleep(max(60.0, _CACHE_TTL * 0.5))
    _threading.Thread(target=loop, name="cache-refresher", daemon=True).start()


def _invalidate_route_cache():
    """Delete cached files + payload dict caches so the next request rebuilds."""
    try:
        for fn in os.listdir(_CACHE_DIR):
            try:
                os.remove(os.path.join(_CACHE_DIR, fn))
            except OSError:
                pass
    except Exception:
        pass
    # kpi_query_service/predictive_service memoize on top of downtime_service's
    # own caches (up to 15 min TTL) — without clearing these too, the MIRA
    # Overview / Predictive Insights pages keep serving pre-import data for
    # up to 15 minutes after an otherwise-successful import.
    for mod, attr in (
        ("pm_schedule_service", "_PM_PAGE_PAYLOAD_CACHE"),
        ("downtime_service", "_DOWNTIME_CACHE"),
        ("mira.services.kpi_query_service", "_MEMO"),
        ("mira.services.predictive_service", "_MEMO"),
    ):
        try:
            import importlib
            getattr(importlib.import_module(mod), attr).clear()
        except Exception:
            pass
    try:
        clear_work_order_runtime_caches()
    except Exception:
        pass


# A successful POST to any of these (edit/upload) invalidates the cache so the
# next load reflects the change.
_MUTATION_PREFIXES = (
    "/api/maintenance/pm-schedule/",
    "/api/downtime/import",
    "/api/import/repair",
    "/api/maintenance/import",
    "/api/spare-parts/import",
)


@app.after_request
def _clear_cache_after_mutation(response):
    try:
        if request.method == "POST" and any(request.path.startswith(p) for p in _MUTATION_PREFIXES):
            _invalidate_route_cache()
    except Exception:
        pass
    return response


@app.after_request
def _gzip_large_responses(response):
    """Gzip large responses. The dashboard payloads are 13-32 MB and the dev
    server transmits uncompressed bytes at <1 MB/s, which was the real cause of
    slow page loads (the build/cache were already fast). Gzip shrinks them ~10-15x
    so they transfer in ~1s. Browsers decompress transparently."""
    try:
        if (
            response.status_code != 200
            or response.direct_passthrough
            or "Content-Encoding" in response.headers
            or "gzip" not in request.headers.get("Accept-Encoding", "").lower()
        ):
            return response
        data = response.get_data()
        if len(data) < 2048:
            return response
        compressed = _gzip.compress(data, 5)
        response.set_data(compressed)
        response.headers["Content-Encoding"] = "gzip"
        response.headers["Content-Length"] = str(len(compressed))
        response.headers["Vary"] = "Accept-Encoding"
    except Exception:
        pass
    return response


if mira_bp is not None:
    app.register_blueprint(mira_bp)
else:
    print(f"MIRA routes unavailable: {mira_import_error}")


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user():
        return redirect(_default_page_for_user(current_user()))

    error = ""
    next_url = request.args.get("next") or request.form.get("next") or ""
    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        user = _auth.verify_credentials(username, password)
        if user:
            session.clear()
            session.permanent = True
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            session["role"] = user["role"]
            target = next_url if _can_access_next(next_url, user) else _default_page_for_user(user)
            return redirect(target)
        error = "Invalid username or password."

    return render_template(
        "login.html",
        error=error,
        next=next_url,
        login_groups=_auth.list_active_users_by_role(),
    )


@app.route("/logout", methods=["GET", "POST"])
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/access-denied")
@login_required
def access_denied():
    user = current_user() or {}
    return render_template(
        "access_denied.html",
        role=user.get("role", ""),
        home_url=_default_page_for_user(user),
    ), 403


@app.route("/api/auth/session")
@login_required
def auth_session():
    user = current_user() or {}
    return jsonify({
        "authenticated": True,
        "username": user.get("username"),
        "role": user.get("role"),
        "permissions": sorted(user.get("permissions") or []),
        "sessionTimeoutMinutes": int(app.config["PERMANENT_SESSION_LIFETIME"].total_seconds() // 60),
    })


@app.route("/management/users", methods=["GET", "POST"])
@permission_required("manage_users")
def manage_users():
    message = ""
    error = ""
    if request.method == "POST":
        action = (request.form.get("action") or "").strip()
        try:
            if action == "create":
                user = _auth.create_user(
                    request.form.get("username", ""),
                    request.form.get("password", ""),
                    request.form.get("role", "public"),
                    is_active=request.form.get("is_active") == "1",
                )
                message = f"Created {user['username']}."
            elif action == "update":
                user_id = request.form.get("user_id")
                is_self = str(user_id) == str(session.get("user_id"))
                is_active = True if is_self else request.form.get("is_active") == "1"
                # A restricted user editing their own account can't demote themselves,
                # which would otherwise lock them out of user management.
                role = "restricted" if is_self else request.form.get("role", "public")
                user = _auth.update_user(
                    user_id,
                    password=request.form.get("password", ""),
                    role=role,
                    is_active=is_active,
                )
                if is_self:
                    session["role"] = user["role"]
                    session["username"] = user["username"]
                message = f"Updated {user['username']}."
            else:
                error = "Unknown user action."
        except Exception as exc:
            error = str(exc)

    return render_template(
        "manage_users.html",
        users=_auth.list_users(),
        role_labels=_auth.ROLE_LABELS,
        message=message,
        error=error,
        current_user_id=session.get("user_id"),
    )


@app.route("/api/health")
def api_health():
    """Lightweight liveness/readiness probe — never triggers a heavy load."""
    import downtime_service as _dt
    import pm_schedule_service as _pm

    def _has(*names):
        for n in names:
            parts = n if isinstance(n, tuple) else (n,)
            if os.path.exists(os.path.join(DATA_DIR, *parts)):
                return True
        return False

    ollama_enabled = (
        os.environ.get("LLM_PROVIDER", "").lower() == "ollama"
        or os.environ.get("OLLAMA_ENABLED", "").lower() in {"1", "true", "yes"}
    )
    return jsonify({
        "status": "ok",
        "version": APP_VERSION,
        "startTime": _BACKEND_START.isoformat(),
        "uptimeSeconds": round((datetime.now() - _BACKEND_START).total_seconds()),
        "data": {
            "mrDataLoaded": bool(getattr(_dt, "_WO_LOAD_CACHE", {}).get("payload")),
            "sparePartsDataLoaded": _has("spare_parts_master.xlsx"),
            "pmDataLoaded": bool(getattr(_pm, "_PM_PAGE_PAYLOAD_CACHE", None)) or _has("equipment_maintenance_schedule_source.xlsx"),
            "assetMasterPresent": _has(("master", "Asset_Master.xlsx")),
        },
        "caches": {
            "downtimeWarm": bool(getattr(_dt, "_DOWNTIME_CACHE", None)),
            "pmPageWarm": bool(getattr(_pm, "_PM_PAGE_PAYLOAD_CACHE", None)),
            "assetProfilesCached": _ASSET_PROFILE_CACHE.get("profiles") is not None,
        },
        "ollama": {
            "enabled": ollama_enabled,
            "baseUrl": os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434"),
            "model": os.environ.get("OLLAMA_MODEL", "qwen3:8b"),
        },
    })


@app.after_request
def apply_cache_headers(response):
    """Prevent stale caches for API JSON; allow short browser cache for static assets."""
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/refresh-data", methods=["POST", "GET"])
def api_refresh_data():
    """Clear cached responses + payload caches so the next load reflects newly
    dropped or replaced data files. The heavy data caches are file-signature
    keyed and pick up changes on their own; this also drops the short-lived
    response cache (keyed only by request params), which is the one thing that
    can otherwise serve stale data for a few minutes after a raw file drop."""
    _invalidate_route_cache()
    try:
        from maintenance_service import clear_maintenance_caches
        clear_maintenance_caches()
    except Exception:
        pass
    return jsonify({
        "ok": True,
        "message": "Caches cleared. Fresh data will be loaded on the next request.",
        "clearedAt": datetime.now().isoformat(),
    })


@app.route("/api/db/status")
def db_status():
    """SQLite health check — row counts and last-updated timestamps per table."""
    return jsonify(_db.get_db_status())


@app.route("/api/db/sync-asset-master", methods=["POST"])
def db_sync_asset_master():
    """Re-import the Asset Master Excel into the asset_master SQL table.
    Useful after dropping a new Asset_Master.xlsx without restarting the server."""
    result = _db.sync_asset_master_from_file(DATA_DIR)
    return jsonify(result), (200 if result.get("ok") else 500)


# ── Frontend routes ───────────────────────────────────────────────────────────

@app.route("/")
@login_required
def root():
    """Root URL uses the login page as the default entry point."""
    if not str(request.args.get("view", "")).strip():
        return redirect(url_for("login"))
    return _serve_html_with_auth(os.path.join(FRONTEND_DIR, "Maintenance"), "index.html")


@app.route("/Downtime")
@app.route("/Downtime/index.html")
@login_required
def downtime_root():
    """Downtime is part of the Maintenance page; embed mode still serves the HTML file."""
    embed_mode = str(request.args.get("embed", "")).strip().lower() in {"1", "true", "yes", "on"}
    if embed_mode:
        return _serve_html_with_auth(os.path.join(FRONTEND_DIR, "Downtime"), "index.html")
    return redirect("/?view=downtime")


@app.route("/<path:path>")
def frontend_files(path):
    """Catch-all static file server for CSS, JS, shared assets, etc."""
    normalised = path.replace("\\", "/").lstrip("/")
    if normalised.lower() == "shared/navbar.html":
        return app.response_class(_navbar_html(), mimetype="text/html")
    if normalised.lower() in {"maintenance/index.html", "downtime/index.html"}:
        root_dir = "Maintenance" if normalised.lower().startswith("maintenance/") else "Downtime"
        return _serve_html_with_auth(os.path.join(FRONTEND_DIR, root_dir), "index.html")
    return send_from_directory(FRONTEND_DIR, path)


# ── Asset list (shared by Maintenance Analysis tab and Downtime) ──────────────
from asset_mapping import load_asset_mapping, build_refrigeration_tree, get_asset_mapping_meta
import asset_resolver

# ── Downtime routes (needed by Maintenance "Analysis" tab) ───────────────────

# Smart-matching asset profiles are built once from the asset master and cached
# (rebuilt only when the master changes). The slim profile is what the frontend
# matcher needs for live search + selected-asset matching.
_ASSET_PROFILE_CACHE = {"signature": None, "profiles": None}


def _slim_profile(profile):
    return {
        "assetId": profile["assetId"],
        "canonicalName": profile["canonicalName"],
        "nameTokens": profile["nameTokens"],
        "number": profile["number"],
        "aliases": profile["aliases"],
        "relatedKeywords": profile["relatedKeywords"],
        "functionalLocation": profile["functionalLocation"],
        "machineGroup": profile["machineGroup"],
    }


def get_cached_asset_profiles(mapping, signature):
    if _ASSET_PROFILE_CACHE["signature"] == signature and _ASSET_PROFILE_CACHE["profiles"] is not None:
        return _ASSET_PROFILE_CACHE["profiles"]
    inputs = []
    for group in mapping.get("groups", []):
        for entry in group.get("asset_entries", []):
            inputs.append({
                "asset_id": entry.get("asset_id"),
                "name": entry.get("mappedAssetName") or entry.get("asset_display_name"),
                "machine_group": entry.get("mappedMainAssetGroup") or group.get("machine_group"),
                "functional_location": entry.get("mappedLocation") or entry.get("mappedSystemArea") or group.get("location"),
            })
    full = asset_resolver.build_all_asset_profiles(inputs)
    profiles = {aid: _slim_profile(p) for aid, p in full.items()}
    _ASSET_PROFILE_CACHE["signature"] = signature
    _ASSET_PROFILE_CACHE["profiles"] = profiles
    return profiles


@app.route("/api/asset-list")
def asset_list_api():
    try:
        mapping = load_asset_mapping(DATA_DIR)
        if not mapping["available"]:
            return jsonify({"machines": [], "error": mapping["message"]}), 404

        # Build grouped machine list matching the old response shape
        machines = []
        for group in mapping["groups"]:
            assets = [
                {
                    "asset_id": e["asset_id"],
                    "label": e["asset_display_name"],
                    "mappedStage": e.get("mappedStage"),
                    "mappedAssetName": e.get("mappedAssetName") or e.get("asset_display_name"),
                    "mappedMainAssetGroup": e.get("mappedMainAssetGroup") or group.get("mappedMainAssetGroup"),
                    "mappedMachineGroup": e.get("mappedMachineGroup") or "",
                    "mappedSubAssetGroup": e.get("mappedSubAssetGroup"),
                    "mappedLocation": e.get("mappedLocation") or group.get("mappedLocation"),
                    "mappedSystemArea": e.get("mappedSystemArea"),
                    "mappingStatus": e.get("mappingStatus"),
                }
                for e in group.get("asset_entries", [])
            ]
            machines.append({
                "machine_name": group["machine_group"],
                "location": group["location"],
                "criticality": group["criticality"],
                "mappedStage": group.get("mappedStage"),
                "mappedMainAssetGroup": group.get("mappedMainAssetGroup") or group["machine_group"],
                "mappedSubAssetGroup": group.get("mappedSubAssetGroup"),
                "mappedLocation": group.get("mappedLocation") or group["location"],
                "mappedSystemArea": group.get("mappedSystemArea"),
                "mappingStatus": group.get("mappingStatus"),
                "asset_count": len(assets),
                "assets": assets,
            })

        meta = get_asset_mapping_meta(DATA_DIR)
        return jsonify({
            "machines": machines,
            "refrigeration_tree": build_refrigeration_tree(mapping),
            "asset_profiles": get_cached_asset_profiles(mapping, meta.get("last_synced")),
            "meta": meta,
        })
    except Exception as exc:
        return jsonify({"machines": [], "error": str(exc)}), 500


@app.route("/api/downtime")
def downtime_data():
    period = request.args.get("period")
    month = request.args.get("month")
    start = request.args.get("start")
    end = request.args.get("end")
    stage = request.args.get("stage")
    work_orders_only = str(request.args.get("work_orders_only", "")).strip().lower() in {"1", "true", "yes", "on"}
    return _cached_json(
        ("downtime", "lean-v3", period, month, start, end, work_orders_only, stage),
        lambda: build_downtime_payload(period, month, start, end, work_orders_only=work_orders_only, stage=stage),
    )


# ── Spare-parts views: Overview / Goods Received / Goods Issued ────────────────
# Pluggable by import (files discovered in data/ by spare_parts_views) and cached
# by filter params (the underlying parsers are cached by file signature).
@app.route("/api/maintenance/critical-machines/inactive")
def inactive_critical_machines_api():
    period = request.args.get("period")
    month = request.args.get("month")
    start = request.args.get("start")
    end = request.args.get("end")
    stage = request.args.get("stage")
    category = request.args.get("equipmentCategory") or request.args.get("category")
    return _cached_json(
        ("inactive-critical-machines", period, month, start, end, stage, category),
        lambda: build_inactive_critical_machines_payload(period, month, start, end, stage=stage, category=category),
    )


def _spare_filters():
    return (
        request.args.get("stage"),
        request.args.get("equipmentCategory") or request.args.get("category"),
        request.args.get("year"),
        request.args.get("month"),
        request.args.get("financialView") or request.args.get("financial_view") or request.args.get("financial"),
    )


@app.route("/api/spare-parts/overview")
def spare_parts_overview():
    stage, category, year, month, financial_view = _spare_filters()
    import spare_parts_views as spv
    return _cached_json(
        ("spare-overview-v2", stage, category, year, month, financial_view),
        lambda: spv.build_overview(stage, category, year, month, financial_view),
    )


@app.route("/api/spare-parts/goods-received")
def spare_parts_goods_received():
    stage, category, year, month, financial_view = _spare_filters()
    import spare_parts_views as spv
    return _cached_json(
        ("spare-goods-received", stage, category, year, month, financial_view),
        lambda: spv.build_goods_received(stage, category, year, month, financial_view),
    )


@app.route("/api/spare-parts/goods-issued")
def spare_parts_goods_issued():
    stage, category, year, month, financial_view = _spare_filters()
    import spare_parts_views as spv
    return _cached_json(
        ("spare-goods-issued", stage, category, year, month, financial_view),
        lambda: spv.build_goods_issued(stage, category, year, month),
    )


@app.route("/api/spare-parts/item-vendor-analysis")
def spare_parts_item_vendor_analysis():
    stage, category, year, month, financial_view = _spare_filters()
    import spare_parts_views as spv
    return _cached_json(
        ("spare-item-vendor", stage, category, year, month, financial_view),
        lambda: spv.build_item_vendor_analysis(stage, category, year, month, financial_view),
    )


@app.route("/api/spare-parts/import-status")
def spare_parts_import_status():
    import spare_parts_views as spv
    import spare_po_service as sps
    status = spv.get_import_status()
    status.update(sps.get_import_status())
    return jsonify(status)


def _do_gen_po_import(stage):
    import spare_parts_views as spv
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "stage": stage, "message": "No file uploaded."}), 400
    result = spv.import_gen_po(stage, upload)
    return jsonify(result), (200 if result.get("ok") else 400)


@app.route("/api/spare-parts/import-stage-1-gen-po", methods=["POST"])
def spare_parts_import_stage1():
    return _do_gen_po_import("Stage 1")


@app.route("/api/spare-parts/import-stage-2-gen-po", methods=["POST"])
def spare_parts_import_stage2():
    return _do_gen_po_import("Stage 2")


@app.route("/api/spare-parts/import-consumption", methods=["POST"])
def spare_parts_import_consumption():
    """Goods Issued / Consumption source — Project Actual Transactions export."""
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "No consumption file uploaded."}), 400
    result = import_project_transactions_file(upload)
    return jsonify(result), (200 if result.get("ok") else 400)


@app.route("/api/spare-parts/import-inventory", methods=["POST"])
def spare_parts_import_inventory():
    """Inventory / stock master import."""
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "No inventory file uploaded."}), 400
    result = import_spare_inventory_file(upload)
    return jsonify(result), (200 if result.get("ok") else 400)


@app.route("/api/spare-parts/delivery-performance")
def spare_parts_delivery_performance():
    stage, category, year, month, financial_view = _spare_filters()
    import delivery_performance_service as dps
    return _cached_json(
        ("spare-delivery-perf", stage, category, year, month, financial_view),
        lambda: dps.build_delivery_performance(stage, category, year, month, financial_view),
    )


@app.route("/api/spare-parts/po-spare")
def spare_parts_po_spare():
    import spare_po_service as sps
    year  = request.args.get("year",  "").strip()
    month = request.args.get("month", "").strip()
    return _cached_json(
        ("spare-po-spare", year, month),
        lambda: sps.build_spare_po_payload(year=year, month=month),
    )


@app.route("/api/spare-parts/import-po-spare", methods=["POST"])
def spare_parts_import_po_spare():
    """Import PO Spare 24-26.csv (controlled spare PO base table)."""
    import spare_po_service as sps
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "No file uploaded."}), 400
    result = sps.import_po_spare_file(upload)
    return jsonify(result), (200 if result.get("ok") else 400)


@app.route("/api/spare-parts/import-inventory-mapping", methods=["POST"])
def spare_parts_import_inventory_mapping():
    """Import On-hand list.xlsx as inventory item mapping (stock snapshot / lookup only)."""
    import spare_po_service as sps
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "No file uploaded."}), 400
    result = sps.import_inventory_mapping_file(upload)
    return jsonify(result), (200 if result.get("ok") else 400)


@app.route("/api/spare-parts/procurement-reconciliation")
def spare_parts_procurement_reconciliation():
    stage, category, year, month, financial_view = _spare_filters()
    import indirect_po_service as ipo
    return _cached_json(
        ("spare-procurement-recon", stage, category, year, month, financial_view),
        lambda: ipo.build_procurement_reconciliation(stage, category, year, month, financial_view),
    )


@app.route("/api/spare-parts/import-indirect-po", methods=["POST"])
def spare_parts_import_indirect_po():
    import indirect_po_service as ipo
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "No Indirect PO file uploaded."}), 400
    result = ipo.import_indirect_po(upload)
    return jsonify(result), (200 if result.get("ok") else 400)


@app.route("/api/downtime/import-work-orders", methods=["GET", "POST"])
def downtime_import_work_orders():
    if request.method == "GET":
        return jsonify(get_work_order_import_status())
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "No work order file uploaded."}), 400
    replace = str(request.form.get("replace", "true")).strip().lower() not in {"0", "false", "no"}
    result = import_work_order_file(upload, replace=replace)
    return jsonify(result), (200 if result.get("ok") else 400)


@app.route("/api/import/validate", methods=["POST"])
def import_validate():
    """
    Validate a work-order file (CSV, XLSX, XLS) before committing it to the DB.

    Returns: is_powerbi, source_type, column_map, missing required columns,
    found required columns, up to 3 sample mapped rows, total row count, and
    a human-readable message. Does NOT save the file or write to the database.
    """
    import tempfile, os as _os
    try:
        import powerbi_adapter as _pbi
        from downtime_service import read_work_order_source_file, WORK_ORDER_IMPORT_EXTENSIONS
    except ImportError as exc:
        return jsonify({"ok": False, "message": f"Import error: {exc}"}), 500

    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "No file uploaded."}), 400

    filename = _os.path.basename(getattr(upload, "filename", "") or "")
    ext = _os.path.splitext(filename)[1].lower()
    if ext not in WORK_ORDER_IMPORT_EXTENSIONS:
        return jsonify({
            "ok": False,
            "message": f"Unsupported file type '{ext}'. Upload a CSV, XLSX, or XLS file.",
        }), 400

    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp_path = tmp.name
            upload.save(tmp_path)

        try:
            df = read_work_order_source_file(tmp_path)
        finally:
            try:
                _os.remove(tmp_path)
            except OSError:
                pass

        is_powerbi = _pbi.detect_powerbi_export(df)
        source_type = "powerbi" if is_powerbi else "work_orders"
        validation = _pbi.validate_powerbi_columns(df)

        return jsonify({
            "ok": validation["ok"],
            "is_powerbi": is_powerbi,
            "source_type": source_type,
            "missing": validation["missing"],
            "found": validation["found"],
            "column_map": validation["column_map"],
            "sample_rows": validation["sample_rows"],
            "total_rows": validation["total_rows"],
            "message": validation["message"],
        })
    except Exception as exc:
        return jsonify({"ok": False, "message": f"Validation failed: {exc}"}), 400


@app.route("/api/import/last-result")
def import_last_result():
    """Return the stats from the most recent background DB import write."""
    stats = get_last_import_stats()
    if not stats:
        return jsonify({"ok": False, "message": "No import has been run yet in this session."}), 200
    return jsonify(stats)


@app.route("/api/import/repair-quality-flags", methods=["POST"])
def import_repair_quality_flags():
    """
    Re-evaluate and fix stored data_validity_status for Power BI records
    that were imported before the 'Confirm' lifecycle fix or before
    ActualStart/ActualEnd column aliases were recognised.
    Clears the SQL work-order cache so the next page load reflects repairs.
    """
    try:
        import db as _db
        import downtime_service as _ds
        result = _db.repair_powerbi_quality_flags()
        _ds.clear_work_order_runtime_caches()
        return jsonify({
            "ok": True,
            "repaired": result["repaired"],
            "skipped": result["skipped"],
            "message": f"Repaired {result['repaired']} record(s), skipped {result['skipped']}.",
        })
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.route("/api/import/quality-summary")
def import_quality_summary():
    """Per-flag counts and source breakdown for the data quality card."""
    try:
        import db as _db
        with _db.get_connection() as conn:
            groups = conn.execute("""
                SELECT
                    source_type,
                    source_file,
                    data_validity_status,
                    review_reason,
                    COUNT(*) AS cnt
                FROM work_orders
                GROUP BY source_type, source_file, data_validity_status, review_reason
                ORDER BY cnt DESC
            """).fetchall()
            last_ts = conn.execute(
                "SELECT MAX(updated_at) FROM work_orders"
            ).fetchone()[0]
        return jsonify({
            "ok": True,
            "groups": [dict(r) for r in groups],
            "last_updated": last_ts,
        })
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.route("/api/maintenance/import-status")
def maintenance_import_status():
    """
    Return the currently active Power BI full MR/WO batch info plus a count
    of all historical batches. Used by the frontend to show import provenance.
    """
    try:
        import db as _db
        active = _db.get_active_powerbi_batch_info()
        with _db.get_connection() as conn:
            history = conn.execute(
                """
                SELECT batch_id, source_file, imported_at, is_active,
                       total_rows, valid_rows, review_rows
                FROM import_batches
                WHERE source_type = 'POWERBI_FULL_MR_WO_EXPORT'
                ORDER BY imported_at DESC
                LIMIT 20
                """
            ).fetchall()
        return jsonify({
            "ok": True,
            "active_batch": active,
            "history": [dict(r) for r in history],
        })
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.route("/api/maintenance/summary")
def maintenance_summary():
    """
    Aggregate summary for the active Power BI batch:
    total rows, status breakdown, TTR/MTTR stats, data quality counts.
    Falls back to a 404-style message when no active batch exists.
    """
    try:
        import db as _db
        batch_id = _db.get_active_powerbi_full_batch_id()
        if not batch_id:
            return jsonify({"ok": False, "message": "No active D365 import batch found.", "batch_id": None}), 200

        with _db.get_connection() as conn:
            status_rows = conn.execute(
                """
                SELECT normalized_status, COUNT(*) AS cnt
                FROM raw_powerbi_mr_wo_export
                WHERE import_batch_id = ?
                GROUP BY normalized_status
                ORDER BY cnt DESC
                """,
                (batch_id,),
            ).fetchall()

            ttr_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN ttr_hours IS NOT NULL THEN 1 ELSE 0 END) AS valid_ttr,
                    ROUND(AVG(CASE WHEN ttr_hours IS NOT NULL AND ttr_hours >= 0 THEN ttr_hours END), 3) AS avg_ttr,
                    ROUND(MIN(CASE WHEN ttr_hours IS NOT NULL AND ttr_hours >= 0 THEN ttr_hours END), 3) AS min_ttr,
                    ROUND(MAX(CASE WHEN ttr_hours IS NOT NULL AND ttr_hours >= 0 THEN ttr_hours END), 3) AS max_ttr
                FROM raw_powerbi_mr_wo_export
                WHERE import_batch_id = ?
                """,
                (batch_id,),
            ).fetchone()

            dq_rows = conn.execute(
                """
                SELECT data_quality_flag, COUNT(*) AS cnt
                FROM raw_powerbi_mr_wo_export
                WHERE import_batch_id = ?
                GROUP BY data_quality_flag
                ORDER BY cnt DESC
                """,
                (batch_id,),
            ).fetchall()

        return jsonify({
            "ok":            True,
            "batch_id":      batch_id,
            "status_counts": [dict(r) for r in status_rows],
            "ttr_stats":     dict(ttr_row) if ttr_row else {},
            "quality_counts": [dict(r) for r in dq_rows],
        })
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.route("/api/maintenance/records")
def maintenance_records():
    """
    Return paginated records from the active Power BI batch.
    Query params: page (1-based), page_size (default 200), status, quality_flag.
    """
    try:
        import db as _db
        batch_id = _db.get_active_powerbi_full_batch_id()
        if not batch_id:
            return jsonify({"ok": False, "message": "No active batch.", "records": []}), 200

        page      = max(1, int(request.args.get("page", 1)))
        page_size = min(500, max(1, int(request.args.get("page_size", 200))))
        offset    = (page - 1) * page_size
        status_f  = (request.args.get("status") or "").strip()
        dq_f      = (request.args.get("quality_flag") or "").strip()

        params: list = [batch_id]
        where = ["import_batch_id = ?"]
        if status_f:
            where.append("normalized_status = ?")
            params.append(status_f)
        if dq_f:
            where.append("data_quality_flag = ?")
            params.append(dq_f)

        sql = (
            "SELECT * FROM raw_powerbi_mr_wo_export"
            f" WHERE {' AND '.join(where)}"
            " ORDER BY actual_start DESC"
            f" LIMIT {page_size} OFFSET {offset}"
        )
        count_sql = (
            "SELECT COUNT(*) FROM raw_powerbi_mr_wo_export"
            f" WHERE {' AND '.join(where)}"
        )
        with _db.get_connection() as conn:
            rows  = conn.execute(sql, params).fetchall()
            total = conn.execute(count_sql, params).fetchone()[0]

        return jsonify({
            "ok":      True,
            "batch_id": batch_id,
            "page":    page,
            "page_size": page_size,
            "total":   total,
            "records": [dict(r) for r in rows],
        })
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.route("/api/maintenance/ttr-mttr")
def maintenance_ttr_mttr():
    """
    TTR/MTTR summary for the active Power BI batch.
    Only rows with valid ttr_hours (>= 0, no invalid date sequence) are included.
    Breakdown by normalized_status and asset_id.
    """
    try:
        import db as _db
        batch_id = _db.get_active_powerbi_full_batch_id()
        if not batch_id:
            return jsonify({"ok": False, "message": "No active batch.", "mttr_hours": None}), 200

        with _db.get_connection() as conn:
            overall = conn.execute(
                """
                SELECT
                    COUNT(*) AS eligible_rows,
                    ROUND(AVG(ttr_hours), 3) AS mttr_hours,
                    ROUND(SUM(ttr_hours), 3) AS total_ttr_hours,
                    SUM(CASE WHEN review_reason LIKE '%Invalid Date Sequence%' THEN 1 ELSE 0 END) AS excluded_bad_seq,
                    SUM(CASE WHEN ttr_hours IS NULL THEN 1 ELSE 0 END) AS excluded_missing_dates
                FROM raw_powerbi_mr_wo_export
                WHERE import_batch_id = ? AND ttr_hours IS NOT NULL AND ttr_hours >= 0
                """,
                (batch_id,),
            ).fetchone()

            by_status = conn.execute(
                """
                SELECT normalized_status,
                       COUNT(*) AS rows,
                       ROUND(AVG(ttr_hours), 3) AS avg_ttr
                FROM raw_powerbi_mr_wo_export
                WHERE import_batch_id = ? AND ttr_hours IS NOT NULL AND ttr_hours >= 0
                GROUP BY normalized_status
                """,
                (batch_id,),
            ).fetchall()

        return jsonify({
            "ok":        True,
            "batch_id":  batch_id,
            "overall":   dict(overall) if overall else {},
            "by_status": [dict(r) for r in by_status],
        })
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.route("/api/maintenance/data-quality")
def maintenance_data_quality():
    """
    Data quality breakdown for the active Power BI batch.
    Returns per-flag counts and a list of review rows (up to 250).
    """
    try:
        import db as _db
        batch_id = _db.get_active_powerbi_full_batch_id()
        if not batch_id:
            return jsonify({"ok": False, "message": "No active batch.", "flags": []}), 200

        with _db.get_connection() as conn:
            flag_counts = conn.execute(
                """
                SELECT data_quality_flag, COUNT(*) AS cnt
                FROM raw_powerbi_mr_wo_export
                WHERE import_batch_id = ?
                GROUP BY data_quality_flag
                ORDER BY cnt DESC
                """,
                (batch_id,),
            ).fetchall()

            review_rows = conn.execute(
                """
                SELECT request_id, work_order_id, asset_id, asset_name,
                       request_state, actual_start, actual_end,
                       ttr_hours, data_quality_flag, review_reason
                FROM raw_powerbi_mr_wo_export
                WHERE import_batch_id = ? AND data_quality_flag != 'Valid'
                ORDER BY actual_start DESC
                LIMIT 250
                """,
                (batch_id,),
            ).fetchall()

        return jsonify({
            "ok":          True,
            "batch_id":    batch_id,
            "flag_counts": [dict(r) for r in flag_counts],
            "review_rows": [dict(r) for r in review_rows],
        })
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.route("/api/downtime/mtbf-history")
def downtime_mtbf_history():
    return jsonify(build_mtbf_work_order_history_payload(stage=request.args.get("stage")))


def get_path_mtime_iso(path):
    try:
        return datetime.fromtimestamp(os.path.getmtime(path)).isoformat()
    except (FileNotFoundError, OSError, ValueError):
        return None


def get_page_last_synced(page_key):
    key = (page_key or "").strip().lower()

    if key == "maintenance":
        try:
            freshness = _db.get_overview_freshness()
            tables = freshness.get("tables") or {}
            return (
                (tables.get("pm_schedule") or {}).get("last_updated")
                or get_pm_schedule_last_synced()
                or get_maintenance_import_status().get("last_synced")
            )
        except Exception:
            return get_pm_schedule_last_synced() or get_maintenance_import_status().get("last_synced")

    if key == "downtime":
        try:
            batch = _db.get_active_powerbi_batch_info()
            if batch and batch.get("imported_at"):
                return batch.get("imported_at")
            status = _db.get_db_status()
            if status.get("ok") and status.get("work_orders_last_updated"):
                return status.get("work_orders_last_updated")
        except Exception:
            pass
        sources = get_work_order_import_status().get("sources") or []
        latest_source = max((source.get("last_modified") for source in sources if source.get("last_modified")), default=None)
        return latest_source or get_path_mtime_iso(os.path.join(DATA_DIR, ASSET_MASTER_RELATIVE_PATH))

    return None
@app.route("/api/page-sync/<page_key>")
def page_sync(page_key):
    return jsonify({"page": page_key, "last_synced": get_page_last_synced(page_key)})


# ── Maintenance API routes ────────────────────────────────────────────────────

@app.route("/api/maintenance/pm-schedule")
def maintenance_pm_schedule():
    """Unified Preventive Maintenance schedule tracking (Stage 1 + Stage 2)."""
    stage = request.args.get("stage", "all")
    year = request.args.get("year", type=int)
    month = request.args.get("month")
    return _cached_json(
        (_PM_SCHEDULE_CACHE_SCHEMA, "pm-schedule", stage, year, month),
        lambda: build_pm_schedule_payload(stage=stage, year=year, month=month),
    )


@app.route("/api/maintenance/pm-schedule/update", methods=["POST"])
def maintenance_pm_schedule_update():
    """Persist a single PM status update into the local override file.

    Edits are never written back to the read-only source workbooks; they are saved
    to data/pm_schedule_updates.json keyed by pmTaskId and merged on display.
    """
    body = request.get_json(silent=True) or {}
    task_id = body.get("pmTaskId") or body.get("taskId")
    if not task_id:
        return jsonify({"ok": False, "message": "pmTaskId is required."}), 400
    try:
        # Manual planner tasks are edited in their own store; imported tasks use the
        # read-only override layer.
        if str(task_id).startswith("manual_"):
            record = update_planner_task(task_id, body)
        else:
            record = save_pm_override(task_id, body)
        return jsonify({"ok": True, "record": record})
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    except Exception as exc:  # pragma: no cover - defensive
        return jsonify({"ok": False, "message": f"Could not save PM update: {exc}"}), 500


@app.route("/api/maintenance/pm-assets")
def maintenance_pm_assets():
    """Searchable asset catalogue from Asset_Master for the planner form."""
    return jsonify({"assets": get_asset_catalog()})


@app.route("/api/maintenance/pm-schedule/plan", methods=["POST"])
def maintenance_pm_schedule_plan():
    """Create a manual PM task (with optional recurrence) in the local planner store."""
    body = request.get_json(silent=True) or {}
    confirm = bool(body.get("confirm"))
    try:
        result = create_planner_tasks(body, confirm=confirm)
        status = 200 if result.get("ok") else 409  # 409 -> needs duplicate confirmation
        return jsonify(result), status
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    except Exception as exc:  # pragma: no cover - defensive
        return jsonify({"ok": False, "message": f"Could not create PM task: {exc}"}), 500


@app.route("/api/maintenance/pm-schedule/delete", methods=["POST"])
def maintenance_pm_schedule_delete():
    """Delete a manually planned PM task (imported tasks can only be Cancelled)."""
    body = request.get_json(silent=True) or {}
    task_id = body.get("pmTaskId") or body.get("taskId")
    if not task_id or not str(task_id).startswith("manual_"):
        return jsonify({"ok": False, "message": "Only manually planned PM tasks can be deleted."}), 400
    deleted = delete_planner_task(task_id)
    return jsonify({"ok": deleted, "deleted": deleted})


# Legacy maintenance overview / utility / equipment endpoints removed — those
# pages are no longer in use (only PM Schedule, Spare Parts, Downtime and MIRA
# remain). PM Schedule is served by pm_schedule_service; the old maintenance_service
# list/summary/equipment builders are no longer wired to any route.


@app.route("/api/maintenance/spare_parts")
def maintenance_spare_parts():
    return _cached_json(("spare-parts", "browser-v3"), build_spare_parts_payload)


@app.route("/api/maintenance/project_transactions")
def maintenance_project_transactions():
    return jsonify(build_project_transactions_payload())


@app.route("/api/maintenance/project_transactions_all")
def maintenance_project_transactions_all():
    return jsonify(build_all_years_transactions_payload())


@app.route("/api/maintenance/external_po")
def maintenance_external_po():
    return jsonify(build_external_po_payload())


@app.route("/api/maintenance/asset-parts-intelligence")
def maintenance_asset_parts_intelligence():
    a = request.args
    query = a.get("query"); asset_id = a.get("assetId"); asset_name = a.get("assetName")
    asset_family = a.get("assetFamily"); machine_group = a.get("machineGroup")
    date_from = a.get("dateFrom"); date_to = a.get("dateTo")
    include_related = a.get("includeRelatedMatches", "true"); include_low = a.get("includeLowConfidence", "false")
    key = ("asset-parts-intel", query, asset_id, asset_name, asset_family, machine_group,
           date_from, date_to, include_related, include_low)
    # Cache the (deterministic) analysis per search so re-running the same query is
    # instant; the first run still does the heavy build.
    return _cached_json(key, lambda: build_asset_parts_intelligence_context(
        query=query, asset_id=asset_id, asset_name=asset_name, asset_family=asset_family,
        machine_group=machine_group, date_from=date_from, date_to=date_to,
        include_related_matches=include_related, include_low_confidence=include_low,
    ))


@app.route("/api/maintenance/import/external-po", methods=["POST"])
def maintenance_import_external_po():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "No external parts file uploaded."}), 400
    result = import_external_po_file(upload)
    return jsonify(result), (200 if result.get("ok") else 400)


# ── Entry point ───────────────────────────────────────────────────────────────

def _free_port(port):
    """Best-effort: kill any process already holding the port before we bind, so
    a fresh launch never collides with a stale/hung instance (the dev server gets
    relaunched a lot and old python app.py processes pile up). Local dev only;
    never raises."""
    import subprocess
    import signal
    try:
        my_pid = str(os.getpid())
        if os.name == "nt":
            out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True).stdout
            for line in out.splitlines():
                if f":{port} " in line and "LISTENING" in line:
                    parts = line.split()
                    pid = parts[-1] if parts else ""
                    if pid.isdigit() and pid not in (my_pid, "0"):
                        subprocess.run(["taskkill", "/f", "/pid", pid], capture_output=True)
        else:
            out = subprocess.run(["lsof", "-ti", f"tcp:{port}"], capture_output=True, text=True).stdout
            for pid in out.split():
                if pid.isdigit() and pid != my_pid:
                    try:
                        os.kill(int(pid), signal.SIGKILL)
                    except OSError:
                        pass
    except Exception:
        pass


def _start_cache_warming():
    """Register the default heavy payloads and start the background refresher so
    user requests always hit a warm disk cache instead of a cold build."""
    # Keep disk caches across restarts by default. Deleting and rebuilding every
    # cache on boot made deployed servers spend their first minutes CPU-bound.
    # Bump schema keys for code-incompatible cache changes, or set this env var
    # for a one-off forced rebuild.
    if _env_truthy("MIRA_CLEAR_CACHE_ON_STARTUP", "0"):
        _invalidate_route_cache()

    # ── SQLite: init schema then sync Asset Master in a background thread ─────
    # init_db() is fast (no-op if tables exist). The asset sync runs in a daemon
    # thread so it never delays server startup or the first request.
    try:
        db_path = _db.init_db()
        print(f"[db] SQLite ready: {db_path}")
    except Exception as _db_exc:
        print(f"[db] WARNING: could not initialise SQLite — {_db_exc}")

    def _sync_asset_master():
        try:
            result = _db.sync_asset_master_from_file(DATA_DIR)
            print(f"[db] {result['message']}")
        except Exception as exc:
            print(f"[db] Asset Master sync error: {exc}")

    _threading.Thread(target=_sync_asset_master, name="db-asset-sync", daemon=True).start()

    # Phase 4: sync current-year PM tasks to SQL in background so the first page
    # load of the day reads from SQL instead of re-parsing the heavy Excel files.
    def _startup_pm_sync():
        _time.sleep(3)  # stagger: let asset-master write finish first
        try:
            from pm_schedule_service import _sync_pm_to_db_background
            _sync_pm_to_db_background()
        except Exception as exc:
            print(f"[db] PM startup sync error: {exc}")

    _threading.Thread(target=_startup_pm_sync, name="db-pm-sync", daemon=True).start()

    # Phase 5: sync spare parts records to SQL in background.
    def _startup_spare_sync():
        _time.sleep(7)  # stagger: let asset-master and PM writes start first
        try:
            from spare_parts_service import request_spare_db_sync
            request_spare_db_sync()
        except Exception as exc:
            print(f"[db] Spare parts startup sync error: {exc}")

    _threading.Thread(target=_startup_spare_sync, name="db-spare-sync", daemon=True).start()
    # ── end SQLite init ───────────────────────────────────────────────────────

    _register_refresh(("downtime", None, None, None, None, False, None), build_downtime_payload)
    _register_refresh((_PM_SCHEDULE_CACHE_SCHEMA, "pm-schedule", "all", None, None), lambda: build_pm_schedule_payload(stage="all", year=None, month=None))
    # Spare parts is the slowest cold build (the all-years project-transactions
    # parse can take minutes) and its CPU-bound work holds the GIL, starving the
    # web server so it can't even return the fast "warming" placeholder. Keep it
    # OUT of the startup warmer by default so PM + downtime warm quickly and the
    # page stays responsive; spare builds lazily on first Spare-Parts request.
    # Set MIRA_WARM_SPARE=1 to restore eager spare warming.
    if os.environ.get("MIRA_WARM_SPARE", "0") not in {"0", "false", "no"}:
        _register_refresh(("spare-parts",), build_spare_parts_payload)
    _background_refresher()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5005))
    if port == 5006:
        raise SystemExit(
            "ERROR: PORT=5006 is reserved for the standalone Downtime app.\n"
            "The Maintenance app runs on 5005. Unset PORT or set PORT=5005."
        )
    debug = os.environ.get("FLASK_DEBUG", "0") not in {"0", "false", "no"}
    # Only the first (parent) run frees the port; the reloader child must not.
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        _free_port(port)
    # Warm caches only in the process that actually serves (the reloader child,
    # or the single process when debug is off).
    if os.environ.get("WERKZEUG_RUN_MAIN") or not debug:
        _start_cache_warming()
        # Daily MR triage scheduler (scope-aware, local-Ollama). Precomputes each
        # configured scope's verdict every morning; serves via GET /api/mira/verdict.
        try:
            import mr_triage_service
            mr_triage_service.start_scheduler()
        except Exception as _triage_exc:
            print(f"MR triage scheduler not started: {_triage_exc}")

    # Prefer the production WSGI server (waitress) when available and not in
    # debug — the Flask dev server is single-process and very slow at serving the
    # large dashboard payloads. `pip install waitress` upgrades automatically.
    if not debug and os.environ.get("USE_WAITRESS", "1").lower() not in {"0", "false", "no"}:
        try:
            from waitress import serve
            print(f"Maintenance server (waitress) on http://localhost:{port}")
            serve(app, host="0.0.0.0", port=port, threads=8)
            raise SystemExit(0)
        except ImportError:
            print("waitress not installed — using the Flask dev server. For production run: pip install waitress")

    print(f"Maintenance standalone server starting on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=debug, threaded=True)
