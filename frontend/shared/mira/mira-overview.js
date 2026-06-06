/*
 * MIRA Maintenance Intelligence Overview — the first dashboard page.
 *
 * Flow: render the page shell -> fetch /api/mira/overview (FAST, verified KPIs,
 * no LLM) and render cards immediately -> fetch /api/mira/ai-summary (async) and
 * fill in the AI wording. Numbers are always the verified backend values; the LLM
 * only writes prose. If Ollama is unavailable, the rule-based fallback is used.
 * Read-only.
 */
(function () {
    "use strict";

    const API = (window.MIRA_CONFIG && window.MIRA_CONFIG.apiBase) || "/api/mira";
    const MONTHS = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];

    let mounted = false;
    let loadToken = 0;
    const state = {
        periodMode: "ytd",                       // default: Year-to-Date
        year: String(new Date().getFullYear()),
        month: String(new Date().getMonth() + 1),
        stage: "all",
    };

    function periodLabel() {
        const y = state.year;
        if (state.periodMode === "monthly") return `${MONTHS[Number(state.month) - 1]} ${y}`;
        if (state.periodMode === "full_year") return `Full Year ${y}`;
        if (state.periodMode === "financial_year") return `FY${y}`;
        return Number(y) === new Date().getFullYear() ? `YTD ${y}` : `Full Year ${y}`;
    }

    // ── small safe DOM helpers (never inject data via innerHTML) ────────────────
    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    window.renderMiraOverview = function renderMiraOverview() {
        const root = document.getElementById("mira-overview-root");
        if (!root) return;
        if (!mounted) {
            renderShell(root);
            mounted = true;
        }
        loadOverview();
    };

    function renderShell(root) {
        root.innerHTML = "";
        const head = el("section", "mira-ov-head");
        const titleWrap = el("div");
        titleWrap.append(
            el("div", "mira-ov-eyebrow", "Daily maintenance summary generated from verified dashboard data"),
            el("h1", "mira-ov-title", "MIRA Maintenance Intelligence Overview"),
        );
        head.append(titleWrap, buildControls());
        root.append(head, buildStatusRow(), buildBody());
    }

    let monthSelRef = null;

    function buildControls() {
        const wrap = el("div", "mira-ov-controls");

        const modeSel = el("select", "mira-ov-select");
        [["ytd", "YTD"], ["monthly", "Monthly"], ["full_year", "Full Year"], ["financial_year", "Financial Year"]]
            .forEach(([v, l]) => { const o = el("option", null, l); o.value = v; modeSel.append(o); });
        modeSel.value = state.periodMode;
        modeSel.addEventListener("change", () => {
            state.periodMode = modeSel.value;
            if (monthSelRef) monthSelRef.disabled = state.periodMode !== "monthly";
            loadOverview();
        });

        const yearSel = el("select", "mira-ov-select");
        const nowYear = new Date().getFullYear();
        [nowYear, nowYear - 1, nowYear - 2].forEach((y) => {
            const o = el("option", null, String(y)); o.value = String(y); yearSel.append(o);
        });
        yearSel.value = state.year;
        yearSel.addEventListener("change", () => { state.year = yearSel.value; loadOverview(); });

        const monthSel = el("select", "mira-ov-select");
        MONTHS.forEach((m, i) => { const o = el("option", null, m); o.value = String(i + 1); monthSel.append(o); });
        monthSel.value = state.month;
        monthSel.disabled = state.periodMode !== "monthly";  // secondary unless Monthly
        monthSel.addEventListener("change", () => { state.month = monthSel.value; loadOverview(); });
        monthSelRef = monthSel;

        const stageSel = el("select", "mira-ov-select");
        [["all", "All Stages"], ["stage1", "Stage 1"], ["stage2", "Stage 2"]].forEach(([v, l]) => {
            const o = el("option", null, l); o.value = v; stageSel.append(o);
        });
        stageSel.value = state.stage;
        stageSel.addEventListener("change", () => { state.stage = stageSel.value; loadOverview(); });

        [["Period", modeSel], ["Year", yearSel], ["Month", monthSel], ["Stage", stageSel]].forEach(([label, sel]) => {
            const f = el("label", "mira-ov-field");
            f.append(el("span", null, label), sel);
            wrap.append(f);
        });
        return wrap;
    }

    function buildStatusRow() {
        const row = el("section", "mira-ov-status-row");
        row.id = "mira-ov-status-row";
        ["mira-ov-st-refresh", "mira-ov-st-period", "mira-ov-st-validation", "mira-ov-st-llm"]
            .forEach((id, i) => {
                const chip = el("div", "mira-ov-status-chip");
                chip.append(el("span", "mira-ov-status-label",
                    ["Last data refresh", "Selected period", "Data validation", "AI provider"][i]));
                const val = el("strong", "mira-ov-status-value", "…"); val.id = id;
                chip.append(val);
                row.append(chip);
            });
        return row;
    }

    function buildBody() {
        const body = el("div", "mira-ov-body");
        body.id = "mira-ov-body";
        body.append(card("Executive Summary", "mira-ov-exec"),
            sectionGrid(), card("Key Issues Detected", "mira-ov-issues"),
            card("Today's Follow-Up", "mira-ov-today"),
            card("Recommended Follow-Up (AI)", "mira-ov-followup"),
            card("Maintenance Risk Insight", "mira-ov-risk"),
            card("One-Line Management Summary", "mira-ov-oneline"),
            dataUsedCard());
        return body;
    }

    function card(title, bodyId) {
        const c = el("section", "mira-ov-card");
        c.append(el("div", "mira-ov-card-title", title));
        const b = el("div", "mira-ov-card-body"); b.id = bodyId;
        b.append(el("p", "mira-ov-muted", "Loading…"));
        c.append(b);
        return c;
    }

    function sectionGrid() {
        const grid = el("div", "mira-ov-section-grid");
        [["Downtime / MR Summary", "mira-ov-sec-downtime"],
         ["PM Schedule Summary", "mira-ov-sec-pm"],
         ["Spare Parts Summary", "mira-ov-sec-spare"]].forEach(([title, id]) => {
            const c = el("section", "mira-ov-card mira-ov-section-card");
            c.append(el("div", "mira-ov-card-title", title));
            const b = el("div", "mira-ov-section-body"); b.id = id;
            b.append(el("p", "mira-ov-muted", "Loading verified metrics…"));
            c.append(b);
            grid.append(c);
        });
        return grid;
    }

    function dataUsedCard() {
        const c = el("section", "mira-ov-card mira-ov-datacard");
        const det = el("details", "mira-ov-details");
        det.append(el("summary", "mira-ov-card-title", "View Data Used"));
        const b = el("div", "mira-ov-card-body"); b.id = "mira-ov-datadetail";
        det.append(b);
        c.append(det);
        return c;
    }

    function setBody(id, node) {
        const host = document.getElementById(id);
        if (!host) return;
        host.innerHTML = "";
        host.append(node);
    }

    function setText(id, text) {
        const n = document.getElementById(id);
        if (n) n.textContent = text;
    }

    // ── Data loading ────────────────────────────────────────────────────────────
    function filtersBody() {
        const filters = { year: state.year, stage: state.stage, period_mode: state.periodMode };
        filters.month = state.periodMode === "monthly" ? state.month : null;
        return { filters };
    }

    async function loadOverview() {
        const token = ++loadToken;
        // Expose the selected period/stage so the floating chat can inherit it (Step 11/12).
        window.MIRA_DASHBOARD_FILTERS = {
            year: state.year, stage: state.stage, period_mode: state.periodMode,
            month: state.periodMode === "monthly" ? state.month : null,
        };
        setText("mira-ov-st-period", periodLabel());
        setText("mira-ov-st-validation", "Validating…");
        setText("mira-ov-st-llm", "Checking…");
        // 1) FAST verified metrics + cards (no LLM).
        try {
            const res = await fetch(`${API}/overview`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(filtersBody()),
            });
            if (token !== loadToken) return;
            if (!res.ok) {
                const msg = res.status === 404
                    ? "MIRA Overview isn't loaded on the running server yet — please restart the backend (run_server.cmd / python app.py)."
                    : `MIRA backend error (${res.status}). Please restart the backend and refresh.`;
                setText("mira-ov-st-validation", res.status === 404 ? "Backend needs restart" : `Error ${res.status}`);
                ["mira-ov-exec", "mira-ov-sec-downtime", "mira-ov-sec-pm", "mira-ov-sec-spare"]
                    .forEach((id) => setBody(id, el("p", "mira-ov-muted", msg)));
                return;
            }
            renderVerified(await res.json());
        } catch (err) {
            if (token === loadToken) {
                setText("mira-ov-st-validation", "Backend not reachable");
                setBody("mira-ov-exec", el("p", "mira-ov-muted",
                    "Can't reach the MIRA backend. Make sure the server is running (run_server.cmd / python app.py), then refresh."));
            }
            return;
        }
        // 2) ASYNC maintenance risk insights (backend-scored).
        fetch(`${API}/risk`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(filtersBody()),
        }).then((r) => r.json()).then((json) => { if (token === loadToken) renderRisk(json); }).catch(() => {});

        // 3) ASYNC AI wording (Ollama or rule-based) — does not block the cards.
        try {
            const res = await fetch(`${API}/ai-summary`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(filtersBody()),
            });
            if (token !== loadToken) return;
            const json = await res.json();
            renderAi(json);
        } catch (err) {
            if (token === loadToken) setText("mira-ov-st-llm", "Rule-based fallback active");
        }
    }

    function renderRisk(risk) {
        if (!risk || !Array.isArray(risk.top_assets)) return;
        const wrap = el("div");
        wrap.append(el("p", null,
            `${risk.high_attention_count} High Attention · ${risk.medium_attention_count} Medium Attention `
            + `of ${risk.assets_assessed} assets assessed for ${risk.period}.`));
        if (risk.top_assets.length) {
            const ul = el("ul", "mira-ov-list");
            risk.top_assets.slice(0, 6).forEach((a) => {
                ul.append(el("li", null,
                    `${a.asset_name} — risk ${a.risk_score} (${a.risk_level}, ${a.mr_count} MR)`
                    + (a.is_placeholder ? " · general area/placeholder" : "")));
            });
            wrap.append(ul);
        }
        wrap.append(el("p", "mira-ov-muted", risk.note
            || "Risk is a follow-up signal, not a failure prediction."));
        setBody("mira-ov-risk", wrap);
    }

    function renderVerified(json) {
        const pres = json && json.presentation;
        const vdu = pres && pres.view_data_used;
        const status = json && json.provider_status;
        if (vdu && vdu.last_refreshed) setText("mira-ov-st-refresh", vdu.last_refreshed);
        const warnings = (vdu && vdu.data_warnings) || (pres && pres.data_notes) || [];
        setText("mira-ov-st-validation", warnings.length ? `${warnings.length} data warning(s)` : "Validated");
        if (status) setText("mira-ov-st-llm", status.status || "Rule-based summary");

        const sections = (pres && pres.sections) || {};
        renderSection("mira-ov-sec-downtime", sections.downtime_work_order_summary);
        renderSection("mira-ov-sec-pm", sections.pm_schedule_summary);
        renderSection("mira-ov-sec-spare", sections.spare_parts_summary);

        // Executive summary: start from the verified section summaries (rule-based);
        // the AI call replaces this with nicer prose if available.
        const execSeed = [sections.downtime_work_order_summary, sections.pm_schedule_summary,
            sections.spare_parts_summary].filter(Boolean).map((s) => s.summary).filter(Boolean)[0];
        setBody("mira-ov-exec", el("p", null, execSeed || "Verified metrics loaded. Generating summary…"));

        renderList("mira-ov-issues", warnings, "No data quality issues detected for this period.");
        // Today's Follow-Up = verified immediate actions (open MR, overdue PM, data quality).
        renderList("mira-ov-today", (pres && pres.priority_follow_up) || [], "No immediate follow-up items for this period.");
        setBody("mira-ov-followup", el("p", "mira-ov-muted", "Generating AI recommendations…"));
        setBody("mira-ov-risk", el("p", "mira-ov-muted",
            "Maintenance risk scoring (WO frequency, severity, recurrence, overdue PM, spare consumption) "
            + "will be shown here in a later phase. This is a placeholder, not a failure prediction."));
        setBody("mira-ov-oneline", el("p", null, "Generating one-line summary…"));
        renderDataUsed(vdu);
    }

    function renderSection(id, section) {
        if (!section) { setBody(id, el("p", "mira-ov-muted", "No data available.")); return; }
        const wrap = el("div");
        const chips = el("div", "mira-ov-chips");
        (section.metrics || []).forEach((m) => {
            const chip = el("div", `mira-ov-chip mira-tone-${m.tone || "neutral"}`);
            chip.append(el("span", "mira-ov-chip-label", m.label),
                el("strong", "mira-ov-chip-value", m.value));
            if (m.note) chip.append(el("span", "mira-ov-chip-note", m.note));
            chips.append(chip);
        });
        wrap.append(chips);
        if (section.summary) wrap.append(el("p", "mira-ov-sec-summary", section.summary));
        setBody(id, wrap);
    }

    function renderList(id, items, emptyText) {
        if (!items || !items.length) { setBody(id, el("p", "mira-ov-muted", emptyText)); return; }
        const ul = el("ul", "mira-ov-list");
        items.forEach((t) => ul.append(el("li", null, String(t))));
        setBody(id, ul);
    }

    function renderDataUsed(vdu) {
        if (!vdu) { setBody("mira-ov-datadetail", el("p", "mira-ov-muted", "No data-used detail.")); return; }
        const wrap = el("div", "mira-ov-datagrid");
        const block = (label, rows) => {
            const b = el("div", "mira-ov-datablock");
            b.append(el("div", "mira-ov-datalabel", label));
            const ul = el("ul", "mira-ov-list");
            (rows || []).forEach((r) => {
                if (typeof r === "string") { ul.append(el("li", null, r)); return; }
                ul.append(el("li", null, `${r.label}: ${r.value}`));
            });
            if (!(rows || []).length) ul.append(el("li", "mira-ov-muted", "—"));
            b.append(ul);
            return b;
        };
        wrap.append(
            block("Source tables", vdu.source_tables),
            block("Filters applied", vdu.filters_applied),
            block("Rows loaded", vdu.rows_loaded),
            block("Rows after filter", vdu.rows_after_filter),
            block("KPI values used", vdu.kpi_values_used),
            block("Data warnings", vdu.data_warnings),
        );
        const wrapOuter = el("div");
        if (vdu.last_refreshed) wrapOuter.append(el("p", "mira-ov-muted", `Last refreshed: ${vdu.last_refreshed}`));
        wrapOuter.append(wrap);
        setBody("mira-ov-datadetail", wrapOuter);
    }

    function renderAi(json) {
        const s = json && json.summary;
        if (!s) return;
        if (json.provider_status) setText("mira-ov-st-llm", json.provider_status);
        if (s.executive_summary) setBody("mira-ov-exec", el("p", null, s.executive_summary));
        if (s.one_line_summary) setBody("mira-ov-oneline", el("p", "mira-ov-oneline-text", s.one_line_summary));
        // Key issues = observations + concern; follow-up = AI follow-up.
        const issues = [];
        if (s.main_concern) issues.push(`Main concern: ${s.main_concern}`);
        (s.key_observations || []).forEach((o) => issues.push(o));
        (s.data_notes || []).forEach((n) => issues.push(n));
        if (issues.length) renderList("mira-ov-issues", issues, "");
        if ((s.recommended_follow_up || []).length) renderList("mira-ov-followup", s.recommended_follow_up, "");
        // Append Key Numbers Used under the exec card.
        if ((s.key_numbers_used || []).length) {
            const host = document.getElementById("mira-ov-exec");
            if (host) {
                const kn = el("div", "mira-ov-keynums");
                kn.append(el("div", "mira-ov-datalabel", "Key Numbers Used"));
                const ul = el("ul", "mira-ov-list");
                s.key_numbers_used.forEach((n) => ul.append(el("li", null, String(n))));
                kn.append(ul);
                host.append(kn);
            }
        }
    }
})();
