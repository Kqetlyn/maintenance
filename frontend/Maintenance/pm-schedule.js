/*
 * Preventive Maintenance Schedule tab.
 * Clean management view: 8 KPI cards, a minimal month/week/day calendar, an
 * editable PM records table, and five focused analysis charts. Talks to
 * /api/maintenance/pm-schedule (read) and /api/maintenance/pm-schedule/update
 * (persist a single PM status override). Self-contained; coordinates with
 * script.js only through the shared tab buttons.
 *
 * Operational status (per task) comes from the backend `status` field:
 *   Scheduled · Done · Backlog · Deferred · Not Applicable · Cancelled.
 *   Completion is MANUAL only (no auto-done). "Overdue" is a dynamic display state
 *   (scheduled week passed while still Scheduled). Edits merge server-side from
 *   data/pm_schedule_updates.json.
 */
(function () {
    "use strict";

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const PM_VIEWS = new Set(["overview"]);

    // Financial year — April start (Apr–Mar), matching the rest of the dashboard
    // (Downtime MR_FINANCIAL_YEAR_START_MONTH = 4). A FY is labelled by its start
    // year: e.g. FY2025/26 = Apr 2025 → Mar 2026.
    const FY_START_MONTH = 4;
    const FY_MONTH_ORDER = Array.from({ length: 12 }, (_, i) => ((FY_START_MONTH - 1 + i) % 12) + 1); // [4..12,1..3]
    const FY_MONTH_LABELS = FY_MONTH_ORDER.map((m) => MONTHS[m - 1]);
    function fyStartYearOf(year, month) { return Number(month) >= FY_START_MONTH ? Number(year) : Number(year) - 1; }
    function fyIndexOf(month) { return (Number(month) - FY_START_MONTH + 12) % 12; }
    function fyLabel(startYear) {
        const y = Number(startYear);
        return Number.isFinite(y) ? `FY${y}/${String((y + 1) % 100).padStart(2, "0")}` : "Financial Year";
    }
    const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const PALETTE = ["#2563eb", "#0ea5e9", "#14b8a6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b", "#ec4899", "#84cc16"];
    const STAGE_COLORS = { "Stage 1": "#2563eb", "Stage 2": "#14b8a6", "Unmapped": "#94a3b8", "Needs Stage Review": "#f59e0b" };

    // Stored statuses the edit form can set (manual only — default is Pending).
    const OP_STATUSES = ["Pending", "Done", "Backlog", "Deferred", "Not Applicable", "Cancelled"];
    const STATUS_COLORS = {
        "Pending": "#2563eb", "Done": "#10b981", "Overdue": "#ef4444",
        "Backlog": "#f59e0b", "Deferred": "#8b5cf6", "Not Applicable": "#94a3b8", "Cancelled": "#64748b",
    };
    const STATUS_BREAKDOWN_ORDER = ["Pending", "Done", "Backlog", "Deferred", "Not Applicable", "Cancelled"];
    const API = "/api/maintenance/pm-schedule";
    const COMPLIANCE_TARGET = 90;

    const charts = {};
    const state = {
        view: "overview",
        payload: null,
        taskIndex: new Map(),
        queryStage: "Stage 2",
        queryScope: "all",
        queryYear: String(new Date().getFullYear()),
        queryMonth: String(new Date().getMonth() + 1),
        calendarMode: "month",
        calendarDate: null,
        selectedDate: null,
        taskSearch: "",
        taskMonth: "all",
        taskDateFrom: "",
        taskDateTo: "",
        doneSearch: "",
        monthFy: null,
        sortKey: "plannedDate",
        sortDir: 1,
        editTaskId: null,
        editTask: null,
        assets: [],
        assetsLoaded: false,
        loading: false,
    };

    if (window.Chart) {
        Chart.defaults.font.family = "Inter, system-ui, sans-serif";
        Chart.defaults.color = "#475569";
        Chart.defaults.plugins.legend.labels.boxWidth = 12;
    }

    document.addEventListener("DOMContentLoaded", init);

    function init() {
        bindTabButtons();
        bindCalendarControls();
        bindTaskFilters();
        bindEditModal();
        bindEditDelegation();
        bindPlannerModal();
        bindPageFilters();
        state.view = getActiveView();
        updateFilterVisibility();
        refresh().catch((err) => console.error("PM schedule load failed:", err));
        loadAssetCatalog();
    }

    // ── DOM helpers ──────────────────────────────────────────────────────────
    function el(id) { return document.getElementById(id); }
    function setText(id, value) { const n = el(id); if (n) n.textContent = value; }
    function getActiveView() {
        const active = document.querySelector(".maintenance-tab-toggle .toggle-btn.active");
        return (active && active.dataset.viewTab) || "overview";
    }
    function fmt(n) { return (n === null || n === undefined) ? "--" : Number(n).toLocaleString(); }
    function pct(v) { return (v === null || v === undefined) ? "N/A" : `${v}%`; }
    function round1(v) { return Math.round(v * 10) / 10; }
    function translatePmText(value) {
        const text = String(value ?? "").trim();
        if (!text) return "";

        const exactMap = {
            "เครื่อง UV": "UV Machine",
            "เครื่องซักผ้า 1": "Washing Machine 1",
            "เครื่องซักผ้า 2": "Washing Machine 2",
            "เครื่องอบผ้า 1": "Dryer 1",
            "เครื่องอบผ้า 2": "Dryer 2",
            "บนฝ้าเพดานอาคาร": "Ceiling Space",
            "อาคารบอยเลอร์": "Boiler Room",
            "ห้องปั๊มลม": "Air Compressor Room",
            "โรงบำบัดน้ำดี": "Water Treatment Plant",
            "โรงบำบัดน้ำเสีย": "Wastewater Treatment Plant",
        };
        if (exactMap[text]) return exactMap[text];

        let translated = text;
        const replacements = [
            ["ระบบเติมอากาศ", "Air Intake System"],
            ["ระบบดูดอากาศ", "Exhaust System"],
            ["ห้อง Cooking", "Cooking Room"],
            ["ห้องล้างฝั่งดิบ", "Raw Wash Area"],
            ["ฝั่งดิบ", "Raw Side"],
            ["อาคาร", "Building "],
            ["ห้อง", "Room "],
        ];
        replacements.forEach(([source, replacement]) => {
            translated = translated.replaceAll(source, replacement);
        });
        return /[\u0E00-\u0E7F]/.test(translated) ? text : translated;
    }
    function displayText(value) {
        return translatePmText(value);
    }
    function formatTimestamp(value) {
        if (!value) return "--";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        return parsed.toLocaleString([], {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        });
    }

    // ── Filters ──────────────────────────────────────────────────────────────
    function bindTabButtons() {
        document.querySelectorAll("[data-view-tab]").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.view = btn.dataset.viewTab || "overview";
                updateFilterVisibility();
                if (PM_VIEWS.has(state.view)) renderPmSchedule();
            });
        });
    }

    function bindCalendarControls() {
        document.querySelectorAll("[data-pm-calendar-mode]").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.calendarMode = btn.dataset.pmCalendarMode || "month";
                document.querySelectorAll("[data-pm-calendar-mode]").forEach((b) => b.classList.toggle("active", b === btn));
                renderCalendar();
            });
        });
        el("pm-calendar-prev")?.addEventListener("click", () => { shiftCalendar(-1); renderCalendar(); });
        el("pm-calendar-next")?.addEventListener("click", () => { shiftCalendar(1); renderCalendar(); });
    }

    function bindTaskFilters() {
        el("pm-task-search")?.addEventListener("input", debounce((event) => {
            state.taskSearch = event.target.value.trim();
            renderTaskList();
        }, 180));
        el("pm-task-month")?.addEventListener("change", (event) => { state.taskMonth = event.target.value || "all"; renderTaskList(); });
        el("pm-task-date-from")?.addEventListener("change", (event) => { state.taskDateFrom = event.target.value || ""; renderTaskList(); });
        el("pm-task-date-to")?.addEventListener("change", (event) => { state.taskDateTo = event.target.value || ""; renderTaskList(); });
        el("pm-done-search")?.addEventListener("input", debounce((event) => {
            state.doneSearch = event.target.value.trim();
            renderDoneList();
        }, 180));
        el("pm-month-fy")?.addEventListener("change", (event) => {
            state.monthFy = event.target.value;
            renderMonthChart();
        });
    }

    function populateTaskFilters() {
        const monthSel = el("pm-task-month");
        if (monthSel && !monthSel.options.length) {
            monthSel.innerHTML = [`<option value="all">All Months</option>`]
                .concat(MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`)).join("");
            monthSel.value = state.taskMonth;
        }
    }

    function updateFilterVisibility() {
        return;
    }

    // On-page Stage (Both/Stage 1/Stage 2) + Scope (Both/Production Equipment/Utilities)
    // segmented controls — mirror the underlying global selects.
    function bindPageFilters() {
        document.querySelectorAll("[data-pm-stage]").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.queryStage = btn.dataset.pmStage || "all";
                syncPageFilters();
                refresh().catch((e) => console.error(e));
            });
        });
        document.querySelectorAll("[data-pm-scope]").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.queryScope = btn.dataset.pmScope || "all";
                syncPageFilters();
                renderPmSchedule();
            });
        });
    }

    function syncPageFilters() {
        const stage = state.queryStage || "all";
        const scope = state.queryScope || "all";
        document.querySelectorAll("[data-pm-stage]").forEach((b) => b.classList.toggle("active", b.dataset.pmStage === stage));
        document.querySelectorAll("[data-pm-scope]").forEach((b) => b.classList.toggle("active", b.dataset.pmScope === scope));
    }

    function currentParams() {
        const p = new URLSearchParams();
        p.set("stage", state.queryStage || "all");
        const year = state.queryYear || "";
        const month = state.queryMonth || "";
        if (year) p.set("year", year);
        if (month) p.set("month", month);
        return p;
    }

    // ── Fetch + orchestrate ──────────────────────────────────────────────────
    async function refresh() {
        if (state.loading) return;
        state.loading = true;
        try {
            const res = await fetch(`${API}?${currentParams().toString()}`, { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const payload = await res.json();
            state.payload = payload;
            state.taskIndex = new Map(allScheduleTasks().map((t) => [t.pmTaskId, t]));
            syncYearSelect(payload.meta);
            populateTaskFilters(payload.meta);
            syncCalendarDate(payload.meta);
            hydratePmFilterOptions();
            renderPmSchedule();
        } finally {
            state.loading = false;
        }
    }

    // ── MIRA Alert Context ────────────────────────────────────────────────────
    // Reads alert context from sessionStorage (set by MIRA Overview action buttons)
    // and from mira:alert:navigate events dispatched in the same page.

    const ALERT_CTX_KEY = "mira_alert_ctx";

    function applyPmAlertContext(ctx) {
        if (!ctx || ctx.page !== "pm_schedule") return;
        showPmAlertBanner(ctx.alertDescription || "Showing records related to a Daily Action Alert.");
        const focus = ctx.focus || ctx.navFocus;
        if (focus === "task_list") {
            const taskSection = document.getElementById("pm-task-list-section");
            if (taskSection) {
                window.setTimeout(() => taskSection.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
            }
            if (ctx.statusFilter === "Overdue") {
                // Filter the task list to show only overdue items by applying a search term
                // that the task list filters on opStatus (displayStatus).
                state.taskSearch = "Overdue";
                const searchEl = el("pm-task-search");
                if (searchEl) searchEl.value = "Overdue";
                if (ctx.sortKey === "plannedDate") {
                    state.sortKey = "plannedDate";
                    state.sortDir = ctx.sortDir || 1;
                }
                renderTaskList();
            }
        } else if (focus === "pm_calendar") {
            const calSection = document.getElementById("pm-calendar-section");
            if (calSection) {
                window.setTimeout(() => calSection.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
            }
        }
    }

    function showPmAlertBanner(message) {
        let banner = document.getElementById("mira-alert-pm-banner");
        if (!banner) {
            banner = document.createElement("div");
            banner.id = "mira-alert-pm-banner";
            banner.className = "mira-alert-ctx-banner";
            banner.setAttribute("role", "status");
            const taskSection = document.getElementById("pm-task-list-section");
            const parent = taskSection ? taskSection.parentNode : document.getElementById("pm-overview");
            if (parent && taskSection) parent.insertBefore(banner, taskSection);
            else if (parent) parent.prepend(banner);
        }
        banner.innerHTML =
            `<span class="mira-alert-ctx-icon">&#9432;</span>` +
            `<span class="mira-alert-ctx-text">Showing records related to Daily Action Alert: ${message.replace(/</g,"&lt;")}</span>` +
            `<button type="button" class="mira-alert-ctx-clear">Clear alert filter</button>`;
        banner.classList.remove("hidden");
        banner.querySelector(".mira-alert-ctx-clear").addEventListener("click", () => {
            banner.classList.add("hidden");
            try { sessionStorage.removeItem(ALERT_CTX_KEY); } catch (_) {}
            state.taskSearch = "";
            const searchEl = el("pm-task-search");
            if (searchEl) searchEl.value = "";
            renderTaskList();
        });
    }

    // Apply on initial load if context was set before the page loaded.
    document.addEventListener("DOMContentLoaded", () => {
        window.setTimeout(() => {
            try {
                const ctx = JSON.parse(sessionStorage.getItem(ALERT_CTX_KEY) || "null");
                applyPmAlertContext(ctx);
            } catch (_) {}
        }, 600);
    });

    // Apply when the MIRA Overview dispatches a same-page navigation event.
    document.addEventListener("mira:alert:navigate", (event) => {
        if (!event.detail || event.detail.target !== "pm") return;
        try {
            const ctx = JSON.parse(sessionStorage.getItem(ALERT_CTX_KEY) || "null");
            applyPmAlertContext(ctx);
        } catch (_) {}
    });

    function syncYearSelect(meta) {
        if (!meta) return;
        state.queryYear = String(meta.year || state.queryYear || new Date().getFullYear());
        state.queryMonth = String(meta.month || state.queryMonth || (new Date().getMonth() + 1));
    }

    function stageLabel(meta) {
        if (!meta) return "Both Stages";
        return meta.stageFilter === "all" ? "Both Stages" : meta.stageFilter;
    }

    function scopeLabel() {
        const scope = String(state.queryScope || "all").toLowerCase();
        if (scope === "equipment") return "Production Equipment";
        if (scope === "utility") return "Utilities";
        return "Production Equipment + Utilities";
    }

    function syncCalendarDate(meta) {
        if (!meta) return;
        const current = parseDate(state.calendarDate);
        const year = Number(meta.year);
        const month = Number(meta.month);
        if (!current || current.getFullYear() !== year || current.getMonth() !== month - 1) {
            state.calendarDate = isoDate(new Date(year, month - 1, 1));
            state.selectedDate = state.calendarDate;
        }
    }

    function hydratePmFilterOptions() {
        return;
    }

    function fillSelect(id, values, allLabel = "All") {
        const node = el(id);
        if (!node) return;
        const previous = node.value || "all";
        node.innerHTML = [`<option value="all">${esc(allLabel)}</option>`]
            .concat(values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`)).join("");
        node.value = values.includes(previous) ? previous : "all";
    }

    function unique(rows, key) {
        return [...new Set(rows.map((r) => String(r[key] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    }

    function allScheduleTasks() {
        const tasks = state.payload?.schedule?.tasks;
        return Array.isArray(tasks) ? tasks : [];
    }

    function sourceOriginLabel(task) {
        if (!task) return "Imported";
        if (task.source === "Manual") return "Manual Planner";
        const base = task.sourceLabel || task.sourceFile || task.source || "Imported";
        return task.source === "Edited Imported" ? `${base} · Edited` : base;
    }

    function sourceStateKey(task) {
        if (task?.source === "Manual") return "manual";
        if (task?.source === "Edited Imported") return "edited";
        return "imported";
    }

    function displaySourceLabel(task) {
        if (!task) return "Imported";
        if (task.source === "Manual") return "Manual Planner";
        const base = task.sourceLabel || task.sourceFile || task.source || "Imported";
        return task.source === "Edited Imported" ? `${base} - Edited` : base;
    }

    function taskCategory(task) {
        return task.scope === "equipment" ? "Production Equipment" : "Utilities";
    }

    function selectedFilters() {
        return {
            scope: String(state.queryScope || "all").toLowerCase(),
            system: "all",
            assetGroup: "all",
            status: "all",
        };
    }

    function getFilteredTasks({ period = "month" } = {}) {
        const meta = state.payload?.meta || {};
        const filters = selectedFilters();
        const year = Number(meta.year);
        const month = Number(meta.month);
        return allScheduleTasks().filter((task) => {
            if (period !== "all" && task.plannedYear && Number(task.plannedYear) !== year) return false;
            if (period === "month" && task.plannedMonth && Number(task.plannedMonth) !== month) return false;
            if (filters.scope !== "all" && String(task.scope || "").toLowerCase() !== filters.scope) return false;
            if (filters.system !== "all" && task.systemArea !== filters.system) return false;
            if (filters.assetGroup !== "all" && task.mainAssetGroup !== filters.assetGroup) return false;
            if (filters.status !== "all") {
                if (filters.status === "Overdue") { if (!isOverdueOp(task)) return false; }
                else if (opStatus(task) !== filters.status) return false;
            }
            return true;
        });
    }

    // ── Operational status helpers ───────────────────────────────────────────
    // Stored status (manual only). "Overdue" is a dynamic DISPLAY state from the backend.
    const LEGACY_PM_STATUS_MAP = {
        "scheduled": "Pending",
        "auto done / pending verification": "Pending",
        "auto done": "Pending",
        "not done / backlog": "Backlog",
    };
    function normalizedPmStatus(value) {
        const text = String(value || "").trim();
        if (!text) return "Pending";
        return LEGACY_PM_STATUS_MAP[text.toLowerCase()] || text;
    }
    function storedStatus(task) { return normalizedPmStatus(task.status); }
    function opStatus(task) { return normalizedPmStatus(task.displayStatus || task.status || "Pending"); }   // for display + filtering
    function isDoneStatus(s) { return s === "Done"; }                                       // completion is manual only
    function isDone(task) { return Boolean(task.isDone); }
    function isOverdueOp(task) { return Boolean(task.isOverdueOp); }
    function isBacklogTask(task) { return storedStatus(task) === "Backlog"; }
    function isDeferredTask(task) { return storedStatus(task) === "Deferred"; }
    function statusBucket(task) {
        if (isDone(task)) return "done";
        if (isOverdueOp(task)) return "overdue";
        if (isBacklogTask(task)) return "backlog";
        const s = storedStatus(task);
        if (s === "Deferred") return "deferred";
        if (s === "Not Applicable" || s === "Cancelled") return "na";
        return "scheduled";
    }
    function opBadgeClass(status) {
        if (status === "Done") return "pm-badge-green";
        if (status === "Overdue") return "pm-badge-red";
        if (status === "Backlog") return "pm-badge-amber";
        if (status === "Deferred") return "pm-badge-purple";
        if (status === "Not Applicable" || status === "Cancelled") return "pm-badge-slate";
        return "pm-badge-blue";
    }
    function shortStatus(status) { return normalizedPmStatus(status); }

    // ── Date helpers ─────────────────────────────────────────────────────────
    function parseDate(value) {
        if (!value) return null;
        const parts = String(value).slice(0, 10).split("-").map(Number);
        if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    function isoDate(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
    function addDays(date, days) { const n = new Date(date); n.setDate(n.getDate() + days); return n; }
    function addMonths(date, months) { return new Date(date.getFullYear(), date.getMonth() + months, 1); }
    function startOfWeek(date) { return addDays(date, -((date.getDay() + 6) % 7)); }
    function dateLabel(value, options = {}) {
        const date = parseDate(value);
        if (!date) return "--";
        return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", ...options });
    }
    function isoWeek(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = (d.getUTCDay() + 6) % 7;
        d.setUTCDate(d.getUTCDate() - dayNum + 3);
        const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
        return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    }
    // Scheduled date shown as a general week reference, without the year (e.g. "29 Dec · W1").
    function scheduledWeekLabel(value) {
        const d = parseDate(value);
        if (!d) return "—";
        return `${d.getDate()} ${MONTHS[d.getMonth()]} · W${isoWeek(d)}`;
    }
    function debounce(fn, wait = 180) {
        let timer = null;
        return (...args) => { window.clearTimeout(timer); timer = window.setTimeout(() => fn(...args), wait); };
    }

    function countBy(rows, keyFn) {
        const counts = {};
        rows.forEach((row) => { const key = keyFn(row) || "Unassigned"; counts[key] = (counts[key] || 0) + 1; });
        return counts;
    }
    function chartFromCounts(counts, order = null, top = null) {
        let items = Object.entries(counts);
        if (order) items = order.map((k) => [k, counts[k] || 0]).filter(([, v]) => v);
        else items.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        if (top) items = items.slice(0, top);
        return { labels: items.map(([l]) => l), data: items.map(([, v]) => v) };
    }

    // ── Charts ───────────────────────────────────────────────────────────────
    function makeChart(canvasId, config) {
        const ctx = el(canvasId);
        if (!ctx || !window.Chart) return;
        if (charts[canvasId]) charts[canvasId].destroy();
        charts[canvasId] = new Chart(ctx, config);
    }
    function barConfig(chart, { horizontal = false, color = "#2563eb" } = {}) {
        return {
            type: "bar",
            data: { labels: chart.labels, datasets: [{ data: chart.data, backgroundColor: color, borderRadius: 4, maxBarThickness: 30 }] },
            options: {
                indexAxis: horizontal ? "y" : "x", responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { grid: { display: !horizontal, color: "#eef2f7" }, ticks: { autoSkip: false } }, y: { grid: { color: "#eef2f7" }, beginAtZero: true } },
            },
        };
    }
    function doughnutConfig(chart, colorMap) {
        const colors = chart.labels.map((l, i) => (colorMap && colorMap[l]) || STAGE_COLORS[l] || PALETTE[i % PALETTE.length]);
        return {
            type: "doughnut",
            data: { labels: chart.labels.map(shortStatus), datasets: [{ data: chart.data, backgroundColor: colors, borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom" } } },
        };
    }
    function emptyOr(chart) { return chart && chart.labels && chart.labels.length ? chart : { labels: ["No data"], data: [0] }; }

    function renderPmSchedule() {
        if (!state.payload) return;
        hydratePmFilterOptions();
        renderOverview();
        renderCalendar();
        renderTaskList();
        renderDoneList();
        renderAnalysisCharts();
    }

    function renderSourceSummary() {
        return;
        const grid = el("pm-source-grid");
        const flags = el("pm-source-flags");
        if (!grid || !flags) return;

        const meta = state.payload?.meta || {};
        const sources = visibleSources();
        if (!sources.length) {
            flags.innerHTML = "";
            grid.innerHTML = `<div class="empty-state-block">No PM source files are configured for this stage.</div>`;
            return;
        }

        const activeCount = sources.filter((source) => source.available && source.active).length;
        const missingCount = sources.filter((source) => !source.available).length;
        const stagedCount = sources.filter((source) => source.available && !source.active).length;
        const trackedCount = sources.reduce((sum, source) => sum + Number(source.tracked_task_count || 0), 0);

        const flagItems = [
            {
                cls: "pm-source-flag-info",
                title: `${fmt(activeCount)} Active Source${activeCount === 1 ? "" : "s"}`,
                body: `${stageLabel(meta)} PM schedule files currently included in tracking.`,
            },
            {
                cls: missingCount ? "pm-source-flag-warning" : "pm-source-flag-info",
                title: `${fmt(trackedCount)} Imported PM Task${trackedCount === 1 ? "" : "s"}`,
                body: stagedCount
                    ? `${fmt(stagedCount)} source file staged outside the active PM view.`
                    : missingCount
                    ? `${fmt(missingCount)} source file missing and not contributing tasks.`
                    : "All visible source files are active for the selected stage filter.",
            },
            {
                cls: "pm-source-flag-info",
                title: "Latest Source Update",
                body: meta.sourceSummary?.latestSourceUpdate ? formatTimestamp(meta.sourceSummary.latestSourceUpdate) : "--",
            },
        ];

        flags.innerHTML = flagItems.map((item) => `
            <div class="pm-source-flag ${item.cls}">
                <strong>${esc(item.title)}</strong>
                <span>${esc(item.body)}</span>
            </div>
        `).join("");

        grid.innerHTML = sources.map((source) => {
            const badgeClass = !source.available ? "missing" : source.active ? (source.path_mode === "fallback" ? "fallback" : "active") : "staged";
            const badgeText = !source.available ? "Missing" : source.active ? (source.path_mode === "fallback" ? "Active Fallback" : "Active") : "Staged";
            const scopeLabel = source.scope === "equipment" ? "Production equipment PM source" : "Utility PM source";
            return `
                <article class="pm-source-card">
                    <div class="pm-source-head">
                        <div class="pm-source-title">
                            <strong>${esc(source.label)}</strong>
                            <span>${esc(`${source.default_stage} · ${scopeLabel}`)}</span>
                        </div>
                        <span class="pm-source-badge ${badgeClass}">${esc(badgeText)}</span>
                    </div>
                    <div class="pm-source-meta">
                        <div>
                            <span class="pm-source-meta-label">Workbook</span>
                            <span class="pm-source-meta-value">${source.file_name ? `<code>${esc(source.file_name)}</code>` : "—"}</span>
                        </div>
                        <div>
                            <span class="pm-source-meta-label">Tracked Tasks</span>
                            <span class="pm-source-meta-value">${fmt(source.tracked_task_count || 0)} tasks for ${esc(String(meta.year || ""))}</span>
                        </div>
                        <div>
                            <span class="pm-source-meta-label">Detected Path</span>
                            <span class="pm-source-meta-value">${source.path_label ? `<code>${esc(source.path_label)}</code>` : "—"}</span>
                        </div>
                        <div>
                            <span class="pm-source-meta-label">Template</span>
                            <span class="pm-source-meta-value">${esc(source.template_label || "PM schedule workbook")}</span>
                        </div>
                    </div>
                    <p class="pm-source-note">${esc(source.message || source.description || "")}</p>
                </article>
            `;
        }).join("");
    }

    // ── KPI cards (management) ───────────────────────────────────────────────
    function renderOverview() {
        syncPageFilters();
        const meta = state.payload?.meta || {};
        const monthTasks = getFilteredTasks({ period: "month" });
        const yearTasks = getFilteredTasks({ period: "year" });

        const selYear = Number(meta.year);
        const selMonth = Number(meta.month);
        const completionInMonth = (t) => {
            const d = parseDate(t.completionDate);
            return d && d.getFullYear() === selYear && (d.getMonth() + 1) === selMonth;
        };

        const scheduled = monthTasks.length;                                   // scheduled in selected month
        const completed = yearTasks.filter((t) => isDone(t) && completionInMonth(t)).length;  // manually Done, completed this month
        const onTime = monthTasks.filter((t) => t.isOnTimeCompleted).length;   // Done within scheduled week
        const overdue = monthTasks.filter(isOverdueOp).length;
        const backlog = monthTasks.filter(isBacklogTask).length;
        const deferred = monthTasks.filter(isDeferredTask).length;
        const late = monthTasks.filter((t) => t.isLateCompleted).length;

        const weekStart = startOfWeek(new Date());
        const weekEnd = addDays(weekStart, 6);
        const dueWeek = yearTasks.filter((t) => { const d = parseDate(t.plannedDate); return d && d >= weekStart && d <= weekEnd && storedStatus(t) === "Pending"; }).length;

        setText("pm-ov-context", `${stageLabel(meta)} · ${scopeLabel()} · ${meta.monthLabel} ${meta.year} · ${fmt(yearTasks.length)} PM tasks in view · completion is manual only`);
        setText("pm-ov-sched-month", fmt(scheduled));
        setText("pm-ov-sched-month-sub", `${meta.monthLabel} ${meta.year}`);
        setText("pm-ov-completed-month", fmt(completed));
        setText("pm-ov-compliance", scheduled ? pct(round1((onTime / scheduled) * 100)) : "N/A");
        setText("pm-ov-overdue", fmt(overdue));
        setText("pm-ov-backlog", fmt(backlog));
        setText("pm-ov-deferred", fmt(deferred));
        setText("pm-ov-due-week", fmt(dueWeek));

        setText("pm-ov-late", fmt(late));
    }

    function isReviewTask(task) {
        return ["Needs Review", "Missing Asset Mapping", "Missing Schedule Date"].includes(task.scheduleStatus)
            || ["Missing Asset ID", "Unmapped"].includes(task.mappingStatus) || !task.plannedDate;
    }
    function dataQualityFor(rows) {
        const seen = new Set();
        let duplicates = 0;
        rows.forEach((task) => {
            const key = `${String(task.assetId || "").toUpperCase()}|${task.plannedDate || ""}|${task.pmDescription || ""}`;
            if (seen.has(key)) duplicates += 1; else seen.add(key);
        });
        return {
            missingAssetId: rows.filter((t) => !t.assetId).length,
            unmappedAssetId: rows.filter((t) => t.mappingStatus === "Unmapped").length,
            missingPlanned: rows.filter((t) => !t.plannedDate).length,
            missingFrequency: rows.filter((t) => !t.frequency).length,
            missingGroup: rows.filter((t) => ["", "Unmapped", "Unknown / Review"].includes(t.mainAssetGroup || "")).length,
            missingStage: rows.filter((t) => !["Stage 1", "Stage 2"].includes(t.stage)).length,
            duplicates,
            needsReview: rows.filter(isReviewTask).length,
        };
    }
    function renderDqChips(counts) {
        const wrap = el("pm-ov-dq-chips");
        if (!wrap) return;
        const items = [
            ["Missing Asset ID", counts.missingAssetId], ["Unmapped Asset ID", counts.unmappedAssetId],
            ["Missing Planned Date", counts.missingPlanned], ["Missing Frequency", counts.missingFrequency],
            ["Missing Group", counts.missingGroup], ["Missing Stage", counts.missingStage],
            ["Duplicate Rows", counts.duplicates], ["Needs Review", counts.needsReview],
        ];
        wrap.innerHTML = items.map(([label, value]) =>
            `<span class="pm-chip ${value > 0 ? "pm-chip-flag" : "pm-chip-ok"}"><span class="pm-chip-val">${fmt(value)}</span>${label}</span>`).join("");
    }
    function renderDqTable(rows) {
        const body = el("pm-ov-dq-body");
        setText("pm-ov-dq-count", String(rows ? rows.length : 0));
        if (!body) return;
        if (!rows || !rows.length) {
            body.innerHTML = `<tr><td colspan="7" class="empty-row">No data quality issues for this filter.</td></tr>`;
            return;
        }
        body.innerHTML = rows.slice(0, 200).map((t) => `
            <tr>
                <td>${badge(t.stage, stageBadgeClass(t.stage))}</td>
                <td>${esc(t.assetId) || "—"}</td>
                <td>${esc(displayText(t.assetName))}</td>
                <td>${esc(displayText(t.mainAssetGroup))}</td>
                <td>${esc(t.plannedMonthLabel)} ${t.plannedYear || ""}</td>
                <td>${badge(shortStatus(opStatus(t)), opBadgeClass(opStatus(t)))}</td>
                <td>${esc(t.mappingStatus)}</td>
            </tr>`).join("");
    }

    // ── Calendar ─────────────────────────────────────────────────────────────
    function shiftCalendar(direction) {
        const current = parseDate(state.calendarDate) || new Date();
        if (state.calendarMode === "month") state.calendarDate = isoDate(addMonths(current, direction));
        else if (state.calendarMode === "week") state.calendarDate = isoDate(addDays(current, direction * 7));
        else state.calendarDate = isoDate(addDays(current, direction));
        state.selectedDate = state.calendarDate;
    }

    function renderCalendar() {
        const tasks = getFilteredTasks({ period: "year" });
        const anchor = parseDate(state.calendarDate) || new Date();
        const dates = calendarDates(anchor);
        const dateTasks = groupTasksByDate(tasks);
        const selected = state.selectedDate || isoDate(anchor);

        setText("pm-calendar-title", calendarTitle(anchor, dates));

        const weekdays = el("pm-calendar-weekdays");
        if (weekdays) {
            weekdays.className = `pm-calendar-weekdays pm-calendar-weekdays-${state.calendarMode}`;
            weekdays.innerHTML = (state.calendarMode === "day" ? [anchor.toLocaleDateString([], { weekday: "long" })] : WEEKDAYS)
                .map((label) => `<span>${esc(label)}</span>`).join("");
        }

        const grid = el("pm-calendar-grid");
        if (grid) {
            grid.className = `pm-calendar-grid pm-calendar-mode-${state.calendarMode}`;
            grid.innerHTML = dates.map((date) => {
                const key = isoDate(date);
                const rows = dateTasks[key] || [];
                const outside = state.calendarMode === "month" && date.getMonth() !== anchor.getMonth();
                return calendarDayCell(date, key, rows, outside, key === selected);
            }).join("");
            grid.querySelectorAll("[data-pm-date]").forEach((button) => {
                button.addEventListener("click", () => { state.selectedDate = button.dataset.pmDate; renderCalendar(); });
            });
        }
        renderCalendarDetail(selected, dateTasks[selected] || []);
    }

    function calendarDayCell(date, key, rows, outside, isSelected) {
        const classes = ["pm-calendar-day"];
        if (outside) classes.push("outside");
        if (isSelected) classes.push("selected");
        if (!rows.length) classes.push("pm-day-empty");

        if (!rows.length) {
            return `<button type="button" class="${classes.join(" ")}" data-pm-date="${key}">
                <span class="pm-calendar-day-num">${date.getDate()}</span>
            </button>`;
        }

        const doneCount = rows.filter(isDone).length;
        const overdueCount = rows.filter(isOverdueOp).length;
        const backlogCount = rows.filter(isBacklogTask).length;
        // Only render badges with a value > 0 — no zero flags.
        const badges = [];
        if (doneCount) badges.push(`<span class="pm-cal-badge green" title="Done">${doneCount} Done</span>`);
        if (overdueCount) badges.push(`<span class="pm-cal-badge red" title="Overdue">${overdueCount} Overdue</span>`);
        if (backlogCount) badges.push(`<span class="pm-cal-badge amber" title="Backlog">${backlogCount} Backlog</span>`);
        if (overdueCount) classes.push("pm-day-overdue");

        return `<button type="button" class="${classes.join(" ")}" data-pm-date="${key}">
            <span class="pm-calendar-day-num">${date.getDate()}</span>
            <strong class="pm-cal-total">${rows.length} PM</strong>
            <span class="pm-cal-badges">${badges.join("")}</span>
        </button>`;
    }

    function calendarDates(anchor) {
        if (state.calendarMode === "day") return [anchor];
        if (state.calendarMode === "week") {
            const start = startOfWeek(anchor);
            return Array.from({ length: 7 }, (_, i) => addDays(start, i));
        }
        const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        const start = startOfWeek(first);
        return Array.from({ length: 42 }, (_, i) => addDays(start, i));
    }
    function calendarTitle(anchor, dates) {
        if (state.calendarMode === "month") return anchor.toLocaleDateString([], { month: "long", year: "numeric" });
        if (state.calendarMode === "week") {
            return `${dates[0].toLocaleDateString([], { month: "short", day: "numeric" })} - ${dates[6].toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
        }
        return dateLabel(isoDate(anchor), { weekday: "long" });
    }
    function groupTasksByDate(rows) {
        return rows.reduce((acc, task) => {
            if (!task.plannedDate) return acc;
            (acc[task.plannedDate] ||= []).push(task);
            return acc;
        }, {});
    }

    function renderCalendarDetail(date, rows) {
        setText("pm-calendar-detail-title", dateLabel(date));
        const done = rows.filter(isDone).length;
        setText("pm-calendar-detail-subtitle", rows.length ? `${fmt(rows.length)} PM task${rows.length === 1 ? "" : "s"} · ${done} done` : "No PM tasks scheduled");
        const list = el("pm-calendar-detail-list");
        if (!list) return;
        const addBtn = `<button type="button" class="pm-btn-add-here" data-pm-add="${esc(date)}">+ Add PM on this date</button>`;
        if (!rows.length) {
            list.innerHTML = `<div class="empty-state-block">No PM tasks scheduled for this date.</div>${addBtn}`;
            return;
        }
        list.innerHTML = rows.map((task) => {
            const status = opStatus(task);
            const isManual = task.source === "Manual";
            return `
            <article class="pm-cal-task pm-task-${statusBucket(task)}">
                <div class="pm-cal-task-top">
                    <strong>${esc(task.assetId || "--")}</strong>
                    <span class="pm-cal-task-badges">${badge(shortStatus(status), opBadgeClass(status))}</span>
                </div>
                <div class="pm-cal-task-name">${esc(displayText(task.assetName || "--"))}</div>
                <dl class="pm-cal-task-meta">
                    <div><dt>Scope</dt><dd>${esc(taskCategory(task))}</dd></div>
                    <div><dt>System / Area</dt><dd>${esc(displayText(task.systemArea || "Unassigned"))}</dd></div>
                    <div><dt>Stage</dt><dd>${esc(task.stage)}</dd></div>
                    <div><dt>Scheduled</dt><dd>${dateLabel(task.plannedDate)}</dd></div>
                    <div><dt>Completion</dt><dd>${task.completionDate ? dateLabel(task.completionDate) : "—"}</dd></div>
                </dl>
                ${task.remarks ? `<p class="pm-cal-task-remarks">${esc(displayText(task.remarks))}</p>` : ""}
                <div class="pm-cal-task-actions">
                    <button type="button" class="pm-btn-edit pm-btn-edit-sm" data-pm-edit="${esc(task.pmTaskId)}">Edit</button>
                    <button type="button" class="pm-chip-action" data-pm-quick="Done" data-pm-task="${esc(task.pmTaskId)}">Mark Done</button>
                    <button type="button" class="pm-chip-action" data-pm-quick="Backlog" data-pm-task="${esc(task.pmTaskId)}">Backlog</button>
                    <button type="button" class="pm-chip-action" data-pm-quick="Deferred" data-pm-task="${esc(task.pmTaskId)}">Defer</button>
                    ${isManual ? `<button type="button" class="pm-chip-action pm-chip-danger" data-pm-delete="${esc(task.pmTaskId)}">Delete</button>` : ""}
                </div>
            </article>`;
        }).join("") + addBtn;
    }

    function sourceBadge(task) {
        const map = { manual: "pm-src-manual", edited: "pm-src-edited", imported: "pm-src-imported" };
        const label = displaySourceLabel(task);
        return `<span class="pm-src-badge ${map[sourceStateKey(task)] || "pm-src-imported"}">${esc(label)}</span>`;
    }

    // ── Editable task table ──────────────────────────────────────────────────
    const TABLE_COLS = [
        ["plannedDate", "Scheduled (Week)", true],
        ["pmCategory", "Scope", false],
        ["assetId", "Asset ID", false],
        ["assetName", "Asset Name", true],
        ["systemArea", "System / Area", true],
        ["stage", "Stage", false],
        ["status", "Status", true],
        ["completionDate", "Completion", false],
        ["contractorOrPIC", "PIC / Technician", false],
        ["remarksReason", "Remarks / Reason", false],
        ["lastUpdated", "Last Updated", false],
        ["action", "Action", false],
    ];

    function renderTaskList() {
        // The list shows the whole selected year by default; Month narrows it client-side.
        let rows = getFilteredTasks({ period: "all" });
        if (state.taskMonth && state.taskMonth !== "all") {
            rows = rows.filter((t) => Number(t.plannedMonth) === Number(state.taskMonth));
        }
        if (state.taskDateFrom) rows = rows.filter((t) => (t.plannedDate || "") >= state.taskDateFrom);
        if (state.taskDateTo) rows = rows.filter((t) => (t.plannedDate || "") <= state.taskDateTo);
        if (state.taskSearch) {
            const needle = state.taskSearch.toLowerCase();
            rows = rows.filter((t) => [taskCategory(t), t.assetId, t.assetName, t.systemArea, t.mainAssetGroup, t.stage, opStatus(t), statusBucket(t)]
                .join(" ").toLowerCase().includes(needle));
        }
        rows = sortRows(rows);
        setText("pm-task-count", fmt(rows.length));

        const head = el("pm-task-table-head");
        if (head) {
            head.innerHTML = `<tr>${TABLE_COLS.map(([key, label, sortable]) => {
                const arrow = state.sortKey === key ? (state.sortDir === 1 ? " ▲" : " ▼") : "";
                return `<th${sortable ? ` class="pm-sortable" data-sort="${key}"` : ""}>${esc(label)}${arrow}</th>`;
            }).join("")}</tr>`;
            head.querySelectorAll("[data-sort]").forEach((th) => th.addEventListener("click", () => {
                const key = th.dataset.sort;
                if (state.sortKey === key) state.sortDir *= -1; else { state.sortKey = key; state.sortDir = 1; }
                renderTaskList();
            }));
        }

        const body = el("pm-task-table-body");
        if (!body) return;
        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="${TABLE_COLS.length}" class="empty-row">No PM tasks match the current filters.</td></tr>`;
            return;
        }
        body.innerHTML = rows.slice(0, 1000).map((task) => {
            const rowClass = isOverdueOp(task) ? "pm-row-overdue" : (isBacklogTask(task) ? "pm-row-backlog" : "");
            return `<tr class="${rowClass}">${TABLE_COLS.map(([key]) => taskCell(key, task)).join("")}</tr>`;
        }).join("");
    }

    function sortRows(rows) {
        const key = state.sortKey;
        const dir = state.sortDir;
        const val = (t) => {
            if (key === "status") return opStatus(t);
            if (key === "scheduledWeek" || key === "plannedDate") return t.plannedDate || "9999-99-99";
            return String(t[key] || "").toLowerCase();
        };
        return [...rows].sort((a, b) => { const av = val(a), bv = val(b); return av < bv ? -dir : av > bv ? dir : 0; });
    }

    function taskCell(key, task) {
        if (key === "pmCategory") return `<td>${esc(taskCategory(task))}</td>`;
        if (key === "stage") return `<td>${badge(task.stage, stageBadgeClass(task.stage))}</td>`;
        if (key === "status") return `<td>${badge(opStatus(task), opBadgeClass(opStatus(task)))}</td>`;
        if (key === "plannedDate") return `<td>${scheduledWeekLabel(task.plannedDate)}</td>`;
        if (key === "completionDate") return `<td>${task.completionDate ? dateLabel(task.completionDate) : "—"}</td>`;
        if (key === "remarksReason") return `<td>${esc(displayText(task.remarks || task.reason)) || "—"}</td>`;
        if (key === "lastUpdated") return `<td>${task.lastUpdated ? formatTimestamp(task.lastUpdated) : "—"}</td>`;
        if (key === "action") {
            const isManual = task.source === "Manual";
            return `<td><div class="pm-row-actions"><button type="button" class="pm-btn-edit pm-btn-edit-sm" data-pm-edit="${esc(task.pmTaskId)}">Edit</button>${isManual ? `<button type="button" class="pm-chip-action pm-chip-danger" data-pm-delete="${esc(task.pmTaskId)}">Delete</button>` : ""}</div></td>`;
        }
        return `<td>${esc(task[key]) || "—"}</td>`;
    }

    // ── "Marked as Done" review list (edit / unmark mistaken completions) ──────
    const DONE_COLS = [
        ["pmCategory", "PM Category"],
        ["assetId", "Asset ID"],
        ["assetName", "Asset"],
        ["stage", "Stage"],
        ["plannedDate", "Scheduled Week"],
        ["completionDate", "Completed On"],
        ["contractorOrPIC", "PIC / Contractor"],
        ["remarksReason", "Remarks"],
        ["doneAction", "Actions"],
    ];

    // A PM counts as "marked Done" if its stored/operational status is Done — covers
    // both imported tasks (isDone is derived) and manual tasks (status only).
    function isMarkedDone(task) { return storedStatus(task) === "Done" || isDone(task); }

    function renderDoneList() {
        // Only PMs marked Done, within the current global Stage / Year filter.
        let rows = getFilteredTasks({ period: "all" }).filter(isMarkedDone);
        if (state.doneSearch) {
            const needle = state.doneSearch.toLowerCase();
            rows = rows.filter((t) => [taskCategory(t), t.assetId, t.assetName, t.systemArea, t.mainAssetGroup, t.stage]
                .join(" ").toLowerCase().includes(needle));
        }
        // Most recently completed first.
        rows.sort((a, b) => String(b.completionDate || "").localeCompare(String(a.completionDate || "")));
        setText("pm-done-count", fmt(rows.length));

        const head = el("pm-done-table-head");
        if (head) head.innerHTML = `<tr>${DONE_COLS.map(([, label]) => `<th>${esc(label)}</th>`).join("")}</tr>`;

        const body = el("pm-done-table-body");
        if (!body) return;
        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="${DONE_COLS.length}" class="empty-row">No PM are marked as Done for the current Stage / Year. Mark a PM Done from the Task List or calendar and it will appear here for review.</td></tr>`;
            return;
        }
        body.innerHTML = rows.slice(0, 1000).map((task) => `<tr>${DONE_COLS.map(([key]) => doneCell(key, task)).join("")}</tr>`).join("");
    }

    function doneCell(key, task) {
        if (key === "doneAction") {
            return `<td><div class="pm-row-actions">`
                + `<button type="button" class="pm-btn-edit pm-btn-edit-sm" data-pm-edit="${esc(task.pmTaskId)}">Edit</button>`
                + `<button type="button" class="pm-chip-action pm-chip-danger" data-pm-unmark="${esc(task.pmTaskId)}">Unmark as Done</button>`
                + `</div></td>`;
        }
        return taskCell(key, task);
    }

    // ── Analysis charts (5 key charts + top-10 table) ────────────────────────
    function renderAnalysisCharts() {
        const meta = state.payload?.meta || {};
        const yearTasks = getFilteredTasks({ period: "year" });

        // Scheduled vs Completed runs on the financial year (Apr–Mar) with its own
        // FY selector; it spans two calendar years so it uses the full task set.
        populateMonthFyFilter();
        renderMonthChart();
        makeChart("pm-chart-compliance", complianceConfig(complianceSeries(yearTasks, meta.year)));
        makeChart("pm-chart-status", doughnutConfig(emptyOr(chartFromCounts(countBy(yearTasks, opStatus), STATUS_BREAKDOWN_ORDER)), STATUS_COLORS));
        renderFLChart(yearTasks);

        const backlogTasks = yearTasks.filter((t) => isBacklogTask(t) || isOverdueOp(t));
        makeChart("pm-chart-backlog-system", barConfig(emptyOr(chartFromCounts(countBy(backlogTasks, (t) => t.systemArea), null, 12)), { horizontal: true, color: "#ef4444" }));
        renderTopBacklog(backlogTasks);
    }

    // ── Scheduled vs Completed by financial-year month (Apr → Mar) ────────────
    function fysInData() {
        const set = new Set();
        getFilteredTasks({ period: "all" }).forEach((t) => {
            const m = Number(t.plannedMonth), y = Number(t.plannedYear);
            if (m && y) set.add(fyStartYearOf(y, m));
        });
        return [...set].filter((y) => Number.isFinite(y)).sort((a, b) => b - a);
    }
    function currentMonthFy() {
        const fys = fysInData();
        if (state.monthFy != null && fys.includes(Number(state.monthFy))) return Number(state.monthFy);
        const guess = Number(state.payload?.meta?.year);   // default to the globally selected year's FY
        if (fys.includes(guess)) return guess;
        return fys.length ? fys[0] : (Number.isFinite(guess) ? guess : new Date().getFullYear());
    }
    function populateMonthFyFilter() {
        const sel = el("pm-month-fy");
        if (!sel) return;
        const fys = fysInData();
        const cur = currentMonthFy();
        const list = fys.length ? fys : [cur];
        sel.innerHTML = list.map((y) => `<option value="${y}">${esc(fyLabel(y))}</option>`).join("");
        sel.value = String(cur);
    }
    function renderMonthChart() {
        makeChart("pm-chart-month", monthlyConfig(monthlySeriesFy(getFilteredTasks({ period: "all" }), currentMonthFy())));
    }
    function monthlySeriesFy(rows, fyStart) {
        const scheduled = Array(12).fill(0), done = Array(12).fill(0);
        rows.forEach((t) => {
            const m = Number(t.plannedMonth), y = Number(t.plannedYear);
            if (!m || !y || fyStartYearOf(y, m) !== Number(fyStart)) return;
            const idx = fyIndexOf(m);   // Apr=0 … Mar=11
            scheduled[idx] += 1;
            if (isMarkedDone(t)) done[idx] += 1;   // manual completion only
        });
        return { scheduled, done };
    }
    function monthlyConfig(series) {
        return {
            type: "bar",
            data: {
                labels: FY_MONTH_LABELS,
                datasets: [
                    { label: "Scheduled", data: series.scheduled, backgroundColor: "#2563eb", borderRadius: 4 },
                    { label: "Completed", data: series.done, backgroundColor: "#10b981", borderRadius: 4 },
                ],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "#eef2f7" } } } },
        };
    }
    function complianceSeries(rows, year) {
        const sched = Array(12).fill(0), comp = Array(12).fill(0);
        rows.forEach((t) => {
            const m = Number(t.plannedMonth);
            if (!m || Number(t.plannedYear) !== Number(year)) return;
            sched[m - 1] += 1; if (t.isOnTimeCompleted) comp[m - 1] += 1;   // done within scheduled week
        });
        return sched.map((s, i) => (s ? round1((comp[i] / s) * 100) : null));
    }
    function complianceConfig(series) {
        return {
            type: "line",
            data: {
                labels: MONTHS,
                datasets: [
                    { label: "Compliance %", data: series, borderColor: "#8b5cf6", backgroundColor: "rgba(139,92,246,.12)", tension: 0.3, fill: true, spanGaps: true, pointRadius: 3 },
                    { label: `Target ${COMPLIANCE_TARGET}%`, data: MONTHS.map(() => COMPLIANCE_TARGET), borderColor: "#ef4444", borderDash: [6, 4], pointRadius: 0, fill: false },
                ],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true, max: 100, grid: { color: "#eef2f7" } }, x: { grid: { display: false } } } },
        };
    }
    // PM workload grouped by Functional Location (asset installation → zone), stacked by Stage.
    const FL_TOP_N = 12;
    function flGroups(rows) {
        const map = {};
        rows.forEach((t) => {
            const label = t.functionalLocationLabel || "Unmapped Functional Location";
            const e = (map[label] ||= { label, code: t.functionalLocationCode || "", name: t.functionalLocationName || label, s1: 0, s2: 0, total: 0 });
            if (t.stage === "Stage 2") e.s2 += 1; else e.s1 += 1;
            e.total += 1;
        });
        let entries = Object.values(map).filter((e) => e.total > 0).sort((a, b) => b.total - a.total);
        if (entries.length > FL_TOP_N) {
            const rest = entries.slice(FL_TOP_N);
            const others = {
                label: "Others", code: "", name: `${rest.length} more locations`,
                s1: rest.reduce((s, e) => s + e.s1, 0), s2: rest.reduce((s, e) => s + e.s2, 0), total: rest.reduce((s, e) => s + e.total, 0),
            };
            entries = entries.slice(0, FL_TOP_N).concat([others]);
        }
        // Highest workload at the top of a horizontal bar (reverse for Chart.js y-axis).
        return entries.reverse();
    }
    function flConfig(groups) {
        return {
            type: "bar",
            data: {
                labels: groups.map((e) => e.label),
                datasets: [
                    { label: "Stage 1", data: groups.map((e) => e.s1), backgroundColor: "#2563eb", borderRadius: 4 },
                    { label: "Stage 2", data: groups.map((e) => e.s2), backgroundColor: "#14b8a6", borderRadius: 4 },
                ],
            },
            options: {
                indexAxis: "y", responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: "bottom" },
                    tooltip: { callbacks: {
                        title: (items) => { const e = groups[items[0].dataIndex]; return e.code ? `${e.code} – ${e.name}` : e.label; },
                        afterBody: (items) => { const e = groups[items[0].dataIndex]; return [`Stage 1 PM: ${e.s1}`, `Stage 2 PM: ${e.s2}`, `Total PM: ${e.total}`]; },
                    } },
                },
                scales: {
                    x: { stacked: true, beginAtZero: true, grid: { color: "#eef2f7" }, title: { display: true, text: "Scheduled PM tasks" } },
                    y: { stacked: true, grid: { display: false } },
                },
            },
        };
    }
    function renderFLChart(rows) {
        const canvas = el("pm-chart-workload");
        if (!canvas) return;
        const wrap = canvas.parentElement;
        let msg = wrap.querySelector(".pm-chart-empty");
        const groups = flGroups(rows);
        if (!groups.length) {
            if (charts["pm-chart-workload"]) { charts["pm-chart-workload"].destroy(); delete charts["pm-chart-workload"]; }
            canvas.style.display = "none";
            if (!msg) { msg = document.createElement("div"); msg.className = "pm-chart-empty"; wrap.appendChild(msg); }
            msg.textContent = "No PM workload found for the selected filters.";
            msg.style.display = "flex";
            return;
        }
        canvas.style.display = "";
        if (msg) msg.style.display = "none";
        makeChart("pm-chart-workload", flConfig(groups));
    }
    function renderTopBacklog(backlogTasks) {
        const body = el("pm-top-backlog-body");
        if (!body) return;
        const map = {};
        backlogTasks.forEach((t) => {
            const k = `${t.assetId || "—"} · ${t.assetName || ""}`.trim();
            (map[k] ||= { count: 0, system: t.systemArea || "Unassigned" }).count += 1;
        });
        const top = Object.entries(map).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
        if (!top.length) {
            body.innerHTML = `<tr><td colspan="3" class="empty-row">No backlog or overdue PM.</td></tr>`;
            return;
        }
        body.innerHTML = top.map(([label, info]) => `<tr><td>${esc(label)}</td><td>${esc(info.system)}</td><td class="pm-num">${info.count}</td></tr>`).join("");
    }

    // ── Edit modal + quick actions + delete ──────────────────────────────────
    function bindEditDelegation() {
        document.addEventListener("click", (event) => {
            const edit = event.target.closest("[data-pm-edit]");
            if (edit) { const t = state.taskIndex.get(edit.dataset.pmEdit); if (t) openEditModal(t); return; }
            const quick = event.target.closest("[data-pm-quick]");
            if (quick) { const t = state.taskIndex.get(quick.dataset.pmTask); if (t) openEditModal(t, quick.dataset.pmQuick); return; }
            const del = event.target.closest("[data-pm-delete]");
            if (del) { deleteManualTask(del.dataset.pmDelete); return; }
            const unmark = event.target.closest("[data-pm-unmark]");
            if (unmark) { unmarkDone(unmark.dataset.pmUnmark); return; }
            const add = event.target.closest("[data-pm-add]");
            if (add) { openPlannerModal(add.dataset.pmAdd); return; }
        });
    }

    // Revert a mistaken completion: set status back to Pending (clears the
    // completion date) via the same override-update endpoint.
    async function unmarkDone(taskId) {
        const task = state.taskIndex.get(taskId);
        const label = task ? (task.assetId || task.assetName || "this PM") : "this PM";
        if (!window.confirm(`Unmark "${label}" as Done?\n\nIt returns to Pending and its completion date is cleared. You can mark it Done again at any time.`)) return;
        try {
            const res = await fetch(`${API}/update`, {
                method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
                body: JSON.stringify({ pmTaskId: taskId, status: "Pending", completionDate: "" }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
            await refresh();
        } catch (err) {
            window.alert(err.message || "Could not unmark the PM as Done.");
        }
    }

    function bindEditModal() {
        el("pm-edit-status")?.addEventListener("change", syncEditFields);
        el("pm-edit-close")?.addEventListener("click", closeEditModal);
        el("pm-edit-cancel")?.addEventListener("click", closeEditModal);
        el("pm-edit-modal")?.addEventListener("click", (event) => { if (event.target.id === "pm-edit-modal") closeEditModal(); });
        el("pm-edit-form")?.addEventListener("submit", saveEdit);
        el("pm-edit-delete")?.addEventListener("click", () => { if (state.editTaskId) deleteManualTask(state.editTaskId, true); });
    }

    function openEditModal(task, presetStatus) {
        state.editTaskId = task.pmTaskId;
        state.editTask = task;
        const isManual = task.source === "Manual";
        setText("pm-edit-title", `Update PM · ${task.assetId || task.assetName || ""}`);
        setText("pm-edit-subtitle", `${displayText(task.assetName || "")} · ${taskCategory(task)} · ${task.stage}`);
        const meta = el("pm-edit-meta");
        if (meta) meta.innerHTML = `
            <span><b>System / Area:</b> ${esc(task.systemArea || "Unassigned")}</span>
            <span><b>Frequency:</b> ${esc(task.frequency) || "—"}</span>
            <span><b>Scheduled week ends:</b> ${task.scheduledWeekEnd ? dateLabel(task.scheduledWeekEnd) : "—"}</span>`;

        const status = presetStatus || storedStatus(task);
        el("pm-edit-status").value = OP_STATUSES.includes(status) ? status : "Pending";
        el("pm-edit-scheduled").value = (task.plannedDate || "").slice(0, 10);
        el("pm-edit-description").value = task.pmDescription || "";
        // For a quick "Mark Done", pre-fill today's completion date for convenience.
        const presetDone = presetStatus === "Done" && !task.completionDate;
        el("pm-edit-completion").value = presetDone ? isoDate(new Date()) : (task.completionDate || "").slice(0, 10);
        if (el("pm-edit-pic")) el("pm-edit-pic").value = task.contractorOrPIC || "";
        el("pm-edit-reschedule").value = (task.rescheduledDate || "").slice(0, 10);
        el("pm-edit-reason").value = task.reason || "";
        el("pm-edit-remarks").value = task.remarks || "";

        const delBtn = el("pm-edit-delete");
        if (delBtn) delBtn.hidden = !isManual;

        const audit = el("pm-edit-audit");
        if (audit) {
            audit.textContent = task.lastUpdated
                ? `Last updated ${dateLabel(task.lastUpdated, { hour: "2-digit", minute: "2-digit" })} by ${task.updatedBy || "—"}`
                : "No manual update yet — completion is recorded only when you mark it Done.";
        }
        hideError("pm-edit-error");
        syncEditFields();
        const overlay = el("pm-edit-modal");
        if (overlay) overlay.hidden = false;
    }

    function syncEditFields() {
        const status = el("pm-edit-status")?.value;
        toggle("pm-edit-completion-field", status === "Done");
        toggle("pm-edit-reschedule-field", status === "Deferred");
        toggle("pm-edit-reason-field", status === "Backlog" || status === "Deferred");
        const reasonLabel = el("pm-edit-reason-label");
        if (reasonLabel) reasonLabel.textContent = status === "Deferred" ? "Deferred Reason" : "Backlog Reason";
        const compLabel = el("pm-edit-completion-field")?.querySelector("span");
        if (compLabel) compLabel.textContent = "Completion Date (required)";
    }
    function toggle(id, show) { const n = el(id); if (n) n.hidden = !show; }
    function showError(id, message) { const n = el(id); if (n) { n.textContent = message; n.hidden = false; } }
    function hideError(id) { const n = el(id); if (n) n.hidden = true; }

    async function saveEdit(event) {
        event.preventDefault();
        if (!state.editTaskId) return;
        const status = el("pm-edit-status").value;
        const payload = {
            pmTaskId: state.editTaskId,
            status,
            scheduledDate: el("pm-edit-scheduled").value || "",
            pmDescription: el("pm-edit-description").value.trim(),
            completionDate: el("pm-edit-completion").value || "",
            rescheduledDate: el("pm-edit-reschedule").value || "",
            reason: el("pm-edit-reason").value.trim(),
            remarks: el("pm-edit-remarks").value.trim(),
            contractorOrPIC: el("pm-edit-pic")?.value.trim() || "",
        };
        if (status === "Done" && !payload.completionDate) return showError("pm-edit-error", "A completion date is required when status is Done.");
        if (status === "Backlog" && !payload.reason) return showError("pm-edit-error", "A backlog reason is required when status is Backlog.");
        if (status === "Deferred" && !payload.rescheduledDate) return showError("pm-edit-error", "A rescheduled date is required when status is Deferred.");
        if (status === "Deferred" && !payload.reason && !payload.remarks) return showError("pm-edit-error", "A reason is required when status is Deferred.");
        if (status === "Not Applicable" && !payload.remarks) return showError("pm-edit-error", "Remarks are required when status is Not Applicable.");
        if (status === "Cancelled" && !payload.remarks) return showError("pm-edit-error", "Remarks are required when status is Cancelled.");
        hideError("pm-edit-error");

        const saveBtn = el("pm-edit-save");
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
        try {
            const res = await fetch(`${API}/update`, {
                method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
            closeEditModal();
            await refresh();
        } catch (err) {
            showError("pm-edit-error", err.message || "Could not save the update.");
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Update"; }
        }
    }

    function closeEditModal() {
        state.editTaskId = null;
        state.editTask = null;
        const overlay = el("pm-edit-modal");
        if (overlay) overlay.hidden = true;
    }

    async function deleteManualTask(taskId, fromModal) {
        if (!taskId || !String(taskId).startsWith("manual_")) return;
        if (!window.confirm("Delete this manually planned PM task? This cannot be undone.")) return;
        try {
            const res = await fetch(`${API}/delete`, {
                method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
                body: JSON.stringify({ pmTaskId: taskId }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
            if (fromModal) closeEditModal();
            await refresh();
        } catch (err) {
            if (fromModal) showError("pm-edit-error", err.message || "Could not delete the task.");
            else console.warn("Delete failed:", err.message);
        }
    }

    // ── Planner modal (create manual PM tasks) ───────────────────────────────
    async function loadAssetCatalog() {
        if (state.assetsLoaded) return;
        try {
            const res = await fetch("/api/maintenance/pm-assets", { cache: "no-store" });
            const data = await res.json();
            state.assets = data.assets || [];
            state.assetsLoaded = true;
        } catch (err) {
            console.warn("Asset catalogue unavailable:", err.message);
        }
    }

    function bindPlannerModal() {
        el("pm-add-task-btn")?.addEventListener("click", () => openPlannerModal(state.selectedDate));
        el("pm-plan-close")?.addEventListener("click", closePlannerModal);
        el("pm-plan-cancel")?.addEventListener("click", closePlannerModal);
        el("pm-plan-modal")?.addEventListener("click", (event) => { if (event.target.id === "pm-plan-modal") closePlannerModal(); });
        el("pm-plan-form")?.addEventListener("submit", savePlan);
        el("pm-plan-frequency")?.addEventListener("change", () => {
            toggle("pm-plan-custom-field", el("pm-plan-frequency").value === "Custom");
        });
        el("pm-plan-date")?.addEventListener("change", syncPlanWeek);
        el("pm-plan-category")?.addEventListener("change", () => {
            // keep main group roughly aligned with the chosen category
            state.planGroup = el("pm-plan-category").value === "Equipment" ? "Production Equipment" : "";
        });
        el("pm-plan-asset-search")?.addEventListener("input", debounce(renderAssetResults, 120));
        el("pm-plan-asset-search")?.addEventListener("focus", renderAssetResults);
        document.addEventListener("click", (event) => {
            if (!event.target.closest(".pm-asset-search")) toggle("pm-asset-results", false);
        });
    }

    function openPlannerModal(presetDate) {
        loadAssetCatalog();
        el("pm-plan-form")?.reset();
        toggle("pm-plan-custom-field", false);
        toggle("pm-asset-results", false);
        hideError("pm-plan-error");
        state.planGroup = "";
        state.planSubGroup = "";
        state.planLocation = "";
        const date = presetDate || state.selectedDate || isoDate(new Date());
        if (el("pm-plan-date")) el("pm-plan-date").value = date.slice(0, 10);
        syncPlanWeek();
        const overlay = el("pm-plan-modal");
        if (overlay) overlay.hidden = false;
        el("pm-plan-asset-search")?.focus();
    }
    function closePlannerModal() { const o = el("pm-plan-modal"); if (o) o.hidden = true; }

    function syncPlanWeek() {
        const d = parseDate(el("pm-plan-date")?.value);
        if (el("pm-plan-week")) el("pm-plan-week").value = d ? `Week ${isoWeek(d)} · ${d.getFullYear()}` : "";
    }

    function renderAssetResults() {
        const box = el("pm-asset-results");
        if (!box) return;
        const q = (el("pm-plan-asset-search")?.value || "").trim().toLowerCase();
        let list = state.assets;
        if (q) {
            list = state.assets.filter((a) => [a.assetId, a.assetName, a.systemArea, a.category, a.mainAssetGroup]
                .join(" ").toLowerCase().includes(q));
        }
        list = list.slice(0, 20);
        if (!list.length) { box.innerHTML = `<div class="pm-asset-none">No matching assets.</div>`; box.hidden = false; return; }
        box.innerHTML = list.map((a) => `
            <button type="button" class="pm-asset-option" data-asset-id="${esc(a.assetId)}">
                <strong>${esc(a.assetId)}</strong> ${esc(a.assetName)}
                <span>${esc(a.category)} · ${esc(a.stage || "—")} · ${esc(a.systemArea || "—")}</span>
            </button>`).join("");
        box.hidden = false;
        box.querySelectorAll("[data-asset-id]").forEach((btn) =>
            btn.addEventListener("click", () => pickAsset(btn.dataset.assetId)));
    }

    function pickAsset(assetId) {
        const a = state.assets.find((x) => x.assetId === assetId);
        if (!a) return;
        setVal("pm-plan-asset-id", a.assetId);
        setVal("pm-plan-asset-name", a.assetName);
        setVal("pm-plan-system", a.systemArea);
        setVal("pm-plan-priority", a.criticality);
        if (el("pm-plan-category")) el("pm-plan-category").value = a.category === "Equipment" ? "Equipment" : "Utility";
        if (el("pm-plan-stage") && a.stage) el("pm-plan-stage").value = a.stage === "Stage 2" ? "Stage 2" : "Stage 1";
        state.planGroup = a.mainAssetGroup || "";
        state.planSubGroup = a.subAssetGroup || "";
        state.planLocation = a.location || "";
        setVal("pm-plan-asset-search", `${a.assetId} — ${a.assetName}`);
        toggle("pm-asset-results", false);
    }
    function setVal(id, v) { const n = el(id); if (n) n.value = v || ""; }

    async function savePlan(event, confirm) {
        event?.preventDefault?.();
        const body = {
            assetId: el("pm-plan-asset-id").value.trim(),
            assetName: el("pm-plan-asset-name").value.trim(),
            category: el("pm-plan-category").value,
            stage: el("pm-plan-stage").value,
            systemArea: el("pm-plan-system").value.trim(),
            mainAssetGroup: state.planGroup || "",
            subAssetGroup: state.planSubGroup || "",
            location: state.planLocation || "",
            priority: el("pm-plan-priority").value.trim(),
            pmDescription: el("pm-plan-description").value.trim(),
            scheduledDate: el("pm-plan-date").value || "",
            frequency: el("pm-plan-frequency").value,
            customIntervalDays: el("pm-plan-custom").value || "",
            contractorOrPIC: "",
            remarks: el("pm-plan-remarks").value.trim(),
            confirm: Boolean(confirm),
        };
        if (!body.assetId) return showError("pm-plan-error", "Asset ID is required.");
        if (!body.scheduledDate) return showError("pm-plan-error", "Scheduled date is required.");
        if (!body.pmDescription) return showError("pm-plan-error", "PM type / task description is required.");
        hideError("pm-plan-error");

        const saveBtn = el("pm-plan-save");
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
        try {
            const res = await fetch(`${API}/plan`, {
                method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (res.status === 409 && data.needsConfirm) {
                if (window.confirm(`${data.message}`)) return savePlan(null, true);
                return;
            }
            if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
            closePlannerModal();
            await refresh();
        } catch (err) {
            showError("pm-plan-error", err.message || "Could not create the PM task.");
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Add PM Task"; }
        }
    }

    // ── Small utils ──────────────────────────────────────────────────────────
    function esc(value) {
        if (value === null || value === undefined) return "";
        return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }
    function badge(text, cls) { return `<span class="pm-badge ${cls}">${esc(text)}</span>`; }
    function stageBadgeClass(stage) {
        if (stage === "Stage 1") return "pm-badge-blue";
        if (stage === "Stage 2") return "pm-badge-teal";
        return "pm-badge-slate";
    }
})();
