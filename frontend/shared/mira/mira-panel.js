/*
 * MIRA - Maintenance Intelligence & Reporting Assistant (frontend panel).
 *
 * Self-contained assistant panel mounted into #mira-root on the Maintenance
 * page. It talks only to the local backend routes (/api/mira/*), which return
 * privacy-approved dashboard KPI summaries and structured presentation data.
 */
(function () {
    "use strict";

    const CFG = window.MIRA_CONFIG || { enabled: true, apiBase: "/api/mira" };
    const API = CFG.apiBase || "/api/mira";
    const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const ASSET_GROUPS = ["Production Equipment", "Refrigeration", "Utilities", "Facility / Building"];
    const SUMMARY_TYPES = [
        { value: "monthly_summary", label: "Monthly Summary" },
        { value: "downtime_summary", label: "Downtime Summary" },
        { value: "pm_schedule_summary", label: "PM Schedule Summary" },
        { value: "spare_parts_summary", label: "Spare Parts Summary" },
        { value: "work_order_summary", label: "Work Order Summary" },
    ];

    let backendHealthy = false;
    let lastReportMarkdown = null;
    let lastReportName = "MIRA_monthly_report_draft.md";

    document.addEventListener("DOMContentLoaded", init);

    async function init() {
        const root = document.getElementById("mira-root");
        const tabBtn = document.querySelector("[data-mira-tab]");
        if (!root) return;

        if (CFG.enabled === false) {
            hideMira(tabBtn);
            return;
        }

        if (tabBtn) tabBtn.hidden = false;
        renderShell(root);
        bindEvents(root);
        setAvailability(false);

        try {
            const res = await fetch(`${API}/health`, { cache: "no-store" });
            backendHealthy = res.ok;
        } catch (_err) {
            backendHealthy = false;
        }

        setAvailability(backendHealthy);
        if (!backendHealthy) {
            renderBackendNotice(root);
        }
    }

    function hideMira(tabBtn) {
        if (tabBtn) tabBtn.hidden = true;
        document.getElementById("mira-view")?.classList.add("hidden");
    }

    function renderShell(root) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const years = [currentYear, currentYear - 1, currentYear - 2];
        root.innerHTML = `
            <section class="mira-page-card mira-hero-card">
                <div class="mira-hero-text">
                    <div class="mira-eyebrow">Read-only dashboard assistant</div>
                    <h2>MIRA Assistant</h2>
                    <p>Read-only maintenance intelligence and dashboard summary assistant.</p>
                </div>
                <div class="mira-hero-badges">
                    <span class="mira-badge mira-badge-muted">Read-only summary</span>
                    <span class="mira-badge mira-badge-accent">Draft for review</span>
                </div>
            </section>

            <section class="mira-page-card mira-input-card">
                <div class="mira-panel-head">
                    <div>
                        <div class="mira-section-label">Summary Request</div>
                        <h3>Generate a management-ready response</h3>
                        <p>Leave the prompt blank to generate the selected summary, or type a question for MIRA to answer using the same dashboard-backed KPIs.</p>
                    </div>
                    <span class="mira-badge mira-badge-subtle">Read only</span>
                </div>

                <label class="mira-field mira-field-stack" for="mira-input">
                    <span>Prompt</span>
                    <textarea id="mira-input" class="mira-textarea" rows="3" placeholder="Ask a question, for example: What should management focus on for Stage 2 this month?"></textarea>
                </label>

                <div class="mira-control-grid">
                    <label class="mira-field">
                        <span>Summary Type</span>
                        <select id="mira-summary-type">
                            ${SUMMARY_TYPES.map((item) => `<option value="${item.value}">${item.label}</option>`).join("")}
                        </select>
                    </label>
                    <label class="mira-field">
                        <span>Stage</span>
                        <select id="mira-f-stage">
                            <option value="all">All Stages</option>
                            <option value="stage1">Stage 1</option>
                            <option value="stage2">Stage 2</option>
                        </select>
                    </label>
                    <label class="mira-field">
                        <span>Year</span>
                        <select id="mira-f-year">
                            ${years.map((year) => `<option value="${year}">${year}</option>`).join("")}
                        </select>
                    </label>
                    <label class="mira-field">
                        <span>Month</span>
                        <select id="mira-f-month">
                            <option value="">All months / YTD</option>
                            ${MONTHS_SHORT.map((month, index) => `<option value="${index + 1}">${month}</option>`).join("")}
                        </select>
                    </label>
                    <label class="mira-field">
                        <span>Asset Group</span>
                        <select id="mira-f-group">
                            <option value="">All groups</option>
                            ${ASSET_GROUPS.map((group) => `<option value="${group}">${group}</option>`).join("")}
                        </select>
                    </label>
                </div>

                <div class="mira-input-actions">
                    <button type="button" id="mira-generate-btn" class="mira-btn mira-btn-primary">Generate Summary</button>
                    <button type="button" id="mira-clear-btn" class="mira-btn mira-btn-secondary">Clear</button>
                </div>
            </section>

            <section id="mira-report" class="mira-page-card mira-report-card" hidden>
                <div class="mira-panel-head mira-panel-head-tight">
                    <div>
                        <div class="mira-section-label">Report Draft</div>
                        <h3>Monthly Maintenance Report Draft</h3>
                    </div>
                    <button type="button" id="mira-download" class="mira-btn mira-btn-secondary">Download .md</button>
                </div>
                <div id="mira-report-body" class="mira-report-body"></div>
            </section>

            <section class="mira-page-card mira-response-shell">
                <div class="mira-panel-head mira-panel-head-tight">
                    <div>
                        <div class="mira-section-label">Response</div>
                        <h3>MIRA Insight Summary</h3>
                    </div>
                </div>
                <div id="mira-responses" class="mira-responses"></div>
            </section>
        `;
        renderEmptyState();
    }

    function bindEvents(root) {
        root.querySelector("#mira-generate-btn")?.addEventListener("click", runGenerate);
        root.querySelector("#mira-clear-btn")?.addEventListener("click", clearPanel);
        root.querySelector("#mira-download")?.addEventListener("click", downloadReport);
        root.querySelector("#mira-input")?.addEventListener("keydown", (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                runGenerate();
            }
        });
        root.addEventListener("click", async (event) => {
            const button = event.target.closest("[data-copy-text]");
            if (!button) return;
            const text = button.getAttribute("data-copy-text") || "";
            if (!text) return;
            try {
                await navigator.clipboard.writeText(text);
                const previous = button.textContent;
                button.textContent = "Copied";
                window.setTimeout(() => {
                    button.textContent = previous;
                }, 1400);
            } catch (_err) {
                // Silently ignore clipboard errors in restricted environments.
            }
        });
    }

    function val(id, fallback) {
        const node = document.getElementById(id);
        return node && node.value !== "" ? node.value : (fallback !== undefined ? fallback : "");
    }

    function getFilters() {
        return {
            stage: val("mira-f-stage", "all"),
            year: val("mira-f-year", String(new Date().getFullYear())),
            month: val("mira-f-month", ""),
            mainAssetGroup: val("mira-f-group", ""),
        };
    }

    function extractFilters(question, base) {
        const filters = Object.assign({}, base);
        const text = (question || "").toLowerCase();
        if (/stage\s*2|\bs2\b/.test(text)) filters.stage = "stage2";
        else if (/stage\s*1|\bs1\b/.test(text)) filters.stage = "stage1";
        else if (/all stages|both stages/.test(text)) filters.stage = "all";

        const now = new Date();
        if (/this month/.test(text)) {
            filters.year = String(now.getFullYear());
            filters.month = String(now.getMonth() + 1);
        } else if (/last month/.test(text)) {
            const ref = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            filters.year = String(ref.getFullYear());
            filters.month = String(ref.getMonth() + 1);
        } else if (/ytd|year to date|this year/.test(text)) {
            filters.month = "";
        }

        MONTHS_LONG.forEach((month, index) => {
            if (text.includes(month.toLowerCase()) || text.includes(MONTHS_SHORT[index].toLowerCase())) {
                filters.month = String(index + 1);
            }
        });
        const yearMatch = text.match(/\b(20\d{2})\b/);
        if (yearMatch) filters.year = yearMatch[1];
        ASSET_GROUPS.forEach((group) => {
            const token = group.toLowerCase().split(" ")[0];
            if (text.includes(token)) filters.mainAssetGroup = group;
        });
        return filters;
    }

    async function callMira(path, body) {
        const res = await fetch(`${API}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify(body || {}),
        });
        if (!res.ok) throw new Error(`MIRA ${path} -> HTTP ${res.status}`);
        return res.json();
    }

    async function runGenerate() {
        if (!backendHealthy) {
            renderBackendNotice(document.getElementById("mira-root"));
            return;
        }
        const prompt = (document.getElementById("mira-input")?.value || "").trim();
        const filters = getFilters();
        setBusy(true);
        try {
            let response;
            if (prompt) {
                const extractedFilters = extractFilters(prompt, filters);
                response = await callMira("/query", { question: prompt, filters: extractedFilters });
                renderResponse(response, prompt);
                if (response.intent === "monthly_summary" && /report/i.test(prompt)) {
                    await runReport(extractedFilters);
                }
            } else {
                const summaryType = val("mira-summary-type", "monthly_summary");
                response = await callMira("/summary", { filters, summaryType });
                renderResponse(response, "");
            }
        } catch (error) {
            renderError(error);
        } finally {
            setBusy(false);
        }
    }

    async function runReport(filters) {
        try {
            const response = await callMira("/report-draft", { filters });
            renderReport(response);
        } catch (_err) {
            // The main response should still render even if the report draft fails.
        }
    }

    function clearPanel() {
        const input = document.getElementById("mira-input");
        if (input) input.value = "";
        lastReportMarkdown = null;
        const reportPanel = document.getElementById("mira-report");
        if (reportPanel) reportPanel.hidden = true;
        renderEmptyState();
    }

    function renderEmptyState() {
        const host = document.getElementById("mira-responses");
        if (!host) return;
        host.innerHTML = "";
        const card = createElement("article", "mira-empty-state");
        const title = createElement("h4", null, "Generate a summary");
        const body = createElement(
            "p",
            null,
            "Use the summary selector for a dashboard-backed management summary, or type a question if you want MIRA to focus on a specific issue."
        );
        card.append(title, body);
        host.appendChild(card);
    }

    function renderBackendNotice(root) {
        const host = root?.querySelector("#mira-responses");
        if (!host) return;
        host.innerHTML = "";
        const card = createElement("article", "mira-response-card mira-response-error");
        card.append(
            createElement("div", "mira-badge-row", null, [
                createBadge("Backend notice", "muted"),
            ]),
            createElement("h4", null, "MIRA backend not responding"),
            createElement(
                "p",
                null,
                "MIRA is enabled for editing, but the local /api/mira backend is not responding yet. Restart the backend when you want to use the assistant."
            )
        );
        host.appendChild(card);
    }

    function renderResponse(resp, question) {
        const host = document.getElementById("mira-responses");
        if (!host) return;
        host.innerHTML = "";
        const presentation = resp?.presentation || buildFallbackPresentation(resp, question);
        if (!presentation) {
            host.appendChild(renderFallbackResponse(resp, question));
            return;
        }

        const card = createElement("article", "mira-response-card");
        const sections = presentation.sections || {
            downtime_work_order_summary: presentation.downtime_summary || null,
            pm_schedule_summary: presentation.pm_schedule_summary || null,
            spare_parts_summary: presentation.spare_parts_summary || null,
        };

        card.appendChild(renderResponseHeader(presentation, question));
        // KEY KPI STRIP removed — its metrics now live inside the per-area summary
        // cards (Downtime / Work Order, PM Schedule, Spare Parts) which are sourced
        // directly from the live dashboard builders.

        const summaryGrid = createElement("div", "mira-summary-grid mira-summary-grid-main");
        [
            sections.downtime_work_order_summary,
            sections.pm_schedule_summary,
            sections.spare_parts_summary,
        ].filter(Boolean).forEach((section) => {
            summaryGrid.appendChild(renderSummarySection(section));
        });
        if (summaryGrid.childElementCount) {
            card.appendChild(summaryGrid);
        }

        const bottomGrid = createElement("div", "mira-followup-grid");
        if (Array.isArray(presentation.priority_follow_up) && presentation.priority_follow_up.length) {
            bottomGrid.appendChild(renderPriorityCard(presentation.priority_follow_up));
        }
        if (Array.isArray(presentation.data_notes) && presentation.data_notes.length) {
            bottomGrid.appendChild(renderListCard("Data Notes", presentation.data_notes, "mira-note-card"));
        }
        if (presentation.ai_explanation_placeholder) {
            bottomGrid.appendChild(renderAiPlaceholderCard(presentation.ai_explanation_placeholder));
        }
        if (bottomGrid.childElementCount) {
            card.appendChild(bottomGrid);
        }

        if (presentation.view_data_used) {
            card.appendChild(renderDataUsed(presentation.view_data_used));
        }

        if (resp.mode === "limited_filtered_rows" && resp.data && Array.isArray(resp.data.rows)) {
            card.appendChild(renderMatchingRows(resp.data));
        }

        host.appendChild(card);
    }

    function renderFallbackResponse(resp, question) {
        const card = createElement("article", "mira-response-card");
        const header = createElement("div", "mira-response-header");
        const badgeRow = createElement("div", "mira-badge-row");
        badgeRow.append(
            createBadge(resp?.intent || "Response", "accent"),
            createBadge(resp?.mode === "limited_filtered_rows" ? "Filtered rows" : "Dashboard KPI summary", "muted")
        );
        header.append(
            badgeRow,
            createElement("p", "mira-response-meta", question ? `Prompt: ${question}` : "Generated by MIRA for review")
        );
        card.append(header, renderStatementCard("Executive Summary", resp?.answer || "(no answer)"));
        return card;
    }

    function buildFallbackPresentation(resp, question) {
        const data = resp?.data;
        if (!data || typeof data !== "object") return null;
        const intent = String(resp?.intent || "").toLowerCase();
        const period = data.window || "Selected period";
        const scope = buildFallbackScope(data);
        const sourceNote = resp?.mode === "limited_filtered_rows"
            ? "Based on limited, filtered work-order rows and approved dashboard KPIs"
            : "Based on verified dashboard KPI summary";
        const statusBadges = [
            { label: "Read-only", tone: "muted" },
            { label: "Draft for review", tone: "accent" },
        ];

        if (intent === "monthly_summary") {
            return {
                response_type: "Monthly Summary",
                title: "Maintenance Performance Summary",
                period,
                scope,
                source_note: sourceNote,
                status_badges: statusBadges,
                question: question || "",
                kpi_cards: buildMonthlyFallbackKpis(data),
                sections: buildMonthlyFallbackSections(data, period),
                priority_follow_up: buildMonthlyFallbackFollowUp(data),
                ai_explanation_placeholder: "Detailed explanation, work order description analysis, possible operation-related patterns, and maintenance risk insights will be generated by Ollama in the next phase.",
                view_data_used: buildFallbackViewData(data, scope, period),
                data_notes: buildFallbackNotes(data),
            };
        }

        if (intent === "pm_schedule") {
            return {
                response_type: "PM Schedule Summary",
                title: "PM Schedule Performance Summary",
                period,
                scope,
                source_note: sourceNote,
                status_badges: statusBadges,
                question: question || "",
                kpi_cards: buildPmFallbackKpis(data),
                sections: {
                    downtime_work_order_summary: null,
                    pm_schedule_summary: buildPmFallbackSection(data, period),
                    spare_parts_summary: buildUnavailableSpareSection(period),
                },
                priority_follow_up: buildPmFallbackFollowUp(data),
                ai_explanation_placeholder: "Detailed explanation, work order description analysis, possible operation-related patterns, and maintenance risk insights will be generated by Ollama in the next phase.",
                view_data_used: buildFallbackViewData(data, scope, period),
                data_notes: buildFallbackNotes(data),
            };
        }

        if (intent === "work_order_search" || resp?.mode === "limited_filtered_rows") {
            return {
                response_type: "Work Order Summary",
                title: "Work Order Performance Summary",
                period,
                scope,
                source_note: sourceNote,
                status_badges: statusBadges,
                question: question || "",
                kpi_cards: [
                    { label: "Matched Rows", value: formatMetricValue(data.total_matched), helper: "Rows matching current filters", status: "neutral" },
                    { label: "Rows Shown", value: formatMetricValue(data.returned_rows), helper: "Privacy-capped response rows", status: "neutral" },
                    { label: "Row Cap", value: formatMetricValue(data.row_cap), helper: "Maximum rows returned", status: "neutral" },
                ],
                sections: {
                    downtime_work_order_summary: {
                        title: "Downtime / Work Order Summary",
                        metrics: [
                            { label: "Matched Rows", value: formatMetricValue(data.total_matched), tone: "neutral" },
                            { label: "Rows Shown", value: formatMetricValue(data.returned_rows), tone: "neutral" },
                            { label: "Row Cap", value: formatMetricValue(data.row_cap), tone: "neutral" },
                        ],
                        summary: `Work-order search returned ${formatMetricValue(data.total_matched)} matched rows for ${period}, with ${formatMetricValue(data.returned_rows)} shown in the response.`,
                    },
                    pm_schedule_summary: null,
                    spare_parts_summary: null,
                },
                priority_follow_up: data.truncated ? ["Narrow the filter if you want a shorter work-order list for management review."] : [],
                ai_explanation_placeholder: "Detailed explanation, work order description analysis, possible operation-related patterns, and maintenance risk insights will be generated by Ollama in the next phase.",
                view_data_used: buildFallbackViewData(data, scope, period),
                data_notes: data.truncated ? ["The work-order list was capped for privacy and readability."] : [],
            };
        }

        return null;
    }

    function getFallbackDowntimeSummary(data) {
        return data?.downtime_summary || {};
    }

    function getFallbackFocusAsset(summary) {
        return summary?.top_asset_by_mr_count_name
            || summary?.focus_asset_name
            || summary?.worst_asset_name
            || summary?.worst_machine_group_name
            || summary?.top_work_order_machine_group
            || "Data pending";
    }

    function getFallbackFocusAssetNote(summary) {
        return summary?.focus_asset_reason || (getFallbackFocusAsset(summary) === "Data pending"
            ? "Requires refreshed MIRA backend data"
            : "Based on selected-period MR count");
    }

    function getFallbackOpeningBacklog(data, summary) {
        const raw = summary?.carry_over_open_mr ?? summary?.opening_backlog_count ?? data?.opening_backlog_count;
        return raw === null || raw === undefined || raw === "" ? null : Number(raw);
    }

    function getFallbackTotalWithBacklog(data, summary, workOrders) {
        const raw = summary?.total_active_workload ?? summary?.total_with_backlog_count ?? data?.total_with_backlog_count;
        if (raw !== null && raw !== undefined && raw !== "") {
            return formatMetricValue(raw);
        }
        const total = Number(workOrders?.total || 0);
        const openingBacklog = getFallbackOpeningBacklog(data, summary);
        if (Number.isFinite(total) && Number.isFinite(openingBacklog)) {
            return formatMetricValue(total + openingBacklog);
        }
        return "Data pending";
    }

    function getFallbackBacklogNote(data, summary, period) {
        const openingBacklog = getFallbackOpeningBacklog(data, summary);
        if (openingBacklog === null) {
            return "Includes selected month MR raised plus carry-over open MR from before the selected period.";
        }
        if (openingBacklog > 0) {
            return `Includes ${formatMetricValue(openingBacklog)} carry-over open MR from before ${period}`;
        }
        return `No carry-over backlog before ${period}`;
    }

    function getFallbackClosureRate(data, summary, workOrders) {
        const raw = workOrders?.closure_rate_pct ?? summary?.closure_rate_pct;
        if (raw !== null && raw !== undefined && raw !== "") return Number(raw);
        const total = Number(workOrders?.total || 0);
        const closed = Number(workOrders?.closed || 0);
        return total > 0 ? (closed / total) * 100 : null;
    }

    function getFallbackRejectedCount(data, summary) {
        const raw = summary?.rejected_work_orders ?? summary?.rejected_count ?? data?.rejected_count;
        return raw === null || raw === undefined || raw === "" ? 0 : Number(raw);
    }

    function getFallbackWoCreatedPct(data, summary) {
        const raw = summary?.wo_created_pct ?? data?.wo_created_pct;
        return raw === null || raw === undefined || raw === "" ? null : Number(raw);
    }

    function getFallbackTopFunctionalLocation(summary) {
        return summary?.top_functional_location_name
            || summary?.top_work_order_machine_group
            || summary?.worst_machine_group_name
            || "Data pending";
    }

    function getFallbackSeverityBreakdown(summary) {
        const items = Array.isArray(summary?.severity_mix) ? summary.severity_mix : [];
        if (!items.length) return "No severity split recorded";
        return items.slice(0, 4).map((item) => {
            const label = String(item?.label || "").trim();
            const count = item?.count ?? item?.work_order_count;
            return label ? `${label}: ${formatMetricValue(count)}` : "";
        }).filter(Boolean).join(", ") || "No severity split recorded";
    }

    function getFallbackDataQualityCount(data, summary) {
        const raw = summary?.data_quality_issue_count ?? data?.data_reliability_issue_count;
        return raw === null || raw === undefined || raw === "" ? null : Number(raw);
    }

    function buildMonthlyFallbackKpis(data) {
        const workOrders = data?.work_orders || {};
        const summary = getFallbackDowntimeSummary(data);
        const openCount = workOrders.open;
        const closedCount = workOrders.closed;
        const closureRate = getFallbackClosureRate(data, summary, workOrders);
        const openingBacklog = getFallbackOpeningBacklog(data, summary);
        return [
            {
                label: "MR Raised",
                value: formatMetricValue(workOrders.total),
                helper: "Raised in the selected period",
                status: "neutral",
            },
            {
                label: "Open / In Progress",
                value: formatMetricValue(openCount),
                helper: "Outstanding in selected period",
                status: statusToneLow(openCount, 0, 10),
            },
            {
                label: "Closed / Confirmed",
                value: formatMetricValue(closedCount),
                helper: "Closed in selected period",
                status: "good",
            },
            {
                label: "Closure Rate",
                value: formatPercent(closureRate),
                helper: "Closed / Confirmed divided by MR Raised",
                status: statusToneHigh(closureRate, 85, 70),
            },
            {
                label: "Carry-over Open MR",
                value: formatMetricValue(openingBacklog),
                helper: `Raised before ${data?.window || "the selected period"} and still open`,
                status: statusToneLow(openingBacklog, 0, 25),
            },
            {
                label: "Total Active Workload",
                value: getFallbackTotalWithBacklog(data, summary, workOrders),
                helper: getFallbackBacklogNote(data, summary, data?.window || "the selected period"),
                status: statusToneLow(Number(getFallbackTotalWithBacklog(data, summary, workOrders).replace(/,/g, "")), 0, 250),
            },
        ];
    }

    function buildMonthlyFallbackSections(data, period) {
        const workOrders = data?.work_orders || {};
        const summary = getFallbackDowntimeSummary(data);
        const pm = data?.pm_schedule || {};
        const openCount = Number(workOrders.open || 0);
        const closedCount = Number(workOrders.closed || 0);
        const rejectedCount = getFallbackRejectedCount(data, summary);
        const closureRate = getFallbackClosureRate(data, summary, workOrders);
        const preventive = Number(data?.preventive_count || 0);
        const corrective = Number(data?.corrective_count || 0);
        const focusAsset = getFallbackFocusAsset(summary);
        const openingBacklog = getFallbackOpeningBacklog(data, summary);
        const woCreatedPct = getFallbackWoCreatedPct(data, summary);
        const topFunctionalLocation = getFallbackTopFunctionalLocation(summary);
        const severityBreakdown = getFallbackSeverityBreakdown(summary);
        const dataQualityCount = getFallbackDataQualityCount(data, summary);
        return {
            downtime_work_order_summary: {
                title: "Downtime / Work Order Summary",
                subtitle: "MR activity and closure status for selected period.",
                layout: "wide",
                metrics: [
                    { label: "MR Raised", value: formatMetricValue(workOrders.total), tone: "neutral", note: `Raised in ${period}` },
                    { label: "Open / In Progress", value: formatMetricValue(workOrders.open), tone: statusToneLow(workOrders.open, 0, 10), note: "Outstanding in selected period" },
                    { label: "Closed / Confirmed", value: formatMetricValue(workOrders.closed), tone: "good", note: "Raised in selected period and now closed / confirmed" },
                    { label: "Closure Rate", value: formatPercent(closureRate), tone: statusToneHigh(closureRate, 85, 70), note: "Closed / Confirmed divided by MR Raised" },
                    { label: "Carry-over Open MR", value: formatMetricValue(openingBacklog), tone: statusToneLow(openingBacklog, 0, 25), note: `Raised before ${period} and still open` },
                    { label: "Total Active Workload", value: getFallbackTotalWithBacklog(data, summary, workOrders), tone: "watch", note: getFallbackBacklogNote(data, summary, period) },
                    { label: "Preventive / Corrective", value: `${formatMetricValue(preventive)} / ${formatMetricValue(corrective)}`, tone: "neutral", note: "MR raised in selected period" },
                    { label: "WO Created %", value: woCreatedPct === null ? "Data unavailable" : formatPercent(woCreatedPct), tone: woCreatedPct === null ? "neutral" : statusToneHigh(woCreatedPct, 95, 85), note: "MR with linked work order number" },
                    { label: "Top Asset by MR Count", value: focusAsset, tone: focusAsset === "Data pending" ? "neutral" : "watch", note: getFallbackFocusAssetNote(summary) },
                    { label: "Top Functional Location", value: topFunctionalLocation, tone: topFunctionalLocation === "Data pending" ? "neutral" : "neutral", note: "Based on selected-period MR count" },
                    { label: "Severity Breakdown", value: severityBreakdown, tone: "neutral", note: "Service level mix in selected period" },
                    { label: "Data Quality Issues", value: dataQualityCount === null ? "Not available" : formatMetricValue(dataQualityCount), tone: statusToneLow(dataQualityCount, 0, 5), note: "Missing asset, functional location, or status" },
                ],
                summary: `${formatMetricValue(workOrders.total)} MR were raised in ${period}. Of these, ${formatMetricValue(workOrders.closed)} were closed / confirmed and ${formatMetricValue(workOrders.open)} remain open or in progress, giving a closure rate of ${formatPercent(closureRate)}. There were also ${formatMetricValue(openingBacklog)} carry-over open MR from before ${period}, bringing the total active workload to ${getFallbackTotalWithBacklog(data, summary, workOrders)}. Corrective MR made up most of the period workload, with ${formatMetricValue(corrective)} corrective MR and ${formatMetricValue(preventive)} preventive MR.`,
                footnote: "Focus asset is based on selected-period MR count. MTTR / MTBF are kept out of this card so the summary stays on one raised-date reporting basis.",
                visuals: [
                    {
                        type: "split_bar",
                        label: "Open vs Closed MR",
                        items: [
                            { label: "Closed / Confirmed", value: closedCount, tone: "good" },
                            { label: "Open / In Progress", value: openCount, tone: "critical" },
                            { label: "Rejected", value: rejectedCount, tone: "neutral" },
                        ],
                    },
                    {
                        type: "split_bar",
                        label: "Preventive vs Corrective MR Raised",
                        items: [
                            { label: "Preventive", value: preventive, tone: "good" },
                            { label: "Corrective", value: corrective, tone: "watch" },
                        ],
                    },
                ],
            },
            pm_schedule_summary: buildPmFallbackSection(data, period),
            spare_parts_summary: buildUnavailableSpareSection(period),
        };
    }

    function buildPmFallbackKpis(data) {
        const compliance = Number(data?.compliance_pct);
        return [
            { label: "PM Scheduled", value: formatMetricValue(data?.total_scheduled), helper: "Selected PM workload", status: "neutral" },
            { label: "PM Completed", value: formatMetricValue(data?.completed), helper: "Manual Done only", status: "good" },
            { label: "PM Due This Month", value: formatMetricValue(data?.due_this_month), helper: "Current month demand", status: "neutral" },
            { label: "PM Overdue", value: formatMetricValue(data?.overdue), helper: "Requires follow-up", status: statusToneLow(data?.overdue, 0, 20) },
            { label: "PM Backlog", value: formatMetricValue(data?.backlog), helper: "Pending backlog items", status: statusToneLow(data?.backlog, 0, 20) },
            { label: "PM Compliance", value: formatPercent(compliance), helper: "Manual completion rate", status: statusToneHigh(compliance, 90, 75) },
        ];
    }

    function buildPmFallbackSection(data, period) {
        const pm = data?.pm_schedule || data || {};
        return {
            title: "PM Schedule Summary",
            metrics: [
                { label: "PM Scheduled", value: formatMetricValue(pm?.total_scheduled), tone: "neutral" },
                { label: "PM Completed", value: formatMetricValue(pm?.completed), tone: "good", note: "Manual Done only" },
                { label: "PM Due This Month", value: formatMetricValue(pm?.due_this_month), tone: "neutral" },
                { label: "PM Overdue", value: formatMetricValue(pm?.overdue), tone: statusToneLow(pm?.overdue, 0, 20) },
                { label: "PM Backlog", value: formatMetricValue(pm?.backlog), tone: statusToneLow(pm?.backlog, 0, 20) },
                { label: "PM Compliance", value: formatPercent(pm?.compliance_pct), tone: statusToneHigh(pm?.compliance_pct, 90, 75) },
            ],
            summary: `${formatMetricValue(pm?.total_scheduled)} PM tasks are scheduled for ${period}, with ${formatMetricValue(pm?.completed)} manually completed, ${formatMetricValue(pm?.due_this_month)} due this month, and ${formatMetricValue(pm?.overdue)} overdue. Compliance is ${formatPercent(pm?.compliance_pct)}.`,
            footnote: "PM is counted as completed only when manually marked Done.",
            visuals: [
                {
                    type: "progress",
                    label: "PM Compliance",
                    value: Number(pm?.compliance_pct || 0),
                    max: 100,
                    tone: statusToneHigh(pm?.compliance_pct, 90, 75),
                    display: formatPercent(pm?.compliance_pct),
                },
            ],
        };
    }

    function buildUnavailableSpareSection(period) {
        return {
            title: "Spare Parts Summary",
            metrics: [
                { label: "In-Stock Spare Parts", value: "Not available", tone: "neutral" },
                { label: "In-Stock Value", value: "Not available", tone: "neutral" },
                { label: "Drawn from Store", value: "Not available", tone: "neutral" },
                { label: "Non-Stock Value", value: "Not available", tone: "neutral" },
                { label: "Services Value", value: "Not available", tone: "neutral" },
                { label: "Top Consumed Part", value: "Data pending", tone: "neutral" },
                { label: "YoY Consumption", value: "Data pending", tone: "neutral" },
            ],
            summary: `Spare parts summary is not available from the current MIRA response payload for ${period}. Refreshing the backend will populate the full management card when the newer structured response is live.`,
            footnote: "Services include repair and cleaning.",
        };
    }

    function buildMonthlyFallbackFollowUp(data) {
        const items = [];
        const workOrders = data?.work_orders || {};
        const summary = getFallbackDowntimeSummary(data);
        const pm = data?.pm_schedule || {};
        if (Number(workOrders.open || 0) > 0) {
            items.push(`Review outstanding MR / open work orders; ${formatMetricValue(workOrders.open)} remain open.`);
        }
        const openingBacklog = getFallbackOpeningBacklog(data, summary);
        if (Number(openingBacklog || 0) > 0) {
            items.push(`Review ${formatMetricValue(openingBacklog)} carry-over open MR from before the selected period.`);
        }
        if (pm?.compliance_pct !== null && pm?.compliance_pct !== undefined) {
            items.push(`Follow up low PM compliance at ${formatPercent(pm?.compliance_pct)}.`);
        }
        if (getFallbackFocusAsset(summary) !== "Data pending") {
            items.push(`Check top asset ${getFallbackFocusAsset(summary)} and related functional location workload.`);
        } else {
            items.push("Check the focus asset once refreshed backend summary data is available.");
        }
        const dataQualityCount = getFallbackDataQualityCount(data, summary);
        if (Number(dataQualityCount || 0) > 0) {
            items.push(`Validate ${formatMetricValue(dataQualityCount)} selected-period MR records with key data issues.`);
        }
        return items.slice(0, 5);
    }

    function buildPmFallbackFollowUp(data) {
        const items = [];
        if (Number(data?.overdue || 0) > 0) {
            items.push(`Review ${formatMetricValue(data?.overdue)} overdue PM tasks.`);
        }
        if (data?.compliance_pct !== null && data?.compliance_pct !== undefined) {
            items.push(`Follow up low PM compliance at ${formatPercent(data?.compliance_pct)}.`);
        }
        return items;
    }

    function buildFallbackViewData(data, scope, period) {
        const workOrders = data?.work_orders || {};
        const summary = getFallbackDowntimeSummary(data);
        const pm = data?.pm_schedule || {};
        return {
            source_tables: ["MIRA legacy dashboard KPI summary"],
            filters_applied: [`Period: ${period}`, `Scope: ${scope}`],
            rows_loaded: [
                { label: "Selected-period MR loaded", value: formatMetricValue(workOrders.total), tone: "neutral" },
                { label: "Carry-over open MR", value: formatMetricValue(getFallbackOpeningBacklog(data, summary)), tone: "neutral" },
                { label: "PM tasks loaded", value: formatMetricValue(pm?.total_scheduled), tone: "neutral" },
            ],
            rows_after_filter: [],
            kpi_values_used: [
                { label: "MR Raised", value: formatMetricValue(workOrders.total), tone: "neutral" },
                { label: "Open / In Progress", value: formatMetricValue(workOrders.open), tone: "neutral" },
                { label: "Closed / Confirmed", value: formatMetricValue(workOrders.closed), tone: "neutral" },
                { label: "Closure Rate", value: formatPercent(getFallbackClosureRate(data, summary, workOrders)), tone: "neutral" },
                { label: "Preventive / Corrective", value: `${formatMetricValue(data?.preventive_count)} / ${formatMetricValue(data?.corrective_count)}`, tone: "neutral" },
                { label: "PM Compliance", value: formatPercent(pm?.compliance_pct), tone: "neutral" },
            ],
            last_refreshed: new Date().toLocaleString(),
            data_warnings: buildFallbackNotes(data),
        };
    }

    function buildFallbackNotes(data) {
        const notes = [];
        const summary = getFallbackDowntimeSummary(data);
        const pm = data?.pm_schedule || {};
        const dataQualityCount = getFallbackDataQualityCount(data, summary);
        if (Number(dataQualityCount || 0) > 0) {
            notes.push(`${formatMetricValue(dataQualityCount)} selected-period MR records have key data issues.`);
        }
        if (Number(pm?.missing_mapping || 0) > 0) {
            notes.push(`${formatMetricValue(pm?.missing_mapping)} PM records are still missing mapping.`);
        }
        if (Number(pm?.needs_review || 0) > 0) {
            notes.push(`${formatMetricValue(pm?.needs_review)} PM records still need review.`);
        }
        if (!data?.spare_parts) {
            notes.push("Spare parts detail is not present in this older MIRA response payload.");
        }
        return notes;
    }

    function buildFallbackScope(data) {
        const stage = String(data?.stage || "").toLowerCase();
        if (stage === "stage1") return "Stage 1";
        if (stage === "stage2") return "Stage 2";
        return "All Stages";
    }

    function renderResponseHeader(presentation, question) {
        const wrapper = createElement("div", "mira-response-header");
        const titleBlock = createElement("div", "mira-response-title-block");
        titleBlock.append(
            createElement("h4", "mira-response-title", presentation.title || presentation.response_type || "MIRA Insight Summary"),
            createElement(
                "p",
                "mira-response-subtitle",
                [
                    presentation.period || "Selected period",
                    presentation.scope || "All Stages",
                    presentation.source_note || "Based on verified dashboard KPI summary",
                ].filter(Boolean).join(" · ")
            )
        );
        const badgeRow = createElement("div", "mira-badge-row");
        badgeRow.appendChild(createBadge(presentation.response_type || "Summary", "light"));
        (presentation.status_badges || []).forEach((badge) => {
            badgeRow.appendChild(createBadge(badge.label || badge, badge.tone || "muted"));
        });
        wrapper.append(titleBlock, badgeRow);
        if (question) {
            wrapper.appendChild(createElement("p", "mira-response-question", `Prompt: ${question}`));
        }
        return wrapper;
    }

    function renderStatementCard(title, text) {
        const card = createElement("section", "mira-statement-card");
        card.append(
            createElement("div", "mira-mini-label", title),
            createElement("p", "mira-statement-text", text)
        );
        return card;
    }

    function renderMetricSection(title, metrics, compact) {
        const section = createElement("section", compact ? "mira-statement-card mira-statement-card-compact" : "mira-statement-card");
        section.appendChild(createElement("div", "mira-mini-label", title));
        section.appendChild(renderMetricChips(metrics));
        return section;
    }

    function renderSummarySection(section) {
        const classes = ["mira-summary-card"];
        if (section?.layout === "wide") classes.push("mira-summary-card-wide");
        const card = createElement("section", classes.join(" "));
        card.appendChild(createElement("h4", "mira-summary-title", section.title || "Summary"));
        if (section?.subtitle) {
            card.appendChild(createElement("p", "mira-response-meta mira-summary-subtitle", section.subtitle));
        }
        card.appendChild(renderMetricChips(section.metrics || []));
        if (Array.isArray(section.visuals) && section.visuals.length) {
            card.appendChild(renderSectionVisuals(section.visuals));
        }
        card.appendChild(createElement("p", "mira-summary-text", section.summary || ""));
        if (section.footnote) {
            card.appendChild(createElement("p", "mira-summary-footnote", section.footnote));
        }
        return card;
    }

    function renderSectionVisuals(visuals) {
        const wrap = createElement("div", "mira-visual-stack");
        visuals.forEach((visual) => {
            if (!visual || !visual.type) return;
            if (visual.type === "split_bar") {
                wrap.appendChild(renderSplitBarVisual(visual));
                return;
            }
            if (visual.type === "progress") {
                wrap.appendChild(renderProgressVisual(visual));
                return;
            }
            if (visual.type === "value_segments") {
                wrap.appendChild(renderValueSegmentsVisual(visual));
            }
        });
        return wrap;
    }

    function renderSplitBarVisual(visual) {
        const node = createElement("div", "mira-visual-card");
        node.appendChild(createElement("div", "mira-visual-label", visual.label || ""));
        const total = (visual.items || []).reduce((sum, item) => sum + Number(item?.value || 0), 0);
        const bar = createElement("div", "mira-split-bar");
        (visual.items || []).forEach((item) => {
            const pct = total > 0 ? (Number(item?.value || 0) / total) * 100 : 0;
            const segment = createElement("span", `mira-split-segment mira-segment-${item?.tone || "neutral"}`);
            segment.style.width = `${Math.max(pct, total > 0 ? 8 : 0)}%`;
            bar.appendChild(segment);
        });
        node.appendChild(bar);
        const meta = createElement("div", "mira-visual-meta");
        (visual.items || []).forEach((item) => {
            meta.appendChild(createElement("span", "mira-visual-meta-item", `${item.label}: ${formatNumberValue(item.value)}`));
        });
        node.appendChild(meta);
        return node;
    }

    function renderProgressVisual(visual) {
        const node = createElement("div", "mira-visual-card");
        node.appendChild(createElement("div", "mira-visual-label", visual.label || ""));
        const pct = Math.max(0, Math.min(100, Number(visual.value || 0)));
        const rail = createElement("div", "mira-progress-rail");
        const fill = createElement("span", `mira-progress-fill mira-segment-${visual.tone || "neutral"}`);
        fill.style.width = `${pct}%`;
        rail.appendChild(fill);
        node.appendChild(rail);
        node.appendChild(createElement("div", "mira-visual-meta-item", visual.display || `${pct}%`));
        return node;
    }

    function renderValueSegmentsVisual(visual) {
        const node = createElement("div", "mira-visual-card");
        node.appendChild(createElement("div", "mira-visual-label", visual.label || ""));
        const list = createElement("div", "mira-value-segments");
        (visual.items || []).forEach((item) => {
            const segment = createElement("div", `mira-value-segment mira-segment-${item?.tone || "neutral"}`);
            segment.append(
                createElement("span", "mira-value-segment-label", item.label || "Value"),
                createElement("strong", "mira-value-segment-value", item.display || formatNumberValue(item.value))
            );
            list.appendChild(segment);
        });
        node.appendChild(list);
        return node;
    }

    function renderMetricChips(metrics) {
        const wrap = createElement("div", "mira-metric-grid");
        metrics.forEach((metric) => {
            wrap.appendChild(renderMetricChip(metric));
        });
        return wrap;
    }

    function renderMetricChip(metric) {
        const chip = createElement("div", `mira-metric-chip mira-tone-${metric?.tone || "neutral"}`);
        chip.append(
            createElement("span", "mira-metric-label", metric?.label || "Metric"),
            createElement("strong", "mira-metric-value", metric?.value || "Not available")
        );
        if (metric?.note) {
            chip.appendChild(createElement("span", "mira-metric-note", metric.note));
        }
        return chip;
    }

    function renderListCard(title, items, extraClass) {
        const card = createElement("section", `mira-list-card ${extraClass || ""}`.trim());
        card.appendChild(createElement("h4", "mira-summary-title", title));
        const list = createElement("ul", "mira-bullet-list");
        items.forEach((item) => {
            list.appendChild(createElement("li", null, item));
        });
        card.appendChild(list);
        return card;
    }

    function renderPriorityCard(items) {
        const card = createElement("section", "mira-list-card mira-priority-card");
        card.appendChild(createElement("h4", "mira-summary-title", "Priority Follow-Up"));
        const list = createElement("ul", "mira-bullet-list");
        items.forEach((item) => {
            list.appendChild(createElement("li", null, item));
        });
        card.appendChild(list);
        return card;
    }

    function renderAiPlaceholderCard(text) {
        const card = createElement("section", "mira-ai-placeholder-card");
        card.append(
            createElement("div", "mira-mini-label", "Next Phase"),
            createElement("h4", "mira-summary-title", "AI Explanation and Risk Insight"),
            createElement("p", "mira-summary-text", text)
        );
        return card;
    }

    function renderDataUsed(viewData) {
        const details = createElement("details", "mira-data-used");
        const summary = createElement("summary", "mira-data-used-summary", "View Data Used");
        details.appendChild(summary);
        const body = createElement("div", "mira-data-used-body");

        if (Array.isArray(viewData.source_tables) && viewData.source_tables.length) {
            body.appendChild(renderInlineList("Source file / table", viewData.source_tables));
        }
        if (Array.isArray(viewData.filters_applied) && viewData.filters_applied.length) {
            body.appendChild(renderInlineList("Filters applied", viewData.filters_applied));
        }
        if (Array.isArray(viewData.rows_loaded) && viewData.rows_loaded.length) {
            body.appendChild(renderMetricSection("Rows loaded", viewData.rows_loaded, true));
        }
        if (Array.isArray(viewData.rows_after_filter) && viewData.rows_after_filter.length) {
            body.appendChild(renderMetricSection("Rows after filter", viewData.rows_after_filter, true));
        }
        if (Array.isArray(viewData.kpi_values_used) && viewData.kpi_values_used.length) {
            body.appendChild(renderMetricSection("KPI values used", viewData.kpi_values_used, true));
        }
        if (viewData.last_refreshed) {
            body.appendChild(renderInlineList("Last refreshed timestamp", [viewData.last_refreshed]));
        }
        if (Array.isArray(viewData.data_warnings) && viewData.data_warnings.length) {
            body.appendChild(renderListCard("Data warnings", viewData.data_warnings, "mira-note-card"));
        }

        details.appendChild(body);
        return details;
    }

    function renderMatchingRows(data) {
        const details = createElement("details", "mira-data-used");
        details.appendChild(createElement("summary", "mira-data-used-summary", "View Matching Work Orders"));
        const body = createElement("div", "mira-data-used-body");
        body.appendChild(createElement("p", "mira-response-meta", `Showing ${data.returned_rows} of ${data.total_matched} matched rows (cap ${data.row_cap}).`));
        const tableWrap = createElement("div", "mira-table-wrap");
        const table = createElement("table", "mira-table");
        const thead = createElement("thead");
        const headerRow = createElement("tr");
        const columns = [
            ["work_order_id", "WO ID"],
            ["asset_id", "Asset ID"],
            ["asset_display_name", "Asset"],
            ["machine_group", "Group"],
            ["status_category", "Status"],
            ["ttr_hours", "TTR (h)"],
            ["data_quality_flag", "Quality"],
        ];
        columns.forEach(([, label]) => headerRow.appendChild(createElement("th", null, label)));
        thead.appendChild(headerRow);
        table.appendChild(thead);
        const tbody = createElement("tbody");
        (data.rows || []).forEach((row) => {
            const tr = createElement("tr");
            columns.forEach(([key]) => {
                tr.appendChild(createElement("td", null, row?.[key] === null || row?.[key] === undefined || row?.[key] === "" ? "—" : String(row[key])));
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        body.appendChild(tableWrap);
        details.appendChild(body);
        return details;
    }

    function renderInlineList(title, items) {
        const section = createElement("section", "mira-inline-list");
        section.appendChild(createElement("div", "mira-mini-label", title));
        const list = createElement("div", "mira-inline-items");
        items.forEach((item) => {
            list.appendChild(createBadge(item, "light"));
        });
        section.appendChild(list);
        return section;
    }

    function formatHours(value) {
        if (value === null || value === undefined || value === "") return "Not available";
        const num = Number(value);
        if (!Number.isFinite(num)) return "Not available";
        return `${num.toFixed(2)} h`;
    }

    function formatMetricValue(value) {
        if (value === null || value === undefined || value === "") return "Not available";
        return formatNumberValue(value);
    }

    function formatPercent(value) {
        if (value === null || value === undefined || value === "") return "Not available";
        const num = Number(value);
        if (!Number.isFinite(num)) return "Not available";
        return `${num.toFixed(1)}%`;
    }

    function statusToneHigh(value, good, watch) {
        const num = Number(value);
        if (!Number.isFinite(num)) return "neutral";
        if (num >= good) return "good";
        if (num >= watch) return "watch";
        return "critical";
    }

    function statusToneLow(value, good, watch) {
        const num = Number(value);
        if (!Number.isFinite(num)) return "neutral";
        if (num <= good) return "good";
        if (num <= watch) return "watch";
        return "critical";
    }

    function formatNumberValue(value) {
        if (value === null || value === undefined || value === "") return "0";
        const num = Number(value);
        if (Number.isFinite(num)) {
            return Math.abs(num - Math.round(num)) < 0.001 ? `${Math.round(num)}` : num.toFixed(1);
        }
        return String(value);
    }

    function renderReport(resp) {
        const panel = document.getElementById("mira-report");
        const body = document.getElementById("mira-report-body");
        if (!panel || !body) return;
        body.innerHTML = "";

        body.append(
            createElement("h4", "mira-report-title", resp.title || "Maintenance Report Draft"),
            createElement("p", "mira-response-meta", resp.draft_label || "Draft generated by MIRA for review"),
            createElement("p", "mira-report-narrative", resp.narrative || "")
        );

        (resp.sections || []).forEach((section) => {
            const card = createElement("section", "mira-summary-card");
            card.appendChild(createElement("h4", "mira-summary-title", section.title));
            const metrics = Object.entries(section.metrics || {}).map(([label, value]) => ({
                label,
                value: value === null || value === undefined ? "Not available" : String(value),
                tone: "neutral",
            }));
            card.appendChild(renderMetricChips(metrics));
            body.appendChild(card);
        });

        if (resp.disclaimer) {
            body.appendChild(createElement("p", "mira-summary-footnote", resp.disclaimer));
        }

        lastReportMarkdown = resp.markdown || null;
        const windowLabel = (resp.window || "report").replace(/\s+/g, "_");
        lastReportName = `MIRA_report_${windowLabel}.md`;
        panel.hidden = false;
    }

    function downloadReport() {
        if (!lastReportMarkdown) return;
        const blob = new Blob([lastReportMarkdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = lastReportName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function renderError(error) {
        const host = document.getElementById("mira-responses");
        if (!host) return;
        host.innerHTML = "";
        const card = createElement("article", "mira-response-card mira-response-error");
        card.append(
            createElement("div", "mira-badge-row", null, [createBadge("Request failed", "muted")]),
            createElement("h4", null, "MIRA could not complete that request"),
            createElement("p", null, error?.message || "Unknown error")
        );
        host.appendChild(card);
    }

    function setAvailability(enabled) {
        document.querySelectorAll("#mira-root select, #mira-root textarea, #mira-root button").forEach((node) => {
            if (node.id === "mira-download") return;
            node.disabled = !enabled;
        });
    }

    function setBusy(busy) {
        document.querySelectorAll("#mira-root select, #mira-root textarea, #mira-root button").forEach((node) => {
            if (node.id === "mira-download") return;
            node.disabled = busy || !backendHealthy;
        });
        const button = document.getElementById("mira-generate-btn");
        if (button) button.textContent = busy ? "Generating..." : "Generate Summary";
    }

    function createElement(tag, className, text, children) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (Array.isArray(text) && !children) {
            children = text;
            text = null;
        }
        if (typeof text === "string") node.textContent = text;
        if (Array.isArray(children)) children.forEach((child) => child && node.appendChild(child));
        return node;
    }

    function createButton(text, className, attrs) {
        const button = createElement("button", className, text);
        button.type = "button";
        Object.entries(attrs || {}).forEach(([key, value]) => {
            button.setAttribute(key, value);
        });
        return button;
    }

    function createBadge(text, variant) {
        return createElement("span", `mira-badge mira-badge-${variant || "light"}`, text);
    }
})();
