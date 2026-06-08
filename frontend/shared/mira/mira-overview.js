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
        body.append(buildStatusCard(), buildTabShell(), buildDataUsedCard());
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

    function buildTabShell() {
        const shell = el("section", "mira-ov-tabs-shell");
        const tabs = el("div", "mira-ov-tabs");
        [
            ["overview", "Overview"],
            ["pm", "PM Schedule"],
            ["downtime", "Downtime"],
            ["spare", "Spare Parts"],
            ["predictive", "Predictive Analysis"],
            ["issue", "Issue Focus"],
        ].forEach(([key, label]) => {
            const btn = el("button", "mira-ov-tab", label);
            btn.type = "button";
            btn.dataset.miraTab = key;
            btn.addEventListener("click", () => setActiveTab(key));
            tabs.append(btn);
        });

        const content = el("div", "mira-ov-tab-content");
        const overview = el("div", "mira-ov-panel", null);
        overview.dataset.panel = "overview";
        overview.append(buildKpiGrid(), buildRecommendations());
        content.append(
            overview,
            buildDetailPanel("pm", "PM Schedule", "Planned work status, manual completion, overdue tasks, and backlog."),
            buildDetailPanel("downtime", "Downtime", "MR activity, corrective work, MTTR/MTBF context, and data reliability."),
            buildDetailPanel("spare", "Spare Parts", "Inventory, store draw, non-stock spend, services, and consumption focus."),
            buildPredictivePanel(),
            buildIssuePanel(),
        );
        shell.append(tabs, content);
        window.setTimeout(() => setActiveTab(state.activeTab), 0);
        return shell;
    }

    function buildDetailPanel(key, title, subtitle) {
        const panel = el("div", "mira-ov-panel", null);
        panel.dataset.panel = key;
        const card = el("section", "mira-ov-detail-card");
        const head = el("div", "mira-ov-detail-head");
        head.append(el("div", "mira-ov-icon", key.toUpperCase().slice(0, 2)));
        const copy = el("div");
        copy.append(el("h2", "mira-ov-detail-title", title), el("p", "mira-ov-detail-subtitle", subtitle));
        head.append(copy);
        const body = el("div", "mira-ov-detail-body");
        body.id = `mira-ov-detail-${key}`;
        body.append(el("p", "mira-ov-muted", "Loading verified detail..."));
        card.append(head, body);
        panel.append(card);
        return panel;
    }

    function buildPredictivePanel() {
        const panel = el("div", "mira-ov-panel", null);
        panel.dataset.panel = "predictive";
        const hero = el("section", "mira-ov-ai-hero mira-ov-ai-hero-purple");
        hero.append(el("div", "mira-ov-icon mira-ov-icon-purple", "AI"));
        const copy = el("div");
        copy.append(el("h2", "mira-ov-detail-title", "Predictive Analysis"), el("p", "mira-ov-detail-subtitle", "Evidence-based risk indicators from recent MR patterns, PM pressure, backlog, and spare-parts signals."));
        hero.append(copy);
        const content = el("div", "mira-ov-ai-grid");
        content.id = "mira-ov-predictive-content";
        content.append(el("p", "mira-ov-muted", "Loading predictive indicators..."));
        panel.append(hero, content);
        return panel;
    }

    function buildIssuePanel() {
        const panel = el("div", "mira-ov-panel", null);
        panel.dataset.panel = "issue";
        const hero = el("section", "mira-ov-ai-hero mira-ov-ai-hero-orange");
        hero.append(el("div", "mira-ov-icon mira-ov-icon-orange", "IF"));
        const copy = el("div");
        copy.append(el("h2", "mira-ov-detail-title", "Issue Focus Detection"), el("p", "mira-ov-detail-subtitle", "Repeated MR/WO description themes, affected assets, locations, evidence, and follow-up prompts."));
        hero.append(copy);
        const content = el("div", "mira-ov-issue-layout");
        content.id = "mira-ov-issue-content";
        content.append(el("p", "mira-ov-muted", "Loading issue focus detection..."));
        panel.append(hero, content);
        return panel;
    }

    function setActiveTab(key) {
        state.activeTab = key || "overview";
        document.querySelectorAll(".mira-ov-tab").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.miraTab === state.activeTab);
        });
        document.querySelectorAll(".mira-ov-panel").forEach((panel) => {
            panel.classList.toggle("active", panel.dataset.panel === state.activeTab);
        });
    }

    function buildKpiGrid() {
        const grid = el("div", "mira-ov-kpi-grid");
        [["PM Schedule", "pm", "teal", "PM"], ["Downtime", "downtime", "orange", "DT"], ["Spare Parts", "spare", "blue", "SP"]]
            .forEach(([title, key, accent, icon]) => {
                const card = el("section", `mira-ov-kpi-card mira-ov-accent-${accent}`);
                const head = el("div", "mira-ov-kpi-head");
                head.append(el("div", "mira-ov-kpi-title", title), el("div", "mira-ov-card-icon", icon));
                card.append(head);
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
            if (m.note) chip.append(el("span", "mira-ov-chip-note", m.note));
            grid.append(chip);
        });
        host.append(grid);
        if (section.summary) host.append(el("p", "mira-ov-section-summary", section.summary));
        if (section.footnote) host.append(el("p", "mira-ov-footnote", section.footnote));
    }

    function renderPredictiveAnalysis(analysis) {
        const host = document.getElementById("mira-ov-predictive-content");
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
        const listCard = el("section", "mira-ov-detail-card");
        listCard.append(el("h3", "mira-ov-kpi-title", "Risk Indicators"));
        const list = el("div", "mira-ov-prediction-list");
        predictions.forEach((item) => {
            const card = el("div", `mira-ov-prediction-card impact-${item.impact || "medium"}`);
            const top = el("div", "mira-ov-prediction-top");
            top.append(el("strong", null, item.risk_area || item.category || "Risk indicator"));
            top.append(el("span", "mira-ov-mini-badge", `${item.confidence || "Low"} confidence`));
            card.append(top);
            card.append(el("p", "mira-ov-muted-copy", item.evidence || "Evidence unavailable."));
            card.append(el("p", "mira-ov-section-summary", item.prediction || "Prediction confidence is limited because historical data is incomplete."));
            if (item.follow_up_action) card.append(el("p", "mira-ov-footnote", item.follow_up_action));
            list.append(card);
        });
        listCard.append(list);
        host.append(listCard);
        renderList(host.appendChild(el("ul", "mira-ov-list mira-ov-ai-notes")), data.data_notes || [], "", "warn");
    }

    function renderIssueFocus(focus) {
        const host = document.getElementById("mira-ov-issue-content");
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

        const issueCard = el("section", "mira-ov-detail-card");
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
            renderList(card.appendChild(el("ul", "mira-ov-list")), issue.evidence || [], "No example descriptions available.");
            if (issue.why_it_matters) card.append(el("p", "mira-ov-section-summary", issue.why_it_matters));
            if (issue.follow_up_action) card.append(el("p", "mira-ov-footnote", issue.follow_up_action));
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

    function renderLoadingState() {
        if (refs.exec) refs.exec.textContent = "Loading verified maintenance KPI cards...";
        renderList(refs.highlights, [], "Loading verified highlights...");
        renderList(refs.actionsToday, [], "Loading priority follow-up...");
        ["pm", "downtime", "spare"].forEach((key) => {
            setBody(`mira-ov-kpi-${key}`, el("p", "mira-ov-muted", "Loading verified KPI data..."));
            setBody(`mira-ov-detail-${key}`, el("p", "mira-ov-muted", "Loading verified detail..."));
        });
        setBody("mira-ov-predictive-content", el("p", "mira-ov-muted", "Loading predictive indicators..."));
        setBody("mira-ov-issue-content", el("p", "mira-ov-muted", "Loading issue focus detection..."));
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

    // ── data loading ────────────────────────────────────────────────────────────
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
        window.MIRA_DASHBOARD_FILTERS = currentFilters();
        debugLog("overview:request", { filters: currentFilters(), force: !!options.force });
        refs.statusBadge.textContent = "Assessing…";
        refs.statusBadge.className = "mira-ov-status-badge";
        renderLoadingState();

        const overviewRequest = fetchJsonWithTimeout(`${API}/overview`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify(filtersBody()),
        }, 20000);
        overviewAbort = overviewRequest.controller;
        overviewRequest.promise
            .then((json) => {
                if (token !== loadToken) return;
                lastLoadSignature = signature;
                renderVerified(json);
                window.setTimeout(() => {
                    if (token === loadToken) loadAiSummary(token);
                }, options.force ? 0 : 1200);
            })
            .catch((err) => {
                if (err && err.name === "AbortError" && token !== loadToken) return;
                if (token === loadToken) renderError(err);
            })
            .finally(() => {
                if (token === loadToken && inFlightSignature === signature) inFlightSignature = "";
            });
    }

    function loadAiSummary(token) {
        if (aiAbort) aiAbort.abort();
        debugLog("ai-summary:request", { filters: currentFilters(), token });
        const aiRequest = fetchJsonWithTimeout(`${API}/ai-summary`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify(filtersBody()),
        }, 9000);
        aiAbort = aiRequest.controller;
        aiRequest.promise
            .then((json) => { if (token === loadToken && json) renderAi(json); })
            .catch(() => {});
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
        ["pm", "downtime", "spare"].forEach((k) => {
            setBody(`mira-ov-kpi-${k}`, el("p", "mira-ov-muted", "No data available - backend unreachable."));
            setBody(`mira-ov-detail-${k}`, el("p", "mira-ov-muted", "No data available - backend unreachable."));
        });
    }

    function renderVerified(json) {
        const pres = (json && json.presentation) || {};
        const data = (json && json.data) || {};
        const availability = data.data_availability || json.data_availability || {};
        const availabilityWarnings = availability.warnings || [];
        const vdu = pres.view_data_used || {};
        const sections = pres.sections || {};
        const warnings = uniqueStrings([].concat(vdu.data_warnings || [], pres.data_notes || [], availabilityWarnings));
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

        // Highlights + today's actions (rule-based, verified)
        renderList(refs.highlights, showWarmState ? availabilityWarnings : buildHighlights(data, sections), "No notable highlights for this period.");
        const todays = (pres.priority_follow_up || []).slice(0, 5);
        renderList(refs.actionsToday, showWarmState ? ["Refresh once the verified KPI cache finishes warming."] : todays, "No immediate actions required.");

        // KPI cards
        renderSection("mira-ov-kpi-pm", sections.pm_schedule_summary);
        renderSection("mira-ov-kpi-downtime", sections.downtime_work_order_summary);
        renderSection("mira-ov-kpi-spare", sections.spare_parts_summary);
        renderSection("mira-ov-detail-pm", sections.pm_schedule_summary);
        renderSection("mira-ov-detail-downtime", sections.downtime_work_order_summary);
        renderSection("mira-ov-detail-spare", sections.spare_parts_summary);

        // Recommendations
        renderList(document.getElementById("mira-ov-rec-today"), showWarmState ? ["Main page is available; detailed KPI cards are warming."] : todays, "No actions flagged today.");
        renderList(document.getElementById("mira-ov-rec-followup"), showWarmState ? ["Use PM Schedule, Downtime, or Spare Parts pages for detailed data while MIRA cache warms."] : buildFollowUps(data), "Nothing outstanding to follow up.");
        renderList(document.getElementById("mira-ov-rec-risks"), showWarmState ? [] : buildRisks(data), "No elevated risks detected.");
        renderList(document.getElementById("mira-ov-rec-dq"), warnings, "No data quality issues.", "warn");

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
        if (s.executive_summary) refs.exec.textContent = conciseText(s.executive_summary, 420);
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
