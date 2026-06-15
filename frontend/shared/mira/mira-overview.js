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
            buildStatusCard(),      // § 1 — Overall status + highlights + today's actions
            buildKpiRow(),          // § 2 — PM / Downtime / Spare Parts compact cards
            buildTechNoteSection(), // § 3 — AI Tech Notes & Predictive Issue Review
            buildRecommendations(), // § 4 — Action list (4 concise boxes)
            buildDataUsedCard(),    // § Bottom — collapsible View Data Used
        );
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

    // ── § 3  AI Tech Notes & Predictive Issue Review ─────────────────────────
    let techNoteReviewRows = [];    // persisted review status per detected item

    function buildTechNoteSection() {
        const sec = el("section", "mira-ov-tech-section");
        sec.append(el("div", "mira-ov-section-label", "AI Tech Notes & Predictive Issue Review"));
        const disclaimer = el("p", "mira-ov-disclaimer",
            "AI-detected issues are for review only. Technician/Engineer verification is required before any action.");
        sec.append(disclaimer);

        // Two prominent analysis columns (Risk Indicators + Repair Insights);
        // Data Quality sits below as a lighter, secondary card.
        const subGrid = el("div", "mira-ov-ai-sub-grid");
        const earlyCard = el("div", "mira-ov-ai-sub-card"); earlyCard.append(el("div", "mira-ov-sub-card-title", "Risk Indicators"));
        const earlyBody = el("div", "mira-ov-sub-card-body"); earlyBody.id = "mira-ov-early-warnings";
        earlyBody.append(el("p", "mira-ov-muted", "Loading predictive indicators…"));
        earlyCard.append(earlyBody);
        const repeatedCard = el("div", "mira-ov-ai-sub-card"); repeatedCard.append(el("div", "mira-ov-sub-card-title", "Repair Insights"));
        const repeatedBody = el("div", "mira-ov-sub-card-body"); repeatedBody.id = "mira-ov-repeated-issues";
        repeatedBody.append(el("p", "mira-ov-muted", "Loading repeated patterns…"));
        repeatedCard.append(repeatedBody);
        subGrid.append(earlyCard, repeatedCard);
        sec.append(subGrid);

        const dqCard = el("div", "mira-ov-ai-sub-card mira-ov-dq-card"); dqCard.append(el("div", "mira-ov-sub-card-title", "Data Quality & Confidence"));
        const dqBody = el("div", "mira-ov-sub-card-body"); dqBody.id = "mira-ov-ai-dq-notes";
        dqBody.append(el("p", "mira-ov-muted", "Loading data confidence notes…"));
        dqCard.append(dqBody);
        sec.append(dqCard);

        // Daily MR triage verdict (auto, scope-aware). Precomputed each morning by
        // the backend; this is a read-only GET keyed by the dashboard's selected
        // scope. No manual paste-in scanning.
        const verdictCard = el("div", "mira-ov-scanner-card");
        const vHead = el("div", "mira-ov-verdict-head");
        vHead.append(el("div", "mira-ov-sub-card-title", "Daily MR Triage"));
        refs.verdictBadge = el("span", "mira-ov-status-badge", "—");
        refs.verdictScope = el("span", "mira-ov-verdict-scope", "");
        vHead.append(refs.verdictBadge, refs.verdictScope);
        verdictCard.append(vHead);
        refs.verdictSummary = el("p", "mira-ov-muted", "Loading daily triage…");
        verdictCard.append(refs.verdictSummary);
        const vBody = el("div", "mira-ov-verdict-body"); vBody.id = "mira-ov-verdict-body";
        verdictCard.append(vBody);
        sec.append(verdictCard);
        return sec;
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
        if (refs.verdictSummary) refs.verdictSummary.textContent = "Loading daily triage…";
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
                if (refs.verdictSummary) refs.verdictSummary.textContent = "Daily triage is not available yet — it populates after the morning run.";
                if (body) body.innerHTML = "";
            })
            .finally(() => window.clearTimeout(timer));
    }

    function renderVerdict(v) {
        const overall = String((v && v.overall_verdict) || "Green");
        const tone = overall === "Red" ? "critical" : overall === "Amber" ? "watch" : "good";
        if (refs.verdictScope) refs.verdictScope.textContent = (v && v.scope) || currentScopeLabel();
        if (refs.verdictBadge) { refs.verdictBadge.textContent = overall; refs.verdictBadge.className = `mira-ov-status-badge mira-ov-status-${tone}`; }
        const dateStr = (v && v.date_reviewed) ? ` · reviewed ${v.date_reviewed}` : "";
        if (refs.verdictSummary) refs.verdictSummary.textContent = ((v && v.summary) || "No triage summary.") + dateStr;
        const body = document.getElementById("mira-ov-verdict-body");
        if (!body) return;
        const items = (v && Array.isArray(v.items)) ? v.items : [];
        const showScopeCol = ((v && v.scope) || "") === "All";
        if (!items.length) {
            body.innerHTML = `<p class="mira-ov-muted">No assets flagged for review in this scope.</p>`;
            return;
        }
        const cols = ["Equipment / Asset", showScopeCol ? "Scope" : null, "Risk", "Suggested Severity", "Recurrence", "Escalation", "Reason"].filter(Boolean);
        const head = `<tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>`;
        const rows = items.map((it) => {
            const rag = String(it.rag || "Green");
            const ragCls = rag === "Red" ? "mira-ov-risk-high" : rag === "Amber" ? "mira-ov-risk-medium" : "mira-ov-risk-low";
            const rec = it.recurrence ? `Yes${it.recurrence_note ? ` (${escOv(it.recurrence_note)})` : ""}` : "—";
            const esc = it.escalation_flag ? `<span class="mira-ov-risk-badge mira-ov-risk-high">Escalate</span>` : "—";
            return `<tr>
                <td>${escOv(it.asset_name)}</td>
                ${showScopeCol ? `<td>${escOv(it.scope)}</td>` : ""}
                <td><span class="mira-ov-risk-badge ${ragCls}">${escOv(rag)}</span></td>
                <td>${escOv(it.suggested_severity)}</td>
                <td>${rec}</td>
                <td>${esc}</td>
                <td>${escOv(it.reason)}</td>
            </tr>`;
        }).join("");
        const watch = (v && Array.isArray(v.watchlist) && v.watchlist.length)
            ? `<p class="mira-ov-footnote">Watchlist: ${v.watchlist.map(escOv).join(", ")}</p>` : "";
        body.innerHTML = `<table class="mira-ov-scan-table"><thead>${head}</thead><tbody>${rows}</tbody></table>${watch}`;
    }

    function escOv(text) {
        return String(text || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    // ── § 4  Recommendations ─────────────────────────────────────────────────
    function buildRecommendations() {
        const card = el("section", "mira-ov-rec-card");
        card.append(el("div", "mira-ov-section-label", "AI Recommendations & Action List"));
        const grid = el("div", "mira-ov-rec-grid");
        [["Actions Today", "today"], ["Follow-up Items", "followup"],
         ["Risks to Monitor", "risks"], ["Data Quality Issues", "dq"]].forEach(([label, key]) => {
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
        const ids = ["mira-ov-early-warnings", "mira-ov-repeated-issues", "mira-ov-ai-dq-notes",
                     "mira-ov-rec-today", "mira-ov-rec-followup", "mira-ov-rec-risks", "mira-ov-rec-dq"];
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

        // § 3 — Data Quality / Confidence sub-card
        renderList(document.getElementById("mira-ov-ai-dq-notes"), warnings.length ? warnings : ["No data confidence issues detected."], "", "warn");

        // § 4 — Recommendations (max 3 each)
        renderList(document.getElementById("mira-ov-rec-today"), showWarmState ? ["Main page is available; KPI cards are warming."] : todays.slice(0, 3), "No major item detected for current filters.");
        renderList(document.getElementById("mira-ov-rec-followup"), showWarmState ? ["Use PM Schedule, Downtime, or Spare Parts pages while MIRA cache warms."] : buildFollowUps(data).slice(0, 3), "No major item detected for current filters.");
        renderList(document.getElementById("mira-ov-rec-risks"), (showWarmState ? [] : buildRisks(data)).slice(0, 3), "No major item detected for current filters.");
        renderList(document.getElementById("mira-ov-rec-dq"), warnings.slice(0, 3), "No data quality issues.", "warn");

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
