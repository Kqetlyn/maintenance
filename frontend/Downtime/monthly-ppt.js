(() => {
    "use strict";

    const COLORS = {
        red: "EF2536",
        redDark: "D91F31",
        green: "2E7D32",
        amber: "C87800",
        teal: "27798F",
        black: "2F2F2F",
        slate: "666666",
        muted: "8A8A8A",
        border: "D9D9D9",
        light: "F7F7F7",
        white: "FFFFFF",
        s1: "EF2536",
        s2: "C87800",
        s3: "27798F",
        s4: "999999",
    };
    const FONT = "Aptos";
    const HEAD_FONT = "Aptos Display";
    const LOGO_URL = "/shared/mira/sats-logo-red.png";
    const PPTXGEN_LOCAL_URL = "/shared/vendor/pptxgen.bundle.js?v=3.12.0-local-1";
    const PPTXGEN_CDN_URL = "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js";
    const MAX_ACTION_ROWS = 7;
    const state = {
        rowCache: { stage: "", rows: null, promise: null },
        reportCache: { rows: null, key: "", report: null },
        logoPromise: null,
        pptxLibraryPromise: null,
        wired: false,
        busy: false,
    };

    function loadPptxLibraryScript(url, timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            let settled = false;
            const finish = (error = null) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeoutId);
                script.onload = null;
                script.onerror = null;
                if (!error && typeof window.PptxGenJS === "function") resolve(window.PptxGenJS);
                else reject(error || new Error(`PowerPoint library did not initialise from ${url}.`));
            };
            const timeoutId = window.setTimeout(() => finish(new Error(`PowerPoint library timed out while loading ${url}.`)), timeoutMs);
            script.src = url;
            script.async = true;
            script.dataset.pptxgenRuntime = "retry";
            script.onload = () => finish();
            script.onerror = () => finish(new Error(`PowerPoint library could not be loaded from ${url}.`));
            document.head.appendChild(script);
        });
    }

    async function ensurePptxLibrary() {
        if (typeof window.PptxGenJS === "function") return window.PptxGenJS;
        if (state.pptxLibraryPromise) return state.pptxLibraryPromise;
        state.pptxLibraryPromise = loadPptxLibraryScript(`${PPTXGEN_LOCAL_URL}&retry=${Date.now()}`, 3000)
            .catch(() => loadPptxLibraryScript(PPTXGEN_CDN_URL, 5000))
            .catch(() => {
                throw new Error("The PowerPoint generator could not be loaded. The local report library may be missing from this deployment.");
            })
            .finally(() => {
                state.pptxLibraryPromise = null;
            });
        return state.pptxLibraryPromise;
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function previousCalendarDay(base = new Date()) {
        return new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
    }

    function previousCalendarMonth(base = new Date()) {
        return new Date(base.getFullYear(), base.getMonth() - 1, 1);
    }

    function monthKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    function parseMonthKey(value) {
        const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        if (!year || month < 1 || month > 12) return null;
        return {
            start: new Date(year, month - 1, 1, 0, 0, 0, 0),
            end: new Date(year, month, 1, 0, 0, 0, 0),
        };
    }

    function parseDayKey(value) {
        const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const start = new Date(year, month - 1, day, 0, 0, 0, 0);
        if (
            Number.isNaN(start.getTime())
            || start.getFullYear() !== year
            || start.getMonth() !== month - 1
            || start.getDate() !== day
        ) return null;
        return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1) };
    }

    function monthLabel(value, style = "long") {
        const range = parseMonthKey(value);
        return range
            ? range.start.toLocaleDateString("en-GB", { month: style, year: "numeric" })
            : String(value || "Selected month");
    }

    function dayLabel(value) {
        const range = parseDayKey(value);
        return range
            ? range.start.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
            : String(value || "Selected day");
    }

    function selectedStageLabel(value) {
        return value === "Stage 1" || value === "Stage 2" ? value : "All Stages";
    }

    function stageKey(value) {
        return value === "Stage 1" || value === "Stage 2" ? value : "all";
    }

    function workOrderStageLabel(row, assetMeta = null) {
        const candidates = [
            assetMeta?.mappedStage,
            assetMeta?.mapped_stage,
            assetMeta?.stage,
            row?.resolved_stage,
            row?.mappedStage,
            row?.mapped_stage,
            row?.stage,
            row?.site_stage,
        ];
        for (const candidate of candidates) {
            const normalized = normalizeClassification(candidate).replace(/\s+/g, " ");
            if (["1", "stage 1", "stage1"].includes(normalized)) return "Stage 1";
            if (["2", "stage 2", "stage2"].includes(normalized)) return "Stage 2";
        }
        return "--";
    }

    function getDialogFilters() {
        return {
            month: byId("monthly-ppt-month")?.value || "",
            financialYear: Number(byId("monthly-ppt-fy")?.value || 0),
            actionDate: byId("monthly-ppt-action-date")?.value || "",
            stage: stageKey(byId("monthly-ppt-stage")?.value),
            scope: byId("monthly-ppt-scope")?.value === "all" ? "all" : "production",
        };
    }

    function updateScopeSummary() {
        const filters = getDialogFilters();
        const scopeLabel = filters.scope === "production" ? "Production machines only" : "All mapped machines";
        const summary = byId("monthly-ppt-scope-summary");
        if (!summary) return;
        summary.textContent = `${monthLabel(filters.month)} monthly KPIs | ${getMrFinancialYearLabel(filters.financialYear)} YTD MTTR/MTBF | latest S1/S2 corrective production issues raised on ${dayLabel(filters.actionDate)} | ${selectedStageLabel(filters.stage)} | ${scopeLabel}.`;
    }

    function populateFinancialYears(selectedMonth) {
        const select = byId("monthly-ppt-fy");
        if (!select) return;
        const reportRange = parseMonthKey(selectedMonth);
        const reportFy = getMrFinancialYearStart(reportRange?.start || new Date());
        const currentFy = getMrFinancialYearStart(new Date());
        const years = new Set([reportFy, currentFy]);
        const availableRows = (typeof allWorkOrderRowsCache !== "undefined" && allWorkOrderRowsCache)
            || (typeof getFallbackAllWorkOrderRows === "function" ? getFallbackAllWorkOrderRows() : []);
        if (typeof getMrAvailableYears === "function") getMrAvailableYears(availableRows).forEach((year) => years.add(year));
        for (let offset = 0; offset < 10; offset++) years.add(currentFy - offset);
        const ordered = [...years].filter(Number.isFinite).sort((a, b) => b - a);
        const previous = Number(select.value || reportFy);
        select.innerHTML = ordered
            .map((year) => `<option value="${year}">${getMrFinancialYearLongLabel(year)}</option>`)
            .join("");
        select.value = ordered.includes(previous) ? String(previous) : String(reportFy);
    }

    function initialiseDialogDefaults() {
        const monthInput = byId("monthly-ppt-month");
        const actionInput = byId("monthly-ppt-action-date");
        const stageSelect = byId("monthly-ppt-stage");
        if (monthInput && !monthInput.value) monthInput.value = monthKey(previousCalendarMonth());
        if (actionInput) actionInput.value = formatDateInputValue(previousCalendarDay());
        populateFinancialYears(monthInput?.value || monthKey(previousCalendarMonth()));
        if (stageSelect) stageSelect.value = stageKey(getSelectedDowntimeStage());
        updateScopeSummary();
    }

    function setStatus(message = "", tone = "") {
        const node = byId("monthly-ppt-status");
        if (!node) return;
        node.textContent = message;
        node.classList.toggle("hidden", !message);
        node.classList.toggle("error", tone === "error");
    }

    function setBusy(busy) {
        state.busy = Boolean(busy);
        ["monthly-ppt-generate", "monthly-ppt-cancel", "monthly-ppt-close"].forEach((id) => {
            const node = byId(id);
            if (node) node.disabled = state.busy;
        });
        const generate = byId("monthly-ppt-generate");
        if (generate) generate.textContent = state.busy ? "Generating..." : "Generate PPT";
        const headerButton = byId("downtime-export-ppt-btn");
        if (headerButton) {
            headerButton.disabled = state.busy;
            headerButton.textContent = state.busy ? "Generating PPT..." : "Generate PPT";
        }
    }

    function open() {
        wire();
        initialiseDialogDefaults();
        setStatus("");
        const dialog = byId("monthly-ppt-dialog");
        if (!dialog) return;
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
    }

    function close() {
        if (state.busy) return;
        const dialog = byId("monthly-ppt-dialog");
        if (!dialog) return;
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
    }

    function wire() {
        if (state.wired) return;
        state.wired = true;
        byId("monthly-ppt-close")?.addEventListener("click", close);
        byId("monthly-ppt-cancel")?.addEventListener("click", close);
        byId("monthly-ppt-dialog")?.addEventListener("cancel", (event) => {
            if (state.busy) event.preventDefault();
        });
        ["monthly-ppt-month", "monthly-ppt-fy", "monthly-ppt-action-date", "monthly-ppt-stage", "monthly-ppt-scope"].forEach((id) => {
            byId(id)?.addEventListener("change", () => {
                if (id === "monthly-ppt-month") populateFinancialYears(byId(id)?.value || "");
                updateScopeSummary();
            });
        });
        byId("monthly-ppt-form")?.addEventListener("submit", handleSubmit);
    }

    function clearCache() {
        state.rowCache = { stage: "", rows: null, promise: null };
        state.reportCache = { rows: null, key: "", report: null };
    }

    function canReuseDashboardHistory(stage) {
        if (typeof allWorkOrderRowsCache === "undefined" || !Array.isArray(allWorkOrderRowsCache) || !allWorkOrderRowsCache.length) return false;
        return stageKey(getSelectedDowntimeStage()) === stage;
    }

    async function loadRows(stage) {
        const key = stageKey(stage);
        if (state.rowCache.stage === key && Array.isArray(state.rowCache.rows)) return state.rowCache.rows;
        if (state.rowCache.stage === key && state.rowCache.promise) return state.rowCache.promise;
        if (canReuseDashboardHistory(key)) {
            state.rowCache = { stage: key, rows: allWorkOrderRowsCache, promise: null };
            return allWorkOrderRowsCache;
        }

        const query = new URLSearchParams({ period: "all_years", work_orders_only: "1", _: String(Date.now()) });
        if (key !== "all") query.set("stage", key);
        const pending = fetch(`/api/downtime?${query.toString()}`, { cache: "no-store" })
            .then(async (response) => {
                if (!response.ok) throw new Error(`Historical work-order request failed (HTTP ${response.status}).`);
                const payload = await response.json();
                const rows = Array.isArray(payload?.management?.work_orders) ? payload.management.work_orders : [];
                if (!rows.length) throw new Error("No work-order history is available for the selected stage.");
                state.rowCache = { stage: key, rows, promise: null };
                if (stageKey(getSelectedDowntimeStage()) === key) {
                    allWorkOrderRowsCache = rows;
                    if (typeof setHistoricalDataLoadUi === "function") {
                        setHistoricalDataLoadUi("loaded", `${getHistoricalDataSpanLabel(rows)} loaded and cached for reports and comparisons.`);
                    }
                }
                return rows;
            })
            .catch((error) => {
                if (state.rowCache.promise === pending) state.rowCache = { stage: "", rows: null, promise: null };
                throw error;
            });
        state.rowCache = { stage: key, rows: null, promise: pending };
        return pending;
    }

    function isFacilityOrBuilding(row, meta = null) {
        const text = [
            row?.equipment_category,
            row?.criticality,
            row?.normalized_criticality,
            row?.machine_group,
            row?.asset_machine_group,
            row?.location,
            meta?.machine_name,
            meta?.asset_machine_group,
            meta?.criticality,
            meta?.location,
        ].map((value) => normalizeClassification(value)).join(" ");
        return /\bfacilit|\bbuilding|non critical|non production|office area|warehouse area/.test(text);
    }

    function isProductionMachine(row, assetLookup = buildAssetListLookup()) {
        const assetId = getMachineAssetId(row);
        const meta = getAssetMetaFromLookup(assetLookup, assetId);
        if (isFacilityOrBuilding(row, meta)) return false;
        const category = normalizeClassification(getRowEquipmentCategory(row));
        const classification = [
            category,
            row?.equipment_category,
            row?.criticality,
            row?.normalized_criticality,
            row?.machine_group,
            meta?.machine_name,
            meta?.criticality,
        ].map((value) => normalizeClassification(value)).join(" ");
        return category === "production equipment"
            || classification.includes("production equipment")
            || /production\s*(?:high|medium|low)\s*risk/.test(classification);
    }

    function scopedRows(rows, scope, assetLookup) {
        return scope === "production" ? rows.filter((row) => isProductionMachine(row, assetLookup)) : rows;
    }

    function isDateInRange(date, range) {
        return Boolean(date && range && date >= range.start && date < range.end);
    }

    function endOfAvailableYtd(financialYear) {
        const range = getMrFinancialYearRange(financialYear);
        const todayExclusive = new Date();
        todayExclusive.setHours(0, 0, 0, 0);
        todayExclusive.setDate(todayExclusive.getDate() + 1);
        const end = todayExclusive < range.start ? range.start : (todayExclusive < range.end ? todayExclusive : range.end);
        return { start: range.start, end };
    }

    function severityCode(row) {
        const key = getWorkOrderSlaSeverity(row)?.key || "UNCLASSIFIED";
        return ["S1", "S2", "S3", "S4"].includes(key) ? key : "UNCLASSIFIED";
    }

    function severityRank(row) {
        return ({ S1: 1, S2: 2, S3: 3, S4: 4 })[severityCode(row)] || 9;
    }

    function isFinishedBy(row, cutoff) {
        const finished = getMrFinishedDate(row).date;
        return Boolean(finished && finished < cutoff && isMrFinishedStatus(getMrStatus(row)));
    }

    function aggregateMttrGroups(assetMap) {
        const groups = new Map();
        assetMap.forEach((entry) => {
            if (!entry.hours?.length) return;
            const name = String(entry.assetMachineGroup || entry.assetName || entry.group || "Unclassified").trim();
            if (!name || /facility|building|unclassified/i.test(name)) return;
            if (!groups.has(name)) groups.set(name, { name, hours: [] });
            groups.get(name).hours.push(...entry.hours);
        });
        return [...groups.values()]
            .map((group) => ({
                name: group.name,
                value: group.hours.reduce((sum, value) => sum + value, 0) / group.hours.length,
                count: group.hours.length,
            }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 6);
    }

    function aggregateMtbfGroups(allAssets) {
        const groups = new Map();
        allAssets.forEach((entry) => {
            if (!entry.hasMtbf || !Number.isFinite(entry.avgMtbf) || !entry.gapCount) return;
            const name = String(entry.assetMachineGroup || entry.assetName || entry.group || "Unclassified").trim();
            if (!name || /facility|building|unclassified/i.test(name)) return;
            if (!groups.has(name)) groups.set(name, { name, weightedHours: 0, gaps: 0, failures: 0 });
            const group = groups.get(name);
            group.weightedHours += entry.avgMtbf * entry.gapCount;
            group.gaps += entry.gapCount;
            group.failures += entry.woCount || 0;
        });
        return [...groups.values()]
            .map((group) => ({
                name: group.name,
                value: group.gaps ? group.weightedHours / group.gaps : null,
                count: group.gaps,
                failures: group.failures,
            }))
            .filter((group) => Number.isFinite(group.value))
            .sort((a, b) => a.value - b.value)
            .slice(0, 6);
    }

    function actionStatus(row) {
        const status = getMrStatus(row);
        if (isMrNewStatus(status)) return "New - not ack";
        if (isMrInProgressStatus(status)) return "In progress";
        if (isMrFinishedStatus(status)) return "Finished";
        return status || "Review";
    }

    function actionOpenAge(row, referenceDate = new Date()) {
        if (isMrFinishedStatus(getMrStatus(row))) return "Closed";
        const raised = getMrRaisedDate(row).date;
        if (!raised) return "--";
        const hours = Math.max(0, (referenceDate.getTime() - raised.getTime()) / 3600000);
        if (hours >= 48) return `${Math.floor(hours / 24)} d`;
        return `${Math.floor(hours)} h`;
    }

    function isCorrectiveActionRow(row, index = 0) {
        const classification = typeof classifyPreventiveCorrectiveRow === "function"
            ? classifyPreventiveCorrectiveRow(row, index)
            : null;
        if (classification?.reviewDecision) return classification.finalType === "Corrective";

        const typeText = typeof getPreventiveCorrectiveTypeText === "function"
            ? getPreventiveCorrectiveTypeText(row)
            : [row?.maintenance_job_type, row?.maintenance_type, row?.request_type, row?.work_order_type, row?.job_type]
                .filter(Boolean).join(" | ");
        const narrativeText = typeof getPreventiveCorrectiveNarrativeText === "function"
            ? getPreventiveCorrectiveNarrativeText(row)
            : [row?.description_original, row?.translated_description, row?.description, row?.remarks, row?.notes]
                .filter(Boolean).join(" | ");
        const explicitPreventive = /\bprevent(?:ive|ative)\b|\bplanned maintenance\b|\bscheduled maintenance\b|(?:^|[^a-z0-9])p\.?m\.?(?:[^a-z0-9]|$)/i;
        if (explicitPreventive.test(`${typeText} | ${narrativeText}`)) return false;
        if (typeof isRowLoggedPreventive === "function" && isRowLoggedPreventive(row)) return false;
        return classification ? classification.finalType === "Corrective" : true;
    }

    function isProductionAreaWorkOrder(row, assetMeta = null) {
        const text = [
            row?.equipment_name,
            row?.asset_name,
            row?.mappedAssetName,
            row?.mapped_asset_name,
            row?.machine_group,
            row?.asset_machine_group,
            row?.raw_functional_location,
            row?.functional_location,
            row?.location,
            assetMeta?.asset_name,
            assetMeta?.machine_name,
            assetMeta?.asset_machine_group,
            assetMeta?.location,
        ].map((value) => normalizeClassification(value)).filter(Boolean).join(" | ");
        return /\bproduction\s*(?:work\s*)?area\b|\bwork\s*area\b|\bgeneral\s*(?:production\s*)?area\b|\b(?:production\s*)?(?:high|medium|low)\s*risk\b/.test(text);
    }

    function buildActionRows(rows, cutoffRange, assetLookup) {
        const referenceDate = new Date();
        return rows
            .filter((row, index) => {
                const raised = getMrRaisedDate(row).date;
                const severity = severityCode(row);
                return Boolean(
                    raised
                    && cutoffRange
                    && raised >= cutoffRange.start
                    && raised < cutoffRange.end
                    && (severity === "S1" || severity === "S2")
                    && isProductionMachine(row, assetLookup)
                    && isCorrectiveActionRow(row, index)
                );
            })
            .sort((a, b) => {
                const aMeta = getAssetMetaFromLookup(assetLookup, getMachineAssetId(a));
                const bMeta = getAssetMetaFromLookup(assetLookup, getMachineAssetId(b));
                const areaDelta = Number(isProductionAreaWorkOrder(a, aMeta)) - Number(isProductionAreaWorkOrder(b, bMeta));
                if (areaDelta) return areaDelta;
                const raisedDelta = (getMrRaisedDate(b).date?.getTime() || 0) - (getMrRaisedDate(a).date?.getTime() || 0);
                if (raisedDelta) return raisedDelta;
                return severityRank(a) - severityRank(b);
            })
            .map((row, index) => {
                const assetId = getMachineAssetId(row);
                const meta = getAssetMetaFromLookup(assetLookup, assetId);
                const original = typeof getMrDescriptionThai === "function" ? getMrDescriptionThai(row) : (getMrDescription(row) || "--");
                const english = typeof getMrDescriptionEnglish === "function"
                    ? getMrDescriptionEnglish(row)
                    : (String(row?.translated_description || "").trim() || "--");
                return {
                    id: getMrRequestId(row, index) || getMrWorkOrderOnlyId(row) || "--",
                    severity: severityCode(row),
                    stage: workOrderStageLabel(row, meta),
                    status: actionStatus(row),
                    assetId: assetId || "--",
                    asset: kdiCanonicalAssetName(row, meta, assetId) || getMachineEquipmentName(row),
                    original,
                    english,
                    openAge: actionOpenAge(row, referenceDate),
                    raised: getMrRaisedDate(row).date,
                };
            });
    }

    function buildReportModel(rows, filters) {
        const key = JSON.stringify(filters);
        if (state.reportCache.rows === rows && state.reportCache.key === key) return state.reportCache.report;
        const reportMonth = parseMonthKey(filters.month);
        const actionDay = parseDayKey(filters.actionDate);
        if (!reportMonth || !actionDay || !filters.financialYear) throw new Error("Select a valid month, financial year, and action-list date.");
        const previousMonthDate = new Date(reportMonth.start.getFullYear(), reportMonth.start.getMonth() - 1, 1);
        const previousMonth = { start: previousMonthDate, end: reportMonth.start };

        const assetLookup = buildAssetListLookup();
        const inScope = scopedRows(rows, filters.scope, assetLookup);
        const monthRows = inScope.filter((row) => isDateInRange(getMrRaisedDate(row).date, reportMonth));
        const previousMonthRows = inScope.filter((row) => isDateInRange(getMrRaisedDate(row).date, previousMonth));
        const reportCutoff = reportMonth.end < new Date() ? reportMonth.end : new Date();
        const finished = monthRows.filter((row) => isFinishedBy(row, reportCutoff));
        const open = Math.max(0, monthRows.length - finished.length);
        const severityCounts = { S1: 0, S2: 0, S3: 0, S4: 0 };
        monthRows.forEach((row) => {
            const code = severityCode(row);
            if (Object.prototype.hasOwnProperty.call(severityCounts, code)) severityCounts[code] += 1;
        });
        const reliability = buildDataQualityIndex(monthRows, new Date(reportCutoff.getTime() - 1));

        const fyRange = endOfAvailableYtd(filters.financialYear);
        const fyRows = inScope.filter((row) => isDateInRange(kdiWorkOrderDate(row), fyRange));
        const mttrData = kdiComputeMttrMetrics(fyRows, assetLookup);
        const mtbfData = kdiComputeMtbfMetrics(inScope, assetLookup, fyRange);
        const mttrGroups = aggregateMttrGroups(mttrData.assetMap);
        const mtbfGroups = aggregateMtbfGroups(mtbfData.allAssets);

        // The action list is intentionally independent of the KPI machine-scope
        // selector: it is always the latest S1/S2 corrective production-machine requests
        // raised on the selected day. Specific machine assets rank ahead of general
        // production-area/risk-zone records before the seven-row limit is applied.
        const actionAll = buildActionRows(rows, actionDay, assetLookup);
        const oldestOpenS1 = inScope
            .filter((row) => severityCode(row) === "S1" && !isMrFinishedStatus(getMrStatus(row)) && getMrRaisedDate(row).date)
            .sort((a, b) => getMrRaisedDate(a).date - getMrRaisedDate(b).date)[0] || null;

        const report = {
            filters,
            stageLabel: selectedStageLabel(filters.stage),
            scopeLabel: filters.scope === "production" ? "Production machines only" : "All mapped machines",
            monthLabel: monthLabel(filters.month),
            monthLabelUpper: monthLabel(filters.month).toUpperCase(),
            previousMonthLabel: previousMonth.start.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
            fyLabel: getMrFinancialYearLabel(filters.financialYear),
            fyLongLabel: getMrFinancialYearLongLabel(filters.financialYear),
            fyCutoffLabel: new Date(fyRange.end.getTime() - 1).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
            actionDateLabel: dayLabel(filters.actionDate),
            raised: monthRows.length,
            previousRaised: previousMonthRows.length,
            raisedChangePct: previousMonthRows.length ? ((monthRows.length - previousMonthRows.length) / previousMonthRows.length) * 100 : null,
            finished: finished.length,
            open,
            finishedPct: monthRows.length ? (finished.length / monthRows.length) * 100 : null,
            openPct: monthRows.length ? (open / monthRows.length) * 100 : null,
            severityCounts,
            reliabilityIndex: reliability?.index ?? null,
            reliabilityTotal: reliability?.total || 0,
            mttrGroups,
            mtbfGroups,
            mttrValidCount: mttrData.validCount,
            mtbfGapCount: mtbfData.totalGaps,
            actionTotal: actionAll.length,
            actionRows: actionAll.slice(0, MAX_ACTION_ROWS),
            oldestOpenS1: oldestOpenS1 ? {
                id: getMrRequestId(oldestOpenS1) || getMrWorkOrderOnlyId(oldestOpenS1) || "--",
                asset: kdiCanonicalAssetName(oldestOpenS1, getAssetMetaFromLookup(assetLookup, getMachineAssetId(oldestOpenS1)), getMachineAssetId(oldestOpenS1)),
                age: actionOpenAge(oldestOpenS1),
            } : null,
            sourceRowCount: inScope.length,
            generatedAt: new Date(),
        };
        state.reportCache = { rows, key, report };
        return report;
    }

    function loadAssetData(url) {
        if (state.logoPromise) return state.logoPromise;
        state.logoPromise = fetch(url, { cache: "force-cache" })
            .then((response) => {
                if (!response.ok) throw new Error("Unable to load the SATS logo for the report.");
                return response.blob();
            })
            .then((blob) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error("Unable to read the SATS logo for the report."));
                reader.readAsDataURL(blob);
            }))
            .catch((error) => {
                state.logoPromise = null;
                throw error;
            });
        return state.logoPromise;
    }

    function shortText(value, maxLength) {
        const text = String(value || "--").replace(/\s+/g, " ").trim();
        if (text.length <= maxLength) return text;
        return `${text.slice(0, Math.max(1, maxLength - 1)).replace(/\s+\S*$/, "")}...`;
    }

    function pct(value) {
        return Number.isFinite(value) ? `${value.toFixed(1)}%` : "N/A";
    }

    function numberText(value) {
        return Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US") : "--";
    }

    function mttrText(hours) {
        if (!Number.isFinite(hours)) return "--";
        return hours >= 10 ? `${Math.round(hours)} h` : `${hours.toFixed(1)} h`;
    }

    function mtbfText(hours) {
        if (!Number.isFinite(hours)) return "--";
        const days = hours / 24;
        return days >= 10 ? `${Math.round(days)} d` : `${days.toFixed(1)} d`;
    }

    function addPanel(slide, pptx, x, y, w, h, accent = COLORS.border) {
        slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: COLORS.white }, line: { color: COLORS.border, width: 0.7 } });
        slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.04, fill: { color: accent }, line: { color: accent, transparency: 100 } });
    }

    function addBarRanking(slide, pptx, x, y, w, h, title, subtitle, rows, color, formatter) {
        addPanel(slide, pptx, x, y, w, h, COLORS.border);
        slide.addShape(pptx.ShapeType.rect, { x: x + 0.12, y: y + 0.10, w: 0.04, h: 0.20, fill: { color }, line: { color, transparency: 100 } });
        slide.addText(title, { x: x + 0.22, y: y + 0.075, w: w - 0.34, h: 0.20, fontFace: HEAD_FONT, fontSize: 12.5, bold: true, color: COLORS.black, margin: 0, fit: "shrink" });
        slide.addText(subtitle, { x: x + 0.22, y: y + 0.29, w: w - 0.34, h: 0.15, fontFace: FONT, fontSize: 7.2, color: COLORS.slate, margin: 0, fit: "shrink" });
        if (!rows.length) {
            slide.addText("No valid production-machine data for this financial-year scope.", { x: x + 0.3, y: y + 1.0, w: w - 0.6, h: 0.35, fontFace: FONT, fontSize: 10, color: COLORS.muted, align: "center", margin: 0 });
            return;
        }
        const labelW = 1.65;
        const valueW = 0.62;
        const barX = x + 1.78;
        const barW = w - labelW - valueW - 0.36;
        const maxValue = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
        const rowH = 0.275;
        const startY = y + 0.55;
        rows.forEach((row, index) => {
            const ry = startY + (index * rowH);
            const width = Math.max(0.05, barW * ((Number(row.value) || 0) / maxValue));
            slide.addText(shortText(row.name, 25), { x: x + 0.15, y: ry - 0.01, w: labelW - 0.08, h: 0.16, fontFace: FONT, fontSize: 7.8, bold: index === 0, color: COLORS.black, align: "right", margin: 0, fit: "shrink" });
            slide.addShape(pptx.ShapeType.rect, { x: barX, y: ry + 0.01, w: width, h: 0.115, fill: { color }, line: { color, transparency: 100 } });
            slide.addText(formatter(row.value), { x: barX + width + 0.05, y: ry - 0.01, w: valueW, h: 0.16, fontFace: FONT, fontSize: 7.8, bold: index === 0, color: COLORS.black, margin: 0, fit: "shrink" });
        });
    }

    function addActionTable(slide, pptx, report) {
        const x = 0.40;
        const y = 5.40;
        const widths = [1.05, 0.40, 0.58, 1.05, 0.78, 1.55, 2.70, 3.72, 0.70];
        const headers = ["MR No.", "SL", "Stage", "Status", "Asset ID", "Asset", "Issue - as reported", "Issue - English", "Open"];
        let cursorX = x;
        headers.forEach((header, index) => {
            slide.addShape(pptx.ShapeType.rect, { x: cursorX, y, w: widths[index], h: 0.25, fill: { color: COLORS.red }, line: { color: COLORS.red, transparency: 100 } });
            slide.addText(header, { x: cursorX + 0.04, y: y + 0.035, w: widths[index] - 0.08, h: 0.15, fontFace: FONT, fontSize: 7.2, bold: true, color: COLORS.white, margin: 0, fit: "shrink", align: index === 8 ? "right" : "left" });
            cursorX += widths[index];
        });

        const rows = report.actionRows.length ? report.actionRows : [{ empty: true }];
        rows.forEach((row, rowIndex) => {
            const ry = y + 0.25 + (rowIndex * 0.235);
            const fill = rowIndex % 2 === 0 ? COLORS.white : COLORS.light;
            slide.addShape(pptx.ShapeType.rect, { x, y: ry, w: widths.reduce((sum, value) => sum + value, 0), h: 0.235, fill: { color: fill }, line: { color: "E6E6E6", width: 0.25 } });
            if (row.empty) {
                slide.addText("No corrective S1/S2 production-machine requests were raised on the selected date.", { x: x + 0.08, y: ry + 0.045, w: 12.2, h: 0.14, fontFace: FONT, fontSize: 7.5, italic: true, color: COLORS.muted, margin: 0 });
                return;
            }
            const values = [
                shortText(row.id, 18), row.severity, row.stage, shortText(row.status, 18), shortText(row.assetId, 16),
                shortText(row.asset, 30), shortText(row.original, 48), shortText(row.english, 55), row.openAge,
            ];
            cursorX = x;
            values.forEach((value, index) => {
                if (index === 1) {
                    const badgeColor = COLORS[String(row.severity || "").toLowerCase()] || COLORS.s4;
                    slide.addShape(pptx.ShapeType.roundRect, { x: cursorX + 0.05, y: ry + 0.035, w: widths[index] - 0.10, h: 0.16, fill: { color: badgeColor }, line: { color: badgeColor, transparency: 100 } });
                    slide.addText(value, { x: cursorX + 0.05, y: ry + 0.058, w: widths[index] - 0.10, h: 0.10, fontFace: FONT, fontSize: 6.8, bold: true, color: COLORS.white, align: "center", margin: 0 });
                } else {
                    const isStatusAttention = index === 3 && /new|not ack/i.test(value);
                    const isAsset = index === 5;
                    const isOpen = index === 8 && value !== "Closed";
                    slide.addText(value, {
                        x: cursorX + 0.04, y: ry + 0.055, w: widths[index] - 0.08, h: 0.11,
                        fontFace: index === 6 ? "Leelawadee UI" : FONT,
                        fontSize: index >= 6 || index === 2 ? 6.4 : 6.8,
                        bold: isAsset || isOpen,
                        color: isStatusAttention ? COLORS.red : (isOpen ? COLORS.amber : COLORS.black),
                        align: index === 8 ? "right" : "left", margin: 0, fit: "shrink",
                    });
                }
                cursorX += widths[index];
            });
        });
    }

    async function generatePpt(report, { download = true } = {}) {
        const PptxConstructor = await ensurePptxLibrary();
        const logo = await loadAssetData(LOGO_URL);
        const pptx = new PptxConstructor();
        pptx.layout = "LAYOUT_WIDE";
        pptx.author = "SATS Food Solutions Thailand";
        pptx.company = "SATS Food Solutions Thailand";
        pptx.subject = "Monthly maintenance performance report";
        pptx.title = `Maintenance Monthly Report - ${report.monthLabel}`;
        pptx.lang = "en-US";
        pptx.theme = { headFontFace: HEAD_FONT, bodyFontFace: FONT, lang: "en-US" };
        const slide = pptx.addSlide();
        slide.background = { color: COLORS.white };

        slide.addText("Maintenance Monthly Report", { x: 0.40, y: 0.13, w: 8.9, h: 0.42, fontFace: HEAD_FONT, fontSize: 26, bold: true, color: COLORS.red, margin: 0, fit: "shrink" });
        const subtitle = `${report.monthLabel}  |  ${report.stageLabel}  |  ${report.scopeLabel}  |  vs. ${report.previousMonthLabel}  |  MTTR/MTBF ${report.fyLabel} YTD`;
        slide.addText(subtitle, { x: 0.40, y: 0.62, w: 10.5, h: 0.17, fontFace: FONT, fontSize: 8.5, color: COLORS.slate, margin: 0, fit: "shrink" });
        slide.addImage({ data: logo, x: 11.28, y: 0.13, w: 1.62, h: 0.66 });
        slide.addShape(pptx.ShapeType.rect, { x: 0.40, y: 0.91, w: 12.53, h: 0.025, fill: { color: COLORS.red }, line: { color: COLORS.red, transparency: 100 } });

        addPanel(slide, pptx, 0.40, 1.00, 4.54, 1.17, COLORS.red);
        slide.addText(`MR RAISED - ${report.monthLabelUpper}`, { x: 0.53, y: 1.13, w: 2.1, h: 0.16, fontFace: FONT, fontSize: 8.2, color: COLORS.slate, margin: 0, fit: "shrink" });
        slide.addText(numberText(report.raised), { x: 0.53, y: 1.36, w: 1.75, h: 0.45, fontFace: HEAD_FONT, fontSize: 34, bold: true, color: COLORS.red, margin: 0, fit: "shrink" });
        const changeArrow = report.raisedChangePct === null ? "-" : report.raisedChangePct >= 0 ? "▲" : "▼";
        const changeText = report.raisedChangePct === null ? "No prior-month baseline" : `${changeArrow} ${Math.abs(report.raisedChangePct).toFixed(1)}% vs ${report.previousMonthLabel} (${numberText(report.previousRaised)})`;
        slide.addText(changeText, { x: 0.53, y: 1.88, w: 2.25, h: 0.14, fontFace: FONT, fontSize: 7.3, bold: report.raisedChangePct !== null, color: report.raisedChangePct >= 0 ? COLORS.amber : COLORS.green, margin: 0, fit: "shrink" });
        const doughnutValues = report.raised ? [report.finished, report.open] : [1, 0];
        slide.addChart(pptx.ChartType.doughnut, [{ name: "MR status", labels: ["Finished", "Still open"], values: doughnutValues }], {
            x: 2.66, y: 1.18, w: 1.10, h: 0.82, holeSize: 62, showLegend: false, showTitle: false,
            showValue: false, showPercent: false, showCategoryName: false, chartColors: [COLORS.green, COLORS.amber],
            border: { color: COLORS.white, pt: 0 }, showBorder: false,
        });
        slide.addText(`■ ${pct(report.finishedPct)}`, { x: 3.77, y: 1.36, w: 0.98, h: 0.16, fontFace: FONT, fontSize: 9.5, bold: true, color: COLORS.green, margin: 0, fit: "shrink" });
        slide.addText(`${numberText(report.finished)} finished`, { x: 3.88, y: 1.54, w: 0.78, h: 0.14, fontFace: FONT, fontSize: 6.9, color: COLORS.slate, margin: 0, fit: "shrink" });
        slide.addText(`■ ${pct(report.openPct)}`, { x: 3.77, y: 1.73, w: 0.98, h: 0.16, fontFace: FONT, fontSize: 9.5, bold: true, color: COLORS.amber, margin: 0, fit: "shrink" });
        slide.addText(`${numberText(report.open)} still open`, { x: 3.88, y: 1.91, w: 0.78, h: 0.14, fontFace: FONT, fontSize: 6.9, color: COLORS.slate, margin: 0, fit: "shrink" });

        addPanel(slide, pptx, 5.08, 1.00, 5.55, 1.17, COLORS.black);
        slide.addText("MR RAISED BY SERVICE LEVEL", { x: 5.20, y: 1.13, w: 3.0, h: 0.16, fontFace: FONT, fontSize: 8.2, color: COLORS.slate, margin: 0 });
        slide.addText(`${numberText(report.raised)} total`, { x: 9.75, y: 1.13, w: 0.72, h: 0.16, fontFace: FONT, fontSize: 7.4, color: COLORS.muted, align: "right", margin: 0 });
        ["S1", "S2", "S3", "S4"].forEach((code, index) => {
            const x = 5.20 + (index * 1.30);
            const count = report.severityCounts[code] || 0;
            const color = COLORS[code.toLowerCase()];
            slide.addShape(pptx.ShapeType.rect, { x, y: 1.38, w: 1.16, h: 0.018, fill: { color }, line: { color, transparency: 100 } });
            slide.addText(code, { x, y: 1.47, w: 0.45, h: 0.14, fontFace: FONT, fontSize: 7.8, bold: true, color, margin: 0 });
            slide.addText(numberText(count), { x, y: 1.67, w: 1.05, h: 0.28, fontFace: HEAD_FONT, fontSize: 23, bold: true, color: COLORS.black, margin: 0, fit: "shrink" });
            slide.addText(`${pct(report.raised ? (count / report.raised) * 100 : null)} of raised`, { x, y: 1.98, w: 1.12, h: 0.12, fontFace: FONT, fontSize: 6.6, color: COLORS.slate, margin: 0, fit: "shrink" });
        });

        addPanel(slide, pptx, 10.77, 1.00, 2.16, 1.17, COLORS.amber);
        slide.addText("DATA RELIABILITY INDEX", { x: 10.90, y: 1.13, w: 1.90, h: 0.16, fontFace: FONT, fontSize: 7.7, color: COLORS.slate, margin: 0, fit: "shrink" });
        slide.addText(pct(report.reliabilityIndex), { x: 10.90, y: 1.52, w: 1.85, h: 0.45, fontFace: HEAD_FONT, fontSize: 30, bold: true, color: COLORS.amber, margin: 0, fit: "shrink" });
        slide.addText(`${numberText(report.reliabilityTotal)} monthly records`, { x: 10.90, y: 2.00, w: 1.85, h: 0.12, fontFace: FONT, fontSize: 6.4, color: COLORS.muted, margin: 0 });

        addBarRanking(slide, pptx, 0.40, 2.30, 6.14, 2.25, "Slowest to repair - Avg MTTR by machine group", `Top 6 production groups | ${report.fyLabel} YTD to ${report.fyCutoffLabel} | lower is better`, report.mttrGroups, COLORS.red, mttrText);
        addBarRanking(slide, pptx, 6.68, 2.30, 6.25, 2.25, "Fails most often - Avg MTBF by machine group", `Bottom 6 production groups | ${report.fyLabel} YTD to ${report.fyCutoffLabel} | higher is better`, report.mtbfGroups, COLORS.teal, mtbfText);

        slide.addShape(pptx.ShapeType.rect, { x: 0.40, y: 4.68, w: 12.53, h: 0.30, fill: { color: COLORS.light }, line: { color: COLORS.light, transparency: 100 } });
        slide.addShape(pptx.ShapeType.rect, { x: 0.40, y: 4.68, w: 0.045, h: 0.30, fill: { color: COLORS.red }, line: { color: COLORS.red, transparency: 100 } });
        const worst = report.mttrGroups[0];
        const shortest = report.mtbfGroups[0];
        const oldest = report.oldestOpenS1;
        slide.addText(`WORST MTTR - ${worst ? `${shortText(worst.name, 22)} ${mttrText(worst.value)}, ${worst.count} repairs` : "No valid data"}`, { x: 0.57, y: 4.77, w: 3.65, h: 0.12, fontFace: FONT, fontSize: 7.2, bold: true, color: COLORS.black, margin: 0, fit: "shrink" });
        slide.addText(`SHORTEST MTBF - ${shortest ? `${shortText(shortest.name, 22)} ${mtbfText(shortest.value)}, ${shortest.count} gaps` : "No valid data"}`, { x: 4.45, y: 4.77, w: 3.65, h: 0.12, fontFace: FONT, fontSize: 7.2, bold: true, color: COLORS.black, margin: 0, fit: "shrink" });
        slide.addText(`OLDEST OPEN S1 - ${oldest ? `${oldest.id} ${shortText(oldest.asset, 24)}, open ${oldest.age}` : "No open S1"}`, { x: 8.34, y: 4.77, w: 4.35, h: 0.12, fontFace: FONT, fontSize: 7.2, bold: true, color: COLORS.black, margin: 0, fit: "shrink" });

        slide.addShape(pptx.ShapeType.rect, { x: 0.40, y: 5.09, w: 0.045, h: 0.20, fill: { color: COLORS.red }, line: { color: COLORS.red, transparency: 100 } });
        slide.addText(`Action list - S1/S2 corrective production MRs raised on ${report.actionDateLabel}`, { x: 0.54, y: 5.08, w: 8.4, h: 0.20, fontFace: HEAD_FONT, fontSize: 12, bold: true, color: COLORS.black, margin: 0, fit: "shrink" });
        slide.addText(`${numberText(report.actionTotal)} eligible | ${numberText(report.actionRows.length)} shown | specific assets first, newest next`, { x: 9.0, y: 5.12, w: 3.93, h: 0.14, fontFace: FONT, fontSize: 6.8, italic: true, color: COLORS.muted, align: "right", margin: 0, fit: "shrink" });
        addActionTable(slide, pptx, report);

        const footer = `SATS Food Solutions Thailand  |  Source: Downtime page, ${report.stageLabel}  |  ${report.scopeLabel}; action list is corrective S1/S2 production only  |  Generated ${report.generatedAt.toLocaleString("en-GB")}`;
        slide.addText(footer, { x: 0.40, y: 7.34, w: 12.53, h: 0.10, fontFace: FONT, fontSize: 5.7, italic: true, color: COLORS.muted, margin: 0, fit: "shrink" });
        if (typeof slide.addNotes === "function") {
            slide.addNotes(`[Sources]\n- Internal Downtime page all-year work-order source, filtered to ${report.stageLabel}.\n- Asset classification from the loaded Asset Master mapping.\n- SATS logo: ${LOGO_URL}.`);
        }

        const safeStage = report.stageLabel.replace(/\s+/g, "-");
        const safeScope = report.filters.scope === "production" ? "Production" : "All-Machines";
        const fileName = `Maintenance_Monthly_Report_${report.filters.month}_${safeStage}_${safeScope}.pptx`;
        if (download) await pptx.writeFile({ fileName });
        return { pptx, fileName };
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (state.busy) return;
        const filters = getDialogFilters();
        if (!parseMonthKey(filters.month) || !parseDayKey(filters.actionDate) || !filters.financialYear) {
            setStatus("Select a valid report month, financial year, and action-list cutoff date.", "error");
            return;
        }
        setBusy(true);
        setStatus(`Loading ${selectedStageLabel(filters.stage)} work-order history...`);
        try {
            const rows = await loadRows(filters.stage);
            setStatus(`Calculating monthly, ${getMrFinancialYearLabel(filters.financialYear)} YTD, and latest corrective S1/S2 production issues...`);
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
            const report = buildReportModel(rows, filters);
            setStatus("Building the one-slide PowerPoint report...");
            await generatePpt(report);
            setStatus(`Downloaded ${report.monthLabel} report with ${numberText(report.actionRows.length)} action-list rows.`);
            window.setTimeout(() => {
                setBusy(false);
                close();
            }, 900);
        } catch (error) {
            console.error("Monthly maintenance PPT export failed:", error);
            setStatus(error?.message || "The report could not be generated.", "error");
            setBusy(false);
        }
    }

    window.DowntimeMonthlyPpt = {
        open,
        close,
        clearCache,
        buildReportModel,
        generatePpt,
        loadRows,
        __test: {
            isProductionMachine,
            parseMonthKey,
            parseDayKey,
            aggregateMttrGroups,
            aggregateMtbfGroups,
            buildActionRows,
            isCorrectiveActionRow,
            isProductionAreaWorkOrder,
            workOrderStageLabel,
            getDialogFilters,
        },
    };
    wire();
})();
