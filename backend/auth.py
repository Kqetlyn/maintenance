"""
Authentication helpers for the Maintenance Dashboard.

Users are stored in the existing SQLite database. Passwords are never stored in
plain text; Werkzeug's password hashing helpers handle hashing and verification.

There are exactly two roles, and permissions are entirely determined by role
(no per-user overrides, no free-text/custom role names):
  - restricted: full access to everything, including user management.
  - public: PM schedule and downtime only (no Predictive Insights / MIRA
    overview, and no Spare Parts / Reports / Utility / user management).
"""

from __future__ import annotations

import os
import threading
from datetime import datetime

from werkzeug.security import check_password_hash, generate_password_hash

import db as _db


ROLE_PERMISSIONS = {
    "restricted": {
        "mira_overview",
        "pm_schedule",
        "downtime",
        "spare_parts",
        "analysis",
        "utility",
        "manage_users",
    },
    "public": {"pm_schedule", "downtime"},
}
VALID_ROLES = set(ROLE_PERMISSIONS)
ROLE_LABELS = {"restricted": "Restricted", "public": "Public"}
VALID_PERMISSIONS = {perm for perms in ROLE_PERMISSIONS.values() for perm in perms}

# Legacy role names from before the two-role cleanup, mapped onto their closest
# equivalent so existing accounts (and any custom roles created while the
# free-text role system was in place) keep working after this reverts back.
_LEGACY_ROLE_ALIASES = {
    "management": "restricted", "admin": "restricted", "administrator": "restricted", "manager": "restricted",
    "staff": "public", "viewer": "public", "operator": "public",
}

_SCHEMA_READY = False
_SCHEMA_LOCK = threading.Lock()


def _normalize_role(role: str) -> str:
    role = str(role or "").strip().lower()
    role = _LEGACY_ROLE_ALIASES.get(role, role)
    return role if role in VALID_ROLES else "public"


def ensure_users_table() -> None:
    """Ensure the auth schema once per process, retrying after any failure."""
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    with _SCHEMA_LOCK:
        if _SCHEMA_READY:
            return
        with _db.get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    username      TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    role          TEXT NOT NULL,
                    created_at    TEXT NOT NULL,
                    is_active     INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            _migrate_legacy_roles(conn)
            conn.execute("DROP TABLE IF EXISTS user_permissions")
            conn.execute("DROP TABLE IF EXISTS role_permissions")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_users_username ON users (username)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)")
        _SCHEMA_READY = True


def _migrate_legacy_roles(conn) -> None:
    """Fold any pre-cleanup free-text role (management/staff/custom/etc.) onto restricted/public."""
    rows = conn.execute("SELECT id, role FROM users").fetchall()
    for row in rows:
        normalized = _normalize_role(row["role"])
        if normalized != row["role"]:
            conn.execute("UPDATE users SET role = ? WHERE id = ?", (normalized, row["id"]))


def permissions_for_role(role: str) -> set[str]:
    return set(ROLE_PERMISSIONS.get(_normalize_role(role), set()))


def count_users() -> int:
    ensure_users_table()
    with _db.get_connection() as conn:
        return int(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] or 0)


def list_active_users_by_role() -> list[dict]:
    """Active users grouped by role, in Restricted-then-Public order, for the login picker."""
    users = [u for u in list_users() if int(u.get("is_active") or 0)]
    groups = []
    for role in ("restricted", "public"):
        role_users = [u for u in users if u["role"] == role]
        if role_users:
            groups.append({"role": role, "label": ROLE_LABELS[role], "users": role_users})
    return groups


def list_users() -> list[dict]:
    ensure_users_table()
    with _db.get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, username, role, created_at, is_active
            FROM users
            ORDER BY role, username
            """
        ).fetchall()
    users = [dict(row) for row in rows]
    for user in users:
        user["permissions"] = sorted(permissions_for_role(user["role"]))
    return users


def get_user_by_id(user_id: int | str | None) -> dict | None:
    if not user_id:
        return None
    ensure_users_table()
    with _db.get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, username, password_hash, role, created_at, is_active
            FROM users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
    return dict(row) if row else None


def get_user_by_username(username: str) -> dict | None:
    username = (username or "").strip()
    if not username:
        return None
    ensure_users_table()
    with _db.get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, username, password_hash, role, created_at, is_active
            FROM users
            WHERE lower(username) = lower(?)
            """,
            (username,),
        ).fetchone()
    return dict(row) if row else None


