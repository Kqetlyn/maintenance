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
    let overviewLoadVersion = 0;    // bumped whenever lastOverview is (re)set — lets callers await a fresh load
    let predictiveLoadVersion = 0;  // bumped whenever predictiveLatestPayload is (re)set
    let overviewAbort = null;
    let aiAbort = null;
    let inFlightSignature = "";
    let lastLoadSignature = "";
    let latestVerdict = null;
    let latestWarnings = [];
    let warmRetries = 0;            // first-load: backend still warming caches
    let warmRetryTimer = null;
    const predictiveWordingCache = {};
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

        // Export Report button group
        const expGroup = el("div", "mira-ov-export-group");
        expGroup.append(el("span", "mira-ov-export-label", "Export Report"));

        const pptBtn = el("button", "mira-ov-export-btn", "PPT");
        pptBtn.id = "ov-export-ppt"; pptBtn.type = "button";
        pptBtn.addEventListener("click", exportOverviewPPT);

        const pdfBtn = el("button", "mira-ov-export-btn", "PDF");
        pdfBtn.id = "ov-export-pdf"; pdfBtn.type = "button";
        pdfBtn.addEventListener("click", exportOverviewPDF);

        expGroup.append(pptBtn, pdfBtn);

        // Refresh icon replaces Regenerate Summary
        const refreshBtn = el("button", "mira-ov-refresh-icon-btn", "↻");
        refreshBtn.type = "button";
        refreshBtn.title = "Regenerate Summary";
        refreshBtn.addEventListener("click", () => loadOverview({ force: true }));

        actions.append(expGroup, refreshBtn);
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
            buildStatusCard(),          // § 1 — incl. Data Quality & Daily Action Alerts
            buildKpiRow(),              // § 2
            buildPredictiveSection(),   // § 3
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

        // Daily Action Alerts (the Data Quality summary card that used to sit next
        // to this was removed — its chips just duplicated what "View Data
        // Quality" on individual alert rows already links to).
        const dqAlertsSection = el("div", "mira-ov-action-section");

        const dqHead = el("div", "mira-ov-dq-section-head");
        dqHead.append(el("div", "mira-ov-mini-label", "Daily Action Alerts"));
        const dqHeadRight = el("div", "mira-ov-daily-status");
        refs.verdictBadge = el("span", "mira-ov-status-badge", "Loading");
        refs.verdictScope = el("span", "mira-ov-verdict-scope", "");
        dqHeadRight.append(refs.verdictBadge, refs.verdictScope);
        dqHead.append(dqHeadRight);
        dqAlertsSection.append(dqHead);

        const dqGrid = el("div", "mira-ov-daily-grid mira-ov-daily-grid-single");

        const alertsCard = el("div", "mira-ov-daily-card mira-ov-daily-alert-card");
        alertsCard.append(el("div", "mira-ov-sub-card-title", "Daily Action Alerts"));
        refs.verdictSummary = el("p", "mira-ov-muted", "");
        alertsCard.append(refs.verdictSummary);
        refs.dailyAlerts = el("div", "mira-ov-daily-alerts");
        refs.dailyAlerts.id = "mira-ov-verdict-body";
        refs.dailyAlerts.innerHTML = "<div class=\"mira-ov-skeleton mira-sk-chips\"></div>";
        alertsCard.append(refs.dailyAlerts);

        dqGrid.append(alertsCard);
        dqAlertsSection.append(dqGrid);
        dqAlertsSection.append(el("p", "mira-ov-disclaimer",
            "AI-detected issues are for review only. Technician/Engineer verification is required before any action. MIRA does not assign severity."));

        // Hidden compat refs — keep actionTable alive so renderActionTable() doesn't crash
        const hidden = el("div"); hidden.hidden = true;
        refs.actionTable = el("div", "mira-ov-act-tbl");
        refs.exec = el("p", "mira-ov-exec-text");
        refs.highlights = el("ul", "mira-ov-list");
        refs.actionsToday = el("ul", "mira-ov-list");
        hidden.append(refs.actionTable, refs.exec, refs.highlights, refs.actionsToday);

        card.append(top, refs.statusPeriod, refs.headlineKpis, compactSummary, dqAlertsSection, hidden);
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
        const carryOver = num(dt.carry_over_open_mr) || num(dt.opening_backlog_count) || 0;
        const activeWorkload = (num(wo.open) || 0) + carryOver;

        // Line 1: Main concern (PM=0 gets a data-review note, not "0% compliance")
        let concern = "";
        if (status.tone === "critical") concern = "Main concern: " + (status.level || "Critical issues flagged");
        else if ((wo.open || 0) > 20) concern = "Main concern: " + fmt(wo.open) + " open MRs outstanding";
        else if (num(pm.compliance_pct) === 0) concern = "Main concern: PM completion records require verification";
        else if (num(pm.compliance_pct) !== null && pm.compliance_pct < 70) concern = "Main concern: PM compliance at " + fmt(pm.compliance_pct) + "%";
        else if (carryOver > 30) concern = "Main concern: " + fmt(carryOver) + " carry-over MRs unresolved";
        else concern = "Status: " + (status.level || "Monitoring");
        refs.summaryLine[0].textContent = concern;
        refs.summaryLine[0].className = "mira-ov-summary-line mira-ov-sl-concern";

        // Line 2: Active workload (open + carry-over)
        let reason = "";
        if (activeWorkload > 0) {
            reason = "Active workload: " + fmt(activeWorkload) + " MR";
            if ((num(wo.open) || 0) > 0 && carryOver > 0) reason += " (" + fmt(wo.open) + " open + " + fmt(carryOver) + " carry-over)";
        } else if (dt.top_functional_location_name) {
            reason = "Key area: " + dt.top_functional_location_name;
        } else {
            reason = "Closure rate: " + fmt(wo.closure_rate_pct || dt.closure_rate_pct) + "%";
        }
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

    // ── § 2  Maintenance Risk Snapshot (3 risk-action cards) ────────────────
    function buildKpiRow() {
        const sec = el("section", "mira-ov-kpi-row-section");
        sec.append(el("div", "mira-ov-section-label", "Maintenance Risk Snapshot"));
        const grid = el("div", "mira-ov-kpi-row");

        // Card definitions: [displayTitle, bodyKey, accent, navTarget, navLabel]
        // bodyKey drives mira-ov-kpi-{key} IDs used by renderSection()
        const cardDefs = [
            ["Maintenance Workload Risk",      "downtime", "orange", "downtime",  "Review Open MR"],
            ["PM / Data Reliability Review",   "pm",       "teal",   "pm",        "Verify PM Records"],
            ["Spare Parts / Procurement Risk", "spare",    "blue",   "spare",     "Review Spare Parts"],
        ];
        cardDefs.forEach(([title, key, accent, navTarget, navLabel]) => {
            const card = el("section", `mira-ov-kpi-card mira-ov-accent-${accent}`);
            const head = el("div", "mira-ov-kpi-head");
            const healthBadge = el("span", "mira-ov-health-badge mira-ov-health-unknown");
            healthBadge.id = `mira-ov-health-${key}`;
            head.append(el("div", "mira-ov-kpi-title", title), healthBadge);
            card.append(head);
            const body = el("div", "mira-ov-kpi-body"); body.id = `mira-ov-kpi-${key}`;
            body.append(el("p", "mira-ov-muted", "Loading…"));
            const shadow = el("div"); shadow.id = `mira-ov-detail-${key}`; shadow.hidden = true;
            const footer = el("div", "mira-ov-kpi-footer");
            footer.append(buildNavButton(navLabel, navTarget));
            card.append(body, shadow, footer);
            grid.append(card);
        });
        sec.append(grid);
        const strip = el("div", "mira-ov-kpi-alert-strip");
        strip.id = "mira-ov-kpi-alert-strip";
        strip.hidden = true;
        sec.append(strip);
        return sec;
    }

    // ── § 3  Predictive Issue & Spare Parts Intelligence ─────────────────────

    function buildPredictiveSection() {
        const sec = el("section", "mira-ov-pred-section");
        sec.append(el("div", "mira-ov-section-label", "Predictive Maintenance Insights"));
        sec.append(el("p", "mira-ov-pred-subtitle",
            "Management overview of at-a-glance asset risk, built from verified WO/MR history, MTBF movement, criticality, aged open work orders, and linked spare-part consumption."));
        sec.append(el("p", "mira-ov-disclaimer",
            "Calculated risk is shown first. AI wording is limited to short summaries of the structured card data; no open-ended chat is used. Management reviews this information and decides any action — the table does not suggest one."));

        const kpiStrip = el("div", "mira-pred-kpi-strip");
        kpiStrip.id = "mira-pred-kpi-strip";
        sec.append(kpiStrip);

        const filterBar = el("div", "mira-pred-filter-bar");
        filterBar.id = "mira-pred-filter-bar";
        sec.append(filterBar);

        const catsWrap = el("div", "mira-pred-cats-wrap");
        catsWrap.id = "mira-pred-cats-body";
        catsWrap.innerHTML = "<div class=\"mira-ov-skeleton mira-sk-line mira-sk-lg\" style=\"height:120px\"></div>";
        sec.append(catsWrap);

        const footRow = el("div", "mira-pred-foot-row");
        const methodologyLink = el("button", "mira-pred-methodology-link", "How risk is calculated");
        methodologyLink.type = "button";
        methodologyLink.addEventListener("click", _openRiskMethodologyModal);
        footRow.append(methodologyLink);
        const dataUpdated = el("span", "mira-pred-data-updated");
        dataUpdated.id = "mira-pred-data-updated";
        footRow.append(dataUpdated);
        sec.append(footRow);
        return sec;
    }

    // ── Predictive table: filter/priority state (client-side only — same
    // cards array the KPI strip, table, and Watchlist all read, per the
    // spec's "every KPI/row must follow active filters" requirement) ────────
    let predictiveFilterState = {
        assetCategory: "", machineGroup: "", riskLevel: "", criticality: "", partsStatus: "",
        recurrencePeriod: "", search: "", kpi: "",
    };
    const PRIORITY_ROW_LIMIT = 5;
    const PRED_ASSET_CATEGORY_UNKNOWN = "Unknown / Unclassified";
    const PRED_ASSET_CATEGORY_OPTIONS = [
        ["", "All"],
        ["Production Equipment", "Production Equipment"],
        ["Utilities", "Utilities"],
        [PRED_ASSET_CATEGORY_UNKNOWN, PRED_ASSET_CATEGORY_UNKNOWN],
    ];
    const PRED_PRODUCTION_GROUP_KEYS = new Set([
        "air blast chiller", "air blast chillers", "air blast freezer", "air blast freezers",
        "batch fryer", "batch fryers", "bowl cutter", "bowl cutters", "bowl cutter chopper",
        "bratt pan", "bratt pans", "checkweigher", "checkweighers", "combi oven", "combi ovens",
        "conveyor", "conveyors", "crimping machine", "crimping machines", "digital weighing scale",
        "digital weighing scales", "fryer", "fryers", "index conveyor", "index conveyors",
        "inline printer", "inline printers", "peeler", "peelers", "spiral freezer", "spiral freezers",
        "steam box", "steam boxes", "steambox", "steamboxes", "transport conveyor",
        "transport conveyors", "vacuum tumbler", "vacuum tumblers", "x ray",
    ]);
    const PRED_UTILITY_GROUP_KEYS = new Set([
        "air compressor", "air compressors", "air dryer", "air dryers", "boiler", "boilers",
        "boiler compressed air", "building utilities", "carbon filter tank", "carbon filter tanks",
        "cold room condenser", "cold room condensers", "electrical", "electrical distribution",
        "evaporator", "evaporators", "facility building", "fire safety", "generator", "generators",
        "hot oil boiler", "hot oil boilers", "hvac", "ice maker", "ice makers", "laundry", "mdb",
        "mdb electrical distribution", "pressure vessel", "pressure vessels", "refrigeration",
        "resin tank", "resin tanks", "ro filter ro system", "sand filter tank", "sand filter tanks",
        "steam boiler", "steam boilers", "transfer pump", "transfer pumps", "uv machine",
        "uv machines", "wastewater treatment", "water system", "water treatment", "wwtp",
    ]);

    function _predCategoryKey(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/&/g, " and ")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function _predGroupBucketFromKey(groupKey) {
        if (!groupKey) return "";
        if (PRED_PRODUCTION_GROUP_KEYS.has(groupKey)) return "Production Equipment";
        if (PRED_UTILITY_GROUP_KEYS.has(groupKey)) return "Utilities";
        return "";
    }

    function _predAssetCategory(card) {
        const explicit = String(card.asset_category || card.assetCategory || "").trim();
        if (explicit === "Production Equipment" || explicit === "Utilities" || explicit === PRED_ASSET_CATEGORY_UNKNOWN) {
            return explicit;
        }
        const categoryKey = _predCategoryKey(card.category);
        const groupBucket = _predGroupBucketFromKey(_predCategoryKey(card.machine_group));
        if (categoryKey === "production equipment") return "Production Equipment";
        if (categoryKey === "utilities" || categoryKey === "utilities support") return "Utilities";
        if (categoryKey === "facility building") return "Utilities";
        if (categoryKey === "refrigeration") return groupBucket || "Utilities";
        if (!categoryKey || categoryKey === "unknown" || categoryKey === "unknown review" || categoryKey === "unclassified") {
            return groupBucket || PRED_ASSET_CATEGORY_UNKNOWN;
        }
        return groupBucket || PRED_ASSET_CATEGORY_UNKNOWN;
    }

    function _fmtDataUpdated(iso) {
        if (!iso) return "Data updated: unavailable";
        const d = new Date(iso);
        if (isNaN(d.getTime())) return "Data updated: unavailable";
        const MS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const dd = String(d.getDate()).padStart(2, "0");
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        return `Data updated: ${dd} ${MS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
    }

    // ── Risk score methodology modal ─────────────────────────────────────────
    // Reads the same risk_rules.factors the page's "Scoring Rules" card and the
    // drawer's Overview tab already use — one shared source, never re-typed.
    let _methodologyModalEl = null;
    function _ensureMethodologyModal() {
        if (_methodologyModalEl) return;
        const overlay = el("div", "mira-pred-methodology-overlay");
        overlay.addEventListener("click", (e) => { if (e.target === overlay) _closeRiskMethodologyModal(); });
        const modal = el("div", "mira-pred-methodology-modal");
        const head = el("div", "mira-pred-methodology-head");
        head.append(el("span", null, "Risk Score Methodology"));
        const closeBtn = el("button", "mira-pred-drawer-close", "×");
        closeBtn.type = "button";
        closeBtn.setAttribute("aria-label", "Close");
        closeBtn.addEventListener("click", _closeRiskMethodologyModal);
        head.append(closeBtn);
        const body = el("div", "mira-pred-methodology-body");
        body.id = "mira-pred-methodology-body";
        modal.append(head, body);
        overlay.append(modal);
        document.body.appendChild(overlay);
        _methodologyModalEl = overlay;
    }
    function _openRiskMethodologyModal() {
        _ensureMethodologyModal();
        const body = document.getElementById("mira-pred-methodology-body");
        body.innerHTML = "";
        const rules = (predictiveLatestPayload && predictiveLatestPayload.risk_rules) || {};
        const factors = rules.factors || [];
        const levels = rules.levels || {};
        body.append(el("p", "mira-ov-muted", "Every asset starts at 0. Each triggered factor below adds its points; the total maps to a risk level."));
        factors.forEach((r) => {
            const row = el("div", "mira-pred-methodology-row");
            row.append(el("strong", null, `+${r.points} — ${r.label}`));
            row.append(el("p", null, r.description || ""));
            body.append(row);
        });
        const levelsRow = el("div", "mira-pred-methodology-row");
        levelsRow.append(el("strong", null, "Risk levels"));
        levelsRow.append(el("p", null, Object.entries(levels).map(([range, label]) => `${range} = ${label}`).join("   ·   ") || "Not available"));
        body.append(levelsRow);
        _methodologyModalEl.classList.add("mira-pred-methodology-open");
    }
    function _closeRiskMethodologyModal() {
        if (_methodologyModalEl) _methodologyModalEl.classList.remove("mira-pred-methodology-open");
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
        if (Array.isArray(d.cards)) {
            _renderPredRiskCards(d);
            return;
        }
        _renderPredCategories(d);
        _renderPredFault(d);
        _renderPredConfidence(d);
    }

    function _riskTone(level) {
        const text = String(level || "").toLowerCase();
        if (text === "high") return "high";
        if (text === "medium") return "medium";
        return "low";
    }

    // Per-session cache for "View Details" fetches, keyed by asset id/name.
    // Cleared whenever the page reloads predictive data (filters changed), since
    // a stale detail from a different filter scope would be misleading.
    let _assetDetailCache = new Map();

    function _renderPredRiskCards(d) {
        predictiveLatestPayload = d;
        predictiveLoadVersion += 1;
        _assetDetailCache = new Map();
        const body = document.getElementById("mira-pred-cats-body");
        const cards = d.cards || [];

        const dataUpdatedEl = document.getElementById("mira-pred-data-updated");
        if (dataUpdatedEl) dataUpdatedEl.textContent = _fmtDataUpdated(d.data_last_updated);

        _renderPredFilterBar(cards);
        _renderPredTableAndKpis(cards);

        if (!body) return;
        if (!cards.length) {
            body.innerHTML = "";
            body.append(el("p", "mira-ov-muted", "No predictive risk signals met the scoring threshold for the selected period."));
        }
    }

    // ── KPI computation. Counts are taken over cards matching every OTHER
    // active filter (machine group/risk/criticality/parts/recurrence/search)
    // but not the KPI chip's own toggle — a faceted-search count, so a KPI's
    // number reflects "how many would show if you clicked this" rather than
    // collapsing to itself once already active. Same predicate the table
    // filter uses (_cardMatchesKpi), so the strip and table can never disagree. ──
    function _cardMatchesKpi(card, kpiKey) {
        switch (kpiKey) {
            case "high_risk": return card.risk_level === "High";
            case "due_soon": {
                const occ = (card.latest_recurring_issue_pattern || {}).next_likely_occurrence;
                return !!(occ && occ.expected_within_7_days);
            }
            case "parts_unavailable": {
                if (card.criticality !== "Critical" || !card.parts_readiness_computed) return false;
                const st = (card.parts_readiness || {}).status;
                return st === "out_of_stock" || st === "not_linked";
            }
            case "mtbf_declining": return (card.mtbf_trend || {}).state === "declining";
            case "aged_critical_wo": return card.criticality === "Critical" && ((card.open_wo_status || {}).oldest_age_days || 0) > 7;
            default: return true;
        }
    }

    const _PRED_KPI_DEFS = [
        ["high_risk", "High-risk assets"],
        ["due_soon", "Expected to recur within 7 days"],
        ["parts_unavailable", "Critical assets, spare parts unavailable"],
        ["mtbf_declining", "Assets with declining MTBF"],
        ["aged_critical_wo", "Critical open WOs older than 7 days"],
    ];

    function _renderPredManagementKpiStrip(cards) {
        const strip = document.getElementById("mira-pred-kpi-strip");
        if (!strip) return;
        strip.innerHTML = "";
        const scoped = cards.filter((c) => _cardMatchesFilters(c, { ignoreKpi: true }));
        _PRED_KPI_DEFS.forEach(([key, label]) => {
            const count = scoped.filter((c) => _cardMatchesKpi(c, key)).length;
            const chip = el("button", "mira-pred-kpi-chip" + (predictiveFilterState.kpi === key ? " active" : ""));
            chip.type = "button";
            chip.append(el("span", "mira-pred-kpi-count", String(count)));
            chip.append(el("span", "mira-pred-kpi-label", label));
            chip.addEventListener("click", () => {
                predictiveFilterState.kpi = predictiveFilterState.kpi === key ? "" : key;
                _renderPredTableAndKpis(predictiveLatestPayload ? (predictiveLatestPayload.cards || []) : cards);
            });
            strip.append(chip);
        });
    }

    // ── Filter bar (client-side over the already-fetched cards array; Stage
    // itself is the page-level selector already driving this fetch, so it's
    // not duplicated here) ───────────────────────────────────────────────────
    function _renderPredFilterBar(cards) {
        const bar = document.getElementById("mira-pred-filter-bar");
        if (!bar) return;
        bar.innerHTML = "";

        const categoryScopedCards = predictiveFilterState.assetCategory
            ? cards.filter((c) => _predAssetCategory(c) === predictiveFilterState.assetCategory)
            : cards;
        const machineGroups = Array.from(new Set(categoryScopedCards.map((c) => c.machine_group).filter(Boolean))).sort();
        if (predictiveFilterState.machineGroup && !machineGroups.includes(predictiveFilterState.machineGroup)) {
            predictiveFilterState.machineGroup = "";
        }

        function makeSelect(labelText, options, currentVal, onChange) {
            const wrap = el("label", "mira-pred-filter-field");
            wrap.append(el("span", "mira-pred-filter-label", labelText));
            const sel = el("select", "mira-pred-filter-select");
            options.forEach(([val, text]) => {
                const o = el("option", null, text);
                o.value = val;
                if (val === currentVal) o.selected = true;
                sel.append(o);
            });
            sel.addEventListener("change", () => onChange(sel.value));
            wrap.append(sel);
            return wrap;
        }

        bar.append(makeSelect("Asset category", PRED_ASSET_CATEGORY_OPTIONS,
            predictiveFilterState.assetCategory, (v) => {
                predictiveFilterState.assetCategory = v;
                const allowedGroups = new Set((v ? cards.filter((c) => _predAssetCategory(c) === v) : cards)
                    .map((c) => c.machine_group).filter(Boolean));
                if (predictiveFilterState.machineGroup && !allowedGroups.has(predictiveFilterState.machineGroup)) {
                    predictiveFilterState.machineGroup = "";
                }
                _renderPredFilterBar(cards);
                _renderPredTableAndKpis(cards);
            }));

        bar.append(makeSelect("Machine group", [["", "All"]].concat(machineGroups.map((g) => [g, g])),
            predictiveFilterState.machineGroup, (v) => { predictiveFilterState.machineGroup = v; _renderPredTableAndKpis(cards); }));

        bar.append(makeSelect("Risk level", [["", "All"], ["High", "High"], ["Medium", "Medium"], ["Low", "Low"]],
            predictiveFilterState.riskLevel, (v) => { predictiveFilterState.riskLevel = v; _renderPredTableAndKpis(cards); }));

        bar.append(makeSelect("Criticality", [["", "All"], ["Critical", "Critical"], ["Non-critical", "Non-critical"], ["Unknown", "Unknown"]],
            predictiveFilterState.criticality, (v) => { predictiveFilterState.criticality = v; _renderPredTableAndKpis(cards); }));

        bar.append(makeSelect("Parts status", [
            ["", "All"], ["available", "Available"], ["low_stock", "Low stock"], ["out_of_stock", "Out of stock"],
            ["not_linked", "Not linked"], ["unknown", "Stock data unavailable"],
        ], predictiveFilterState.partsStatus, (v) => { predictiveFilterState.partsStatus = v; _renderPredTableAndKpis(cards); }));

        bar.append(makeSelect("Expected recurrence", [
            ["", "All"], ["7d", "Within 7 days"], ["30d", "Within 30 days"], ["insufficient", "Insufficient history"],
        ], predictiveFilterState.recurrencePeriod, (v) => { predictiveFilterState.recurrencePeriod = v; _renderPredTableAndKpis(cards); }));

        const searchWrap = el("label", "mira-pred-filter-field mira-pred-filter-search");
        searchWrap.append(el("span", "mira-pred-filter-label", "Search"));
        const searchInput = el("input", "mira-pred-filter-select");
        searchInput.type = "search";
        searchInput.placeholder = "Asset name or ID…";
        searchInput.value = predictiveFilterState.search;
        searchInput.addEventListener("input", () => { predictiveFilterState.search = searchInput.value; _renderPredTableAndKpis(cards); });
        searchWrap.append(searchInput);
        bar.append(searchWrap);

        if (predictiveFilterState.kpi || predictiveFilterState.assetCategory || predictiveFilterState.machineGroup || predictiveFilterState.riskLevel ||
            predictiveFilterState.criticality || predictiveFilterState.partsStatus || predictiveFilterState.recurrencePeriod ||
            predictiveFilterState.search) {
            const clearBtn = el("button", "mira-pred-filter-clear", "Clear filters");
            clearBtn.type = "button";
            clearBtn.addEventListener("click", () => {
                predictiveFilterState = { assetCategory: "", machineGroup: "", riskLevel: "", criticality: "", partsStatus: "", recurrencePeriod: "", search: "", kpi: "" };
                _renderPredFilterBar(cards);
                _renderPredTableAndKpis(cards);
            });
            bar.append(clearBtn);
        }
    }

    function _cardMatchesFilters(card, opts) {
        const f = predictiveFilterState;
        const skipKpi = opts && opts.ignoreKpi;
        if (f.assetCategory && _predAssetCategory(card) !== f.assetCategory) return false;
        if (f.machineGroup && card.machine_group !== f.machineGroup) return false;
        if (f.riskLevel && card.risk_level !== f.riskLevel) return false;
        if (f.criticality && card.criticality !== f.criticality) return false;
        if (f.partsStatus && (card.parts_readiness || {}).status !== f.partsStatus) return false;
        if (f.recurrencePeriod) {
            const occ = (card.latest_recurring_issue_pattern || {}).next_likely_occurrence;
            const days = occ ? occ.days_until_next_likely : null;
            if (f.recurrencePeriod === "7d" && !(days !== null && days !== undefined && days <= 7)) return false;
            if (f.recurrencePeriod === "30d" && !(days !== null && days !== undefined && days <= 30)) return false;
            if (f.recurrencePeriod === "insufficient" && !(!occ || occ.confidence === "Insufficient history")) return false;
        }
        if (f.search) {
            const needle = f.search.trim().toLowerCase();
            const hay = `${card.asset_name || ""} ${card.asset_id || ""}`.toLowerCase();
            if (needle && !hay.includes(needle)) return false;
        }
        if (!skipKpi && f.kpi && !_cardMatchesKpi(card, f.kpi)) return false;
        return true;
    }

    // ── Priority ordering (spec §3: risk, criticality, parts availability,
    // recurrence proximity, declining MTBF, oldest open WO — in that order) ──
    function _priorityRank(card) {
        const riskRank = { High: 0, Medium: 1, Low: 2 }[card.risk_level] ?? 3;
        const critRank = { Critical: 0, "Non-critical": 1, Unknown: 2 }[card.criticality] ?? 2;
        const partsRank = { out_of_stock: 0, low_stock: 1, not_linked: 2, unknown: 3, available: 4 }[(card.parts_readiness || {}).status] ?? 3;
        const occ = (card.latest_recurring_issue_pattern || {}).next_likely_occurrence;
        const days = occ ? occ.days_until_next_likely : null;
        const recurrenceRank = (days === null || days === undefined) ? 100000 : days;
        const mtbfRank = (card.mtbf_trend || {}).state === "declining" ? 0 : 1;
        const openWoRank = -(((card.open_wo_status || {}).oldest_age_days) || 0);
        return [riskRank, critRank, partsRank, recurrenceRank, mtbfRank, openWoRank];
    }
    function _comparePriority(a, b) {
        const ra = _priorityRank(a), rb = _priorityRank(b);
        for (let i = 0; i < ra.length; i++) { if (ra[i] !== rb[i]) return ra[i] - rb[i]; }
        return (a.asset_name || "").localeCompare(b.asset_name || "");
    }

    let watchlistExpanded = false;

    function _renderPredTableAndKpis(cards) {
        _renderPredManagementKpiStrip(cards);
        const filtered = cards.filter(_cardMatchesFilters);
        const ordered = filtered.slice().sort(_comparePriority);
        const priority = ordered.slice(0, PRIORITY_ROW_LIMIT);
        const watchlist = ordered.slice(PRIORITY_ROW_LIMIT);
        _renderPredTable(priority, watchlist, filtered.length, cards.length);
    }

    const _PRED_TABLE_COLUMNS = ["Asset & Risk", "Failure Timing", "Recurring Issue", "Reliability", "Operational Impact", "Spare-Parts Readiness", "Details"];

    function _renderPredTable(priority, watchlist, filteredCount, totalCount) {
        const body = document.getElementById("mira-pred-cats-body");
        if (!body) return;
        body.innerHTML = "";

        if (!filteredCount) {
            body.append(el("p", "mira-ov-muted", "No assessed assets match the selected filters."));
            return;
        }

        const summaryLine = el("p", "mira-ov-muted mira-pred-table-summary",
            `Showing ${filteredCount} of ${totalCount} assessed assets.`);
        body.append(summaryLine);

        body.append(el("div", "mira-pred-table-section-label", `PRIORITY ASSETS (${priority.length})`));
        body.append(_buildPredTable(priority));

        if (watchlist.length) {
            const wlHead = el("button", "mira-pred-watchlist-toggle",
                `${watchlistExpanded ? "▾" : "▸"} Watchlist — ${watchlist.length} asset${watchlist.length === 1 ? "" : "s"}${watchlistExpanded ? "" : " [Expand]"}`);
            wlHead.type = "button";
            wlHead.addEventListener("click", () => {
                watchlistExpanded = !watchlistExpanded;
                _renderPredTableAndKpis(predictiveLatestPayload ? (predictiveLatestPayload.cards || []) : []);
            });
            body.append(wlHead);
            if (watchlistExpanded) body.append(_buildPredTable(watchlist));
        }
    }

    function _buildPredTable(rows) {
        const table = el("table", "mira-pred-table");
        const thead = el("thead");
        const headRow = el("tr");
        _PRED_TABLE_COLUMNS.forEach((c) => headRow.append(el("th", null, c)));
        thead.append(headRow);
        table.append(thead);
        const tbody = el("tbody");
        rows.forEach((card) => tbody.append(_buildPredTableRow(card)));
        table.append(tbody);
        return table;
    }

    function _partsReadinessTone(status) {
        if (status === "out_of_stock") return "high";
        if (status === "low_stock") return "medium";
        if (status === "available") return "low";
        return "neutral";
    }

    function _buildPredTableRow(card) {
        const tone = _riskTone(card.risk_level);
        const tr = el("tr", "mira-pred-row mira-pred-row-" + tone);

        // Asset & Risk
        const c1 = el("td", "mira-pred-cell");
        c1.append(el("div", "mira-pred-cell-strong", card.asset_name || "Unknown asset"));
        // Machine group is sometimes identical to the asset's own name (single-unit
        // groups) — skip the redundant sub-line rather than repeating the title.
        if (card.machine_group && card.machine_group !== card.asset_name) {
            c1.append(el("div", "mira-pred-cell-sub", card.machine_group));
        }
        c1.append(el("span", "mira-ov-risk-badge mira-ov-risk-" + tone, `${card.risk_level || "Low"} · ${card.risk_score || 0}`));
        c1.append(el("div", "mira-pred-cell-sub", card.criticality || "Unknown"));
        tr.append(c1);

        // Failure Timing
        const c2 = el("td", "mira-pred-cell");
        const lastFail = card.last_failure;
        c2.append(el("div", null, lastFail ? `Last failure: ${lastFail.date} (${lastFail.days_ago}d ago)` : "Last failure: none recorded"));
        const occ = (card.latest_recurring_issue_pattern || {}).next_likely_occurrence;
        if (occ) {
            c2.append(el("div", "mira-pred-cell-sub", `Expected recurrence: ${occ.label || occ.confidence}`));
            if (occ.confidence !== "Insufficient history") c2.append(el("div", "mira-pred-cell-sub", `Confidence: ${occ.confidence}`));
        } else {
            c2.append(el("div", "mira-pred-cell-sub", "Expected recurrence: Insufficient history"));
        }
        tr.append(c2);

        // Recurring Issue
        const c3 = el("td", "mira-pred-cell");
        const pattern = card.latest_recurring_issue_pattern || {};
        c3.append(el("div", null, pattern.issue && pattern.issue !== "Unclassified" ? pattern.issue : "No confirmed recurring issue"));
        if (pattern.count > 1) c3.append(el("div", "mira-pred-cell-sub", `${pattern.count} similar occurrences`));
        tr.append(c3);

        // Reliability
        const c4 = el("td", "mira-pred-cell");
        const mtbf = card.mtbf_trend || {};
        if (mtbf.state === "insufficient" || mtbf.current_days === null || mtbf.current_days === undefined) {
            c4.append(el("div", null, "MTBF: Insufficient data"));
        } else {
            const arrow = mtbf.state === "declining" ? "↓" : mtbf.state === "improving" ? "↑" : "→";
            const pct = mtbf.pct_change !== null && mtbf.pct_change !== undefined ? `${arrow}${Math.abs(mtbf.pct_change)}%` : "";
            const basis = mtbf.basis_label || "previous period";
            c4.append(el("div", null, `MTBF: ${mtbf.current_days}d${pct ? " / " + pct : ""}`));
            c4.append(el("div", "mira-pred-cell-sub",
                mtbf.state === "current_only"
                    ? `Past 12 months; ${basis} unavailable`
                    : mtbf.state.charAt(0).toUpperCase() + mtbf.state.slice(1) + " vs " + basis));
        }
        tr.append(c4);

        // Operational Impact
        const c5 = el("td", "mira-pred-cell");
        c5.append(el("div", null, `Criticality: ${card.criticality || "Unknown"}`));
        c5.append(el("div", "mira-pred-cell-sub", (card.redundancy || {}).label || "Redundancy: Unknown"));
        tr.append(c5);

        // Spare-Parts Readiness
        const c6 = el("td", "mira-pred-cell");
        const pr = card.parts_readiness || { status: "unknown", label: "Stock data unavailable" };
        const prTone = _partsReadinessTone(pr.status);
        const prBadge = el("span", "mira-ov-risk-badge mira-ov-risk-" + prTone, pr.label);
        c6.append(prBadge);
        if (!card.parts_readiness_computed) c6.append(el("div", "mira-pred-cell-sub", "Calculating…"));
        tr.append(c6);

        // Details
        const c7 = el("td", "mira-pred-cell mira-pred-cell-details");
        const viewBtn = el("button", "mira-pred-view-details-btn", "View details →");
        viewBtn.type = "button";
        viewBtn.addEventListener("click", () => _openAssetDetailDrawer(card));
        c7.append(viewBtn);
        tr.append(c7);

        return tr;
    }

    // ── "View Details" drill-down drawer ─────────────────────────────────────
    // Reuses _ensureForecastDrawer()'s overlay/close-button shell (built for the
    // older, now-dead forecast pipeline) — same visual language, new content.
    const _ASSET_DETAIL_TABS = [
        ["overview", "Overview"],
        ["work_orders", "Work Orders"],
        ["spare_parts", "Spare Parts"],
        ["trends", "Trends"],
        ["recommendations", "Recommendations"],
    ];

    function _fetchAssetPredictiveDetail(card) {
        const cacheKey = card.asset_id || card.asset_name;
        if (_assetDetailCache.has(cacheKey)) return _assetDetailCache.get(cacheKey);
        const qs = new URLSearchParams();
        Object.entries(currentFilters()).forEach(([k, v]) => {
            if (v !== null && v !== undefined && v !== "") qs.set(k, v);
        });
        const detailUrl = `${API}/predictive/assets/${encodeURIComponent(cacheKey)}/details?${qs.toString()}`;
        const req = fetchJsonWithTimeout(
            detailUrl,
            { method: "GET", cache: "no-store" },
            // The spare-parts lookup this pulls in can be slow on a cold cache
            // (first request after a server restart) — generous timeout so a
            // one-time slow build doesn't look like a broken drawer.
            60000
        ).promise.then((json) => (json && json.data) || null);
        // Don't cache a rejected promise — a transient failure shouldn't
        // permanently poison this asset for the rest of the session.
        req.catch(() => _assetDetailCache.delete(cacheKey));
        _assetDetailCache.set(cacheKey, req);
        return req;
    }

    function _openAssetDetailDrawer(card) {
        _ensureForecastDrawer();
        _forecastDrawerTitleEl.textContent = card.asset_name || "Asset detail";
        _forecastDrawerBodyEl.innerHTML = "";
        _forecastDrawerBodyEl.scrollTop = 0;
        _forecastDrawerBodyEl.classList.add("mira-pred-detail-body");

        const tone = _riskTone(card.risk_level);
        const header = el("div", "mira-pred-detail-header");
        const headTop = el("div", "mira-pred-detail-header-top");
        const nameBlock = el("div");
        nameBlock.append(el("h3", null, card.asset_name || "Unknown asset"));
        if (card.machine_group && card.machine_group !== card.asset_name) {
            nameBlock.append(el("p", "mira-pred-detail-machine-group", card.machine_group));
        }
        headTop.append(nameBlock, el("span", "mira-ov-risk-badge mira-ov-risk-" + tone, `${card.risk_level || "Low"} · ${card.risk_score || 0}/10`));
        header.append(headTop);

        const metaRow = el("div", "mira-pred-detail-header-meta");
        const criticalNow = (card.main_signals || []).some((s) => s.label === "Asset marked critical");
        [
            ["Critical asset", criticalNow ? "Yes" : "No"],
            ["Status", "Loading…"],
            ["Last updated", "—"],
        ].forEach(([label, value]) => {
            const chip = el("div", "mira-pred-detail-meta-chip");
            chip.append(el("span", null, label), el("strong", null, value));
            metaRow.append(chip);
        });
        header.append(metaRow);
        _forecastDrawerBodyEl.append(header);

        const tabNav = el("div", "mira-pred-detail-tabs");
        tabNav.setAttribute("role", "tablist");
        const panels = el("div", "mira-pred-detail-panels");
        const panelEls = {};
        _ASSET_DETAIL_TABS.forEach(([key, label], idx) => {
            const btn = el("button", "mira-pred-detail-tab" + (idx === 0 ? " active" : ""), label);
            btn.type = "button";
            btn.setAttribute("role", "tab");
            btn.dataset.detailTab = key;
            btn.addEventListener("click", () => {
                tabNav.querySelectorAll(".mira-pred-detail-tab").forEach((b) => b.classList.toggle("active", b === btn));
                Object.entries(panelEls).forEach(([k, p]) => p.classList.toggle("mira-pred-detail-panel-active", k === key));
            });
            tabNav.append(btn);
            const panel = el("div", "mira-pred-detail-panel" + (idx === 0 ? " mira-pred-detail-panel-active" : ""));
            panel.dataset.detailPanel = key;
            panel.append(el("div", "mira-ov-skeleton mira-sk-line mira-sk-lg"));
            panelEls[key] = panel;
            panels.append(panel);
        });
        _forecastDrawerBodyEl.append(tabNav, panels);
        _forecastDrawerEl.classList.add("mira-pred-drawer-open");

        // Overview renders immediately from data already on `card` (no fetch
        // needed for this part), then upgrades in place once the detail call
        // resolves. Other tabs render a real (not fake) "not available yet"
        // state from the same response, per the drill-down's phased rollout.
        panelEls.overview.innerHTML = "";
        panelEls.overview.append(_buildAssetOverviewTab(card, null));

        _fetchAssetPredictiveDetail(card).then((detail) => {
            if (!_forecastDrawerEl.classList.contains("mira-pred-drawer-open")) return; // closed meanwhile
            const statusChip = metaRow.children[1]?.querySelector("strong");
            const updatedChip = metaRow.children[2]?.querySelector("strong");
            if (statusChip) statusChip.textContent = (detail && detail.asset && detail.asset.status) || "Not available";
            if (updatedChip) updatedChip.textContent = (detail && detail.last_updated) || "Not available";
            panelEls.overview.innerHTML = "";
            panelEls.overview.append(_buildAssetOverviewTab(card, detail));

            panelEls.work_orders.innerHTML = "";
            panelEls.work_orders.append(
                detail && detail.work_orders
                    ? _buildAssetWorkOrdersTab(card, detail.work_orders)
                    : _buildAssetPlaceholderTab("Work Orders", null)
            );
            panelEls.spare_parts.innerHTML = "";
            panelEls.spare_parts.append(
                detail && detail.spare_parts
                    ? _buildAssetSparePartsTab(detail.spare_parts)
                    : _buildAssetPlaceholderTab("Spare Parts", null)
            );
            panelEls.trends.innerHTML = "";
            panelEls.trends.append(
                detail && detail.trends
                    ? _buildAssetTrendsTab(detail.trends)
                    : _buildAssetPlaceholderTab("Trends", null)
            );
            panelEls.recommendations.innerHTML = "";
            panelEls.recommendations.append(
                detail && detail.recommendations
                    ? _buildAssetRecommendationsTab(detail.recommendations)
                    : _buildAssetPlaceholderTab("Recommendations", null)
            );

            // AI Insight loads separately (own endpoint, own timeout) so a slow
            // or unavailable LLM never blocks the rest of the drawer — the
            // Overview tab already shows the rule-based fallback immediately.
            if (detail) _fetchAssetAiInsight(card).then((insight) => {
                if (!insight) return;
                const aiBody = _forecastDrawerBodyEl.querySelector('[data-ai-insight-body]');
                if (aiBody) aiBody.textContent = insight;
            }).catch(() => {});
        }).catch(() => {
            if (!_forecastDrawerEl.classList.contains("mira-pred-drawer-open")) return; // closed meanwhile
            // Reset the chips stuck on "Loading…" and show a real error state on
            // every tab rather than leaving them spinning forever.
            const statusChip = metaRow.children[1]?.querySelector("strong");
            const updatedChip = metaRow.children[2]?.querySelector("strong");
            if (statusChip) statusChip.textContent = "Unavailable";
            if (updatedChip) updatedChip.textContent = "Unavailable";
            panelEls.overview.innerHTML = "";
            panelEls.overview.append(el("p", "mira-ov-muted", "Could not load full asset detail. Showing what's available from the risk card."));
            panelEls.overview.append(_buildAssetOverviewTab(card, null));
            ["work_orders", "spare_parts", "trends", "recommendations"].forEach((key) => {
                panelEls[key].innerHTML = "";
                panelEls[key].append(_buildAssetPlaceholderTab(_ASSET_DETAIL_TABS.find(([k]) => k === key)[1], null));
            });
        });
    }

    function _fetchAssetAiInsight(card) {
        const cacheKey = "ai:" + (card.asset_id || card.asset_name);
        if (_assetDetailCache.has(cacheKey)) return _assetDetailCache.get(cacheKey);
        const qs = new URLSearchParams();
        Object.entries(currentFilters()).forEach(([k, v]) => {
            if (v !== null && v !== undefined && v !== "") qs.set(k, v);
        });
        const req = fetchJsonWithTimeout(
            `${API}/predictive/assets/${encodeURIComponent(card.asset_id || card.asset_name)}/ai-insight?${qs.toString()}`,
            { method: "GET", cache: "no-store" },
            12000
        ).promise.then((json) => (json && json.ai_insight) || null);
        _assetDetailCache.set(cacheKey, req);
        return req;
    }

    // ── Work Orders tab ──────────────────────────────────────────────────────
    function _buildAssetWorkOrdersTab(card, rows) {
        const wrap = el("div", "mira-pred-wo-tab");
        if (!rows.length) {
            const empty = el("div", "mira-pred-detail-empty");
            empty.append(el("p", "mira-ov-muted", "No work order history for this asset."));
            wrap.append(empty);
            return wrap;
        }

        const state = { range: "12m", type: "all", status: "all", customFrom: "", customTo: "" };
        const toolbar = el("div", "mira-pred-wo-toolbar");

        const rangeSel = el("select", "mira-pred-wo-filter");
        [["30d", "Last 30 days"], ["90d", "Last 90 days"], ["12m", "Last 12 months"], ["custom", "Custom range"], ["all", "All history"]]
            .forEach(([val, label]) => { const o = el("option", null, label); o.value = val; rangeSel.append(o); });
        rangeSel.value = state.range;

        const customWrap = el("span", "mira-pred-wo-custom hidden");
        const fromInput = el("input"); fromInput.type = "date";
        const toInput = el("input"); toInput.type = "date";
        customWrap.append(fromInput, el("span", null, "–"), toInput);

        const typeSel = el("select", "mira-pred-wo-filter");
        [["all", "Corrective + Preventive"], ["Corrective", "Corrective only"], ["Preventive", "Preventive only"]]
            .forEach(([val, label]) => { const o = el("option", null, label); o.value = val; typeSel.append(o); });

        const statusSel = el("select", "mira-pred-wo-filter");
        [["all", "Open + Closed"], ["open", "Open only"], ["closed", "Closed only"]]
            .forEach(([val, label]) => { const o = el("option", null, label); o.value = val; statusSel.append(o); });

        const exportBtn = el("button", "mira-pred-wo-export", "Export XLSX");
        exportBtn.type = "button";

        toolbar.append(rangeSel, customWrap, typeSel, statusSel, exportBtn);
        wrap.append(toolbar);

        const countLine = el("p", "mira-ov-muted mira-pred-wo-count");
        wrap.append(countLine);

        const tableWrap = el("div", "mira-pred-wo-table-wrap");
        wrap.append(tableWrap);

        function filtered() {
            const now = new Date();
            let from = null;
            if (state.range === "30d") from = new Date(now.getTime() - 30 * 86400000);
            else if (state.range === "90d") from = new Date(now.getTime() - 90 * 86400000);
            else if (state.range === "12m") from = new Date(now.getTime() - 365 * 86400000);
            else if (state.range === "custom" && state.customFrom) from = new Date(state.customFrom);
            const to = state.range === "custom" && state.customTo ? new Date(state.customTo) : null;

            return rows.filter((r) => {
                if (from || to) {
                    if (!r.date) return false;
                    const d = new Date(r.date);
                    if (from && d < from) return false;
                    if (to && d > to) return false;
                }
                if (state.type !== "all" && r.type !== state.type) return false;
                if (state.status === "open" && !r.is_open) return false;
                if (state.status === "closed" && r.is_open) return false;
                return true;
            });
        }

        function renderTable() {
            const list = filtered(); // already sorted newest-first by the backend
            countLine.textContent = `${list.length.toLocaleString()} of ${rows.length.toLocaleString()} work orders`;
            tableWrap.innerHTML = "";
            if (!list.length) {
                tableWrap.append(el("p", "mira-ov-muted", "No work orders match the current filters."));
                return;
            }
            const table = el("table", "mira-pred-wo-table");
            table.innerHTML = "<thead><tr>"
                + ["Date", "MR / WO", "Type", "Issue Category", "Status", "Severity", "Downtime (h)", "Owner", ""]
                    .map((h) => `<th>${escOv(h)}</th>`).join("")
                + "</tr></thead>";
            const tbody = el("tbody");
            list.slice(0, 300).forEach((r) => {
                const tr = el("tr");
                // Stacked on separate lines (not "A / B" on one line) so long
                // WO/MR numbers wrap at the natural break instead of splitting
                // mid-digit-string when the column is narrow.
                const numberText = [r.wo_number, r.mr_number].filter(Boolean).map(escOv).join("<br>") || "—";
                tr.innerHTML = [
                    r.date || "—",
                    numberText,
                    r.type,
                    escOv(r.issue_category || "—"),
                    r.status,
                    escOv(r.severity != null ? String(r.severity) : "—"),
                    r.downtime_hours != null ? r.downtime_hours.toLocaleString() : "—",
                    escOv(r.owner || "—"),
                    "",
                ].map((v, i) => (i === 8 ? "<td></td>" : `<td>${v}</td>`)).join("");
                const expandBtn = el("button", "mira-pred-wo-expand", "▾");
                expandBtn.type = "button";
                expandBtn.title = "View details";
                tr.lastElementChild.append(expandBtn);
                tbody.append(tr);

                const detailRow = el("tr", "mira-pred-wo-detail-row hidden");
                const detailCell = el("td");
                detailCell.colSpan = 9;
                detailCell.append(
                    _drawerKV("Original description", r.description || "Not available"),
                    _drawerKV("Cleaned description", r.cleaned_description || "Not available"),
                    _drawerKV("Actual start", r.actual_start || "Not available"),
                    _drawerKV("Actual end", r.actual_end || "Not available"),
                );
                detailRow.append(detailCell);
                tbody.append(detailRow);
                expandBtn.addEventListener("click", () => detailRow.classList.toggle("hidden"));
            });
            table.append(tbody);
            tableWrap.append(table);
            if (list.length > 300) {
                tableWrap.append(el("p", "mira-ov-muted", `Showing the first 300 of ${list.length.toLocaleString()} matching records — narrow the filters to see more precisely.`));
            }
        }

        rangeSel.addEventListener("change", () => {
            state.range = rangeSel.value;
            customWrap.classList.toggle("hidden", state.range !== "custom");
            renderTable();
        });
        fromInput.addEventListener("change", () => { state.customFrom = fromInput.value; renderTable(); });
        toInput.addEventListener("change", () => { state.customTo = toInput.value; renderTable(); });
        typeSel.addEventListener("change", () => { state.type = typeSel.value; renderTable(); });
        statusSel.addEventListener("change", () => { state.status = statusSel.value; renderTable(); });
        exportBtn.addEventListener("click", () => _exportAssetWorkOrders(card, filtered()));

        renderTable();
        return wrap;
    }

    function _exportAssetWorkOrders(card, rows) {
        if (typeof XLSX === "undefined") {
            window.alert("Export library did not load. Check your connection and try again.");
            return;
        }
        const headers = ["Date", "WO Number", "MR Number", "Type", "Issue Category", "Original Description",
            "Cleaned Description", "Status", "Severity", "Actual Start", "Actual End", "Downtime (hours)", "Owner"];
        const aoa = [headers].concat(rows.map((r) => [
            r.date || "", r.wo_number || "", r.mr_number || "", r.type || "", r.issue_category || "",
            r.description || "", r.cleaned_description || "", r.status || "", r.severity != null ? r.severity : "",
            r.actual_start || "", r.actual_end || "", r.downtime_hours != null ? r.downtime_hours : "", r.owner || "",
        ]));
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "WO-MR History");
        const safeName = String(card.asset_name || "asset").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        XLSX.writeFile(wb, `WO-MR_${safeName}_${stamp}.xlsx`);
    }

    // ── Spare Parts tab ───────────────────────────────────────────────────────
    const _STOCK_STATUS_TONE = {
        "Out of Stock": "high", "Below Minimum": "medium", "At Minimum": "medium",
        "Available": "low", "Unknown": "neutral",
    };

    function _buildAssetSparePartsTab(sp) {
        const wrap = el("div", "mira-pred-sp-tab");
        if (!sp.has_mapping) {
            const empty = el("div", "mira-pred-detail-empty");
            empty.append(el("p", "mira-ov-muted", sp.no_mapping_message || "No validated spare-part mapping is available for this asset."));
            wrap.append(empty);
            return wrap;
        }

        // Parts actually tied to this asset's own usage/repair history, with a
        // relationship classification and readiness — direct/repeated-use parts
        // first, since not every part in the machine group is confirmed
        // failure-related for this specific asset.
        if (sp.relevant_parts && sp.relevant_parts.length) {
            const relSec = _drawerSection("Spare-Parts Readiness");
            if (sp.readiness_summary && sp.readiness_summary.label) {
                relSec.append(_drawerKV("Summary", sp.readiness_summary.label));
            }
            const table = el("table", "mira-pred-sp-table");
            table.innerHTML = "<thead><tr>" + ["Part", "Relationship", "On Hand", "Minimum", "Recent Usage", "Status"].map((h) => `<th>${escOv(h)}</th>`).join("") + "</tr></thead>";
            const tbody = el("tbody");
            sp.relevant_parts.forEach((p) => {
                const tone = _STOCK_STATUS_TONE[p.stock_status] || "neutral";
                const tr = el("tr");
                tr.innerHTML = [
                    escOv(p.part_name || "—"),
                    escOv(p.relationship || "—"),
                    p.on_hand != null ? p.on_hand : "—",
                    p.min_stock != null ? p.min_stock : "—",
                    `${p.recent_usage_count || 0}x in ${p.recent_usage_window_days || 90}d${p.last_usage_date ? " (last " + escOv(p.last_usage_date) + ")" : ""}`,
                    `<span class="mira-ov-risk-badge mira-ov-risk-${tone}">${escOv(p.stock_status || "Stock data unavailable")}</span>`,
                ].map((v) => `<td>${v}</td>`).join("");
                tbody.append(tr);
            });
            table.append(tbody);
            relSec.append(table);
            wrap.append(relSec);
        } else if (sp.readiness_summary) {
            const relSec = _drawerSection("Spare-Parts Readiness");
            relSec.append(el("p", "mira-ov-muted", sp.readiness_summary.label || "No parts directly tied to this asset's usage history."));
            wrap.append(relSec);
        }

        if (sp.readiness) {
            const readySec = _drawerSection("Spare Part Readiness (all linked parts)");
            const r = sp.readiness;
            readySec.append(_drawerKV("Likely required for", r.likely_required_for || "Not available"));
            readySec.append(_drawerKV("Parts available", r.parts_available == null ? "Unknown" : (r.parts_available ? "Yes" : "No")));
            readySec.append(_drawerKV("Replenishment may be needed", r.replenishment_may_be_needed == null ? "Unknown" : (r.replenishment_may_be_needed ? "Yes" : "No")));
            if (r.low_stock_parts && r.low_stock_parts.length) {
                readySec.append(_drawerKV("Low-stock parts", r.low_stock_parts.join(", ")));
            }
            wrap.append(readySec);
        }

        if (sp.on_hand && sp.on_hand.length) {
            const invSec = _drawerSection("On-Hand Inventory");
            const table = el("table", "mira-pred-sp-table");
            table.innerHTML = "<thead><tr>" + ["Part", "Item Code", "On Hand", "Min", "Max", "On Order", "Status"].map((h) => `<th>${escOv(h)}</th>`).join("") + "</tr></thead>";
            const tbody = el("tbody");
            sp.on_hand.forEach((row) => {
                const tone = _STOCK_STATUS_TONE[row.stock_status] || "neutral";
                const tr = el("tr");
                tr.innerHTML = [
                    escOv(row.part_name || "—"), escOv(row.item_code || "—"),
                    row.on_hand != null ? row.on_hand : "—", row.min_stock != null ? row.min_stock : "—",
                    row.max_stock != null ? row.max_stock : "—", row.on_order != null ? row.on_order : "—",
                    `<span class="mira-ov-risk-badge mira-ov-risk-${tone}">${escOv(row.stock_status)}</span>`,
                ].map((v) => `<td>${v}</td>`).join("");
                tbody.append(tr);
            });
            table.append(tbody);
            invSec.append(table);
            wrap.append(invSec);
        }

        const fromPurchase = sp.usage_source === "purchase_records";
        const usageSec = _drawerSection(fromPurchase ? "Usage (from Gen PO purchase records)" : "Usage");
        if (fromPurchase) {
            usageSec.append(el("p", "mira-ov-muted", "No store-issue transactions found for this asset — figures below are purchase quantities from Gen PO, not confirmed consumption."));
        }
        usageSec.append(_drawerKV(fromPurchase ? "Purchased in last 30 days" : "Used in last 30 days", sp.usage_last_30_days != null ? sp.usage_last_30_days : "Not available"));
        usageSec.append(_drawerKV(fromPurchase ? "Purchased in last 90 days" : "Used in last 90 days", sp.usage_last_90_days != null ? sp.usage_last_90_days : "Not available"));
        usageSec.append(_drawerKV(fromPurchase ? "Last purchase date" : "Last issued date", sp.last_issued_date || "Not available"));
        wrap.append(usageSec);

        if (sp.transactions && sp.transactions.length) {
            const txSec = _drawerSection(`Recent Transactions (${sp.transactions.length})`);
            const table = el("table", "mira-pred-sp-table");
            table.innerHTML = "<thead><tr>" + ["Date", "Part", "Qty", "Value"].map((h) => `<th>${escOv(h)}</th>`).join("") + "</tr></thead>";
            const tbody = el("tbody");
            sp.transactions.slice(0, 20).forEach((t) => {
                const tr = el("tr");
                tr.innerHTML = [t.date || "—", escOv(t.part_name || "—"), t.quantity != null ? t.quantity : "—", t.value != null ? t.value : "—"]
                    .map((v) => `<td>${v}</td>`).join("");
                tbody.append(tr);
            });
            table.append(tbody);
            txSec.append(table);
            wrap.append(txSec);
        }

        if (sp.data_gaps && sp.data_gaps.length) {
            const gapsSec = _drawerSection("Data Notes");
            gapsSec.append(el("p", "mira-ov-muted", sp.data_gaps.join(" ")));
            wrap.append(gapsSec);
        }

        return wrap;
    }

    // ── Trends tab ────────────────────────────────────────────────────────────
    function _buildAssetTrendsTab(trends) {
        const wrap = el("div", "mira-pred-trends-tab");
        const hasMonthly = trends.monthly && trends.monthly.some((m) => m.total_count > 0);
        if (!hasMonthly) {
            const empty = el("div", "mira-pred-detail-empty");
            empty.append(el("p", "mira-ov-muted", "Not enough history to plot trends for this asset."));
            wrap.append(empty);
            return wrap;
        }

        const pvc = trends.preventive_vs_corrective || { preventive: 0, corrective: 0 };
        const pvcTotal = pvc.preventive + pvc.corrective;
        const pvcSec = _drawerSection("Preventive vs Corrective (12 months)");
        if (pvcTotal > 0) {
            const bar = el("div", "mira-pred-pvc-bar");
            const prevPct = Math.round((pvc.preventive / pvcTotal) * 100);
            const prevSeg = el("div", "mira-pred-pvc-seg mira-pred-pvc-preventive");
            prevSeg.style.width = prevPct + "%";
            prevSeg.title = `Preventive: ${pvc.preventive} (${prevPct}%)`;
            const corrSeg = el("div", "mira-pred-pvc-seg mira-pred-pvc-corrective");
            corrSeg.style.width = (100 - prevPct) + "%";
            corrSeg.title = `Corrective: ${pvc.corrective} (${100 - prevPct}%)`;
            bar.append(prevSeg, corrSeg);
            pvcSec.append(bar);
            pvcSec.append(_drawerKV("Preventive", `${pvc.preventive} (${prevPct}%)`));
            pvcSec.append(_drawerKV("Corrective", `${pvc.corrective} (${100 - prevPct}%)`));
        } else {
            pvcSec.append(el("p", "mira-ov-muted", "Not available"));
        }
        wrap.append(pvcSec);

        const chartsSec = _drawerSection("Monthly Corrective WO Count");
        const canvas1 = document.createElement("canvas");
        canvas1.className = "mira-pred-trend-canvas";
        chartsSec.append(canvas1);
        wrap.append(chartsSec);

        const mtbfSec = _drawerSection("MTBF Trend (days)");
        const mtbfHasData = (trends.mtbf_trend || []).some((m) => m.mtbf_days != null);
        if (mtbfHasData) {
            const canvas2 = document.createElement("canvas");
            canvas2.className = "mira-pred-trend-canvas";
            mtbfSec.append(canvas2);
        } else {
            mtbfSec.append(el("p", "mira-ov-muted", "Not enough clean intervals for a reliable MTBF trend."));
        }
        wrap.append(mtbfSec);

        // Charts render after the panel is in the DOM (canvas needs real layout
        // dimensions) — defer one frame.
        window.requestAnimationFrame(() => {
            if (typeof Chart === "undefined") return;
            const labels = trends.monthly.map((m) => m.month);
            new Chart(canvas1, {
                type: "bar",
                data: { labels, datasets: [{ label: "Corrective WOs", data: trends.monthly.map((m) => m.corrective_count), backgroundColor: "#dc2626" }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
            });
            if (mtbfHasData) {
                const canvas2 = mtbfSec.querySelector("canvas");
                new Chart(canvas2, {
                    type: "line",
                    data: { labels: trends.mtbf_trend.map((m) => m.month), datasets: [{ label: "MTBF (days)", data: trends.mtbf_trend.map((m) => m.mtbf_days), borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,0.1)", spanGaps: true, tension: 0.25 }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
                });
            }
        });

        return wrap;
    }

    // ── Recommendations tab ──────────────────────────────────────────────────
    function _buildAssetRecommendationsTab(rec) {
        const wrap = el("div", "mira-pred-rec-tab");
        const tone = _riskTone(rec.priority);

        const prioSec = _drawerSection("Priority");
        prioSec.append(el("span", "mira-ov-risk-badge mira-ov-risk-" + tone, rec.priority || "Low"));
        wrap.append(prioSec);

        const evSec = _drawerSection("Main Evidence");
        if (rec.evidence && rec.evidence.length) {
            const ul = el("ul", "mira-pred-risk-list");
            rec.evidence.forEach((e) => ul.append(el("li", null, e)));
            evSec.append(ul);
        } else {
            evSec.append(el("p", "mira-ov-muted", "Not available"));
        }
        wrap.append(evSec);

        const actSec = _drawerSection("Recommended Engineering Review");
        const ul2 = el("ul", "mira-pred-risk-list");
        (rec.recommended_actions || []).forEach((a) => ul2.append(el("li", null, a)));
        actSec.append(ul2);
        wrap.append(actSec);

        const followSec = _drawerSection("Follow-Up");
        followSec.append(_drawerKV("PM follow-up", rec.pm_follow_up || "Not available"));
        followSec.append(_drawerKV("Open WO follow-up", rec.open_wo_follow_up || "Not available"));
        followSec.append(_drawerKV(
            "Spare-parts readiness",
            rec.spare_parts_readiness
                ? (rec.spare_parts_readiness.parts_available == null ? "Unknown" : (rec.spare_parts_readiness.parts_available ? "Available" : "Replenishment may be needed"))
                : "No validated spare-part mapping is available for this asset."
        ));
        followSec.append(_drawerKV("Potential production concern", rec.potential_production_concern ? "Yes" : "No"));
        wrap.append(followSec);

        return wrap;
    }

    function _buildAssetPlaceholderTab(label, data) {
        const wrap = el("div", "mira-pred-detail-empty");
        if (data) {
            // Populated in a later phase of this feature — structural container
            // is already wired to real data once that phase lands.
            wrap.append(el("p", "mira-ov-muted", `${label} data is available but not yet rendered here.`));
        } else {
            wrap.append(el("p", "mira-ov-muted", `${label} isn't available for this asset yet.`));
        }
        return wrap;
    }

    // Section-A helper: Indicator | Result | Score table, reconciling exactly
    // with the risk score shown on the table row (same main_signals/contributors
    // source, just tabulated).
    function _buildRiskScoreBreakdownTable(card, contributors) {
        const table = el("table", "mira-pred-score-breakdown");
        const thead = el("thead");
        const hr = el("tr");
        ["Indicator", "Result", "Score"].forEach((h) => hr.append(el("th", null, h)));
        thead.append(hr);
        table.append(thead);
        const tbody = el("tbody");
        let total = 0;
        contributors.forEach((s) => {
            let valueText = "";
            if (s.value && typeof s.value === "object") {
                valueText = Object.entries(s.value).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(", ");
            } else if (s.value !== undefined && s.value !== true) {
                valueText = String(s.value);
            }
            total += Number(s.points) || 0;
            const tr = el("tr");
            tr.append(el("td", null, s.label));
            tr.append(el("td", null, valueText || "—"));
            tr.append(el("td", "mira-pred-score-cell", `+${s.points}`));
            tbody.append(tr);
        });
        const totalRow = el("tr", "mira-pred-score-total-row");
        totalRow.append(el("td", null, "Total"));
        totalRow.append(el("td", null, ""));
        totalRow.append(el("td", "mira-pred-score-cell", `${total} / 10`));
        tbody.append(totalRow);
        table.append(tbody);
        return table;
    }

    function _buildAssetOverviewTab(card, detail) {
        const wrap = el("div");

        // A. Risk Score Breakdown — table reconciles exactly with the score
        // badge shown on the management table row (same score, same source).
        const scoreSec = _drawerSection(`Risk Score: ${card.risk_score || 0} / 10`);
        const contributors = (detail && detail.risk && detail.risk.contributors) || card.main_signals || [];
        scoreSec.append(_buildRiskScoreBreakdownTable(card, contributors));
        const otherIndicators = (detail && detail.risk && detail.risk.other_assessed_indicators) || [];
        if (otherIndicators.length) {
            const details = document.createElement("details");
            details.className = "mira-pred-other-details";
            const summary = document.createElement("summary");
            summary.textContent = `Other assessed indicators (${otherIndicators.length})`;
            details.append(summary);
            otherIndicators.forEach((r) => {
                details.append(_drawerKV(r.label, "not triggered"));
            });
            scoreSec.append(details);
        }
        wrap.append(scoreSec);

        // A2. Criticality / Redundancy — separate concepts, never conflated
        // with the risk score above.
        const impactSec = _drawerSection("Criticality & Redundancy");
        impactSec.append(_drawerKV("Criticality", card.criticality || "Unknown"));
        impactSec.append(_drawerKV("Production redundancy", (card.redundancy || {}).label || "Unknown"));
        // Some Asset IDs are reused across multiple physical units in the source
        // system (per-row description text is used to split them into separate
        // cards) — surface the shared ID here so management can manually
        // reconcile, per the "keep splitting, add visibility" decision.
        const siblingCards = ((predictiveLatestPayload && predictiveLatestPayload.cards) || [])
            .filter((c) => c.asset_id && c.asset_id === card.asset_id && c.asset_name !== card.asset_name);
        if (card.asset_id && siblingCards.length) {
            impactSec.append(_drawerKV(
                "Shared Asset ID note",
                `Asset ID ${card.asset_id} is also used by: ${siblingCards.map((c) => c.asset_name).join(", ")}. `
                + "These are shown as separate cards based on per-record description text — verify against Asset Master if this looks incorrect."
            ));
        }
        wrap.append(impactSec);

        // B. Latest Maintenance Pattern
        const pattern = (detail && detail.patterns) || card.latest_recurring_issue_pattern || {};
        const patternSec = _drawerSection("Latest Maintenance Pattern");
        patternSec.append(_drawerKV("Recurring issue category", pattern.issue || "Not available"));
        patternSec.append(_drawerKV("Similar cases", pattern.count != null ? pattern.count : "Not available"));
        patternSec.append(_drawerKV("Latest observed date", pattern.latest_date || "Not available"));
        patternSec.append(_drawerKV("Description", pattern.latest_description || "Not available"));
        const nextOcc = pattern.next_likely_occurrence;
        patternSec.append(_drawerKV(
            "Next likely occurrence",
            nextOcc && nextOcc.label && nextOcc.median_gap_days != null
                ? `${nextOcc.label} (based on ${nextOcc.valid_intervals_used != null ? nextOcc.valid_intervals_used : nextOcc.based_on_cycles} valid intervals, median ${nextOcc.median_gap_days}d apart)`
                : "Insufficient history to estimate"
        ));
        if (nextOcc && nextOcc.confidence && nextOcc.confidence !== "Insufficient history") {
            patternSec.append(_drawerKV("Recurrence confidence", nextOcc.confidence));
        }
        wrap.append(patternSec);

        // C. Current Maintenance Status
        const statusSec = _drawerSection("Current Maintenance Status");
        const ms = (detail && detail.maintenance_status) || {};
        const openStatus = card.open_wo_status || {};
        statusSec.append(_drawerKV("Open WO count", ms.open_wo_count != null ? ms.open_wo_count : (openStatus.count != null ? openStatus.count : "Not available")));
        statusSec.append(_drawerKV("Oldest open WO age (days)", ms.oldest_open_wo_days != null ? ms.oldest_open_wo_days : ((ms.open_wo_count === 0 || openStatus.count === 0) ? "No open WOs" : (openStatus.oldest_age_days != null ? openStatus.oldest_age_days : "Not available"))));
        statusSec.append(_drawerKV("Latest PM date", ms.latest_pm_date || "Not available"));
        statusSec.append(_drawerKV("Next PM due date", ms.next_pm_due_date || ms.next_pm_date || "Not available"));
        statusSec.append(_drawerKV("PM overdue", ms.pm_overdue == null ? "Not available" : (ms.pm_overdue ? "Yes" : "No")));
        statusSec.append(_drawerKV("MTTR (hours)", ms.mttr_hours != null ? ms.mttr_hours : "Not available"));
        statusSec.append(_drawerKV("Current MTBF (days)", ms.mtbf_days != null ? ms.mtbf_days : "Not available"));
        const mtbfChange = ms.mtbf_change_detail || {};
        const mtbfState = ms.mtbf_change_state || (ms.mtbf_changed_vs_previous_period ? "declining" : "");
        let mtbfVsText = "Not available";
        if (mtbfChange.current_days != null && mtbfChange.previous_days != null) {
            const stateText = mtbfState === "declining" ? "decreased" : mtbfState === "improving" ? "improved" : "stable";
            const pctText = mtbfChange.pct_change != null ? `, ${Math.abs(mtbfChange.pct_change)}%` : "";
            mtbfVsText = `${stateText} (${mtbfChange.current_days}d vs ${mtbfChange.previous_days}d${pctText})`;
        } else if (ms.mtbf_days != null) {
            mtbfVsText = "Previous period unavailable";
        }
        statusSec.append(_drawerKV(
            "MTBF vs previous period",
            mtbfVsText
        ));
        wrap.append(statusSec);

        // F. Failure History — latest 5-10 CORRECTIVE events only (preventive
        // maintenance is never shown as a "failure"), from the same work-order
        // rows the full Work Orders tab uses.
        const allWos = (detail && detail.work_orders) || [];
        const failureHistory = allWos
            .filter((r) => r.type === "Corrective")
            .slice()
            .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
            .slice(0, 10);
        if (failureHistory.length) {
            const histSec = _drawerSection("Failure History (latest corrective events)");
            const table = el("table", "mira-pred-score-breakdown");
            const thead = el("thead");
            const hr = el("tr");
            ["Date", "WO/MR", "Issue", "Downtime", "Status"].forEach((h) => hr.append(el("th", null, h)));
            thead.append(hr);
            table.append(thead);
            const tbody = el("tbody");
            failureHistory.forEach((r) => {
                const tr = el("tr");
                tr.append(el("td", null, r.date || "—"));
                tr.append(el("td", null, r.wo_number || r.mr_number || "—"));
                tr.append(el("td", null, r.issue_category || "Unclassified"));
                tr.append(el("td", null, r.downtime_hours != null ? `${r.downtime_hours}h` : "—"));
                tr.append(el("td", null, r.status || (r.is_open ? "Open" : "Closed")));
                tbody.append(tr);
            });
            table.append(tbody);
            histSec.append(table);
            wrap.append(histSec);
        }

        // G. AI Insight — a short summary of the structured data above only.
        // Never phrased as a recommendation/suggested action — management
        // reviews the calculated data and decides any action itself.
        const aiSec = _drawerSection("AI Insight");
        const aiBody = el("p", detail && detail.ai_insight ? null : "mira-ov-muted");
        aiBody.dataset.aiInsightBody = "true";
        aiBody.textContent = (detail && detail.ai_insight) || "AI-generated summary isn't available for this asset yet.";
        aiSec.append(aiBody);
        wrap.append(aiSec);

        return wrap;
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

    function _shortDate(value) {
        if (!value) return "—";
        var d = new Date(String(value).slice(0, 10));
        if (isNaN(d.getTime())) return String(value).slice(0, 10);
        return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
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
        var parts = m.spare_parts_to_prepare || m.suggested_spare_parts || m.spare_parts || [];
        var wrap = el("div", "mira-pred-spare-panel");
        wrap.append(el("div", "mira-pred-issue-others-title", "Spare Parts to Prepare"));
        wrap.append(_buildPredictiveDetailBlock("Recommendation Basis",
            m.spare_recommendation_basis || "Review available spare records only."));
        if (!parts.length) {
            wrap.append(el("p", "mira-pred-empty-note",
                "No confirmed spare part found. Manual review required."));
            wrap.append(el("p", "mira-pred-nextdue-basis", "Technician/Engineer verification required before action."));
            return wrap;
        }
        var ov = el("div", "mira-pred-spare-ov");
        ov.textContent = parts.length + " catalogue spare part" + (parts.length !== 1 ? "s" : "") +
            " to prepare · Gen PO validates history only · inventory confirms stock only";
        wrap.append(ov);
        var tbl = document.createElement("table");
        tbl.className = "mira-pred-spare-tbl";
        var thead = document.createElement("thead");
        var hrow = document.createElement("tr");
        ["Spare Part", "Reason", "Gen PO Validation", "Last Purchased / YTD", "On-hand Qty", "Stock Status", "Action"].forEach(function(h) {
            hrow.appendChild(el("th", null, h));
        });
        thead.appendChild(hrow);
        tbl.appendChild(thead);
        var tbody = document.createElement("tbody");
        parts.forEach(function(p) {
            var tr = document.createElement("tr");
            var partName = typeof p === "string" ? p : (p && (p.label || p.name || p.part_name || p.item_code) || "Spare part");
            var itemCode = p && (p.item_code || p.code) || "";
            var ytdBits = [];
            var lastDate = p.last_purchased_date || p.last_purchase_date;
            if (lastDate) ytdBits.push("Last " + _formatPredictiveDate(lastDate));
            if (p.ytd_po_count != null) ytdBits.push((p.ytd_po_count || 0) + " YTD PO");
            if (p.total_ytd_qty_purchased != null) ytdBits.push("Qty " + _formatPredictiveQty(p.total_ytd_qty_purchased));

            // Description cell — label + evidence tag chips
            var descCell = document.createElement("td");
            descCell.className = "mira-pred-spare-desc";
            descCell.appendChild(document.createTextNode(partName));
            if (itemCode) descCell.appendChild(el("div", "mira-pred-spare-po-detail", "Item: " + itemCode));
            var evTags = p.evidence_tags || [];
            if (evTags.length) {
                var tagWrap = el("div", "mira-pred-ev-tags");
                evTags.forEach(function(tag) {
                    tagWrap.appendChild(el("span", "mira-pred-ev-tag", tag));
                });
                descCell.appendChild(tagWrap);
            }

            var stockTd = document.createElement("td");
            stockTd.append(_buildStockBadge(p.stock_status));
            [
                descCell,
                el("td", "mira-pred-spare-source", p.match_reason || "Stage 1 catalogue match"),
                el("td", "mira-pred-spare-history", p.gen_po_validation_status || "No Gen PO purchase history found"),
                el("td", "mira-pred-spare-history", ytdBits.join(" · ") || "—"),
                el("td", null, p.on_hand_qty != null ? _formatPredictiveQty(p.on_hand_qty) : "—"),
                stockTd,
                el("td", "mira-pred-spare-history", p.purchase_recommendation || "Verify manually"),
            ].forEach(function(td) { tr.appendChild(td); });
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        wrap.append(tbl);
        wrap.append(el("p", "mira-pred-nextdue-basis", "Technician/Engineer verification required before action."));
        return wrap;
    }

    function _partDisplayName(p) {
        if (typeof p === "string") return p;
        return p && (p.label || p.name || p.part_name || p.item_code || p.code) || "Spare part";
    }

    function _partItemCode(p) {
        return p && typeof p === "object" ? (p.item_code || p.code || "") : "";
    }

    function _buildOtherCommonFaultsPanel(m) {
        var faults = (m.other_common_faults || []).slice(0, 5);
        if (!faults.length) return null;
        var wrap = el("div", "mira-pred-other-faults");
        wrap.append(el("div", "mira-pred-issue-others-title", "Other Common Faults & Spare Parts to Prepare"));
        wrap.append(el("p", "mira-pred-nextdue-basis",
            "Other common faults are based on this machine's MR history and are not necessarily the next predicted issue."));

        faults.forEach(function(fault, idx) {
            var card = el("div", "mira-pred-other-fault-card");
            var head = el("div", "mira-pred-other-fault-head");
            head.append(el("strong", null, (idx + 1) + ". " + (fault.issue_signature || "Common fault")));
            var countBits = [];
            countBits.push("MR count: " + (fault.mr_count || 0));
            if (fault.pct_of_machine_mr != null) countBits.push(fault.pct_of_machine_mr + "%");
            head.append(el("span", "mira-pred-other-fault-count", countBits.join(" · ")));
            card.append(head);

            var meta = [];
            if (fault.last_occurrence) meta.push("Last seen: " + _formatPredictiveDate(fault.last_occurrence));
            if (fault.recent_example_mr_id || fault.recent_example_wo_id) {
                meta.push("Example: " + (fault.recent_example_mr_id || fault.recent_example_wo_id));
            }
            if (fault.basis) meta.push(fault.basis);
            if (meta.length) card.append(el("div", "mira-pred-spare-po-detail", meta.join(" · ")));
            if (fault.latest_description) card.append(el("p", "mira-pred-other-fault-desc", fault.latest_description));
            if (fault.suggested_check) card.append(el("p", "mira-pred-other-fault-check", "Suggested check: " + fault.suggested_check));

            var parts = fault.spare_parts_to_prepare || [];
            if (parts.length) {
                var partWrap = el("div", "mira-pred-other-fault-parts");
                partWrap.append(el("div", "mira-pred-inline-label", "Spare Parts to Prepare"));
                parts.slice(0, 3).forEach(function(part) {
                    var row = el("div", "mira-pred-other-part-row");
                    var label = _partDisplayName(part);
                    var itemCode = _partItemCode(part);
                    row.append(el("span", "mira-pred-other-part-name", itemCode ? label + " · " + itemCode : label));
                    row.append(_buildStockBadge(part.stock_status || "Verify manually"));
                    row.append(el("span", "mira-pred-other-part-action", part.purchase_recommendation || "Verify manually"));
                    partWrap.append(row);
                });
                if (parts.length > 3) {
                    var partDetails = document.createElement("details");
                    partDetails.className = "mira-pred-other-details";
                    partDetails.append(el("summary", null, "View all related parts"));
                    parts.slice(3, 5).forEach(function(part) {
                        partDetails.append(el("div", "mira-pred-other-detail-line",
                            _partDisplayName(part) + " — " + (part.stock_status || "Verify manually")));
                    });
                    partWrap.append(partDetails);
                }
                card.append(partWrap);
            } else {
                card.append(el("p", "mira-pred-empty-note", "No catalogue spare-part match found for this fault. Verify manually."));
            }

            card.append(el("div", "mira-pred-other-stock-action",
                "Stock action: " + (fault.purchase_recommendation || fault.stock_status || "Verify manually")));
            var examples = fault.examples || [];
            if (examples.length) {
                var exDetails = document.createElement("details");
                exDetails.className = "mira-pred-other-details";
                exDetails.append(el("summary", null, "View examples"));
                examples.slice(0, 5).forEach(function(ex) {
                    var ref = ex.mr_id || ex.wo_id || "MR";
                    var line = [ref, _formatPredictiveDate(ex.date), ex.description || ""].filter(Boolean).join(" — ");
                    exDetails.append(el("div", "mira-pred-other-detail-line", line));
                });
                card.append(exDetails);
            }
            wrap.append(card);
        });
        wrap.append(el("p", "mira-pred-nextdue-basis", "Technician/Engineer verification required before action."));
        return wrap;
    }

    function _forecastMachineName(m) {
        return m.unit || m.specific_machine_group || m.machine_group || m.machine_type || "Machine";
    }

    function _forecastIssueLabel(m) {
        return (m.issue && m.issue.cluster) || m.recurring_issue || "Recurring issue";
    }

    function _forecastStockDecisionText(m) {
        var parts = m.spare_parts_to_prepare || m.suggested_spare_parts || m.spare_parts || [];
        if (parts.some(function(p) {
            return /purchase required|reorder/i.test(String((p && (p.stock_status || p.purchase_recommendation)) || ""));
        })) return "Check on-hand quantity. Reorder if stock is zero or below minimum.";
        if (parts.some(function(p) {
            return /check store|not confirmed/i.test(String((p && (p.stock_status || p.purchase_recommendation)) || ""));
        })) return "Check actual store availability before repair. Use Gen PO history only to support vendor or purchase review.";
        if (parts.some(function(p) {
            return /in stock/i.test(String((p && p.stock_status) || ""));
        })) return "Prepare the in-stock parts in store before the next repair.";
        return "Check on-hand inventory and verify manually before purchasing.";
    }

    function _buildPredictiveWordingInput(m) {
        var domCnt = m.history_issue_count || m.dominant_count || 0;
        var total = m.history_mr_count || m.mr_count || domCnt || 0;
        var spareParts = m.spare_parts_to_prepare || m.suggested_spare_parts || m.spare_parts || [];
        var rawSparePartsForTranslation = spareParts.slice(0, 5)
            .map(function(p) { return { originalName: _partDisplayName(p) }; })
            .filter(function(p) { return p.originalName && p.originalName !== "Spare part"; });
        return {
            machine: _forecastMachineName(m),
            selectedIssue: _forecastIssueLabel(m),
            mrCount: domCnt,
            totalMachineMr: total,
            latestOccurrence: m.cluster_last_occurrence || m.last_occurrence || null,
            nextLikelyWindow: m.likely_recurrence_label || m.recurrence_gauge || null,
            medianInterval: m.recurrence_interval_days != null ? String(m.recurrence_interval_days) + " days" : null,
            relatedKeywords: uniqueStrings(m.symptom_keywords || []).slice(0, 8),
            likelyCause: m.likely_cause_candidate || "",
            stockDecision: _forecastStockDecisionText(m),
            rawSparePartsForTranslation: rawSparePartsForTranslation,
        };
    }

    function _naturalList(items, conjunction) {
        if (!items || !items.length) return "";
        if (items.length === 1) return items[0];
        return items.slice(0, -1).join(", ") + ", " + (conjunction || "and") + " " + items[items.length - 1];
    }

    function _fallbackPredictiveWording(m) {
        var data = _buildPredictiveWordingInput(m);
        var issueLabel = data.selectedIssue.toLowerCase().replace(/[.]+$/, "");
        var summary = data.machine + " is showing a recurring " + issueLabel + ".";
        if (data.mrCount && data.totalMachineMr) {
            summary += " This issue appeared in " + data.mrCount + " of " + data.totalMachineMr + " MR records";
            if (data.latestOccurrence) summary += ", with the latest occurrence on " + _formatPredictiveDate(data.latestOccurrence);
            summary += ".";
        } else if (data.latestOccurrence) {
            summary += " The latest occurrence was on " + _formatPredictiveDate(data.latestOccurrence) + ".";
        }
        if (data.nextLikelyWindow && !/not enough|insufficient|monitor/i.test(data.nextLikelyWindow)) {
            summary += " Based on the recorded intervals, the next likely occurrence is " + data.nextLikelyWindow.toLowerCase() + ".";
        }
        if (data.relatedKeywords.length) {
            var kws = data.relatedKeywords.slice(0, 3);
            var kwStr = _naturalList(kws, "and");
            var kwLower = data.relatedKeywords.join(" ").toLowerCase();
            var damageTypes = ["wear"];
            if (/leak|water|fluid|oil|wet|drip/.test(kwLower)) damageTypes.push("leakage");
            if (/block|clog|jam|stuck/.test(kwLower)) damageTypes.push("blockage");
            if (/rust|corrode|oxidiz/.test(kwLower)) damageTypes.push("corrosion");
            damageTypes.push("damage");
            var damageStr = _naturalList(damageTypes.slice(0, 3), "or");
            summary += " Repeated keywords include " + kwStr + ", suggesting possible " + damageStr + " in related components.";
        }
        var inspectLine = data.likelyCause
            ? "Inspect " + data.likelyCause + "."
            : "Inspect the area related to " + issueLabel + " for leakage, looseness, or wear.";
        var action = [
            inspectLine,
            "Prepare the related spare parts listed below before the next repair.",
            data.stockDecision || "Check store quantity first. If stock is unavailable or below minimum, raise a purchase request using Gen PO vendor/price history as reference.",
        ].join("\n\n");
        return {
            faultPatternSummary: summary,
            recommendedAction: action,
            technicianNote: "Please verify the actual condition onsite before repair. Gen PO history should only be used to support vendor or purchase review, not as final confirmation of store availability.",
            translatedSpareParts: [],
        };
    }

    function _renderWordingText(container, text) {
        container.innerHTML = "";
        if (!text || text === "—") { container.textContent = "—"; return; }
        var paras = String(text).split(/\n\n+/);
        if (paras.length <= 1) { container.textContent = text; return; }
        paras.forEach(function(para) {
            var p = document.createElement("p");
            p.className = "mira-pred-wording-para";
            p.textContent = para.trim();
            container.appendChild(p);
        });
    }

    function _buildWordingBlock(label, text) {
        var block = el("div", "mira-pred-detail-block mira-pred-wording-block");
        block.append(el("div", "mira-pred-detail-label", label));
        var valueEl = el("div", "mira-pred-detail-value");
        _renderWordingText(valueEl, text || "—");
        block.append(valueEl);
        return block;
    }

    function _buildPredictiveWordingSection(m) {
        var fallback = _fallbackPredictiveWording(m);
        var section = _drawerSection("Suggested Maintenance Action");
        section.classList.add("mira-pred-wording-section");
        var grid = el("div", "mira-pred-wording-grid");
        var summary = _buildWordingBlock("Fault Pattern Summary", fallback.faultPatternSummary);
        var action = _buildWordingBlock("Suggested Action", fallback.recommendedAction);
        grid.append(summary, action);
        section.append(grid);
        section._wordingNodes = {
            summary: summary.querySelector(".mira-pred-detail-value"),
            action: action.querySelector(".mira-pred-detail-value"),
        };
        return section;
    }

    function _predictiveWordingCacheKey(m) {
        return [
            filtersSignature(),
            predictiveCategoryView || "",
            _forecastMachineName(m),
            _forecastIssueLabel(m),
            m.asset_id || "",
            m.rank || "",
        ].join("|");
    }

    function _applySpareKitTranslations(spareKitEl, translatedParts) {
        if (!spareKitEl || !translatedParts || !translatedParts.length) return;
        var map = {};
        translatedParts.forEach(function(t) { if (t.originalName) map[t.originalName.trim()] = t; });
        spareKitEl.querySelectorAll("[data-spare-orig]").forEach(function(engEl) {
            var t = map[(engEl.dataset.spareOrig || "").trim()];
            if (!t) return;
            engEl.textContent = "English: " + (t.englishName || "Translation to verify");
            if ((t.translationConfidence || "low") === "low") engEl.classList.add("mira-pred-trans-unverified");
            else engEl.classList.remove("mira-pred-trans-unverified");
        });
    }

    function _applyPredictiveWording(section, wording, spareKitEl) {
        if (!section || !section._wordingNodes || !wording) return;
        var nodes = section._wordingNodes;
        if (wording.faultPatternSummary) nodes.summary.textContent = wording.faultPatternSummary;
        var actionText = wording.recommendedAction || wording.suggestedAction;
        if (actionText) _renderWordingText(nodes.action, actionText);
        if (spareKitEl && wording.translatedSpareParts && wording.translatedSpareParts.length) {
            _applySpareKitTranslations(spareKitEl, wording.translatedSpareParts);
        }
    }

    function _requestPredictiveWording(m, section, spareKitEl) {
        var key = _predictiveWordingCacheKey(m);
        section.dataset.wordingKey = key;
        if (predictiveWordingCache[key]) {
            _applyPredictiveWording(section, predictiveWordingCache[key], spareKitEl);
            return;
        }
        var request = fetchJsonWithTimeout(`${API}/predictive-wording`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
                cacheKey: key,
                structured: _buildPredictiveWordingInput(m),
            }),
        }, 8000);
        request.promise
            .then(function(json) {
                var wording = json && json.wording;
                if (!wording || section.dataset.wordingKey !== key) return;
                predictiveWordingCache[key] = wording;
                _applyPredictiveWording(section, wording, spareKitEl);
            })
            .catch(function() {
                debugLog("predictive-wording:fallback", { key: key });
            });
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
        if (m.recurrence_interval_n != null && (m.history_issue_count != null || m.dominant_count != null)) {
            recRows.push(["Based on", m.recurrence_interval_n + " intervals from " + (m.history_issue_count || m.dominant_count) + " matching history MRs"]);
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
            _buildPredictiveDetailBlock("Evidence", m.evidence_summary || "—")
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

        var otherCommonFaults = _buildOtherCommonFaultsPanel(m);
        if (otherCommonFaults) wrap.append(otherCommonFaults);

        wrap.append(_buildPredictiveDetailBlock("Likely Cause Candidate", m.likely_cause_candidate || "—"));

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

    // ── Alert strip state (accumulated from all three KPI cards) ─────────────
    var _sectionAttentionNotes = {};

    // ── Forecast Drawer ───────────────────────────────────────────────────────
    var _forecastDrawerEl = null;
    var _forecastDrawerBodyEl = null;
    var _forecastDrawerTitleEl = null;

    function _ensureForecastDrawer() {
        if (_forecastDrawerEl) return;
        var overlay = el("div", "mira-pred-drawer-overlay");
        overlay.id = "mira-pred-drawer-overlay";
        overlay.addEventListener("click", function(e) {
            if (e.target === overlay) _closeForecastDrawer();
        });
        var drawer = el("div", "mira-pred-drawer");
        var head = el("div", "mira-pred-drawer-head");
        _forecastDrawerTitleEl = el("span", "mira-pred-drawer-title", "");
        var closeBtn = el("button", "mira-pred-drawer-close", "×");
        closeBtn.type = "button";
        closeBtn.setAttribute("aria-label", "Close");
        closeBtn.addEventListener("click", _closeForecastDrawer);
        head.append(_forecastDrawerTitleEl, closeBtn);
        _forecastDrawerBodyEl = el("div", "mira-pred-drawer-body");
        drawer.append(head, _forecastDrawerBodyEl);
        overlay.append(drawer);
        document.body.appendChild(overlay);
        _forecastDrawerEl = overlay;
    }

    function _openForecastDrawer(m, mode) {
        _ensureForecastDrawer();
        var machineName = m.unit || m.specific_machine_group || m.machine_group || "Machine";
        var issueCluster = (m.issue && m.issue.cluster) || m.recurring_issue || "Forecast";
        _forecastDrawerTitleEl.textContent = machineName + " — " + issueCluster;
        _forecastDrawerBodyEl.innerHTML = "";
        _forecastDrawerBodyEl.scrollTop = 0;
        if (mode === "spare") {
            _forecastDrawerBodyEl.append(_buildSpareStatsPanel(m));
        } else {
            _forecastDrawerBodyEl.append(_buildForecastDrawerContent(m));
        }
        _forecastDrawerEl.classList.add("mira-pred-drawer-open");
    }

    function _closeForecastDrawer() {
        if (_forecastDrawerEl) _forecastDrawerEl.classList.remove("mira-pred-drawer-open");
    }

    function _drawerSection(title) {
        var sec = el("div", "mira-pred-drawer-section");
        sec.append(el("div", "mira-pred-drawer-section-title", title));
        return sec;
    }

    function _drawerKV(k, v) {
        var wrap = el("div", "mira-pred-drawer-kv");
        wrap.append(el("div", "mira-pred-drawer-k", k));
        wrap.append(el("div", "mira-pred-drawer-v", v != null ? String(v) : "—"));
        return wrap;
    }

    function _buildForecastDrawerContent(m) {
        var wrap = el("div", "mira-pred-drawer-content");
        var timing = m.timing || {};

        // ── 1. Forecast Summary ──────────────────────────────────────────────
        var secSum = _drawerSection("Forecast Summary");
        var dueLabel = m.likely_recurrence_label || m.recurrence_gauge || "Not enough history";
        secSum.append(_drawerKV("Next Likely Window", dueLabel));
        var statusLabel = timing.trend === "degrading" ? "Gap shrinking — issue recurring more frequently"
            : timing.trend === "stabilizing" ? "Gap widening — issue recurring less frequently"
            : "Recurring issue pattern detected";
        secSum.append(_drawerKV("Pattern Status", statusLabel));
        var confKV = el("div", "mira-pred-drawer-kv");
        confKV.append(el("div", "mira-pred-drawer-k", "Confidence"));
        var confV = el("div", "mira-pred-drawer-v mira-pred-drawer-v-flex");
        confV.append(_buildConfidenceBadge(m.confidence));
        if (m.confidence_reason) confV.append(el("span", "mira-pred-drawer-conf-sub", m.confidence_reason));
        confKV.append(confV);
        secSum.append(confKV);
        wrap.append(secSum);

        // ── 2. Evidence Summary ──────────────────────────────────────────────
        var secEv = _drawerSection("Evidence Summary");
        var evRows = [];
        var clusterDate = m.cluster_last_occurrence || m.last_occurrence;
        var domCnt = m.dominant_count || m.mr_count || 0;
        if (domCnt) evRows.push(["Related MR", String(domCnt) + (m.mr_count && m.mr_count !== domCnt ? " (of " + m.mr_count + " total)" : "")]);
        if (clusterDate) evRows.push(["Latest occurrence", _formatPredictiveDate(clusterDate)]);
        if (timing.median_gap_days != null) evRows.push(["Median interval", "~" + timing.median_gap_days + "d"]);
        if (m.recurrence_interval_avg_days != null) evRows.push(["Average interval", "~" + m.recurrence_interval_avg_days + "d"]);
        if (m.mtbf_days != null) evRows.push(["MTBF (all issues)", "~" + m.mtbf_days + "d"]);
        if (m.recurrence_interval_n != null) evRows.push(["Clean intervals", String(m.recurrence_interval_n)]);
        var evTbl = document.createElement("table");
        evTbl.className = "mira-pred-rec-tbl";
        var evBody = document.createElement("tbody");
        evRows.forEach(function(pair) {
            var tr = document.createElement("tr");
            tr.appendChild(el("td", "mira-pred-rec-lbl", pair[0]));
            tr.appendChild(el("td", "mira-pred-rec-val", pair[1]));
            evBody.appendChild(tr);
        });
        evTbl.appendChild(evBody);
        secEv.append(evTbl);
        wrap.append(secEv);

        // ── 3. Issue Signature ───────────────────────────────────────────────
        var issueCluster = (m.issue && m.issue.cluster) || m.recurring_issue || "—";
        var secIssue = _drawerSection("Issue Signature");
        var pillWrap = el("div", "mira-pred-drawer-issue-pill-wrap");
        pillWrap.append(el("span", "mira-pred-issue-pill " + _issuePillClass(issueCluster), issueCluster));
        secIssue.append(pillWrap);
        if (m.pattern_type) {
            var ptClass = "mira-pred-pattern-type";
            if (/corrective|breakdown/i.test(m.pattern_type)) ptClass += " mira-pred-pattern-corrective";
            else if (/preventive|routine/i.test(m.pattern_type)) ptClass += " mira-pred-pattern-preventive";
            var ptText = m.pattern_type;
            if (m.history_issue_count != null && m.history_mr_count != null) {
                ptText += " \xb7 " + m.history_issue_count + " of " + m.history_mr_count + " history MRs";
            }
            if (m.recurring_pct != null) ptText += " \xb7 " + m.recurring_pct + "%";
            secIssue.append(el("div", ptClass, ptText));
        }
        var proof = (m.issue && m.issue.proof) || m.matched_wording || m.latest_issue_description || "";
        if (proof) secIssue.append(el("p", "mira-pred-drawer-proof", proof));
        var symptomTerms = uniqueStrings(m.symptom_keywords || []).slice(0, 8);
        if (symptomTerms.length) {
            secIssue.append(el("div", "mira-pred-inline-label", "Related keywords"));
            var chips = el("div", "mira-pred-chip-row");
            symptomTerms.forEach(function(t) { chips.append(el("span", "mira-pred-issue-chip", t)); });
            secIssue.append(chips);
        }
        wrap.append(secIssue);

        // ── 4. Likely Cause Candidate ────────────────────────────────────────
        if (m.likely_cause_candidate) {
            var secCause = _drawerSection("Likely Cause Candidate");
            secCause.append(el("p", "mira-pred-cause-copy", m.likely_cause_candidate));
            secCause.append(el("p", "mira-pred-nextdue-basis", "Candidate only — review required before any action."));
            wrap.append(secCause);
        }

        // ── 5. Spare Parts to Prepare ────────────────────────────────────────
        var spareKitListEl = null;
        var _allSpares = (m.spare_parts_to_prepare || m.suggested_spare_parts || m.spare_parts || []);
        if (!_allSpares.length) _allSpares = m.spare_kit || [];

        var secSpare = _drawerSection("Spare Parts to Prepare");
        if (!_allSpares.length) {
            var spareStatusRow = el("div", "mira-pred-drawer-spare-status");
            spareStatusRow.append(_buildStockBadge(m.stock_status || "Unknown"));
            if (!m.spare_available) {
                spareStatusRow.append(el("span", "mira-pred-detail-muted", "No spare-part support found in records."));
            }
            secSpare.append(spareStatusRow);
        } else {
            spareKitListEl = el("div", "mira-pred-spare-kit-list");
            _allSpares.slice(0, 5).forEach(function(p, idx) {
                var origName = _partDisplayName(p);
                var hasThai = /[฀-๿]/.test(origName);
                var itemCode = _partItemCode(p);
                var item = el("div", "mira-pred-spare-kit-item");
                var nameRow = el("div", "mira-pred-spare-kit-name");
                nameRow.append(el("span", "mira-pred-spare-kit-idx", (idx + 1) + "."));
                nameRow.append(document.createTextNode(itemCode ? origName + " \xb7 " + itemCode : origName));
                item.append(nameRow);
                if (hasThai || (typeof p === "object" && p && p.english_name)) {
                    var engEl = el("div", "mira-pred-spare-kit-eng");
                    engEl.dataset.spareOrig = origName;
                    engEl.textContent = (typeof p === "object" && p && p.english_name)
                        ? "English: " + p.english_name
                        : "English: Translation to verify";
                    item.append(engEl);
                }
                var metaRow = el("div", "mira-pred-spare-kit-meta");
                if (typeof p === "object" && p && p.match_reason) {
                    metaRow.append(el("span", "mira-pred-spare-kit-reason", "Reason: " + p.match_reason));
                }
                metaRow.append(_buildStockBadge(
                    typeof p === "object" && p ? (p.stock_status || "Verify manually") : "Verify manually"
                ));
                if (typeof p === "object" && p && p.purchase_recommendation) {
                    metaRow.append(el("span", "mira-pred-spare-kit-action", p.purchase_recommendation));
                }
                item.append(metaRow);
                spareKitListEl.append(item);
            });
            if (_allSpares.length > 5) {
                var moreD = document.createElement("details");
                moreD.className = "mira-pred-other-details";
                moreD.append(el("summary", null, "View all related parts (" + _allSpares.length + ")"));
                _allSpares.slice(5).forEach(function(p) {
                    moreD.append(el("div", "mira-pred-other-detail-line",
                        _partDisplayName(p) + (typeof p === "object" && p && p.stock_status ? " — " + p.stock_status : "")));
                });
                spareKitListEl.append(moreD);
            }
            secSpare.append(spareKitListEl);
        }
        secSpare.append(el("p", "mira-pred-nextdue-basis", "Technician/Engineer verification required before action."));
        wrap.append(secSpare);

        // ── 6. Suggested Maintenance Action (rule-based; Ollama polishes async) ──
        var wordingSection = _buildPredictiveWordingSection(m);
        wrap.append(wordingSection);
        _requestPredictiveWording(m, wordingSection, spareKitListEl);

        // ── 7. Recent Examples ───────────────────────────────────────────────
        var allEvidence = m.issue_evidence || [];
        if (allEvidence.length) {
            var secEx = _drawerSection("Recent Examples");
            var exTbl = document.createElement("table");
            exTbl.className = "mira-pred-issue-ev-tbl";
            var exBody2 = document.createElement("tbody");
            allEvidence.slice(0, 3).forEach(function(e) {
                var tr = document.createElement("tr");
                tr.appendChild(el("td", "mira-pred-issue-ev-ref", e.mr_id || e.wo_id || "—"));
                tr.appendChild(el("td", "mira-pred-issue-ev-date", _formatPredictiveDate(e.date)));
                var descCell = document.createElement("td");
                descCell.className = "mira-pred-issue-ev-desc";
                descCell.textContent = e.translated_description || e.description || "—";
                tr.appendChild(descCell);
                exBody2.appendChild(tr);
            });
            exTbl.appendChild(exBody2);
            secEx.append(exTbl);
            if (allEvidence.length > 3) {
                var showAllBtn = el("button", "mira-pred-drawer-show-all", "Show full MR history (" + allEvidence.length + ")");
                showAllBtn.type = "button";
                showAllBtn.addEventListener("click", function() {
                    var addBody = document.createElement("tbody");
                    allEvidence.slice(3).forEach(function(e) {
                        var tr = document.createElement("tr");
                        tr.appendChild(el("td", "mira-pred-issue-ev-ref", e.mr_id || e.wo_id || "—"));
                        tr.appendChild(el("td", "mira-pred-issue-ev-date", _formatPredictiveDate(e.date)));
                        var d2 = document.createElement("td");
                        d2.className = "mira-pred-issue-ev-desc";
                        d2.textContent = e.translated_description || e.description || "—";
                        tr.appendChild(d2);
                        addBody.appendChild(tr);
                    });
                    exTbl.appendChild(addBody);
                    showAllBtn.remove();
                });
                secEx.append(showAllBtn);
            }
            wrap.append(secEx);
        }

        wrap.append(el("p", "mira-pred-drawer-disclaimer",
            "AI-classified for review only. MIRA does not assign severity. Forecasts are based on available MR, asset, spare-part, and purchase history."));
        return wrap;
    }

    function _buildMachineRow(m) {
        var rowWrap = el("div", "mira-pred-mg-rowwrap");
        var main = el("div", "mira-pred-mg-row");

        // 1. Rank + trend
        var rankCell = el("div", "mira-pred-mg-rankcol");
        rankCell.append(el("span", "mira-pred-rank-pill", "#" + m.rank));
        var trendWrap = el("span", "mira-pred-machine-trend");
        trendWrap.innerHTML = _trendIcon(m.trend);
        rankCell.append(trendWrap);

        // 2. Machine name
        var machineCell = el("div", "mira-pred-mg-machine");
        var unitName = m.unit || m.specific_machine_group || m.machine_group || "—";
        machineCell.append(el("div", "mira-pred-machine-name", unitName));
        if (m.is_critical || m.asset_id) {
            var subRow = el("div", "mira-pred-machine-sub");
            if (m.is_critical) subRow.append(el("span", "mira-pred-critical-badge", "Critical"));
            if (m.asset_id) subRow.append(el("span", "mira-pred-assetid", m.asset_id));
            machineCell.append(subRow);
        }

        // 3. Main Issue — pill only; details go in drawer
        var issueCluster = (m.issue && m.issue.cluster) || m.recurring_issue || "—";
        var issueCell = el("div", "mira-pred-mg-issue");
        issueCell.append(el("span", "mira-pred-issue-pill " + _issuePillClass(issueCluster), issueCluster));

        // 4. Pattern Signal — "34 cycles · median 11d · last MR 8 Jun · history 2024–2026"
        var timing = m.timing || {};
        var signalCell = el("div", "mira-pred-mg-signal");
        var signalText = m.pattern_signal || (function() {
            var cnt = m.dominant_count || m.mr_count || 0;
            var parts = [cnt + " MR"];
            var lastDate = m.cluster_last_occurrence || m.last_occurrence;
            if (lastDate) parts.push("Last " + _shortDate(lastDate));
            if (timing.median_gap_days != null) parts.push("Gap ~" + timing.median_gap_days + "d");
            return parts.join(" · ");
        }());
        signalCell.append(el("div", "mira-pred-signal-text", signalText));
        if (timing.trend && timing.trend !== "stable") {
            var trendNote = timing.trend === "degrading" ? "Gap shrinking" : "Gap widening";
            signalCell.append(el("div", "mira-pred-signal-trend mira-pred-signal-trend-" + timing.trend, trendNote));
        }

        // 5. Next Likely Window
        var nextDueCell = el("div", "mira-pred-mg-nextdue");
        var dueLabel = m.likely_recurrence_label || m.recurrence_gauge || "Not enough history";
        var dueTone = "";
        if (/Likely now/i.test(dueLabel))                             dueTone = " mira-pred-nextdue-now";
        else if (/within 1 week/i.test(dueLabel))                    dueTone = " mira-pred-nextdue-soon";
        else if (/within 1.2 weeks/i.test(dueLabel))                 dueTone = " mira-pred-nextdue-soon";
        else if (/within 1 month/i.test(dueLabel))                   dueTone = " mira-pred-nextdue-month";
        else if (/within 1.2 months/i.test(dueLabel))                dueTone = " mira-pred-nextdue-months";
        else if (/in 2\+/i.test(dueLabel))                           dueTone = " mira-pred-nextdue-months";
        else if (/anytime now/i.test(dueLabel))                       dueTone = " mira-pred-nextdue-now";
        else if (/monitor|not enough|insufficient/i.test(dueLabel))  dueTone = " mira-pred-nextdue-unknown";
        nextDueCell.append(el("div", "mira-pred-nextdue-label" + dueTone, dueLabel));

        // 6. Stock Status
        var confidenceCell = el("div", "mira-pred-mg-confidence");
        var stockStatus = m.stock_status && m.stock_status !== "Unknown" ? m.stock_status : null;
        if (stockStatus) {
            confidenceCell.append(_buildStockBadge(stockStatus));
        } else {
            confidenceCell.append(el("span", "mira-pred-stock-na", "—"));
        }

        // 7. Action buttons — open drawer (no inline expand)
        var actionCell = el("div", "mira-pred-mg-toggle");
        var viewBtn = el("button", "mira-pred-toggle-btn", "View Details");
        viewBtn.type = "button";
        viewBtn.addEventListener("click", function() { _openForecastDrawer(m, "pattern"); });
        actionCell.append(viewBtn);
        if (m.is_critical) {
            actionCell.append(el("div", "mira-pred-toggle-note", "Critical asset"));
        }

        main.append(rankCell, machineCell, issueCell, signalCell, nextDueCell, confidenceCell, actionCell);
        rowWrap.append(main);
        return rowWrap;
    }

    function _buildCategorySection(cat, availableCats) {
        var sec = el("div", "mira-pred-cat-section");
        var hdr = el("div", "mira-pred-cat-header");
        hdr.append(el("span", "mira-pred-cat-name", "Top 5 Specific Machines — Recurring Issue Forecast"));
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
         ["mira-pred-mg-machine", "Machine"],
         ["mira-pred-mg-issue", "Recurring Issue Forecast"],
         ["mira-pred-mg-signal", "Pattern Signal"],
         ["mira-pred-mg-nextdue", "Next Likely Window"],
         ["mira-pred-mg-confidence", "Confidence"],
         ["mira-pred-mg-toggle", "Action"]
        ].forEach(function(pair) { colHdr.append(el("span", pair[0], pair[1])); });
        sec.append(colHdr);
        machines.forEach(function(m) { sec.append(_buildMachineRow(m)); });
        return sec;
    }

    function _renderPredKpiStrip(d) {
        var strip = document.getElementById("mira-pred-kpi-strip");
        if (!strip) return;
        strip.innerHTML = "";
        if (!d || d.empty || !d.categories) return;
        var totalMR = d.total_mrs || 0;
        var allMachines = [];
        (d.categories || []).forEach(function(cat) {
            (cat.top_machines || []).forEach(function(m) { allMachines.push(m); });
        });
        var withSpare = allMachines.filter(function(m) {
            return m.spare_available || (m.spare_parts && m.spare_parts.length > 0);
        }).length;
        var bits = [
            totalMR + " MR scanned",
            allMachines.length + " recurring pattern" + (allMachines.length !== 1 ? "s" : ""),
            allMachines.length + " machine" + (allMachines.length !== 1 ? "s" : "") + " flagged",
            withSpare + " with spare support"
        ];
        strip.append(el("span", "mira-pred-kpi-text", bits.join(" · ")));
    }

    function _renderPredCategories(d) {
        var host = document.getElementById("mira-pred-cats-body");
        if (!host) return;
        host.innerHTML = "";
        predictiveLatestPayload = d;
        predictiveLoadVersion += 1;
        _renderPredKpiStrip(d);
        if (d.empty || !d.categories || !d.categories.length) {
            host.innerHTML = "<p class=\"mira-ov-muted\">No data for this period.</p>";
            return;
        }
        var visibleCats = (d.categories || []).filter(function(cat) {
            return cat && (cat.name === "Production Equipment" || cat.name === "Utilities" || cat.name === "Refrigeration");
        });
        if (!visibleCats.length) {
            host.innerHTML = "<p class=\"mira-ov-muted\">No Production Equipment, Utilities, or Refrigeration data for this period.</p>";
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

    // ── Alert context routing ────────────────────────────────────────────────
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
                // Recurring MR issues live on the Downtime page (Machine Explorer, same
                // module the non-recurring branch below opens) — not Spare Parts, which
                // has no card for reviewing an MR issue history on a specific asset.
                return {
                    label: "View Recurring Issue",
                    navTarget: "downtime",
                    navFocus: "machine_explorer",
                    context: {
                        page: "downtime", focus: "machine_explorer",
                        alertType: "recurring_issue",
                        alertDescription: `${area} — repeated issue pattern detected`,
                        areaOrAsset: area, issueCluster: why,
                        stageFilter,
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
            navigateOverviewTarget(target, navFocus || null, context || null);
        });
        return btn;
    }

    function navigateOverviewTarget(target, navFocus, context) {
        const clickView = (view) => {
            const tab = document.querySelector(`[data-view-tab="${view}"]`);
            if (tab) { tab.click(); return true; }
            return false;
        };
        if (target === "downtime") {
            const switched = clickView("downtime");
            if (!switched) {
                window.location.href = "/Downtime/index.html";
                return;
            }
            if (navFocus) retryCallIntoDowntimeFrame(navFocus, context || {}, 0);
            return;
        }
        if (target === "pm") {
            clickView("overview");
            if (navFocus === "task_list") retryCallPmScheduleFocus(context || {}, 0);
            return;
        }
        if (target === "spare") {
            clickView("spare_parts");
            return;
        }
        if (target === "data_quality" || target === "asset_intelligence") {
            clickView("spare_parts");
            const tabName = target === "data_quality" ? "data_quality" : "intelligence";
            retryClickSpareTab(tabName, 0);
        }
    }

    // The Downtime page runs inside a same-origin iframe (#maintenance-downtime-frame)
    // that lazy-loads its src on first switch to the Downtime tab, so
    // window.downtimeFocusSection isn't necessarily defined yet the instant we click
    // the tab. Poll briefly for it rather than dropping the requested section.
    function retryCallIntoDowntimeFrame(navFocus, context, attempt) {
        const frame = document.getElementById("maintenance-downtime-frame");
        const fn = frame && frame.contentWindow && frame.contentWindow.downtimeFocusSection;
        if (typeof fn === "function") {
            fn(navFocus, context);
            return;
        }
        // Cold loads can take several seconds (the iframe fetches + renders the
        // full Downtime payload before init() defines this function) — 60
        // attempts at 150ms gives ~9s, generous enough without hanging forever.
        if (attempt < 60) window.setTimeout(() => retryCallIntoDowntimeFrame(navFocus, context, attempt + 1), 150);
    }

    function retryCallPmScheduleFocus(context, attempt) {
        const fn = window.pmScheduleFocusTaskList;
        if (typeof fn === "function") {
            fn(context);
            return;
        }
        if (attempt < 20) window.setTimeout(() => retryCallPmScheduleFocus(context, attempt + 1), 150);
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

    function renderDailyQualityAndAlerts(data, pres, warnings, verdict) {
        renderDailyAlerts(buildDailyAlertRows(data || {}, pres || {}, warnings || [], verdict || null));
    }

    function pushAlert(rows, key, area, flag, why, _action, _target, rank, extraData, category) {
        if (!why || rows.some((row) => row.key === key)) return;
        const route = getActionRouteForAlert(key, { area, why, ...(extraData || {}) });
        rows.push({
            key, area, flag, why: conciseText(why, 120), rank,
            action: route.label,
            target: route.navTarget,
            navFocus: route.navFocus || null,
            context: route.context || null,
            category: category || "PM / Data Review",
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
                { stage: state.stage }, "Immediate Review");
        }
        if (carryOver > 0) {
            pushAlert(rows, "carry-over", "Carry-over open MR", carryOver > 25 ? "Red" : "Amber",
                `${fmt(carryOver)} MR were raised before the period and remain unresolved.`, "View Downtime Details", "downtime", carryOver > 25 ? 20 : 40,
                { stage: state.stage }, "Immediate Review");
        }
        if (overdue > 0) {
            const pmCompText = num(pm.compliance_pct) === 0
                ? "PM completion records require verification."
                : `PM compliance ${fmt(pm.compliance_pct)}%.`;
            pushAlert(rows, "pm-overdue", "PM overdue tasks", overdue > 30 ? "Red" : "Amber",
                `${fmt(overdue)} overdue PM tasks. ${pmCompText}`, "View PM Details", "pm", overdue > 30 ? 15 : 35,
                undefined, "PM / Data Review");
        }
        if (missingAsset > 0) {
            pushAlert(rows, "missing-asset", "Missing Asset ID records", "Grey",
                `${fmt(missingAsset)} MR missing Asset ID. Recorded area only — missing actual Asset ID.`, "View Data Quality", "data_quality", 45,
                undefined, "PM / Data Review");
        }
        if (unknownStatus > 0) {
            pushAlert(rows, "unknown-status", "MR unmapped status", "Grey",
                `${fmt(unknownStatus)} MR have an unmapped status.`, "View Data Quality", "data_quality", 50,
                undefined, "PM / Data Review");
        }
        if (pmMissing > 0) {
            pushAlert(rows, "pm-mapping", "PM missing mapping", "Grey",
                `${fmt(pmMissing)} PM records are missing mapping.`, "View PM Details", "pm", 55,
                undefined, "PM / Data Review");
        }
        if (generalArea > 0) {
            pushAlert(rows, "area-only", "Recorded area only", "Grey",
                `${fmt(generalArea)} MR use generic area tags. Recorded area only — missing actual Asset ID.`, "View Data Quality", "data_quality", 60,
                undefined, "PM / Data Review");
        }

        const verdictItems = (verdict && Array.isArray(verdict.items) ? verdict.items : []).filter(isUsefulVerdictItem);
        verdictItems.slice(0, 2).forEach((item, index) => {
            const rag = String(item.rag || "Amber");
            const flag = rag === "Red" ? "Red" : "Amber";
            const isRecurring = !!item.recurrence;
            const cat = isRecurring ? "Recurring Risk" : "Immediate Review";
            const why = isRecurring
                ? `Open MR with repeated issue wording${item.recurrence_note ? ` (${item.recurrence_note})` : ""}.`
                : (item.reason || "Insufficient repeated history. Manual review required.");
            pushAlert(rows, `verdict-${index}-${item.asset_name}`, item.asset_name || "Asset review candidate", flag,
                why, "", "", flag === "Red" ? 12 + index : 42 + index,
                { recurrence: item.recurrence, recurrenceNote: item.recurrence_note, assetName: item.asset_name, stage: state.stage },
                cat);
        });

        if (!rows.length && (warnings || []).length) {
            pushAlert(rows, "data-warning", "Data reliability", "Grey", String(warnings[0]), "View Data Quality", "data_quality", 70,
                undefined, "PM / Data Review");
        }
        if (!rows.length) {
            pushAlert(rows, "manual-review", "Current selection", "Amber",
                "Insufficient repeated history. Manual review required.", "View Downtime Details", "downtime", 80,
                undefined, "PM / Data Review");
        }
        return rows.sort((a, b) => a.rank - b.rank);
    }

    function renderDailyAlerts(rows) {
        const host = refs.dailyAlerts || document.getElementById("mira-ov-verdict-body");
        if (!host) return;
        if (!rows || !rows.length) {
            host.innerHTML = `<p class="mira-ov-muted">No action alerts for the selected period.</p>`;
            return;
        }
        host.innerHTML = "";

        // Category order and display names
        const CAT_ORDER = ["Immediate Review", "Recurring Risk", "PM / Data Review", "Spare Parts / Procurement"];

        // Group rows by category
        const byCategory = {};
        rows.forEach((row) => {
            const cat = row.category || "PM / Data Review";
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(row);
        });

        CAT_ORDER.forEach((cat) => {
            const catRows = byCategory[cat];
            if (!catRows || !catRows.length) return;

            const catHeader = el("div", "mira-ov-alert-cat-header");
            const catBadgeClass = cat === "Immediate Review" ? "mira-ov-alert-cat-immediate"
                : cat === "Recurring Risk" ? "mira-ov-alert-cat-recurring"
                : cat === "Spare Parts / Procurement" ? "mira-ov-alert-cat-spare"
                : "mira-ov-alert-cat-data";
            catHeader.append(el("span", `mira-ov-alert-cat-badge ${catBadgeClass}`, cat));
            host.append(catHeader);

            const table = el("table", "mira-ov-alert-table");
            table.innerHTML = "<thead><tr><th>Area / Asset</th><th>Flag</th><th>Why it needs review</th><th>Action</th></tr></thead>";
            const tbody = el("tbody");
            catRows.forEach((row) => {
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
        });
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

    function _updateAlertStrip() {
        const strip = document.getElementById("mira-ov-kpi-alert-strip");
        if (!strip) return;
        const notes = Object.values(_sectionAttentionNotes).filter(Boolean);
        if (!notes.length) { strip.hidden = true; strip.innerHTML = ""; return; }
        strip.hidden = false;
        strip.innerHTML = "";
        const icon = el("span", "mira-ov-alert-strip-icon", "⚠");
        const content = el("span", "mira-ov-alert-strip-content", notes.join("  ·  "));
        strip.append(icon, content);
    }

    function renderSection(id, section) {
        const host = document.getElementById(id);
        if (!host) return;
        host.innerHTML = "";
        if (!section || !Array.isArray(section.metrics) || !section.metrics.length) {
            host.append(el("p", "mira-ov-muted", "No data available for the selected period."));
            return;
        }
        // Health badge
        const key = id.replace("mira-ov-kpi-", "");
        const badge = document.getElementById(`mira-ov-health-${key}`);
        if (badge && section.health_status) {
            badge.textContent = section.health_status;
            badge.className = `mira-ov-health-badge mira-ov-health-${section.health_status.toLowerCase()}`;
        }
        // Limit to 4 metrics
        const grid = el("div", "mira-ov-chip-grid");
        (section.metrics || []).slice(0, 4).forEach((m) => {
            const chip = el("div", `mira-ov-kpi-chip mira-tone-${m.tone || "neutral"}`);
            chip.append(el("span", "mira-ov-chip-label", m.label), el("strong", "mira-ov-chip-value", m.value));
            if (m.note) { chip.title = `${m.label}: ${m.value} — ${m.note}`; chip.classList.add("mira-ov-chip-has-note"); }
            grid.append(chip);
        });
        host.append(grid);
        // Inline warning (e.g. PM completion_warning) shown directly below chips
        if (section.completion_warning) {
            const warn = el("div", "mira-ov-pm-warning", "⚠ " + section.completion_warning);
            host.append(warn);
        }
        // Feed shared alert strip
        _sectionAttentionNotes[id] = section.attention_note || null;
        _updateAlertStrip();
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
                if (warmRetryTimer) { window.clearTimeout(warmRetryTimer); warmRetryTimer = null; }
                lastLoadSignature = signature;
                renderVerified(json);       // replaces fast-kpi chips with full verified data
                const availability = (json && ((json.data && json.data.data_availability) || json.data_availability)) || {};
                const fullVerifiedReady = availability.complete !== false && !(json && json.spare_warming);
                if (!fullVerifiedReady) {
                    scheduleWarmRetry(signature);
                    markAiSections("AI summary will refresh after verified data finishes loading.");
                    return;
                }
                warmRetries = 0;

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
        overviewLoadVersion += 1;

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

    // ── § Overview Export Report ──────────────────────────────────────────────
    const OVC = {
        navyBg: "1e293b", white: "FFFFFF",
        accent: "4f46e5", green: "16a34a", amber: "d97706",
        red: "dc2626", slate: "64748b", text: "1e293b",
        lightBg: "f8fafc", border: "e2e8f0", sub: "94a3b8",
        teal: "0891b2",
    };

    function _ovSetBtn(id, loading, label) {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = loading;
        btn.textContent = loading ? "Generating…" : label;
    }
    function _ovAllBtns(loading) {
        _ovSetBtn("ov-export-ppt", loading, "PPT");
        _ovSetBtn("ov-export-pdf", loading, "PDF");
    }

    function overviewReportData() {
        const d = (lastOverview && lastOverview.data) || {};
        const p = (lastOverview && lastOverview.pres) || {};
        const pred = predictiveLatestPayload || {};
        const wo = d.work_orders || {};
        const pm = d.pm_schedule || {};
        const dt = d.downtime_summary || {};
        const sections = p.sections || {};
        const vdu = p.view_data_used || {};

        const status = deriveStatus(d);
        const statusText = (refs.statusBadge && refs.statusBadge.textContent) || status.level;
        const periodText = (refs.statusPeriod && refs.statusPeriod.textContent) || ("Data period: " + periodLabel());
        const summaryLines = refs.summaryLine ? refs.summaryLine.map(l => l.textContent).filter(Boolean) : [];

        const dqChips = [];
        if (refs.dataQualityChips) {
            refs.dataQualityChips.querySelectorAll(".mira-ov-dq-chip").forEach(chip => {
                const lbl = chip.querySelector(".mira-ov-chip-label");
                const val = chip.querySelector(".mira-ov-chip-value");
                if (lbl && val) dqChips.push({ label: lbl.textContent, value: val.textContent, warn: chip.classList.contains("mira-ov-dq-chip-warn") });
            });
        }

        const alertRows = [];
        if (refs.dailyAlerts) {
            refs.dailyAlerts.querySelectorAll("tbody tr").forEach(tr => {
                const cells = tr.querySelectorAll("td");
                if (cells.length >= 3) alertRows.push({
                    area: cells[0] && cells[0].textContent.trim(),
                    flag: cells[1] && cells[1].textContent.trim(),
                    why: cells[2] && cells[2].textContent.trim(),
                });
            });
        }

        // Same live cards payload the PPT export reads (see buildPptReportData) —
        // "categories"/"top_machines" belonged to a predictive-insights shape
        // this app no longer returns.
        const predCardsAll = Array.isArray(pred.cards) ? [...pred.cards].sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0)) : [];
        const _cardToPdfRow = (c, i) => {
            const pat = c.latest_recurring_issue_pattern || {};
            const nextOcc = pat.next_likely_occurrence;
            return {
                rank: i + 1,
                machine: c.asset_name || c.machine_group || "—",
                issue: pat.issue || "—",
                nextLikely: (nextOcc && nextOcc.label) || "Not enough recurrence history",
                riskLevel: c.risk_level || "—",
                riskScore: c.risk_score,
                isCritical: (c.main_signals || []).some(s => s.label === "Asset marked critical"),
                suggestedAction: c.suggested_maintenance_action || "—",
            };
        };
        const predCategories = ["Production Equipment", "Utilities", "Refrigeration"].map((catName) => {
            const catCards = predCardsAll.filter((c) => c.category === catName);
            return { name: catName, top_machines: catCards.slice(0, 5).map(_cardToPdfRow) };
        });
        const faultPattern = _buildFaultPatternSummary(predCardsAll);
        const dataConfidence = _buildAssessmentCoverage(pred, predCardsAll);
        const predKpiStrip = _buildPredKpiStripText(pred, predCardsAll);

        return {
            filters: { periodMode: state.periodMode, year: state.year, month: state.month, stage: state.stage, label: vdu.period_label || periodLabel(), dateRange: vdu.date_range || "" },
            statusText, periodText, summaryLines,
            headlineKpis: p.kpi_cards || [],
            dqChips, alertRows,
            pmSection: sections.pm_schedule_summary || {},
            dtSection: sections.downtime_work_order_summary || {},
            spareSection: sections.spare_parts_summary || {},
            predCategories, faultPattern, dataConfidence, predKpiStrip,
            categoryView: predictiveCategoryView || "Production Equipment",
            warnings: latestWarnings || [],
            data: { wo, pm, dt },
            pres: { actionItems: p.action_items || [], priorityFollowUp: p.priority_follow_up || [] },
            exportedAt: new Date().toLocaleString(),
        };
    }

    // ── PPT helpers ────────────────────────────────────────────────────────────
    function _ovFmt(v) {
        if (v === null || v === undefined) return "—";
        if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1);
        return String(v) || "—";
    }
    function _ovTrunc(s, n) {
        const t = String(s || "").trim();
        return t.length > n ? t.slice(0, n - 1) + "…" : (t || "—");
    }

    // Most common recurring-issue category across all current risk cards —
    // the closest honest equivalent to the old backend's single "dominant
    // fault pattern" field, computed here since the live risk-cards payload
    // doesn't provide one directly.
    function _buildFaultPatternSummary(cards) {
        const counts = {};
        (cards || []).forEach((c) => {
            const issue = (c.latest_recurring_issue_pattern || {}).issue;
            if (issue && issue !== "Unclassified") counts[issue] = (counts[issue] || 0) + 1;
        });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (!top) return { empty: true };
        const groups = [...new Set(
            (cards || [])
                .filter((c) => (c.latest_recurring_issue_pattern || {}).issue === top[0])
                .map((c) => c.machine_group)
                .filter(Boolean)
        )];
        return {
            fault_family: top[0],
            count: top[1],
            pct_of_total: cards.length ? Math.round((top[1] / cards.length) * 100) : 0,
            affected_groups: groups,
        };
    }

    // Replaces the old backend's "data confidence" (asset-mapping/date-
    // completeness quality) with what the live risk-cards payload actually
    // reports: how much of the asset base got assessed and how many produced
    // an active risk signal. Different meaning, so the slide title/labels
    // are adjusted alongside this — not a like-for-like substitution.
    function _buildAssessmentCoverage(pred, cards) {
        const assessed = pred.assets_assessed;
        const scored = pred.scored_assets;
        if (assessed == null) return { band: null, label: "Assessment coverage unavailable.", riskCounts: null };
        const ratio = assessed ? (scored || 0) / assessed : 0;
        const band = ratio >= 0.5 ? "High" : ratio >= 0.25 ? "Medium" : "Low";
        const riskCounts = { High: 0, Medium: 0, Low: 0 };
        (cards || []).forEach((c) => { if (riskCounts[c.risk_level] != null) riskCounts[c.risk_level] += 1; });
        return {
            band,
            label: `${scored || 0} of ${assessed} assessed asset(s) have an active risk signal`,
            riskCounts,
        };
    }

    function _buildPredKpiStripText(pred, cards) {
        if (pred.assets_assessed == null) return "";
        const highRisk = (cards || []).filter((c) => c.risk_level === "High").length;
        return `Assets Assessed: ${pred.assets_assessed}  \xb7  With Risk Signals: ${pred.scored_assets || 0}  \xb7  High Risk: ${highRisk}  \xb7  Period: ${pred.period || "—"}`;
    }

    // ── Build PPT data (async — fetches MR + PM rows) ─────────────────────────
    async function buildPptReportData() {
        const data = (lastOverview && lastOverview.data) || {};
        const pres = (lastOverview && lastOverview.pres) || {};
        const pred = predictiveLatestPayload || {};
        const wo  = data.work_orders || {};
        const pm  = data.pm_schedule || {};
        const dt  = data.downtime_summary || {};
        const vdu = pres.view_data_used || {};

        const stageParam = state.stage === "stage1" ? "Stage 1" : state.stage === "stage2" ? "Stage 2" : "all";
        const yr = state.year || new Date().getFullYear();

        // ── Fetch MR records ─────────────────────────────────────────────────
        // Use work_order_source.records — ALL enriched records, no date filter,
        // so carry-over open records from before the selected period still appear.
        let mrRows = [];
        let _mrFallback = false;
        try {
            const u = "/api/downtime?period=ytd&stage=" + encodeURIComponent(stageParam) + "&year=" + encodeURIComponent(yr);
            const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(15000) });
            if (r.ok) {
                const j = await r.json();
                // Correct path: work_order_source.records = all records including carry-over open
                const src = (j.work_order_source && Array.isArray(j.work_order_source.records))
                    ? j.work_order_source.records
                    : (j.management && Array.isArray(j.management.work_orders))
                        ? j.management.work_orders
                        : [];
                mrRows = src;
                window.console.debug("[PPT] MR loaded:", mrRows.length,
                    "source=", j.work_order_source ? "work_order_source" : "management");
            }
        } catch (e) {
            window.console.warn("[PPT] MR fetch error:", e && e.message);
        }

        // ── Fetch PM tasks ───────────────────────────────────────────────────
        // Correct path: j.schedule.tasks (not j.payload.schedule.tasks)
        // j.schedule.tables.overdue = pre-filtered overdue list (already computed by backend)
        let pmTasks = [], pmOverdueTasks = [];
        let _pmFallback = false;
        try {
            const u = "/api/maintenance/pm-schedule?year=" + encodeURIComponent(yr) + "&stage=" + encodeURIComponent(stageParam);
            const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(15000) });
            if (r.ok) {
                const j = await r.json();
                const sched = j.schedule || {};
                pmTasks = Array.isArray(sched.tasks) ? sched.tasks
                    : (sched.tables && Array.isArray(sched.tables.all)) ? sched.tables.all : [];
                pmOverdueTasks = (sched.tables && Array.isArray(sched.tables.overdue)) ? sched.tables.overdue : [];
                window.console.debug("[PPT] PM loaded:", pmTasks.length, "tasks,", pmOverdueTasks.length, "pre-filtered overdue");
            }
        } catch (e) {
            window.console.warn("[PPT] PM fetch error:", e && e.message);
        }

        const today = new Date();
        const daysAgo = (d) => d ? Math.max(0, Math.floor((today - new Date(d)) / 86400000)) : 0;

        // ── MR action-needed filter (broad — same logic as the dashboard) ────
        // Backend sets is_open=true and acknowledgement_status="Pending" for open records.
        // status_category="Open" is the canonical indicator. request_state ("Finished",
        // "In Progress", "New", "Rejected") is the actual per-row status field on this
        // row shape — there is no plain "status" field on it.
        const _isActionNeeded = (r) => {
            if (r.is_open === true) return true;
            const cat = String(r.status_category || "").toLowerCase();
            if (cat === "open") return true;
            const st = String(r.request_state || "").toLowerCase();
            if (/\b(new|open|in.?progress|pending|awaiting|backlog)\b/.test(st)) return true;
            const ack = String(r.acknowledgement_status || "").toLowerCase();
            if (ack === "pending" || ack.includes("awaiting") || ack === "not acknowledged") return true;
            return false;
        };
        const _mrToRow = (r) => ({
            mrNo:        _ovTrunc(r.request_id || r.maintenance_order_id || r.mr_id || r.mr_number || "—", 22),
            woNo:        _ovTrunc(r.work_order_id || r.wo_id || "—", 22),
            machine:     _ovTrunc(r.asset_display_name || r.machine_name || r.machine_equipment_name || r.machine_group || r.raw_functional_location || "—", 42),
            severity:    r.criticality || r.normalized_criticality || "—",
            daysWaiting: daysAgo(r.request_created_time || r.start_time),
            status:      _ovTrunc(r.request_state || r.status_category || "—", 22),
            raisedDate:  String(r.request_created_time || r.start_time || "").slice(0, 10),
            description: _ovTrunc(r.translated_description || r.description || "—", 60),
        });

        let actionRows = mrRows.filter(_isActionNeeded).map(_mrToRow);
        window.console.debug("[PPT] MR action-needed:", actionRows.length, "| KPI open:", wo.open);

        // Fallback: if filter returns 0 but records loaded (missing/inconsistent ack fields),
        // use all non-closed records sorted by age — consistent with "carry-over" policy.
        if (actionRows.length === 0 && mrRows.length > 0) {
            _mrFallback = true;
            window.console.warn("[PPT] MR mismatch: KPI open=" + (wo.open || 0) + " but filter returned 0. Using non-closed records as fallback.");
            actionRows = mrRows.filter(r => {
                const st = String(r.request_state || r.status_category || "").toLowerCase();
                return !/\b(closed|confirmed|resolved|done|finished|completed)\b/.test(st);
            }).map(_mrToRow);
            window.console.debug("[PPT] MR fallback rows:", actionRows.length);
        }

        const latestUnackMr = [...actionRows]
            .sort((a, b) => b.raisedDate.localeCompare(a.raisedDate) || b.daysWaiting - a.daysWaiting)
            .slice(0, 10);
        const longestUnackMr = [...actionRows]
            .sort((a, b) => b.daysWaiting - a.daysWaiting || b.raisedDate.localeCompare(a.raisedDate))
            .slice(0, 10);
        window.console.debug("[PPT] Latest unack MR:", latestUnackMr.length, "| Longest unack MR:", longestUnackMr.length);

        // ── MTTR / MTBF computation from MR records ──────────────────────────
        const parseDateSafe = (val) => {
            if (!val) return null;
            const d = new Date(val);
            if (isNaN(d.getTime()) || d.getFullYear() < 2000) return null;
            return d;
        };
        const _classifyIssue = (text) => {
            const t = String(text || "").toLowerCase();
            if (/temperature|heating|not.?hot|burner|gas|flame|อุณหภูมิ|ไม่ร้อน/.test(t))  return "Heating / temperature";
            if (/leak|gasket|valve|pipe|steam|water|รั่ว|วาล์ว|ปะเก็น|ท่อ/.test(t))       return "Leakage / valve / piping";
            if (/motor|bearing|noise|vibrat|abnormal.?sound|เสียง|สั่น/.test(t))           return "Motor / bearing / vibration";
            if (/pump|compressor|refriger|คอมเพรส/.test(t))                                return "Pump / compressor";
            if (/filter|ไส้กรอง|กรองน้ำ/.test(t))                                          return "Filter / blockage";
            if (/resin|softener|ล้างเรซิน/.test(t))                                        return "Resin / softener";
            if (/sensor|alarm|electrical|wiring|breaker|สายไฟ|ไฟฟ้า/.test(t))             return "Electrical / sensor";
            if (/door|rubber.?seal|hinge|ซีล|ประตู/.test(t))                              return "Door / seal";
            if (/clean|dirty|ล้าง|ทำความสะอาด/.test(t))                                    return "Cleaning / hygiene";
            return "Other maintenance";
        };
        // _getMg: this row shape has no dedicated "machine family" field (machine_group/
        // equipment_category/building are all just the broad category, e.g. "Production
        // Equipment") — derive a specific group by stripping the trailing unit number off
        // the specific asset name instead (e.g. "Combi oven No.1" -> "Combi oven"), same
        // idea the old machine_family field was meant to provide.
        const _stripUnit = (s) => String(s || "").replace(/\s+(?:no\.?\s*|#\s*|unit\s*|-\s*)?\d+[\w-]*$/i, "").trim();
        const _BROAD_MG = /^(production equipment|facility[/ ]*building|facility|utilities|refrigeration|unknown|unmapped|review|unclassified)$/i;
        const _getSpecificAssetName = (r) => r.asset_display_name || r.machine_name || r.machine_equipment_name || "";
        const _getMg = (r) => {
            const an = _getSpecificAssetName(r);
            const stripped = an ? _stripUnit(an) : "";
            if (stripped && !_BROAD_MG.test(stripped) && stripped.length >= 3) return stripped;
            const mg = r.machine_group || r.equipment_category || r.building;
            if (mg && !_BROAD_MG.test(mg)) return mg;
            return r.raw_functional_location || "Unmapped / Review";
        };
        const _getAn = (r) => _getSpecificAssetName(r) || r.asset_id || "Unknown";

        const mttrByGroup = (() => {
            const groups = {};
            mrRows.forEach(r => {
                const mg = _getMg(r);
                const s = parseDateSafe(r.actual_start_time || r.maintenance_start_time || r.start_time);
                const e = parseDateSafe(r.actual_end_time   || r.maintenance_end_time   || r.end_time);
                if (!s || !e) return;
                const ttr = (e - s) / 86400000;
                if (ttr <= 0 || ttr > 365) return;
                if (!groups[mg]) groups[mg] = { ttrs: [], at: {}, iss: [] };
                groups[mg].ttrs.push(ttr);
                const an = _getAn(r);
                if (!groups[mg].at[an]) groups[mg].at[an] = [];
                groups[mg].at[an].push(ttr);
                groups[mg].iss.push(r.translated_description || r.description || "");
            });
            return Object.entries(groups)
                .filter(([, g]) => g.ttrs.length >= 2)
                .map(([mg, g]) => {
                    const avg = g.ttrs.reduce((a, b) => a + b, 0) / g.ttrs.length;
                    const ic = {};
                    g.iss.forEach(t => { const k = _classifyIssue(t); ic[k] = (ic[k] || 0) + 1; });
                    const topIssue = Object.entries(ic).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
                    let worstAsset = "—", worstAvg = 0;
                    Object.entries(g.at).forEach(([an, ttrs]) => {
                        const a = ttrs.reduce((x, y) => x + y, 0) / ttrs.length;
                        if (a > worstAvg) { worstAvg = a; worstAsset = an; }
                    });
                    return { mg, avgMttr: avg, woCount: g.ttrs.length, topIssue, worstAsset, worstMttr: worstAvg };
                })
                .sort((a, b) => b.avgMttr - a.avgMttr)
                .slice(0, 10);
        })();

        const mtbfByGroup = (() => {
            const groups = {};
            mrRows.forEach(r => {
                const mg = _getMg(r);
                const an = _getAn(r);
                const s = parseDateSafe(r.actual_start_time || r.maintenance_start_time || r.start_time);
                const e = parseDateSafe(r.actual_end_time   || r.maintenance_end_time   || r.end_time);
                if (!groups[mg]) groups[mg] = { assets: {}, iss: [] };
                if (!groups[mg].assets[an]) groups[mg].assets[an] = [];
                groups[mg].assets[an].push({ s, e });
                groups[mg].iss.push(r.translated_description || r.description || "");
            });
            return Object.entries(groups)
                .map(([mg, g]) => {
                    const allGaps = [], assetAvg = {};
                    Object.entries(g.assets).forEach(([an, evts]) => {
                        const sorted = evts.filter(ev => ev.e).sort((a, b) => a.e - b.e);
                        const gaps = [];
                        for (let i = 1; i < sorted.length; i++) {
                            if (!sorted[i].s) continue;
                            const gap = (sorted[i].s - sorted[i - 1].e) / 86400000;
                            if (gap >= 0 && gap <= 730) gaps.push(gap);
                        }
                        if (gaps.length) {
                            assetAvg[an] = gaps.reduce((x, y) => x + y, 0) / gaps.length;
                            allGaps.push(...gaps);
                        }
                    });
                    if (allGaps.length < 2) return null;
                    const avg = allGaps.reduce((a, b) => a + b, 0) / allGaps.length;
                    const ic = {};
                    g.iss.forEach(t => { const k = _classifyIssue(t); ic[k] = (ic[k] || 0) + 1; });
                    const topIssue = Object.entries(ic).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
                    let worstAsset = "—", worstGap = Infinity;
                    Object.entries(assetAvg).forEach(([an, a]) => { if (a < worstGap) { worstGap = a; worstAsset = an; } });
                    return { mg, avgMtbf: avg, recurrences: allGaps.length, topIssue, worstAsset, worstMtbf: worstGap === Infinity ? null : worstGap };
                })
                .filter(Boolean)
                .sort((a, b) => a.avgMtbf - b.avgMtbf)
                .slice(0, 10);
        })();

        const _allMttrVals = mrRows.reduce((acc, r) => {
            const s = parseDateSafe(r.actual_start_time || r.maintenance_start_time || r.start_time);
            const e = parseDateSafe(r.actual_end_time   || r.maintenance_end_time   || r.end_time);
            if (s && e) { const d = (e - s) / 86400000; if (d > 0 && d <= 365) acc.push(d); }
            return acc;
        }, []);

        // ── Predictive Insights rows ─────────────────────────────────────────
        // pred is the live risk-cards payload (predictiveLatestPayload — set by
        // _renderPredRiskCards from /api/mira/predictive's current response
        // shape: {cards: [...], assets_assessed, scored_assets, risk_rules,
        // period}). There is no "pred.categories"/"top_machines" shape anymore
        // — that belonged to a predictive-insights model this app no longer
        // uses. Build report rows straight from the cards each risk card
        // already carries (main_signals, latest_recurring_issue_pattern,
        // open_wo_status, suggested_maintenance_action) rather than reading
        // fields that were never part of the current API.
        const predCards = Array.isArray(pred.cards) ? pred.cards : [];
        const _cardToRfRow = (c, rank) => {
            const pat = c.latest_recurring_issue_pattern || {};
            const openStatus = c.open_wo_status || {};
            const isCritical = (c.main_signals || []).some(s => s.label === "Asset marked critical");
            const sig = [(pat.count || 1) + " occurrence" + (pat.count === 1 ? "" : "s")];
            if (pat.latest_date) sig.push("Last " + String(pat.latest_date).slice(0, 10));
            const nextOcc = pat.next_likely_occurrence;
            if (nextOcc && nextOcc.label) sig.push(nextOcc.label);
            return {
                rank:        rank,
                category:    c.category || "—",
                machine:     _ovTrunc(c.asset_name || c.machine_group || "—", 36),
                riskLevel:   c.risk_level || "—",
                riskScore:   c.risk_score != null ? c.risk_score : null,
                issue:       _ovTrunc(pat.issue || "—", 48),
                description: _ovTrunc(pat.latest_description || "", 64),
                signal:      sig.join(" \xb7 "),
                nextLikely:  (nextOcc && nextOcc.label) || "Not enough recurrence history",
                openWoSummary: _ovTrunc(openStatus.summary || "No aged open WO signal.", 40),
                suggestedAction: _ovTrunc(c.suggested_maintenance_action || "—", 46),
                isCritical,
            };
        };
        const cardsByRiskDesc = [...predCards].sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
        const recurringForecast = cardsByRiskDesc.slice(0, 5).map((c, i) => _cardToRfRow(c, i + 1));
        const rfCategories = ["Production Equipment", "Utilities", "Refrigeration"].map(catName => {
            const catCards = cardsByRiskDesc.filter(c => c.category === catName);
            return {
                name: catName,
                total_mrs: catCards.length,
                machines: catCards.slice(0, 5).map((c, i) => _cardToRfRow(c, i + 1)),
            };
        });

        const perfSummary = {
            mttrAvgDays:    _allMttrVals.length ? +(_allMttrVals.reduce((a, b) => a + b, 0) / _allMttrVals.length).toFixed(1) : null,
            mtbfAvgDays:    mtbfByGroup.length  ? +(mtbfByGroup.reduce((a, g) => a + g.avgMtbf, 0) / mtbfByGroup.length).toFixed(1) : null,
            validWoCount:   _allMttrVals.length,
            totalMrCount:   mrRows.length,
            worstMttrGroup: mttrByGroup[0] || null,
            worstMtbfGroup: mtbfByGroup[0] || null,
            recurringIssue: recurringForecast[0] ? recurringForecast[0].issue : "—",
            openMrCount:    wo.open || 0,
            unackMrCount:   actionRows.length,
        };
        window.console.debug("[PPT] MTTR groups:", mttrByGroup.length, "| MTBF groups:", mtbfByGroup.length, "| valid WOs:", perfSummary.validWoCount);

        // ── PM unfinished filter ─────────────────────────────────────────────
        // Public task fields: completionStatus ("Open"/"Completed (inferred)"),
        // scheduleStatus ("Overdue"/"Due This Month"/etc), daysOverdue (number).
        // Note: isDone/isOverdue are STRIPPED by _public_task() — use completionStatus/daysOverdue.
        const _isPmUnfinished = (t) => {
            const cs = String(t.completionStatus || "").toLowerCase();
            if (/completed|done|confirmed/.test(cs)) return false;
            if (cs === "open") return true;
            if ((t.daysOverdue || 0) > 0) return true;
            const ss = String(t.scheduleStatus || t.status || "").toLowerCase();
            if (/\b(overdue|open|pending|in.?progress|not.?started|backlog)\b/.test(ss)) return true;
            if (!t.completionDate && !t.actualCompletionDate) return true;
            return false;
        };
        const _pmToRow = (t) => ({
            id:          _ovTrunc(t.pmTaskId || "—", 20),
            asset:       _ovTrunc(t.assetName || "—", 34),
            location:    _ovTrunc(t.systemArea || "—", 24),
            dueDate:     String(t.plannedDate || "").slice(0, 10),
            daysOverdue: t.daysOverdue || 0,
            status:      _ovTrunc(t.scheduleStatus || t.completionStatus || "Open", 22),
            assignedTo:  _ovTrunc(t.contractorOrPIC || "—", 24),
            isOverdue:   (t.daysOverdue || 0) > 0,
        });

        // Start from pre-filtered overdue list (from backend), then add non-overdue unfinished
        let allUnfinished = [];
        if (pmOverdueTasks.length > 0) {
            const overdueIds = new Set(pmOverdueTasks.map(t => t.pmTaskId));
            const otherUnfinished = pmTasks.filter(t => !overdueIds.has(t.pmTaskId) && _isPmUnfinished(t));
            allUnfinished = [...pmOverdueTasks, ...otherUnfinished];
        } else {
            allUnfinished = pmTasks.filter(_isPmUnfinished);
        }
        window.console.debug("[PPT] PM unfinished:", allUnfinished.length, "| KPI overdue:", pm.overdue);

        // Fallback: filter returned 0 but KPI says overdue > 0 — use all non-completed tasks
        if (allUnfinished.length === 0 && pmTasks.length > 0) {
            _pmFallback = true;
            window.console.warn("[PPT] PM mismatch: KPI overdue=" + (pm.overdue || 0) + " but filter returned 0. Using all non-completed tasks.");
            allUnfinished = pmTasks.filter(t => {
                const cs = String(t.completionStatus || "").toLowerCase();
                return !/completed|done|confirmed/.test(cs);
            });
            window.console.debug("[PPT] PM fallback rows:", allUnfinished.length);
        }

        // Sort: overdue first (highest daysOverdue first), then oldest dueDate first
        allUnfinished.sort((a, b) => {
            const aOv = (a.daysOverdue || 0), bOv = (b.daysOverdue || 0);
            if (bOv !== aOv) return bOv - aOv;
            return (a.plannedDate || "") < (b.plannedDate || "") ? -1 : 1;
        });

        const actionNotes = refs.summaryLine ? refs.summaryLine.map(l => (l.textContent || "").trim()).filter(Boolean) : [];
        const alertRows = [];
        if (refs.dailyAlerts) {
            refs.dailyAlerts.querySelectorAll("tbody tr").forEach(tr => {
                const cells = tr.querySelectorAll("td");
                if (cells.length >= 3) alertRows.push({
                    area: (cells[0] && cells[0].textContent || "").trim(),
                    flag: (cells[1] && cells[1].textContent || "").trim(),
                    why:  _ovTrunc((cells[2] && cells[2].textContent || "").trim(), 90),
                });
            });
        }

        return {
            filters: {
                label: vdu.period_label || periodLabel(),
                dateRange: vdu.date_range || "",
                stage: state.stage,
                year: yr,
            },
            overviewKpis: {
                mrRaised:        wo.total,
                mrOpen:          wo.open,
                mrCarryOver:     dt.carry_over_open_mr != null ? dt.carry_over_open_mr : dt.opening_backlog_count,
                closureRate:     wo.closure_rate_pct,
                pmDue:           pm.total_scheduled != null ? pm.total_scheduled : pm.total,
                pmCompleted:     pm.completed != null ? pm.completed : pm.done_count,
                pmOverdue:       pm.overdue,
                pmCompliance:    pm.compliance_pct,
                downtimeOpen:    wo.open != null ? wo.open : dt.total_active_workload,
                downtimeClosed:  wo.closed != null ? wo.closed : wo.total_closed,
                dtCarryOver:     dt.carry_over_open_mr != null ? dt.carry_over_open_mr : dt.opening_backlog_count,
            },
            latestUnackMr,
            longestUnackMr,
            mrFallbackNote: _mrFallback ? "List based on open/unresolved records — acknowledgement field not available in this dataset." : null,
            mttrByGroup,
            mtbfByGroup,
            perfSummary,
            recurringForecast,
            rfCategories,
            activeCatName: predictiveCategoryView || "Production Equipment",
            faultPattern:        _buildFaultPatternSummary(predCards),
            dataConfidence:      _buildAssessmentCoverage(pred, predCards),
            predKpiStrip:        _buildPredKpiStripText(pred, predCards),
            unfinishedPm:        allUnfinished.slice(0, 10).map(_pmToRow),
            totalUnfinishedPm:   allUnfinished.length,
            pmFallbackNote: _pmFallback ? "List based on non-completed PM records — status field not available in this dataset." : null,
            actionNotes,
            alertRows,
            exportedAt: new Date().toLocaleString(),
        };
    }

    // ── Generate 7-slide management PPT from structured data ───────────────────
    async function generateOvPpt(R) {
        const pptx = new PptxGenJS();
        pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5"
        const stg  = R.filters.stage === "stage1" ? "Stage 1" : R.filters.stage === "stage2" ? "Stage 2" : "All Stages";
        const sub  = R.filters.label + (R.filters.dateRange ? "  \xb7  " + R.filters.dateRange : "") + "  \xb7  " + stg;
        const TOTAL = 6;
        const FF = "Calibri";

        function hdr(slide, title, n) {
            slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.54, fill: { color: OVC.navyBg } });
            slide.addText(title, { x: 0.18, y: 0.05, w: 9.5,  h: 0.26, fontSize: 14, bold: true, color: OVC.white, fontFace: FF });
            slide.addText(sub,   { x: 0.18, y: 0.30, w: 10.5, h: 0.19, fontSize: 8.5, color: OVC.sub, fontFace: FF });
            slide.addText(n + " / " + TOTAL, { x: 12.0, y: 0.14, w: 1.15, h: 0.24, fontSize: 9, color: OVC.sub, align: "right", fontFace: FF });
        }
        function secLabel(slide, x, y, w, text, count) {
            slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.04, h: 0.22, fill: { color: OVC.accent }, line: { color: OVC.accent } });
            const label = count != null ? text + "  (" + count + ")" : text;
            slide.addText(label, { x: x + 0.10, y, w: w - 0.10, h: 0.22, fontSize: 9.5, bold: true, color: OVC.navyBg, fontFace: FF });
        }
        function kpiCard(slide, x, y, w, h, value, label, color) {
            slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill: { color: OVC.lightBg }, line: { color: OVC.border }, rectRadius: 0.05 });
            slide.addShape(pptx.ShapeType.rect,      { x, y: y + 0.07, w: 0.05, h: h - 0.14, fill: { color: color }, line: { color: color } });
            slide.addText(_ovFmt(value), { x: x + 0.12, y: y + 0.06, w: w - 0.16, h: h * 0.57, fontSize: 20, bold: true, color, fontFace: FF, valign: "middle" });
            slide.addText(label,         { x: x + 0.12, y: y + h * 0.62, w: w - 0.16, h: h * 0.35, fontSize: 7.5, color: OVC.slate, fontFace: FF });
        }
        function tHdr(cols) {
            return cols.map(t => ({ text: t, options: { bold: true, fontSize: 8, color: OVC.white, fill: { color: OVC.navyBg }, valign: "middle" } }));
        }
        function tRow(cells, i) {
            const bg = i % 2 === 0 ? OVC.white : "f1f5f9";
            return cells.map(c => ({ text: String(c.v != null ? c.v : "—"), options: { fontSize: 7.5, color: c.c || OVC.text, fill: { color: bg }, bold: !!c.b, valign: "middle" } }));
        }
        function foot(slide) {
            slide.addText(
                "Data based on selected dashboard period and filters. Technician/Engineer verification required before action.  \xb7  Generated " + R.exportedAt,
                { x: 0.18, y: 7.24, w: 13.0, h: 0.20, fontSize: 6.5, color: OVC.sub, fontFace: FF, italic: true }
            );
        }

        // ─── Slide 1 — Maintenance Overview Summary ───────────────────────────
        const s1 = pptx.addSlide();
        hdr(s1, "Maintenance Overview Report", 1);
        s1.addText(
            "Period: " + R.filters.label + (R.filters.dateRange ? "  \xb7  " + R.filters.dateRange : "") +
            "   |   Stage: " + stg + "   |   Year: " + R.filters.year,
            { x: 0.18, y: 0.62, w: 13.0, h: 0.20, fontSize: 8.5, color: OVC.slate, fontFace: FF }
        );
        secLabel(s1, 0.18, 0.90, 8.0, "MR / Work Order Overview");
        const mrKw = 3.10, mrKg = 0.12;
        [
            { v: R.overviewKpis.mrRaised,   l: "MR Raised",          c: OVC.accent },
            { v: R.overviewKpis.mrOpen,      l: "Open / In Progress", c: OVC.amber  },
            { v: R.overviewKpis.mrCarryOver, l: "Carry-over Open MR", c: OVC.red    },
            { v: R.overviewKpis.closureRate != null ? _ovFmt(R.overviewKpis.closureRate) + "%" : null, l: "Closure Rate", c: OVC.green },
        ].forEach((k, i) => kpiCard(s1, 0.18 + i * (mrKw + mrKg), 1.16, mrKw, 1.02, k.v, k.l, k.c));

        const col2Y = 2.30;
        secLabel(s1, 0.18, col2Y, 6.30, "PM Schedule Summary");
        secLabel(s1, 6.85, col2Y, 6.30, "Downtime / MR Summary");
        const cY = col2Y + 0.30, pmW = 2.95, pmG = 0.10, pmH = 0.48;
        [
            { v: R.overviewKpis.pmDue,      l: "PM Due",    c: OVC.accent },
            { v: R.overviewKpis.pmCompleted, l: "Completed", c: OVC.green  },
            { v: R.overviewKpis.pmOverdue,   l: "Overdue",   c: OVC.red    },
            { v: R.overviewKpis.pmCompliance != null ? _ovFmt(R.overviewKpis.pmCompliance) + "%" : null, l: "Compliance", c: OVC.teal },
        ].forEach((k, i) => kpiCard(s1, 0.18 + (i % 2) * (pmW + pmG), cY + Math.floor(i / 2) * (pmH + 0.08), pmW, pmH, k.v, k.l, k.c));
        const dtW = 1.96, dtG = 0.12;
        [
            { v: R.overviewKpis.downtimeOpen,   l: "Open / In Progress", c: OVC.amber },
            { v: R.overviewKpis.downtimeClosed, l: "Closed / Confirmed", c: OVC.green },
            { v: R.overviewKpis.dtCarryOver,    l: "Carry-over Open",    c: OVC.red   },
        ].forEach((k, i) => kpiCard(s1, 6.85 + i * (dtW + dtG), cY + 0.08, dtW, pmH * 2 + 0.08, k.v, k.l, k.c));

        const notesY = cY + pmH * 2 + 0.08 + 0.22;
        secLabel(s1, 0.18, notesY, 13.0, "Main Concern & Action Notes");
        const slClrs = [OVC.red, OVC.text, OVC.accent];
        let curY = notesY + 0.30;
        R.actionNotes.forEach((line, i) => {
            if (!line || curY > 5.70) return;
            s1.addText(line, { x: 0.28, y: curY, w: 12.9, h: 0.26, fontSize: 9, color: slClrs[i] || OVC.text, fontFace: FF });
            curY += 0.28;
        });
        R.alertRows.slice(0, 5).forEach(row => {
            if (curY > 5.70) return;
            const fc = row.flag === "Red" ? OVC.red : row.flag === "Amber" ? OVC.amber : OVC.slate;
            const bullet = row.flag === "Red" ? "● " : row.flag === "Amber" ? "◆ " : "■ ";
            s1.addText(bullet + row.area + "  —  " + row.why, { x: 0.32, y: curY, w: 12.82, h: 0.26, fontSize: 8.5, color: fc, fontFace: FF });
            curY += 0.28;
        });
        if (!R.actionNotes.length && !R.alertRows.length) {
            s1.addText("No action alerts for the selected period.", { x: 0.28, y: curY, w: 12.9, h: 0.26, fontSize: 9, color: OVC.sub, fontFace: FF });
        }
        foot(s1);

        // ─── Slide 2 — Downtime & MR Action List ─────────────────────────────
        const s2 = pptx.addSlide();
        hdr(s2, "Downtime & MR Action List", 2);
        s2.addText("Source: Downtime / MR data  \xb7  " + R.filters.label + "  \xb7  " + stg + "  \xb7  Unacknowledged = open with pending or no acknowledgement action",
            { x: 0.18, y: 0.62, w: 13.0, h: 0.19, fontSize: 7.5, color: OVC.slate, fontFace: FF, italic: true });

        var s2NoteY = 0.88;
        if (R.mrFallbackNote) {
            s2.addText("⚠ " + R.mrFallbackNote, { x: 0.18, y: s2NoteY, w: 13.0, h: 0.18, fontSize: 7, color: OVC.amber, italic: true, fontFace: FF });
            s2NoteY += 0.20;
        }
        secLabel(s2, 0.18, s2NoteY, 10.0, "A.  Top 10 Latest Unacknowledged MR  (newest first)", R.latestUnackMr.length);
        var aTableY2 = s2NoteY + 0.26;
        const aCols2 = [1.35, 1.35, 2.8, 0.9, 1.4, 1.0, 4.2];
        const aHdr2  = tHdr(["MR No.", "WO No.", "Equipment / Machine", "Days Wait", "Status", "Raised", "Issue Description"]);
        const aData2 = R.latestUnackMr.slice(0, 8).map((r, i) => tRow([
            { v: r.mrNo },
            { v: r.woNo },
            { v: r.machine },
            { v: r.daysWaiting, c: r.daysWaiting > 14 ? OVC.red : r.daysWaiting > 7 ? OVC.amber : OVC.text },
            { v: r.status },
            { v: r.raisedDate },
            { v: r.description },
        ], i));
        if (aData2.length) {
            s2.addTable([aHdr2, ...aData2], { x: 0.18, y: aTableY2, w: 13.0, fontFace: FF, colW: aCols2, border: { color: OVC.border }, rowH: 0.25 });
        } else {
            s2.addText("No unacknowledged MR for this period.", { x: 0.28, y: aTableY2, w: 13.0, h: 0.28, fontSize: 8.5, color: OVC.sub, fontFace: FF });
        }
        const aEnd2 = aTableY2 + 0.25 + (aData2.length ? aData2.length * 0.25 : 0.28);
        if (R.latestUnackMr.length > 8) {
            s2.addText("+" + (R.latestUnackMr.length - 8) + " more — see Downtime page for full list.",
                { x: 0.28, y: aEnd2 + 0.04, w: 13.0, h: 0.16, fontSize: 7, color: OVC.slate, italic: true, fontFace: FF });
        }
        const bY2 = aEnd2 + (R.latestUnackMr.length > 8 ? 0.24 : 0.16);
        secLabel(s2, 0.18, bY2, 10.0, "B.  Top 10 Longest Unacknowledged MR  (oldest wait first)", R.longestUnackMr.length);
        const bCols2 = [1.35, 1.35, 2.8, 0.9, 1.4, 1.0, 4.2];
        const bHdr2  = tHdr(["MR No.", "WO No.", "Equipment / Machine", "Days Wait", "Status", "Raised", "Issue Description"]);
        const bData2 = R.longestUnackMr.slice(0, 8).map((r, i) => tRow([
            { v: r.mrNo },
            { v: r.woNo },
            { v: r.machine },
            { v: r.daysWaiting, c: r.daysWaiting > 14 ? OVC.red : r.daysWaiting > 7 ? OVC.amber : OVC.text },
            { v: r.status },
            { v: r.raisedDate },
            { v: r.description },
        ], i));
        if (bData2.length) {
            s2.addTable([bHdr2, ...bData2], { x: 0.18, y: bY2 + 0.25, w: 13.0, fontFace: FF, colW: bCols2, border: { color: OVC.border }, rowH: 0.25 });
        } else {
            s2.addText("No long-waiting MR for this period.", { x: 0.28, y: bY2 + 0.25, w: 13.0, h: 0.28, fontSize: 8.5, color: OVC.sub, fontFace: FF });
        }
        const bEnd2 = bY2 + 0.25 + 0.25 + (bData2.length ? bData2.length * 0.25 : 0.28);
        if (R.longestUnackMr.length > 8) {
            s2.addText("+" + (R.longestUnackMr.length - 8) + " more — see Downtime page for full list.",
                { x: 0.28, y: bEnd2 + 0.04, w: 13.0, h: 0.16, fontSize: 7, color: OVC.slate, italic: true, fontFace: FF });
        }
        foot(s2);

        // ─── Slide 3 — Recurring Machine Issue Forecast (3 categories) ───────
        const s3 = pptx.addSlide();
        hdr(s3, "Recurring Machine Issue Forecast", 3);
        if (R.predKpiStrip) s3.addText(R.predKpiStrip, { x: 0.18, y: 0.62, w: 13.0, h: 0.19, fontSize: 8, color: OVC.slate, fontFace: FF });
        s3.addText("Top risk-scored assets per category, ranked by calculated risk score. See Predictive Insights for full scoring detail.",
            { x: 0.18, y: 0.82, w: 13.0, h: 0.16, fontSize: 7, color: OVC.slate, italic: true, fontFace: FF });

        const rfCols3 = [0.28, 1.15, 1.75, 2.10, 1.10, 2.30, 1.80, 2.52];
        const rfHdr3  = tHdr(["#", "Category", "Machine", "Latest Recurring Issue", "Risk", "Open WO Status", "Pattern Signal", "Suggested Action"]);
        var s3Y = 1.02;

        (R.rfCategories || []).forEach(cat => {
            const catHasMachines = cat.machines && cat.machines.length > 0;
            const catLabel = cat.name + (cat.total_mrs ? "  (" + cat.total_mrs + " flagged)" : "");
            secLabel(s3, 0.18, s3Y, 13.0, catLabel, catHasMachines ? cat.machines.length : null);
            s3Y += 0.24;
            if (!catHasMachines) {
                s3.addText("No risk-scored assets for this category in the selected period.", { x: 0.28, y: s3Y, w: 13.0, h: 0.22, fontSize: 8, color: OVC.sub, fontFace: FF });
                s3Y += 0.28;
                return;
            }
            const rfRows3 = cat.machines.map((m, i) => {
                const cc = String(m.riskLevel).toLowerCase() === "high" ? OVC.red : String(m.riskLevel).toLowerCase() === "medium" ? OVC.amber : OVC.green;
                const riskLabel = (m.riskLevel || "—") + (m.riskScore != null ? " (" + m.riskScore + "/10)" : "");
                return tRow([
                    { v: m.rank || (i + 1), c: OVC.slate },
                    { v: m.category || cat.name, c: OVC.slate },
                    { v: m.machine + (m.isCritical ? " ★" : ""), b: m.isCritical },
                    { v: m.issue, c: OVC.accent },
                    { v: riskLabel, c: cc, b: true },
                    { v: m.openWoSummary, c: OVC.slate },
                    { v: m.signal, c: OVC.slate },
                    { v: m.suggestedAction },
                ], i);
            });
            s3.addTable([rfHdr3, ...rfRows3], { x: 0.18, y: s3Y, w: 13.0, fontFace: FF, colW: rfCols3, border: { color: OVC.border }, rowH: 0.24, fontSize: 5.8, margin: 0.02 });
            s3Y += 0.24 + rfRows3.length * 0.24 + 0.12;
        });

        // Fault pattern + confidence at bottom
        const rfBotY3 = Math.max(s3Y + 0.06, 5.60);
        const fp = R.faultPattern;
        s3.addShape(pptx.ShapeType.roundRect, { x: 0.18, y: rfBotY3, w: 6.45, h: 1.50, fill: { color: OVC.lightBg }, line: { color: OVC.border }, rectRadius: 0.05 });
        secLabel(s3, 0.28, rfBotY3 + 0.10, 6.15, "Dominant Fault Pattern");
        if (fp && !fp.empty) {
            s3.addText((fp.fault_family || "—") + "  \xd7" + (fp.count || 0) + "  (" + (fp.pct_of_total || 0) + "% of MR)",
                { x: 0.32, y: rfBotY3 + 0.36, w: 6.1, h: 0.26, fontSize: 10.5, color: OVC.accent, bold: true, fontFace: FF });
            if (fp.affected_groups && fp.affected_groups.length)
                s3.addText("Affects: " + fp.affected_groups.slice(0, 5).join(", "),
                    { x: 0.32, y: rfBotY3 + 0.64, w: 6.1, h: 0.20, fontSize: 8, color: OVC.slate, fontFace: FF });
        } else {
            s3.addText("No dominant fault pattern detected.", { x: 0.32, y: rfBotY3 + 0.36, w: 6.1, h: 0.24, fontSize: 8.5, color: OVC.sub, fontFace: FF });
        }
        const conf = R.dataConfidence;
        const cbc  = conf.band === "High" ? OVC.green : conf.band === "Medium" ? OVC.amber : OVC.red;
        s3.addShape(pptx.ShapeType.roundRect, { x: 6.87, y: rfBotY3, w: 6.28, h: 1.50, fill: { color: OVC.lightBg }, line: { color: OVC.border }, rectRadius: 0.05 });
        secLabel(s3, 6.97, rfBotY3 + 0.10, 6.0, "Assessment Coverage");
        s3.addText((conf.band || "—") + "  —  " + (conf.label || "Coverage data unavailable."),
            { x: 7.01, y: rfBotY3 + 0.36, w: 6.0, h: 0.26, fontSize: 9.5, color: cbc, bold: true, fontFace: FF });
        if (conf.riskCounts) {
            s3.addText(
                `High: ${conf.riskCounts.High}   \xb7   Medium: ${conf.riskCounts.Medium}   \xb7   Low: ${conf.riskCounts.Low}`,
                { x: 7.01, y: rfBotY3 + 0.64, w: 6.0, h: 0.20, fontSize: 8, color: OVC.slate, fontFace: FF }
            );
        }
        foot(s3);

        // ─── Slide 4 — PM Schedule & Unfinished PM Tasks ─────────────────────
        const s4 = pptx.addSlide();
        hdr(s4, "PM Schedule & Unfinished PM Tasks", 4);
        s4.addText("Source: PM Schedule data  \xb7  " + R.filters.label + "  \xb7  " + stg + "  \xb7  Sorted: Overdue first, oldest due date",
            { x: 0.18, y: 0.62, w: 13.0, h: 0.19, fontSize: 7.5, color: OVC.slate, fontFace: FF, italic: true });
        secLabel(s4, 0.18, 0.88, 7.0, "PM Schedule Summary");
        const pmKw = 3.10, pmKg = 0.12;
        [
            { v: R.overviewKpis.pmDue,      l: "PM Due This Month", c: OVC.accent },
            { v: R.overviewKpis.pmCompleted, l: "Completed",         c: OVC.green  },
            { v: R.overviewKpis.pmOverdue,   l: "Overdue",           c: OVC.red    },
            { v: R.overviewKpis.pmCompliance != null ? _ovFmt(R.overviewKpis.pmCompliance) + "%" : null, l: "PM Compliance", c: OVC.teal },
        ].forEach((k, i) => kpiCard(s4, 0.18 + i * (pmKw + pmKg), 1.14, pmKw, 1.00, k.v, k.l, k.c));

        var s4SecY = 2.26;
        if (R.pmFallbackNote) {
            s4.addText("⚠ " + R.pmFallbackNote, { x: 0.18, y: s4SecY, w: 13.0, h: 0.18, fontSize: 7, color: OVC.amber, italic: true, fontFace: FF });
            s4SecY += 0.20;
        }
        secLabel(s4, 0.18, s4SecY, 10.0, "Unfinished / Overdue PM Tasks", R.totalUnfinishedPm || 0);
        var s4TableY = s4SecY + 0.26;
        const pmCols = [1.8, 3.5, 2.2, 1.2, 1.0, 1.8, 1.5];
        const pmHdr  = tHdr(["PM Task ID", "Asset / Machine", "Functional Location", "Due Date", "Days OD", "Status", "Assigned To"]);
        const pmData  = R.unfinishedPm.map((t, i) => tRow([
            { v: t.id },
            { v: t.asset },
            { v: t.location },
            { v: t.dueDate },
            { v: t.isOverdue ? t.daysOverdue : "—", c: t.isOverdue ? OVC.red : OVC.slate, b: t.isOverdue },
            { v: t.status, c: t.isOverdue ? OVC.red : t.status === "Backlog" ? OVC.amber : OVC.text },
            { v: t.assignedTo },
        ], i));
        if (pmData.length) {
            s4.addTable([pmHdr, ...pmData], { x: 0.18, y: s4TableY, w: 13.0, fontFace: FF, colW: pmCols, border: { color: OVC.border }, rowH: 0.27 });
        } else {
            s4.addText("No unfinished PM tasks for the selected period.", { x: 0.28, y: s4TableY, w: 13.0, h: 0.28, fontSize: 8.5, color: OVC.sub, fontFace: FF });
        }
        if (R.totalUnfinishedPm > 10) {
            const pmMoreY = s4TableY + 0.30 + (pmData.length ? pmData.length * 0.27 : 0.28);
            s4.addText("+" + (R.totalUnfinishedPm - 10) + " more unfinished PM tasks — see PM Schedule page for full list.",
                { x: 0.28, y: pmMoreY + 0.06, w: 13.0, h: 0.20, fontSize: 7.5, color: OVC.slate, italic: true, fontFace: FF });
        }
        foot(s4);

        // ─── Slide 5 — Performance Summary ───────────────────────────────────
        const s5 = pptx.addSlide();
        hdr(s5, "Performance Summary", 5);
        s5.addText("Computed from MR / WO records  \xb7  " + R.filters.label + "  \xb7  " + stg,
            { x: 0.18, y: 0.62, w: 13.0, h: 0.19, fontSize: 7.5, color: OVC.slate, fontFace: FF, italic: true });

        const ps = R.perfSummary;
        secLabel(s5, 0.18, 0.88, 13.0, "Key Performance Indicators");
        const pfW = 2.50, pfG = 0.12, pfH = 1.10;
        [
            { v: ps.mttrAvgDays != null ? ps.mttrAvgDays + "d" : "N/A", l: "Avg MTTR (Overall)",    c: OVC.accent },
            { v: ps.mtbfAvgDays != null ? ps.mtbfAvgDays + "d" : "N/A", l: "Avg MTBF (Overall)",    c: OVC.teal  },
            { v: ps.validWoCount,                                         l: "WOs with Valid Dates",  c: OVC.slate },
            { v: ps.openMrCount,                                          l: "Open MR",               c: OVC.amber },
            { v: ps.unackMrCount,                                         l: "Unacknowledged MR",     c: OVC.red   },
        ].forEach((k, i) => kpiCard(s5, 0.18 + i * (pfW + pfG), 1.14, pfW, pfH, k.v, k.l, k.c));

        const ps2Y = 1.14 + pfH + 0.22;
        secLabel(s5, 0.18, ps2Y, 6.30, "Highest MTTR Machine Group");
        s5.addShape(pptx.ShapeType.roundRect, { x: 0.18, y: ps2Y + 0.28, w: 6.30, h: 1.30, fill: { color: OVC.lightBg }, line: { color: OVC.border }, rectRadius: 0.05 });
        const wmt = ps.worstMttrGroup;
        if (wmt) {
            s5.addText(wmt.mg, { x: 0.32, y: ps2Y + 0.38, w: 6.0, h: 0.30, fontSize: 11, bold: true, color: OVC.accent, fontFace: FF });
            s5.addText("Avg MTTR: " + wmt.avgMttr.toFixed(1) + " days  \xb7  " + wmt.woCount + " WOs",
                { x: 0.32, y: ps2Y + 0.72, w: 6.0, h: 0.22, fontSize: 8.5, color: OVC.text, fontFace: FF });
            s5.addText("Top issue: " + wmt.topIssue + "  \xb7  Worst machine: " + wmt.worstAsset,
                { x: 0.32, y: ps2Y + 0.96, w: 6.0, h: 0.22, fontSize: 8, color: OVC.slate, fontFace: FF });
        } else {
            s5.addText("Insufficient data.", { x: 0.32, y: ps2Y + 0.60, w: 6.0, h: 0.24, fontSize: 8.5, color: OVC.sub, fontFace: FF });
        }
        secLabel(s5, 6.85, ps2Y, 6.30, "Lowest MTBF Machine Group  (most frequent breakdown)");
        s5.addShape(pptx.ShapeType.roundRect, { x: 6.85, y: ps2Y + 0.28, w: 6.30, h: 1.30, fill: { color: OVC.lightBg }, line: { color: OVC.border }, rectRadius: 0.05 });
        const wmbf = ps.worstMtbfGroup;
        if (wmbf) {
            s5.addText(wmbf.mg, { x: 6.99, y: ps2Y + 0.38, w: 6.0, h: 0.30, fontSize: 11, bold: true, color: OVC.teal, fontFace: FF });
            s5.addText("Avg MTBF: " + wmbf.avgMtbf.toFixed(1) + " days  \xb7  " + wmbf.recurrences + " recurrences",
                { x: 6.99, y: ps2Y + 0.72, w: 6.0, h: 0.22, fontSize: 8.5, color: OVC.text, fontFace: FF });
            s5.addText("Top issue: " + wmbf.topIssue + "  \xb7  Worst machine: " + wmbf.worstAsset,
                { x: 6.99, y: ps2Y + 0.96, w: 6.0, h: 0.22, fontSize: 8, color: OVC.slate, fontFace: FF });
        } else {
            s5.addText("Insufficient data.", { x: 6.99, y: ps2Y + 0.60, w: 6.0, h: 0.24, fontSize: 8.5, color: OVC.sub, fontFace: FF });
        }

        const ps3Y = ps2Y + 1.30 + 0.30;
        secLabel(s5, 0.18, ps3Y, 13.0, "Top Recurring Issue  &  Data Coverage");
        s5.addShape(pptx.ShapeType.roundRect, { x: 0.18, y: ps3Y + 0.28, w: 6.30, h: 1.00, fill: { color: OVC.lightBg }, line: { color: OVC.border }, rectRadius: 0.05 });
        s5.addText("Top Recurring Issue:", { x: 0.32, y: ps3Y + 0.36, w: 6.0, h: 0.20, fontSize: 8, color: OVC.slate, fontFace: FF });
        s5.addText(ps.recurringIssue, { x: 0.32, y: ps3Y + 0.58, w: 6.0, h: 0.30, fontSize: 10, bold: true, color: OVC.accent, fontFace: FF });
        const topRf = R.recurringForecast[0];
        const psRfMachine = topRf ? topRf.machine + (topRf.nextLikely ? "  \xb7  " + topRf.nextLikely : "") : "";
        if (psRfMachine) s5.addText(psRfMachine, { x: 0.32, y: ps3Y + 0.88, w: 6.0, h: 0.20, fontSize: 7.5, color: OVC.slate, fontFace: FF });
        s5.addShape(pptx.ShapeType.roundRect, { x: 6.85, y: ps3Y + 0.28, w: 6.30, h: 1.00, fill: { color: OVC.lightBg }, line: { color: OVC.border }, rectRadius: 0.05 });
        s5.addText("MTTR / MTBF Data Coverage:", { x: 6.99, y: ps3Y + 0.36, w: 6.0, h: 0.20, fontSize: 8, color: OVC.slate, fontFace: FF });
        const pctCov = ps.totalMrCount ? Math.round(ps.validWoCount / ps.totalMrCount * 100) : 0;
        s5.addText(ps.validWoCount + " of " + ps.totalMrCount + " records have valid start / end dates  (" + pctCov + "%)",
            { x: 6.99, y: ps3Y + 0.58, w: 6.0, h: 0.50, fontSize: 9, color: pctCov < 50 ? OVC.amber : OVC.text, fontFace: FF, wrap: true });
        foot(s5);

        // ─── Slide 6 — MTTR & MTBF Performance — Top Machine Groups ─────────
        const s6 = pptx.addSlide();
        hdr(s6, "MTTR & MTBF Performance — Top Machine Groups", 6);

        // Subtitle
        const todayStr6 = new Date().toISOString().slice(0, 10);
        s6.addText(
            "Avg MTTR = actual end − actual start (completed WOs, valid dates only) · " +
            "Avg MTBF = gap between consecutive failures on same asset · " +
            R.filters.label + (R.filters.dateRange ? " · " + R.filters.dateRange : " · YTD 2026 · " + todayStr6) +
            " · " + stg,
            { x: 0.18, y: 0.62, w: 13.0, h: 0.19, fontSize: 7, color: OVC.slate, fontFace: FF, italic: true }
        );

        // ── KPI chips row ─────────────────────────────────────────────────────
        const ps6 = R.perfSummary;
        const s6MgCount = new Set([...R.mttrByGroup.map(g => g.mg), ...R.mtbfByGroup.map(g => g.mg)]).size;
        const chips6 = [
            { label: "Overall Avg MTTR",        val: ps6.mttrAvgDays != null ? ps6.mttrAvgDays + "d"  : "—", tone: ps6.mttrAvgDays > 7 ? OVC.red : ps6.mttrAvgDays > 3 ? OVC.amber : OVC.green },
            { label: "Overall Avg MTBF",        val: ps6.mtbfAvgDays != null ? ps6.mtbfAvgDays + "d"  : "—", tone: ps6.mtbfAvgDays != null && ps6.mtbfAvgDays < 30 ? OVC.red : ps6.mtbfAvgDays < 60 ? OVC.amber : OVC.green },
            { label: "Completed WOs Analysed",  val: ps6.validWoCount != null ? String(ps6.validWoCount) : "—", tone: OVC.teal },
            { label: "Machine Groups Reviewed",  val: String(s6MgCount),  tone: OVC.accent },
        ];
        const chipW = 3.08, chipX0 = 0.18, chipY = 0.86, chipH = 0.44;
        chips6.forEach((c, i) => {
            const cx = chipX0 + i * (chipW + 0.12);
            s6.addShape(pptx.ShapeType.roundRect, { x: cx, y: chipY, w: chipW, h: chipH, fill: { color: OVC.lightBg }, line: { color: OVC.border }, rectRadius: 0.05 });
            s6.addText(c.val,   { x: cx + 0.08, y: chipY + 0.03, w: chipW - 0.16, h: 0.24, fontSize: 13, bold: true, color: c.tone, fontFace: FF, align: "center" });
            s6.addText(c.label, { x: cx + 0.08, y: chipY + 0.27, w: chipW - 0.16, h: 0.14, fontSize: 7, color: OVC.slate, fontFace: FF, align: "center" });
        });

        // ── Combined priority for each machine group ───────────────────────────
        const _s6Priority = (mg, mttrMap, mtbfMap) => {
            const mt = mttrMap[mg]; const mb = mtbfMap[mg];
            let score = 0;
            if (mt && mt.avgMttr > 7) score += 2;
            if (mb && mb.avgMtbf < 30) score += 2;
            if ((mt && mt.woCount >= 3) || (mb && mb.recurrences >= 2)) score += 1;
            return score >= 4 ? "High" : score >= 2 ? "Med" : "Low";
        };
        const _mttrMap = Object.fromEntries(R.mttrByGroup.map(g => [g.mg, g]));
        const _mtbfMap = Object.fromEntries(R.mtbfByGroup.map(g => [g.mg, g]));

        // ── Left table: Top 5 MTTR (sorted by priority desc, then avgMttr desc) ─
        const tblY = 1.38, tblH_rows = 5;
        const mttrTop5 = [...R.mttrByGroup]
            .map(g => ({ ...g, _pri: _s6Priority(g.mg, _mttrMap, _mtbfMap) }))
            .sort((a, b) => { const ps = {"High":3,"Med":2,"Low":1}; return (ps[b._pri]-ps[a._pri]) || b.avgMttr - a.avgMttr; })
            .slice(0, tblH_rows);

        secLabel(s6, 0.18, tblY - 0.24, 6.44, "Highest Avg MTTR — Slowest to Repair", mttrTop5.length);
        const mCols1 = [0.28, 1.80, 0.70, 0.52, 1.60, 1.30, 0.24];  // total 6.44"
        const mHdr1 = tHdr(["#", "Machine Group", "Avg MTTR", "WOs", "Top Issue", "Worst Machine", "!"]);
        const mData1 = mttrTop5.map((g, i) => tRow([
            { v: i + 1, c: OVC.slate },
            { v: _ovTrunc(g.mg, 22), b: i === 0 },
            { v: g.avgMttr.toFixed(1) + "d", c: g.avgMttr > 7 ? OVC.red : g.avgMttr > 3 ? OVC.amber : OVC.green, b: true },
            { v: g.woCount, c: OVC.slate },
            { v: _ovTrunc(g.topIssue, 20), c: OVC.accent },
            { v: _ovTrunc(g.worstAsset, 18), c: g.worstMttr > 7 ? OVC.red : OVC.text },
            { v: g._pri, c: g._pri === "High" ? OVC.red : g._pri === "Med" ? OVC.amber : OVC.green },
        ], i));
        if (mData1.length) {
            s6.addTable([mHdr1, ...mData1], { x: 0.18, y: tblY, w: 6.44, fontFace: FF, colW: mCols1, border: { color: OVC.border }, rowH: 0.36 });
        } else {
            s6.addText("No MTTR data available.", { x: 0.18, y: tblY, w: 6.44, h: 0.30, fontSize: 8, color: OVC.sub, fontFace: FF });
        }

        // ── Right table: Top 5 MTBF (sorted by priority desc, then avgMtbf asc) ─
        const mtbfTop5 = [...R.mtbfByGroup]
            .map(g => ({ ...g, _pri: _s6Priority(g.mg, _mttrMap, _mtbfMap) }))
            .sort((a, b) => { const ps = {"High":3,"Med":2,"Low":1}; return (ps[b._pri]-ps[a._pri]) || a.avgMtbf - b.avgMtbf; })
            .slice(0, tblH_rows);

        const tbl2X = 6.80;
        secLabel(s6, tbl2X, tblY - 0.24, 6.34, "Lowest Avg MTBF — Most Frequent Breakdowns", mtbfTop5.length);
        const mCols2 = [0.28, 1.72, 0.72, 0.62, 1.54, 1.22, 0.24];  // total 6.34"
        const mHdr2 = tHdr(["#", "Machine Group", "Avg MTBF", "Gaps", "Top Issue", "Worst Machine", "!"]);
        const mData2 = mtbfTop5.map((g, i) => tRow([
            { v: i + 1, c: OVC.slate },
            { v: _ovTrunc(g.mg, 22), b: i === 0 },
            { v: g.avgMtbf.toFixed(1) + "d", c: g.avgMtbf < 30 ? OVC.red : g.avgMtbf < 60 ? OVC.amber : OVC.green, b: true },
            { v: g.recurrences, c: OVC.slate },
            { v: _ovTrunc(g.topIssue, 20), c: OVC.accent },
            { v: _ovTrunc(g.worstAsset, 18), c: g.worstMtbf != null && g.worstMtbf < 30 ? OVC.red : OVC.text },
            { v: g._pri, c: g._pri === "High" ? OVC.red : g._pri === "Med" ? OVC.amber : OVC.green },
        ], i));
        if (mData2.length) {
            s6.addTable([mHdr2, ...mData2], { x: tbl2X, y: tblY, w: 6.34, fontFace: FF, colW: mCols2, border: { color: OVC.border }, rowH: 0.36 });
        } else {
            s6.addText("No MTBF data available (requires multiple closed WOs per machine).", { x: tbl2X, y: tblY, w: 6.34, h: 0.30, fontSize: 8, color: OVC.sub, fontFace: FF });
        }

        // Priority legend (centred between tables)
        s6.addText("! = Priority:  High · Med · Low  (High = MTTR > 7d + MTBF < 30d + ≥3 WOs)",
            { x: 0.18, y: tblY + 0.36 * (tblH_rows + 1) + 0.04, w: 13.0, h: 0.16, fontSize: 6.5, color: OVC.sub, italic: true, fontFace: FF });

        // ── Management Focus insights ─────────────────────────────────────────
        const insightY = tblY + 0.36 * (tblH_rows + 1) + 0.26;
        secLabel(s6, 0.18, insightY, 13.0, "Management Focus");
        const _genInsights = () => {
            const ins = [];
            const highPri = mttrTop5.filter(g => g._pri === "High").map(g => g.mg);
            const highMttrOnly = mttrTop5.filter(g => g._pri === "Med" && g.avgMttr > 7 && !_mtbfMap[g.mg]).map(g => g.mg);
            const highFreqOnly = mtbfTop5.filter(g => g._pri === "Med" && g.avgMtbf < 30 && !_mttrMap[g.mg]).map(g => g.mg);
            if (highPri.length) ins.push(highPri.slice(0, 2).join(" and ") + " ha" + (highPri.length === 1 ? "s" : "ve") + " both high MTTR and frequent recurrence — priority for root cause review and PM effectiveness assessment.");
            if (highMttrOnly.length) ins.push(highMttrOnly.slice(0, 2).join(" and ") + " show" + (highMttrOnly.length === 1 ? "s" : "") + " high repair duration with lower recurrence, indicating repair complexity rather than repeated breakdown — review spare parts availability and technician skill gap.");
            if (highFreqOnly.length) ins.push(highFreqOnly.slice(0, 2).join(" and ") + " ha" + (highFreqOnly.length === 1 ? "s" : "ve") + " frequent repeated failures — review preventive maintenance frequency and trigger conditions.");
            if (!ins.length && mttrTop5.length) ins.push((mttrTop5[0].mg || "Top machine group") + " has the highest average MTTR at " + mttrTop5[0].avgMttr.toFixed(1) + "d — review repair process and spare parts stocking.");
            if (!ins.length) ins.push("Insufficient MTTR/MTBF history to generate insights. Ensure WOs have valid actual start and end dates.");
            return ins.slice(0, 3);
        };
        const insights = _genInsights();
        insights.forEach((txt, i) => {
            s6.addText("• " + txt, {
                x: 0.18, y: insightY + 0.22 + i * 0.24, w: 13.0, h: 0.22,
                fontSize: 8, color: OVC.text, fontFace: FF, wrap: true,
            });
        });

        foot(s6);

        const fileName = "Maintenance_Overview_Report_" + (R.filters.label || "YTD").replace(/[\s/]/g, "_") + ".pptx";
        return pptx.writeFile({ fileName });
    }

    // ── PPT export entry point ─────────────────────────────────────────────────
    async function exportOverviewPPT() {
        if (!window.PptxGenJS) { alert("PPT library is still loading. Please try again in a moment."); return; }
        if (!lastOverview) { alert("Overview data hasn’t loaded yet. Please wait and try again."); return; }
        _ovAllBtns(true);
        const TO = window.setTimeout(() => {
            _ovAllBtns(false);
            alert("PPT generation timed out after 30 seconds. Please try again.");
        }, 30000);
        try {
            const R = await buildPptReportData();
            await generateOvPpt(R);
        } catch (e) {
            alert("PPT export error: " + (e && e.message || "Unknown error."));
        } finally {
            _ovAllBtns(false);
            window.clearTimeout(TO);
        }
    }

    // Waits for a fresh loadOverview({force:true}) round-trip to actually land
    // (both the overview payload and the predictive cards it kicks off) rather
    // than assuming a fixed delay — loadOverview() is fire-and-forget, not
    // awaitable, so this polls the version counters it bumps on completion.
    function _waitForFreshOverviewLoad(timeoutMs) {
        const startOverviewV = overviewLoadVersion;
        const startPredictiveV = predictiveLoadVersion;
        loadOverview({ force: true });
        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            const poll = () => {
                if (overviewLoadVersion > startOverviewV && predictiveLoadVersion > startPredictiveV) {
                    resolve();
                    return;
                }
                if (Date.now() - startedAt > timeoutMs) {
                    reject(new Error("Timed out waiting for fresh overview/predictive data."));
                    return;
                }
                window.setTimeout(poll, 300);
            };
            poll();
        });
    }

    // Refresh-only hook for any successful data import. It is intentionally a
    // no-op until Predictive Insights has mounted; opening the tab later will
    // perform its normal fresh load against the server-invalidated caches.
    window.miraOverviewRefreshAfterImport = async function miraOverviewRefreshAfterImport() {
        if (!mounted) return false;
        try {
            await _waitForFreshOverviewLoad(45000);
            debugLog("overview:refresh-after-import", { ok: true });
            return true;
        } catch (e) {
            console.warn("[MIRA] Refresh after import failed:", e && e.message);
            debugLog("overview:refresh-after-import", { ok: false, error: e && e.message });
            return false;
        }
    };

    // Auto-triggered after a successful work-order import elsewhere in the app
    // (see the "maintenance-work-order-imported" postMessage listener in
    // Maintenance/script.js) — only runs if the Overview tab has actually been
    // loaded at least once this session (lastOverview set), so a user who has
    // never opened it doesn't get a surprise download. Deliberately silent
    // (console only, no alerts) since this runs in the background regardless
    // of which tab is currently visible. Refreshing is unconditional once the
    // view has mounted; only the optional export depends on lastOverview/PPT.
    window.miraOverviewAutoExportPptAfterImport = async function miraOverviewAutoExportPptAfterImport() {
        if (!mounted) return;
        const shouldExport = !!(lastOverview && window.PptxGenJS);
        try {
            const refreshed = await window.miraOverviewRefreshAfterImport();
            if (!refreshed) return;
            if (!shouldExport) return;
            const R = await buildPptReportData();
            await generateOvPpt(R);
            debugLog("ppt:auto-export-after-import", { ok: true });
        } catch (e) {
            console.warn("[PPT] Auto-export after import failed:", e && e.message);
            debugLog("ppt:auto-export-after-import", { ok: false, error: e && e.message });
        }
    };

    // ── PDF export ─────────────────────────────────────────────────────────────
    function exportOverviewPDF() {
        if (!lastOverview) { alert("Overview data hasn’t loaded yet. Please wait and try again."); return; }
        _ovAllBtns(true);
        const TO = window.setTimeout(() => { _ovAllBtns(false); }, 30000);
        try {
            const R = overviewReportData();
            const win = window.open("", "_blank");
            if (!win) { _ovAllBtns(false); window.clearTimeout(TO); alert("Popup blocked. Please allow popups and try again."); return; }
            win.document.write(_ovBuildPdfHtml(R));
            win.document.close();
            win.onload = () => { try { win.focus(); win.print(); } catch (_) {} };
            window.setTimeout(() => { try { win.focus(); win.print(); } catch (_) {} _ovAllBtns(false); window.clearTimeout(TO); }, 800);
        } catch (e) {
            _ovAllBtns(false);
            window.clearTimeout(TO);
            alert("PDF export error: " + e.message);
        }
    }

    function _ovEsc(t) {
        return String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function _ovBuildPdfHtml(R) {
        const period = _ovEsc(R.filters.label + (R.filters.dateRange ? " \xb7 " + R.filters.dateRange : ""));
        const stage = _ovEsc(R.filters.stage === "stage1" ? "Stage 1" : R.filters.stage === "stage2" ? "Stage 2" : "All Stages");
        const statusColor = R.statusText === "Critical" ? "#dc2626" : R.statusText === "Attention" ? "#d97706" : "#16a34a";
        const activeCat = R.predCategories.find(c => c.name === R.categoryView) || R.predCategories[0];

        const kpiCardsHtml = R.headlineKpis.slice(0, 4).map(k => {
            const t = k.tone === "critical" ? "#dc2626" : k.tone === "watch" ? "#d97706" : k.tone === "good" ? "#16a34a" : "#4f46e5";
            return `<div class="kpi-c"><div class="kpi-v" style="color:${t}">${_ovEsc(String(k.display != null ? k.display : (k.value != null ? k.value : "—")))}</div><div class="kpi-l">${_ovEsc(k.label || "")}</div>${k.note ? `<div class="kpi-n">${_ovEsc(k.note)}</div>` : ""}</div>`;
        }).join("");

        const secCardsHtml = [
            { label: "PM Schedule",    data: R.pmSection },
            { label: "Downtime / MR", data: R.dtSection },
            { label: "Spare Parts",   data: R.spareSection },
        ].map(sec => {
            const mets = (sec.data && sec.data.metrics || []).slice(0, 4).map(m => {
                const mc = m.tone === "critical" ? "#dc2626" : m.tone === "watch" ? "#d97706" : m.tone === "good" ? "#16a34a" : "#64748b";
                return `<div class="sm"><span class="sml">${_ovEsc(m.label || "")}</span><span class="smv" style="color:${mc}">${_ovEsc(String(m.value || "—"))}</span></div>`;
            }).join("");
            const hs = (sec.data && sec.data.health_status) || "";
            const hc = hs === "Good" ? "#16a34a" : hs === "Attention" ? "#d97706" : hs === "Critical" ? "#dc2626" : "#64748b";
            return `<div class="sec-c"><div class="sec-h">${_ovEsc(sec.label)}${hs ? `<span style="color:${hc};font-size:7.5px;margin-left:6px">${_ovEsc(hs)}</span>` : ""}</div>${mets || '<span class="mu">No data</span>'}</div>`;
        }).join("");

        const dqHtml = R.dqChips.map(c => `<span class="dq${c.warn ? " dqw" : " dqo"}"><span>${_ovEsc(c.label)}</span><strong>${_ovEsc(c.value)}</strong></span>`).join("") || '<span class="mu">—</span>';

        const alertHtml = R.alertRows.length ? `<table class="atbl"><thead><tr><th>Area / Asset</th><th>Flag</th><th>Why it needs review</th></tr></thead><tbody>${
            R.alertRows.slice(0, 5).map(row => {
                const fc = row.flag === "Red" ? "#dc2626" : row.flag === "Amber" ? "#d97706" : "#64748b";
                return `<tr><td>${_ovEsc(row.area)}</td><td style="color:${fc};font-weight:700">${_ovEsc(row.flag)}</td><td>${_ovEsc(row.why)}</td></tr>`;
            }).join("")
        }</tbody></table>` : `<p class="mu">No active alerts for this period.</p>`;

        const machHtml = activeCat && activeCat.top_machines && activeCat.top_machines.length
            ? `<table class="mtbl"><thead><tr><th>#</th><th>Machine</th><th>Issue Signature</th><th>Next Likely</th><th>Risk</th><th>Suggested Action</th></tr></thead><tbody>${
                activeCat.top_machines.slice(0, 5).map(m => {
                    const cc = m.riskLevel === "High" ? "#dc2626" : m.riskLevel === "Medium" ? "#d97706" : "#16a34a";
                    const riskLabel = m.riskLevel + (m.riskScore != null ? ` (${m.riskScore}/10)` : "");
                    return `<tr><td>${m.rank || ""}</td><td>${_ovEsc(m.machine)}${m.isCritical ? " <b class='cb'>Crit</b>" : ""}</td><td style="color:#4f46e5">${_ovEsc(m.issue)}</td><td class="mu">${_ovEsc(m.nextLikely)}</td><td style="color:${cc};font-weight:700">${_ovEsc(riskLabel)}</td><td class="mu">${_ovEsc(m.suggestedAction)}</td></tr>`;
                }).join("")
            }</tbody></table><p class="mu" style="margin-top:5px">Technician/Engineer verification required before action.</p>`
            : `<p class="mu">No risk-scored assets for this period.</p>`;

        const fp = R.faultPattern;
        const faultHtml = fp && !fp.empty
            ? `<strong style="color:#4f46e5">${_ovEsc(fp.fault_family || "—")}</strong>&nbsp;&nbsp;\xd7${fp.count || 0}&nbsp;&nbsp;(${fp.pct_of_total || 0}% of MR)${fp.affected_groups && fp.affected_groups.length ? `<div class="mu" style="margin-top:4px">Affects: ${_ovEsc(fp.affected_groups.slice(0, 5).join(", "))}</div>` : ""}`
            : `<span class="mu">No dominant fault pattern detected.</span>`;
        const conf = R.dataConfidence;
        const cbc = conf.band === "High" ? "#16a34a" : conf.band === "Medium" ? "#d97706" : "#dc2626";
        const confHtml = `<strong style="color:${cbc}">${_ovEsc(conf.band || "—")}</strong>&nbsp;—&nbsp;${_ovEsc(conf.label || "Coverage data unavailable.")}` +
            (conf.riskCounts ? `<ul class="mu" style="margin:5px 0 0;padding-left:16px"><li>High risk: ${conf.riskCounts.High}</li><li>Medium risk: ${conf.riskCounts.Medium}</li><li>Low risk: ${conf.riskCounts.Low}</li></ul>` : "");

        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Maintenance Overview Report</title>
<style>
@page{size:A4 portrait;margin:15mm 14mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,Arial,sans-serif;font-size:9.5px;color:#1e293b;background:#fff}
.pg{page-break-after:always;padding:4px 0}
.pg:last-child{page-break-after:avoid}
.ph{background:#1e293b;color:#fff;padding:8px 12px;border-radius:5px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}
.ph h1{font-size:13px;font-weight:700}
.ph .sub{font-size:8px;color:#94a3b8}
.sr{display:flex;align-items:center;gap:9px;margin-bottom:8px}
.sb{padding:2px 10px;border-radius:999px;font-size:9px;font-weight:700;color:#fff}
.pt{font-size:8px;color:#64748b}
.sl{font-size:8.5px;padding:2px 0}
.kr{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
.kpi-c{background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;padding:8px 7px;text-align:center}
.kpi-v{font-size:18px;font-weight:800}
.kpi-l{font-size:7.5px;color:#64748b;margin-top:3px}
.kpi-n{font-size:7px;color:#94a3b8;margin-top:1px}
.sr2{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}
.sec-c{background:#fff;border:1px solid #e2e8f0;border-radius:5px;padding:6px 8px}
.sec-h{font-size:8px;font-weight:700;margin-bottom:5px;display:flex;justify-content:space-between}
.sm{display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding:3px 0}
.sml{font-size:7.5px;color:#64748b}
.smv{font-size:8px;font-weight:700}
.sl2{font-size:8.5px;font-weight:700;margin:9px 0 4px;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:3px}
.dqrow{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:8px}
.dq{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 7px;font-size:7.5px;border:1px solid #e2e8f0}
.dqw{background:#fef3c7;color:#92400e;border-color:#fcd34d}
.dqo{background:#f0fdf4;color:#166534;border-color:#86efac}
.atbl,.mtbl{width:100%;border-collapse:collapse;font-size:7px}
.atbl th,.atbl td,.mtbl th,.mtbl td{border:1px solid #e2e8f0;padding:4px 5px;vertical-align:top;word-break:break-word}
.atbl th,.mtbl th{background:#1e293b;color:#fff;font-weight:700}
.atbl tr:nth-child(even),.mtbl tr:nth-child(even){background:#f8fafc}
.br{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
.bc{background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;padding:8px 10px}
.mu{color:#64748b;font-size:7.5px}
.cb{background:#dc2626;color:#fff;border-radius:2px;padding:0 3px;font-size:6px}
</style></head><body>
<div class="pg">
<div class="ph"><div><h1>Maintenance Overview Report</h1><div class="sub">${period} \xb7 ${stage}</div></div><div class="sub">Exported ${_ovEsc(R.exportedAt)}</div></div>
<div class="sr"><span class="sb" style="background:${statusColor}">${_ovEsc(R.statusText)}</span><span class="pt">${_ovEsc(R.periodText)}</span></div>
<div style="margin-bottom:7px">${R.summaryLines.map(l => `<div class="sl">${_ovEsc(l)}</div>`).join("")}</div>
<div class="kr">${kpiCardsHtml}</div>
<div class="sr2">${secCardsHtml}</div>
<div class="sl2">Data Quality Indicators</div>
<div class="dqrow">${dqHtml}</div>
<div class="sl2">Daily Action Alerts</div>
${alertHtml}
</div>
<div class="pg">
<div class="ph"><div><h1>Recurring Machine Issue Forecast</h1><div class="sub">${period} \xb7 ${stage} \xb7 ${_ovEsc(R.categoryView)}</div></div><div class="sub">Exported ${_ovEsc(R.exportedAt)}</div></div>
${R.predKpiStrip ? `<p class="mu" style="margin-bottom:7px">${_ovEsc(R.predKpiStrip)}</p>` : ""}
${machHtml}
<div class="br">
<div class="bc"><div class="sl2">Dominant Fault Pattern</div>${faultHtml}</div>
<div class="bc"><div class="sl2">Assessment Coverage</div>${confHtml}</div>
</div>
</div>
</body></html>`;
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
