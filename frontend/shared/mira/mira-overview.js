/*
 * MIRA Daily Maintenance Overview.
 *
 * An AI-assisted (rule-based fallback) daily report for PM Schedule, Downtime and
 * Spare Parts, built from verified backend KPIs (/api/mira/overview, /ai-summary).
 * Read-only: MIRA summarises and explains; it never edits any maintenance record.
 * MIRA never recommends or assigns severity (S1-S4); severity is only shown if it
 * already exists in the data.
 */
(function () {
    "use strict";

    const API = (window.MIRA_CONFIG && window.MIRA_CONFIG.apiBase) || "/api/mira";
    const MONTHS = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];

    let mounted = false;
    let loadToken = 0;
    let lastReport = null;          // verified data kept for "Copy report"

    const state = {
        periodMode: "ytd",          // default suits daily review (YTD-to-date data)
        year: String(new Date().getFullYear()),
        month: String(new Date().getMonth() + 1),
        stage: "all",
    };

    const refs = {};

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function mascot(size) {
        if (typeof window.getMiraMascotSvg === "function") return window.getMiraMascotSvg(size);
        return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
            <circle cx="32" cy="32" r="30" fill="#f7f2ed"/>
            <rect x="21" y="22" width="22" height="17" rx="8" fill="#243448"/>
            <circle cx="28" cy="30" r="2.4" fill="#64d9d4"/><circle cx="38" cy="30" r="2.4" fill="#64d9d4"/>
            <path d="M28 35c1.7 1.6 3.8 2.4 5.8 2.4 2 0 4-.8 5.6-2.3" fill="none" stroke="#9cebe6" stroke-width="2" stroke-linecap="round"/>
        </svg>`;
    }

    // ── period helpers ──────────────────────────────────────────────────────────
    function periodLabel() {
        const y = state.year;
        if (state.periodMode === "monthly") return `${MONTHS[Number(state.month) - 1]} ${y}`;
        if (state.periodMode === "full_year") return `Full Year ${y}`;
        if (state.periodMode === "financial_year") return `FY${y}`;
        return Number(y) === new Date().getFullYear() ? `YTD ${y}` : `Full Year ${y}`;
    }

    function stageLabel() {
        return state.stage === "stage1" ? "Stage 1" : state.stage === "stage2" ? "Stage 2" : "All stages";
    }

    function currentFilters() {
        return {
            year: state.year, stage: state.stage, period_mode: state.periodMode,
            month: state.periodMode === "monthly" ? state.month : null,
        };
    }

    function filtersBody() {
        return { filters: currentFilters() };
    }

    function num(value) {
        if (value === null || value === undefined) return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    // ── overall status (no severity logic) ──────────────────────────────────────
    function deriveStatus(data) {
        const wo = (data && data.work_orders) || {};
        const pm = (data && data.pm_schedule) || {};
        const dt = (data && data.downtime_summary) || {};
        const open = num(wo.open);
        const overdue = num(pm.overdue);
        const compliance = num(pm.compliance_pct);
        const missingAsset = num(dt.missing_asset_count);

        let score = 0;
        if (open !== null && open > 150) score += 2; else if (open !== null && open > 60) score += 1;
        if (overdue !== null && overdue > 200) score += 2; else if (overdue !== null && overdue > 30) score += 1;
        if (compliance !== null && compliance < 50) score += 2; else if (compliance !== null && compliance < 80) score += 1;
        if (missingAsset !== null && missingAsset > 20) score += 1;

        if (score >= 4) return { level: "Critical", tone: "critical" };
        if (score >= 2) return { level: "Attention", tone: "watch" };
        return { level: "Normal", tone: "good" };
    }

    function ruleBasedExecutive(data) {
        const wo = (data && data.work_orders) || {};
        const pm = (data && data.pm_schedule) || {};
        const dt = (data && data.downtime_summary) || {};
        const parts = [];
        const status = deriveStatus(data).level.toLowerCase();
        parts.push(`Maintenance status for ${periodLabel()} (${stageLabel()}) is ${status}.`);
        if (num(wo.total) !== null) {
            parts.push(`${fmt(wo.total)} MR were raised, with ${fmt(wo.closed)} closed/confirmed and ${fmt(wo.open)} still open or in progress`
                + (num(wo.closure_rate_pct) !== null ? ` (closure rate ${fmt(wo.closure_rate_pct)}%).` : "."));
        }
        if (num(pm.compliance_pct) !== null || num(pm.overdue) !== null) {
            parts.push(`PM compliance is ${fmt(pm.compliance_pct)}% with ${fmt(pm.overdue)} overdue PM tasks to follow up.`);
        }
        if (num(dt.preventive_count) !== null && num(dt.corrective_count) !== null) {
            parts.push(`Maintenance mix was ${fmt(dt.preventive_count)} preventive vs ${fmt(dt.corrective_count)} corrective MR.`);
        }
        return parts.join(" ");
    }

    function fmt(v) {
        if (v === null || v === undefined) return "unavailable";
        if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : String(v);
        return String(v);
    }

    // ── shell ───────────────────────────────────────────────────────────────────
    function renderShell(root) {
        root.innerHTML = "";
        const shell = el("div", "mira-ov-shell");
        shell.append(buildHeader(), buildControls(), buildBody());
        root.append(shell);
    }

    function buildHeader() {
        const head = el("header", "mira-ov-header");
        const brand = el("div", "mira-ov-brand");
        const logo = el("div", "mira-ov-logo");
        logo.innerHTML = mascot(46);
        const copy = el("div");
        copy.append(
            el("div", "mira-ov-eyebrow", "MIRA · Maintenance Intelligence"),
            el("h1", "mira-ov-title", "MIRA Daily Maintenance Overview"),
            el("p", "mira-ov-subtitle", "AI-assisted daily summary for PM schedule, downtime, and spare parts."),
        );
        brand.append(logo, copy);

        const right = el("div", "mira-ov-header-right");
        const meta = el("div", "mira-ov-meta");
        refs.metaGenerated = el("span", "mira-ov-meta-item", "Last generated: —");
        refs.metaPeriod = el("span", "mira-ov-meta-item", "Period: —");
        refs.metaStage = el("span", "mira-ov-meta-item", "Stage: —");
        refs.metaLlm = el("span", "mira-ov-chip mira-ov-chip-muted", "Checking AI mode…");
        meta.append(refs.metaGenerated, refs.metaPeriod, refs.metaStage, refs.metaLlm);

        const actions = el("div", "mira-ov-header-actions");
        const regen = el("button", "mira-ov-btn mira-ov-btn-primary", "Regenerate Summary");
        regen.type = "button";
        regen.addEventListener("click", () => loadOverview());
        const copyBtn = el("button", "mira-ov-btn mira-ov-btn-ghost", "Copy Report");
        copyBtn.type = "button";
        copyBtn.addEventListener("click", copyReport);
        refs.copyBtn = copyBtn;
        actions.append(regen, copyBtn);

        right.append(meta, actions);
        head.append(brand, right);
        return head;
    }

    function buildControls() {
        const wrap = el("section", "mira-ov-controls");
        const make = (label, options, value, onChange, disabled) => {
            const field = el("label", "mira-ov-field");
            field.append(el("span", "mira-ov-field-label", label));
            const sel = el("select", "mira-ov-select");
            options.forEach(([v, l]) => {
                const o = el("option", null, l); o.value = v; if (v === value) o.selected = true; sel.append(o);
            });
            sel.disabled = !!disabled;
            sel.addEventListener("change", () => { onChange(sel.value); loadOverview(); });
            field.append(sel);
            return { field, sel };
        };
        const period = make("Period", [["ytd", "YTD"], ["monthly", "Monthly"], ["full_year", "Full Year"], ["financial_year", "Financial Year"]],
            state.periodMode, (v) => { state.periodMode = v; if (refs.monthSel) refs.monthSel.disabled = v !== "monthly"; });
        const year = make("Year", [0, 1, 2].map((d) => { const y = String(new Date().getFullYear() - d); return [y, y]; }),
            state.year, (v) => { state.year = v; });
        const month = make("Month", MONTHS.map((m, i) => [String(i + 1), m]), state.month, (v) => { state.month = v; }, state.periodMode !== "monthly");
        refs.monthSel = month.sel;
        const stage = make("Stage", [["all", "All stages"], ["stage1", "Stage 1"], ["stage2", "Stage 2"]], state.stage, (v) => { state.stage = v; });
        wrap.append(period.field, year.field, month.field, stage.field);
        return wrap;
    }

    function buildBody() {
        const body = el("div", "mira-ov-body");
        body.append(buildStatusCard(), buildKpiGrid(), buildRecommendations(), buildDataUsedCard());
        return body;
    }

    function buildStatusCard() {
        const card = el("section", "mira-ov-status-card");
        const top = el("div", "mira-ov-status-top");
        refs.statusBadge = el("span", "mira-ov-status-badge", "Assessing…");
        refs.statusPeriod = el("span", "mira-ov-status-period", "");
        top.append(el("div", "mira-ov-status-label", "Overall Maintenance Status"), refs.statusBadge);
        const exec = el("div", "mira-ov-exec");
        refs.exec = el("p", "mira-ov-exec-text", "Loading verified maintenance data…");
        exec.append(refs.exec);
        const highlights = el("div", "mira-ov-highlights");
        refs.highlights = el("ul", "mira-ov-list");
        highlights.append(el("div", "mira-ov-mini-label", "Summary highlights"), refs.highlights);
        const actions = el("div", "mira-ov-actions-today");
        refs.actionsToday = el("ul", "mira-ov-list");
        actions.append(el("div", "mira-ov-mini-label", "Key actions required today"), refs.actionsToday);
        card.append(top, refs.statusPeriod, exec, el("div", "mira-ov-status-split", ""), highlights, actions);
        // place highlights + actions side by side
        const split = card.querySelector(".mira-ov-status-split");
        split.append(highlights, actions);
        return card;
    }

    function buildKpiGrid() {
        const grid = el("div", "mira-ov-kpi-grid");
        [["PM Schedule Summary", "pm", "teal"], ["Downtime / MR Summary", "downtime", "orange"], ["Spare Parts Summary", "spare", "blue"]]
            .forEach(([title, key, accent]) => {
                const card = el("section", `mira-ov-kpi-card mira-ov-accent-${accent}`);
                card.append(el("div", "mira-ov-kpi-title", title));
                const bodyEl = el("div", `mira-ov-kpi-body`); bodyEl.id = `mira-ov-kpi-${key}`;
                bodyEl.append(el("p", "mira-ov-muted", "Loading…"));
                card.append(bodyEl);
                grid.append(card);
            });
        return grid;
    }

    function buildRecommendations() {
        const card = el("section", "mira-ov-rec-card");
        card.append(el("div", "mira-ov-kpi-title", "AI Recommendations & Action List"));
        const grid = el("div", "mira-ov-rec-grid");
        [["Actions for today", "today"], ["Items to follow up", "followup"],
         ["Risks to monitor", "risks"], ["Data quality issues", "dq"]].forEach(([label, key]) => {
            const block = el("div", "mira-ov-rec-block");
            block.append(el("div", "mira-ov-mini-label", label));
            const ul = el("ul", "mira-ov-list"); ul.id = `mira-ov-rec-${key}`;
            ul.append(el("li", "mira-ov-muted", "Loading…"));
            block.append(ul);
            grid.append(block);
        });
        card.append(grid);
        return card;
    }

    function buildDataUsedCard() {
        const card = el("section", "mira-ov-data-card");
        const det = el("details", "mira-ov-details");
        det.append(el("summary", "mira-ov-kpi-title", "View Data Used"));
        const body = el("div"); body.id = "mira-ov-data-detail";
        det.append(body);
        card.append(det);
        return card;
    }

    // ── render helpers ──────────────────────────────────────────────────────────
    function setBody(id, node) {
        const host = document.getElementById(id);
        if (!host) return;
        host.innerHTML = "";
        host.append(node);
    }

    function renderList(node, items, emptyText, tone) {
        node.innerHTML = "";
        const arr = (items || []).filter(Boolean);
        if (!arr.length) { node.append(el("li", "mira-ov-muted", emptyText)); return; }
        arr.forEach((t) => node.append(el("li", tone === "warn" ? "mira-ov-warn" : null, String(t))));
    }

    function renderSection(id, section) {
        const host = document.getElementById(id);
        if (!host) return;
        host.innerHTML = "";
        if (!section || !Array.isArray(section.metrics) || !section.metrics.length) {
            host.append(el("p", "mira-ov-muted", "No data available for the selected period."));
            return;
        }
        const grid = el("div", "mira-ov-chip-grid");
        section.metrics.forEach((m) => {
            const chip = el("div", `mira-ov-kpi-chip mira-tone-${m.tone || "neutral"}`);
            chip.append(el("span", "mira-ov-chip-label", m.label), el("strong", "mira-ov-chip-value", m.value));
            if (m.note) chip.append(el("span", "mira-ov-chip-note", m.note));
            grid.append(chip);
        });
        host.append(grid);
    }

    // ── data loading ────────────────────────────────────────────────────────────
    function loadOverview() {
        const token = ++loadToken;
        window.MIRA_DASHBOARD_FILTERS = currentFilters();
        refs.metaPeriod.textContent = `Period: ${periodLabel()}`;
        refs.metaStage.textContent = `Stage: ${stageLabel()}`;
        refs.statusBadge.textContent = "Assessing…";
        refs.statusBadge.className = "mira-ov-status-badge";

        fetch(`${API}/overview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(filtersBody()) })
            .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
            .then((json) => { if (token === loadToken) renderVerified(json); })
            .catch((err) => { if (token === loadToken) renderError(err); });

        // AI wording (async, never blocks the verified cards).
        fetch(`${API}/ai-summary`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(filtersBody()) })
            .then((r) => r.ok ? r.json() : null).then((json) => { if (token === loadToken && json) renderAi(json); })
            .catch(() => { if (token === loadToken) setLlm("Rule-based fallback active", "muted"); });
    }

    function renderError(err) {
        const code = String(err && err.message ? err.message : "");
        const msg = code === "404"
            ? "MIRA Overview isn't loaded on the running backend yet — please restart the backend (run_server.cmd / python app.py)."
            : code.toLowerCase().includes("failed to fetch")
            ? "Can't reach the MIRA backend. Make sure the server is running (run_server.cmd / python app.py), then refresh."
            : `MIRA backend error (${code}). Please restart the backend and refresh.`;
        refs.statusBadge.textContent = "Backend unavailable";
        refs.statusBadge.className = "mira-ov-status-badge mira-ov-status-critical";
        if (refs.exec) refs.exec.textContent = msg;
        ["pm", "downtime", "spare"].forEach((k) => setBody(`mira-ov-kpi-${k}`, el("p", "mira-ov-muted", "No data available — backend unreachable.")));
    }

    function renderVerified(json) {
        const pres = (json && json.presentation) || {};
        const data = (json && json.data) || {};
        const vdu = pres.view_data_used || {};
        const sections = pres.sections || {};
        lastReport = { data, pres, label: periodLabel(), stage: stageLabel() };

        // Status
        const status = deriveStatus(data);
        refs.statusBadge.textContent = status.level;
        refs.statusBadge.className = `mira-ov-status-badge mira-ov-status-${status.tone}`;
        refs.statusPeriod.textContent = `Data period: ${vdu.period_label || periodLabel()}${vdu.date_range ? " · " + vdu.date_range : ""}`;
        refs.exec.textContent = ruleBasedExecutive(data);
        refs.metaGenerated.textContent = `Last generated: ${vdu.last_refreshed || new Date().toLocaleString()}`;
        if (json.provider_status) setLlm(json.provider_status.status || json.provider_status, json.provider_status.llm ? "good" : "muted");

        // Highlights + today's actions (rule-based, verified)
        renderList(refs.highlights, buildHighlights(data, sections), "No notable highlights for this period.");
        const todays = (pres.priority_follow_up || []).slice(0, 5);
        renderList(refs.actionsToday, todays, "No immediate actions required.");

        // KPI cards
        renderSection("mira-ov-kpi-pm", sections.pm_schedule_summary);
        renderSection("mira-ov-kpi-downtime", sections.downtime_work_order_summary);
        renderSection("mira-ov-kpi-spare", sections.spare_parts_summary);

        // Recommendations
        const warnings = (vdu.data_warnings || pres.data_notes || []);
        renderList(document.getElementById("mira-ov-rec-today"), todays, "No actions flagged today.");
        renderList(document.getElementById("mira-ov-rec-followup"), buildFollowUps(data), "Nothing outstanding to follow up.");
        renderList(document.getElementById("mira-ov-rec-risks"), buildRisks(data), "No elevated risks detected.");
        renderList(document.getElementById("mira-ov-rec-dq"), warnings, "No data quality issues.", "warn");

        renderDataUsed(vdu);
    }

    function buildHighlights(data, sections) {
        const wo = data.work_orders || {}; const pm = data.pm_schedule || {}; const dt = data.downtime_summary || {};
        const out = [];
        if (num(wo.total) !== null) out.push(`${fmt(wo.total)} MR raised; ${fmt(wo.open)} open, ${fmt(wo.closed)} closed (${fmt(wo.closure_rate_pct)}% closure).`);
        if (num(pm.compliance_pct) !== null) out.push(`PM compliance ${fmt(pm.compliance_pct)}% — ${fmt(pm.overdue)} overdue, ${fmt(pm.backlog)} backlog.`);
        if (num(dt.preventive_count) !== null) out.push(`Maintenance mix ${fmt(dt.preventive_count)} preventive / ${fmt(dt.corrective_count)} corrective.`);
        if (dt.top_functional_location_name) out.push(`Highest workload: ${dt.top_functional_location_name} (${fmt(dt.top_functional_location_count)} MR).`);
        if (dt.top_actual_machine_asset_name) out.push(`Top machine asset: ${dt.top_actual_machine_asset_name} (${fmt(dt.top_actual_machine_asset_count)} MR).`);
        return out.slice(0, 5);
    }

    function buildFollowUps(data) {
        const wo = data.work_orders || {}; const pm = data.pm_schedule || {};
        const out = [];
        if (num(wo.open)) out.push(`Review ${fmt(wo.open)} open / in-progress MR.`);
        if (num(pm.overdue)) out.push(`Action ${fmt(pm.overdue)} overdue PM tasks.`);
        if (num(pm.backlog)) out.push(`Clear ${fmt(pm.backlog)} PM backlog items.`);
        return out;
    }

    function buildRisks(data) {
        const dt = data.downtime_summary || {}; const pm = data.pm_schedule || {};
        const out = [];
        if (num(dt.corrective_count) !== null && num(dt.preventive_count) !== null && dt.corrective_count > dt.preventive_count) {
            out.push("Corrective work dominates the period — reactive maintenance load to monitor.");
        }
        if (num(pm.compliance_pct) !== null && pm.compliance_pct < 80) out.push(`PM compliance below target (${fmt(pm.compliance_pct)}%).`);
        if (dt.top_recorded_asset_is_placeholder) out.push("Highest-volume asset is a general area/placeholder — asset tagging needs review.");
        return out;
    }

    function renderDataUsed(vdu) {
        const host = document.getElementById("mira-ov-data-detail");
        if (!host) return;
        host.innerHTML = "";
        const grid = el("div", "mira-ov-data-grid");
        const block = (label, rows) => {
            const b = el("div", "mira-ov-data-block");
            b.append(el("div", "mira-ov-mini-label", label));
            const ul = el("ul", "mira-ov-list");
            (rows || []).forEach((r) => ul.append(el("li", null, typeof r === "string" ? r : `${r.label}: ${r.value}`)));
            if (!(rows || []).length) ul.append(el("li", "mira-ov-muted", "—"));
            b.append(ul); return b;
        };
        grid.append(
            block("Period mode / date range", [vdu.period_mode, vdu.date_range].filter(Boolean)),
            block("Source tables", vdu.source_tables),
            block("Filters applied", vdu.filters_applied),
            block("Rows loaded", vdu.rows_loaded),
            block("Rows after filter", vdu.rows_after_filter),
            block("KPI values used", vdu.kpi_values_used),
            block("Data warnings", vdu.data_warnings),
        );
        if (vdu.last_refreshed) host.append(el("p", "mira-ov-muted", `Last refreshed: ${vdu.last_refreshed}`));
        host.append(grid);
    }

    function renderAi(json) {
        const s = json && json.summary;
        if (!s) return;
        if (json.provider_status) setLlm(json.provider_status, json.llm_active ? "good" : "muted");
        if (s.executive_summary) refs.exec.textContent = s.executive_summary;
        if ((s.key_observations || []).length || s.main_concern) {
            const issues = [];
            if (s.main_concern) issues.push(`Main concern: ${s.main_concern}`);
            (s.key_observations || []).forEach((o) => issues.push(o));
            renderList(refs.highlights, issues, "");
        }
        if ((s.recommended_follow_up || []).length) {
            renderList(document.getElementById("mira-ov-rec-followup"), s.recommended_follow_up, "");
        }
    }

    function setLlm(text, tone) {
        if (!refs.metaLlm) return;
        refs.metaLlm.textContent = text || "Rule-based summary";
        refs.metaLlm.className = `mira-ov-chip mira-ov-chip-${tone === "good" ? "good" : "muted"}`;
    }

    // ── copy report ─────────────────────────────────────────────────────────────
    function copyReport() {
        if (!lastReport) return;
        const d = lastReport.data || {};
        const wo = d.work_orders || {}; const pm = d.pm_schedule || {}; const dt = d.downtime_summary || {}; const sp = d.spare_parts || {};
        const status = deriveStatus(d).level;
        const lines = [
            "Maintenance Daily Summary",
            `Period: ${lastReport.label}`,
            `Stage: ${lastReport.stage}`,
            `Overall Status: ${status}`,
            "",
            "PM Schedule:",
            `  Scheduled ${fmt(pm.total_scheduled)}, Completed ${fmt(pm.completed)}, Overdue ${fmt(pm.overdue)}, Backlog ${fmt(pm.backlog)}, Compliance ${fmt(pm.compliance_pct)}%`,
            "Downtime / MR:",
            `  Raised ${fmt(wo.total)}, Open ${fmt(wo.open)}, Closed ${fmt(wo.closed)}, Closure ${fmt(wo.closure_rate_pct)}%, Preventive/Corrective ${fmt(dt.preventive_count)}/${fmt(dt.corrective_count)}`,
            "Spare Parts:",
            `  In-stock items ${fmt(sp.current_in_stock_items)}, Top consumed ${fmt(sp.top_consumed_part)}`,
            "",
            "Actions Required:",
            ...buildFollowUps(d).map((x) => `  - ${x}`),
        ];
        const text = lines.join("\n");
        const done = () => { if (refs.copyBtn) { refs.copyBtn.textContent = "Copied ✓"; setTimeout(() => { refs.copyBtn.textContent = "Copy Report"; }, 1600); } };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
        } else { fallbackCopy(text, done); }
    }

    function fallbackCopy(text, done) {
        const ta = el("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.append(ta); ta.select();
        try { document.execCommand("copy"); done(); } catch (_e) { /* ignore */ } finally { ta.remove(); }
    }

    window.renderMiraOverview = function renderMiraOverview() {
        const root = document.getElementById("mira-overview-root");
        if (!root) return;
        if (!mounted) {
            renderShell(root);
            window.addEventListener("mira:provider-status", () => {
                const st = window.MIRA_PROVIDER_STATUS;
                if (st) setLlm(st.text, st.tone === "good" ? "good" : "muted");
            });
            mounted = true;
        }
        loadOverview();
    };
})();