def get_user_permissions(user: dict | int | str | None) -> set[str]:
    if isinstance(user, dict):
        role = user.get("role", "")
    else:
        loaded = get_user_by_id(user) if user else None
        role = loaded.get("role", "") if loaded else ""
    return permissions_for_role(role)


def create_user(username: str, password: str, role: str, *, is_active: bool = True, replace: bool = False) -> dict:
    username = (username or "").strip()
    password = password or ""
    role = _normalize_role(role)
    if not username:
        raise ValueError("Username is required.")
    if len(password) < 4:
        raise ValueError("Password must be at least 4 characters.")

    ensure_users_table()
    password_hash = generate_password_hash(password)
    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    with _db.get_connection() as conn:
        if replace:
            conn.execute(
                """
                INSERT INTO users (username, password_hash, role, created_at, is_active)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(username) DO UPDATE SET
                    password_hash = excluded.password_hash,
                    role = excluded.role,
                    is_active = excluded.is_active
                """,
                (username, password_hash, role, now, 1 if is_active else 0),
            )
        else:
            conn.execute(
                """
                INSERT INTO users (username, password_hash, role, created_at, is_active)
                VALUES (?, ?, ?, ?, ?)
                """,
                (username, password_hash, role, now, 1 if is_active else 0),
            )
    user = get_user_by_username(username)
    if not user:
        raise RuntimeError("User was not created.")
    user.pop("password_hash", None)
    user["permissions"] = sorted(permissions_for_role(user["role"]))
    return user


def update_user(user_id: int | str, *, password: str | None = None, role: str | None = None, is_active: bool | None = None) -> dict:
    user = get_user_by_id(user_id)
    if not user:
        raise ValueError("User not found.")

    updates = []
    params = []
    if password is not None and password != "":
        if len(password) < 4:
            raise ValueError("Password must be at least 4 characters.")
        updates.append("password_hash = ?")
        params.append(generate_password_hash(password))
    if role is not None:
        updates.append("role = ?")
        params.append(_normalize_role(role))
    if is_active is not None:
        updates.append("is_active = ?")
        params.append(1 if is_active else 0)

    if updates:
        params.append(user_id)
        ensure_users_table()
        with _db.get_connection() as conn:
            conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)

    updated = get_user_by_id(user_id)
    if not updated:
        raise RuntimeError("User update failed.")
    updated.pop("password_hash", None)
    updated["permissions"] = sorted(permissions_for_role(updated["role"]))
    return updated


def verify_credentials(username: str, password: str) -> dict | None:
    user = get_user_by_username(username)
    if not user or not int(user.get("is_active") or 0):
        return None
    if not check_password_hash(user["password_hash"], password or ""):
        return None
    user.pop("password_hash", None)
    user["permissions"] = sorted(permissions_for_role(user["role"]))
    return user


def seed_initial_users_from_env() -> list[str]:
    """
    First-run seed from environment variables only.

    Set DASHBOARD_MANAGEMENT_PASSWORD and DASHBOARD_STAFF_PASSWORD before the
    first start to seed the restricted and public accounts respectively.
    Optional username overrides: DASHBOARD_MANAGEMENT_USERNAME and
    DASHBOARD_STAFF_USERNAME. (Env var names kept for backwards compatibility
    with existing deployments; they map to the restricted/public roles.)
    """
    ensure_users_table()
    created = []
    pairs = (
        ("restricted", os.environ.get("DASHBOARD_MANAGEMENT_USERNAME", "management"), os.environ.get("DASHBOARD_MANAGEMENT_PASSWORD")),
        ("public", os.environ.get("DASHBOARD_STAFF_USERNAME", "staff"), os.environ.get("DASHBOARD_STAFF_PASSWORD")),
    )
    for role, username, password in pairs:
        if not password:
            continue
        if get_user_by_username(username):
            continue
        create_user(username, password, role)
        created.append(f"{username} ({role})")
    return created


def ensure_default_users(default_password: str = "0000") -> list[str]:
    """
    Ensure the built-in restricted/public accounts exist.

    Existing accounts are left untouched so password changes made in Management
    persist across restarts.
    """
    created = []
    for role, username in (("restricted", "management"), ("public", "staff")):
        if get_user_by_username(username):
            continue
        create_user(username, default_password, role)
        created.append(f"{username} ({role})")
    return created
