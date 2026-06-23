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
    let lastOverview = null;        // cached verified payload for duplicate-load guard
    let overviewAbort = null;
    let aiAbort = null;
    let inFlightSignature = "";
    let lastLoadSignature = "";
    let latestVerdict = null;
    let latestWarnings = [];
    let warmRetries = 0;            // first-load: backend still warming caches
    let warmRetryTimer = null;
    // The warming placeholder returns in ~10ms, so polling is cheap. A truly cold
    // first build (all source workbooks) can take a few minutes, so keep calmly
    // retrying for up to ~4 minutes before showing the soft "taking longer" notice.
    const WARM_RETRY_MAX = 60;
    const WARM_RETRY_DELAY_MS = 4000;

    const state = {
        periodMode: "ytd",          // default suits daily review (YTD-to-date data)
        year: String(new Date().getFullYear()),
        month: String(new Date().getMonth() + 1),
        stage: "all",
        activeTab: "overview",
    };

    const refs = {};
    const DEV_DEBUG = /^(localhost|127(?:\.\d+){3})$/i.test(window.location.hostname || "");

    function debugLog(event, details) {
        if (!DEV_DEBUG || !window.console || typeof window.console.debug !== "function") return;
        window.console.debug("[MIRA Overview]", event, details || {});
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
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

    function filtersSignature() {
        return JSON.stringify(currentFilters());
    }

    function num(value) {
        if (value === null || value === undefined) return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function uniqueStrings(items) {
        const seen = new Set();
        return (items || []).filter((item) => {
            const value = String(item || "").trim();
            if (!value || seen.has(value)) return false;
            seen.add(value);
            return true;
        });
    }

    function hasUsableMetric(value) {
        if (num(value) !== null) return true;
        if (typeof value !== "string") return false;
        const text = value.trim().toLowerCase();
        return !!text && text !== "unavailable" && text !== "not available";
    }

    function sectionHasUsableData(section) {
        if (!section || !Array.isArray(section.metrics)) return false;
        return section.metrics.some((metric) => hasUsableMetric(metric && metric.value));
    }

    function hasUsableOverviewData(data, sections) {
        const wo = (data && data.work_orders) || {};
        const pm = (data && data.pm_schedule) || {};
        const dt = (data && data.downtime_summary) || {};
        const spare = (data && data.spare_parts) || {};
        return [
            wo.total,
            wo.open,
            wo.closed,
            wo.total_active_workload,
            pm.total_scheduled,
            pm.compliance_pct,
            pm.overdue,
            pm.backlog,
            dt.total_work_orders,
            dt.total_active_workload,
            dt.preventive_count,
            dt.corrective_count,
            spare.current_in_stock_items,
            spare.current_in_stock_value,
            spare.total_issue_value,
        ].some((value) => num(value) !== null) || [
            sections.pm_schedule_summary,
            sections.downtime_work_order_summary,
            sections.spare_parts_summary,
        ].some(sectionHasUsableData);
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
        const actions = el("div", "mira-ov-header-actions");
        const regen = el("button", "mira-ov-btn mira-ov-btn-primary", "Regenerate Summary");
        regen.type = "button";
        regen.addEventListener("click", () => loadOverview({ force: true }));
        actions.append(regen);
        head.append(actions);
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
            sel.addEventListener("change", () => { onChange(sel.value); loadOverview({ force: true }); });
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
        body.append(
            buildStatusCard(),          // § 1
            buildKpiRow(),              // § 2
            buildPredictiveSection(),   // § 3 - Predictive Issue & Spare Parts Intelligence
            buildDataQualityAlertsSection(), // § 3 - Data Quality & Daily Action Alerts
            buildDataUsedCard(),        // § Bottom
        );
        return body;
    }

    function buildStatusCard() {
        const card = el("section", "mira-ov-status-card");
        const top = el("div", "mira-ov-status-top");
        refs.statusBadge = el("span", "mira-ov-status-badge", "Assessing…");
        refs.statusPeriod = el("span", "mira-ov-status-period", "");
        top.append(el("div", "mira-ov-status-label", "Overall Maintenance Status"), refs.statusBadge);

        // Headline KPI bar (4 cards)
        refs.headlineKpis = el("div", "mira-ov-headline-kpis");
        refs.headlineKpis.innerHTML = "<div class=\"mira-ov-skeleton mira-sk-line mira-sk-lg\"></div>";

        // Compact 3-line summary
        const compactSummary = el("div", "mira-ov-compact-summary");
        refs.summaryLine = [
            el("div", "mira-ov-summary-line mira-ov-sl-loading", "Loading verified data…"),
            el("div", "mira-ov-summary-line", ""),
            el("div", "mira-ov-summary-line", ""),
        ];
        refs.summaryLine.forEach(l => compactSummary.append(l));

        // Action table
        const actionSection = el("div", "mira-ov-action-section");
        actionSection.append(el("div", "mira-ov-mini-label", "Recommended Actions"));
        refs.actionTable = el("div", "mira-ov-act-tbl");
        refs.actionTable.innerHTML = "<div class=\"mira-ov-skeleton mira-sk-line mira-sk-md\"></div>";
        actionSection.append(refs.actionTable);

        // Hidden compat refs (populated for other render paths; not visible)
        const hidden = el("div"); hidden.hidden = true;
        refs.exec = el("p", "mira-ov-exec-text");
        refs.highlights = el("ul", "mira-ov-list");
        refs.actionsToday = el("ul", "mira-ov-list");
        hidden.append(refs.exec, refs.highlights, refs.actionsToday);

        card.append(top, refs.statusPeriod, refs.headlineKpis, compactSummary, actionSection, hidden);
        return card;
    }

    function renderHeadlineKpis(cards) {
        const host = refs.headlineKpis;
        if (!host) return;
        if (!cards || !cards.length) { host.innerHTML = ""; return; }
        host.innerHTML = "";
        cards.forEach(c => {
            const kpiCard = el("div", "mira-ov-headline-kpi mira-ov-hkpi-" + (c.tone || "neutral"));
            kpiCard.append(
                el("div", "mira-ov-hkpi-value", String(c.display != null ? c.display : (c.value != null ? c.value : "—"))),
                el("div", "mira-ov-hkpi-label", c.label || ""),
                el("div", "mira-ov-hkpi-note", c.note || ""),
            );
            host.append(kpiCard);
        });
    }

    function renderCompactSummary(data, status, pres) {
        if (!refs.summaryLine) return;
        const wo = data.work_orders || {};
        const pm = data.pm_schedule || {};
        const dt = data.downtime_summary || {};
        const actionItems = (pres && pres.action_items) || [];

        // Line 1: Main concern
        let concern = "";
        if (status.tone === "critical") concern = "Main concern: " + (status.level || "Critical issues flagged");
        else if ((wo.open || 0) > 20) concern = "Main concern: " + fmt(wo.open) + " open MRs outstanding";
        else if (num(pm.compliance_pct) !== null && pm.compliance_pct < 70) concern = "Main concern: PM compliance at " + fmt(pm.compliance_pct) + "%";
        else if ((dt.carry_over_open_mr || dt.opening_backlog_count || 0) > 30) concern = "Main concern: " + fmt(dt.carry_over_open_mr || dt.opening_backlog_count) + " carry-over MRs unresolved";
        else concern = "Status: " + (status.level || "Monitoring");
        refs.summaryLine[0].textContent = concern;
        refs.summaryLine[0].className = "mira-ov-summary-line mira-ov-sl-concern";

        // Line 2: Key reason
        let reason = "";
        if ((pm.overdue || 0) > 0 && (wo.open || 0) > 0) reason = "Key: " + fmt(wo.open) + " open MR + " + fmt(pm.overdue) + " overdue PM";
        else if (dt.top_functional_location_name) reason = "Key area: " + dt.top_functional_location_name;
        else reason = "Closure rate: " + fmt(wo.closure_rate_pct || dt.closure_rate_pct) + "%";
        refs.summaryLine[1].textContent = reason;
        refs.summaryLine[1].className = "mira-ov-summary-line mira-ov-sl-reason";

        // Line 3: Immediate action
        const topAction = actionItems[0];
        refs.summaryLine[2].textContent = topAction
            ? "Action: " + topAction.action
            : (wo.open || 0) > 0 ? "Action: Review " + fmt(wo.open) + " open MR" : "No immediate action flagged";
        refs.summaryLine[2].className = "mira-ov-summary-line mira-ov-sl-action";
    }

    function renderActionTable(items, fallbackStrings) {
        const host = refs.actionTable;
        if (!host) return;
        host.innerHTML = "";
        if (!items || !items.length) {
            const fb = (fallbackStrings || []).slice(0, 5);
            if (!fb.length) { host.innerHTML = "<p class=\"mira-ov-muted\">No actions required.</p>"; return; }
            const ul = el("ul", "mira-ov-list"); fb.forEach(s => ul.append(el("li", null, s))); host.append(ul);
            return;
        }
        items.forEach(item => {
            const row = el("div", "mira-ov-act-row");
            const prio = (item.priority || "Low").toLowerCase();
            row.append(
                el("span", "mira-ov-act-priority mira-ov-act-prio-" + prio, item.priority || ""),
                (() => { const t = el("div", "mira-ov-act-text"); t.append(el("div", "mira-ov-act-action", item.action || "")); if (item.reason) t.append(el("div", "mira-ov-act-reason", item.reason)); return t; })(),
            );
            host.append(row);
        });
    }

    // ── § 2  Compact KPI row (PM / Downtime / Spare Parts) ───────────────────
    function buildKpiRow() {
        const sec = el("section", "mira-ov-kpi-row-section");
        sec.append(el("div", "mira-ov-section-label", "Management KPI Overview"));
        const grid = el("div", "mira-ov-kpi-row");
        [["PM Schedule", "pm", "teal", "PM"], ["Downtime", "downtime", "orange", "DT"], ["Spare Parts", "spare", "blue", "SP"]]
            .forEach(([title, key, accent, icon]) => {
                const card = el("section", `mira-ov-kpi-card mira-ov-accent-${accent}`);
                const head = el("div", "mira-ov-kpi-head");
                head.append(el("div", "mira-ov-kpi-title", title), el("span", "mira-ov-card-icon", icon));
                card.append(head);
                const body = el("div", "mira-ov-kpi-body"); body.id = `mira-ov-kpi-${key}`;
                body.append(el("p", "mira-ov-muted", "Loading…"));
                // Hidden duplicate IDs (kept for renderSection compatibility with detail IDs)
                const shadow = el("div"); shadow.id = `mira-ov-detail-${key}`; shadow.hidden = true;
                card.append(body, shadow);
                grid.append(card);
            });
        sec.append(grid);
        return sec;
    }

    // ── § 3  Predictive Issue & Spare Parts Intelligence ─────────────────────

    function buildPredictiveSection() {
        const sec = el("section", "mira-ov-pred-section");
        sec.append(el("div", "mira-ov-section-label", "Predictive Issue & Asset Parts Intelligence"));
        sec.append(el("p", "mira-ov-pred-subtitle",
            "Evidence-based issue trends by machine group using repeated MR/WO symptoms, MTBF signals, and verified spare-parts history."));
        sec.append(el("p", "mira-ov-disclaimer",
            "AI-classified for review only. MIRA never assigns severity. Escalation flags are candidates only. Spare recommendations are based only on available spare parts and purchase history."));
        const catsWrap = el("div", "mira-pred-cats-wrap");
        catsWrap.id = "mira-pred-cats-body";
        catsWrap.innerHTML = "<div class=\"mira-ov-skeleton mira-sk-line mira-sk-lg\" style=\"height:120px\"></div>";
        sec.append(catsWrap);
        const bottomRow = el("div", "mira-pred-bottom-row");
        const card2 = el("div", "mira-ov-pred-card");
        card2.id = "mira-pred-card2";
        card2.append(el("div", "mira-ov-pred-card-title", "Dominant Fault Pattern"));
        const card2Body = el("div");
        card2Body.id = "mira-pred-fault-body";
        card2Body.innerHTML = "<div class=\"mira-ov-skeleton mira-sk-line mira-sk-md\"></div>";
        card2.append(card2Body);
        const card4 = el("div", "mira-ov-pred-card mira-ov-pred-card-confidence");
        card4.id = "mira-pred-card4";
        card4.append(el("div", "mira-ov-pred-card-title", "Data Confidence"));
        const card4Body = el("div");
        card4Body.id = "mira-pred-confidence-body";
        card4Body.innerHTML = "<div class=\"mira-ov-skeleton mira-sk-line mira-sk-sm\"></div>";
        card4.append(card4Body);
        bottomRow.append(card2, card4);
        sec.append(bottomRow);
        return sec;
    }

    let predictiveAbort = null;
    let predictiveCategoryView = "Production Equipment";
    let predictiveLatestPayload = null;

    function loadPredictive() {
        const catsBody = document.getElementById("mira-pred-cats-body");
        const faultBody = document.getElementById("mira-pred-fault-body");
        const confBody = document.getElementById("mira-pred-confidence-body");
        if (catsBody) catsBody.innerHTML = "<div class=\"mira-ov-skeleton mira-sk-line mira-sk-lg\" style=\"height:100px\"></div>";
        if (faultBody) faultBody.innerHTML = "<div class=\"mira-ov-skeleton mira-sk-line mira-sk-md\"></div>";
        if (confBody) confBody.innerHTML = "<div class=\"mira-ov-skeleton mira-sk-line mira-sk-sm\"></div>";
        if (predictiveAbort) predictiveAbort.abort();
        const req = fetchJsonWithTimeout(
            API + "/predictive",
            { method: "POST", headers: { "Content-Type": "application/json" },
              cache: "no-store", body: JSON.stringify(filtersBody()) },
            30000
        );
        predictiveAbort = req.controller;
        req.promise
            .then(function(json) { if (json && json.data) renderPredictive(json.data); })
            .catch(function(err) {
                if (err && err.name === "AbortError") return;
                if (catsBody) catsBody.innerHTML = "<p class=\"mira-ov-muted\">Predictive insights unavailable.</p>";
            });
    }

    function renderPredictive(d) {
        if (!d) return;
        _renderPredCategories(d);
        _renderPredFault(d);
        _renderPredConfidence(d);
    }

    function _trendIcon(trend) {
        if (trend === "up")   return "<span class=\"mira-pred-trend mira-pred-trend-up\" title=\"Increasing\">↑</span>";
        if (trend === "down") return "<span class=\"mira-pred-trend mira-pred-trend-down\" title=\"Decreasing\">↓</span>";
        if (trend === "new")  return "<span class=\"mira-pred-trend mira-pred-trend-new\" title=\"New in period\">NEW</span>";
        return "<span class=\"mira-pred-trend mira-pred-trend-flat\" title=\"Stable\">→</span>";
    }

    function _issuePillClass(issue) {
        var i = (issue || "").toLowerCase();
        if (i.indexOf("steam") >= 0 || i.indexOf("leak") >= 0)  return "mira-pred-pill-leak";
        if (i.indexOf("water") >= 0 || i.indexOf("drain") >= 0 || i.indexOf("plumb") >= 0) return "mira-pred-pill-water";
        if (i.indexOf("heat") >= 0 || i.indexOf("temp") >= 0)   return "mira-pred-pill-heat";
        if (i.indexOf("electric") >= 0 || i.indexOf("sensor") >= 0 || i.indexOf("led") >= 0 || i.indexOf("light") >= 0) return "mira-pred-pill-elec";
        if (i.indexOf("noise") >= 0 || i.indexOf("vibrat") >= 0 || i.indexOf("bearing") >= 0 || i.indexOf("motor") >= 0) return "mira-pred-pill-noise";
        if (i.indexOf("panel") >= 0 || i.indexOf("door") >= 0 || i.indexOf("window") >= 0) return "mira-pred-pill-panel";
        if (i.indexOf("struct") >= 0 || i.indexOf("floor") >= 0 || i.indexOf("roof") >= 0 || i.indexOf("ceiling") >= 0) return "mira-pred-pill-struct";
        return "mira-pred-pill-default";
    }

    function _formatPredictiveDate(value) {
        return value ? String(value).slice(0, 10) : "—";
    }

    function _formatPredictiveQty(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return "—";
        return Number.isInteger(n)
            ? n.toLocaleString()
            : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }

    function _formatPredictiveMoney(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return "—";
        return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    function _stockTone(status) {
        var text = String(status || "").toLowerCase();
        if (text.indexOf("in stock") >= 0) return "in";
        if (text.indexOf("not in stock") >= 0 || text.indexOf("out") >= 0) return "out";
        return "unknown";
    }

    function _confidenceTone(value) {
        var conf = String(value || "").toLowerCase();
        if (conf === "high") return "high";
        if (conf === "medium") return "medium";
        return "low";
    }

    function _buildStockBadge(status) {
        return el("span", "mira-pred-stock-badge mira-pred-stock-" + _stockTone(status), status || "Unknown");
    }

    function _buildConfidenceBadge(value) {
        return el("span", "mira-pred-confidence-badge mira-pred-confidence-" + _confidenceTone(value), value || "Low");
    }

    function _buildPredictiveDetailBlock(title, content) {
        var block = el("div", "mira-pred-detail-block");
        block.append(el("div", "mira-pred-detail-label", title));
        if (typeof content === "string") {
            block.append(el("div", "mira-pred-detail-value", content || "—"));
        } else if (content) {
            block.append(content);
        } else {
            block.append(el("div", "mira-pred-detail-value", "—"));
        }
        return block;
    }

    function _buildSpareStatsPanel(m) {
        var parts = m.suggested_spare_parts || m.spare_parts || [];
        var wrap = el("div", "mira-pred-spare-panel");
        wrap.append(_buildPredictiveDetailBlock("Recommendation Basis",
            m.spare_recommendation_basis || "Review available spare records only."));
        if (!parts.length) {
            wrap.append(el("p", "mira-pred-empty-note",
                "No confirmed spare part found. Manual review required."));
            return wrap;
        }
        var ov = el("div", "mira-pred-spare-ov");
        ov.textContent = parts.length + " confirmed spare part" + (parts.length !== 1 ? "s" : "") +
            " · " + (m.spare_linked_transaction_count || 0) + " linked store transaction" +
            ((m.spare_linked_transaction_count || 0) !== 1 ? "s" : "") +
            " · " + (m.spare_linked_wo_count || 0) + " related WO" +
            ((m.spare_linked_wo_count || 0) !== 1 ? "s" : "");
        wrap.append(ov);
        var tbl = document.createElement("table");
        tbl.className = "mira-pred-spare-tbl";
        var thead = document.createElement("thead");
        var hrow = document.createElement("tr");
        ["Suggested Spare Part", "Source", "Stock", "Qty / History", "Latest Activity", "Est. Value"].forEach(function(h) {
            hrow.appendChild(el("th", null, h));
        });
        thead.appendChild(hrow);
        tbl.appendChild(thead);
        var tbody = document.createElement("tbody");
        parts.forEach(function(p) {
            var tr = document.createElement("tr");
            var qtyBits = [];
            if (p.current_quantity != null) qtyBits.push("On hand " + _formatPredictiveQty(p.current_quantity));
            if (p.usage_rows) qtyBits.push(p.usage_rows + " usage");
            if (p.purchase_rows) qtyBits.push(p.purchase_rows + " PO");
            var latestActivity = [p.last_used, p.last_purchase_date]
                .filter(function(value) { return !!value; })
                .sort()
                .slice(-1)[0];

            // Description cell — label + evidence tag chips
            var descCell = document.createElement("td");
            descCell.className = "mira-pred-spare-desc";
            descCell.appendChild(document.createTextNode(p.label || p.item_code || "—"));
            var evTags = p.evidence_tags || [];
            if (evTags.length) {
                var tagWrap = el("div", "mira-pred-ev-tags");
                evTags.forEach(function(tag) {
                    tagWrap.appendChild(el("span", "mira-pred-ev-tag", tag));
                });
                descCell.appendChild(tagWrap);
            }

            // Source cell — source label + PO traceability sub-text
            var sourceCell = document.createElement("td");
            sourceCell.className = "mira-pred-spare-source";
            sourceCell.appendChild(document.createTextNode(p.source || "—"));
            var poDetails = [];
            if (p.last_po_no) poDetails.push("PO: " + p.last_po_no);
            if (p.po_vendor) poDetails.push(p.po_vendor);
            if (p.po_stage) poDetails.push(p.po_stage);
            if (p.machine_detection_confidence && p.machine_detection_confidence !== "High") {
                poDetails.push(p.machine_detection_confidence + " confidence");
            }
            if (poDetails.length) {
                sourceCell.appendChild(el("div", "mira-pred-spare-po-detail", poDetails.join(" · ")));
            }

            var stockTd = document.createElement("td");
            stockTd.append(_buildStockBadge(p.stock_status));
            [
                descCell,
                sourceCell,
                stockTd,
                el("td", "mira-pred-spare-history", qtyBits.join(" · ") || "—"),
                el("td", null, _formatPredictiveDate(latestActivity)),
                el("td", null, _formatPredictiveMoney(p.estimated_value)),
            ].forEach(function(td) { tr.appendChild(td); });
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        wrap.append(tbl);
        return wrap;
    }

    function _buildIssuePanel(m) {
        var wrap = el("div", "mira-pred-issue-panel");

        // Recurrence pattern detail block
        var recRows = [];
        var clusterDate = m.cluster_last_occurrence || m.last_occurrence;
        if (clusterDate) recRows.push(["Latest occurrence (this issue)", _formatPredictiveDate(clusterDate)]);
        if (m.recurrence_interval_days != null) recRows.push(["Typical interval (median)", "~" + m.recurrence_interval_days + "d"]);
        if (m.recurrence_interval_avg_days != null) recRows.push(["Average interval", "~" + m.recurrence_interval_avg_days + "d"]);
        if (m.mtbf_days != null) recRows.push(["All-issue MTBF", "~" + m.mtbf_days + "d"]);
        var dueLbl = m.likely_recurrence_label || m.recurrence_gauge;
        if (dueLbl && !/not enough history|insufficient/i.test(dueLbl)) {
            recRows.push(["Recurrence timing", dueLbl]);
        }
        if (m.recurrence_interval_n != null && m.dominant_count != null) {
            recRows.push(["Based on", m.recurrence_interval_n + " intervals from " + m.dominant_count + " cluster records"]);
        }
        if (recRows.length) {
            var recDetail = el("div", "mira-pred-recurrence-detail");
            recDetail.append(el("div", "mira-pred-issue-others-title", "Recurrence pattern"));
            var recTbl = document.createElement("table");
            recTbl.className = "mira-pred-rec-tbl";
            var recBody = document.createElement("tbody");
            recRows.forEach(function(pair) {
                var tr = document.createElement("tr");
                tr.appendChild(el("td", "mira-pred-rec-lbl", pair[0]));
                tr.appendChild(el("td", "mira-pred-rec-val", pair[1]));
                recBody.appendChild(tr);
            });
            recTbl.appendChild(recBody);
            recDetail.append(recTbl);
            recDetail.append(el("p", "mira-pred-nextdue-basis", "Likely recurrence window based on historical issue pattern. Not a confirmed prediction."));
            wrap.append(recDetail);
        }

        var summaryGrid = el("div", "mira-pred-issue-summary-grid");
        summaryGrid.append(
            _buildPredictiveDetailBlock("Main Observed Issue", m.main_observed_issue || m.recurring_issue || "—"),
            _buildPredictiveDetailBlock("Evidence", m.evidence_summary || "—"),
            _buildPredictiveDetailBlock("Likely Cause Candidate", m.likely_cause_candidate || "—")
        );
        var confBlock = el("div", "mira-pred-detail-block");
        confBlock.append(el("div", "mira-pred-detail-label", "Confidence"));
        var confWrap = el("div", "mira-pred-detail-stack");
        confWrap.append(_buildConfidenceBadge(m.confidence));
        confWrap.append(el("div", "mira-pred-detail-value mira-pred-detail-muted",
            m.confidence_reason || "Review trend evidence before acting."));
        confBlock.append(confWrap);
        summaryGrid.append(confBlock);
        wrap.append(summaryGrid);

        if (m.escalation && m.escalation.triggered) {
            var escNote = el("div", "mira-pred-escalation-callout");
            escNote.append(el("div", "mira-pred-escalation-title", "Escalation candidate only"));
            escNote.append(el("p", "mira-pred-escalation-copy",
                (m.escalation.reason || "Repeated issue trend detected.") + " Review required before any escalation."));
            wrap.append(escNote);
        }

        var symptomTerms = uniqueStrings(m.symptom_keywords || []);
        if (symptomTerms.length) {
            var symptomWrap = el("div", "mira-pred-inline-block");
            symptomWrap.append(el("div", "mira-pred-inline-label", "Repeated symptom keywords"));
            var chips = el("div", "mira-pred-chip-row");
            symptomTerms.forEach(function(term) {
                chips.append(el("span", "mira-pred-issue-chip", term));
            });
            symptomWrap.append(chips);
            wrap.append(symptomWrap);
        }

        var noteSnippets = uniqueStrings(m.note_snippets || []);
        if (noteSnippets.length) {
            var notesWrap = el("div", "mira-pred-inline-block");
            notesWrap.append(el("div", "mira-pred-inline-label", "Repeated technical notes"));
            var noteList = el("div", "mira-pred-chip-row");
            noteSnippets.forEach(function(note) {
                noteList.append(el("span", "mira-pred-note-chip", note));
            });
            notesWrap.append(noteList);
            wrap.append(notesWrap);
        }

        var bd = m.issue_breakdown || [];
        var others = bd.filter(function(b) { return b.issue !== m.recurring_issue; }).slice(0, 3);
        if (others.length) {
            wrap.append(el("div", "mira-pred-issue-others-title", "Other detected issue clusters"));
            var otherChips = el("div", "mira-pred-issue-others");
            others.forEach(function(b) {
                otherChips.append(el("span", "mira-pred-issue-chip", b.issue + " (" + b.count + "x)"));
            });
            wrap.append(otherChips);
        }

        var ev = m.issue_evidence || [];
        if (ev.length) {
            wrap.append(el("div", "mira-pred-issue-ev-title", "Recent evidence"));
            var tbl = document.createElement("table");
            tbl.className = "mira-pred-issue-ev-tbl";
            var tbody = document.createElement("tbody");
            ev.forEach(function(e) {
                var tr = document.createElement("tr");
                var ref = e.mr_id || e.wo_id || "—";
                tr.appendChild(el("td", "mira-pred-issue-ev-ref", ref));
                tr.appendChild(el("td", "mira-pred-issue-ev-date", _formatPredictiveDate(e.date)));
                var descCell = document.createElement("td");
                descCell.className = "mira-pred-issue-ev-desc";
                descCell.appendChild(document.createTextNode(e.description || "—"));
                if (e.translated_description && e.translated_description !== e.description) {
                    var transEl = el("div", "mira-pred-issue-ev-trans", e.translated_description);
                    descCell.appendChild(transEl);
                }
                tr.appendChild(descCell);
                tbody.appendChild(tr);
            });
            tbl.appendChild(tbody);
            wrap.append(tbl);
        }

        if (!others.length && !ev.length && !symptomTerms.length && !noteSnippets.length) {
            wrap.append(el("p", "mira-ov-muted", "No additional issue detail beyond the current summary."));
        }
        return wrap;
    }

    function _buildMachineRow(m) {
        var rowWrap = el("div", "mira-pred-mg-rowwrap");
        var main = el("div", "mira-pred-mg-row");

        var rankCell = el("div", "mira-pred-mg-rankcol");
        rankCell.append(el("span", "mira-pred-rank-pill", "#" + m.rank));
        var trendWrap = el("span", "mira-pred-machine-trend");
        trendWrap.innerHTML = _trendIcon(m.trend);
        rankCell.append(trendWrap);

        var machineCell = el("div", "mira-pred-mg-machine");
        var machineHead = el("div", "mira-pred-machine-head");

        // Display name: prefer confirmed/inferred group over raw area-level label
        var rawGroup = m.specific_machine_group || m.machine_group || m.machine_type || "—";
        var inferredGroup = m.inferred_machine_group;
        var infSrc = m.inference_source || "";
        var showInferred = inferredGroup && infSrc !== "area_level" && inferredGroup !== rawGroup;

        var nameEl = el("div", "mira-pred-machine-name");
        if (showInferred) {
            if (infSrc === "manual_override") {
                nameEl.textContent = inferredGroup;
            } else {
                var likelySpan = el("span", "mira-pred-inferred-prefix", "Likely: ");
                nameEl.append(likelySpan);
                nameEl.append(document.createTextNode(inferredGroup));
            }
        } else {
            nameEl.textContent = rawGroup;
        }
        machineHead.append(nameEl);

        if (m.needs_manual_review) {
            machineHead.append(el("span", "mira-pred-review-badge", "Review required"));
        }
        machineCell.append(machineHead);

        var machineMetaBits = [];
        if (m.main_system) machineMetaBits.push("System: " + m.main_system);
        if (m.group_match_confidence) machineMetaBits.push(m.group_match_confidence + " mapping");
        if (infSrc === "ollama_description") {
            machineMetaBits.push("Ollama · " + (m.inference_confidence || "?").toLowerCase() + " conf.");
        } else if (infSrc === "manual_override") {
            machineMetaBits.push("Confirmed");
        }
        machineCell.append(el("div", "mira-pred-machine-meta", machineMetaBits.join(" · ") || "—"));

        if (infSrc === "ollama_description" && (inferredGroup || m.inference_reason)) {
            var infSub = el("div", "mira-pred-machine-infsub");
            var subParts = ["Detected from MR description"];
            if (m.original_asset_names && m.original_asset_names.length) {
                subParts.push("Original asset: " + m.original_asset_names[0]);
            }
            infSub.textContent = subParts.join(" · ");
            if (m.inference_reason) infSub.title = m.inference_reason;
            machineCell.append(infSub);
        }

        var issueCell = el("div", "mira-pred-mg-issue");
        issueCell.append(el("div", "mira-pred-main-issue", m.main_observed_issue || m.recurring_issue || "—"));
        var issueMeta = el("div", "mira-pred-main-issue-meta");
        if (m.recurring_issue) {
            var issuePill = el("span", "mira-pred-issue-pill " + _issuePillClass(m.recurring_issue), m.recurring_issue);
            var iconf = m.recurring_issue_confidence;
            if (iconf && iconf !== "High") {
                issuePill.append(el("span", "mira-pred-issue-conf mira-pred-issue-conf-" + iconf.toLowerCase(), iconf === "Low" ? " ?" : " ~"));
                issuePill.title = (iconf === "Low" ? "Low confidence — " : "Medium confidence — ") +
                    (m.recurring_issue_reason || "derived from clustered descriptions");
            }
            issueMeta.append(issuePill);
        }
        if (m.escalation && m.escalation.triggered) {
            issueMeta.append(el("span", "mira-pred-escalation-flag", "Escalation candidate"));
        }
        issueCell.append(issueMeta);

        // MR Count column
        var countCell = el("div", "mira-pred-mg-count");
        var cnt = m.mr_count || m.dominant_count || 0;
        countCell.append(el("div", "mira-pred-count-num", String(cnt)));
        countCell.append(el("div", "mira-pred-count-lbl", "MR"));

        var assetsCell = el("div", "mira-pred-mg-assets");
        var relatedAssets = m.related_assets || [];
        if (m.is_area_level) {
            if (m.original_asset_names && m.original_asset_names.length) {
                assetsCell.append(el("div", "mira-pred-detail-muted",
                    "Original: " + m.original_asset_names.join(", ")));
            } else {
                assetsCell.append(el("div", "mira-pred-detail-muted", "Area-level MR / machine not specified"));
            }
        } else if (relatedAssets.length) {
            relatedAssets.slice(0, 3).forEach(function(asset) {
                assetsCell.append(el("span", "mira-pred-asset-chip",
                    (asset.asset_name || "Asset") + (asset.mr_count ? " (" + asset.mr_count + ")" : "")));
            });
        } else if (m.asset_count) {
            assetsCell.append(el("div", "mira-pred-detail-muted", m.asset_count + " related asset" + (m.asset_count === 1 ? "" : "s")));
        } else {
            assetsCell.append(el("div", "mira-pred-detail-muted", "No specific asset listed"));
        }

        // Recurrence Timing column — rough future-facing bands only, no exact dates.
        var nextDueCell = el("div", "mira-pred-mg-nextdue");
        var dueLabel = m.recurrence_gauge || m.likely_recurrence_label || "Not enough history";
        var dueTone = "";
        if (/recurring pattern active/i.test(dueLabel))       dueTone = " mira-pred-nextdue-active";
        else if (/within days/i.test(dueLabel))               dueTone = " mira-pred-nextdue-soon";
        else if (/within 1 week/i.test(dueLabel))             dueTone = " mira-pred-nextdue-soon";
        else if (/within 2 weeks/i.test(dueLabel))            dueTone = " mira-pred-nextdue-month";
        else if (/within 1 month/i.test(dueLabel))            dueTone = " mira-pred-nextdue-month";
        else if (/not enough history|insufficient/i.test(dueLabel)) dueTone = " mira-pred-nextdue-unknown";
        nextDueCell.append(el("div", "mira-pred-nextdue-label" + dueTone, dueLabel));
        nextDueCell.append(el("div", "mira-pred-nextdue-basis", "Based on repeated MR/WO pattern"));

        var confidenceCell = el("div", "mira-pred-mg-confidence");
        confidenceCell.append(_buildConfidenceBadge(m.confidence));
        confidenceCell.append(el("div", "mira-pred-confidence-copy",
            m.confidence_reason || "Review issue history and parts evidence."));
        // Compact stock badge inline under confidence (saves a full column)
        if (m.stock_status) {
            var stockInline = el("div", "mira-pred-stock-inline");
            stockInline.append(_buildStockBadge(m.stock_status));
            confidenceCell.append(stockInline);
        }

        var toggleWrap = el("div", "mira-pred-mg-toggle");
        var panelsWrap = el("div", "mira-pred-panels-wrap");

        var issueToggleBtn = el("button", "mira-pred-toggle-btn", "View Issues");
        issueToggleBtn.type = "button";
        var issuePanel = null;
        var issueOpen = false;
        issueToggleBtn.addEventListener("click", function() {
            issueOpen = !issueOpen;
            issueToggleBtn.textContent = issueOpen ? "Hide Issues" : "View Issues";
            if (issueOpen && !issuePanel) {
                issuePanel = _buildIssuePanel(m);
                panelsWrap.append(issuePanel);
            }
            if (issuePanel) issuePanel.style.display = issueOpen ? "block" : "none";
        });
        toggleWrap.append(issueToggleBtn);

        var spareToggleBtn = el("button", "mira-pred-toggle-btn mira-pred-toggle-btn-secondary", "View Spare Parts");
        spareToggleBtn.type = "button";
        var sparePanel = null;
        var spareOpen = false;
        spareToggleBtn.addEventListener("click", function() {
            spareOpen = !spareOpen;
            spareToggleBtn.textContent = spareOpen ? "Hide Spare Parts" : "View Spare Parts";
            if (spareOpen && !sparePanel) {
                sparePanel = _buildSpareStatsPanel(m);
                panelsWrap.append(sparePanel);
            }
            if (sparePanel) sparePanel.style.display = spareOpen ? "block" : "none";
        });
        toggleWrap.append(spareToggleBtn);

        if (m.escalation && m.escalation.triggered) {
            toggleWrap.append(el("div", "mira-pred-toggle-note", "Escalation candidate only"));
        }

        main.append(rankCell, machineCell, issueCell, countCell, assetsCell, nextDueCell, confidenceCell, toggleWrap);
        rowWrap.append(main, panelsWrap);
        return rowWrap;
    }

    function _buildCategorySection(cat, availableCats) {
        var sec = el("div", "mira-pred-cat-section");
        var hdr = el("div", "mira-pred-cat-header");
        hdr.append(el("span", "mira-pred-cat-name", "Recurring Issue Intelligence by Specific Machine Group"));
        var controls = el("div", "mira-pred-cat-controls");
        if (availableCats && availableCats.length > 1) {
            var field = el("label", "mira-pred-cat-select-field");
            field.append(el("span", null, "View"));
            var select = document.createElement("select");
            availableCats.forEach(function(optionCat) {
                var option = document.createElement("option");
                option.value = optionCat.name;
                option.textContent = optionCat.name;
                option.selected = optionCat.name === cat.name;
                select.appendChild(option);
            });
            select.addEventListener("change", function() {
                predictiveCategoryView = select.value;
                _renderPredCategories(predictiveLatestPayload || {});
            });
            field.append(select);
            controls.append(field);
        }
        controls.append(el("span", "mira-pred-cat-total", cat.total_mrs + " MR"));
        hdr.append(controls);
        sec.append(hdr);
        var machines = cat.top_machines || [];
        if (!machines.length) {
            sec.append(el("p", "mira-ov-muted", "Insufficient data for this period."));
            return sec;
        }
        var colHdr = el("div", "mira-pred-mg-colhdr");
        [["mira-pred-mg-rankcol", "Rank"],
         ["mira-pred-mg-machine", "Specific Machine Group"],
         ["mira-pred-mg-issue", "Main Observed Issue"],
         ["mira-pred-mg-count", "MR Count"],
         ["mira-pred-mg-assets", "Related Assets"],
         ["mira-pred-mg-nextdue", "Recurrence Timing"],
         ["mira-pred-mg-confidence", "Confidence"],
         ["mira-pred-mg-toggle", "Actions"]
        ].forEach(function(pair) { colHdr.append(el("span", pair[0], pair[1])); });
        sec.append(colHdr);
        machines.forEach(function(m) { sec.append(_buildMachineRow(m)); });
        return sec;
    }

    function _renderPredCategories(d) {
        var host = document.getElementById("mira-pred-cats-body");
        if (!host) return;
        host.innerHTML = "";
        predictiveLatestPayload = d;
        if (d.empty || !d.categories || !d.categories.length) {
            host.innerHTML = "<p class=\"mira-ov-muted\">No data for this period.</p>";
            return;
        }
        var visibleCats = (d.categories || []).filter(function(cat) {
            return cat && (cat.name === "Production Equipment" || cat.name === "Utilities");
        });
        if (!visibleCats.length) {
            host.innerHTML = "<p class=\"mira-ov-muted\">No Production Equipment or Utilities data for this period.</p>";
            return;
        }
        var selectedCat = visibleCats.find(function(cat) { return cat.name === predictiveCategoryView; }) || visibleCats[0];
        predictiveCategoryView = selectedCat.name;
        var frag = document.createDocumentFragment();
        frag.append(_buildCategorySection(selectedCat, visibleCats));
        host.append(frag);
    }

    function _renderPredFault(d) {
        var host = document.getElementById("mira-pred-fault-body");
        if (!host) return;
        var fp = d.fault_pattern;
        if (!fp || d.empty) {
            host.innerHTML = "<p class=\"mira-ov-muted\">No dominant fault pattern detected.</p>";
            return;
        }
        host.innerHTML = "";
        var headline = el("div", "mira-pred-fault-headline");
        headline.append(el("span", "mira-pred-fault-pill", fp.fault_family || "—"));
        headline.append(el("span", "mira-pred-fault-stat", " ×" + fp.count + " (" + fp.pct_of_total + "% of MR)"));
        host.append(headline);
        if (fp.affected_groups && fp.affected_groups.length) {
            host.append(el("div", "mira-pred-fault-lbl", "Affects:"));
            var chips = el("div", "mira-pred-fault-groups");
            fp.affected_groups.forEach(function(g) { chips.append(el("span", "mira-pred-group-chip", g)); });
            host.append(chips);
        }
    }

    function _renderPredConfidence(d) {
        var host = document.getElementById("mira-pred-confidence-body");
        if (!host) return;
        var conf = d.data_confidence || {};
        host.innerHTML = "";
        var tone = conf.band === "High" ? "low" : conf.band === "Medium" ? "medium" : "high";
        var badge = el("span", "mira-ov-risk-badge mira-ov-risk-" + tone, conf.band || "—");
        var txt = el("span", "mira-pred-conf-text", " " + (conf.label || "Confidence data unavailable."));
        var row = el("div", "mira-pred-conf-row");
        row.append(badge, txt);
        host.append(row);
        if (conf.total > 0) {
            var bars = el("div", "mira-pred-conf-bars");
            [
                ["Asset Mapped", conf.asset_mapping_pct],
                ["Complete Dates", conf.date_completeness_pct],
                ["WO Linked", conf.wo_link_pct]
            ].forEach(function(pair) {
                var label = pair[0];
                var pct = pair[1];
                var barRow = el("div", "mira-pred-conf-bar-row");
                var fillPct = pct != null ? Math.max(0, Math.min(100, pct)) : 0;
                var barTone = fillPct >= 80 ? "good" : fillPct >= 60 ? "medium" : "low";
                var lbl = el("span", "mira-pred-conf-bar-lbl", label);
                var track = el("div", "mira-pred-conf-bar-track");
                var fill = el("div", "mira-pred-conf-bar-fill mira-pred-conf-fill-" + barTone);
                fill.style.width = fillPct + "%";
                track.append(fill);
                var val = el("span", "mira-pred-conf-bar-val", pct != null ? pct + "%" : "—");
                barRow.append(lbl, track, val);
                bars.append(barRow);
            });
            host.append(bars);
        }
    }

    // ── § 4  Data Quality & Daily Action Alerts ──────────────────────────────
    function buildDataQualityAlertsSection() {
        const sec = el("section", "mira-ov-daily-section");
        const head = el("div", "mira-ov-daily-head");
        head.append(el("div", "mira-ov-section-label", "Data Quality & Daily Action Alerts"));
        const status = el("div", "mira-ov-daily-status");
        refs.verdictBadge = el("span", "mira-ov-status-badge", "Loading");
        refs.verdictScope = el("span", "mira-ov-verdict-scope", "");
        status.append(refs.verdictBadge, refs.verdictScope);
        head.append(status);
        sec.append(head);

        const grid = el("div", "mira-ov-daily-grid");
        const dqCard = el("div", "mira-ov-daily-card");
        dqCard.append(el("div", "mira-ov-sub-card-title", "Data Quality"));
        refs.dataQualityChips = el("div", "mira-ov-dq-chip-grid");
        refs.dataQualityChips.innerHTML = "<div class=\"mira-ov-skeleton mira-sk-chips\"></div>";
        dqCard.append(refs.dataQualityChips);
        dqCard.append(el("p", "mira-ov-dq-note",
            "These issues may affect machine-level trend, PM compliance, and predictive analysis accuracy."));
        const dqActions = el("div", "mira-ov-daily-actions");
        dqActions.append(buildNavButton("View Data Quality", "data_quality"));
        dqCard.append(dqActions);

        const alertsCard = el("div", "mira-ov-daily-card mira-ov-daily-alert-card");
        alertsCard.append(el("div", "mira-ov-sub-card-title", "Daily Action Alerts"));
        refs.verdictSummary = el("p", "mira-ov-muted", "Loading daily alerts...");
        alertsCard.append(refs.verdictSummary);
        refs.dailyAlerts = el("div", "mira-ov-daily-alerts");
        refs.dailyAlerts.id = "mira-ov-verdict-body";
        refs.dailyAlerts.innerHTML = "<div class=\"mira-ov-skeleton mira-sk-chips\"></div>";
        alertsCard.append(refs.dailyAlerts);

        grid.append(dqCard, alertsCard);
        sec.append(grid);
        sec.append(el("p", "mira-ov-disclaimer",
            "AI-detected issues are for review only. Technician/Engineer verification is required before any action. MIRA does not assign severity."));
        return sec;
    }

    // ── Alert context routing ────────────────────────────────────────────────
    // Key used to pass alert context via sessionStorage to the target page/tab.
    const ALERT_CTX_KEY = "mira_alert_ctx";

    function getActionRouteForAlert(key, extra) {
        const area = extra.area || "";
        const why  = extra.why  || "";
        // Convert overview state.stage ("stage1"/"stage2"/"all") → Downtime select value ("Stage 1"/"Stage 2"/"all")
        const rawStage = String(extra.stage || "all").toLowerCase();
        const stageFilter = rawStage === "stage1" ? "Stage 1" : rawStage === "stage2" ? "Stage 2" : "all";
        if (key === "open-mr") {
            return {
                label: "Review Open MR",
                navTarget: "downtime",
                navFocus: "machine_explorer",
                context: {
                    page: "downtime", focus: "machine_explorer",
                    alertType: "open_mr",
                    alertDescription: `${area} — open / in-progress MR needing engineer review`,
                    areaOrAsset: area, statusFilter: "open",
                    stageFilter,
                },
            };
        }
        if (key === "carry-over") {
            return {
                label: "Review Carry-over MR",
                navTarget: "downtime",
                navFocus: "yearly_movement",
                context: {
                    page: "downtime", focus: "yearly_movement",
                    alertType: "carry_over_mr",
                    alertDescription: "Previous-year MR still unresolved — raised before the selected period and remain open",
                    carryoverFilter: "previous_year_open",
                    stageFilter,
                },
            };
        }
        if (key === "pm-overdue") {
            return {
                label: "View Overdue PM Tasks",
                navTarget: "pm",
                navFocus: "task_list",
                context: {
                    page: "pm_schedule", focus: "task_list",
                    alertType: "pm_overdue",
                    alertDescription: `PM overdue tasks — ${why || "overdue PM tasks need action"}`,
                    statusFilter: "Overdue", sortKey: "plannedDate", sortDir: 1,
                },
            };
        }
        if (key === "pm-mapping") {
            return {
                label: "Review PM Mapping",
                navTarget: "pm",
                navFocus: "task_list",
                context: {
                    page: "pm_schedule", focus: "task_list",
                    alertType: "pm_mapping",
                    alertDescription: "PM records are missing stage or asset mapping",
                },
            };
        }
        if (key.startsWith("verdict-")) {
            const isRecurring = extra.recurrence;
            if (isRecurring) {
                return {
                    label: "View Recurring Issue",
                    navTarget: "asset_intelligence",
                    navFocus: "issue_cluster",
                    context: {
                        page: "asset_parts_intelligence", focus: "issue_cluster",
                        alertType: "recurring_issue",
                        alertDescription: `${area} — repeated issue pattern detected`,
                        areaOrAsset: area, issueCluster: why,
                    },
                };
            }
            return {
                label: "Open Machine Explorer",
                navTarget: "downtime",
                navFocus: "machine_explorer",
                context: {
                    page: "downtime", focus: "machine_explorer",
                    alertType: "asset_review",
                    alertDescription: `${area} — maintenance review candidate`,
                    areaOrAsset: area, statusFilter: "open",
                    stageFilter,
                },
            };
        }
        if (key === "missing-asset" || key === "unknown-status" || key === "area-only" || key === "data-warning") {
            return {
                label: "View Data Quality",
                navTarget: "downtime",
                navFocus: "data_reliability",
                context: {
                    page: "downtime", focus: "data_reliability",
                    alertType: key,
                    alertDescription: area ? `${area} — data quality records need correction` : "MR records with data quality issues need correction",
                    stageFilter,
                },
            };
        }
        // manual-review fallback
        return { label: "View Downtime Details", navTarget: "downtime", navFocus: null, context: null };
    }

    function buildNavButton(label, target, navFocus, context) {
        const btn = el("button", "mira-ov-btn mira-ov-btn-ghost mira-ov-nav-btn", label);
        btn.type = "button";
        btn.dataset.miraNavTarget = target;
        btn.addEventListener("click", () => {
            try {
                if (context) sessionStorage.setItem(ALERT_CTX_KEY, JSON.stringify(context));
                else sessionStorage.removeItem(ALERT_CTX_KEY);
            } catch (_) {}
            navigateOverviewTarget(target, navFocus || null);
        });
        return btn;
    }

    function navigateOverviewTarget(target, navFocus) {
        const clickView = (view) => {
            const tab = document.querySelector(`[data-view-tab="${view}"]`);
            if (tab) { tab.click(); return true; }
            return false;
        };
        if (target === "downtime") {
            const switched = clickView("downtime");
            if (!switched) {
                window.location.href = "/Downtime/index.html";
            } else if (navFocus) {
                // Same-page: notify the downtime iframe via postMessage once it loads,
                // and also fire a document event in case the iframe was already loaded.
                const frame = document.getElementById("maintenance-downtime-frame");
                const dispatchToFrame = () => {
                    try {
                        frame.contentWindow.postMessage({ type: "mira_alert_focus", focus: navFocus }, window.location.origin);
                    } catch (_) {}
                };
                if (frame) {
                    frame.addEventListener("load", dispatchToFrame, { once: true });
                    window.setTimeout(dispatchToFrame, 400);
                }
            }
            return;
        }
        if (target === "pm") {
            clickView("overview");
            if (navFocus) {
                window.setTimeout(() => {
                    document.dispatchEvent(new CustomEvent("mira:alert:navigate", {
                        bubbles: true, detail: { target: "pm", focus: navFocus },
                    }));
                }, 120);
            }
            return;
        }
        if (target === "data_quality" || target === "asset_intelligence") {
            clickView("spare_parts");
            const tabName = target === "data_quality" ? "data_quality" : "intelligence";
            retryClickSpareTab(tabName, 0);
        }
    }

    function retryClickSpareTab(tabName, attempt) {
        const tab = document.querySelector(`[data-spm-tab="${tabName}"]`);
        if (tab) {
            tab.click();
            return;
        }
        if (attempt < 8) window.setTimeout(() => retryClickSpareTab(tabName, attempt + 1), 150);
    }

    // Map the dashboard's selected scope (state.stage) to the verdict scope label.
    function currentScopeLabel() {
        const s = String(state.stage || "all").toLowerCase();
        if (s === "stage1" || s === "stage 1" || s === "s1") return "Stage 1";
        if (s === "stage2" || s === "stage 2" || s === "s2") return "Stage 2";
        return "All";
    }

    let verdictAbort = null;
    function loadVerdict() {
        const scopeLabel = currentScopeLabel();
        if (refs.verdictScope) refs.verdictScope.textContent = scopeLabel;
        if (refs.verdictBadge) { refs.verdictBadge.textContent = "Loading…"; refs.verdictBadge.className = "mira-ov-status-badge"; }
        if (refs.verdictSummary) refs.verdictSummary.textContent = "Loading daily alerts...";
        const body = document.getElementById("mira-ov-verdict-body");
        if (body) body.innerHTML = `<div class="mira-ov-skeleton mira-sk-chips"></div>`;
        if (verdictAbort) verdictAbort.abort();
        const controller = new AbortController(); verdictAbort = controller;
        const timer = window.setTimeout(() => controller.abort(), 12000);
        fetch(`${API}/verdict?scope=${encodeURIComponent(scopeLabel)}`, { cache: "no-store", signal: controller.signal })
            .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
            .then((v) => renderVerdict(v))
            .catch((err) => {
                if (err && err.name === "AbortError") return;
                if (refs.verdictBadge) { refs.verdictBadge.textContent = "Unavailable"; refs.verdictBadge.className = "mira-ov-status-badge mira-ov-status-watch"; }
                if (refs.verdictSummary) refs.verdictSummary.textContent = "Daily alerts are using verified KPI data only.";
                renderDailyQualityAndAlerts(lastOverview && lastOverview.data, lastOverview && lastOverview.pres, latestWarnings, null);
            })
            .finally(() => window.clearTimeout(timer));
    }

    function renderVerdict(v) {
        latestVerdict = v || null;
        const overall = String((v && v.overall_verdict) || "Green");
        const tone = overall === "Red" ? "critical" : overall === "Amber" ? "watch" : "good";
        if (refs.verdictScope) refs.verdictScope.textContent = (v && v.scope) || currentScopeLabel();
        if (refs.verdictBadge) { refs.verdictBadge.textContent = overall; refs.verdictBadge.className = `mira-ov-status-badge mira-ov-status-${tone}`; }
        const dateStr = (v && v.date_reviewed) ? ` · reviewed ${v.date_reviewed}` : "";
        if (refs.verdictSummary) refs.verdictSummary.textContent = ((v && v.summary) || "Daily alerts use verified KPI and triage data.") + dateStr;
        renderDailyQualityAndAlerts(lastOverview && lastOverview.data, lastOverview && lastOverview.pres, latestWarnings, latestVerdict);
    }

    function escOv(text) {
        return String(text || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    function renderDataQualityChips(data, warnings) {
        const host = refs.dataQualityChips;
        if (!host) return;
        const dt = (data && data.downtime_summary) || {};
        const pm = (data && data.pm_schedule) || {};
        const chips = [
            { label: "MR missing Asset ID", value: num(dt.missing_asset_count) || 0, target: "data_quality" },
            { label: "MR unmapped status", value: num(dt.unknown_status_count) || 0, target: "data_quality" },
            { label: "PM missing mapping", value: num(pm.missing_mapping) || 0, target: "pm" },
        ];
        [
            ["Area-only MR records", dt.general_area_asset_count, "data_quality"],
            ["Missing functional location", dt.missing_functional_location_count, "data_quality"],
            ["Other data issues", data && data.data_reliability_issue_count, "data_quality"],
        ].forEach(([label, value, target]) => {
            const n = num(value);
            if (n && !chips.some((chip) => chip.label === label)) chips.push({ label, value: n, target });
        });
        host.innerHTML = "";
        chips.slice(0, 6).forEach((chip) => {
            const n = num(chip.value) || 0;
            const node = el("button", "mira-ov-dq-chip " + (n > 0 ? "mira-ov-dq-chip-warn" : "mira-ov-dq-chip-ok"));
            node.type = "button";
            node.append(el("span", "mira-ov-chip-label", chip.label), el("strong", "mira-ov-chip-value", fmt(n)));
            node.addEventListener("click", () => navigateOverviewTarget(chip.target));
            host.append(node);
        });
        if ((warnings || []).length) {
            const warn = el("p", "mira-ov-dq-inline-note", String(warnings[0]));
            host.append(warn);
        }
    }

    function renderDailyQualityAndAlerts(data, pres, warnings, verdict) {
        renderDataQualityChips(data || {}, warnings || []);
        renderDailyAlerts(buildDailyAlertRows(data || {}, pres || {}, warnings || [], verdict || null));
    }

    function pushAlert(rows, key, area, flag, why, _action, _target, rank, extraData) {
        if (!why || rows.some((row) => row.key === key)) return;
        const route = getActionRouteForAlert(key, { area, why, ...(extraData || {}) });
        rows.push({
            key, area, flag, why: conciseText(why, 120), rank,
            action: route.label,
            target: route.navTarget,
            navFocus: route.navFocus || null,
            context: route.context || null,
        });
    }

    function isUsefulVerdictItem(item) {
        if (!item) return false;
        const rag = String(item.rag || "").toLowerCase();
        const confidence = String(item.confidence || "").toLowerCase();
        return item.recurrence || item.escalation_flag || rag === "red" || confidence === "medium" || confidence === "high";
    }

    function buildDailyAlertRows(data, pres, warnings, verdict) {
        const rows = [];
        const wo = data.work_orders || {};
        const pm = data.pm_schedule || {};
        const dt = data.downtime_summary || {};
        const open = num(wo.open) || 0;
        const carryOver = num(dt.carry_over_open_mr) || num(dt.opening_backlog_count) || 0;
        const overdue = num(pm.overdue) || 0;
        const missingAsset = num(dt.missing_asset_count) || 0;
        const unknownStatus = num(dt.unknown_status_count) || 0;
        const pmMissing = num(pm.missing_mapping) || 0;
        const generalArea = num(dt.general_area_asset_count) || 0;

        if (open > 0) {
            pushAlert(rows, "open-mr", dt.top_functional_location_name || "Open MR backlog",
                open > 50 ? "Red" : "Amber",
                `${fmt(open)} open / in-progress MR need engineer review.`, "View Downtime Details", "downtime", open > 50 ? 10 : 30,
                { stage: state.stage });
        }
        if (overdue > 0) {
            pushAlert(rows, "pm-overdue", "PM overdue tasks", overdue > 30 ? "Red" : "Amber",
                `${fmt(overdue)} overdue PM tasks; PM compliance ${fmt(pm.compliance_pct)}%.`, "View PM Details", "pm", overdue > 30 ? 15 : 35);
        }
        if (carryOver > 0) {
            pushAlert(rows, "carry-over", "Carry-over open MR", carryOver > 25 ? "Red" : "Amber",
                `${fmt(carryOver)} MR were raised before the period and remain unresolved.`, "View Downtime Details", "downtime", carryOver > 25 ? 20 : 40,
                { stage: state.stage });
        }
        if (missingAsset > 0) {
            pushAlert(rows, "missing-asset", "Missing Asset ID records", "Grey",
                `${fmt(missingAsset)} MR missing Asset ID. Recorded area only - missing actual Asset ID.`, "View Data Quality", "data_quality", 45);
        }
        if (unknownStatus > 0) {
            pushAlert(rows, "unknown-status", "MR unmapped status", "Grey",
                `${fmt(unknownStatus)} MR have an unmapped status.`, "View Data Quality", "data_quality", 50);
        }
        if (pmMissing > 0) {
            pushAlert(rows, "pm-mapping", "PM missing mapping", "Grey",
                `${fmt(pmMissing)} PM records are missing mapping.`, "View PM Details", "pm", 55);
        }
        if (generalArea > 0) {
            pushAlert(rows, "area-only", "Recorded area only", "Grey",
                `${fmt(generalArea)} MR use generic area tags. Recorded area only - missing actual Asset ID.`, "View Data Quality", "data_quality", 60);
        }

        const verdictItems = (verdict && Array.isArray(verdict.items) ? verdict.items : []).filter(isUsefulVerdictItem);
        verdictItems.slice(0, 2).forEach((item, index) => {
            const rag = String(item.rag || "Amber");
            const flag = rag === "Red" ? "Red" : "Amber";
            const why = item.recurrence
                ? `Open MR with repeated issue wording${item.recurrence_note ? ` (${item.recurrence_note})` : ""}.`
                : (item.reason || "Insufficient repeated history. Manual review required.");
            pushAlert(rows, `verdict-${index}-${item.asset_name}`, item.asset_name || "Asset review candidate", flag,
                why, "", "", flag === "Red" ? 12 + index : 42 + index,
                { recurrence: item.recurrence, recurrenceNote: item.recurrence_note, assetName: item.asset_name, stage: state.stage });
        });

        if (!rows.length && (warnings || []).length) {
            pushAlert(rows, "data-warning", "Data reliability", "Grey", String(warnings[0]), "View Data Quality", "data_quality", 70);
        }
        if (!rows.length) {
            pushAlert(rows, "manual-review", "Current selection", "Amber",
                "Insufficient repeated history. Manual review required.", "View Downtime Details", "downtime", 80);
        }
        return rows.sort((a, b) => a.rank - b.rank).slice(0, 5);
    }

    function renderDailyAlerts(rows) {
        const host = refs.dailyAlerts || document.getElementById("mira-ov-verdict-body");
        if (!host) return;
        if (!rows || !rows.length) {
            host.innerHTML = `<p class="mira-ov-muted">No action alerts for the selected period.</p>`;
            return;
        }
        host.innerHTML = "";
        const table = el("table", "mira-ov-alert-table");
        table.innerHTML = "<thead><tr><th>Area / Asset</th><th>Flag</th><th>Why it needs review</th><th>Action</th></tr></thead>";
        const tbody = el("tbody");
        rows.forEach((row) => {
            const tr = el("tr");
            const flagClass = row.flag === "Red" ? "mira-ov-risk-high" : row.flag === "Amber" ? "mira-ov-risk-medium" : "mira-ov-risk-low";
            const actionCell = el("td");
            actionCell.append(buildNavButton(row.action, row.target, row.navFocus, row.context));
            const flagCell = el("td");
            flagCell.append(el("span", `mira-ov-risk-badge ${flagClass}`, row.flag));
            tr.append(el("td", null, row.area || "Current selection"), flagCell, el("td", null, row.why || ""), actionCell);
            tbody.append(tr);
        });
        table.append(tbody);
        host.append(table);
    }

    // ── Removed: buildTabShell, buildDetailPanel, buildPredictivePanel,
    //            buildIssuePanel, setActiveTab, buildKpiGrid (replaced above).
    // Stub so any internal calls don't throw.
    function buildDetailPanel(key) {
        const d = el("div"); d.hidden = true; d.id = `mira-ov-detail-${key}-legacy`; return d;
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
        if (!node) return;
        node.innerHTML = "";
        const arr = (items || []).filter(Boolean);
        if (!arr.length) {
            if (emptyText) node.append(el("li", "mira-ov-muted", emptyText));
            return;
        }
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
            // Per-KPI notes move to a hover tooltip so the card stays clean and scannable.
            if (m.note) { chip.title = `${m.label}: ${m.value} — ${m.note}`; chip.classList.add("mira-ov-chip-has-note"); }
            grid.append(chip);
        });
        host.append(grid);
        // Inline warning (e.g. PM completion_warning) shown directly below chips
        if (section.completion_warning) {
            const warn = el("div", "mira-ov-pm-warning", "⚠ " + section.completion_warning);
            host.append(warn);
        }
        // Long explanation text collapses into a "Notes" expander (kept, not removed).
        if (section.summary || section.footnote) {
            const det = el("details", "mira-ov-section-details");
            det.append(el("summary", "mira-ov-details-summary", "Notes"));
            if (section.summary) det.append(el("p", "mira-ov-section-summary", section.summary));
            if (section.footnote) det.append(el("p", "mira-ov-footnote", section.footnote));
            host.append(det);
        }
    }

    function renderPredictiveAnalysis(analysis) {
        const host = document.getElementById("mira-ov-early-warnings") || document.getElementById("mira-ov-predictive-content");
        if (!host) return;
        host.innerHTML = "";
        const data = analysis || {};
        const forecasts = Array.isArray(data.forecast) ? data.forecast : [];
        const predictions = Array.isArray(data.predictions) ? data.predictions : [];
        if (!forecasts.length && !predictions.length) {
            host.append(el("p", "mira-ov-muted", "No predictive indicators are available for the selected period."));
            return;
        }
        if (forecasts.length) {
            const forecastCard = el("section", "mira-ov-detail-card");
            forecastCard.append(el("h3", "mira-ov-kpi-title", "Forecast Overview"));
            const grid = el("div", "mira-ov-forecast-grid");
            forecasts.forEach((item) => {
                const card = el("div", "mira-ov-forecast-card");
                card.append(el("span", "mira-ov-chip-label", item.metric || "Metric"));
                card.append(el("strong", "mira-ov-forecast-value", fmt(item.predicted)));
                card.append(el("span", "mira-ov-chip-note", `Current: ${fmt(item.current)} | Trend: ${fmt(item.trend)}`));
                grid.append(card);
            });
            forecastCard.append(grid);
            host.append(forecastCard);
        }
        const listCard = el("section", "mira-ov-detail-card mira-ov-scroll-card");
        listCard.append(el("h3", "mira-ov-kpi-title", "Risk Indicators"));
        const list = el("div", "mira-ov-prediction-list");
        predictions.forEach((item) => {
            const card = el("div", `mira-ov-prediction-card impact-${item.impact || "medium"}`);
            const top = el("div", "mira-ov-prediction-top");
            top.append(el("strong", null, item.risk_area || item.category || "Risk indicator"));
            const conf = String(item.confidence || "Low").toLowerCase();
            top.append(el("span", `mira-ov-mini-badge mira-conf-${conf}`, `${item.confidence || "Low"} confidence`));
            card.append(top);
            // Lead with the evidence (clamped to 2 lines); deeper analysis collapses under "Details".
            card.append(el("p", "mira-ov-muted-copy mira-ov-clamp-2", item.evidence || "Evidence unavailable."));
            if (item.prediction || item.follow_up_action) {
                const det = el("details", "mira-ov-card-details");
                det.append(el("summary", "mira-ov-details-summary", "Details"));
                det.append(el("p", "mira-ov-section-summary", item.prediction || "Prediction confidence is limited because historical data is incomplete."));
                if (item.follow_up_action) det.append(el("p", "mira-ov-footnote", item.follow_up_action));
                card.append(det);
            }
            list.append(card);
        });
        listCard.append(list);
        host.append(listCard);
        renderList(host.appendChild(el("ul", "mira-ov-list mira-ov-ai-notes")), data.data_notes || [], "", "warn");
    }

    function renderIssueFocus(focus) {
        const host = document.getElementById("mira-ov-repeated-issues") || document.getElementById("mira-ov-issue-content");
        if (!host) return;
        host.innerHTML = "";
        const data = focus || {};
        const categories = Array.isArray(data.issue_categories) ? data.issue_categories : [];
        const topIssues = Array.isArray(data.top_issues) ? data.top_issues : [];
        const patterns = Array.isArray(data.trending_patterns) ? data.trending_patterns : [];
        if (!categories.length && !topIssues.length && !patterns.length) {
            host.append(el("p", "mira-ov-muted", "No issue focus data is available for the selected period."));
            return;
        }
        const categoryCard = el("section", "mira-ov-detail-card");
        categoryCard.append(el("h3", "mira-ov-kpi-title", "Issue Categories"));
        const catList = el("div", "mira-ov-category-list");
        categories.forEach((cat) => {
            const row = el("div", "mira-ov-category-row");
            const top = el("div", "mira-ov-category-top");
            top.append(el("strong", null, cat.category || "Unclassified"), el("span", null, `${fmt(cat.count)} item(s) | ${fmt(cat.percentage)}%`));
            const bar = el("div", "mira-ov-progress");
            const fill = el("span", "mira-ov-progress-fill");
            fill.style.width = `${Math.max(0, Math.min(100, Number(cat.percentage || 0)))}%`;
            bar.append(fill);
            row.append(top, bar);
            catList.append(row);
        });
        categoryCard.append(catList);
        host.append(categoryCard);

        const issueCard = el("section", "mira-ov-detail-card mira-ov-scroll-card");
        issueCard.append(el("h3", "mira-ov-kpi-title", "Top Issues"));
        const issueList = el("div", "mira-ov-issue-list");
        topIssues.forEach((issue, index) => {
            const card = el("div", "mira-ov-issue-card");
            const title = el("div", "mira-ov-prediction-top");
            title.append(el("strong", null, `#${index + 1} ${issue.issue_focus_area || "Issue focus"}`), el("span", "mira-ov-mini-badge", `${fmt(issue.frequency)} occurrence(s)`));
            card.append(title);
            if ((issue.affected_areas || []).length) {
                const chips = el("div", "mira-ov-area-chips");
                issue.affected_areas.forEach((area) => chips.append(el("span", "mira-ov-mini-badge", area)));
                card.append(chips);
            }
            // Show the first 2-3 findings; older evidence + context collapse under "Full details".
            const evidence = Array.isArray(issue.evidence) ? issue.evidence : [];
            const lead = evidence.slice(0, 3);
            const rest = evidence.slice(3);
            renderList(card.appendChild(el("ul", "mira-ov-list mira-ov-list-compact")), lead, "No example descriptions available.");
            if (rest.length || issue.why_it_matters || issue.follow_up_action) {
                const det = el("details", "mira-ov-card-details");
                det.append(el("summary", "mira-ov-details-summary", "Full details"));
                if (rest.length) renderList(det.appendChild(el("ul", "mira-ov-list")), rest, "");
                if (issue.why_it_matters) det.append(el("p", "mira-ov-section-summary", issue.why_it_matters));
                if (issue.follow_up_action) det.append(el("p", "mira-ov-footnote", issue.follow_up_action));
                card.append(det);
            }
            issueList.append(card);
        });
        issueCard.append(issueList);
        host.append(issueCard);

        const patternCard = el("section", "mira-ov-detail-card mira-ov-soft-card");
        patternCard.append(el("h3", "mira-ov-kpi-title", "Trending Patterns"));
        renderList(patternCard.appendChild(el("ul", "mira-ov-list")), patterns, "No repeated pattern detected.");
        renderList(patternCard.appendChild(el("ul", "mira-ov-list mira-ov-ai-notes")), data.data_notes || [], "", "warn");
        host.append(patternCard);
    }

    function renderSkeletonState() {
        // Compact skeleton — brief placeholder lines rather than full-height loading boxes.
        if (refs.exec) refs.exec.textContent = "";
        if (refs.highlights) refs.highlights.innerHTML = `<li class="mira-ov-skeleton mira-sk-line mira-sk-md"></li><li class="mira-ov-skeleton mira-sk-line mira-sk-sm"></li>`;
        if (refs.actionsToday) refs.actionsToday.innerHTML = `<li class="mira-ov-skeleton mira-sk-line mira-sk-lg"></li>`;
        ["pm", "downtime", "spare"].forEach((key) => {
            const host = document.getElementById(`mira-ov-kpi-${key}`);
            if (host) host.innerHTML = `<div class="mira-ov-skeleton mira-sk-chips"></div>`;
        });
    }

    function renderLoadingState() {
        renderSkeletonState();
        if (refs.exec) refs.exec.textContent = "Loading verified maintenance KPI cards...";
        ["mira-ov-detail-pm", "mira-ov-detail-downtime", "mira-ov-detail-spare"].forEach((id) => {
            setBody(id, el("p", "mira-ov-muted", "Loading verified detail..."));
        });
        setBody("mira-ov-early-warnings", el("p", "mira-ov-muted", "Loading predictive indicators..."));
        setBody("mira-ov-repeated-issues", el("p", "mira-ov-muted", "Loading issue focus detection..."));
        ["today", "followup", "risks", "dq"].forEach((key) => {
            renderList(document.getElementById(`mira-ov-rec-${key}`), [], "Loading...");
        });
    }

    function fetchJsonWithTimeout(url, options, timeoutMs) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);
        return {
            controller,
            promise: fetch(url, { ...(options || {}), signal: controller.signal })
                .then((r) => {
                    if (!r.ok) throw new Error(String(r.status));
                    return r.json();
                })
                .finally(() => window.clearTimeout(timer)),
        };
    }

    // ── AI summary cache (localStorage) ────────────────────────────────────────
    const AI_CACHE_KEY_PREFIX = "mira-ai-summary-v1-";
    const AI_CACHE_TTL_MS     = 30 * 60 * 1000; // 30 min

    function aiCacheKey(sig) { return AI_CACHE_KEY_PREFIX + sig; }

    function loadCachedAi(sig) {
        try {
            const raw = window.localStorage && window.localStorage.getItem(aiCacheKey(sig));
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (Date.now() - (entry.ts || 0) > AI_CACHE_TTL_MS) { window.localStorage.removeItem(aiCacheKey(sig)); return null; }
            return entry.data;
        } catch { return null; }
    }

    function saveCachedAi(sig, data) {
        try {
            if (window.localStorage) window.localStorage.setItem(aiCacheKey(sig), JSON.stringify({ ts: Date.now(), data }));
        } catch { /* quota exceeded — skip */ }
    }

    function clearCachedAi(sig) {
        try { if (window.localStorage) window.localStorage.removeItem(aiCacheKey(sig)); }
        catch { /* ignore */ }
    }

    // ── data loading (staged) ───────────────────────────────────────────────────
    // Stage 1: instant shell render (done by renderShell at mount time)
    // Stage 2: fast-kpis  → populate KPI chips within ~100-200ms (warm) or immediately show loading skeleton
    // Stage 3: full /overview → update chips with precise numbers + exec summary
    // Stage 4: /ai-summary → update AI sections (cached first, then fresh)
    function loadOverview(options = {}) {
        const signature = filtersSignature();
        if (!options.force) {
            if (inFlightSignature === signature) return;
            if (lastLoadSignature === signature && lastOverview) return;
        }

        const token = ++loadToken;
        inFlightSignature = signature;
        if (overviewAbort) overviewAbort.abort();
        if (aiAbort) aiAbort.abort();

        if (!options.warmRetry) {
            warmRetries = 0;
            if (warmRetryTimer) { window.clearTimeout(warmRetryTimer); warmRetryTimer = null; }
        }

        window.MIRA_DASHBOARD_FILTERS = currentFilters();
        debugLog("overview:staged-load", { sig: signature, force: !!options.force });

        // ── Stage 2a: Render skeleton immediately so the page isn't blank ──────
        if (!options.warmRetry) {
            refs.statusBadge.textContent = "Assessing…";
            refs.statusBadge.className = "mira-ov-status-badge";
            renderSkeletonState();
            // Daily MR triage verdict — independent, lightweight GET keyed by the
            // selected scope. Re-fetches whenever the scope changes (this fn runs on
            // every load, including the stage-selector change).
            loadVerdict();
            loadPredictive();
        }

        // ── Stage 2b: If we have a cached AI summary, show it right away so
        //             the AI sections never feel blank to the user ──────────────
        const cachedAi = options.force ? null : loadCachedAi(signature);
        if (cachedAi) {
            renderAi(cachedAi);
            markAiSections("Showing cached summary — refreshing…");
        } else {
            markAiSections("Generating AI summary…");
        }

        // ── Stage 2c: Fast KPIs — sub-200ms, fills cards before full overview ──
        let fastKpisDone = false;
        fetchJsonWithTimeout(`${API}/fast-kpis`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify(filtersBody()),
        }, 4000).promise
        .then((json) => {
            if (token !== loadToken) return;
            const isWarm = json && json.warming;
            fastKpisDone = !isWarm;
            if (!isWarm && json && json.sections) {
                renderSection("mira-ov-kpi-pm",       (json.sections || {}).pm_schedule_summary);
                renderSection("mira-ov-kpi-downtime",  (json.sections || {}).downtime_work_order_summary);
                renderSection("mira-ov-kpi-spare",     (json.sections || {}).spare_parts_summary);
                refs.statusBadge.textContent = "Loading…";
                refs.statusBadge.className = "mira-ov-status-badge";
            }
        })
        .catch(() => { /* fast path failed — full overview will fill in */ });

        // ── Stage 3: Full /overview — runs in parallel with fast-kpis ──────────
        const overviewRequest = fetchJsonWithTimeout(`${API}/overview`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify(filtersBody()),
        }, 22000);
        overviewAbort = overviewRequest.controller;
        overviewRequest.promise
            .then((json) => {
                if (token !== loadToken) return;
                const isWarming = json && (json.warming || (json.data_availability && json.data_availability.warming));
                if (isWarming) { scheduleWarmRetry(signature); return; }
                warmRetries = 0;
                if (warmRetryTimer) { window.clearTimeout(warmRetryTimer); warmRetryTimer = null; }
                lastLoadSignature = signature;
                renderVerified(json);       // replaces fast-kpi chips with full verified data

                // ── Stage 4: AI summary (after full KPIs are visible) ──────────
                window.setTimeout(() => {
                    if (token === loadToken) loadAiSummary(token, signature, !!cachedAi);
                }, options.force ? 0 : 300);
            })
            .catch((err) => {
                if (token !== loadToken) return;
                const code = String(err && err.message ? err.message : "").toLowerCase();
                const looksTransient = (err && err.name === "AbortError") || code.includes("failed to fetch");
                if (looksTransient && warmRetries < WARM_RETRY_MAX) { scheduleWarmRetry(signature); return; }
                if (fastKpisDone) {
                    // Fast KPIs already showed something useful — just note the failure
                    refs.statusBadge.textContent = "Partial data";
                    refs.statusBadge.className = "mira-ov-status-badge mira-ov-status-watch";
                } else {
                    renderError(err);
                }
            })
            .finally(() => {
                if (token === loadToken && inFlightSignature === signature) inFlightSignature = "";
            });
    }

    function loadAiSummary(token, signature, hadCachedAi) {
        if (aiAbort) aiAbort.abort();
        debugLog("ai-summary:request", { filters: currentFilters(), token, hadCache: hadCachedAi });
        markAiSections(hadCachedAi ? "Refreshing AI summary…" : "Generating AI summary…");
        const AI_TIMEOUT_MS = 28000;
        const aiRequest = fetchJsonWithTimeout(`${API}/ai-summary`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify(filtersBody()),
        }, AI_TIMEOUT_MS);
        aiAbort = aiRequest.controller;
        aiRequest.promise
            .then((json) => {
                if (token !== loadToken) return;
                if (json) {
                    saveCachedAi(signature, json);
                    renderAi(json);
                    clearAiSectionMarkers();
                }
            })
            .catch((err) => {
                if (token !== loadToken) return;
                const timedOut = err && err.name === "AbortError";
                const msg = timedOut
                    ? "AI summary is taking longer than expected. Verified KPI data is still available."
                    : "AI summary unavailable. Verified KPI data is still shown.";
                if (!hadCachedAi) markAiSections(msg, "warn");
                else clearAiSectionMarkers(); // keep the cached version visible
            });
    }

    function markAiSections(text, tone) {
        const ids = ["mira-ov-rec-today", "mira-ov-rec-followup", "mira-ov-rec-risks", "mira-ov-rec-dq"];
        const cls = tone === "warn" ? "mira-ov-warn" : "mira-ov-muted";
        ids.forEach((id) => {
            const host = document.getElementById(id);
            if (!host) return;
            // Only update if not already showing real data (skip if has chip-grids or lists with content)
            if (host.querySelector(".mira-ov-kpi-chip, .mira-ov-chip-grid")) return;
            const existing = host.querySelector("li, p");
            if (existing && !existing.classList.contains("mira-ov-muted") && !existing.classList.contains("mira-ai-marker")) return;
            host.innerHTML = `<p class="mira-ov-muted mira-ai-marker">${text}</p>`;
        });
    }

    function clearAiSectionMarkers() {
        document.querySelectorAll(".mira-ai-marker").forEach((el) => {
            const parent = el.parentElement;
            if (parent && parent.querySelectorAll(".mira-ai-marker").length === parent.childElementCount) {
                parent.innerHTML = "";
            }
        });
    }

    // First load after a server restart: the backend is still parsing the source
    // workbooks. Show a calm "warming up" state and retry automatically instead of
    // the alarming "backend unreachable" error.
    function renderWarmingState(attempt) {
        refs.statusBadge.textContent = "Loading…";
        refs.statusBadge.className = "mira-ov-status-badge";
        const elapsed = attempt ? Math.round((attempt * WARM_RETRY_DELAY_MS) / 1000) : 0;
        const suffix = elapsed ? ` (${elapsed}s)` : "";
        // Only fill the exec line if it's still empty/placeholder — don't wipe a
        // real summary that already rendered.
        if (refs.exec && (!refs.exec.textContent || refs.exec.textContent.indexOf("Loading") === 0 || refs.exec.textContent === "")) {
            refs.exec.textContent =
                "Loading verified maintenance data… sections appear as soon as each is ready" + suffix + ".";
        }
        // Per-card: show a compact skeleton ONLY for cards that haven't loaded real
        // data yet. Cards already filled by the fast-KPI path stay put.
        ["pm", "downtime", "spare"].forEach((k) => {
            const host = document.getElementById(`mira-ov-kpi-${k}`);
            if (!host) return;
            if (host.querySelector(".mira-ov-kpi-chip, .mira-ov-chip-grid")) return; // already has real data
            host.innerHTML = `<div class="mira-ov-skeleton mira-sk-chips"></div>`;
        });
    }

    function scheduleWarmRetry(signature) {
        if (warmRetryTimer) { window.clearTimeout(warmRetryTimer); warmRetryTimer = null; }
        if (warmRetries >= WARM_RETRY_MAX) {
            renderError(new Error("warming-timeout"));
            return;
        }
        warmRetries += 1;
        renderWarmingState(warmRetries);
        warmRetryTimer = window.setTimeout(() => {
            warmRetryTimer = null;
            if (filtersSignature() === signature) loadOverview({ force: true, warmRetry: true });
        }, WARM_RETRY_DELAY_MS);
    }

    function renderError(err) {
        const code = String(err && err.message ? err.message : "");
        const msg = code === "404"
            ? "MIRA Overview isn't loaded on the running backend yet — please restart the backend (run_server.cmd / python app.py)."
            : code === "warming-timeout"
            ? "The backend is taking longer than usual to load the maintenance data. It may still be warming up — click Refresh in a moment, or restart the backend if this persists."
            : code.toLowerCase().includes("failed to fetch")
            ? "Can't reach the MIRA backend. Make sure the server is running (run_server.cmd / python app.py), then refresh."
            : `MIRA backend error (${code}). Please restart the backend and refresh.`;
        refs.statusBadge.textContent = "Backend unavailable";
        refs.statusBadge.className = "mira-ov-status-badge mira-ov-status-critical";
        if (refs.exec) refs.exec.textContent = msg;
        ["pm", "downtime", "spare"].forEach((k) => {
            setBody(`mira-ov-kpi-${k}`, el("p", "mira-ov-muted", "No data available - backend unreachable."));
            setBody(`mira-ov-detail-${k}`, el("p", "mira-ov-muted", "No data available - backend unreachable."));
        });
    }

    // Spare parts builds on a slower payload. Poll quietly for it (without the
    // full warming-retry UI) so the rest of the page stays put and the spare card
    // fills in on its own when ready.
    let spareRefreshTimer = null;
    let spareRefreshTries = 0;
    function scheduleSpareRefresh() {
        if (spareRefreshTimer) return;       // one poll in flight
        if (spareRefreshTries > 30) return;  // give up after ~5 min
        spareRefreshTimer = window.setTimeout(() => {
            spareRefreshTimer = null;
            spareRefreshTries += 1;
            const sig = filtersSignature();
            fetchJsonWithTimeout(`${API}/overview`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify(filtersBody()),
            }, 15000).promise
            .then((json) => {
                if (filtersSignature() !== sig) return;       // filters changed — stop
                if (json && json.warming) { scheduleSpareRefresh(); return; }
                const sections = (json.presentation || {}).sections || {};
                if (json && json.spare_warming) {
                    scheduleSpareRefresh();                    // still building — poll again
                } else {
                    renderSection("mira-ov-kpi-spare", sections.spare_parts_summary);  // ready!
                    spareRefreshTries = 0;
                }
            })
            .catch(() => { scheduleSpareRefresh(); });
        }, 10000);   // check every 10s
    }

    function renderVerified(json) {
        const pres = (json && json.presentation) || {};
        const data = (json && json.data) || {};
        const availability = data.data_availability || json.data_availability || {};
        const availabilityWarnings = availability.warnings || [];
        const vdu = pres.view_data_used || {};
        const sections = pres.sections || {};
        const warnings = uniqueStrings([].concat(vdu.data_warnings || [], pres.data_notes || [], availabilityWarnings));
        latestWarnings = warnings;
        const showWarmState = availability.complete === false && !hasUsableOverviewData(data, sections);
        const valueSource = showWarmState ? "warming-fallback" : availability.complete === false ? "partial-real-data" : "real-data";
        lastOverview = { data, pres };

        // Status
        const status = deriveStatus(data);
        refs.statusBadge.textContent = showWarmState ? "Data warming" : status.level;
        refs.statusBadge.className = `mira-ov-status-badge mira-ov-status-${showWarmState ? "watch" : status.tone}`;
        refs.statusPeriod.textContent = `Data period: ${vdu.period_label || periodLabel()}${vdu.date_range ? " · " + vdu.date_range : ""}`;
        refs.exec.textContent = showWarmState
            ? (availabilityWarnings[0] || "Full verified KPI detail is still warming in the background. The page remains available and will show verified cards once the cache is ready.")
            : ruleBasedExecutive(data);

        // Headline KPIs + compact summary + action table
        renderHeadlineKpis(showWarmState ? [] : (pres.kpi_cards || []));
        if (!showWarmState) renderCompactSummary(data, status, pres);
        const todays = (pres.priority_follow_up || []).slice(0, 5);
        renderActionTable(showWarmState ? [] : (pres.action_items || []), todays);

        // Compat: hidden refs still populated for renderAi / section renderers
        renderList(refs.highlights, showWarmState ? availabilityWarnings : buildHighlights(data, sections), "No notable highlights for this period.");
        renderList(refs.actionsToday, showWarmState ? ["Refresh once the verified KPI cache finishes warming."] : todays, "No immediate actions required.");

        // § 2 — KPI cards. PM + downtime show as soon as they're ready; spare
        //        parts may still be building its slower payload — show that card
        //        as "still loading" and poll for it independently.
        renderSection("mira-ov-kpi-pm", sections.pm_schedule_summary);
        renderSection("mira-ov-kpi-downtime", sections.downtime_work_order_summary);
        const spareWarming = json && json.spare_warming;
        if (spareWarming) {
            const spareHost = document.getElementById("mira-ov-kpi-spare");
            if (spareHost) spareHost.innerHTML = `<div class="mira-ov-skeleton mira-sk-chips"></div><p class="mira-ov-muted" style="margin-top:8px">Spare parts still loading…</p>`;
            scheduleSpareRefresh();
        } else {
            renderSection("mira-ov-kpi-spare", sections.spare_parts_summary);
        }

        // § 3 - compact data quality and action alerts
        renderDailyQualityAndAlerts(showWarmState ? {} : data, pres, warnings, latestVerdict);

        renderDataUsed(vdu);
        debugLog("overview:response", {
            providerStatus: json && json.provider_status,
            availabilityComplete: availability.complete,
            cacheHit: json && json.cache_hit,
            warningCount: warnings.length,
            valueSource,
        });
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
        if (s.executive_summary) refs.exec.textContent = conciseText(s.executive_summary, 420);
        // Update compact summary lines with AI content
        if (refs.summaryLine) {
            if (s.main_concern) { refs.summaryLine[0].textContent = "Main concern: " + s.main_concern; refs.summaryLine[0].className = "mira-ov-summary-line mira-ov-sl-concern"; }
            if (s.executive_summary) { refs.summaryLine[1].textContent = conciseText(s.executive_summary, 220); refs.summaryLine[1].className = "mira-ov-summary-line mira-ov-sl-reason"; }
            const aiAction = (s.recommended_follow_up || [])[0];
            if (aiAction) { refs.summaryLine[2].textContent = "Action: " + aiAction; refs.summaryLine[2].className = "mira-ov-summary-line mira-ov-sl-action"; }
        }
        if ((s.key_observations || []).length || s.main_concern) {
            const issues = [];
            if (s.main_concern) issues.push(`Main concern: ${s.main_concern}`);
            (s.key_observations || []).forEach((o) => issues.push(o));
            renderList(refs.highlights, issues.slice(0, 5), "");
        }
        if ((s.recommended_follow_up || []).length) {
            const followUp = s.recommended_follow_up.slice(0, 5);
            renderList(refs.actionsToday, followUp, "");
            renderList(document.getElementById("mira-ov-rec-today"), followUp, "");
            renderList(document.getElementById("mira-ov-rec-followup"), followUp, "");
        }
        renderIssueFocus(s.issue_focus || json.issue_focus);
        renderPredictiveAnalysis(s.predictive_analysis || json.predictive_analysis);
        debugLog("ai-summary:response", {
            provider: json && json.provider,
            providerStatus: json && json.provider_status,
            fallbackActive: json && json.fallback_active,
            llmActive: json && json.llm_active,
        });
    }

    function conciseText(text, maxLength) {
        const value = String(text || "").replace(/\s+/g, " ").trim();
        if (value.length <= maxLength) return value;
        return value.slice(0, maxLength - 1).replace(/\s+\S*$/, "") + ".";
    }

    window.renderMiraOverview = function renderMiraOverview(options = {}) {
        const root = document.getElementById("mira-overview-root");
        if (!root) return;
        if (!mounted) {
            renderShell(root);
            mounted = true;
        }
        loadOverview({ force: !!options.force });
    };

    function shouldAutoRender() {
        const root = document.getElementById("mira-overview-root");
        if (!root) return false;
        const view = (new URLSearchParams(window.location.search).get("view") || "mira_overview").toLowerCase();
        if (view !== "mira_overview") return false;
        const host = document.getElementById("mira-overview-view");
        return !host || !host.classList.contains("hidden");
    }

    function autoRender() {
        if (shouldAutoRender()) window.renderMiraOverview();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", autoRender, { once: true });
    } else {
        autoRender();
    }
})();
