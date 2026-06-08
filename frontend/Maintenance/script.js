document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const initialView = (urlParams.get("view") || "mira_overview").toLowerCase();
    const UTILITY_INSPECTION_OVERRIDES = {
        "UL-TN-01": [{ month: 1, week: "first" }],
        "UL-TN-02": [{ month: 1, week: "first" }],
        "UL-HB-01": [{ month: 10, week: "first" }],
        "UL-BL-01": [{ month: 10, week: "first" }],
        "UL-BL-02": [{ month: 10, week: "first" }],
        "UL-AC-01": [{ month: 10, week: "first" }],
        "UL-AC-02": [{ month: 10, week: "first" }],
        "UL-AD-01": [{ month: 10, week: "second" }],
        "UL-SF-01": [{ month: 10, week: "second" }],
        "UL-SF-02": [{ month: 10, week: "second" }],
        "UL-CF-01": [{ month: 10, week: "second" }],
        "UL-CF-02": [{ month: 10, week: "second" }],
        "UL-RS-01": [{ month: 10, week: "third" }],
        "UL-RS-02": [{ month: 10, week: "third" }],
        "UL-DP-01": [{ month: 10, week: "third" }],
        "UL-DP-02": [{ month: 10, week: "third" }],
        "UL-TP-01": [{ month: 10, week: "third" }],
        "UL-TP-02": [{ month: 10, week: "fourth" }],
        "UL-TP-03": [{ month: 10, week: "fourth" }],
        "UL-TP-04": [{ month: 10, week: "fourth" }],
        "UL-IN-01": [{ month: 10, week: "last" }],
        "UL-IN-02": [{ month: 10, week: "last" }],
        "UL-IN-03": [{ month: 11, week: "first" }],
        "UL-IN-04": [{ month: 11, week: "first" }],
        "UL-EX-01": [{ month: 11, week: "first" }],
        "UL-EX-02": [{ month: 11, week: "first" }],
        "UL-EX-03": [{ month: 11, week: "first" }],
        "UL-EX-04": [{ month: 11, week: "second" }],
        "UL-EX-05": [{ month: 11, week: "second" }],
        "UL-EX-06": [{ month: 11, week: "second" }],
        "UL-EX-07": [{ month: 11, week: "second" }],
        "UL-EX-08": [{ month: 11, week: "second" }],
        "UL-EX-09": [{ month: 11, week: "third" }],
        "UL-MDB-01": [{ month: 12, week: "third" }],
        "UL-MDB-02": [{ month: 12, week: "third" }],
        "UL-MDB-03": [{ month: 12, week: "third" }],
        "UL-MDB-04": [{ month: 12, week: "third" }],
        "UL-MDB-05": [{ month: 12, week: "third" }],
        "UL-TR-01": [{ month: 12, week: "second" }],
        "UL-TR-02": [{ month: 12, week: "second" }],
        "UL-TR-03": [{ month: 12, week: "second" }],
        "UL-TR-04": [{ month: 12, week: "second" }],
        "UL-TR-05": [{ month: 12, week: "second" }],
        "UL-LPG-01": [{ month: 12, week: "last" }],
        "UL-LPG-02": [{ month: 12, week: "last" }],
        "UL-LPG-03": [{ month: 12, week: "last" }],
        "UL-VP-01": [{ month: 12, week: "last" }],
        "UL-VP-02": [{ month: 12, week: "last" }],
        "UL-HD-01": [{ month: 11, week: "third" }],
        "UL-HD-02": [{ month: 11, week: "third" }],
        "UL-HD-03": [{ month: 11, week: "third" }],
        "UL-HD-04": [{ month: 11, week: "third" }],
        "UL-HD-05": [{ month: 11, week: "fourth" }],
        "UL-AB-02": [{ month: 11, week: "fourth" }],
        "UL-AB-03": [{ month: 11, week: "fourth" }],
        "UL-AB-04": [{ month: 11, week: "fourth" }],
        "UL-SP--01": [{ month: 11, week: "fourth" }],
        "UL-SP--02": [{ month: 11, week: "fourth" }],
        "UL-SP--03": [{ month: 11, week: "fourth" }],
        "UL-SP--04": [{ month: 11, week: "fourth" }],
        "UL-SP--05": [{ month: 11, week: "fourth" }],
        "UL-SP--06": [{ month: 11, week: "fourth" }],
        "UL-SP--07": [{ month: 12, week: "first" }],
        "UL-SP--08": [{ month: 12, week: "first" }],
        "UL-FP-01": [{ month: 5, week: "last" }, { month: 11, week: "last" }],
        "UL-RO-01": [{ month: 5, week: "last" }, { month: 11, week: "last" }],
        "UL-UV-01": [{ month: 5, week: "last" }, { month: 11, week: "last" }],
        "UL-UV-02": [{ month: 5, week: "last" }, { month: 11, week: "last" }],
        "UL-UV-03": [{ month: 5, week: "last" }, { month: 11, week: "last" }],
        "UL-WH-01": [{ month: 12, week: "last" }],
        "UL-WH-02": [{ month: 12, week: "last" }],
        "UL-DR-01": [{ month: 12, week: "last" }],
        "UL-DR-02": [{ month: 12, week: "last" }],
        "UL-PP-01": [{ month: 3, week: "last" }, { month: 6, week: "last" }, { month: 9, week: "last" }, { month: 12, week: "last" }],
        "UL-PP-02": [{ month: 3, week: "last" }, { month: 6, week: "last" }, { month: 9, week: "last" }, { month: 12, week: "last" }],
        "UL-PP-03": [{ month: 3, week: "last" }, { month: 6, week: "last" }, { month: 9, week: "last" }, { month: 12, week: "last" }],
        "UL-PP-04": [{ month: 3, week: "last" }, { month: 6, week: "last" }, { month: 9, week: "last" }, { month: 12, week: "last" }],
        "UL-PP-05": [{ month: 3, week: "last" }, { month: 6, week: "last" }, { month: 9, week: "last" }, { month: 12, week: "last" }],
        "UL-PP-06": [{ month: 3, week: "last" }, { month: 6, week: "last" }, { month: 9, week: "last" }, { month: 12, week: "last" }],
        "UL-PP-07": [{ month: 3, week: "last" }, { month: 6, week: "last" }, { month: 9, week: "last" }, { month: 12, week: "last" }],
    };
    const ANALYSIS_TOP_LIST_LIMIT = 10;
    const DOWNTIME_EMBED_SRC = "/Downtime/index.html?embed=1";
    const DOWNTIME_PERIOD_OPTIONS = [
        { value: "all_years", label: "All Years" },
        { value: "ytd", label: "Current Year / YTD" },
        { value: "last12", label: "Last 12 Months" },
        { value: "previous_year", label: "Previous Year" },
        { value: "this_month", label: "This Month" },
        { value: "last_month", label: "Last Month" },
        { value: "custom", label: "Custom Range" },
    ];
    const state = {
        activeView: ["mira_overview", "overview", "spare_parts", "downtime"].includes(initialView) ? initialView : "mira_overview",
        overviewMonth: "",
        overviewCategory: "all",
        overviewStatus: "all",
        overviewSearch: "",
        overviewSort: "date_asc",
        maintenanceMixMonth: "",
        selectedMonth: "",
        listMonthFilter: "",
        statusFilter: "all",
        categoryFilter: "all",
        monthlyCategoryFilter: "all",
        locationFilter: "all",
        monthlyLocationFilter: "all",
        inspectionFilter: "all",
        monthlyInspectionFilter: "all",
        monthlyBreakdownMode: "category",
        search: "",
        sort: "due_date_asc",
        year: null,
        monthStatusView: "pending",
        hasAppliedListFilters: false,
        equipmentPriorityFilter: "all",
        equipmentCriticalOnly: "all",
        equipmentWeekFilter: "all",
        sparePartsData: null,
        spareImportStatus: null,
        spareActivePanel: "external",
        assetPartsIntelligence: null,
        assetPartsIntelOptions: null,
        assetPartsIntelQuery: "",
        sparePartsFilters: {
            period: "all",
            month: "all",
            year: "all",
            startDate: "",
            endDate: "",
            itemCode: "",
            supplier: "all",
            classification: "all",
            confidence: "all",
            translationStatus: "all",
            inventoryMatchStatus: "all",
            groupOfCost: "all",
            pdMachine: "all",
            stockStatus: "all",
            search: "",
            metric: "price",
        },
        ptData: null,
        ptFilters: {
            period: "all",
            month: "all",
            category: "all",
            asset: "all",
            search: "",
        },
        ptCurrency: "THB",
        downtimeData: null,
        downtimeImportStatus: null,
        downtimeFilters: {
            period: "all_years",
            startDate: "",
            endDate: "",
            criticality: "all",
            machineGroup: "all",
            location: "all",
            status: "all",
            search: "",
        },
        analysisLoaded: false,
        analysisRows: [],
        analysisIntervals: [],
        analysisFilteredRows: [],
        analysisFilteredIntervals: [],
        analysisFilters: {
            dateRange: "all",
            startDate: "",
            endDate: "",
            assetId: "all",
            machineName: "all",
            machineGroup: "all",
            criticalityGroup: "all",
            severityLevel: "all",
            productionLine: "all",
            lifecycleState: "all",
            dataQualityFlag: "all",
            paretoDowntimeGroupBy: "MachineName",
            paretoWorkOrderGroupBy: "MachineName",
            distributionScale: "raw",
            mttrBoxplotGroup: "MachineGroup",
            mttrTrendCompareMode: "",
            mttrTrendCompareA: "",
            mttrTrendCompareB: "",
            mtbfTrendGroupBy: "MachineGroup",
            pmThreshold: 168,
            controlAsset: "",
            controlMetric: "DowntimeHours",
            targets: { critical: 24, support: 48, facility: 72 },
        },
    };

    const charts = {};
    const STOCK_HEALTH_STATUSES = ["Reorder Required", "Normal", "Above Recommended", "Missing Threshold Data"];
    const STOCK_HEALTH_STATUS_ORDER = {
        "Reorder Required": 0,
        "Missing Threshold Data": 1,
        "Threshold Error": 2,
        "Normal": 3,
        "Above Recommended": 4,
    };

    initialize().catch((error) => {
        console.error("Maintenance initialization failed:", error);
    });

    async function initialize() {
        bindControls();
        bindPtInsightTabs();
        bindDowntimeEmbedFrame();
        await loadActiveView();
    }

    function getApiBase() {
        return `/api/maintenance/${state.activeView}`;
    }

    function resetViewState() {
        state.statusFilter = "all";
        state.categoryFilter = "all";
        state.monthlyCategoryFilter = "all";
        state.locationFilter = "all";
        state.monthlyLocationFilter = "all";
        state.inspectionFilter = "all";
        state.monthlyInspectionFilter = "all";
        state.monthlyBreakdownMode = "category";
        state.search = "";
        state.sort = "due_date_asc";
        state.monthStatusView = "pending";
        state.hasAppliedListFilters = false;
        state.equipmentPriorityFilter = "all";
        state.equipmentCriticalOnly = "all";
        state.equipmentWeekFilter = "all";
    }

    function updateViewCopy() {
        const isOverview = state.activeView === "overview";
        const isEquipment = state.activeView === "equipment";
        const isSpareParts = state.activeView === "spare_parts";
        const isAnalysis = state.activeView === "analysis";
        const isDowntime = state.activeView === "downtime";
        const isMiraOverview = state.activeView === "mira_overview";
        document.body.classList.toggle("maintenance-equipment", isEquipment);
        document.body.classList.toggle("maintenance-spare-parts", isSpareParts);
        document.body.classList.toggle("maintenance-analysis", isAnalysis);
        document.body.classList.toggle("maintenance-downtime", isDowntime);
        document.body.dataset.maintenanceView = state.activeView;
        const weeklyCompletionCard = document.getElementById("summary-card-3");
        if (weeklyCompletionCard) {
            weeklyCompletionCard.hidden = !isOverview && !isEquipment;
        }
        document.getElementById("mira-overview-view")?.classList.toggle("hidden", !isMiraOverview);
        document.getElementById("overview-view")?.classList.toggle("hidden", !isOverview);
        document.getElementById("utility-view")?.classList.toggle("hidden", isOverview || isSpareParts || isAnalysis || isDowntime || isMiraOverview);
        document.getElementById("spare-parts-view")?.classList.toggle("hidden", !isSpareParts);
        document.getElementById("analysis-view")?.classList.toggle("hidden", !isAnalysis);
        document.getElementById("downtime-view")?.classList.toggle("hidden", !isDowntime);
        document.querySelectorAll("[data-view-tab]").forEach((button) => {
            button.classList.toggle("active", (button.dataset.viewTab || "utility") === state.activeView);
        });
        setText(
            "maintenance-page-title",
            isMiraOverview
                ? "MIRA Daily Maintenance Overview"
                : isOverview
                ? "Preventive Maintenance Schedule"
                : isSpareParts
                ? "Spare Parts"
                : isDowntime
                ? "Downtime"
                : "PM Schedule"
        );
        setText(
            "maintenance-page-subtitle",
            isMiraOverview
                ? "AI-assisted daily summary for PM schedule, downtime, and spare parts."
                : isOverview
                ? "Monthly PM planning, completion tracking, backlog, and compliance overview."
                : isSpareParts
                ? "Inventory and external spare-parts management view"
                : isDowntime
                ? "Local work-order downtime tracking and review inside the Maintenance dashboard"
                : "Unified preventive maintenance planning and schedule visibility"
        );
        setText("summary-assets-label", isEquipment ? "Total Equipment Assets" : "Total Utility Assets");
        setText("summary-quarter-label", isEquipment ? "Assets Covered This Quarter" : "Tasks This Quarter");
        setText("monthly-section-title", isEquipment ? "Monthly Equipment Maintenance" : "Monthly Maintenance");
        setText("breakdown-title", isEquipment ? "Risk & Area Breakdown" : "Breakdown");
        setText(
            "breakdown-subtitle",
            isEquipment
                ? "Selected month by equipment risk category or production area"
                : "Selected month by utility category or location"
        );
        setText("breakdown-category-chip", isEquipment ? "Risk" : "Category");
        setText("breakdown-location-chip", isEquipment ? "Area" : "Location");
        setText("breakdown-inspection-chip", "Additional Checks");
        setText("timeline-title", isEquipment ? "Annual Equipment Timeline" : "Year Timeline");
        setText(
            "timeline-subtitle",
            isEquipment
                ? "Month-by-month maintenance load across production equipment areas"
                : "Month-by-month preventive maintenance load for the selected year"
        );
        setText("maintenance-list-title", isEquipment ? "Equipment Maintenance List" : "Maintenance List");
        setText("filter-category-label", isEquipment ? "Risk Category" : "Category");
        setText("filter-location-label", isEquipment ? "Area" : "Location");
        setText("maintenance-category-heading", isEquipment ? "Risk Category" : "Category");
        setText("maintenance-location-heading", isEquipment ? "Area" : "Location");
        const searchInput = document.getElementById("filter-search");
        if (searchInput) {
            searchInput.placeholder = isEquipment ? "Equipment code or equipment name" : "Machine code or machine name";
        }
    }

    async function loadActiveView() {
        resetViewState();
        updateViewCopy();

        if (state.activeView === "mira_overview") {
            // Self-contained Daily Maintenance Overview (shared/mira/mira-overview.js):
            // it fetches verified metrics + the AI summary itself. Render on activation.
            if (typeof window.renderMiraOverview === "function") window.renderMiraOverview();
            return;
        }

        if (state.activeView === "downtime") {
            await loadEmbeddedDowntimeView();
            return;
        }

        if (state.activeView === "overview") {
            // Overview is now rendered by the unified PM schedule module (pm-schedule.js).
            return;
        }

        if (state.activeView === "spare_parts") {
            await loadSparePartsView();
            return;
        }


        if (state.activeView === "analysis") {
            await loadAnalysisView();
            return;
        }

        const filtersPayload = await fetchJson(`${getApiBase()}/filters`);
        state.year = filtersPayload?.meta?.year || state.year || new Date().getFullYear();
        hydrateFilterOptions(filtersPayload);

        const currentMonthValue = `${state.year}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
        const defaultMonth = (filtersPayload?.months || []).find((month) => month.value === currentMonthValue)?.value
            || filtersPayload?.months?.[0]?.value
            || currentMonthValue;

        state.selectedMonth = defaultMonth;
        state.listMonthFilter = defaultMonth;
        syncMonthInputs();
        syncFilterInputs();
        await loadMaintenanceDashboard();
    }

    function bindControls() {
        document.querySelectorAll("[data-view-tab]").forEach((button) => {
            button.addEventListener("click", async () => {
                const nextView = button.dataset.viewTab || "utility";
                if (nextView === state.activeView) return;
                state.activeView = nextView;
                const nextUrl = new URL(window.location.href);
                nextUrl.searchParams.set("view", nextView);
                window.history.replaceState({}, "", nextUrl);
                await loadActiveView();
            });
        });

        [
            ["spare-period-filter", "period"],
            ["spare-month-filter", "month"],
            ["spare-year-filter", "year"],
            ["spare-start-date", "startDate"],
            ["spare-end-date", "endDate"],
            ["spare-supplier-filter", "supplier"],
            ["spare-classification-filter", "classification"],
            ["spare-confidence-filter", "confidence"],
            ["spare-translation-filter", "translationStatus"],
            ["spare-inventory-match-filter", "inventoryMatchStatus"],
            ["spare-group-filter", "groupOfCost"],
            ["spare-pd-machine-filter", "pdMachine"],
            ["spare-stock-status-filter", "stockStatus"],
            ["spare-metric-filter", "metric"],
        ].forEach(([id, key]) => {
            document.getElementById(id)?.addEventListener("change", (event) => {
                state.sparePartsFilters[key] = event.target.value || "all";
                renderSparePartsDashboard(state.sparePartsData || {});
            });
        });
        document.getElementById("spare-item-code-filter")?.addEventListener("input", debounce((event) => {
            state.sparePartsFilters.itemCode = event.target.value.trim().toLowerCase();
            renderSparePartsDashboard(state.sparePartsData || {});
        }, 200));
        document.getElementById("spare-stock-search")?.addEventListener("input", debounce((event) => {
            state.sparePartsFilters.search = event.target.value.trim().toLowerCase();
            renderSparePartsDashboard(state.sparePartsData || {});
        }, 200));
        document.getElementById("spare-manual-review-search")?.addEventListener("input", debounce((event) => {
            spareManualReviewSearchTerm = event.target.value.trim().toLowerCase();
            renderSpareManualReviewTable();
        }, 150));
        document.getElementById("asset-intel-search")?.addEventListener("input", debounce((event) => {
            state.assetPartsIntelQuery = event.target.value.trim();
            const status = document.getElementById("asset-intel-status");
            if (status && state.assetPartsIntelQuery) {
                status.textContent = "Ready to analyse. Press Enter or click Analyse Asset.";
                status.className = "asset-intel-status";
            }
        }, 200));
        document.getElementById("asset-intel-search")?.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                loadAssetPartsIntelligence();
            }
        });
        document.getElementById("asset-intel-analyse")?.addEventListener("click", () => {
            loadAssetPartsIntelligence();
        });
        document.getElementById("asset-intel-export-po")?.addEventListener("click", exportAssetPartsPurchases);
        document.querySelectorAll("[data-spare-panel]").forEach((button) => {
            button.addEventListener("click", () => {
                state.spareActivePanel = button.dataset.sparePanel || "external";
                syncSparePanelSelection();
                renderSparePartsDashboard(state.sparePartsData || {});
            });
        });
        [
            ["pt-period-filter", "period"],
            ["pt-month-filter", "month"],
            ["pt-category-filter", "category"],
            ["pt-asset-filter", "asset"],
        ].forEach(([id, key]) => {
            document.getElementById(id)?.addEventListener("change", (event) => {
                state.ptFilters[key] = event.target.value || "all";
                renderPtDashboard(state.ptData || {});
            });
        });
        document.getElementById("pt-search")?.addEventListener("input", debounce((event) => {
            state.ptFilters.search = event.target.value.trim().toLowerCase();
            renderPtDashboard(state.ptData || {});
        }, 200));
        document.getElementById("spare-inventory-import-form")?.addEventListener("submit", (event) => {
            handleMaintenanceImport(event, {
                kind: "inventory",
                inputId: "spare-inventory-import-file",
                statusId: "spare-inventory-import-status",
                url: "/api/maintenance/import/spare-inventory",
                pendingMessage: "Importing inventory file...",
            });
        });
        document.getElementById("spare-external-po-import-form")?.addEventListener("submit", (event) => {
            handleMaintenanceImport(event, {
                kind: "external_po",
                inputId: "spare-external-po-import-file",
                statusId: "spare-external-po-import-status",
                url: "/api/maintenance/import/external-po",
                pendingMessage: "Importing Gen PO file...",
            });
        });
        document.getElementById("spare-project-transactions-import-form")?.addEventListener("submit", (event) => {
            handleMaintenanceImport(event, {
                kind: "project_transactions",
                inputId: "spare-project-transactions-import-file",
                statusId: "spare-project-transactions-import-status",
                url: "/api/maintenance/import/project-transactions",
                pendingMessage: "Importing project transactions file...",
            });
        });
        document.getElementById("spare-currency-global")?.addEventListener("change", (event) => {
            spareCurrency = event.target.value || "THB";
            state.ptCurrency = spareCurrency;
            const note = document.getElementById("spare-fx-note");
            if (note) note.classList.toggle("hidden", spareCurrency === "THB");
            if (state.sparePartsData) renderSparePartsDashboard(state.sparePartsData);
            if (state.ptData) renderPtDashboard(state.ptData);
            if (state.assetPartsIntelligence) renderAssetPartsIntelligence(state.assetPartsIntelligence);
            if (_epoData) renderEpoSection(_epoData);
            if (ayData) renderAllYearsComparison(ayData);
            renderAllPtPartsTable();
        });
        document.getElementById("ay-monthly-year-filter")?.addEventListener("change", (event) => {
            ayMonthlyYear = event.target.value || "all";
            if (ayData) renderAllYearsComparison(ayData);
        });
        document.getElementById("month-selector")?.addEventListener("change", async (event) => {
            state.selectedMonth = event.target.value;
            syncMonthInputs();
            await refreshMonthScopedSections();
        });

        document.querySelectorAll("[data-status]").forEach((chip) => {
            chip.addEventListener("click", async () => {
                state.monthStatusView = chip.dataset.status || "all";
                state.statusFilter = state.monthStatusView;
                syncFilterInputs();
                await loadMonthlyDetail();
                if (state.activeView === "equipment") {
                    state.hasAppliedListFilters = true;
                    await loadList();
                }
            });
        });

        document.querySelectorAll("[data-status-target]").forEach((card) => {
            card.addEventListener("click", async () => {
                const status = card.dataset.statusTarget || "all";
                state.monthStatusView = status;
                state.statusFilter = status;
                syncFilterInputs();
                await loadMonthlyDetail();
                if (state.activeView === "equipment") {
                    state.hasAppliedListFilters = true;
                    await loadList();
                }
            });
        });

        document.querySelectorAll("[data-summary-filter]").forEach((card) => {
            card.addEventListener("click", async () => {
                if (state.activeView !== "equipment") return;
                const filter = card.dataset.summaryFilter || "all";
                if (filter === "completion_rate") return;
                state.hasAppliedListFilters = true;
                state.equipmentPriorityFilter = filter === "high_priority" ? "High" : "all";
                state.statusFilter = ({ done: "done", pending: "pending", overdue: "overdue", total: "all" })[filter] || "all";
                await loadList();
            });
        });

        document.getElementById("filter-month")?.addEventListener("change", async (event) => {
            state.listMonthFilter = event.target.value;
        });

        document.getElementById("filter-status")?.addEventListener("change", (event) => {
            state.statusFilter = event.target.value;
            state.monthStatusView = event.target.value;
            syncStatusControls();
            loadMonthlyDetail();
        });

        document.getElementById("filter-category")?.addEventListener("change", (event) => {
            state.categoryFilter = event.target.value;
        });

        document.getElementById("filter-location")?.addEventListener("change", (event) => {
            state.locationFilter = event.target.value;
        });

        document.getElementById("filter-inspection")?.addEventListener("change", (event) => {
            state.inspectionFilter = event.target.value;
        });

        document.getElementById("filter-sort")?.addEventListener("change", (event) => {
            state.sort = event.target.value;
        });

        document.getElementById("filter-search")?.addEventListener("input", debounce((event) => {
            state.search = event.target.value.trim();
        }, 250));

        document.getElementById("apply-maintenance-filters")?.addEventListener("click", async () => {
            state.hasAppliedListFilters = true;
            await loadList();
        });

        document.querySelectorAll("[data-breakdown-mode]").forEach((button) => {
            button.addEventListener("click", async () => {
                state.monthlyBreakdownMode = button.dataset.breakdownMode || "category";
                await loadMonthly();
            });
        });

        bindDowntimeControls();
        bindAnalysisControls();
    }

    function bindDowntimeEmbedFrame() {
        const frame = document.getElementById("maintenance-downtime-frame");
        if (!frame || frame.dataset.bound === "true") return;
        frame.dataset.bound = "true";

        const syncHeight = () => syncDowntimeFrameHeight(frame);
        frame.addEventListener("load", () => {
            syncHeight();
            window.setTimeout(syncHeight, 250);
            window.setTimeout(syncHeight, 1200);
        });

        window.addEventListener("message", (event) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type !== "maintenance-downtime-height") return;
            const nextHeight = Math.max(Number(event.data.height) || 0, 900);
            frame.style.height = `${nextHeight}px`;
        });

        window.addEventListener("resize", debounce(syncHeight, 120));
    }

    function syncDowntimeFrameHeight(frame = document.getElementById("maintenance-downtime-frame")) {
        if (!frame) return;
        try {
            const doc = frame.contentDocument;
            if (!doc) return;
            const height = Math.max(
                doc.documentElement?.scrollHeight || 0,
                doc.body?.scrollHeight || 0,
                900
            );
            frame.style.height = `${height}px`;
        } catch (error) {
            console.debug("Downtime frame height sync skipped:", error);
        }
    }

    async function loadEmbeddedDowntimeView() {
        const frame = document.getElementById("maintenance-downtime-frame");
        if (!frame) return;
        const targetSrc = frame.dataset.src || DOWNTIME_EMBED_SRC;
        if (frame.getAttribute("src") !== targetSrc) {
            frame.setAttribute("src", targetSrc);
            return;
        }
        syncDowntimeFrameHeight(frame);
    }

    function bindDowntimeControls() {
        document.getElementById("downtime-period-filter")?.addEventListener("change", (event) => {
            state.downtimeFilters.period = event.target.value || "all_years";
            syncDowntimeInputs();
        });
        document.getElementById("downtime-start-date")?.addEventListener("input", (event) => {
            state.downtimeFilters.startDate = event.target.value || "";
        });
        document.getElementById("downtime-end-date")?.addEventListener("input", (event) => {
            state.downtimeFilters.endDate = event.target.value || "";
        });
        [
            ["downtime-criticality-filter", "criticality"],
            ["downtime-machine-group-filter", "machineGroup"],
            ["downtime-location-filter", "location"],
            ["downtime-status-filter", "status"],
        ].forEach(([id, key]) => {
            document.getElementById(id)?.addEventListener("change", (event) => {
                state.downtimeFilters[key] = event.target.value || "all";
                renderDowntimeDashboard(state.downtimeData);
            });
        });
        document.getElementById("downtime-search-filter")?.addEventListener("input", debounce((event) => {
            state.downtimeFilters.search = event.target.value.trim().toLowerCase();
            renderDowntimeDashboard(state.downtimeData);
        }, 200));
        document.getElementById("apply-downtime-filters")?.addEventListener("click", async () => {
            readDowntimeFilterInputs();
            await loadDowntimeView(true);
        });
        document.getElementById("downtime-import-form")?.addEventListener("submit", handleDowntimeImport);
    }

    function bindAnalysisControls() {
        const rerender = debounce(() => {
            readAnalysisFilterInputs();
            renderAnalysis();
        }, 120);
        [
            "analysis-date-range",
            "analysis-start-date",
            "analysis-end-date",
            "analysis-asset-filter",
            "analysis-machine-filter",
            "analysis-machine-group-filter",
            "analysis-criticality-filter",
            "analysis-severity-filter",
            "analysis-production-line-filter",
            "analysis-lifecycle-filter",
            "analysis-quality-filter",
            "analysis-pareto-downtime-group",
            "analysis-pareto-workorder-group",
            "analysis-distribution-scale",
            "analysis-mttr-boxplot-group",
            "analysis-mttr-compare-mode",
            "analysis-mttr-compare-a",
            "analysis-mttr-compare-b",
            "analysis-mtbf-trend-group-by",
            "analysis-pm-threshold",
            "analysis-control-asset",
            "analysis-control-metric",
            "analysis-target-critical",
            "analysis-target-support",
            "analysis-target-facility",
        ].forEach((id) => {
            const node = document.getElementById(id);
            if (!node) return;
            node.addEventListener("change", rerender);
            if (node.type === "number" || node.type === "date") node.addEventListener("input", rerender);
        });
        document.getElementById("analysis-export-btn")?.addEventListener("click", exportAnalysisTables);
    }

    async function loadDowntimeView(forceReload = false) {
        if (forceReload || !state.downtimeData) {
            const payload = await fetchJson(`/api/downtime?${buildDowntimeParams().toString()}`);
            state.downtimeData = payload;
        }
        await loadDowntimeImportStatus();
        hydrateDowntimeFilterOptions(state.downtimeData || {});
        syncDowntimeInputs();
        renderDowntimeDashboard(state.downtimeData);
    }

    function buildDowntimeParams() {
        const params = new URLSearchParams();
        params.set("period", state.downtimeFilters.period || "all_years");
        params.set("work_orders_only", "1");
        if (state.downtimeFilters.period === "custom") {
            if (state.downtimeFilters.startDate) params.set("start", state.downtimeFilters.startDate);
            if (state.downtimeFilters.endDate) params.set("end", state.downtimeFilters.endDate);
        }
        return params;
    }

    async function loadDowntimeImportStatus() {
        try {
            state.downtimeImportStatus = await fetchJson("/api/downtime/import-work-orders");
        } catch (error) {
            state.downtimeImportStatus = {
                source_count: 0,
                using_uploaded_imports: false,
                sources: [],
                error: String(error?.message || error),
            };
        }
    }

    function readDowntimeFilterInputs() {
        const getValue = (id, fallback = "all") => document.getElementById(id)?.value || fallback;
        state.downtimeFilters.period = getValue("downtime-period-filter", "all_years");
        state.downtimeFilters.startDate = getValue("downtime-start-date", "");
        state.downtimeFilters.endDate = getValue("downtime-end-date", "");
        state.downtimeFilters.criticality = getValue("downtime-criticality-filter", "all");
        state.downtimeFilters.machineGroup = getValue("downtime-machine-group-filter", "all");
        state.downtimeFilters.location = getValue("downtime-location-filter", "all");
        state.downtimeFilters.status = getValue("downtime-status-filter", "all");
        state.downtimeFilters.search = getValue("downtime-search-filter", "").trim().toLowerCase();
    }

    function hydrateDowntimeFilterOptions(payload) {
        const filters = payload?.management?.filters || {};
        populateSelect("downtime-period-filter", DOWNTIME_PERIOD_OPTIONS, true);
        populateSelect(
            "downtime-criticality-filter",
            [{ value: "all", label: "All Criticalities" }, ...((filters.criticalities || []).map((value) => ({ value, label: value })))],
            true
        );
        populateSelect(
            "downtime-machine-group-filter",
            [{ value: "all", label: "All Machine Groups" }, ...((filters.machine_groups || []).map((value) => ({ value, label: value })))],
            true
        );
        populateSelect(
            "downtime-location-filter",
            [{ value: "all", label: "All Locations" }, ...((filters.locations || []).map((value) => ({ value, label: value })))],
            true
        );
        populateSelect(
            "downtime-status-filter",
            [{ value: "all", label: "All Statuses" }, ...((filters.statuses || []).map((value) => ({ value, label: value })))],
            true
        );
    }

    function syncDowntimeInputs() {
        const setValue = (id, value, fallback = "all") => {
            const node = document.getElementById(id);
            if (!node) return;
            const validValues = Array.from(node.options || []).map((option) => option.value);
            node.value = validValues.includes(String(value)) ? String(value) : fallback;
        };
        setValue("downtime-period-filter", state.downtimeFilters.period, "all_years");
        setValue("downtime-criticality-filter", state.downtimeFilters.criticality, "all");
        setValue("downtime-machine-group-filter", state.downtimeFilters.machineGroup, "all");
        setValue("downtime-location-filter", state.downtimeFilters.location, "all");
        setValue("downtime-status-filter", state.downtimeFilters.status, "all");
        const startNode = document.getElementById("downtime-start-date");
        const endNode = document.getElementById("downtime-end-date");
        const searchNode = document.getElementById("downtime-search-filter");
        if (startNode) startNode.value = state.downtimeFilters.startDate || "";
        if (endNode) endNode.value = state.downtimeFilters.endDate || "";
        if (searchNode) searchNode.value = state.downtimeFilters.search || "";
        const showCustomDates = state.downtimeFilters.period === "custom";
        document.getElementById("downtime-start-field")?.classList.toggle("hidden", !showCustomDates);
        document.getElementById("downtime-end-field")?.classList.toggle("hidden", !showCustomDates);
    }

    function renderDowntimeDashboard(payload) {
        if (!payload) return;
        const rows = getFilteredDowntimeRows(payload);
        renderDowntimeSourceStatus(payload);
        renderDowntimeAlerts(payload, rows);
        renderDowntimeSummary(rows);
        renderDowntimeTrend(rows);
        renderDowntimeBreakdowns(rows);
        renderDowntimeTable(rows, payload);
    }

    function getFilteredDowntimeRows(payload) {
        const rows = [...(payload?.management?.work_orders || [])];
        const { criticality, machineGroup, location, status, search } = state.downtimeFilters;
        const filtered = rows.filter((row) => {
            if (criticality !== "all" && String(row.criticality || "") !== criticality) return false;
            if (machineGroup !== "all" && String(row.machine_group || "") !== machineGroup) return false;
            if (location !== "all" && String(row.location || "") !== location) return false;
            if (status !== "all" && String(row.request_state || "") !== status) return false;
            if (search) {
                const haystack = [
                    row.work_order_id,
                    row.request_id,
                    row.asset_id,
                    row.machine_group,
                    row.machine_name,
                    row.location,
                    row.description,
                    row.translated_description,
                ].join(" ").toLowerCase();
                if (!haystack.includes(search)) return false;
            }
            return true;
        });
        return filtered.sort((a, b) => {
            const aTime = getDowntimeRowDate(a)?.getTime() || 0;
            const bTime = getDowntimeRowDate(b)?.getTime() || 0;
            return bTime - aTime;
        });
    }

    function renderDowntimeSourceStatus(payload) {
        const source = payload?.work_order_source || {};
        const importStatus = state.downtimeImportStatus || {};
        const sources = importStatus.sources || [];
        const summary = sources.length
            ? `${formatInteger(sources.length)} local work-order source file(s) loaded.`
            : "No local work-order downtime file is currently loaded.";
        const details = sources.length
            ? sources
                .slice(0, 3)
                .map((item) => `${escapeHtml(item.name)} | ${escapeHtml(formatShortDate(item.last_modified))} | ${escapeHtml(formatInteger(Math.round((item.size || 0) / 1024)))} KB`)
                .join("<br>")
            : "Import a local CSV/XLSX work-order export to populate this downtime tab.";
        const lastSynced = source.last_synced ? `<br><strong>Last synced:</strong> ${escapeHtml(formatShortDate(source.last_synced))}` : "";
        const errorLine = importStatus.error ? `<br><strong>Import status error:</strong> ${escapeHtml(importStatus.error)}` : "";
        setHtml(
            "downtime-source-status",
            `<strong>${escapeHtml(summary)}</strong><br>${escapeHtml(source.message || "No work-order downtime source connected yet.")}<br>${details}${lastSynced}${errorLine}`
        );
    }

    function renderDowntimeAlerts(payload, rows) {
        const notes = [];
        const availableRows = payload?.management?.work_orders || [];
        if (!availableRows.length) {
            notes.push(payload?.work_order_source?.message || "No local work-order downtime data is available yet.");
        } else if (!rows.length) {
            notes.push("No downtime work orders match the current filters.");
        }
        (payload?.management?.alerts || []).forEach((alert) => {
            if (alert?.message) notes.push(alert.message);
        });
        const node = document.getElementById("downtime-alerts");
        if (!node) return;
        node.innerHTML = notes.map((message) => `<div class="analysis-note">${escapeHtml(message)}</div>`).join("");
    }

    function renderDowntimeSummary(rows) {
        const ttrValues = rows.map((row) => row.ttr_hours).filter(isFiniteNumber).map(Number);
        const totalHours = ttrValues.length ? sum(ttrValues) : null;
        const criticalHours = rows
            .filter((row) => String(row.criticality || "").toLowerCase() === "critical")
            .map((row) => row.ttr_hours)
            .filter(isFiniteNumber)
            .map(Number);
        setText("downtime-total-work-orders", formatInteger(rows.length));
        setText("downtime-total-hours", totalHours === null ? "--" : formatAnalysisHours(totalHours));
        setText("downtime-median-mttr", formatAnalysisHours(median(ttrValues)));
        setText("downtime-mean-mttr", formatAnalysisHours(mean(ttrValues)));
        setText("downtime-open-work-orders", formatInteger(rows.filter((row) => row.is_open).length));
        setText("downtime-critical-hours", criticalHours.length ? formatAnalysisHours(sum(criticalHours)) : "--");
    }

    function renderDowntimeTrend(rows) {
        const trend = buildDowntimeTrendRows(rows);
        renderLineChart(
            "downtime-trend-chart",
            trend.map((bucket) => bucket.label),
            [{
                label: "Downtime Hours",
                data: trend.map((bucket) => round1(bucket.hours)),
                borderColor: "#0f766e",
                backgroundColor: "rgba(15, 118, 110, 0.10)",
                fill: true,
            }],
            "Hours"
        );
        setText(
            "downtime-trend-note",
            trend.length
                ? `${trend[0].bucket_mode === "day" ? "Daily" : "Monthly"} buckets based on work-order start dates. ${formatInteger(rows.length)} work order(s) included.`
                : "No dated work orders are available for the selected filters."
        );
    }

    function buildDowntimeTrendRows(rows) {
        const datedRows = rows
            .map((row) => ({ row, date: getDowntimeRowDate(row) }))
            .filter((item) => item.date instanceof Date && !Number.isNaN(item.date.getTime()));
        if (!datedRows.length) return [];
        const minTime = Math.min(...datedRows.map((item) => item.date.getTime()));
        const maxTime = Math.max(...datedRows.map((item) => item.date.getTime()));
        const daySpan = Math.max(0, Math.round((maxTime - minTime) / 86400000));
        const useDaily = daySpan <= 45;
        const buckets = new Map();
        datedRows.forEach(({ row, date }) => {
            const key = useDaily
                ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
                : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
            const label = useDaily
                ? date.toLocaleDateString(undefined, { day: "2-digit", month: "short" })
                : date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
            const bucket = buckets.get(key) || { key, label, hours: 0, count: 0, bucket_mode: useDaily ? "day" : "month" };
            bucket.hours += Number(row.ttr_hours || 0);
            bucket.count += 1;
            buckets.set(key, bucket);
        });
        return [...buckets.values()]
            .sort((a, b) => a.key.localeCompare(b.key))
            .map((bucket) => ({ ...bucket, hours: round1(bucket.hours) }));
    }

    function renderDowntimeBreakdowns(rows) {
        renderDowntimeBreakdownChart("downtime-criticality-chart", "downtime-criticality-table", rows, "criticality", "Criticality", "#8b5cf6");
        renderDowntimeBreakdownChart("downtime-machine-group-chart", "downtime-machine-group-table", rows, "machine_group", "Machine Group", "#2563eb");
        renderDowntimeBreakdownChart("downtime-location-chart", "downtime-location-table", rows, "location", "Location", "#f59e0b");
    }

    function renderDowntimeBreakdownChart(chartId, tableId, rows, field, label, color) {
        const aggregated = aggregateAnalysis(rows, field, "ttr_hours", "sum");
        renderHorizontalBarChart(
            chartId,
            aggregated.map((row) => row.label),
            aggregated.map((row) => round1(row.value)),
            "Downtime Hours",
            color,
            {
                tableId,
                tableHeaders: ["Rank", label, "Downtime"],
                tableRows: aggregated.map((row, index) => [formatInteger(index + 1), row.label, formatAnalysisHours(row.value)]),
                note: aggregated.length ? analysisTopListNote(aggregated.length, analysisGroupNoun(label)) : "No records available.",
            }
        );
    }

    function renderDowntimeTable(rows, payload) {
        const body = document.getElementById("downtime-table-body");
        if (!body) return;
        if (!rows.length) {
            const baseRows = payload?.management?.work_orders || [];
            body.innerHTML = `<tr><td colspan="9" class="empty-row">${escapeHtml(baseRows.length ? "No downtime work orders match the current filters." : "No local work-order downtime data is available yet.")}</td></tr>`;
            return;
        }
        body.innerHTML = rows.slice(0, 250).map((row) => {
            const description = row.translated_description || row.description || "--";
            const originalDescription = row.description && row.description !== description
                ? `<span class="table-subtext">${escapeHtml(row.description)}</span>`
                : "";
            return `
                <tr>
                    <td>${escapeHtml(formatShortDate(getDowntimeRowDate(row) || row.request_created_time || row.latest_event_time))}</td>
                    <td>${escapeHtml(row.work_order_id || "--")}</td>
                    <td>${escapeHtml(row.asset_id || "--")}</td>
                    <td>${escapeHtml(row.machine_group || row.machine_name || "--")}</td>
                    <td>${escapeHtml(row.location || "--")}</td>
                    <td>${escapeHtml(row.criticality || "--")}</td>
                    <td>${escapeHtml(formatAnalysisHours(row.ttr_hours))}</td>
                    <td><span class="status-pill ${downtimeStatusClass(row)}">${escapeHtml(row.request_state || (row.is_open ? "Open" : "Closed"))}</span></td>
                    <td>
                        <strong>${escapeHtml(description)}</strong>
                        ${originalDescription}
                    </td>
                </tr>
            `;
        }).join("");
    }

    function getDowntimeRowDate(row) {
        return parseDateValue(
            row?.actual_start_time
            || row?.start_time
            || row?.latest_event_time
            || row?.request_created_time
            || row?.actual_end_time
            || row?.end_time
        );
    }

    function downtimeStatusClass(row) {
        if (row?.requires_attention) return "status-overdue";
        if (row?.is_open) return "status-pending";
        return "status-done";
    }

    async function handleDowntimeImport(event) {
        event.preventDefault();
        const input = document.getElementById("downtime-import-file");
        const file = input?.files?.[0];
        if (!file) {
            setSpareImportStatus("downtime-import-status", "Choose a CSV, XLSX, or XLS file first.", "error");
            return;
        }
        const formData = new FormData();
        formData.append("file", file);
        formData.append("replace", "true");
        setSpareImportStatus("downtime-import-status", "Importing work-order file...", "");
        try {
            const response = await fetch("/api/downtime/import-work-orders", { method: "POST", body: formData });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) {
                throw new Error(result.message || `HTTP ${response.status}`);
            }
            if (input) input.value = "";
            setSpareImportStatus(
                "downtime-import-status",
                `${result.message || "Import complete."}${result.rows ? ` ${formatInteger(result.rows)} rows loaded.` : ""}`,
                "ok"
            );
            state.downtimeData = null;
            state.analysisLoaded = false;
            state.analysisRows = [];
            state.analysisIntervals = [];
            state.analysisFilteredRows = [];
            state.analysisFilteredIntervals = [];
            await loadDowntimeView(true);
        } catch (error) {
            setSpareImportStatus("downtime-import-status", `Import failed: ${error.message}`, "error");
        }
    }

    async function loadAnalysisView() {
        if (!state.analysisLoaded) {
            const payload = await fetchJson("/api/downtime?period=all_years&work_orders_only=1");
            const rows = payload?.management?.work_orders || [];
            state.analysisRows = rows.map(normalizeAnalysisRow);
            state.analysisIntervals = buildAnalysisMtbfIntervals(state.analysisRows);
            hydrateAnalysisFilters();
            state.analysisLoaded = true;
        }
        syncAnalysisFilterInputs();
        renderAnalysis();
    }

    function readAnalysisFilterInputs() {
        const getValue = (id, fallback = "all") => document.getElementById(id)?.value || fallback;
        state.analysisFilters.dateRange = getValue("analysis-date-range", "all");
        state.analysisFilters.startDate = getValue("analysis-start-date", "");
        state.analysisFilters.endDate = getValue("analysis-end-date", "");
        state.analysisFilters.assetId = getValue("analysis-asset-filter", "all");
        state.analysisFilters.machineName = getValue("analysis-machine-filter", "all");
        state.analysisFilters.machineGroup = getValue("analysis-machine-group-filter", "all");
        state.analysisFilters.criticalityGroup = getValue("analysis-criticality-filter", "all");
        state.analysisFilters.severityLevel = getValue("analysis-severity-filter", "all");
        state.analysisFilters.productionLine = getValue("analysis-production-line-filter", "all");
        state.analysisFilters.lifecycleState = getValue("analysis-lifecycle-filter", "all");
        state.analysisFilters.dataQualityFlag = getValue("analysis-quality-filter", "all");
        state.analysisFilters.paretoDowntimeGroupBy = getValue("analysis-pareto-downtime-group", "MachineName");
        state.analysisFilters.paretoWorkOrderGroupBy = getValue("analysis-pareto-workorder-group", "MachineName");
        state.analysisFilters.distributionScale = getValue("analysis-distribution-scale", "raw");
        state.analysisFilters.mttrBoxplotGroup = getValue("analysis-mttr-boxplot-group", "MachineGroup");
        state.analysisFilters.mttrTrendCompareMode = getValue("analysis-mttr-compare-mode", "");
        state.analysisFilters.mttrTrendCompareA = getValue("analysis-mttr-compare-a", "");
        state.analysisFilters.mttrTrendCompareB = getValue("analysis-mttr-compare-b", "");
        state.analysisFilters.mtbfTrendGroupBy = getValue("analysis-mtbf-trend-group-by", "MachineGroup");
        state.analysisFilters.pmThreshold = Number(getValue("analysis-pm-threshold", "168")) || 168;
        state.analysisFilters.controlAsset = getValue("analysis-control-asset", "");
        state.analysisFilters.controlMetric = getValue("analysis-control-metric", "DowntimeHours");
        state.analysisFilters.targets.critical = Number(getValue("analysis-target-critical", "24")) || 24;
        state.analysisFilters.targets.support = Number(getValue("analysis-target-support", "48")) || 48;
        state.analysisFilters.targets.facility = Number(getValue("analysis-target-facility", "72")) || 72;
        document.getElementById("analysis-view")?.classList.toggle("analysis-view-custom", state.analysisFilters.dateRange === "custom");
    }

    function syncAnalysisFilterInputs() {
        const setValue = (id, value) => {
            const node = document.getElementById(id);
            if (node && value !== undefined && value !== null) node.value = value;
        };
        Object.entries({
            "analysis-date-range": state.analysisFilters.dateRange,
            "analysis-start-date": state.analysisFilters.startDate,
            "analysis-end-date": state.analysisFilters.endDate,
            "analysis-asset-filter": state.analysisFilters.assetId,
            "analysis-machine-filter": state.analysisFilters.machineName,
            "analysis-machine-group-filter": state.analysisFilters.machineGroup,
            "analysis-criticality-filter": state.analysisFilters.criticalityGroup,
            "analysis-severity-filter": state.analysisFilters.severityLevel,
            "analysis-production-line-filter": state.analysisFilters.productionLine,
            "analysis-lifecycle-filter": state.analysisFilters.lifecycleState,
            "analysis-quality-filter": state.analysisFilters.dataQualityFlag,
            "analysis-pareto-downtime-group": state.analysisFilters.paretoDowntimeGroupBy,
            "analysis-pareto-workorder-group": state.analysisFilters.paretoWorkOrderGroupBy,
            "analysis-distribution-scale": state.analysisFilters.distributionScale,
            "analysis-mttr-boxplot-group": state.analysisFilters.mttrBoxplotGroup,
            "analysis-mttr-compare-mode": state.analysisFilters.mttrTrendCompareMode,
            "analysis-mttr-compare-a": state.analysisFilters.mttrTrendCompareA,
            "analysis-mttr-compare-b": state.analysisFilters.mttrTrendCompareB,
            "analysis-mtbf-trend-group-by": state.analysisFilters.mtbfTrendGroupBy,
            "analysis-pm-threshold": state.analysisFilters.pmThreshold,
            "analysis-control-asset": state.analysisFilters.controlAsset,
            "analysis-control-metric": state.analysisFilters.controlMetric,
            "analysis-target-critical": state.analysisFilters.targets.critical,
            "analysis-target-support": state.analysisFilters.targets.support,
            "analysis-target-facility": state.analysisFilters.targets.facility,
        }).forEach(([id, value]) => setValue(id, value));
        document.getElementById("analysis-view")?.classList.toggle("analysis-view-custom", state.analysisFilters.dateRange === "custom");
    }

    function hydrateAnalysisFilters() {
        const rows = state.analysisRows || [];
        const options = (field) => [...new Set(rows.map((row) => row[field]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
        populateAnalysisSelect("analysis-asset-filter", options("AssetID"), "All AssetIDs");
        populateAnalysisSelect("analysis-machine-filter", options("MachineName"), "All Machines");
        populateAnalysisSelect("analysis-machine-group-filter", options("MachineGroup"), "All Machine Groups");
        populateAnalysisSelect("analysis-criticality-filter", options("CriticalityGroup"), "All Criticalities");
        populateAnalysisSelect("analysis-severity-filter", options("SeverityLevel"), "All Severity Levels");
        populateAnalysisSelect("analysis-production-line-filter", options("ProductionLine"), "All Production Lines");
        populateAnalysisSelect("analysis-lifecycle-filter", options("LifecycleState"), "All Lifecycle States");
        populateAnalysisSelect("analysis-quality-filter", ["Valid", "Review", "Invalid"], "All Data Quality");
        hydrateControlAssetOptions();
    }

    function populateAnalysisSelect(id, values, allLabel) {
        const node = document.getElementById(id);
        if (!node) return;
        const current = node.value || "all";
        node.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>` + values.map((value) => (
            `<option value="${escapeHtml(String(value))}">${escapeHtml(String(value))}</option>`
        )).join("");
        node.value = values.map(String).includes(String(current)) ? current : "all";
    }

    function hydrateControlAssetOptions() {
        const node = document.getElementById("analysis-control-asset");
        if (!node) return;
        const assets = [...new Set(state.analysisRows.map((row) => row.AssetID).filter(Boolean))].sort();
        const machines = [...new Set(state.analysisRows.map((row) => row.MachineName).filter(Boolean))].sort();
        const current = node.value;
        node.innerHTML = [
            `<option value="">Select AssetID or MachineName</option>`,
            ...assets.map((asset) => `<option value="asset:${escapeHtml(asset)}">AssetID: ${escapeHtml(asset)}</option>`),
            ...machines.map((machine) => `<option value="machine:${escapeHtml(machine)}">Machine: ${escapeHtml(machine)}</option>`),
        ].join("");
        node.value = [...assets.map((asset) => `asset:${asset}`), ...machines.map((machine) => `machine:${machine}`)].includes(current)
            ? current
            : (assets[0] ? `asset:${assets[0]}` : "");
        state.analysisFilters.controlAsset = node.value;
    }

    function normalizeAnalysisRow(row) {
        const start = parseDateValue(row.actual_start_time || row.start_time || row.maintenance_start_time);
        const end = parseDateValue(row.actual_end_time || row.end_time || row.maintenance_end_time);
        const downtime = toFiniteNumber(row.ttr_hours ?? row.duration_hours ?? row.original_ttr_hours);
        const lifecycle = cleanAnalysisText(row.request_state || row.status || row.lifecycle_state || "Unknown");
        const openLifecycle = isOpenAnalysisLifecycle(lifecycle);
        const sourceMissingReasons = [
            ...(row.attention_reasons || []),
            ...(row.mttr_missing_reasons || []),
            ...(row.mtbf_missing_reasons || []),
        ].map(String).filter((reason) => {
            if (!openLifecycle) return true;
            return !/missing end date|missing actual end|missing or invalid ttr|invalid ttr|zero ttr/i.test(reason);
        });
        const reasonText = sourceMissingReasons.join(" ").toLowerCase();
        const woId = cleanAnalysisId(row.work_order_id || row.wo_id);
        const assetId = cleanAnalysisText(row.asset_id);
        const rawCriticality = cleanAnalysisText(row.criticality || row.normalized_criticality || row.raw_criticality);
        const endBeforeStart = Boolean(start && end && end < start);
        const negativeDuration = downtime !== null && downtime < 0;
        const missingWoId = !woId || /missing (work order|wo).*id|missing wo id/.test(reasonText);
        const missingClassification = !rawCriticality
            || ["unclassified", "unmapped", "unknown"].includes(rawCriticality.toLowerCase())
            || /missing (classification|criticality)/.test(reasonText);
        const missingInvalidTtr = negativeDuration
            || (!openLifecycle && downtime === null)
            || (!openLifecycle
                && /missing.*ttr|invalid.*ttr|missing.*downtime|invalid.*downtime/.test(reasonText));
        const missingReasons = [
            ...sourceMissingReasons,
            missingWoId ? "Missing WO ID" : "",
            missingClassification ? "MissingClassification" : "",
            missingInvalidTtr ? "Missing/Invalid TTR" : "",
            endBeforeStart ? "End date before start date" : "",
        ].filter(Boolean);
        let quality = "Valid";
        if (negativeDuration || endBeforeStart) quality = "Invalid";
        else if (missingReasons.length || !start || !assetId) quality = "Review";

        return {
            WO_ID: woId,
            RequestID: cleanAnalysisId(row.request_id || row.maintenance_order_id),
            AssetID: assetId,
            MachineName: cleanAnalysisText(row.asset_display_name || row.machine_name || row.machine_group || "Unknown"),
            MachineGroup: cleanAnalysisText(row.machine_group || row.machine_name || "Unknown"),
            CriticalityGroup: rawCriticality || "Unclassified",
            SeverityLevel: row.priority === null || row.priority === undefined || row.priority === "" ? "Unknown" : String(row.priority),
            ProductionLine: cleanAnalysisText(row.location || row.building || "Unassigned"),
            LifecycleState: lifecycle,
            MaintenanceType: cleanAnalysisText(row.job_trade || row.maintenance_type || "Unknown"),
            ActualStartDate: start,
            ActualEndDate: end,
            DowntimeHours: downtime !== null && downtime >= 0 ? downtime : null,
            MTTRHours: downtime !== null && downtime >= 0 ? downtime : null,
            LogDowntimeHours: downtime !== null && downtime >= 0 ? Math.log(downtime + 1) : null,
            DataQualityFlag: quality,
            MissingReasons: [...new Set(missingReasons)],
            MissingActualStart: !start,
            MissingActualEnd: !openLifecycle && !end,
            MissingAssetID: !assetId,
            MissingWOID: missingWoId,
            MissingClassification: missingClassification,
            MissingInvalidTTR: missingInvalidTtr,
            NegativeDuration: negativeDuration,
            EndBeforeStart: endBeforeStart,
            FinishedMissingEnd: !openLifecycle && /finished|closed|done|complete/i.test(lifecycle) && !end,
            OpenNoStart: /open|progress|new|confirm|rework/i.test(lifecycle) && !start,
            PMFlag: isPmMaintenance(row.job_trade || row.description || row.remarks),
        };
    }

    function buildAnalysisMtbfIntervals(rows) {
        const byAsset = new Map();
        rows.forEach((row) => {
            if (!row.AssetID || !row.ActualStartDate || !row.ActualEndDate) return;
            if (row.ActualEndDate <= row.ActualStartDate) return;
            if (!/finished|closed|done|complete/i.test(row.LifecycleState)) return;
            if (!byAsset.has(row.AssetID)) byAsset.set(row.AssetID, []);
            byAsset.get(row.AssetID).push(row);
        });

        const intervals = [];
        byAsset.forEach((assetRows, assetId) => {
            const sorted = [...assetRows].sort((a, b) => a.ActualStartDate - b.ActualStartDate);
            for (let i = 1; i < sorted.length; i++) {
                const previous = sorted[i - 1];
                const next = sorted[i];
                const gap = (next.ActualStartDate - previous.ActualEndDate) / 3600000;
                if (!Number.isFinite(gap) || gap <= 0) continue;
                const pmBeforeNext = sorted.some((candidate) => (
                    candidate.PMFlag
                    && candidate.ActualStartDate >= previous.ActualEndDate
                    && candidate.ActualStartDate <= next.ActualStartDate
                ));
                intervals.push({
                    FailureIntervalID: `${assetId}-${i}`,
                    FailureSequence: i,
                    PreviousWOID: previous.WO_ID,
                    NextWOID: next.WO_ID,
                    AssetID: assetId,
                    MachineName: next.MachineName,
                    MachineGroup: next.MachineGroup,
                    CriticalityGroup: next.CriticalityGroup,
                    SeverityLevel: next.SeverityLevel,
                    ProductionLine: next.ProductionLine,
                    LifecycleState: next.LifecycleState,
                    MaintenanceType: next.MaintenanceType,
                    PeriodLabel: formatAnalysisMonth(next.ActualStartDate),
                    ActualStartDate: next.ActualStartDate,
                    PreviousFailureEndDate: previous.ActualEndDate,
                    NextFailureStartDate: next.ActualStartDate,
                    MTBFHours: gap,
                    MTBFDays: gap / 24,
                    NextDowntimeHours: next.DowntimeHours,
                    NextMTTRHours: next.MTTRHours,
                    PMCompletedBeforeNextFailure: pmBeforeNext ? "Yes" : "No",
                    MTBFCategory: "",
                    DataQualityFlag: "Valid",
                });
            }
        });
        return intervals;
    }

    function renderAnalysis() {
        if (state.activeView !== "analysis" || !state.analysisLoaded) return;
        readAnalysisFilterInputs();
        const rows = filterAnalysisRows(state.analysisRows);
        const intervals = filterAnalysisIntervals(state.analysisIntervals, rows);
        state.analysisFilteredRows = rows;
        state.analysisFilteredIntervals = intervals;

        renderAnalysisSummary(rows, intervals);
        renderParetoSections(rows);
        renderDistributionSections(rows);
        renderSeverityValidation(rows);
        renderMttrAnalysis(rows);
        renderMtbfAnalysis(intervals);
        renderPmEffectiveness(intervals);
        renderControlChart(rows, intervals);
        renderTargetCheck(rows);
        renderDataQualityAnalysis(rows);
        renderRegressionPanel(rows);
    }

    function filterAnalysisRows(rows) {
        const range = getAnalysisDateRange();
        const f = state.analysisFilters;
        return rows.filter((row) => {
            if (range.start && (!row.ActualStartDate || row.ActualStartDate < range.start)) return false;
            if (range.end && (!row.ActualStartDate || row.ActualStartDate > range.end)) return false;
            if (!matchesAnalysisFilter(row.AssetID, f.assetId)) return false;
            if (!matchesAnalysisFilter(row.MachineName, f.machineName)) return false;
            if (!matchesAnalysisFilter(row.MachineGroup, f.machineGroup)) return false;
            if (!matchesAnalysisFilter(row.CriticalityGroup, f.criticalityGroup)) return false;
            if (!matchesAnalysisFilter(row.SeverityLevel, f.severityLevel)) return false;
            if (!matchesAnalysisFilter(row.ProductionLine, f.productionLine)) return false;
            if (!matchesAnalysisFilter(row.LifecycleState, f.lifecycleState)) return false;
            if (!matchesAnalysisFilter(row.DataQualityFlag, f.dataQualityFlag)) return false;
            return true;
        });
    }

    function filterAnalysisIntervals(intervals, filteredRows) {
        const allowedKeys = new Set(filteredRows.map((row) => `${row.AssetID}||${row.ActualStartDate?.toISOString() || ""}`));
        const f = state.analysisFilters;
        return intervals.filter((row) => {
            if (!allowedKeys.has(`${row.AssetID}||${row.ActualStartDate?.toISOString() || ""}`)) return false;
            if (!matchesAnalysisFilter(row.AssetID, f.assetId)) return false;
            if (!matchesAnalysisFilter(row.MachineName, f.machineName)) return false;
            if (!matchesAnalysisFilter(row.MachineGroup, f.machineGroup)) return false;
            if (!matchesAnalysisFilter(row.CriticalityGroup, f.criticalityGroup)) return false;
            if (!matchesAnalysisFilter(row.SeverityLevel, f.severityLevel)) return false;
            if (!matchesAnalysisFilter(row.ProductionLine, f.productionLine)) return false;
            if (!matchesAnalysisFilter(row.LifecycleState, f.lifecycleState)) return false;
            if (!matchesAnalysisFilter(row.DataQualityFlag, f.dataQualityFlag)) return false;
            return row.DataQualityFlag === "Valid";
        });
    }

    function matchesAnalysisFilter(value, filterValue) {
        return !filterValue || filterValue === "all" || String(value || "") === String(filterValue);
    }

    function getAnalysisDateRange() {
        const now = new Date();
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        const f = state.analysisFilters;
        if (f.dateRange === "ytd") return { start: new Date(now.getFullYear(), 0, 1), end: endOfToday };
        if (f.dateRange === "last12") {
            const start = new Date(now);
            start.setFullYear(start.getFullYear() - 1);
            return { start, end: endOfToday };
        }
        if (f.dateRange === "previous_year") return { start: new Date(now.getFullYear() - 1, 0, 1), end: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59) };
        if (f.dateRange === "custom") {
            return {
                start: f.startDate ? new Date(`${f.startDate}T00:00:00`) : null,
                end: f.endDate ? new Date(`${f.endDate}T23:59:59`) : null,
            };
        }
        return { start: null, end: null };
    }

    function renderAnalysisSummary(rows, intervals) {
        const downtimeValues = valuesOf(rows, "DowntimeHours");
        const mttrValues = valuesOf(rows, "MTTRHours");
        const mtbfValues = valuesOf(intervals, "MTBFHours");
        setText("analysis-total-work-orders", formatInteger(rows.length));
        setText("analysis-total-downtime", formatAnalysisHours(sum(downtimeValues)));
        setText("analysis-median-downtime", formatAnalysisHours(median(downtimeValues)));
        setText("analysis-mean-downtime", formatAnalysisHours(mean(downtimeValues)));
        setText("analysis-median-mttr", formatAnalysisHours(median(mttrValues)));
        setText("analysis-mean-mttr", formatAnalysisHours(mean(mttrValues)));
        setText("analysis-median-mtbf", formatAnalysisHours(median(mtbfValues)));
        setText("analysis-mean-mtbf", formatAnalysisHours(mean(mtbfValues)));
        setText("analysis-valid-mtbf-count", formatInteger(intervals.length));
        setText("analysis-missing-info-count", formatInteger(rows.filter((row) => row.DataQualityFlag !== "Valid" || row.MissingReasons.length).length));
    }

    function renderParetoSections(rows) {
        const downtimeGroupBy = state.analysisFilters.paretoDowntimeGroupBy === "MachineGroup" ? "MachineGroup" : "MachineName";
        const workOrderGroupBy = state.analysisFilters.paretoWorkOrderGroupBy === "MachineGroup" ? "MachineGroup" : "MachineName";
        const downtimeLabel = downtimeGroupBy === "MachineGroup" ? "MachineGroup" : "MachineName";
        const workOrderLabel = workOrderGroupBy === "MachineGroup" ? "MachineGroup" : "MachineName";

        setText("analysis-pareto-downtime-title", `Total Downtime by ${downtimeLabel}`);
        setText(
            "analysis-pareto-downtime-subtitle",
            downtimeGroupBy === "MachineGroup"
                ? `Top ${ANALYSIS_TOP_LIST_LIMIT} machine groups by downtime with the full ranking below.`
                : `Top ${ANALYSIS_TOP_LIST_LIMIT} machine names by downtime with the full ranking below.`
        );
        setText("analysis-pareto-workorder-title", `Work Orders by ${workOrderLabel}`);
        setText(
            "analysis-pareto-workorder-subtitle",
            workOrderGroupBy === "MachineGroup"
                ? `Top ${ANALYSIS_TOP_LIST_LIMIT} machine groups by work-order count with the full ranking below.`
                : `Top ${ANALYSIS_TOP_LIST_LIMIT} machine names by work-order count with the full ranking below.`
        );

        renderParetoChart("analysis-pareto-machine-downtime", "analysis-pareto-machine-downtime-table", aggregateAnalysis(rows, downtimeGroupBy, "DowntimeHours", "sum"), "Downtime Hours");
        renderParetoChart("analysis-pareto-machine-count", "analysis-pareto-machine-count-table", aggregateAnalysis(rows, workOrderGroupBy, "WO_ID", "count"), "Work Orders");
    }

    function renderDistributionSections(rows) {
        const scale = state.analysisFilters.distributionScale;
        const values = rows.map((row) => scale === "log" ? row.LogDowntimeHours : row.DowntimeHours).filter(isFiniteNumber);
        renderHistogramChart("analysis-histogram-downtime", values, scale === "log" ? "LogDowntimeHours" : "DowntimeHours");
        drawBoxplot("analysis-boxplot-severity", buildBoxplotGroups(rows, "SeverityLevel", "DowntimeHours"), "DowntimeHours", {
            tableId: "analysis-boxplot-severity-table",
            groupLabel: "SeverityLevel",
            valueFormatter: formatAnalysisHours,
        });
        drawBoxplot("analysis-boxplot-criticality", buildBoxplotGroups(rows, "CriticalityGroup", "DowntimeHours"), "DowntimeHours", {
            tableId: "analysis-boxplot-criticality-table",
            groupLabel: "CriticalityGroup",
            valueFormatter: formatAnalysisHours,
        });
    }

    function renderSeverityValidation(rows) {
        const groups = buildGroupStats(rows, "SeverityLevel", "DowntimeHours")
            .sort((a, b) => Number(a.label) - Number(b.label));
        const kw = kruskalWallis(groups.map((group) => group.values));
        renderBarChart("analysis-severity-summary-chart", groups.map((g) => g.label), [
            { label: "Median Downtime", data: groups.map((g) => round1(g.median)), backgroundColor: "#8b5cf6" },
            { label: "Mean Downtime", data: groups.map((g) => round1(g.mean)), backgroundColor: "#3b82f6" },
        ], "Hours");
        const interpretation = Number.isFinite(kw.pValue)
            ? (kw.pValue < 0.05 ? "Downtime differs significantly between severity levels." : "No strong statistical difference detected between severity levels.")
            : "Not enough severity groups with valid downtime values for Kruskal-Wallis testing.";
        setHtml("analysis-severity-test", `<strong>Kruskal-Wallis:</strong> H=${formatStat(kw.statistic)}, p=${formatP(kw.pValue)}. ${escapeHtml(interpretation)}`);
        renderMiniTable("analysis-severity-table", ["SeverityLevel", "Count", "Median", "Mean"], groups.map((g) => [g.label, g.count, formatAnalysisHours(g.median), formatAnalysisHours(g.mean)]));
    }

    function renderMttrAnalysis(rows) {
        const groupBy = state.analysisFilters.mttrBoxplotGroup;
        const machineStats = buildGroupStats(rows, "MachineName", "MTTRHours");
        const rankedMedian = [...machineStats].sort((a, b) => (b.median || 0) - (a.median || 0));
        renderHorizontalBarChart(
            "analysis-mttr-median-machine",
            rankedMedian.map((g) => g.label),
            rankedMedian.map((g) => round1(g.median)),
            "Median MTTR (hrs)",
            "#8b5cf6",
            {
                tableId: "analysis-mttr-median-machine-table",
                tableHeaders: ["Rank", "MachineName", "Work Orders", "Median MTTR", "Mean MTTR", "Max MTTR"],
                tableRows: rankedMedian.map((g, index) => [
                    formatInteger(index + 1),
                    g.label,
                    formatInteger(g.count),
                    formatAnalysisHours(g.median),
                    formatAnalysisHours(g.mean),
                    formatAnalysisHours(g.max),
                ]),
                note: analysisTopListNote(rankedMedian.length, "machines"),
            }
        );
        setText("analysis-mttr-boxplot-title", `MTTR Boxplot by ${groupBy}`);
        setText("analysis-mttr-boxplot-subtitle", `Top ${ANALYSIS_TOP_LIST_LIMIT} by work-order count with the full ${groupBy} list below.`);
        drawBoxplot("analysis-boxplot-mttr", buildBoxplotGroups(rows, groupBy, "MTTRHours"), "MTTRHours", {
            tableId: "analysis-boxplot-mttr-table",
            groupLabel: groupBy,
            valueFormatter: formatAnalysisHours,
        });
        hydrateMttrTrendCompareOptions(rows);
        renderMttrTrendChart(rows);
    }

    function renderMtbfAnalysis(intervals) {
        const machineStats = buildGroupStats(intervals, "MachineName", "MTBFHours");
        const groupStats = buildGroupStats(intervals, "MachineGroup", "MTBFHours");
        const critStats = buildGroupStats(intervals, "CriticalityGroup", "MTBFHours");
        setText("analysis-mtbf-median-machine", formatAnalysisHours(median(machineStats.map((g) => g.median).filter(isFiniteNumber))));
        setText("analysis-mtbf-mean-machine", formatAnalysisHours(mean(machineStats.map((g) => g.mean).filter(isFiniteNumber))));
        setText("analysis-mtbf-median-group", formatAnalysisHours(median(groupStats.map((g) => g.median).filter(isFiniteNumber))));
        setText("analysis-mtbf-median-criticality", formatAnalysisHours(median(critStats.map((g) => g.median).filter(isFiniteNumber))));
        renderBarChart("analysis-mtbf-by-criticality", critStats.map((g) => g.label), [{ label: "Median MTBF", data: critStats.map((g) => round1(g.median)), backgroundColor: "#0f766e" }], "Hours");
        const mtbfGroupBy = state.analysisFilters.mtbfTrendGroupBy === "MachineName" ? "MachineName" : "MachineGroup";
        setText("analysis-mtbf-trend-title", `MTBF Trend by ${mtbfGroupBy}`);
        setText(
            "analysis-mtbf-trend-subtitle",
            mtbfGroupBy === "MachineName"
                ? `Top ${ANALYSIS_TOP_LIST_LIMIT} machine names by valid interval count with the full list below.`
                : `Top ${ANALYSIS_TOP_LIST_LIMIT} machine groups by valid interval count with the full list below.`
        );
        const trendGroups = buildGroupStats(intervals, mtbfGroupBy, "MTBFHours")
            .sort((a, b) => (b.count - a.count) || ((b.median || 0) - (a.median || 0)) || String(a.label).localeCompare(String(b.label)));
        renderComparativeTrend("analysis-mtbf-trend-group", intervals, mtbfGroupBy, trendGroups);
        renderGroupStatsTable("analysis-mtbf-trend-group-table", mtbfGroupBy, trendGroups, "MTBFHours", formatAnalysisHours);
    }

    function renderPmEffectiveness(intervals) {
        const threshold = state.analysisFilters.pmThreshold || 168;
        const rows = intervals.map((row) => ({ ...row, MTBFCategory: row.MTBFHours >= threshold ? "Good" : "Poor" }));
        const yes = rows.filter((row) => row.PMCompletedBeforeNextFailure === "Yes").map((row) => row.MTBFHours);
        const no = rows.filter((row) => row.PMCompletedBeforeNextFailure === "No").map((row) => row.MTBFHours);
        const categories = ["Yes", "No"];
        const good = categories.map((cat) => rows.filter((row) => row.PMCompletedBeforeNextFailure === cat && row.MTBFCategory === "Good").length);
        const poor = categories.map((cat) => rows.filter((row) => row.PMCompletedBeforeNextFailure === cat && row.MTBFCategory === "Poor").length);
        renderBarChart("analysis-pm-category-chart", categories, [
            { label: "Good MTBF", data: good, backgroundColor: "#10b981" },
            { label: "Poor MTBF", data: poor, backgroundColor: "#ef4444" },
        ], "Intervals");
        const mw = mannWhitneyUTest(yes, no);
        const chi = chiSquareTest([[good[0], poor[0]], [good[1], poor[1]]]);
        const better = median(yes) > median(no) ? "PM completion appears associated with better MTBF in this filtered view." : "PM completion does not appear higher than non-PM intervals in this filtered view.";
        const note = rows.length
            ? `<strong>Mann-Whitney:</strong> U=${formatStat(mw.u)}, p=${formatP(mw.pValue)}. <strong>Chi-square:</strong> X2=${formatStat(chi.statistic)}, p=${formatP(chi.pValue)}. ${escapeHtml(better)} This does not prove causation.`
            : "No valid MTBF intervals available for PM effectiveness analysis.";
        setHtml("analysis-pm-test", note);
        renderMiniTable("analysis-pm-table", ["PM Before Next Failure", "Count", "Median MTBF", "Mean MTBF"], [
            ["Yes", yes.length, formatAnalysisHours(median(yes)), formatAnalysisHours(mean(yes))],
            ["No", no.length, formatAnalysisHours(median(no)), formatAnalysisHours(mean(no))],
        ]);
    }

    function renderControlChart(rows, intervals) {
        const selection = state.analysisFilters.controlAsset;
        const metric = state.analysisFilters.controlMetric;
        let values = [];
        if (selection) {
            const [type, rawValue] = selection.split(/:(.*)/s);
            if (metric === "MTBFHours") {
                values = intervals.filter((row) => type === "asset" ? row.AssetID === rawValue : row.MachineName === rawValue)
                    .sort((a, b) => a.ActualStartDate - b.ActualStartDate)
                    .map((row) => ({ label: row.PeriodLabel || String(row.FailureSequence), value: row.MTBFHours }));
            } else {
                const field = metric === "MTTRHours" ? "MTTRHours" : "DowntimeHours";
                values = rows.filter((row) => type === "asset" ? row.AssetID === rawValue : row.MachineName === rawValue)
                    .filter((row) => isFiniteNumber(row[field]))
                    .sort((a, b) => a.ActualStartDate - b.ActualStartDate)
                    .map((row, index) => ({ label: row.ActualStartDate ? formatAnalysisMonth(row.ActualStartDate) : `#${index + 1}`, value: row[field] }));
            }
        }
        const control = buildImr(values);
        renderControlLineChart("analysis-i-chart", control.individuals, "Individual Value", control.center, control.ucl, control.lcl);
        renderControlLineChart("analysis-mr-chart", control.movingRanges, "Moving Range", control.mrCenter, control.mrUcl, 0);
        setHtml("analysis-control-alert", values.length < 2
            ? "Select an asset or machine with at least two values to calculate I-MR limits."
            : `<strong>${control.outOfControl.length}</strong> out-of-control point(s) detected for ${escapeHtml(metric)}.`);
    }

    function renderTargetCheck(rows) {
        const targets = state.analysisFilters.targets;
        const validRows = rows.filter((row) => isFiniteNumber(row.MTTRHours));
        const categories = ["Critical", "Support", "Facility"];
        const summary = categories.map((category) => {
            const target = category === "Critical" ? targets.critical : (category === "Support" ? targets.support : targets.facility);
            const items = validRows.filter((row) => targetCategory(row.CriticalityGroup) === category);
            const exceeding = items.filter((row) => row.MTTRHours > target);
            const pct = items.length ? (exceeding.length / items.length) * 100 : 0;
            return {
                category, target, count: items.length, exceeding: exceeding.length, pct,
                median: median(items.map((row) => row.MTTRHours)),
                status: pct <= 10 ? "On target" : (pct <= 25 ? "Watch" : "Off target"),
            };
        });
        renderBarChart("analysis-target-chart", summary.map((row) => row.category), [
            { label: "% Exceeding Target", data: summary.map((row) => round1(row.pct)), backgroundColor: "#f59e0b" },
        ], "%");
        renderMiniTable("analysis-target-table", ["Group", "Target", "Count", "Exceeding", "% Exceeding", "Median MTTR", "Status"], summary.map((row) => [
            row.category, formatAnalysisHours(row.target), row.count, row.exceeding, `${formatNumber(row.pct, 1)}%`, formatAnalysisHours(row.median), row.status,
        ]));
    }

    function renderDataQualityAnalysis(rows) {
        const valid = rows.filter((row) => row.DataQualityFlag === "Valid").length;
        const review = rows.filter((row) => row.DataQualityFlag === "Review").length;
        const invalid = rows.filter((row) => row.DataQualityFlag === "Invalid").length;
        const issues = [
            ["Missing WO ID", rows.filter((row) => row.MissingWOID).length],
            ["Missing Actual Start Date", rows.filter((row) => row.MissingActualStart).length],
            ["Missing Actual End Date", rows.filter((row) => row.MissingActualEnd).length],
            ["Missing AssetID", rows.filter((row) => row.MissingAssetID).length],
            ["MissingClassification", rows.filter((row) => row.MissingClassification).length],
            ["Missing/Invalid TTR", rows.filter((row) => row.MissingInvalidTTR).length],
            ["Negative Duration", rows.filter((row) => row.NegativeDuration).length],
            ["Finished Missing End Date", rows.filter((row) => row.FinishedMissingEnd).length],
            ["Open No Start Date", rows.filter((row) => row.OpenNoStart).length],
            ["End Date Before Start", rows.filter((row) => row.EndBeforeStart).length],
        ].sort((a, b) => b[1] - a[1]);
        setText("analysis-quality-valid", formatInteger(valid));
        setText("analysis-quality-review", formatInteger(review));
        setText("analysis-quality-invalid", formatInteger(invalid));
        setText("analysis-missing-start", formatInteger(issues.find(([name]) => name === "Missing Actual Start Date")?.[1] || 0));
        setText("analysis-missing-end", formatInteger(issues.find(([name]) => name === "Missing Actual End Date")?.[1] || 0));
        setText("analysis-missing-asset", formatInteger(issues.find(([name]) => name === "Missing AssetID")?.[1] || 0));
        setText("analysis-missing-wo", formatInteger(issues.find(([name]) => name === "Missing WO ID")?.[1] || 0));
        setText("analysis-missing-classification", formatInteger(issues.find(([name]) => name === "MissingClassification")?.[1] || 0));
        setText("analysis-missing-ttr", formatInteger(issues.find(([name]) => name === "Missing/Invalid TTR")?.[1] || 0));
        setText("analysis-negative-duration", formatInteger(issues.find(([name]) => name === "Negative Duration")?.[1] || 0));
        setText("analysis-open-no-start", formatInteger(issues.find(([name]) => name === "Open No Start Date")?.[1] || 0));
        renderHorizontalBarChart("analysis-quality-pareto", issues.map(([name]) => name), issues.map(([, count]) => count), "Records", "#f59e0b");
        const affected = rows.filter((row) => row.DataQualityFlag !== "Valid" || row.MissingReasons.length);
        renderMiniTable("analysis-quality-table", ["WO_ID", "AssetID", "MachineName", "Quality", "Issues"], affected.map((row) => [
            row.WO_ID || row.RequestID || "--", row.AssetID || "--", row.MachineName, row.DataQualityFlag, row.MissingReasons.join(", ") || "Review required",
        ]));
    }

    function renderRegressionPanel(rows) {
        const validCount = rows.filter((row) => isFiniteNumber(row.LogDowntimeHours)).length;
        setHtml("analysis-regression-note", `Regression is optional and no in-dashboard regression library is currently bundled. ${formatInteger(validCount)} valid LogDowntimeHours records are available for export. Regression results are exploratory and should be validated in Minitab or another statistical package before formal decision-making.`);
    }

    function setHtml(id, html) {
        const node = document.getElementById(id);
        if (node) node.innerHTML = html;
    }

    function cleanAnalysisText(value) {
        const text = String(value ?? "").trim();
        return text && text !== "--" ? text : "";
    }

    function cleanAnalysisId(value) {
        return cleanAnalysisText(value);
    }

    function toFiniteNumber(value) {
        if (value === null || value === undefined || String(value).trim() === "") return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function isFiniteNumber(value) {
        if (value === null || value === undefined || String(value).trim() === "") return false;
        return Number.isFinite(Number(value));
    }

    function parseDateValue(value) {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function isPmMaintenance(value) {
        const text = String(value || "").toLowerCase();
        return text.includes("preventive") || text.includes("planned") || text.includes("scheduled") || /\bpm\b/.test(text);
    }

    function isOpenAnalysisLifecycle(value) {
        const text = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
        return ["new", "in progress", "inprogress", "confirm", "rework", "open", "pending", "draft"].includes(text);
    }

    function formatAnalysisMonth(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Unknown";
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    function formatAnalysisHours(value) {
        if (!isFiniteNumber(value)) return "--";
        return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs`;
    }

    function round1(value) {
        return isFiniteNumber(value) ? Math.round(Number(value) * 10) / 10 : 0;
    }

    function sum(values) {
        return values.reduce((total, value) => total + Number(value || 0), 0);
    }

    function mean(values) {
        const valid = values.filter(isFiniteNumber).map(Number);
        return valid.length ? sum(valid) / valid.length : null;
    }

    function median(values) {
        const valid = values.filter(isFiniteNumber).map(Number).sort((a, b) => a - b);
        if (!valid.length) return null;
        const mid = Math.floor(valid.length / 2);
        return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
    }

    function quantile(values, q) {
        const valid = values.filter(isFiniteNumber).map(Number).sort((a, b) => a - b);
        if (!valid.length) return null;
        const pos = (valid.length - 1) * q;
        const base = Math.floor(pos);
        const rest = pos - base;
        return valid[base + 1] !== undefined ? valid[base] + rest * (valid[base + 1] - valid[base]) : valid[base];
    }

    function valuesOf(rows, field) {
        return rows.map((row) => row[field]).filter(isFiniteNumber).map(Number);
    }

    function aggregateAnalysis(rows, field, valueField, mode) {
        const map = new Map();
        rows.forEach((row) => {
            const label = row[field] || "Unknown";
            if (!map.has(label)) map.set(label, { label, value: 0, count: 0 });
            const bucket = map.get(label);
            bucket.count += 1;
            bucket.value += mode === "count" ? 1 : Number(row[valueField] || 0);
        });
        return [...map.values()].sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)));
    }

    function buildGroupStats(rows, groupField, valueField) {
        const map = new Map();
        rows.forEach((row) => {
            const value = row[valueField];
            if (!isFiniteNumber(value)) return;
            const label = row[groupField] || "Unknown";
            if (!map.has(label)) map.set(label, []);
            map.get(label).push(Number(value));
        });
        return [...map.entries()].map(([label, values]) => ({
            label,
            values,
            count: values.length,
            median: median(values),
            mean: mean(values),
            q1: quantile(values, 0.25),
            q3: quantile(values, 0.75),
            min: Math.min(...values),
            max: Math.max(...values),
        }));
    }

    function buildBoxplotGroups(rows, groupField, valueField) {
        return buildGroupStats(rows, groupField, valueField)
            .sort((a, b) => (b.count - a.count) || ((b.median || 0) - (a.median || 0)));
    }

    function buildPeriodSeries(rows, dateField, valueField, mode = "median") {
        const map = new Map();
        rows.forEach((row) => {
            if (!row[dateField] || !isFiniteNumber(row[valueField])) return;
            const key = formatAnalysisMonth(row[dateField]);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(Number(row[valueField]));
        });
        const labels = [...map.keys()].sort();
        return {
            labels,
            values: labels.map((label) => round1(mode === "mean" ? mean(map.get(label)) : median(map.get(label)))),
        };
    }

    function getAnalysisYearOptions(rows) {
        return [...new Set(rows
            .map((row) => row.ActualStartDate)
            .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
            .map((date) => String(date.getFullYear())))]
            .sort()
            .map((year) => ({ value: year, label: year }));
    }

    function getAnalysisMonthOptions(rows) {
        return [...new Set(rows
            .map((row) => row.ActualStartDate)
            .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
            .map(formatAnalysisMonth))]
            .sort()
            .map((month) => ({ value: month, label: formatAnalysisMonthLabel(month) }));
    }

    function formatAnalysisMonthLabel(monthKey) {
        const [year, month] = String(monthKey || "").split("-").map(Number);
        if (!year || !month) return String(monthKey || "Unknown");
        return new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    }

    function formatAnalysisShortMonth(monthIndex) {
        return new Date(2026, monthIndex, 1).toLocaleDateString("en-GB", { month: "short" });
    }

    function setAnalysisSelectOptions(id, options, preferredValue, fallbackValue) {
        const node = document.getElementById(id);
        if (!node) return "";
        node.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
        const values = options.map((option) => String(option.value));
        const next = values.includes(String(preferredValue)) ? String(preferredValue) : (fallbackValue && values.includes(String(fallbackValue)) ? String(fallbackValue) : (values[0] || ""));
        node.value = next;
        return next;
    }

    function hydrateMttrTrendCompareOptions(rows) {
        const mode = state.analysisFilters.mttrTrendCompareMode;
        document.querySelectorAll(".analysis-mttr-compare-control").forEach((node) => {
            node.classList.toggle("is-hidden", mode !== "years" && mode !== "months");
        });
        if (mode !== "years" && mode !== "months") return;
        const options = mode === "years" ? getAnalysisYearOptions(rows) : getAnalysisMonthOptions(rows);
        const fallbackA = options[Math.max(0, options.length - 2)]?.value || options[0]?.value || "";
        const fallbackB = options[Math.max(0, options.length - 1)]?.value || fallbackA;
        state.analysisFilters.mttrTrendCompareA = setAnalysisSelectOptions("analysis-mttr-compare-a", options, state.analysisFilters.mttrTrendCompareA, fallbackA);
        state.analysisFilters.mttrTrendCompareB = setAnalysisSelectOptions("analysis-mttr-compare-b", options, state.analysisFilters.mttrTrendCompareB, fallbackB);
    }

    function medianForRows(rows, valueField) {
        const values = rows.map((row) => row[valueField]).filter(isFiniteNumber);
        return values.length ? round1(median(values)) : 0;
    }

    function renderMttrTrendChart(rows) {
        const mode = state.analysisFilters.mttrTrendCompareMode;
        if (mode === "years") {
            const yearA = state.analysisFilters.mttrTrendCompareA;
            const yearB = state.analysisFilters.mttrTrendCompareB;
            const years = [...new Set([yearA, yearB].filter(Boolean))];
            const labels = Array.from({ length: 12 }, (_, index) => formatAnalysisShortMonth(index));
            const colors = ["#0f766e", "#2563eb"];
            const datasets = years.map((year, index) => ({
                label: year,
                data: Array.from({ length: 12 }, (_, monthIndex) => medianForRows(rows.filter((row) => row.ActualStartDate && String(row.ActualStartDate.getFullYear()) === String(year) && row.ActualStartDate.getMonth() === monthIndex), "MTTRHours")),
                borderColor: colors[index % colors.length],
                backgroundColor: hexToRgba(colors[index % colors.length], 0.10),
                fill: true,
            }));
            setText("analysis-mttr-trend-title", "MTTR Trend - Year Compare");
            setText("analysis-mttr-trend-subtitle", "Median MTTR by month for the selected years.");
            renderLineChart("analysis-mttr-trend", labels, datasets, "Hours");
            return;
        }
        if (mode === "months") {
            const monthA = state.analysisFilters.mttrTrendCompareA;
            const monthB = state.analysisFilters.mttrTrendCompareB;
            const months = [...new Set([monthA, monthB].filter(Boolean))];
            const maxDays = Math.max(31, ...months.map((monthKey) => {
                const [year, month] = String(monthKey).split("-").map(Number);
                return year && month ? new Date(year, month, 0).getDate() : 31;
            }));
            const labels = Array.from({ length: maxDays }, (_, index) => `Day ${index + 1}`);
            const colors = ["#0f766e", "#2563eb"];
            const datasets = months.map((monthKey, index) => ({
                label: formatAnalysisMonthLabel(monthKey),
                data: labels.map((_, dayIndex) => medianForRows(rows.filter((row) => row.ActualStartDate && formatAnalysisMonth(row.ActualStartDate) === monthKey && row.ActualStartDate.getDate() === dayIndex + 1), "MTTRHours")),
                borderColor: colors[index % colors.length],
                backgroundColor: hexToRgba(colors[index % colors.length], 0.10),
                fill: true,
            }));
            setText("analysis-mttr-trend-title", "MTTR Trend - Month Compare");
            setText("analysis-mttr-trend-subtitle", "Median MTTR by day for the selected months.");
            renderLineChart("analysis-mttr-trend", labels, datasets, "Hours");
            return;
        }
        const trend = buildPeriodSeries(rows, "ActualStartDate", "MTTRHours", "median");
        setText("analysis-mttr-trend-title", "MTTR Trend");
        setText("analysis-mttr-trend-subtitle", "Median MTTR over time.");
        renderLineChart("analysis-mttr-trend", trend.labels, [{ label: "Median MTTR", data: trend.values, borderColor: "#0f766e", backgroundColor: "rgba(15,118,110,0.10)", fill: true }], "Hours");
    }

    function chartBaseOptions(yTitle = "") {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: "#334155", boxWidth: 12 } },
                tooltip: { mode: "index", intersect: false },
            },
            scales: {
                x: { ticks: { color: "#64748b", maxRotation: 35, minRotation: 0 }, grid: { display: false } },
                y: { beginAtZero: true, title: { display: Boolean(yTitle), text: yTitle }, ticks: { color: "#64748b" }, grid: { color: "rgba(148, 163, 184, 0.18)" } },
            },
        };
    }

    function renderBarChart(id, labels, datasets, yTitle) {
        createChart(id, { type: "bar", data: { labels, datasets }, options: chartBaseOptions(yTitle), _scroll: { axis: "x", count: labels.length } });
    }

    function renderHorizontalBarChart(id, labels, data, label, color, options = {}) {
        const limit = options.limit || ANALYSIS_TOP_LIST_LIMIT;
        const chartLabels = labels.slice(0, limit);
        const chartData = data.slice(0, limit);
        createChart(id, {
            type: "bar",
            data: { labels: chartLabels, datasets: [{ label, data: chartData, backgroundColor: color, borderRadius: 6 }] },
            _scroll: { axis: "y", count: chartLabels.length },
            options: {
                ...chartBaseOptions(label),
                indexAxis: "y",
                scales: {
                    x: { beginAtZero: true, ticks: { color: "#64748b" }, grid: { color: "rgba(148, 163, 184, 0.18)" } },
                    y: { ticks: { color: "#475569", autoSkip: false }, grid: { display: false } },
                },
            },
        });
        if (options.tableId) {
            renderMiniTable(
                options.tableId,
                options.tableHeaders || ["Rank", "Category", label],
                options.tableRows || labels.map((itemLabel, index) => [formatInteger(index + 1), itemLabel, formatNumber(data[index], 1)]),
                options.note || analysisTopListNote(labels.length)
            );
        }
    }

    function renderLineChart(id, labels, datasets, yTitle) {
        createChart(id, {
            type: "line",
            data: { labels, datasets: datasets.map((dataset) => ({ tension: 0.28, borderWidth: 2.5, pointRadius: 3, spanGaps: true, ...dataset })) },
            options: chartBaseOptions(yTitle),
        });
    }

    function renderParetoChart(chartId, tableId, rows, label) {
        const total = sum(rows.map((row) => row.value));
        let running = 0;
        const cumulative = rows.map((row) => {
            running += row.value;
            return total ? round1((running / total) * 100) : 0;
        });
        const chartRows = rows.slice(0, ANALYSIS_TOP_LIST_LIMIT);
        createChart(chartId, {
            type: "bar",
            data: {
                labels: chartRows.map((row) => row.label),
                datasets: [
                    { type: "bar", label, data: chartRows.map((row) => round1(row.value)), backgroundColor: "#3b82f6", borderRadius: 6, yAxisID: "y" },
                    { type: "line", label: "Cumulative %", data: cumulative.slice(0, chartRows.length), borderColor: "#f59e0b", backgroundColor: "#f59e0b", tension: 0.25, yAxisID: "y1" },
                ],
            },
            _scroll: { axis: "x", count: chartRows.length },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: "#334155", boxWidth: 12 } } },
                scales: {
                    x: { ticks: { color: "#64748b", maxRotation: 35, minRotation: 0 }, grid: { display: false } },
                    y: { beginAtZero: true, title: { display: true, text: label }, ticks: { color: "#64748b" }, grid: { color: "rgba(148, 163, 184, 0.18)" } },
                    y1: { beginAtZero: true, max: 100, position: "right", title: { display: true, text: "Cumulative %" }, grid: { drawOnChartArea: false } },
                },
            },
        });
        renderMiniTable(
            tableId,
            ["Rank", "Category", label, "Cumulative %"],
            rows.map((row, index) => [formatInteger(index + 1), row.label, formatNumber(row.value, 1), `${cumulative[index]}%`]),
            analysisTopListNote(rows.length, "categories")
        );
    }

    function renderHistogramChart(id, values, label) {
        const valid = values.filter(isFiniteNumber).map(Number);
        if (!valid.length) {
            createChart(id, { type: "bar", data: { labels: [], datasets: [] }, options: chartBaseOptions(label) });
            return;
        }
        const min = Math.min(...valid);
        const max = Math.max(...valid);
        const binCount = Math.max(5, Math.min(20, Math.ceil(Math.sqrt(valid.length))));
        const width = (max - min || 1) / binCount;
        const bins = Array.from({ length: binCount }, (_, index) => ({ min: min + index * width, max: min + (index + 1) * width, count: 0 }));
        valid.forEach((value) => {
            const index = Math.min(binCount - 1, Math.floor((value - min) / width));
            bins[index].count += 1;
        });
        renderBarChart(id, bins.map((bin) => `${round1(bin.min)}-${round1(bin.max)}`), [{ label: "Work Orders", data: bins.map((bin) => bin.count), backgroundColor: "#0f766e" }], "Count");
    }

    function drawBoxplot(id, groups, valueLabel, options = {}) {
        if (charts[id]) {
            charts[id].destroy();
            delete charts[id];
        }
        const canvas = document.getElementById(id);
        if (!canvas) return;
        const parent = canvas.parentElement;
        const visibleGroups = groups.slice(0, options.limit || ANALYSIS_TOP_LIST_LIMIT);
        const width = Math.max(parent?.clientWidth || 600, 320);
        const height = Math.max(parent?.clientHeight || 320, visibleGroups.length * 38 + 70, 260);
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.font = "12px Inter, sans-serif";
        if (!visibleGroups.length) {
            ctx.fillStyle = "#64748b";
            ctx.fillText(`No valid ${valueLabel} values`, 20, 30);
            if (options.tableId) renderMiniTable(options.tableId, [], []);
            return;
        }
        const margin = { left: 150, right: 24, top: 22, bottom: 36 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;
        const maxValue = Math.max(...visibleGroups.map((group) => group.max), 1);
        const scale = (value) => margin.left + (Number(value || 0) / maxValue) * plotWidth;
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const x = margin.left + (plotWidth * i) / 4;
            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, margin.top + plotHeight);
            ctx.stroke();
            ctx.fillStyle = "#64748b";
            ctx.fillText(formatNumber((maxValue * i) / 4, 0), x - 8, height - 12);
        }
        const rowHeight = plotHeight / visibleGroups.length;
        visibleGroups.forEach((group, index) => {
            const y = margin.top + rowHeight * index + rowHeight / 2;
            const boxHeight = Math.min(24, rowHeight * 0.45);
            ctx.fillStyle = "#475569";
            ctx.textAlign = "right";
            ctx.fillText(truncateLabel(group.label, 22), margin.left - 10, y + 4);
            ctx.textAlign = "left";
            ctx.strokeStyle = "#64748b";
            ctx.beginPath();
            ctx.moveTo(scale(group.min), y);
            ctx.lineTo(scale(group.max), y);
            ctx.stroke();
            ctx.fillStyle = "rgba(59, 130, 246, 0.18)";
            ctx.strokeStyle = "#3b82f6";
            ctx.strokeRect(scale(group.q1), y - boxHeight / 2, Math.max(2, scale(group.q3) - scale(group.q1)), boxHeight);
            ctx.fillRect(scale(group.q1), y - boxHeight / 2, Math.max(2, scale(group.q3) - scale(group.q1)), boxHeight);
            ctx.strokeStyle = "#ef4444";
            ctx.beginPath();
            ctx.moveTo(scale(group.median), y - boxHeight / 2 - 3);
            ctx.lineTo(scale(group.median), y + boxHeight / 2 + 3);
            ctx.stroke();
        });
        if (options.tableId) {
            renderGroupStatsTable(options.tableId, options.groupLabel || "Group", groups, valueLabel, options.valueFormatter);
        }
    }

    function renderComparativeTrend(id, rows, groupField, rankedGroups = null) {
        const topGroups = (rankedGroups || aggregateAnalysis(rows, groupField, "MTBFHours", "count"))
            .slice(0, ANALYSIS_TOP_LIST_LIMIT)
            .map((row) => row.label);
        const periods = buildContinuousAnalysisPeriods(rows);
        const colors = ["#0f766e", "#2563eb", "#8b5cf6", "#ef4444", "#f59e0b", "#10b981", "#64748b", "#db2777", "#0891b2", "#9333ea"];
        const datasets = topGroups.map((label, index) => {
            const color = colors[index % colors.length];
            const counts = periods.map((period) => rows.filter((row) => row[groupField] === label && row.PeriodLabel === period).length);
            return {
                label,
                data: periods.map((period) => {
                    const values = rows
                        .filter((row) => row[groupField] === label && row.PeriodLabel === period)
                        .map((row) => row.MTBFHours)
                        .filter(isFiniteNumber);
                    return values.length ? round1(median(values)) : 0;
                }),
                _counts: counts,
                borderColor: color,
                backgroundColor: hexToRgba(color, 0.08),
                fill: "origin",
                tension: 0.22,
                borderWidth: 2,
                pointRadius: (ctx) => ctx.raw === 0 ? 1.5 : 2.8,
                pointHoverRadius: 4,
                pointBackgroundColor: color,
                pointBorderColor: "#ffffff",
                pointBorderWidth: 1,
                spanGaps: true,
            };
        });
        renderLineChart(id, periods, datasets, "MTBF Hours");
    }

    function buildContinuousAnalysisPeriods(rows) {
        const dates = rows
            .map((row) => row.ActualStartDate)
            .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()));
        if (!dates.length) return [...new Set(rows.map((row) => row.PeriodLabel).filter(Boolean))].sort();
        const min = new Date(Math.min(...dates.map((date) => date.getTime())));
        const max = new Date(Math.max(...dates.map((date) => date.getTime())));
        const cursor = new Date(min.getFullYear(), min.getMonth(), 1);
        const end = new Date(max.getFullYear(), max.getMonth(), 1);
        const periods = [];
        while (cursor <= end) {
            periods.push(formatAnalysisMonth(cursor));
            cursor.setMonth(cursor.getMonth() + 1);
        }
        return periods;
    }

    function hexToRgba(hex, alpha) {
        const normalized = String(hex || "").replace("#", "");
        if (normalized.length !== 6) return `rgba(15, 118, 110, ${alpha})`;
        const value = parseInt(normalized, 16);
        const r = (value >> 16) & 255;
        const g = (value >> 8) & 255;
        const b = value & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function buildImr(points) {
        const individuals = points.map((point) => point.value).filter(isFiniteNumber).map(Number);
        const movingRanges = individuals.slice(1).map((value, index) => Math.abs(value - individuals[index]));
        const center = mean(individuals);
        const mrCenter = mean(movingRanges);
        const ucl = center !== null && mrCenter !== null ? center + 2.66 * mrCenter : null;
        const lcl = center !== null && mrCenter !== null ? Math.max(0, center - 2.66 * mrCenter) : null;
        const mrUcl = mrCenter !== null ? 3.267 * mrCenter : null;
        const outOfControl = individuals.map((value, index) => ({ value, index })).filter((point) => (ucl !== null && point.value > ucl) || (lcl !== null && point.value < lcl));
        return {
            individuals: points.map((point, index) => ({ label: point.label || `#${index + 1}`, value: individuals[index] })).filter((point) => isFiniteNumber(point.value)),
            movingRanges: movingRanges.map((value, index) => ({ label: points[index + 1]?.label || `#${index + 2}`, value })),
            center, ucl, lcl, mrCenter, mrUcl, outOfControl,
        };
    }

    function renderControlLineChart(id, points, label, center, ucl, lcl) {
        const labels = points.map((point) => point.label);
        renderLineChart(id, labels, [
            { label, data: points.map((point) => round1(point.value)), borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,0.10)", fill: false },
            { label: "Center", data: labels.map(() => round1(center)), borderColor: "#0f766e", backgroundColor: "#0f766e", borderDash: [6, 4], fill: false },
            { label: "UCL", data: labels.map(() => round1(ucl)), borderColor: "#ef4444", backgroundColor: "#ef4444", borderDash: [4, 4], fill: false },
            { label: "LCL", data: labels.map(() => round1(lcl)), borderColor: "#f59e0b", backgroundColor: "#f59e0b", borderDash: [4, 4], fill: false },
        ], "Hours");
    }

    function targetCategory(criticality) {
        const text = String(criticality || "").toLowerCase();
        if (text.includes("support")) return "Support";
        if (text.includes("critical") && !text.includes("non")) return "Critical";
        return "Facility";
    }

    function analysisTopListNote(total, noun = "items") {
        const count = Number(total || 0);
        if (count <= ANALYSIS_TOP_LIST_LIMIT) return `${formatInteger(count)} ${noun} listed.`;
        return `Top ${ANALYSIS_TOP_LIST_LIMIT} shown above; ${formatInteger(count)} ${noun} listed below.`;
    }

    function analysisGroupNoun(groupLabel) {
        const label = String(groupLabel || "").toLowerCase();
        if (label.includes("machinename")) return "machines";
        if (label.includes("machinegroup")) return "machine groups";
        if (label.includes("severity")) return "severity levels";
        if (label.includes("criticality")) return "criticality groups";
        return "groups";
    }

    function formatGroupStatValue(value, formatter) {
        return typeof formatter === "function" ? formatter(value) : formatNumber(value, 1);
    }

    function renderGroupStatsTable(id, groupLabel, groups, valueLabel, formatter = null) {
        renderMiniTable(
            id,
            ["Rank", groupLabel, "Count", "Median", "Mean", "Q1", "Q3", "Max"],
            groups.map((group, index) => [
                formatInteger(index + 1),
                group.label,
                formatInteger(group.count),
                formatGroupStatValue(group.median, formatter),
                formatGroupStatValue(group.mean, formatter),
                formatGroupStatValue(group.q1, formatter),
                formatGroupStatValue(group.q3, formatter),
                formatGroupStatValue(group.max, formatter),
            ]),
            analysisTopListNote(groups.length, analysisGroupNoun(groupLabel || valueLabel))
        );
    }

    function renderMiniTable(id, headers, rows, note = "") {
        const node = document.getElementById(id);
        if (!node) return;
        if (!rows.length) {
            node.innerHTML = `<div class="analysis-empty">No records available.</div>`;
            return;
        }
        node.innerHTML = `
            ${note ? `<div class="analysis-note">${escapeHtml(note)}</div>` : ""}
            <table>
                <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
                <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
            </table>
        `;
    }

    function truncateLabel(value, length) {
        const text = String(value || "Unknown");
        return text.length > length ? `${text.slice(0, length - 1)}...` : text;
    }

    function formatStat(value) {
        return isFiniteNumber(value) ? Number(value).toFixed(3) : "--";
    }

    function formatP(value) {
        if (!isFiniteNumber(value)) return "--";
        return Number(value) < 0.001 ? "<0.001" : Number(value).toFixed(3);
    }

    function kruskalWallis(groups) {
        const validGroups = groups.map((group) => group.filter(isFiniteNumber).map(Number)).filter((group) => group.length);
        const all = [];
        validGroups.forEach((group, groupIndex) => group.forEach((value) => all.push({ value, groupIndex })));
        if (validGroups.length < 2 || all.length < 2) return { statistic: null, pValue: null };
        const ranks = rankValues(all.map((item) => item.value));
        const n = all.length;
        const rankSums = Array(validGroups.length).fill(0);
        all.forEach((item, index) => { rankSums[item.groupIndex] += ranks[index]; });
        const h = (12 / (n * (n + 1))) * rankSums.reduce((total, rankSum, index) => total + (rankSum * rankSum) / validGroups[index].length, 0) - 3 * (n + 1);
        return { statistic: h, pValue: chiSquareSf(Math.max(0, h), validGroups.length - 1) };
    }

    function rankValues(values) {
        const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
        const ranks = Array(values.length).fill(0);
        for (let i = 0; i < sorted.length;) {
            let j = i + 1;
            while (j < sorted.length && sorted[j].value === sorted[i].value) j++;
            const rank = (i + 1 + j) / 2;
            for (let k = i; k < j; k++) ranks[sorted[k].index] = rank;
            i = j;
        }
        return ranks;
    }

    function mannWhitneyUTest(aValues, bValues) {
        const a = aValues.filter(isFiniteNumber).map(Number);
        const b = bValues.filter(isFiniteNumber).map(Number);
        if (!a.length || !b.length) return { u: null, pValue: null };
        const combined = [...a.map((value) => ({ value, group: "a" })), ...b.map((value) => ({ value, group: "b" }))];
        const ranks = rankValues(combined.map((item) => item.value));
        const rankA = combined.reduce((total, item, index) => total + (item.group === "a" ? ranks[index] : 0), 0);
        const uA = rankA - (a.length * (a.length + 1)) / 2;
        const meanU = (a.length * b.length) / 2;
        const sdU = Math.sqrt((a.length * b.length * (a.length + b.length + 1)) / 12);
        const z = sdU ? (uA - meanU) / sdU : 0;
        return { u: uA, pValue: 2 * (1 - normalCdf(Math.abs(z))) };
    }

    function chiSquareTest(table) {
        const rows = table.length;
        const cols = table[0]?.length || 0;
        const rowTotals = table.map((row) => sum(row));
        const colTotals = Array.from({ length: cols }, (_, col) => sum(table.map((row) => row[col] || 0)));
        const total = sum(rowTotals);
        if (!total) return { statistic: null, pValue: null };
        let statistic = 0;
        table.forEach((row, r) => row.forEach((observed, c) => {
            const expected = (rowTotals[r] * colTotals[c]) / total;
            if (expected > 0) statistic += ((observed - expected) ** 2) / expected;
        }));
        return { statistic, pValue: chiSquareSf(statistic, Math.max(1, (rows - 1) * (cols - 1))) };
    }

    function normalCdf(x) {
        return 0.5 * (1 + erf(x / Math.sqrt(2)));
    }

    function erf(x) {
        const sign = x >= 0 ? 1 : -1;
        const abs = Math.abs(x);
        const t = 1 / (1 + 0.3275911 * abs);
        const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-abs * abs);
        return sign * y;
    }

    function logGamma(z) {
        const coefficients = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
        let x = z;
        let y = z;
        let tmp = x + 5.5;
        tmp -= (x + 0.5) * Math.log(tmp);
        let ser = 1.000000000190015;
        coefficients.forEach((coefficient) => {
            y += 1;
            ser += coefficient / y;
        });
        return -tmp + Math.log(2.5066282746310005 * ser / x);
    }

    function gammaP(a, x) {
        if (x < 0 || a <= 0) return 0;
        if (x === 0) return 0;
        if (x < a + 1) {
            let ap = a;
            let sumValue = 1 / a;
            let del = sumValue;
            for (let n = 1; n <= 100; n++) {
                ap += 1;
                del *= x / ap;
                sumValue += del;
                if (Math.abs(del) < Math.abs(sumValue) * 1e-8) break;
            }
            return sumValue * Math.exp(-x + a * Math.log(x) - logGamma(a));
        }
        return 1 - gammaQ(a, x);
    }

    function gammaQ(a, x) {
        let b = x + 1 - a;
        let c = 1 / 1e-30;
        let d = 1 / b;
        let h = d;
        for (let i = 1; i <= 100; i++) {
            const an = -i * (i - a);
            b += 2;
            d = an * d + b;
            if (Math.abs(d) < 1e-30) d = 1e-30;
            c = b + an / c;
            if (Math.abs(c) < 1e-30) c = 1e-30;
            d = 1 / d;
            const del = d * c;
            h *= del;
            if (Math.abs(del - 1) < 1e-8) break;
        }
        return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
    }

    function chiSquareSf(x, df) {
        if (!isFiniteNumber(x) || !isFiniteNumber(df) || df <= 0) return null;
        return Math.max(0, Math.min(1, 1 - gammaP(df / 2, x / 2)));
    }

    function exportAnalysisTables() {
        const rows = state.analysisFilteredRows || [];
        const intervals = state.analysisFilteredIntervals || [];
        const lines = [];
        const addSection = (title, headers, records) => {
            lines.push(title);
            lines.push(headers.join(","));
            records.forEach((record) => lines.push(headers.map((header) => csvCell(record[header])).join(",")));
            lines.push("");
        };
        addSection("Analysis_Raw_Cleaned", ["WO_ID", "RequestID", "AssetID", "MachineName", "MachineGroup", "CriticalityGroup", "SeverityLevel", "ProductionLine", "LifecycleState", "MaintenanceType", "DowntimeHours", "MTTRHours", "DataQualityFlag"], rows);
        addSection("Analysis_MTBF_Intervals", ["FailureIntervalID", "AssetID", "MachineName", "MachineGroup", "CriticalityGroup", "SeverityLevel", "PeriodLabel", "MTBFHours", "PMCompletedBeforeNextFailure", "DataQualityFlag"], intervals);
        const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `maintenance_dashboard_analysis_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function csvCell(value) {
        const text = value instanceof Date ? value.toISOString() : String(value ?? "");
        return `"${text.replace(/"/g, '""')}"`;
    }

    function xmlCell(cell, defaultStyleId = "") {
        const options = cell && typeof cell === "object" && Object.prototype.hasOwnProperty.call(cell, "value")
            ? cell
            : { value: cell };
        const raw = options.value === null || options.value === undefined ? "" : options.value;
        const text = raw instanceof Date ? raw.toISOString() : String(raw);
        const numberValue = Number(raw);
        const styleId = options.styleId || defaultStyleId || "";
        const attrs = [
            styleId ? `ss:StyleID="${escapeXml(styleId)}"` : "",
            options.mergeAcross ? `ss:MergeAcross="${Number(options.mergeAcross)}"` : "",
        ].filter(Boolean).join(" ");
        const attrText = attrs ? ` ${attrs}` : "";
        if (text !== "" && Number.isFinite(numberValue) && !/^0\d+/.test(text)) {
            return `<Cell${attrText}><Data ss:Type="Number">${numberValue}</Data></Cell>`;
        }
        return `<Cell${attrText}><Data ss:Type="String">${escapeXml(text)}</Data></Cell>`;
    }

    function xmlRow(row) {
        const config = row && typeof row === "object" && Array.isArray(row.cells)
            ? row
            : { cells: row };
        const styleId = config.styleId || "";
        const heightAttr = config.height ? ` ss:Height="${Number(config.height)}"` : "";
        return `<Row${heightAttr}>${(config.cells || []).map((cell) => xmlCell(cell, styleId)).join("")}</Row>`;
    }

    function formatSpareExcelDateTime(value) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return String(value || "");
        const y = date.getFullYear();
        const mo = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        const h = String(date.getHours()).padStart(2, "0");
        const mi = String(date.getMinutes()).padStart(2, "0");
        return `${y}-${mo}-${d} ${h}:${mi}`;
    }

    function escapeXml(value) {
        return String(value ?? "").replace(/[<>&'"]/g, (match) => ({
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            "'": "&apos;",
            '"': "&quot;",
        }[match]));
    }

    function excelSheetName(value, fallback) {
        const cleaned = String(value || fallback || "Sheet")
            .replace(/[\[\]:*?/\\]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        return (cleaned || fallback || "Sheet").slice(0, 31);
    }

    function buildExcelWorkbookXml(sheets) {
        const worksheetXml = sheets.map((sheet, index) => {
            const name = excelSheetName(sheet.name, `Sheet ${index + 1}`);
            const rowList = sheet.rows || [];
            const widths = sheet.widths || [];
            const columnCount = Math.max(
                sheet.columnCount || 0,
                widths.length,
                ...rowList.map((row) => {
                    const cells = row && typeof row === "object" && Array.isArray(row.cells) ? row.cells : row;
                    return Array.isArray(cells) ? cells.length : 0;
                })
            );
            const columns = widths.map((wch) => `<Column ss:AutoFitWidth="0" ss:Width="${Math.max(8, Number(wch) || 12) * 7}"/>`).join("");
            const rows = rowList.map(xmlRow).join("");
            const freezeRow = Number(sheet.freezeAfterRow || 0);
            const worksheetOptions = freezeRow
                ? `<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>${freezeRow}</SplitHorizontal><TopRowBottomPane>${freezeRow}</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>`
                : "";
            const filterRow = Number(sheet.autoFilterRow || 0);
            const autoFilter = filterRow && columnCount
                ? `<AutoFilter x:Range="R${filterRow}C1:R${Math.max(filterRow, rowList.length)}C${columnCount}" xmlns="urn:schemas-microsoft-com:office:excel"/>`
                : "";
            return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${columns}${rows}</Table>${worksheetOptions}${autoFilter}</Worksheet>`;
        }).join("");
        return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Version>16.00</Version></DocumentProperties><OfficeDocumentSettings xmlns="urn:schemas-microsoft-com:office:office"><AllowPNG/></OfficeDocumentSettings><ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel"><WindowHeight>10116</WindowHeight><WindowWidth>23040</WindowWidth><ActiveSheet>0</ActiveSheet><ProtectStructure>False</ProtectStructure><ProtectWindows>False</ProtectWindows></ExcelWorkbook><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Font ss:FontName="Calibri" ss:Size="11"/></Style><Style ss:ID="title"><Font ss:Bold="1" ss:Size="16" ss:Color="#FFFFFF"/><Interior ss:Color="#0F172A" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style><Style ss:ID="subtitle"><Font ss:Italic="1" ss:Color="#339966"/><Alignment ss:WrapText="1"/></Style><Style ss:ID="metaLabel"><Font ss:Bold="1" ss:Color="#334155"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/></Style><Style ss:ID="metaValue"><Font ss:Color="#0F172A"/></Style><Style ss:ID="header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1D4ED8" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style><Style ss:ID="section"><Font ss:Bold="1" ss:Color="#0F172A"/><Interior ss:Color="#DBEAFE" ss:Pattern="Solid"/></Style><Style ss:ID="warning"><Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/><Font ss:Color="#92400E"/></Style></Styles>${worksheetXml}</Workbook>`;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function exportAssetPartsPurchases() {
        const intel = state.assetPartsIntelligence;
        const purchases = (intel && intel.purchaseParts) || [];
        if (!purchases.length) return;
        const selected = intel.selectedAsset || {};
        const summary = intel.summary || {};
        const assetName =
            (selected.name || selected.assetName || selected.label)
            || state.assetPartsIntelQuery || "asset";
        const suppliers = (intel.supplierSummary || intel.suppliers || []);
        const now = new Date();
        const generatedAt = formatSpareExcelDateTime(now);

        const purchaseRows = [
            { cells: [{ value: "Asset Parts Intelligence - Purchase History", styleId: "title", mergeAcross: 9 }], height: 24 },
            { cells: [{ value: "Matched Gen PO spare-part purchases and suppliers.", styleId: "subtitle", mergeAcross: 9 }] },
            [],
            [
                { value: "Selected Asset", styleId: "metaLabel" }, { value: assetName, styleId: "metaValue" },
                { value: "Asset ID", styleId: "metaLabel" }, { value: selected.assetId || "", styleId: "metaValue" },
                { value: "Asset Family", styleId: "metaLabel" }, { value: selected.assetFamily || "", styleId: "metaValue" },
            ],
            [
                { value: "Generated At", styleId: "metaLabel" }, { value: generatedAt, styleId: "metaValue" },
                { value: "Matched PO Lines", styleId: "metaLabel" }, { value: purchases.length, styleId: "metaValue" },
                { value: "Data Confidence", styleId: "metaLabel" }, { value: summary.confidence || "", styleId: "metaValue" },
            ],
            [],
            { styleId: "header", cells: ["PO Date", "PO Number", "Supplier", "Part / Item Description", "Quantity", "Value", "Related Asset / Alias", "Match Source", "Match Confidence", "Data Quality"] },
            ...purchases.map((r) => [
                formatShortDate(r.po_date), r.po_number, r.supplier, r.part_description, r.quantity, r.value,
                r.related_asset_alias, r.match_source, r.match_confidence, r.data_quality_flag,
            ]),
        ];
        const supplierRows = [
            { cells: [{ value: "Supplier Summary", styleId: "title", mergeAcross: 4 }], height: 24 },
            { cells: [{ value: "Suppliers linked to the selected asset by purchase description, alias, family, machine group, or direct reference.", styleId: "subtitle", mergeAcross: 4 }] },
            [],
            { styleId: "header", cells: ["Supplier", "Parts / Services Supplied", "Total PO Value", "PO Lines", "Latest Purchase Date"] },
            ...(suppliers.length
                ? suppliers.map((s) => [
                    s.supplier,
                    s.parts_supplied_text || (s.parts_supplied || []).join("; "),
                    s.total_po_value,
                    s.po_line_count,
                    formatShortDate(s.latest_purchase_date),
                ])
                : [["No supplier summary rows found for this selection.", "", "", "", ""]]),
        ];
        const workbook = buildExcelWorkbookXml([
            { name: "Purchase_History", rows: purchaseRows, widths: [13, 18, 30, 52, 12, 14, 22, 22, 18, 70], autoFilterRow: 7, freezeAfterRow: 7 },
            { name: "Supplier_Summary", rows: supplierRows, widths: [34, 64, 18, 12, 18], autoFilterRow: 4, freezeAfterRow: 4 },
        ]);
        const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
        const safeAsset = String(assetName).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "asset";
        downloadBlob(blob, `asset_parts_purchase_history_${safeAsset}_${new Date().toISOString().slice(0, 10)}.xls`);
    }

    function hydrateFilterOptions(payload) {
        populateSelect("month-selector", payload?.months || [], true);
        populateSelect(
            "filter-month",
            [{ value: "all", label: `All Months ${state.year}` }, ...(payload?.months || [])],
            true
        );
        populateSelect("filter-status", payload?.status_options || []);
        populateSelect("filter-sort", payload?.sort_options || []);
        populateSelect("filter-category", [{ value: "all", label: "All Categories" }, ...(payload?.categories || []).map((value) => ({ value, label: value }))]);
        populateSelect("filter-location", [{ value: "all", label: "All Locations" }, ...(payload?.locations || []).map((value) => ({ value, label: value }))]);
        populateSelect("filter-inspection", payload?.inspection_options || []);
    }

    async function loadMaintenanceDashboard() {
        await Promise.all([
            loadSummary(),
            loadMonthly(false),
        ]);
        await loadList();
        queueDeferredMaintenanceLoads();
    }

    async function refreshMonthScopedSections() {
        await Promise.all([
            loadMonthly(false),
        ]);
        await loadList();
        queueDeferredMaintenanceLoads();
    }

    function queueDeferredMaintenanceLoads() {
        window.setTimeout(() => {
            loadTimeline().catch((error) => console.error("Maintenance timeline load failed:", error));
        }, 0);
        window.setTimeout(() => {
            loadMonthlyDetail().catch((error) => console.error("Maintenance monthly detail load failed:", error));
        }, 0);
    }

    async function loadSummary() {
        const payload = await fetchJson(`${getApiBase()}/summary?year=${state.year}`);
        const summary = payload?.summary || {};
        const isEquipment = state.activeView === "equipment";

        setSummaryCount("summary-due-week", summary.due_this_week);
        setSummaryCount("summary-due-month", summary.due_this_month);
        setText("summary-rate-week", `${formatNumber(summary.completion_rate_week, 1)}%`);
        setText("summary-rate-month", `${formatNumber(summary.completion_rate_month, 1)}%`);
        setSummaryCount("summary-upcoming", summary.upcoming_next_7_days);
        setText("summary-assets", formatInteger(isEquipment ? summary.total_equipment_assets : summary.total_utility_assets));
        setText("summary-quarter", formatInteger(summary.tasks_this_quarter));
        if (isEquipment) {
            const risk = summary.risk_breakdown || {};
            setText(
                "summary-next-month",
                `High: ${formatInteger(risk.high)} | Medium: ${formatInteger(risk.medium)} | Low: ${formatInteger(risk.low)}`
            );
        } else {
            setText("summary-next-month", `Due next month: ${formatInteger(summary.tasks_due_next_month)}`);
        }

    }

    async function loadMonthly(includeDetail = true) {
        const payload = await fetchJson(`${getApiBase()}/monthly?month=${encodeURIComponent(state.selectedMonth)}&year=${state.year}`);
        const counts = payload?.counts || {};
        const isEquipment = state.activeView === "equipment";
        if (!isEquipment) {
            const utilityRowsPayload = await fetchJson(`${getApiBase()}/list?month=${encodeURIComponent(state.selectedMonth)}&year=${state.year}&status=all&category=all&location=all&inspection=all&search=&sort=due_date_asc&aggregate=occurrence`);
            payload.inspection_groups = buildUtilityInspectionGroups(utilityRowsPayload?.rows || []);
        }

        setText("monthly-done", formatInteger(counts.done));
        setText("monthly-pending", formatInteger(counts.pending));
        setText("monthly-overdue", formatInteger(counts.overdue));
        setText("monthly-total", formatInteger(counts.total));

        if (isEquipment) {
            document.getElementById("summary-card-1")?.setAttribute("data-summary-filter", "done");
            document.getElementById("summary-card-2")?.setAttribute("data-summary-filter", "pending");
            document.getElementById("summary-card-3")?.setAttribute("data-summary-filter", "overdue");
            document.getElementById("summary-card-4")?.setAttribute("data-summary-filter", "completion_rate");
            document.getElementById("summary-card-5")?.setAttribute("data-summary-filter", "high_priority");
            setText("summary-label-1", "Done");
            setText("summary-label-2", "Pending");
            setText("summary-label-3", "Overdue");
            setText("summary-label-4", "Completion Rate");
            setText("summary-label-5", "High Priority Open");
            setSummaryCount("summary-due-week", counts.done);
            setSummaryCount("summary-due-month", counts.pending);
            setSummaryCount("summary-rate-week", counts.overdue);
            setText("summary-rate-month", `${formatNumber(counts.completion_rate, 1)}%`);
            setSummaryCount("summary-upcoming", counts.high_priority_open);
            setText("summary-quarter-label", "Total Scheduled This Month");
            setText("summary-quarter", formatInteger(counts.total));
            setText("summary-next-month", `Production-critical open: ${formatInteger(counts.production_critical_open)}`);
            renderCriticalAttention(payload?.critical_attention || []);
        } else {
            document.getElementById("summary-card-1")?.setAttribute("data-summary-filter", "due_this_week");
            document.getElementById("summary-card-2")?.setAttribute("data-summary-filter", "due_this_month");
            document.getElementById("summary-card-3")?.setAttribute("data-summary-filter", "completion_aux");
            document.getElementById("summary-card-4")?.setAttribute("data-summary-filter", "completion_rate");
            document.getElementById("summary-card-5")?.setAttribute("data-summary-filter", "upcoming");
            setText("summary-label-1", "Due This Week");
            setText("summary-label-2", "Due This Month");
            setText("summary-label-3", "Completion Rate Week");
            setText("summary-label-4", "Completion Rate Month");
            setText("summary-label-5", "Upcoming Next 7 Days");
        }

        document.querySelectorAll("[data-status-target]").forEach((card) => {
            card.classList.toggle("active", (card.dataset.statusTarget || "all") === state.monthStatusView);
        });

        createChart("monthly-status-chart", {
            type: "doughnut",
            data: {
                labels: payload?.chart?.labels || ["Done", "Pending", "Overdue"],
                datasets: [{
                    data: payload?.chart?.values || [0, 0, 0],
                    backgroundColor: isEquipment
                        ? ["#0f766e", "#f59e0b", "#ef4444"]
                        : ["#10b981", "#2563eb", "#ef4444"],
                    borderWidth: 0,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: {
                            usePointStyle: true,
                            boxWidth: 10,
                            font: { family: "Inter", size: 11 },
                        },
                    },
                },
                cutout: "64%",
            },
        });

        renderMonthlyBreakdown(payload);

        if (includeDetail) {
            await loadMonthlyDetail();
        }
    }

    function renderMonthlyBreakdown(payload) {
        const target = document.getElementById("monthly-breakdown-list");
        if (!target) return;

        document.querySelectorAll("[data-breakdown-mode]").forEach((button) => {
            button.classList.toggle("active", (button.dataset.breakdownMode || "category") === state.monthlyBreakdownMode);
        });

        const isLocationMode = state.monthlyBreakdownMode === "location";
        const isInspectionMode = state.monthlyBreakdownMode === "inspection";
        const groups = isInspectionMode
            ? ensureInspectionBreakdownGroups(payload?.inspection_groups || [])
            : isLocationMode
            ? (payload?.location_groups || [])
            : (payload?.category_groups || []);
        const selectedValue = isInspectionMode
            ? state.monthlyInspectionFilter
            : isLocationMode
            ? state.monthlyLocationFilter
            : state.monthlyCategoryFilter;
        const valueKey = isInspectionMode ? "inspection" : isLocationMode ? "location" : "category";

        if (selectedValue !== "all" && !groups.some((group) => group[valueKey] === selectedValue)) {
            if (isInspectionMode) {
                state.monthlyInspectionFilter = "all";
            } else if (isLocationMode) {
                state.monthlyLocationFilter = "all";
            } else {
                state.monthlyCategoryFilter = "all";
            }
        }

        if (!groups.length) {
            target.innerHTML = '<div class="empty-state-block">No maintenance scheduled for the selected month.</div>';
            return;
        }

        target.innerHTML = groups.map((group) => {
            const itemValue = group[valueKey];
            const isActive = itemValue === (
                isInspectionMode
                    ? state.monthlyInspectionFilter
                    : isLocationMode
                    ? state.monthlyLocationFilter
                    : state.monthlyCategoryFilter
            );
            const groupMeta = state.activeView === "equipment"
                ? `${group.done} done | ${group.pending} pending | ${group.overdue} overdue`
                : `${group.done} done | ${group.pending} pending`;
            return `
                <button
                    type="button"
                    class="stack-item stack-item-button ${isActive ? "active" : ""}"
                    data-breakdown-filter="${escapeHtml(itemValue)}"
                >
                    <div>
                        <strong>${escapeHtml(translateDisplayText(group.label || itemValue))}</strong>
                        <div class="insight-meta">${groupMeta}</div>
                    </div>
                    <strong>${formatInteger(group.count)}</strong>
                </button>
            `;
        }).join("");

        target.querySelectorAll("[data-breakdown-filter]").forEach((button) => {
            button.addEventListener("click", async () => {
                const itemValue = button.dataset.breakdownFilter || "all";
                if (isInspectionMode) {
                    state.monthlyInspectionFilter = state.monthlyInspectionFilter === itemValue ? "all" : itemValue;
                    state.monthlyCategoryFilter = "all";
                    state.monthlyLocationFilter = "all";
                } else if (isLocationMode) {
                    state.monthlyLocationFilter = state.monthlyLocationFilter === itemValue ? "all" : itemValue;
                    state.monthlyCategoryFilter = "all";
                    state.monthlyInspectionFilter = "all";
                } else {
                    state.monthlyCategoryFilter = state.monthlyCategoryFilter === itemValue ? "all" : itemValue;
                    state.monthlyLocationFilter = "all";
                    state.monthlyInspectionFilter = "all";
                }
                await loadMonthlyDetail();
                if (state.activeView === "equipment") {
                    state.hasAppliedListFilters = true;
                    state.categoryFilter = isInspectionMode || isLocationMode ? "all" : state.monthlyCategoryFilter;
                    state.locationFilter = isLocationMode ? state.monthlyLocationFilter : "all";
                    state.inspectionFilter = isInspectionMode ? state.monthlyInspectionFilter : "all";
                    syncFilterInputs();
                    await loadList();
                }
                renderMonthlyBreakdown(payload);
            });
        });
    }

    let spareDeferredLoadTimer = null;
    let spareLazyObserver = null;
    let spareLazySectionsBound = false;
    const spareLazyPromises = { project: null, allYears: null, externalPo: null };

    function queueDeferredSparePartsLoads(forceReload = false) {
        window.clearTimeout(spareDeferredLoadTimer);
        spareDeferredLoadTimer = window.setTimeout(() => {
            loadSpareImportHub().catch((error) => console.error("Spare import status deferred load failed:", error));
            initSparePartsLazySections(forceReload);
        }, 80);
    }

    function renderSparePartsLazyPlaceholders() {
        if (!state.ptData) {
            const badge = document.getElementById("pt-status-badge");
            if (badge) {
                badge.className = "pt-status-badge pt-badge-warn";
                badge.textContent = "Loads when visible";
            }
        }
        if (!ayData) setText("ay-subtitle", "Financial-year analysis loads when this section is visible.");
        if (!_epoData) {
            const badge = document.getElementById("epo-status-badge");
            if (badge) {
                badge.textContent = "Loads when visible";
                badge.style.background = "#fef3c7";
                badge.style.color = "#92400e";
            }
        }
    }

    function loadSpareLazyDataset(key, loader, isLoaded, label) {
        if (isLoaded()) return Promise.resolve();
        if (spareLazyPromises[key]) return spareLazyPromises[key];
        spareLazyPromises[key] = loader()
            .catch((error) => console.error(`${label} lazy load failed:`, error))
            .finally(() => { spareLazyPromises[key] = null; });
        return spareLazyPromises[key];
    }

    function initSparePartsLazySections(forceReload = false) {
        if (forceReload) {
            if (spareLazyObserver) spareLazyObserver.disconnect();
            spareLazyObserver = null;
            spareLazySectionsBound = false;
            spareLazyPromises.project = null;
            spareLazyPromises.allYears = null;
            spareLazyPromises.externalPo = null;
        }
        if (spareLazySectionsBound) return;
        spareLazySectionsBound = true;

        const lazyTargets = [
            {
                key: "project",
                node: document.getElementById("pt-status-badge")?.closest("section") || document.getElementById("pt-status-badge"),
                load: () => loadSpareLazyDataset("project", loadProjectTransactions, () => Boolean(state.ptData), "Project Transactions"),
            },
            {
                key: "externalPo",
                node: document.getElementById("epo-section"),
                load: () => loadSpareLazyDataset("externalPo", loadExternalPo, () => Boolean(_epoData), "External PO"),
            },
            {
                key: "allYears",
                node: document.getElementById("ay-panel-yearly")?.closest("section") || document.getElementById("ay-panel-yearly"),
                load: () => loadSpareLazyDataset("allYears", loadAllYearsTransactions, () => Boolean(ayData), "All-years transactions"),
            },
        ].filter((target) => target.node);

        const bindLazyControls = (selector, targetKey) => {
            const target = lazyTargets.find((item) => item.key === targetKey);
            if (!target) return;
            document.querySelectorAll(selector).forEach((node) => {
                const marker = `spareLazyBound${targetKey}`;
                if (node.dataset?.[marker]) return;
                node.dataset[marker] = "1";
                ["pointerdown", "focus", "change"].forEach((eventName) => {
                    node.addEventListener(eventName, target.load, { passive: true });
                });
            });
        };

        bindLazyControls("#pt-period-filter,#pt-month-filter,#pt-category-filter,#pt-asset-filter,#pt-search,#pt-txn-search,#pt-parts-search,#pt-top-parts-year", "project");
        bindLazyControls(".epo-tab-btn,.epo-subtab-btn,#epo-search,#epo-sup-search,#epo-filter-type,#epo-filter-group,#epo-filter-status,#epo-filter-vendor,#epo-filter-classification,#epo-filter-delivery,#epo-date-from,#epo-date-to", "externalPo");
        bindLazyControls(".ay-tab-btn,#spt-part-search,#spt-part-select,#spt-date-mode,#spt-month-select,#spt-start-date,#spt-end-date,#spt-metric,#spt-toggle-txn", "allYears");

        if (!("IntersectionObserver" in window)) return;
        spareLazyObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const target = lazyTargets.find((item) => item.node === entry.target);
                if (!target) return;
                target.load();
                spareLazyObserver.unobserve(entry.target);
            });
        }, { rootMargin: "120px 0px", threshold: 0.01 });
        lazyTargets.forEach((target) => spareLazyObserver.observe(target.node));
    }

    async function loadSparePartsView(options = {}) {
        const forceReload = Boolean(options.forceReload);
        mountExternalPurchasesInSparePanel();

        if (!forceReload && state.sparePartsData) {
            populateSparePartsFilters(state.sparePartsData);
            populateAssetPartsIntelFilters();
            renderAssetPartsIntelligence(state.assetPartsIntelligence);
            renderSparePartsDashboard(state.sparePartsData);
            renderSparePartsLazyPlaceholders();
            queueDeferredSparePartsLoads(false);
            return;
        }

        let payload = {};
        try {
            payload = await fetchJson("/api/maintenance/spare_parts");
        } catch (error) {
            console.error("Spare Parts load failed:", error);
            payload = createEmptySparePartsPayload("Spare parts data could not be loaded.");
        }
        state.sparePartsData = payload;
        populateSparePartsFilters(payload);
        populateAssetPartsIntelFilters();
        renderAssetPartsIntelligence(state.assetPartsIntelligence);
        renderSparePartsDashboard(payload);
        renderSparePartsLazyPlaceholders();
        queueDeferredSparePartsLoads(forceReload);
    }

    function createEmptySparePartsPayload(message) {
        return {
            data_sources: {},
            inventory: { records: [], summary: {}, stock_status_breakdown: [], value_by_category: [] },
            consumption: { store_drawn_records: [], external_bought_records: [], summary: {} },
            turnover: { records: [], summary: {}, classification_breakdown: [], average_days_by_category: [] },
            po_classification: { records: [], manual_review_records: [], summary: {}, value_by_classification: [] },
            comparison: { summary: {}, notes: [], inventory_purchase_summary_rows: [], top_external_spare_parts_rows: [] },
            meta: { errors: message ? [message] : [] },
        };
    }

    function assetIntelSelectValue(id) {
        const value = document.getElementById(id)?.value || "";
        return value === "all" ? "" : value;
    }

    function populateAssetPartsIntelFilters(payloadOrOptions = null) {
        const sourceOptions = payloadOrOptions?.options || payloadOrOptions || state.assetPartsIntelOptions || {};
        const ptFilters = state.ptData?.consumption_analysis?.filters || {};
        const poRows = state.sparePartsData?.po_classification?.records || [];
        const options = {
            asset_families: sourceOptions.asset_families || ptFilters.asset_families || [],
            machine_groups: sourceOptions.machine_groups || ptFilters.machine_groups || [],
            suppliers: sourceOptions.suppliers || uniqueSorted(poRows.map((row) => row?.vendor_name || row?.supplier)),
        };
        state.assetPartsIntelOptions = options;
        populateSpareSelect("asset-intel-family", options.asset_families, "All / detect from search", assetIntelSelectValue("asset-intel-family") || "all");
        populateSpareSelect("asset-intel-machine-group", options.machine_groups, "All / detect from search", assetIntelSelectValue("asset-intel-machine-group") || "all");
    }

    function readAssetPartsIntelControls() {
        return {
            query: document.getElementById("asset-intel-search")?.value.trim() || "",
            assetFamily: assetIntelSelectValue("asset-intel-family"),
            machineGroup: assetIntelSelectValue("asset-intel-machine-group"),
            dateFrom: document.getElementById("asset-intel-date-from")?.value || "",
            dateTo: document.getElementById("asset-intel-date-to")?.value || "",
            includeRelatedMatches: document.getElementById("asset-intel-include-related")?.checked ? "1" : "0",
            includeLowConfidence: document.getElementById("asset-intel-include-low")?.checked ? "1" : "0",
        };
    }

    async function loadAssetPartsIntelligence() {
        const controls = readAssetPartsIntelControls();
        const status = document.getElementById("asset-intel-status");
        const button = document.getElementById("asset-intel-analyse");
        if (!controls.query && !controls.assetFamily && !controls.machineGroup) {
            if (status) {
                status.textContent = "Enter a search term or choose an asset family / machine group first.";
                status.className = "asset-intel-status is-error";
            }
            return;
        }

        const params = new URLSearchParams();
        Object.entries(controls).forEach(([key, value]) => {
            if (value) params.set(key, value);
        });
        if (status) {
            status.textContent = "Analysing related work orders, store transactions, Gen PO lines, and suppliers...";
            status.className = "asset-intel-status is-loading";
        }
        if (button) button.disabled = true;
        try {
            const payload = await fetchJson(`/api/maintenance/asset-parts-intelligence?${params.toString()}`);
            state.assetPartsIntelligence = payload;
            populateAssetPartsIntelFilters(payload);
            renderAssetPartsIntelligence(payload);
            if (status) {
                const summary = payload?.summary || {};
                status.textContent = `Analysis complete: ${formatInteger(summary.relatedWorkOrderCount)} WO/MR, ${formatInteger(summary.sparePartTransactionCount)} store rows, ${formatInteger(summary.purchaseLineCount)} PO lines.`;
                status.className = "asset-intel-status is-ok";
            }
        } catch (error) {
            console.error("Asset Parts Intelligence load failed:", error);
            if (status) {
                status.textContent = `Analysis failed: ${error.message}`;
                status.className = "asset-intel-status is-error";
            }
        } finally {
            if (button) button.disabled = false;
        }
    }

    function assetIntelConfidenceBadge(value) {
        const text = value || "Low";
        const cls = String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return { html: `<span class="status-pill asset-intel-confidence asset-intel-confidence-${escapeHtml(cls)}">${escapeHtml(text)}</span>` };
    }

    function assetIntelFlagCell(value) {
        const text = value || "Direct match";
        const cls = text === "Direct match" ? "good" : "warn";
        return { html: `<span class="asset-intel-flag asset-intel-flag-${cls}">${escapeHtml(text)}</span>` };
    }

    function assetIntelStackCell(primary, secondary = "") {
        const main = primary || "--";
        const sub = secondary && secondary !== primary ? `<span class="table-subtext">${escapeHtml(secondary)}</span>` : "";
        return { html: `<div class="table-primary-cell"><strong>${escapeHtml(main)}</strong>${sub}</div>` };
    }

    function assetIntelFormatQty(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
        return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    function renderAssetPartsIntelligence(payload) {
        const selected = payload?.selectedAsset || {};
        const summary = payload?.summary || {};
        const hasPayload = Boolean(payload);
        const selectedName = selected.assetName && selected.assetName !== "Search required" ? selected.assetName : "No asset selected";
        setText("asset-intel-selected-name", selectedName);
        const selectedMetaParts = [];
        if (selected.assetId) selectedMetaParts.push(`Asset ID: ${selected.assetId}`);
        if (selected.assetFamily) selectedMetaParts.push(`Family: ${selected.assetFamily}`);
        if (selected.machineGroup) selectedMetaParts.push(`Machine group: ${selected.machineGroup}`);
        if (selected.includedAssetCount) selectedMetaParts.push(`${formatInteger(selected.includedAssetCount)} asset(s) in scope`);
        setText(
            "asset-intel-selected-meta",
            selectedMetaParts.length ? selectedMetaParts.join(" | ") : "Results will include direct matches and clearly flagged related matches."
        );

        const aliasNode = document.getElementById("asset-intel-aliases");
        if (aliasNode) {
            const aliases = selected.aliases || [];
            aliasNode.innerHTML = aliases.length
                ? aliases.slice(0, 12).map((alias) => `<span>${escapeHtml(alias)}</span>`).join("")
                : `<span>No aliases loaded yet</span>`;
        }

        setText("asset-intel-kpi-wo-total", hasPayload ? formatInteger(summary.relatedWorkOrderCount) : "--");
        setText(
            "asset-intel-kpi-wo-detail",
            hasPayload
                ? `Direct ${formatInteger(summary.directWorkOrderMatches)} | Description ${formatInteger(summary.descriptionWorkOrderMatches)} | Open ${formatInteger(summary.openInProgressWorkOrders)} | Finished ${formatInteger(summary.finishedConfirmedWorkOrders)}`
                : "Direct -- | Description -- | Open -- | Finished --"
        );
        setText("asset-intel-kpi-store-total", hasPayload ? formatInteger(summary.sparePartTransactionCount) : "--");
        setText(
            "asset-intel-kpi-store-detail",
            hasPayload
                ? `Qty ${assetIntelFormatQty(summary.totalSparePartQuantity)} | Value ${formatSpareCurrencyOrNA(summary.totalSparePartValue)} | Unique ${formatInteger(summary.uniqueSpareParts)} | Top ${summary.topUsedPart || "--"}`
                : "Qty -- | Value -- | Unique -- | Top --"
        );
        setText("asset-intel-kpi-po-total", hasPayload ? formatInteger(summary.purchaseLineCount) : "--");
        setText(
            "asset-intel-kpi-po-detail",
            hasPayload
                ? `Value ${formatSpareCurrencyOrNA(summary.totalPurchaseValue)} | Unique ${formatInteger(summary.uniquePurchasedParts)} | Latest ${formatShortDate(summary.latestPurchaseDate)}`
                : "Value -- | Unique -- | Latest --"
        );
        setText("asset-intel-kpi-suppliers-total", hasPayload ? formatInteger(summary.supplierCount) : "--");
        setText(
            "asset-intel-kpi-suppliers-detail",
            hasPayload ? `Main ${summary.mainSupplier || "--"} | Latest ${summary.latestSupplierUsed || "--"}` : "Main -- | Latest --"
        );
        setText("asset-intel-kpi-quality-confidence", hasPayload ? `${summary.confidence || "Low"} (${summary.confidenceScore || 0}%)` : "--");
        setText(
            "asset-intel-kpi-quality-detail",
            hasPayload
                ? `Mismatches ${formatInteger(summary.possibleCodingMismatchCount)} | Missing ID ${formatInteger(summary.missingAssetIdRecords)} | Description ${formatInteger(summary.descriptionOnlyRecords)} | PO-only ${formatInteger(summary.poOnlyPartRecords)}`
                : "Mismatches -- | Missing ID -- | Description -- | PO-only --"
        );

        const gapsNode = document.getElementById("asset-intel-data-gaps");
        if (gapsNode) {
            const gaps = payload?.dataGaps || ["Data confidence notes will appear after analysis."];
            gapsNode.innerHTML = gaps.map((gap) => `<span>${escapeHtml(gap)}</span>`).join("");
        }
        const exportButton = document.getElementById("asset-intel-export-po");
        if (exportButton) {
            const exportCount = (payload?.purchaseParts || []).length;
            exportButton.disabled = !exportCount;
            exportButton.textContent = exportCount ? `Export Excel (${formatInteger(exportCount)})` : "Export Excel";
            exportButton.title = exportCount
                ? "Download matched purchase history and supplier summary as an Excel workbook."
                : "Analyse an asset with matched purchase records before exporting.";
        }

        renderSpareTable("asset-intel-supplier-body", payload?.supplierSummary || [], 5, (row) => [
            row.supplier || "--",
            row.parts_supplied_text || (row.parts_supplied || []).join("; ") || "--",
            formatSpareCurrencyOrNA(row.total_po_value),
            formatInteger(row.po_line_count),
            formatShortDate(row.latest_purchase_date),
        ], "No suppliers found for this selection.");

        renderSpareTable("asset-intel-wo-body", payload?.relatedWorkOrders || [], 10, (row) => [
            formatShortDate(row.date),
            row.mr_number || "--",
            row.wo_number || "--",
            row.recorded_asset_id || "--",
            assetIntelStackCell(row.recorded_asset_name || row.functional_location || "--", row.functional_location || ""),
            assetIntelStackCell(truncateLabel(row.description || "--", 92), row.original_description && row.original_description !== row.description ? truncateLabel(row.original_description, 92) : ""),
            spareStatusBadge(row.status || "Unclassified"),
            row.match_source || "--",
            assetIntelConfidenceBadge(row.match_confidence),
            assetIntelFlagCell(row.data_quality_flag),
        ], "No related WO/MR records found for this selection.");

        renderSpareTable("asset-intel-store-body", payload?.sparePartsUsed || [], 10, (row) => [
            formatShortDate(row.date),
            row.item_code || "--",
            row.part_name || "--",
            assetIntelFormatQty(row.quantity),
            formatSpareCurrencyOrNA(row.value),
            assetIntelStackCell(row.recorded_asset_project || "--", row.resolved_asset_name || row.asset_family || row.machine_group || ""),
            row.related_wo_mr || "--",
            row.match_source || "--",
            assetIntelConfidenceBadge(row.match_confidence),
            assetIntelFlagCell(row.data_quality_flag),
        ], "No store consumption found for this selection.");

        renderSpareTable("asset-intel-po-body", payload?.purchaseParts || [], 9, (row) => [
            formatShortDate(row.po_date),
            row.po_number || "--",
            row.supplier || "--",
            row.part_description || "--",
            assetIntelFormatQty(row.quantity),
            formatSpareCurrencyOrNA(row.value),
            row.related_asset_alias || "--",
            row.match_source || "--",
            assetIntelConfidenceBadge(row.match_confidence),
        ], "No Gen PO purchase history found for this selection.");
    }

    async function loadSpareImportHub() {
        let payload = { sources: {}, flags: [] };
        try {
            payload = await fetchJson("/api/maintenance/import-status");
        } catch (error) {
            console.error("Spare import status load failed:", error);
            payload = {
                sources: state.spareImportStatus?.sources || {},
                statusUnavailable: true,
                flags: [{ level: "error", title: "Import status unavailable", message: String(error?.message || error) }],
            };
        }
        state.spareImportStatus = payload;
        renderSpareImportHub(payload);
    }

    function setSpareImportStatus(id, message, stateClass = "") {
        const node = document.getElementById(id);
        if (!node) return;
        node.textContent = message || "";
        node.className = `import-status${message ? "" : " hidden"} ${stateClass}`.trim();
    }

    function formatSpareImportValidation(validation = {}) {
        const parts = [];
        if (validation.rows !== undefined && validation.rows !== null) parts.push(`${formatInteger(validation.rows)} rows`);
        if (validation.flagged_rows) parts.push(`${formatInteger(validation.flagged_rows)} flagged`);
        if (validation.manual_review_rows) parts.push(`${formatInteger(validation.manual_review_rows)} manual review`);
        if (validation.years?.length) parts.push(`Years: ${validation.years.join(", ")}`);
        if (validation.source_count) parts.push(`${formatInteger(validation.source_count)} source file${Number(validation.source_count) === 1 ? "" : "s"}`);
        return parts.join(" | ");
    }

    function renderSpareImportHub(payload) {
        const flagsNode = document.getElementById("spare-import-flags");
        const flags = payload?.flags || [];
        if (flagsNode) {
            if (!flags.length) {
                flagsNode.innerHTML = "";
                flagsNode.classList.add("hidden");
            } else {
                flagsNode.innerHTML = flags.map((flag) => `
                    <div class="spare-flag spare-flag-${escapeHtml(flag.level || "info")}">
                        <strong>${escapeHtml(flag.title || "Notice")}</strong>
                        <span>${escapeHtml(flag.message || "")}</span>
                    </div>
                `).join("");
                flagsNode.classList.remove("hidden");
            }
        }

        const sourceMap = {
            inventory: "spare-inventory-import-status",
            external_po: "spare-external-po-import-status",
            project_transactions: "spare-project-transactions-import-status",
        };
        Object.entries(sourceMap).forEach(([key, statusId]) => {
            const source = payload?.sources?.[key] || {};
            if (payload?.statusUnavailable && !Object.keys(source).length) {
                setSpareImportStatus(statusId, "Status unavailable - imported file state was not changed.", "error");
                return;
            }
            const message = source.available
                ? `${source.file_name || source.label || key}${formatSpareImportValidation(source.validation) ? ` | ${formatSpareImportValidation(source.validation)}` : ""}`
                : (source.message || "File not loaded");
            setSpareImportStatus(statusId, message, source.available ? "ok" : "error");
        });
    }

    async function handleMaintenanceImport(event, config) {
        event.preventDefault();
        const input = document.getElementById(config.inputId);
        const file = input?.files?.[0];
        if (!file) {
            setSpareImportStatus(config.statusId, "Choose a CSV, XLSX, or XLS file first.", "error");
            return;
        }

        const formData = new FormData();
        formData.append("file", file);
        setSpareImportStatus(config.statusId, config.pendingMessage || "Uploading file...", "");

        try {
            const response = await fetch(config.url, { method: "POST", body: formData });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.ok === false) {
                throw new Error(result.message || `HTTP ${response.status}`);
            }
            if (input) input.value = "";
            const validationText = formatSpareImportValidation(result.validation_summary || {});
            setSpareImportStatus(
                config.statusId,
                `${result.message || "Import complete."}${validationText ? ` ${validationText}` : ""}`,
                "ok"
            );
            state.sparePartsData = null;
            state.ptData = null;
            state.assetPartsIntelligence = null;
            ayData = null;
            _epoData = null;
            await loadSparePartsView({ forceReload: true });
        } catch (error) {
            console.error(`${config.kind} import failed:`, error);
            setSpareImportStatus(config.statusId, `Import failed: ${error.message}`, "error");
        }
    }

    function populateSparePartsFilters(payload) {
        const purchaseDates = collectSparePurchaseDates(payload);
        const years = [...new Set(purchaseDates.map((date) => date.slice(0, 4)).filter((year) => /^\d{4}$/.test(year)))].sort((a, b) => Number(b) - Number(a));
        const months = [...new Set(purchaseDates.map((date) => date.slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month)))].sort().reverse();
        populateSpareSelect("spare-year-filter", years, "All Years", state.sparePartsFilters.year);
        populateSpareSelect("spare-month-filter", months, "All Months", state.sparePartsFilters.month, formatSpareMonthLabel);

        const inventoryRows = payload?.inventory?.records || [];
        const poRows = payload?.po_classification?.records || [];
        populateSpareSelect("spare-supplier-filter", uniqueSorted(poRows.map((row) => row?.vendor_name || row?.supplier)), "All Vendors", state.sparePartsFilters.supplier);
        populateSpareSelect("spare-classification-filter", uniqueSorted(poRows.map((row) => row?.classification)), "All Classifications", state.sparePartsFilters.classification);
        populateSpareSelect("spare-confidence-filter", uniqueSorted(poRows.map((row) => row?.confidence)), "All Confidence", state.sparePartsFilters.confidence);
        populateSpareSelect("spare-translation-filter", uniqueSorted(poRows.map((row) => row?.translation_status)), "All Translation Status", state.sparePartsFilters.translationStatus);
        populateSpareSelect("spare-inventory-match-filter", uniqueSorted(poRows.map((row) => row?.inventory_match_status)), "All Match Status", state.sparePartsFilters.inventoryMatchStatus);
        populateSpareSelect("spare-group-filter", uniqueSorted(poRows.map((row) => row?.group_of_cost)), "All Groups", state.sparePartsFilters.groupOfCost);
        populateSpareSelect("spare-pd-machine-filter", uniqueSorted(poRows.map((row) => row?.pd_machine)), "All PD Machine", state.sparePartsFilters.pdMachine);
        populateSpareSelect("spare-stock-status-filter", uniqueSorted(inventoryRows.map((row) => row?.stock_status_group)), "All", state.sparePartsFilters.stockStatus, (value) => value, true);
        Object.entries({
            "spare-period-filter": state.sparePartsFilters.period,
            "spare-start-date": state.sparePartsFilters.startDate,
            "spare-end-date": state.sparePartsFilters.endDate,
            "spare-item-code-filter": state.sparePartsFilters.itemCode,
            "spare-stock-search": state.sparePartsFilters.search,
            "spare-metric-filter": state.sparePartsFilters.metric,
        }).forEach(([id, value]) => {
            const node = document.getElementById(id);
            if (node) node.value = value;
        });
    }

    function populateSpareSelect(id, values, allLabel, currentValue, labelFormatter = (value) => value, preserveOrder = false) {
        const node = document.getElementById(id);
        if (!node) return;
        const safeValues = preserveOrder
            ? [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))]
            : uniqueSorted(values);
        const nextValue = safeValues.includes(currentValue) ? currentValue : "all";
        node.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>` + safeValues.map((value) => (
            `<option value="${escapeHtml(value)}">${escapeHtml(labelFormatter(value))}</option>`
        )).join("");
        node.value = nextValue;
        const key = {
            "spare-year-filter": "year",
            "spare-month-filter": "month",
            "spare-supplier-filter": "supplier",
            "spare-classification-filter": "classification",
            "spare-confidence-filter": "confidence",
            "spare-translation-filter": "translationStatus",
            "spare-inventory-match-filter": "inventoryMatchStatus",
            "spare-group-filter": "groupOfCost",
            "spare-pd-machine-filter": "pdMachine",
            "spare-stock-status-filter": "stockStatus",
            "spare-metric-filter": "metric",
        }[id];
        if (key) state.sparePartsFilters[key] = nextValue;
    }

    function syncSparePanelSelection() {
        const activePanel = state.spareActivePanel || "external";
        document.querySelectorAll("[data-spare-panel]").forEach((button) => {
            const isActive = (button.dataset.sparePanel || "external") === activePanel;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", isActive ? "true" : "false");
        });
        document.querySelectorAll("[data-spare-panel-content]").forEach((panel) => {
            panel.classList.toggle("is-active", (panel.dataset.sparePanelContent || "external") === activePanel);
        });
    }

    function mountExternalPurchasesInSparePanel() {
        const slot = document.getElementById("spare-external-purchases-slot");
        const section = document.getElementById("epo-section");
        if (!slot || !section || section.parentElement === slot) return;
        slot.appendChild(section);
    }

    function renderSparePartsDashboard(payload) {
        mountExternalPurchasesInSparePanel();
        syncSparePanelSelection();
        syncSparePurchaseDateControls(payload);
        const filtered = getFilteredSparePartsData(payload);
        renderSpareOverviewContext(filtered);
        renderSparePartsKpis(filtered, payload);
        renderSpareStockHealthSummary(filtered);
        renderSparePartsCharts(filtered);
        renderSparePartsTables(filtered, payload);
    }

    function collectSparePurchaseDates(payload) {
        return (payload?.po_classification?.records || []).flatMap((row) => [
            row?.po_date,
            row?.goods_received_date,
        ]).filter((value) => /^\d{4}-\d{2}-\d{2}/.test(String(value || "")));
    }

    function uniqueSorted(values) {
        return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    }

    function formatSpareMonthLabel(value) {
        const parsed = new Date(`${value}-01T00:00:00`);
        if (Number.isNaN(parsed.getTime())) return value;
        return parsed.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }

    function sparePartsHasDateFilterControls() {
        return Boolean(
            document.getElementById("spare-period-filter")
            || document.getElementById("spare-year-filter")
            || document.getElementById("spare-month-filter")
            || document.getElementById("spare-start-date")
            || document.getElementById("spare-end-date")
        );
    }

    function sparePurchaseDateFilterActive() {
        const filters = state.sparePartsFilters || {};
        return Boolean(
            filters.period !== "all"
            || filters.year !== "all"
            || filters.month !== "all"
            || filters.startDate
            || filters.endDate
        );
    }

    function getSpareDateRange() {
        const filters = state.sparePartsFilters;
        // When the date controls are not rendered on the current Spare Parts page,
        // keep all imported years visible instead of silently applying a hidden range.
        if (!sparePartsHasDateFilterControls()) return null;
        if (filters.month !== "all") {
            const month = filters.month;
            const start = new Date(`${month}-01T00:00:00`);
            const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
            return { start, end };
        }
        if (filters.year !== "all") {
            const year = Number(filters.year);
            return { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59, 999) };
        }
        const today = new Date();
        if (filters.period === "all") return null;
        if (filters.period === "year") {
            return { start: new Date(today.getFullYear(), 0, 1), end: new Date(today.getFullYear(), 11, 31, 23, 59, 59, 999) };
        }
        if (filters.period === "month") {
            const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
            const start = new Date(`${month}-01T00:00:00`);
            const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
            return { start, end };
        }
        if (filters.period === "custom") {
            const start = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null;
            const end = filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null;
            return start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) ? { start, end } : null;
        }
        return { start: new Date(today.getFullYear(), 0, 1), end: today };
    }

    function syncSparePurchaseDateControls(payload) {
        const years = [...new Set(collectSparePurchaseDates(payload).map((date) => date.slice(0, 4)).filter((year) => /^\d{4}$/.test(year)))].sort((a, b) => Number(b) - Number(a));
        const months = [...new Set(collectSparePurchaseDates(payload).map((date) => date.slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month)))].sort().reverse();
        const yearNode = document.getElementById("spare-year-filter");
        const monthNode = document.getElementById("spare-month-filter");
        const periodNode = document.getElementById("spare-period-filter");
        if (periodNode) periodNode.value = state.sparePartsFilters.period || "all";
        if (yearNode && !years.includes(state.sparePartsFilters.year)) {
            state.sparePartsFilters.year = "all";
            yearNode.value = "all";
        }
        if (monthNode && !months.includes(state.sparePartsFilters.month)) {
            state.sparePartsFilters.month = "all";
            monthNode.value = "all";
        }
    }

    function rowWithinSpareRange(row, dateKeys, includeUndated = false) {
        const range = getSpareDateRange();
        if (!range) return true;
        const dateValue = dateKeys.map((key) => row?.[key]).find(Boolean);
        if (!dateValue) return includeUndated;
        const parsed = new Date(`${String(dateValue).slice(0, 10)}T12:00:00`);
        if (Number.isNaN(parsed.getTime())) return includeUndated;
        return parsed >= range.start && parsed <= range.end;
    }

    function getSpareStockHealthRows(rows) {
        return (rows || []).map((row, index) => normalizeSpareStockHealthRow(row, index));
    }

    function normalizeSpareStockHealthRow(row, index) {
        const currentStock = toFiniteNumber(row?.current_quantity);
        const minimum = toFiniteNumber(row?.min_stock);
        const maximum = toFiniteNumber(row?.max_stock);
        const unitCost = toFiniteNumber(row?.unit_cost);
        const status = deriveSpareStockHealthStatus(currentStock, minimum, maximum);
        const quantityToBuy = status === "Reorder Required"
            ? Math.max(0, minimum - currentStock)
            : (status === "Normal" || status === "Above Recommended" ? 0 : null);
        const qualityFlags = collectSpareDataQualityFlags(row, {
            currentStock,
            minimum,
            maximum,
            status,
            partNumber: row?.code,
            name: row?.name,
        });
        return {
            ...row,
            _row_index: index,
            code: row?.code || "",
            name: row?.name || "",
            description: row?.description || row?.name || "",
            category: row?.category || "Unclassified",
            current_quantity: currentStock,
            min_stock: minimum,
            max_stock: maximum,
            unit_cost: unitCost,
            location: row?.location || "",
            stock_health_status: status,
            quantity_to_buy: quantityToBuy,
            estimated_reorder_cost: quantityToBuy !== null && unitCost !== null ? quantityToBuy * unitCost : null,
            stock_health_percent_valid: currentStock !== null && minimum !== null && !(maximum !== null && minimum > maximum),
            stock_health_healthy: currentStock !== null && minimum !== null && currentStock >= minimum && !(maximum !== null && minimum > maximum),
            data_quality_flags: qualityFlags,
        };
    }

    function deriveSpareStockHealthStatus(currentStock, minimum, maximum) {
        if (currentStock === null || minimum === null || maximum === null) return "Missing Threshold Data";
        if (minimum > maximum) return "Threshold Error";
        if (currentStock < minimum) return "Reorder Required";
        if (currentStock > maximum) return "Above Recommended";
        return "Normal";
    }

    function collectSpareDataQualityFlags(row, derived) {
        const flags = new Set(Array.isArray(row?.data_quality_flags) ? row.data_quality_flags.filter(Boolean) : []);
        if (!String(derived.partNumber || "").trim()) flags.add("Missing Part Number");
        if (!String(derived.name || "").trim()) flags.add("Missing Spare Part Name");
        if (derived.currentStock === null) flags.add("Missing Current Stock");
        if (derived.minimum === null) flags.add("Missing Minimum");
        if (derived.maximum === null) flags.add("Missing Maximum");
        if (derived.currentStock !== null && derived.currentStock < 0) flags.add("Negative stock quantity");
        if (derived.minimum !== null && derived.maximum !== null && derived.minimum > derived.maximum) flags.add("Minimum greater than Maximum");
        if (Number(row?.duplicate_count || 1) > 1) flags.add("Duplicate Part Number");
        return [...flags];
    }

    function sortSpareStockHealthRows(rows) {
        return [...(rows || [])].sort((a, b) => {
            const statusDiff = (STOCK_HEALTH_STATUS_ORDER[a.stock_health_status] ?? 99) - (STOCK_HEALTH_STATUS_ORDER[b.stock_health_status] ?? 99);
            if (statusDiff) return statusDiff;
            const buyDiff = Number(b.quantity_to_buy || 0) - Number(a.quantity_to_buy || 0);
            if (buyDiff) return buyDiff;
            return String(a.name || a.code || "").localeCompare(String(b.name || b.code || ""));
        });
    }

    function getFilteredSparePartsData(payload) {
        const filters = state.sparePartsFilters;
        const inventory = (payload?.inventory?.records || [])
            .filter((row) => !filters.itemCode || String(row?.code || "").toLowerCase().includes(filters.itemCode))
            .filter((row) => filters.stockStatus === "all" || row?.stock_status_group === filters.stockStatus)
            .filter((row) => {
                if (!filters.search) return true;
                return [row?.code, row?.name, row?.translated_name, row?.description, row?.item_group]
                    .some((value) => String(value || "").toLowerCase().includes(filters.search));
            });

        const poRows = (payload?.po_classification?.records || [])
            .filter((row) => rowWithinSpareRange(row, ["po_date", "goods_received_date"], false))
            .filter((row) => !filters.itemCode || String(row?.code || "").toLowerCase().includes(filters.itemCode))
            .filter((row) => !filters.search || [
                row?.code,
                row?.original_description,
                row?.translated_description,
                row?.clean_description,
                row?.group_of_cost,
                row?.pd_machine,
                row?.vendor_name,
            ].some((value) => String(value || "").toLowerCase().includes(filters.search)))
            .filter((row) => filters.supplier === "all" || (row?.vendor_name || row?.supplier) === filters.supplier)
            .filter((row) => filters.classification === "all" || row?.classification === filters.classification)
            .filter((row) => filters.confidence === "all" || row?.confidence === filters.confidence)
            .filter((row) => filters.translationStatus === "all" || row?.translation_status === filters.translationStatus)
            .filter((row) => filters.inventoryMatchStatus === "all" || row?.inventory_match_status === filters.inventoryMatchStatus)
            .filter((row) => filters.groupOfCost === "all" || row?.group_of_cost === filters.groupOfCost)
            .filter((row) => filters.pdMachine === "all" || row?.pd_machine === filters.pdMachine);

        const sparePoRows = poRows.filter((row) => ["Stocked Spare Part Purchase", "Non-Stock Spare Part / Direct Purchase"].includes(row?.classification));
        const nonSpareRows = poRows.filter((row) => row?.classification === "Non-Spare Part / Service");
        const manualReviewRows = poRows.filter((row) => row?.needs_manual_review || row?.classification === "Manual Review");
        const inventorySummaryRows = buildSpareInventorySummaryRows(inventory, sparePoRows, filters.stockStatus);
        const topPurchaseRows = buildSpareTopPurchaseRows(sparePoRows);
        const topVendorRows = buildSpareVendorRows(sparePoRows);
        const storeDrawn = (payload?.consumption?.store_drawn_records || [])
            .filter((row) => !filters.search || [row?.code, row?.name, row?.item_name, row?.description]
                .some((value) => String(value || "").toLowerCase().includes(filters.search)));
        return { inventory, poRows, sparePoRows, nonSpareRows, manualReviewRows, inventorySummaryRows, topPurchaseRows, topVendorRows, storeDrawn };
    }

    function sumSpareValue(rows, key) {
        const values = (rows || []).map((row) => row?.[key]).filter((value) => value !== null && value !== undefined && !Number.isNaN(Number(value)));
        return values.length ? values.reduce((total, value) => total + Number(value), 0) : null;
    }

    function sumSpareQuantity(rows, key = "quantity_ordered") {
        const values = (rows || []).map((row) => row?.[key]).filter((value) => value !== null && value !== undefined && !Number.isNaN(Number(value)));
        return values.length ? values.reduce((total, value) => total + Number(value), 0) : null;
    }

    function getSpareKpiDisplayMode(value) {
        const normalized = String(value ?? "").trim().toLowerCase();
        if (!normalized || normalized === "--" || normalized === "no data") return "is-empty";
        if (normalized.includes("cannot calculate") || normalized.includes("unavailable")) return "is-note";
        return "is-number";
    }

    function setSpareKpiValue(id, value) {
        const node = document.getElementById(id);
        if (!node) return;
        const text = value === null || value === undefined ? "--" : String(value);
        const displayMode = getSpareKpiDisplayMode(text);
        node.innerHTML = `<span class="spare-kpi-value ${displayMode}">${escapeHtml(text)}</span>`;
    }

    function renderSpareOverviewContext(filtered) {
        const node = document.getElementById("spare-overview-context");
        if (!node) return;
        const filters = state.sparePartsFilters || {};
        const rowCount = formatInteger((filtered?.poRows || []).length);
        if (filters.month !== "all") {
            node.textContent = `${formatSpareMonthLabel(filters.month)} purchase view. ${rowCount} Gen PO row(s) match the current filters.`;
            return;
        }
        if (filters.year !== "all") {
            node.textContent = `${filters.year} purchase view. ${rowCount} Gen PO row(s) match the current filters.`;
            return;
        }
        if (filters.period === "ytd") {
            node.textContent = `${new Date().getFullYear()} year-to-date purchase view. ${rowCount} Gen PO row(s) match the current filters.`;
            return;
        }
        node.textContent = `Showing all imported purchase data. ${rowCount} Gen PO row(s) are included in the overview.`;
    }

    function useSpareOverviewSummary() {
        const filters = state.sparePartsFilters || {};
        const dateControlsActive = sparePartsHasDateFilterControls() && sparePurchaseDateFilterActive();
        return !dateControlsActive
            && !filters.itemCode
            && !filters.search
            && filters.supplier === "all"
            && filters.classification === "all"
            && filters.confidence === "all"
            && filters.translationStatus === "all"
            && filters.inventoryMatchStatus === "all"
            && filters.groupOfCost === "all"
            && filters.pdMachine === "all"
            && filters.stockStatus === "all";
    }

    function calculateSpareStockHealthMetrics(rows) {
        return {
            quantityTotal: sumSpareQuantity(rows, "current_quantity"),
            inStock: rows.filter((row) => row?.stock_status_group === "In Stock").length,
            lowStock: rows.filter((row) => row?.stock_status_group === "Low Stock").length,
            outOfStock: rows.filter((row) => row?.stock_status_group === "Out of Stock").length,
            overstock: rows.filter((row) => row?.stock_status_group === "Overstock").length,
            unknown: rows.filter((row) => row?.stock_status_group === "Unknown Stock Threshold").length,
        };
    }

    function renderSparePartsKpis(filtered, payload = {}) {
        const summary = payload?.comparison?.summary || {};
        const useSummary = useSpareOverviewSummary();
        const filteredInventoryValue = sumSpareValue(filtered.inventory, "stock_value");
        const filteredExternalSpareValue = sumSpareValue(filtered.sparePoRows, "total_cost");
        const filteredStockedPoValue = sumSpareValue(filtered.sparePoRows.filter((row) => row?.classification === "Stocked Spare Part Purchase"), "total_cost");
        const filteredNonStockPoValue = sumSpareValue(filtered.sparePoRows.filter((row) => row?.classification === "Non-Stock Spare Part / Direct Purchase"), "total_cost");
        const filteredNonSpareValue = sumSpareValue(filtered.nonSpareRows, "total_cost");
        const filteredInventoryQty = sumSpareQuantity(filtered.inventory, "current_quantity");
        const pickSummaryNumber = (key, fallback) => {
            const value = toFiniteNumber(summary?.[key]);
            return useSummary && value !== null ? value : fallback;
        };
        const hasSummaryKey = (key) => Object.prototype.hasOwnProperty.call(summary, key);
        const inventoryValue = useSummary && hasSummaryKey("current_inventory_value")
            ? toFiniteNumber(summary.current_inventory_value)
            : filteredInventoryValue;
        const externalSpareValue = pickSummaryNumber("external_po_spare_part_value", filteredExternalSpareValue);
        const stockedPoValue = pickSummaryNumber("stocked_spare_part_po_value", filteredStockedPoValue);
        const nonStockPoValue = pickSummaryNumber("non_stock_spare_part_po_value", filteredNonStockPoValue);
        const nonSpareValue = pickSummaryNumber("non_spare_part_service_po_value", filteredNonSpareValue);
        const currentStockedItems = pickSummaryNumber("current_stocked_spare_part_items", filtered.inventory.length);
        const inStockRows = filtered.inventory.filter((row) => Number(row?.current_quantity) > 0);
        const inStockItems = pickSummaryNumber("in_stock_items", inStockRows.length);
        const inStockValue = pickSummaryNumber("in_stock_value", sumSpareValue(inStockRows, "stock_value"));
        const stockedCount = pickSummaryNumber("stocked_spare_part_po_count", filtered.sparePoRows.filter((row) => row?.classification === "Stocked Spare Part Purchase").length);
        const nonStockCount = pickSummaryNumber("non_stock_spare_part_po_count", filtered.sparePoRows.filter((row) => row?.classification === "Non-Stock Spare Part / Direct Purchase").length);
        const servicesCount = pickSummaryNumber("non_spare_part_po_count", filtered.nonSpareRows.length);
        const manualReviewCount = pickSummaryNumber("manual_review_po_items", filtered.poRows.filter((row) => row?.classification === "Manual Review").length);
        const inventoryQty = pickSummaryNumber("current_stock_quantity", filteredInventoryQty);
        const spareQty = pickSummaryNumber("gen_po_spare_part_quantity", sumSpareQuantity(filtered.sparePoRows, "quantity_ordered"));
        const nonSpareQty = pickSummaryNumber("gen_po_non_spare_part_quantity", sumSpareQuantity(filtered.nonSpareRows, "quantity_ordered"));
        const spareLineCount = pickSummaryNumber("gen_po_spare_part_line_count", filtered.sparePoRows.length);
        const exactMatches = pickSummaryNumber("exact_item_code_matches", filtered.poRows.filter((row) => row?.inventory_match_status === "Exact Item Code Match").length);
        const descriptionMatches = pickSummaryNumber("description_matches", filtered.poRows.filter((row) => row?.inventory_match_status === "Description Match").length);
        const translationFailed = pickSummaryNumber("translation_failed_items", filtered.poRows.filter((row) => row?.translation_status === "Translation failed").length);
        const comparisonTotalValue = inventoryValue !== null && nonStockPoValue !== null
            ? Number(inventoryValue) + Number(nonStockPoValue)
            : null;
        const inventorySharePct = comparisonTotalValue && comparisonTotalValue > 0
            ? (Number(inventoryValue) / comparisonTotalValue) * 100
            : null;
        const nonStockSharePct = comparisonTotalValue && comparisonTotalValue > 0
            ? (Number(nonStockPoValue) / comparisonTotalValue) * 100
            : null;
        const matchCoverage = filtered.poRows.length ? ((exactMatches + descriptionMatches) / filtered.poRows.length) * 100 : null;
        const health = calculateSpareStockHealthMetrics(filtered.inventory);
        if (useSummary && inventoryQty !== null) health.quantityTotal = inventoryQty;

        setSpareKpiValue("spare-in-stock-items", formatInteger(inStockItems));
        setSpareKpiValue("spare-in-stock-value", formatSpareCurrency(inStockValue));
        setSpareKpiValue("spare-stocked-value", formatSpareCurrency(stockedPoValue));
        setSpareKpiValue("spare-stocked-count", formatInteger(stockedCount));
        setSpareKpiValue("spare-non-stock-spare-po-value", formatSpareCurrency(nonStockPoValue));
        setSpareKpiValue("spare-non-stock-count", formatInteger(nonStockCount));
        setSpareKpiValue("spare-non-spare-service-po-value", formatSpareCurrency(nonSpareValue));
        setSpareKpiValue("spare-services-count", formatInteger(servicesCount));

        setSpareKpiValue("spare-health-total-parts", health.quantityTotal === null ? "No data" : formatNullableNumber(health.quantityTotal));
        setSpareKpiValue("spare-health-normal-count", formatInteger(health.inStock));
        setSpareKpiValue("spare-health-reorder-required", formatInteger(health.lowStock));
        setSpareKpiValue("spare-health-quantity-to-buy", formatInteger(health.outOfStock));
        setSpareKpiValue("spare-health-above-recommended", formatInteger(health.overstock));
        setSpareKpiValue("spare-health-percent", formatInteger(translationFailed));

        setText("spare-store-drawn-value", formatInteger(exactMatches));
        setText("spare-bought-outside-value", formatInteger(descriptionMatches));
        setText("spare-total-spend", matchCoverage === null ? "No data" : `${formatNumber(matchCoverage, 1)}%`);
        setText("spare-fast-moving-parts", spareQty === null ? "No data" : formatNullableNumber(spareQty));
        setText("spare-slow-moving-parts", nonSpareQty === null ? "No data" : formatNullableNumber(nonSpareQty));
        setText("spare-dormant-parts", formatInteger(spareLineCount));
        setText("spare-selector-inventory-metric", `${formatInteger(currentStockedItems)} items`);
        setText("spare-selector-external-metric", formatSpareCurrency(externalSpareValue));
        setText(
            "spare-selector-comparison-metric",
            inventorySharePct === null || nonStockSharePct === null
                ? "No data"
                : `Inv ${formatNumber(inventorySharePct, 1)}% / Non-stock ${formatNumber(nonStockSharePct, 1)}%`
        );
    }

    function formatSpareCount(value, hasRows) {
        return hasRows ? formatInteger(value) : "No data";
    }

    function formatSpareCurrency(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return "No data";
        return spFmt(Number(value));
    }

    function formatSpareCurrencyOrNA(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
        return spFmt(Number(value));
    }

    function renderSpareStockHealthSummary(filtered) {
        const summaryNode = document.getElementById("spare-stock-health-summary");
        const qualityNode = document.getElementById("spare-stock-quality-warning");
        const rows = filtered.inventory || [];
        const health = calculateSpareStockHealthMetrics(rows);
        if (summaryNode) {
            if (!rows.length) {
                summaryNode.textContent = "No spare parts match the selected filters.";
            } else {
                summaryNode.textContent = `${formatInteger(health.inStock)} items are currently in stock, ${formatInteger(health.lowStock)} are low stock, ${formatInteger(health.outOfStock)} are out of stock, ${formatInteger(health.overstock)} are overstock, and ${formatInteger(health.unknown)} have unknown stock thresholds.`;
            }
        }
        if (qualityNode) {
            const qualityRows = groupSpareQualityFlags(rows);
            qualityNode.classList.toggle("hidden", !qualityRows.length);
            qualityNode.innerHTML = qualityRows.length
                ? `<strong>Data quality:</strong> ${qualityRows.map((row) => `${escapeHtml(formatInteger(row.count))} ${escapeHtml(row.label)}`).join("; ")}`
                : "";
        }
    }

    function groupSpareQualityFlags(rows) {
        const counts = new Map();
        rows.forEach((row) => (row.data_quality_flags || []).forEach((flag) => {
            counts.set(flag, (counts.get(flag) || 0) + 1);
        }));
        const requiredOrder = [
            "Missing Current Stock",
            "Missing Minimum",
            "Missing Maximum",
            "Missing Part Number",
            "Missing Spare Part Name",
            "Duplicate Part Number",
            "Negative stock quantity",
            "Minimum greater than Maximum",
        ];
        return [...counts.entries()]
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => {
                const orderDiff = (requiredOrder.indexOf(a.label) === -1 ? 99 : requiredOrder.indexOf(a.label))
                    - (requiredOrder.indexOf(b.label) === -1 ? 99 : requiredOrder.indexOf(b.label));
                return orderDiff || b.count - a.count || a.label.localeCompare(b.label);
            });
    }

    function renderSparePartsCharts(filtered) {
        renderSpareInventoryVsPurchaseChart(filtered);
        renderSparePoBreakdownChart(filtered);
        renderSparePoTrendChart(filtered);
        renderSparePieChart("spare-stock-status-chart", getStockHealthBreakdown(filtered.inventory), "Current inventory file not uploaded.");
        renderTopVendorChart(filtered.topVendorRows);
        renderTopPurchasedSparePartsChart(filtered.topPurchaseRows);
    }

    function getStockHealthBreakdown(rows) {
        if (!rows.length) return [];
        const counts = new Map();
        rows.forEach((row) => {
            const status = row.stock_status_group || "Unknown Stock Threshold";
            counts.set(status, (counts.get(status) || 0) + 1);
        });
        return [...new Set(["In Stock", "Low Stock", "Out of Stock", "Overstock", "Unknown Stock Threshold", ...counts.keys()])]
            .map((label) => ({ label, value: counts.get(label) || 0 }))
            .filter((row) => row.value > 0 || ["In Stock", "Low Stock", "Out of Stock", "Overstock", "Unknown Stock Threshold"].includes(row.label));
    }

    function buildSpareInventorySummaryRows(inventoryRows, sparePoRows, stockStatusFilter) {
        const rowsByKey = new Map();
        (inventoryRows || []).forEach((row) => {
            const key = `inventory::${row?.code || row?.name || Math.random()}`;
            rowsByKey.set(key, {
                item_code: row?.code || "--",
                item_name: row?.name || row?.description || "--",
                translated_item_name: row?.translated_name || row?.name || row?.description || "--",
                current_available_stock: row?.current_quantity,
                inventory_unit: row?.unit || "--",
                item_group: row?.item_group || row?.category || "--",
                po_quantity_purchased: 0,
                po_total_value: 0,
                vendor_names: new Set(),
                vendor_count: 0,
                last_po_date: null,
                match_status: "In Inventory",
                classification: "Current Inventory",
                confidence: "High",
                stock_status: row?.stock_status_group || null,
            });
        });

        (sparePoRows || []).forEach((row) => {
            const matchedKey = row?.inventory_match_code ? `inventory::${row.inventory_match_code}` : null;
            const key = matchedKey && rowsByKey.has(matchedKey)
                ? matchedKey
                : `direct::${row?.clean_description || row?.translated_description || row?.original_description || row?.po_number}`;
            const existing = rowsByKey.get(key) || {
                item_code: row?.code || "--",
                item_name: row?.translated_description || row?.original_description || "--",
                translated_item_name: row?.translated_description || row?.original_description || "--",
                current_available_stock: null,
                inventory_unit: row?.unit || "--",
                item_group: row?.group_of_cost || "--",
                po_quantity_purchased: 0,
                po_total_value: 0,
                vendor_names: new Set(),
                vendor_count: 0,
                last_po_date: null,
                match_status: row?.inventory_match_status || "No Inventory Match",
                classification: row?.classification || "--",
                confidence: row?.confidence || "--",
                stock_status: null,
            };
            existing.po_quantity_purchased += Number(row?.quantity_ordered || 0);
            existing.po_total_value += Number(row?.total_cost || 0);
            if (row?.vendor_name || row?.supplier) existing.vendor_names.add(row.vendor_name || row.supplier);
            existing.vendor_count = existing.vendor_names.size;
            if (!existing.last_po_date || String(row?.po_date || "") > String(existing.last_po_date || "")) {
                existing.last_po_date = row?.po_date || existing.last_po_date;
            }
            if (existing.classification === "Current Inventory" && row?.classification) {
                existing.classification = row.classification;
                existing.confidence = row.confidence || existing.confidence;
                existing.match_status = row.inventory_match_status || existing.match_status;
            }
            rowsByKey.set(key, existing);
        });

        return [...rowsByKey.values()]
            .filter((row) => stockStatusFilter === "all" || !row?.stock_status || row?.stock_status === stockStatusFilter)
            .map((row) => ({ ...row, vendor_count: row.vendor_names?.size || row.vendor_count || 0 }))
            .sort((a, b) => Number(b.po_total_value || 0) - Number(a.po_total_value || 0) || String(a.item_name || "").localeCompare(String(b.item_name || "")));
    }

    function buildSpareTopPurchaseRows(rows) {
        const grouped = new Map();
        (rows || []).forEach((row) => {
            const key = row?.inventory_match_code || row?.clean_description || row?.translated_description || row?.original_description || row?.po_number;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    clean_description: row?.clean_description || row?.translated_description || row?.original_description || "--",
                    translated_description: row?.translated_description || row?.original_description || "--",
                    classification: row?.classification || "--",
                    total_quantity_purchased: 0,
                    total_po_value: 0,
                    po_line_count: 0,
                    vendor_names: new Set(),
                    last_purchase_date: null,
                    inventory_match_status: row?.inventory_match_status || "No Inventory Match",
                });
            }
            const item = grouped.get(key);
            item.total_quantity_purchased += Number(row?.quantity_ordered || 0);
            item.total_po_value += Number(row?.total_cost || 0);
            item.po_line_count += 1;
            if (row?.vendor_name || row?.supplier) item.vendor_names.add(row.vendor_name || row.supplier);
            if (!item.last_purchase_date || String(row?.po_date || "") > String(item.last_purchase_date || "")) item.last_purchase_date = row?.po_date || item.last_purchase_date;
        });
        return [...grouped.values()]
            .map((row) => ({ ...row, vendor_count: row.vendor_names?.size || 0 }))
            .sort((a, b) => Number(b.total_po_value || 0) - Number(a.total_po_value || 0));
    }

    function buildSpareVendorRows(rows) {
        const grouped = new Map();
        (rows || []).forEach((row) => {
            const key = row?.vendor_name || row?.supplier || "Unmatched Vendor";
            if (!grouped.has(key)) grouped.set(key, { label: key, price: 0, quantity: 0, lines: 0 });
            const item = grouped.get(key);
            item.price += Number(row?.total_cost || 0);
            item.quantity += Number(row?.quantity_ordered || 0);
            item.lines += 1;
        });
        return [...grouped.values()].sort((a, b) => b.price - a.price || b.quantity - a.quantity || b.lines - a.lines);
    }

    function getSpareMetricValue(row, metric) {
        if (metric === "quantity") return Number(row?.quantity_ordered || row?.total_quantity_purchased || row?.quantity || 0);
        if (metric === "lines") return Number(row?.po_line_count || 1);
        return Number(row?.total_cost || row?.total_po_value || 0);
    }

    function getSpareMetricLabel(metric) {
        if (metric === "quantity") return "Quantity";
        if (metric === "lines") return "PO Line Count";
        return spareCurrency;
    }

    function renderSpareInventoryVsPurchaseChart(filtered) {
        const inventoryValue = sumSpareValue(filtered.inventory, "stock_value");
        const nonStockValue = sumSpareValue(filtered.sparePoRows.filter((row) => row?.classification === "Non-Stock Spare Part / Direct Purchase"), "total_cost");
        const nonSpareValue = sumSpareValue(filtered.nonSpareRows, "total_cost");

        if (inventoryValue !== null) {
            renderSpareBarChart("spare-consumption-chart", [
                { label: "Current Inventory Value", value: spConvert(inventoryValue) },
                { label: "Non-Stock / Direct Purchase Value", value: spConvert(nonStockValue || 0) },
                { label: "Services / Non-Spare PO Value", value: spConvert(nonSpareValue || 0) },
            ], "Inventory value data not available.", "Value", spareCurrency);
            return;
        }

        renderSpareBarChart("spare-consumption-chart", [
            { label: "Current Stock Quantity", value: Number(sumSpareQuantity(filtered.inventory, "current_quantity") || 0) },
            { label: "Gen PO Non-Stock Quantity", value: Number(sumSpareQuantity(filtered.sparePoRows.filter((row) => row?.classification === "Non-Stock Spare Part / Direct Purchase"), "quantity_ordered") || 0) },
            { label: "Gen PO Services / Non-Spare Quantity", value: Number(sumSpareQuantity(filtered.nonSpareRows, "quantity_ordered") || 0) },
        ], "No inventory or Gen PO quantity data available.", "Quantity", "Quantity");
    }

    function renderSparePoBreakdownChart(filtered) {
        const metric = state.sparePartsFilters.metric;
        const grouped = new Map();
        (filtered.poRows || []).forEach((row) => {
            const key = row?.classification || "Unclassified";
            grouped.set(key, (grouped.get(key) || 0) + getSpareMetricValue(row, metric));
        });
        const rows = [...grouped.entries()].map(([label, value]) => ({ label, value: metric === "price" ? spConvert(value) : value }));
        renderSparePieChart("spare-po-classification-chart", rows, "Gen PO file not uploaded.");
    }

    function renderSparePoTrendChart(filtered) {
        const metric = state.sparePartsFilters.metric;
        const classifications = [
            "Stocked Spare Part Purchase",
            "Non-Stock Spare Part / Direct Purchase",
            "Non-Spare Part / Service",
            "Manual Review",
        ];
        const buckets = new Map();
        (filtered.poRows || []).forEach((row) => {
            const month = String(row?.po_date || row?.goods_received_date || "").slice(0, 7);
            if (!/^\d{4}-\d{2}$/.test(month)) return;
            if (!buckets.has(month)) buckets.set(month, {});
            const monthBucket = buckets.get(month);
            const key = row?.classification || "Manual Review";
            monthBucket[key] = (monthBucket[key] || 0) + getSpareMetricValue(row, metric);
        });
        const months = [...buckets.keys()].sort();
        if (!months.length) {
            renderSpareChartEmpty("spare-turnover-classification-chart", "No dated Gen PO rows match the current filters.");
            return;
        }
        showSpareChartCanvas("spare-turnover-classification-chart");
        createChart("spare-turnover-classification-chart", {
            type: "line",
            data: {
                labels: months.map(formatSpareMonthLabel),
                datasets: classifications.map((label, index) => ({
                    label,
                    data: months.map((month) => {
                        const value = buckets.get(month)?.[label] || 0;
                        return metric === "price" ? spConvert(value) : value;
                    }),
                    borderColor: ["#2563eb", "#0f766e", "#f59e0b", "#dc2626"][index],
                    backgroundColor: ["#2563eb", "#0f766e", "#f59e0b", "#dc2626"][index],
                    tension: 0.24,
                })),
            },
            options: spareChartOptions(getSpareMetricLabel(metric)),
        });
    }

    function renderTopVendorChart(rows) {
        const metric = state.sparePartsFilters.metric;
        const topRows = (rows || []).slice(0, 10).map((row) => ({
            label: row.label,
            value: metric === "price" ? spConvert(row.price) : row[metric],
        }));
        if (!topRows.length) {
            renderSpareChartEmpty("spare-top-reorder-chart", "No spare-part vendors match the current filters.");
            return;
        }
        renderSpareHorizontalBarChart("spare-top-reorder-chart", topRows, getSpareMetricLabel(metric), "#0f766e");
    }

    function renderTopPurchasedSparePartsChart(rows) {
        const metric = state.sparePartsFilters.metric;
        const topRows = (rows || []).slice(0, 10).map((row) => ({
            label: (row.clean_description || row.translated_description || "Unmatched").slice(0, 42),
            value: metric === "price" ? spConvert(row.total_po_value || 0) : (metric === "quantity" ? row.total_quantity_purchased || 0 : row.po_line_count || 0),
        }));
        if (!topRows.length) {
            renderSpareChartEmpty("spare-inventory-category-chart", "No classified spare part purchases match the current filters.");
            return;
        }
        renderSpareHorizontalBarChart("spare-inventory-category-chart", topRows, getSpareMetricLabel(metric), "#2563eb");
    }

    function groupCount(rows, key) {
        const counts = new Map();
        (rows || []).forEach((row) => {
            const label = row?.[key] || "Unclassified";
            counts.set(label, (counts.get(label) || 0) + 1);
        });
        return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    }

    function groupSum(rows, key, valueKey) {
        const sums = new Map();
        (rows || []).forEach((row) => {
            const value = row?.[valueKey];
            if (value === null || value === undefined || Number.isNaN(Number(value))) return;
            const label = row?.[key] || "Unclassified";
            sums.set(label, (sums.get(label) || 0) + Number(value));
        });
        return [...sums.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    }

    function renderSpareConsumptionChart(filtered) {
        const buckets = new Map();
        filtered.storeDrawn.forEach((row) => {
            const key = String(row?.date || "").slice(0, 7);
            if (!/^\d{4}-\d{2}$/.test(key)) return;
            if (!buckets.has(key)) buckets.set(key, { internal: 0, external: 0 });
            buckets.get(key).internal += Number(row?.value || 0);
        });
        filtered.externalBought.forEach((row) => {
            const key = String(row?.po_date || row?.goods_received_date || "").slice(0, 7);
            if (!/^\d{4}-\d{2}$/.test(key)) return;
            if (!buckets.has(key)) buckets.set(key, { internal: 0, external: 0 });
            buckets.get(key).external += Number(row?.total_cost || 0);
        });
        const keys = [...buckets.keys()].sort();
        if (!keys.length) {
            renderSpareChartEmpty("spare-consumption-chart", "Inventory movement and PO list data not uploaded.");
            return;
        }
        showSpareChartCanvas("spare-consumption-chart");
        createChart("spare-consumption-chart", {
            type: "bar",
            data: {
                labels: keys.map(formatSpareMonthLabel),
                datasets: [
                    { label: "Store Drawn", data: keys.map((key) => spConvert(buckets.get(key).internal)), backgroundColor: "#2563eb", borderRadius: 8 },
                    { label: "Bought Outside", data: keys.map((key) => spConvert(buckets.get(key).external)), backgroundColor: "#8b5cf6", borderRadius: 8 },
                ],
            },
            options: spareChartOptions(spareCurrency),
        });
    }

    function renderSpareBarChart(id, rows, emptyMessage, datasetLabel = "Value", axisLabel = "") {
        if (!rows.length) {
            renderSpareChartEmpty(id, emptyMessage);
            return;
        }
        showSpareChartCanvas(id);
        createChart(id, {
            type: "bar",
            data: {
                labels: rows.map((row) => row.label),
                datasets: [{ label: datasetLabel, data: rows.map((row) => row.value), backgroundColor: "#2563eb", borderRadius: 8 }],
            },
            options: spareChartOptions(axisLabel),
            _scroll: { axis: "x", count: rows.length },
        });
    }

    function renderSpareHorizontalBarChart(id, rows, label, color = "#2563eb") {
        showSpareChartCanvas(id);
        createChart(id, {
            type: "bar",
            data: {
                labels: rows.map((row) => row.label),
                datasets: [{ label, data: rows.map((row) => row.value), backgroundColor: color, borderRadius: 8 }],
            },
            options: spareHorizontalChartOptions(label),
            _scroll: { axis: "y", count: rows.length },
        });
    }

    function renderSparePieChart(id, rows, emptyMessage) {
        if (!rows.length) {
            renderSpareChartEmpty(id, emptyMessage);
            return;
        }
        showSpareChartCanvas(id);
        createChart(id, {
            type: "doughnut",
            data: {
                labels: rows.map((row) => row.label),
                datasets: [{
                    data: rows.map((row) => row.value),
                    backgroundColor: rows.map((row, index) => sparePieColor(row.label, index)),
                    borderWidth: 0,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 10 } } },
                cutout: "62%",
            },
        });
    }

    function sparePieColor(label, index) {
        const colorMap = {
            "In Stock": "#10b981",
            "Low Stock": "#ef4444",
            "Out of Stock": "#991b1b",
            "Overstock": "#2563eb",
            "Unknown Stock Threshold": "#f59e0b",
            "Stocked Spare Part Purchase": "#10b981",
            "Non-Stock Spare Part / Direct Purchase": "#2563eb",
            "Non-Spare Part / Service": "#f59e0b",
            "Manual Review": "#dc2626",
        };
        const palette = ["#2563eb", "#8b5cf6", "#f59e0b", "#10b981", "#64748b", "#0f766e"];
        return colorMap[label] || palette[index % palette.length];
    }

    function spareChartOptions(axisLabel = "") {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 10 } },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const value = context.chart?.options?.indexAxis === "y" ? context.parsed.x : (context.parsed.y ?? context.parsed);
                            return `${context.dataset.label || "Value"}: ${formatNumber(value, 1)}${axisLabel ? ` ${axisLabel}` : ""}`;
                        },
                    },
                },
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: "#64748b", maxRotation: 45, minRotation: 0 } },
                y: { beginAtZero: true, grid: { color: "rgba(148, 163, 184, 0.16)" }, ticks: { color: "#64748b" }, title: axisLabel ? { display: true, text: axisLabel } : undefined },
            },
        };
    }

    function spareHorizontalChartOptions(axisLabel = "") {
        const options = spareChartOptions(axisLabel);
        options.indexAxis = "y";
        options.scales = {
            x: {
                beginAtZero: true,
                grid: { color: "rgba(148, 163, 184, 0.16)" },
                ticks: { color: "#64748b" },
                title: axisLabel ? { display: true, text: axisLabel } : undefined,
            },
            y: {
                grid: { display: false },
                ticks: { color: "#64748b" },
            },
        };
        return options;
    }

    function renderSpareChartEmpty(id, message) {
        if (charts[id]) {
            charts[id].destroy();
            delete charts[id];
        }
        const canvas = document.getElementById(id);
        if (!canvas?.parentElement) return;
        canvas.classList.add("hidden");
        canvas.parentElement.querySelector(".spare-empty-state")?.remove();
        const empty = document.createElement("div");
        empty.className = "spare-empty-state";
        empty.textContent = message || "No data available.";
        canvas.parentElement.appendChild(empty);
    }

    function showSpareChartCanvas(id) {
        const canvas = document.getElementById(id);
        if (!canvas?.parentElement) return;
        canvas.parentElement.querySelector(".spare-empty-state")?.remove();
        canvas.classList.remove("hidden");
    }

    function renderSparePartsTables(filtered) {
        renderSpareTable("spare-current-inventory-table-body", filtered.inventory, 13, (row) => [
            row.code || "--",
            row.name || row.description || "--",
            row.translated_name && row.translated_name !== row.name ? row.translated_name : "--",
            formatNullableNumber(row.current_quantity),
            row.unit || "--",
            row.item_group || row.category || "--",
            formatNullableNumber(row.available_physical),
            formatNullableNumber(row.reserved_physical),
            formatNullableNumber(row.on_order),
            formatNullableNumber(row.min_stock),
            formatNullableNumber(row.max_stock),
            spareStatusBadge(row.stock_status_group || row.stock_health_status || "Unknown Stock Threshold"),
            (row.data_quality_flags || []).join("; ") || "--",
        ], "Current inventory file not uploaded.");

        renderSpareTable("spare-inventory-table-body", filtered.inventorySummaryRows, 13, (row) => [
            row.item_code || "--",
            row.item_name || "--",
            row.translated_item_name && row.translated_item_name !== row.item_name ? row.translated_item_name : "--",
            formatNullableNumber(row.current_available_stock),
            row.inventory_unit || "--",
            row.item_group || "--",
            formatNullableNumber(row.po_quantity_purchased),
            formatSpareCurrency(row.po_total_value),
            formatInteger(row.vendor_count || 0),
            formatShortDate(row.last_po_date),
            spareStatusBadge(row.match_status || "No Inventory Match"),
            spareStatusBadge(row.classification || "--"),
            row.confidence || "--",
        ], "Current inventory file not uploaded.");

        renderSpareTable("spare-external-po-table-body", filtered.poRows, 16, (row) => [
            row.po_number || "--",
            formatShortDate(row.po_date),
            row.code || "--",
            row.original_description || "--",
            row.translated_description || "--",
            row.clean_description || "--",
            formatNullableNumber(row.quantity_ordered),
            row.unit || "--",
            formatSpareCurrency(row.total_cost),
            row.vendor_name || row.supplier || "--",
            row.group_of_cost || "--",
            row.pd_machine || "--",
            spareStatusBadge(row.classification),
            row.confidence || "--",
            row.classification_reason || "--",
            spareStatusBadge(row.translation_status || "No translation needed"),
        ], "Gen PO file not uploaded.");

        renderSpareTable("spare-turnover-table-body", filtered.topPurchaseRows, 8, (row) => [
            row.clean_description || "--",
            row.translated_description || "--",
            spareStatusBadge(row.classification || "--"),
            formatNullableNumber(row.total_quantity_purchased),
            formatSpareCurrency(row.total_po_value),
            formatInteger(row.po_line_count || 0),
            formatInteger(row.vendor_count || 0),
            formatShortDate(row.last_purchase_date),
        ], "No classified spare part purchases for the selected filters.");

        spareManualReviewRowsCache = filtered.manualReviewRows || [];
        renderSpareManualReviewTable();
    }

    let spareManualReviewRowsCache = [];
    let spareManualReviewSearchTerm = "";

    function spareManualReviewRowMatches(row, term) {
        if (!term) return true;
        return [
            row.po_number,
            row.code,
            row.original_description,
            row.translated_description,
            row.clean_description,
            row.vendor_name,
            row.supplier,
            (row.review_reasons || []).join(" "),
            row.classification_reason,
            formatShortDate(row.po_date),
        ].some((value) => String(value || "").toLowerCase().includes(term));
    }

    function renderSpareManualReviewTable() {
        const term = spareManualReviewSearchTerm;
        const rows = (spareManualReviewRowsCache || []).filter((row) => spareManualReviewRowMatches(row, term));
        const emptyMessage = term
            ? `No manual review rows match "${term}".`
            : "No manual review PO items for the selected filters.";
        renderSpareTable("spare-manual-review-table-body", rows, 8, (row) => [
            row.po_number || "--",
            formatShortDate(row.po_date),
            row.code || "--",
            row.original_description || "--",
            row.translated_description || "--",
            formatSpareCurrency(row.total_cost),
            row.vendor_name || row.supplier || "--",
            (row.review_reasons || []).join("; ") || row.classification_reason || "Manual Review",
        ], emptyMessage);
        const countEl = document.getElementById("spare-manual-review-count");
        if (countEl) {
            const total = (spareManualReviewRowsCache || []).length;
            countEl.textContent = term ? `${rows.length} of ${total}` : `${total}`;
        }
    }

    function renderSpareTable(id, rows, colspan, cellMapper, emptyMessage, rowOptionsMapper) {
        const body = document.getElementById(id);
        if (!body) return;
        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="${colspan}" class="empty-row">${escapeHtml(emptyMessage || "No data available.")}</td></tr>`;
            return;
        }
        body.innerHTML = rows.map((row) => (
            `<tr${renderSpareTableRowAttrs(rowOptionsMapper ? rowOptionsMapper(row) : null)}>${cellMapper(row).map((cell) => `<td>${renderSpareTableCell(cell)}</td>`).join("")}</tr>`
        )).join("");
    }

    function renderSpareTableRowAttrs(options) {
        if (!options) return "";
        const classAttr = options.className ? ` class="${escapeHtml(options.className)}"` : "";
        const dataAttrs = options.data
            ? Object.entries(options.data).map(([key, value]) => ` data-${escapeHtml(key)}="${escapeHtml(value)}"`).join("")
            : "";
        return `${classAttr}${dataAttrs}`;
    }

    function renderSpareTableCell(cell) {
        if (cell && typeof cell === "object" && Object.prototype.hasOwnProperty.call(cell, "html")) return cell.html;
        if (typeof cell === "string" && cell.trim().startsWith("<span")) return cell;
        return escapeHtml(cell);
    }

    function spareStockStatusCell(row) {
        const warnings = (row.data_quality_flags || []).length
            ? `<span class="table-subtext">${escapeHtml(row.data_quality_flags.join("; "))}</span>`
            : "";
        return `<div class="spare-status-stack">${spareStatusBadge(row.stock_health_status)}${warnings}</div>`;
    }

    function spareStatusBadge(value) {
        const text = String(value || "Unclassified");
        const cls = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return `<span class="status-pill spare-status-${escapeHtml(cls)}">${escapeHtml(text)}</span>`;
    }

    function formatSpareQuantityToBuy(value) {
        return value === null || value === undefined || Number.isNaN(Number(value)) ? "N/A" : formatNullableNumber(value);
    }

    function formatNullableNumber(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return "No data";
        return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    // ─── Shared currency state (whole spare parts page) ──────────────────────

    let spareCurrency = "THB";
    const PT_THB_SGD_RATE = 0.038; // Indicative rate: 1 THB ≈ 0.038 SGD

    function spConvert(thbValue) {
        if (thbValue === null || thbValue === undefined) return null;
        return spareCurrency === "SGD" ? thbValue * PT_THB_SGD_RATE : thbValue;
    }

    function spFmt(thbValue) {
        const v = spConvert(thbValue);
        if (v === null || v === undefined) return "--";
        const digits = spareCurrency === "SGD" ? 2 : 0;
        return `${spareCurrency} ${Number(v).toLocaleString(undefined, { maximumFractionDigits: digits })}`;
    }

    // ─── Project Actual Transactions ─────────────────────────────────────────

    function ptConvert(thbValue) {
        return spConvert(thbValue);
    }

    function ptFmtCurrency(thbValue) {
        return spFmt(thbValue);
    }

    function ptFmtCurrencyOrNA(thbValue) {
        if (thbValue === null || thbValue === undefined || Number.isNaN(Number(thbValue))) return "N/A";
        return ptFmtCurrency(thbValue);
    }

    async function loadProjectTransactions() {
        let payload = {};
        try {
            payload = await fetchJson("/api/maintenance/project_transactions");
        } catch (error) {
            console.error("Project Transactions load failed:", error);
            payload = { status: "error", error: String(error), transactions: [], top_parts: [], by_asset: [], manual_review: [], summary: {}, charts: {} };
        }
        state.ptData = payload;
        populatePtFilters(payload);
        populateAssetPartsIntelFilters();
        renderPtDashboard(payload);
    }

    // ── All-Years Yearly Comparison ─────────────────────────────────────────

    const AY_YEAR_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#7c3aed", "#dc2626"];
    const FY_START_MONTH = 4; // financial year starts in April (matches backend)
    let ayData = null;
    let aySelectedYear = null;
    let ayMonthlyYear = "all";
    let ayActiveTab = "yearly";

    function ayConvert(thbValue) { return spConvert(thbValue); }
    function ayFmt(thbValue) { return spFmt(thbValue); }

    async function loadAllYearsTransactions() {
        let payload = {};
        try {
            payload = await fetchJson("/api/maintenance/project_transactions_all");
        } catch (err) {
            console.error("All-years transactions load failed:", err);
            payload = { status: "error" };
        }
        ayData = payload;
        aySelectedYear = (payload?.years || [])[payload?.years?.length - 1] || null;
        // Non-chart DOM updates run synchronously
        try { populateAllPartsYearFilter(); } catch(e) { console.error("populateAllPartsYearFilter:", e); }
        try { renderAllPtPartsTable(); } catch(e) { console.error("renderAllPtPartsTable:", e); }
        try { populatePtTableFilters(payload); } catch(e) { console.error("populatePtTableFilters:", e); }
        if (payload?.transactions?.length) {
            try { renderPartAssetTable(_buildPauDataFromTxns(payload.transactions)); } catch(e) { console.error("PAU all-years rebuild:", e); }
        }
        // Chart rendering deferred so DOM is laid out before Chart.js measures canvas sizes
        requestAnimationFrame(() => {
            try { renderAllYearsComparison(payload); } catch(e) { console.error("renderAllYearsComparison:", e); }
            try { initSptSection(); } catch(e) { console.error("initSptSection:", e); }
        });
    }

    function setAyTab(tab) {
        ayActiveTab = tab;
        document.querySelectorAll(".ay-tab-btn").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.aytab === tab);
        });
        const yearlyPanel = document.getElementById("ay-panel-yearly");
        const sptPanel = document.getElementById("ay-panel-spt");
        if (tab === "yearly") {
            if (yearlyPanel) yearlyPanel.style.display = "";
            if (sptPanel) sptPanel.style.display = "none";
            if (ayData?.status === "ok") requestAnimationFrame(() => renderAllYearsComparison(ayData));
        } else {
            if (yearlyPanel) yearlyPanel.style.display = "none";
            if (sptPanel) sptPanel.style.display = "";
            requestAnimationFrame(() => {
                if (!sptState.selectedKey && ayData?.transactions?.length) {
                    try { initSptSection(); } catch(e) { console.error("initSptSection fallback:", e); }
                } else if (ayData?.transactions?.length) {
                    try { renderSptSection(); } catch(e) { console.error("renderSptSection:", e); }
                }
            });
        }
    }

    function renderAllYearsComparison(payload) {
        const section = document.getElementById("ay-combined-section");
        if (!section) return;

        const subtitleEl = document.getElementById("ay-subtitle");
        if (payload?.status === "missing" || payload?.status === "error") {
            if (subtitleEl) subtitleEl.textContent = payload?.error || "Data unavailable.";
            return;
        }

        const years = payload?.years || [];
        const summary = payload?.yearly_summary || [];
        const monthlyByYear = payload?.monthly_by_year || {};
        const categoryByYear = payload?.category_by_year || {};
        const topPartsByYear = payload?.top_parts_by_year || {};
        const yoyGrowth = payload?.yoy_growth || [];
        const ayCurrency = spareCurrency;
        const monthlyYearFilter = document.getElementById("ay-monthly-year-filter");
        if (monthlyYearFilter) {
            if (ayMonthlyYear !== "all" && !years.map(String).includes(String(ayMonthlyYear))) ayMonthlyYear = "all";
            monthlyYearFilter.innerHTML = `<option value="all">All FY</option>` + years.map((year) => (
                `<option value="${escapeHtml(String(year))}">FY${escapeHtml(String(year))}</option>`
            )).join("");
            monthlyYearFilter.value = ayMonthlyYear;
        }

        if (subtitleEl) {
            const total = summary.reduce((s, y) => s + (y.total_consumption || 0), 0);
            const fyList = years.map((y) => `FY${y}`).join(", ");
            subtitleEl.textContent = `${fyList} (financial year, Apr–Mar) · ${payload.total_records?.toLocaleString() || 0} transactions · ${ayFmt(total)} total consumption`;
        }

        // KPI cards
        const kpiGrid = document.getElementById("ay-kpi-grid");
        if (kpiGrid) {
            kpiGrid.innerHTML = summary.map((yr, i) => {
                const color = AY_YEAR_COLORS[i % AY_YEAR_COLORS.length];
                return `<div class="ay-kpi-card" style="--ay-accent:${color}">
                    <div class="ay-kpi-year" title="${yr.fy_span || ""}">FY${yr.year}</div>
                    <div class="ay-kpi-main">${ayFmt(yr.total_consumption)}</div>
                    <div class="ay-kpi-sub">Total spare part consumption</div>
                    <div class="ay-kpi-meta">
                        <span class="ay-kpi-pill">${yr.transaction_lines} lines</span>
                        <span class="ay-kpi-pill">${yr.unique_assets} assets</span>
                        <span class="ay-kpi-pill">${yr.unique_work_orders} WOs</span>
                        <span class="ay-kpi-pill">${yr.unique_parts} parts</span>
                    </div>
                </div>`;
            }).join("");
        }

        // YoY consumption % pills (consumption up is not necessarily good)
        const yoyRow = document.getElementById("ay-yoy-row");
        if (yoyRow) {
            yoyRow.innerHTML = yoyGrowth.map((g) => {
                if (g.growth_pct === null || g.growth_pct === undefined) {
                    return `<span class="ay-yoy-pill ay-yoy-flat">FY${g.from}→FY${g.to}: ${g.label || "New"}</span>`;
                }
                const cls = g.growth_pct > 5 ? "ay-yoy-up" : g.growth_pct < -5 ? "ay-yoy-down" : "ay-yoy-flat";
                const arrow = g.growth_pct > 0 ? "▲" : g.growth_pct < 0 ? "▼" : "–";
                return `<span class="ay-yoy-pill ${cls}">FY${g.from}→FY${g.to}: ${arrow} ${Math.abs(g.growth_pct)}%</span>`;
            }).join("");
        }

        // Chart 1: Yearly bar chart
        {
            const labels = summary.map((y) => `FY${y.year}`);
            const values = summary.map((y) => Number(ayConvert(y.total_consumption).toFixed(ayCurrency === "SGD" ? 2 : 0)));
            const colors = summary.map((_, i) => AY_YEAR_COLORS[i % AY_YEAR_COLORS.length]);
            createChart("ay-chart-yearly", {
                type: "bar",
                data: {
                    labels,
                    datasets: [{ label: ayCurrency, data: values, backgroundColor: colors, borderRadius: 8 }],
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: "#64748b", font: { size: 12, weight: "700" } } },
                        y: { beginAtZero: true, grid: { color: "rgba(148,163,184,0.15)" }, ticks: { color: "#64748b", font: { size: 10 } } },
                    },
                },
            });
        }

        // Chart 2: Monthly overlay — shared Apr–Mar financial-year axis, one filled line per FY
        {
            // Financial-year axis: April → March.
            const MONTH_LABELS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
            // Fill colours with stronger alpha so areas are visible but don't fully obscure each other
            const fillAlphas = ["44", "33", "44"];
            const chartYears = ayMonthlyYear === "all" ? years : years.filter((yr) => String(yr) === String(ayMonthlyYear));
            const datasets = chartYears.map((yr, i) => {
                const byMo = new Array(12).fill(0);
                (monthlyByYear[String(yr)] || []).forEach((e) => {
                    const cal = parseInt(e.month.split("-")[1], 10);          // 1..12 calendar month
                    const idx = (cal - FY_START_MONTH + 12) % 12;            // Apr→0 … Mar→11
                    if (idx >= 0 && idx < 12) byMo[idx] = Number(ayConvert(e.total).toFixed(ayCurrency === "SGD" ? 2 : 0));
                });
                const color = AY_YEAR_COLORS[i % AY_YEAR_COLORS.length];
                return {
                    label: `FY${yr}`,
                    data: byMo,
                    borderColor: color,
                    backgroundColor: color + (fillAlphas[i] || "33"),
                    tension: 0.35,
                    fill: true,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: color,
                    pointBorderColor: "#fff",
                    pointBorderWidth: 2,
                    borderWidth: 2.5,
                };
            });
            createChart("ay-chart-monthly", {
                type: "line",
                data: { labels: MONTH_LABELS, datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    plugins: {
                        legend: { display: true, position: "top", labels: { font: { size: 11 }, boxWidth: 14, padding: 14, usePointStyle: true, pointStyle: "circle" } },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => ` ${ctx.dataset.label}: ${ayCurrency} ${Number(ctx.parsed.y).toLocaleString(undefined, { maximumFractionDigits: ayCurrency === "SGD" ? 2 : 0 })}`,
                            },
                        },
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: "#64748b", font: { size: 11 } } },
                        y: { beginAtZero: true, grid: { color: "rgba(148,163,184,0.12)" }, ticks: { color: "#64748b", font: { size: 10 }, callback: (v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v } },
                    },
                },
            });
        }

        // Chart 3: Category breakdown stacked bar
        {
            const allCats = [...new Set(
                Object.values(categoryByYear).flatMap((entries) => entries.map((e) => e.category))
            )];
            const catColors = ["#1e40af","#0f766e","#7c3aed","#b45309","#dc2626","#0891b2","#65a30d","#d97706"];
            const datasets = allCats.map((cat, ci) => ({
                label: cat,
                data: years.map((yr) => {
                    const entry = (categoryByYear[String(yr)] || []).find((e) => e.category === cat);
                    return entry ? Number(ayConvert(entry.total).toFixed(ayCurrency === "SGD" ? 2 : 0)) : 0;
                }),
                backgroundColor: catColors[ci % catColors.length],
                borderRadius: 4,
            }));
            createChart("ay-chart-category", {
                type: "bar",
                data: { labels: years.map((y) => `FY${y}`), datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: true, position: "right", labels: { font: { size: 10 }, boxWidth: 14 } } },
                    scales: {
                        x: { stacked: true, grid: { display: false }, ticks: { color: "#64748b", font: { weight: "700" } } },
                        y: { stacked: true, beginAtZero: true, grid: { color: "rgba(148,163,184,0.15)" }, ticks: { color: "#64748b", font: { size: 10 } } },
                    },
                },
            });
        }

        // Year tabs for top parts
        const tabsEl = document.getElementById("ay-year-tabs");
        if (tabsEl) {
            tabsEl.innerHTML = years.map((yr) =>
                `<button class="ay-year-tab${yr === aySelectedYear ? " active" : ""}" data-year="${yr}">FY${yr}</button>`
            ).join("");
            tabsEl.querySelectorAll(".ay-year-tab").forEach((btn) => {
                btn.addEventListener("click", () => {
                    aySelectedYear = Number(btn.dataset.year);
                    tabsEl.querySelectorAll(".ay-year-tab").forEach((b) => b.classList.toggle("active", b === btn));
                    renderAyTopParts(topPartsByYear);
                });
            });
        }
        renderAyTopParts(topPartsByYear);

        // Summary table
        const summaryBody = document.getElementById("ay-summary-body");
        if (summaryBody) {
            const growthMap = Object.fromEntries(yoyGrowth.map((g) => [g.to, g]));
            summaryBody.innerHTML = summary.map((yr) => {
                const gObj = growthMap[yr.year];
                const g = gObj ? gObj.growth_pct : undefined;
                const gStr = (g !== null && g !== undefined)
                    ? `<span class="${g > 5 ? "ay-growth-up" : g < -5 ? "ay-growth-down" : "ay-growth-flat"}">${g > 0 ? "▲" : g < 0 ? "▼" : "–"} ${Math.abs(g)}%</span>`
                    : `<span class="ay-growth-flat">${gObj ? (gObj.label || "New") : "—"}</span>`;
                return `<tr>
                    <td><strong>FY${yr.year}</strong></td>
                    <td>${ayFmt(yr.total_consumption)}</td>
                    <td>${yr.transaction_lines.toLocaleString()}</td>
                    <td>${yr.unique_assets}</td>
                    <td>${yr.unique_work_orders}</td>
                    <td>${yr.unique_parts}</td>
                    <td>${gStr}</td>
                </tr>`;
            }).join("");
        }
    }

    function renderAyTopParts(topPartsByYear) {
        const ayCurrency = spareCurrency;
        const yr = aySelectedYear;
        const labelEl = document.getElementById("ay-top-year-label");
        if (labelEl) labelEl.textContent = yr ? `FY${yr}` : "All FY";
        const parts = (topPartsByYear[String(yr)] || []).slice(0, 10);
        if (!parts.length) { createChart("ay-chart-top-parts", { type: "bar", data: { labels: [], datasets: [] }, options: {} }); return; }
        createChart("ay-chart-top-parts", {
            type: "bar",
            data: {
                labels: parts.map((p) => (p.translated || p.description || "Unknown").slice(0, 35)),
                datasets: [{ label: ayCurrency, data: parts.map((p) => Number(ayConvert(p.total).toFixed(ayCurrency === "SGD" ? 2 : 0))), backgroundColor: "#1e40af", borderRadius: 5 }],
            },
            options: {
                indexAxis: "y",
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, grid: { color: "rgba(148,163,184,0.15)" }, ticks: { color: "#64748b", font: { size: 10 } } },
                    y: { grid: { display: false }, ticks: { color: "#64748b", font: { size: 10 } } },
                },
            },
        });
    }

    // ── All Parts Table (multi-year) ──────────────────────────────────────────

    function getPtPartSourceDescription(row) {
        return row?.clean_description || row?.original_description || row?.description || row?.translated_description || row?.translated || "Unknown";
    }

    function getPtPartDisplayDescription(row) {
        return row?.translated_description || row?.translated || row?.clean_description || row?.original_description || row?.description || "Unknown";
    }

    function normalizePtPartKey(value) {
        return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
    }

    function getPtPartYearSelection() {
        return document.getElementById("pt-top-parts-year")?.value || "all";
    }

    function getPtTransactionsForPartsYear() {
        const selectedYear = getPtPartYearSelection();
        let rows = ayData?.transactions?.length ? ayData.transactions : _ptTxnsCache;
        rows = Array.isArray(rows) ? rows : [];
        if (selectedYear !== "all") {
            rows = rows.filter((r) => String(r.fy) === String(selectedYear));
        }
        return rows;
    }

    function renderAllPtPartsTable() {
        const yearSel = document.getElementById("pt-top-parts-year");
        const selectedYear = yearSel?.value || "all";
        let parts = [];
        let pauTxns = null; // transactions to rebuild PAU from

        if (ayData?.status === "ok" && ayData.top_parts_by_year) {
            if (selectedYear === "all") {
                if (ayData.transactions?.length) {
                    // Aggregate from raw transactions for accurate cross-year de-duplication
                    const txnMap = {};
                    ayData.transactions.forEach((r) => {
                        const k = r.clean_description || r.original_description || "Unknown";
                        if (!txnMap[k]) txnMap[k] = { description: k, translated: r.translated_description || k, category: r.item_category, total: 0, qty: 0, _woIds: new Set(), _assetIds: new Set(), _costs: [] };
                        txnMap[k].total += r.total_consumption || 0;
                        txnMap[k].qty += r.quantity_used || 0;
                        if (r.work_order_id) txnMap[k]._woIds.add(r.work_order_id);
                        if (r.asset_id) txnMap[k]._assetIds.add(r.asset_id);
                        if (r.unit_cost_estimate != null) txnMap[k]._costs.push(r.unit_cost_estimate);
                    });
                    parts = Object.values(txnMap)
                        .map((p) => ({ ...p, wo_count: p._woIds.size, asset_count: p._assetIds.size, avg_unit_cost: p._costs.length ? p._costs.reduce((a, b) => a + b, 0) / p._costs.length : null }))
                        .sort((a, b) => b.total - a.total);
                    pauTxns = ayData.transactions;
                } else {
                    // Fallback: combine top_parts_by_year summaries
                    const combined = {};
                    Object.values(ayData.top_parts_by_year).forEach((yearParts) => {
                        yearParts.forEach((p) => {
                            const k = p.description;
                            if (!combined[k]) combined[k] = { ...p, total: 0, qty: 0, wo_count: 0, asset_count: 0, _costs: [] };
                            combined[k].total += p.total;
                            combined[k].qty += p.qty;
                            combined[k].wo_count += p.wo_count || 0;
                            combined[k].asset_count += p.asset_count || 0;
                            if (p.avg_unit_cost != null) combined[k]._costs.push(p.avg_unit_cost);
                        });
                    });
                    parts = Object.values(combined)
                        .map((p) => ({ ...p, avg_unit_cost: p._costs.length ? p._costs.reduce((a, b) => a + b, 0) / p._costs.length : null }))
                        .sort((a, b) => b.total - a.total);
                }
            } else {
                parts = (ayData.top_parts_by_year[selectedYear] || []);
                // Filter all-years transactions to this FY for PAU
                if (ayData.transactions?.length) {
                    pauTxns = ayData.transactions.filter((r) => String(r.fy) === String(selectedYear));
                }
            }
        }
        if (!parts.length && state.ptData?.top_parts) {
            // Final fallback: 2026 Excel data
            parts = (state.ptData.top_parts || []).map((p) => ({
                description: p.description,
                translated: p.translated,
                category: p.category,
                total: p.total_consumption,
                qty: p.total_qty,
                wo_count: p.wo_count,
                asset_count: p.asset_count,
                avg_unit_cost: p.avg_unit_cost,
            }));
        }

        // Apply parts table filters
        if (ptPartsFilter.search) {
            const s = ptPartsFilter.search.toLowerCase();
            parts = parts.filter((p) => (p.translated || p.description || "").toLowerCase().includes(s));
        }
        if (ptPartsFilter.category) {
            parts = parts.filter((p) => p.category === ptPartsFilter.category);
        }

        renderSpareTable("pt-top-parts-body", parts, 7, (r) => [
            r.translated || r.description || "--",
            spareStatusBadge(r.category),
            spFmt(r.total),
            r.qty != null ? Number(r.qty).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "--",
            r.wo_count ?? "--",
            r.asset_count ?? "--",
            r.avg_unit_cost != null ? spFmt(r.avg_unit_cost) : "--",
        ], "No spare parts data.", (r) => {
            const key = normalizePtPartKey(r.description || r.translated);
            return {
                className: `pt-part-row${key && key === ptSelectedPartKey ? " is-selected" : ""}`,
                data: {
                    "part-key": key,
                    "part-label": r.translated || r.description || "--",
                },
            };
        });

        bindPtPartSelection();
        renderSelectedPtPartTransactions();

        // Keep Part Usage by Asset in sync with the same year slice
        if (pauTxns) renderPartAssetTable(_buildPauDataFromTxns(pauTxns));
    }

    function populateAllPartsYearFilter() {
        const yearSel = document.getElementById("pt-top-parts-year");
        if (!yearSel || !ayData?.years) return;
        const years = ayData.years || [];
        yearSel.innerHTML = `<option value="all">All FY</option>` +
            years.map((y) => `<option value="${y}">FY${y}</option>`).join("");
        yearSel.addEventListener("change", () => renderAllPtPartsTable());
    }

    function populatePtFilters(payload) {
        const txns = payload?.transactions || [];
        const months = [...new Set(txns.map((r) => (r.project_date || "").slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort().reverse();
        const ptMonthSel = document.getElementById("pt-month-filter");
        if (ptMonthSel) {
            const cur = state.ptFilters.month;
            ptMonthSel.innerHTML = `<option value="all">All Months</option>` + months.map((m) => `<option value="${escapeHtml(m)}"${m === cur ? " selected" : ""}>${escapeHtml(m)}</option>`).join("");
        }
        const categories = [...new Set(txns.map((r) => r.item_category).filter(Boolean))].sort();
        const ptCatSel = document.getElementById("pt-category-filter");
        if (ptCatSel) {
            const cur = state.ptFilters.category;
            ptCatSel.innerHTML = `<option value="all">All Categories</option>` + categories.map((c) => `<option value="${escapeHtml(c)}"${c === cur ? " selected" : ""}>${escapeHtml(c)}</option>`).join("");
        }
        const assets = [...new Set(txns.map((r) => r.asset_id).filter(Boolean))].sort();
        const ptAssetSel = document.getElementById("pt-asset-filter");
        if (ptAssetSel) {
            const cur = state.ptFilters.asset;
            ptAssetSel.innerHTML = `<option value="all">All Assets</option>` + assets.map((a) => `<option value="${escapeHtml(a)}"${a === cur ? " selected" : ""}>${escapeHtml(a)}</option>`).join("");
        }
    }

    function getFilteredPtTransactions(payload) {
        const txns = payload?.transactions || [];
        const f = state.ptFilters;
        const now = new Date();
        const yearStr = String(now.getFullYear());
        const monthStr = `${yearStr}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        return txns.filter((r) => {
            const d = r.project_date || "";
            if (f.period === "ytd" && !d.startsWith(yearStr)) return false;
            if (f.period === "month" && d.slice(0, 7) !== monthStr) return false;
            if (f.month !== "all" && d.slice(0, 7) !== f.month) return false;
            if (f.category !== "all" && r.item_category !== f.category) return false;
            if (f.asset !== "all" && r.asset_id !== f.asset) return false;
            if (f.search) {
                const s = f.search;
                const hay = [r.work_order_id, r.asset_id, r.translated_description, r.original_description, r.clean_description]
                    .map((v) => String(v || "").toLowerCase()).join(" ");
                if (!hay.includes(s)) return false;
            }
            return true;
        });
    }

    function renderPtDashboard(payload) {
        const txns = getFilteredPtTransactions(payload);
        renderPtStatusBadge(payload);
        renderPtKpis(txns);
        renderPtCharts(payload, txns);
        renderPtTables(txns, payload);
    }

    function renderPtStatusBadge(payload) {
        const badge = document.getElementById("pt-status-badge");
        if (!badge) return;
        const status = payload?.status || "unknown";
        const textMap = { ok: "File loaded", missing: "File not uploaded", no_data: "No data found", error: "Load error" };
        const clsMap = { ok: "pt-badge-ok", missing: "pt-badge-missing", no_data: "pt-badge-warn", error: "pt-badge-error" };
        badge.className = `pt-status-badge ${clsMap[status] || "pt-badge-warn"}`;
        badge.textContent = textMap[status] || status;
        if (payload?.error && status !== "ok") badge.title = payload.error;
    }

    function renderPtKpis(txns) {
        const totalVal = txns.reduce((sum, r) => sum + (r.total_consumption || 0), 0);
        const uniqueWOs = new Set(txns.map((r) => r.work_order_id).filter(Boolean)).size;
        const uniqueAssets = new Set(txns.map((r) => r.asset_id).filter(Boolean)).size;
        const uniqueParts = new Set(txns.map((r) => r.clean_description || r.original_description).filter(Boolean)).size;
        const avgPerWo = uniqueWOs > 0 ? totalVal / uniqueWOs : 0;
        const fmtInt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
        const kpis = {
            "pt-kpi-total-value": ptFmtCurrency(totalVal),
            "pt-kpi-lines": fmtInt(txns.length),
            "pt-kpi-unique-wo": fmtInt(uniqueWOs),
            "pt-kpi-unique-assets": fmtInt(uniqueAssets),
            "pt-kpi-unique-parts": fmtInt(uniqueParts),
            "pt-kpi-avg-per-wo": ptFmtCurrency(avgPerWo),
        };
        // Update KPI card labels for currency
        const sym = state.ptCurrency;
        const labelUpdates = {
            "pt-kpi-total-value": `Total Consumption (${sym})`,
            "pt-kpi-avg-per-wo": `Avg Spend / WO (${sym})`,
        };
        Object.entries(labelUpdates).forEach(([id, label]) => {
            const card = document.getElementById(id)?.closest("article");
            const lbl = card?.querySelector(".summary-label");
            if (lbl) lbl.textContent = label;
        });
        Object.entries(kpis).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        });
    }

    function renderPtCharts(payload, txns) {
        const chartData = payload?.charts || {};
        const sym = state.ptCurrency;

        // Chart A: Monthly trend (line) — filtered + converted
        const monthly = {};
        txns.forEach((r) => {
            const mk = (r.project_date || "").slice(0, 7);
            if (mk) monthly[mk] = (monthly[mk] || 0) + (r.total_consumption || 0);
        });
        const monthlyEntries = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b));
        if (monthlyEntries.length) {
            showSpareChartCanvas("pt-chart-monthly");
            createChart("pt-chart-monthly", {
                type: "line",
                data: {
                    labels: monthlyEntries.map(([m]) => m),
                    datasets: [{ label: sym, data: monthlyEntries.map(([, v]) => Number(ptConvert(v).toFixed(sym === "SGD" ? 2 : 0))), borderColor: "#0f766e", backgroundColor: "rgba(15,118,110,0.12)", fill: true, tension: 0.3, pointRadius: 4 }],
                },
                options: spareChartOptions(sym),
                _scroll: { axis: "x", count: monthlyEntries.length },
            });
        } else {
            renderSpareChartEmpty("pt-chart-monthly", "No data for selected filters.");
        }

        // Chart B: Top 10 by value — filtered + converted
        const byDescVal = {};
        txns.forEach((r) => {
            const k = (r.translated_description || r.clean_description || r.original_description || "Unknown").slice(0, 40);
            byDescVal[k] = (byDescVal[k] || 0) + (r.total_consumption || 0);
        });
        const top10Val = Object.entries(byDescVal).sort(([, a], [, b]) => b - a).slice(0, 10);
        if (top10Val.length) {
            renderSpareHorizontalBarChart("pt-chart-top-value", top10Val.map(([l, v]) => ({ label: l, value: Number(ptConvert(v).toFixed(sym === "SGD" ? 2 : 0)) })), sym, "#0f766e");
        } else {
            renderSpareChartEmpty("pt-chart-top-value", "No data for selected filters.");
        }

        // Chart C: Top 10 by qty — filtered
        const byDescQty = {};
        txns.forEach((r) => {
            const k = (r.translated_description || r.clean_description || r.original_description || "Unknown").slice(0, 40);
            byDescQty[k] = (byDescQty[k] || 0) + (r.quantity_used || 0);
        });
        const top10Qty = Object.entries(byDescQty).sort(([, a], [, b]) => b - a).slice(0, 10);
        if (top10Qty.length) {
            renderSpareHorizontalBarChart("pt-chart-top-qty", top10Qty.map(([l, v]) => ({ label: l, value: Number(v.toFixed(1)) })), "Qty", "#8b5cf6");
        } else {
            renderSpareChartEmpty("pt-chart-top-qty", "No data for selected filters.");
        }

        // Chart D: By asset top 15 — filtered + converted
        // Prefer all-years by_asset for names (richer data), then fall back to txn-level names
        const assetNameMap = {};
        (_ptByAssetCache.length ? _ptByAssetCache : (payload?.by_asset || [])).forEach((a) => {
            if (a.asset_id && a.equipment_name) assetNameMap[a.asset_id] = a.equipment_name;
        });
        txns.forEach((r) => {
            const assetKey = r.resolved_asset_id || r.asset_id;
            const assetLabel = r.resolved_asset_name || r.equipment_name;
            if (assetKey && assetLabel && !assetNameMap[assetKey]) assetNameMap[assetKey] = assetLabel;
        });
        const byAssetVal = {};
        txns.forEach((r) => {
            const k = r.resolved_asset_id || r.asset_id || "Unknown";
            byAssetVal[k] = (byAssetVal[k] || 0) + (r.total_consumption || 0);
        });
        const top15Asset = Object.entries(byAssetVal).sort(([, a], [, b]) => b - a).slice(0, 15);
        if (top15Asset.length) {
            renderSpareHorizontalBarChart("pt-chart-by-asset", top15Asset.map(([assetId, v]) => ({
                label: assetNameMap[assetId] || assetId,
                value: Number(ptConvert(v).toFixed(sym === "SGD" ? 2 : 0)),
            })), sym, "#2563eb");
        } else {
            renderSpareChartEmpty("pt-chart-by-asset", "No data for selected filters.");
        }

        // Chart E: Category doughnut — filtered + converted
        const byCat = {};
        txns.forEach((r) => { byCat[r.item_category || "Unknown"] = (byCat[r.item_category || "Unknown"] || 0) + (r.total_consumption || 0); });
        const catRows = Object.entries(byCat).sort(([, a], [, b]) => b - a);
        if (catRows.length) {
            renderSparePieChart("pt-chart-category", catRows.map(([l, v]) => ({ label: l, value: Number(ptConvert(v).toFixed(sym === "SGD" ? 2 : 0)) })), "No category data.");
        } else {
            renderSpareChartEmpty("pt-chart-category", "No category data.");
        }


    }

    // ── Table filter state ───────────────────────────────────────────────
    const ptTxnFilter = { search: "", category: "", asset: "" };
    const ptPartsFilter = { search: "", category: "" };
    const ptConsumptionState = { view: "asset", search: "", focus: "", criticality: "" };
    const ptConsumptionSelection = { view: "asset", key: "" };
    let ptInsightActiveTab = "part_usage";
    let ptSelectedPartKey = "";
    let ptSelectedPartLabel = "";
    let _ptTxnsCache = [];
    let _ptByAssetCache = [];

    const PT_CONSUMPTION_VIEW_META = {
        asset: {
            label: "Asset",
            empty: "No asset rows match the current filters.",
            title: "Grouped Consumption by Asset",
            subtitle: "Smart matched spare-part spend per specific asset.",
            headers: ["Equipment", "Asset ID", "Asset Family", "Machine Group", "Criticality", "Total Value", "Total Qty", "Lines", "Unique Parts", "Top Part", "Match Quality"],
            cells: (row) => [
                row.equipment_name || row.label || "--",
                row.asset_id || "--",
                row.asset_family || "--",
                row.machine_group || "--",
                row.equipment_criticality || row.criticality || "--",
                ptFmtCurrency(row.total_consumption),
                formatPtQty(row.total_qty),
                formatPtCount(row.line_count),
                formatPtCount(row.unique_parts_count),
                row.top_part || "--",
                ptConsumptionMatchCell(row),
            ],
        },
        asset_family: {
            label: "Asset Family",
            empty: "No asset-family rows match the current filters.",
            title: "Grouped Consumption by Asset Family",
            subtitle: "All related assets rolled up into shared families like Combi Oven or Chiller.",
            headers: ["Asset Family", "Machine Group", "Assets Included", "Total Value", "Total Qty", "Lines", "Unique Parts", "Top Asset", "Top Part", "Area Matches", "Match Quality"],
            cells: (row) => [
                row.asset_family || row.label || "--",
                row.machine_group || "--",
                formatPtCount(row.assets_included || row.asset_count),
                ptFmtCurrency(row.total_consumption),
                formatPtQty(row.total_qty),
                formatPtCount(row.line_count),
                formatPtCount(row.unique_parts_count),
                row.top_consuming_asset || row.top_asset || "--",
                row.top_part || "--",
                formatPtCount(row.general_area_count),
                ptConsumptionMatchCell(row),
            ],
        },
        machine_group: {
            label: "Machine Group",
            empty: "No machine-group rows match the current filters.",
            title: "Grouped Consumption by Machine Group",
            subtitle: "Aggregated spare-part spend by the machine group resolved from asset and WO context.",
            headers: ["Machine Group", "Total Value", "Total Qty", "Lines", "Unique Parts", "Top Asset", "Top Asset Family", "Top Part", "Match Quality"],
            cells: (row) => [
                row.machine_group || row.label || "--",
                ptFmtCurrency(row.total_consumption),
                formatPtQty(row.total_qty),
                formatPtCount(row.line_count),
                formatPtCount(row.unique_parts_count),
                row.top_consuming_asset || row.top_asset || "--",
                row.top_asset_family || "--",
                row.top_part || "--",
                ptConsumptionMatchCell(row),
            ],
        },
        general_area: {
            label: "General Area",
            empty: "No general-area rows match the current filters.",
            title: "General Area and Uncategorised Usage",
            subtitle: "Rows coded to broad areas remain visible here even when related assets are inferred elsewhere.",
            headers: ["General Area", "Total Value", "Total Qty", "Lines", "Unique Parts", "Top Related Asset", "Coding Mismatches", "Match Quality"],
            cells: (row) => [
                row.general_area || row.label || "--",
                ptFmtCurrency(row.total_consumption),
                formatPtQty(row.total_qty),
                formatPtCount(row.line_count),
                formatPtCount(row.unique_parts_count),
                row.top_related_asset || row.top_consuming_asset || "--",
                formatPtCount(row.coding_mismatch_count),
                ptConsumptionMatchCell(row),
            ],
        },
        part: {
            label: "Part Relationship",
            empty: "No part-relationship rows match the current filters.",
            title: "Part-to-Asset Relationship",
            subtitle: "Parts rolled up with the assets, families, and machine groups consuming them.",
            headers: ["Part Code", "Part Name", "Assets", "Families", "Machine Groups", "Total Value", "Total Qty", "Lines", "Top Asset", "Match Quality"],
            cells: (row) => [
                row.part_code || "--",
                row.part_name || row.label || "--",
                formatPtCount(row.asset_count),
                formatPtCount(row.asset_family_count),
                formatPtCount(row.machine_group_count),
                ptFmtCurrency(row.total_consumption),
                formatPtQty(row.total_qty),
                formatPtCount(row.line_count),
                row.top_consuming_asset || row.top_asset || "--",
                ptConsumptionMatchCell(row),
            ],
        },
    };

    // Called from loadAllYearsTransactions — no by-asset setup is needed there
    function populatePtTableFilters(_payload) { /* handled inside renderPtTables */ }

    function _populateTxnFilters(txns) {
        const cats = [...new Set(txns.map((r) => r.item_category).filter(Boolean))].sort();
        const assets = [...new Set(txns.map((r) => r.asset_id).filter(Boolean))].sort();
        _populateSelect("pt-txn-cat", cats, "All Categories");
        _populateSelect("pt-txn-asset", assets, "All Assets");
        _populateSelect("pt-parts-cat", cats, "All Categories");
        _bindTblFilter("pt-txn-search", (v) => { ptTxnFilter.search = v; renderTxnTable(); });
        _bindTblFilter("pt-txn-cat", (v) => { ptTxnFilter.category = v; renderTxnTable(); });
        _bindTblFilter("pt-txn-asset", (v) => { ptTxnFilter.asset = v; renderTxnTable(); });
        _bindTblFilter("pt-parts-search", (v) => { ptPartsFilter.search = v; renderAllPtPartsTable(); });
        _bindTblFilter("pt-parts-cat", (v) => { ptPartsFilter.category = v; renderAllPtPartsTable(); });
    }

    function _populateSelect(id, values, placeholder) {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` +
            values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    }

    function _bindTblFilter(id, fn) {
        const el = document.getElementById(id);
        if (!el || el._tblFilterBound) return;
        el._tblFilterBound = true;
        el.addEventListener(el.tagName === "SELECT" ? "change" : "input", (e) => fn(e.target.value));
    }

    function bindPtInsightTabs() {
        document.querySelectorAll("[data-ptinsighttab]").forEach((btn) => {
            if (btn._ptInsightBound) return;
            btn._ptInsightBound = true;
            btn.addEventListener("click", () => setPtInsightTab(btn.dataset.ptinsighttab || "part_usage"));
            btn.addEventListener("keydown", (event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const tabs = [...document.querySelectorAll("[data-ptinsighttab]")];
                const currentIndex = tabs.indexOf(btn);
                if (currentIndex < 0) return;
                const delta = event.key === "ArrowRight" ? 1 : -1;
                const nextBtn = tabs[(currentIndex + delta + tabs.length) % tabs.length];
                nextBtn?.focus();
                if (nextBtn?.dataset.ptinsighttab) setPtInsightTab(nextBtn.dataset.ptinsighttab);
            });
        });
        setPtInsightTab(ptInsightActiveTab);
    }

    function setPtInsightTab(tab) {
        const nextTab = document.getElementById(`pt-insight-panel-${tab}`) ? tab : "part_usage";
        ptInsightActiveTab = nextTab;
        document.querySelectorAll("[data-ptinsighttab]").forEach((btn) => {
            const isActive = (btn.dataset.ptinsighttab || "") === nextTab;
            btn.classList.toggle("active", isActive);
            btn.setAttribute("aria-selected", isActive ? "true" : "false");
            btn.tabIndex = isActive ? 0 : -1;
        });
        document.querySelectorAll(".pt-insight-panel").forEach((panel) => {
            panel.hidden = panel.id !== `pt-insight-panel-${nextTab}`;
            panel.classList.toggle("is-active", !panel.hidden);
        });
    }

    function bindPtPartSelection() {
        const body = document.getElementById("pt-top-parts-body");
        if (body && !body._ptPartSelectionBound) {
            body._ptPartSelectionBound = true;
            body.addEventListener("click", (event) => {
                const target = event.target instanceof Element ? event.target : event.target?.parentElement;
                const row = target?.closest("tr[data-part-key]");
                if (!row || !body.contains(row)) return;
                ptSelectedPartKey = row.dataset.partKey || "";
                ptSelectedPartLabel = row.dataset.partLabel || "";
                renderAllPtPartsTable();
            });
        }

        const clearBtn = document.getElementById("pt-clear-selected-part");
        if (clearBtn && !clearBtn._ptPartClearBound) {
            clearBtn._ptPartClearBound = true;
            clearBtn.addEventListener("click", () => {
                ptSelectedPartKey = "";
                ptSelectedPartLabel = "";
                renderAllPtPartsTable();
            });
        }
    }

    function formatPtCount(value) {
        return value === null || value === undefined || Number.isNaN(Number(value)) ? "--" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    function formatPtQty(value) {
        return value === null || value === undefined || Number.isNaN(Number(value)) ? "--" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    function ptTransactionCells(r) {
        return [
            formatShortDate(r.project_date),
            r.work_order_id || "--",
            r.asset_id || "--",
            getPtPartDisplayDescription(r),
            spareStatusBadge(r.item_category),
            r.quantity_used !== null && r.quantity_used !== undefined ? Number(r.quantity_used).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "--",
            ptFmtCurrencyOrNA(r.total_consumption),
            ptFmtCurrencyOrNA(r.unit_cost_estimate),
            r.equipment_name || "--",
        ];
    }

    function renderSelectedPtPartTransactions() {
        const title = document.getElementById("pt-selected-part-title");
        const subtitle = document.getElementById("pt-selected-part-subtitle");
        const clearBtn = document.getElementById("pt-clear-selected-part");
        if (!ptSelectedPartKey) {
            if (title) title.textContent = "Selected Part Transactions";
            if (subtitle) subtitle.textContent = "Select a spare part above to view its related transaction lines.";
            if (clearBtn) clearBtn.classList.add("hidden");
            renderSpareTable("pt-selected-part-transactions-body", [], 9, ptTransactionCells, "Select a spare part above to view related transactions.");
            return;
        }

        const rows = getPtTransactionsForPartsYear()
            .filter((r) => {
                const sourceKey = normalizePtPartKey(getPtPartSourceDescription(r));
                const displayKey = normalizePtPartKey(getPtPartDisplayDescription(r));
                return sourceKey === ptSelectedPartKey || displayKey === ptSelectedPartKey;
            })
            .sort((a, b) => String(b.project_date || "").localeCompare(String(a.project_date || "")));
        const year = getPtPartYearSelection();
        const yearLabel = year === "all" ? "all FY" : `FY${year}`;
        const label = ptSelectedPartLabel || getPtPartDisplayDescription(rows[0]) || "Selected spare part";
        if (title) title.textContent = label;
        if (subtitle) {
            subtitle.textContent = rows.length
                ? `${rows.length.toLocaleString()} related transaction line${rows.length === 1 ? "" : "s"} shown for ${yearLabel}.`
                : `No related transaction lines found for ${yearLabel}.`;
        }
        if (clearBtn) clearBtn.classList.remove("hidden");
        renderSpareTable("pt-selected-part-transactions-body", rows, 9, ptTransactionCells, "No related transaction lines found.");
    }

    function renderTxnTable() {
        const s = ptTxnFilter.search.toLowerCase();
        let rows = _ptTxnsCache;
        if (s) rows = rows.filter((r) =>
            (r.translated_description || r.clean_description || r.original_description || "").toLowerCase().includes(s) ||
            (r.asset_id || "").toLowerCase().includes(s) ||
            (r.work_order_id || "").toLowerCase().includes(s)
        );
        if (ptTxnFilter.category) rows = rows.filter((r) => r.item_category === ptTxnFilter.category);
        if (ptTxnFilter.asset) rows = rows.filter((r) => r.asset_id === ptTxnFilter.asset);
        renderSpareTable("pt-transactions-body", rows.slice(0, 300), 9, ptTransactionCells, "No transactions match the current filters.");
    }

    function getPtConsumptionAnalysis(payload) {
        return payload?.consumption_analysis || { groups: {}, records: [], filters: {} };
    }

    function getPtConsumptionRows(payload, view = ptConsumptionState.view) {
        const analysis = getPtConsumptionAnalysis(payload);
        return analysis?.groups?.[view] || [];
    }

    function getPtConsumptionVisibleRows(payload, options = {}) {
        const { ignoreFocus = false } = options;
        let rows = getPtConsumptionRows(payload, ptConsumptionState.view);
        if (ptConsumptionState.view === "asset" && ptConsumptionState.criticality) {
            rows = rows.filter((row) => (row.equipment_criticality || row.criticality || "") === ptConsumptionState.criticality);
        }
        if (!ignoreFocus && ptConsumptionState.focus) {
            rows = rows.filter((row) => row.group_key === ptConsumptionState.focus);
        }
        if (ptConsumptionState.search) {
            const term = ptConsumptionState.search;
            rows = rows.filter((row) => String(row.search_text || row.label || "").toLowerCase().includes(term));
        }
        return rows;
    }

    function getPtConsumptionSelectedRow(payload, visibleRows) {
        if (!ptConsumptionSelection.key || ptConsumptionSelection.view !== ptConsumptionState.view) return null;
        return (visibleRows || []).find((row) => row.group_key === ptConsumptionSelection.key) || null;
    }

    function getPtConsumptionScopedRecords(payload, visibleRows) {
        const analysis = getPtConsumptionAnalysis(payload);
        const records = analysis.records || [];
        const selectedRow = getPtConsumptionSelectedRow(payload, visibleRows);
        const keys = selectedRow
            ? new Set([selectedRow.group_key])
            : new Set((visibleRows || []).map((row) => row.group_key));
        if (!keys.size) return [];
        return records.filter((row) => keys.has((row.consumption_keys || {})[ptConsumptionState.view]));
    }

    function ptConsumptionMatchCell(row) {
        const summary = `${formatPtCount(row.direct_match_count)} direct / ${formatPtCount(row.related_match_count)} related`;
        return {
            html: `${spareStatusBadge(row.match_quality || "Low")}<span class="table-subtext">${escapeHtml(summary)}</span>`,
        };
    }

    function ptConsumptionAggregateTop(records, keyFn, labelFn) {
        const totals = new Map();
        records.forEach((row) => {
            const key = keyFn(row);
            const label = labelFn(row);
            if (!key || !label) return;
            const entry = totals.get(key) || { label, value: 0 };
            entry.value += Number(row.total_consumption || 0);
            totals.set(key, entry);
        });
        return [...totals.values()].sort((a, b) => b.value - a.value);
    }

    function renderPtConsumptionSummary(payload, visibleRows) {
        const scopedRecords = getPtConsumptionScopedRecords(payload, visibleRows);
        const selectedRow = getPtConsumptionSelectedRow(payload, visibleRows);
        if (!visibleRows.length || !scopedRecords.length) {
            [
                "pt-cons-kpi-total-value",
                "pt-cons-kpi-total-qty",
                "pt-cons-kpi-lines",
                "pt-cons-kpi-four-value",
                "pt-cons-kpi-five-value",
                "pt-cons-kpi-six-value",
            ].forEach((id) => setText(id, "--"));
            setText("pt-cons-kpi-four-label", "Unique Parts");
            setText("pt-cons-kpi-five-label", "Top Part");
            setText("pt-cons-kpi-six-label", "Match Notes");
            setText("pt-consumption-selection-note", visibleRows.length ? "No detailed records match the current selection." : "No grouped rows match the current filters.");
            return;
        }

        const totalValue = scopedRecords.reduce((sum, row) => sum + (row.total_consumption || 0), 0);
        const totalQty = scopedRecords.reduce((sum, row) => sum + (row.quantity_used || 0), 0);
        const uniqueParts = new Set(scopedRecords.map((row) => row.part_code || row.part_name).filter(Boolean)).size;
        const uniqueAssets = new Set(scopedRecords.map((row) => row.resolved_asset_id || row.asset_id).filter(Boolean)).size;
        const uniqueFamilies = new Set(scopedRecords.map((row) => row.asset_family_id || row.asset_family).filter(Boolean)).size;
        const topPart = (ptConsumptionAggregateTop(scopedRecords, (row) => row.part_code || row.part_name, (row) => row.part_name || row.part_code)[0] || {}).label || "--";
        const topAsset = (ptConsumptionAggregateTop(scopedRecords, (row) => row.resolved_asset_id || row.asset_id, (row) => row.resolved_asset_name || row.equipment_name || row.asset_id)[0] || {}).label || "--";
        const topFamily = (ptConsumptionAggregateTop(scopedRecords, (row) => row.asset_family_id || row.asset_family, (row) => row.asset_family)[0] || {}).label || "--";
        const direct = scopedRecords.filter((row) => row.is_direct_match).length;
        const related = scopedRecords.filter((row) => row.is_related_match).length;
        const mismatches = scopedRecords.filter((row) => row.possible_asset_coding_mismatch).length;
        const generalAreas = scopedRecords.filter((row) => row.general_area).length;

        setText("pt-cons-kpi-total-value", ptFmtCurrency(totalValue));
        setText("pt-cons-kpi-total-qty", formatPtQty(totalQty));
        setText("pt-cons-kpi-lines", formatPtCount(scopedRecords.length));

        let cardFourLabel = "Unique Parts";
        let cardFourValue = formatPtCount(uniqueParts);
        let cardFiveLabel = "Top Part";
        let cardFiveValue = topPart;
        let cardSixLabel = "Match Notes";
        let cardSixValue = `${formatPtCount(direct)} / ${formatPtCount(related)}`;

        if (ptConsumptionState.view === "asset_family") {
            cardFourLabel = "Assets Included";
            cardFourValue = formatPtCount(uniqueAssets);
            cardFiveLabel = "Top Asset";
            cardFiveValue = topAsset;
            cardSixLabel = "Area Matches";
            cardSixValue = formatPtCount(generalAreas);
        } else if (ptConsumptionState.view === "machine_group") {
            cardFourLabel = "Asset Families";
            cardFourValue = formatPtCount(uniqueFamilies);
            cardFiveLabel = "Top Asset";
            cardFiveValue = topAsset;
            cardSixLabel = "Top Family";
            cardSixValue = topFamily;
        } else if (ptConsumptionState.view === "general_area") {
            cardFourLabel = "Unique Parts";
            cardFourValue = formatPtCount(uniqueParts);
            cardFiveLabel = "Top Related Asset";
            cardFiveValue = topAsset;
            cardSixLabel = "Coding Mismatches";
            cardSixValue = formatPtCount(mismatches);
        } else if (ptConsumptionState.view === "part") {
            cardFourLabel = "Assets Used By";
            cardFourValue = formatPtCount(uniqueAssets);
            cardFiveLabel = "Asset Families";
            cardFiveValue = formatPtCount(uniqueFamilies);
            cardSixLabel = "Top Asset";
            cardSixValue = topAsset;
        }

        setText("pt-cons-kpi-four-label", cardFourLabel);
        setText("pt-cons-kpi-four-value", cardFourValue);
        setText("pt-cons-kpi-five-label", cardFiveLabel);
        setText("pt-cons-kpi-five-value", cardFiveValue);
        setText("pt-cons-kpi-six-label", cardSixLabel);
        setText("pt-cons-kpi-six-value", cardSixValue);

        const scopeLabel = selectedRow
            ? `${selectedRow.label}: ${scopedRecords.length.toLocaleString()} consumption line${scopedRecords.length === 1 ? "" : "s"}, ${formatPtCount(mismatches)} coding mismatch${mismatches === 1 ? "" : "es"}, and ${formatPtCount(generalAreas)} general-area source line${generalAreas === 1 ? "" : "s"}.`
            : `${visibleRows.length.toLocaleString()} ${PT_CONSUMPTION_VIEW_META[ptConsumptionState.view].label.toLowerCase()} row${visibleRows.length === 1 ? "" : "s"} match the current filters.`;
        setText("pt-consumption-selection-note", scopeLabel);
    }

    function renderPtConsumptionCharts(payload, visibleRows) {
        const scopedRecords = getPtConsumptionScopedRecords(payload, visibleRows);
        const view = ptConsumptionState.view;

        setText("pt-cons-chart-top-parts-title", view === "part" ? "Top Assets" : "Top Parts");
        setText("pt-cons-chart-top-parts-subtitle", view === "part" ? "Assets most associated with the selected part scope." : "Highest-value parts in the current selection.");
        setText("pt-cons-chart-trend-title", "Monthly Trend");
        setText("pt-cons-chart-trend-subtitle", "Monthly spare-part usage for the current selection.");
        setText("pt-cons-chart-entities-title", view === "machine_group" || view === "asset_family" || view === "part" ? "Top Assets" : "Top Related Contributors");
        setText("pt-cons-chart-split-title", view === "machine_group" ? "Family Split" : "Machine Group Split");
        setText("pt-cons-chart-split-subtitle", view === "machine_group" ? "Value split by asset family." : "Value split by machine group.");

        if (!scopedRecords.length) {
            ["pt-consumption-chart-top-parts", "pt-consumption-chart-trend", "pt-consumption-chart-entities", "pt-consumption-chart-split"].forEach((id) => {
                renderSpareChartEmpty(id, "No data for the current selection.");
            });
            return;
        }

        const topPartRows = view === "part"
            ? ptConsumptionAggregateTop(scopedRecords, (row) => row.resolved_asset_id || row.asset_id, (row) => row.resolved_asset_name || row.equipment_name || row.asset_id)
            : ptConsumptionAggregateTop(scopedRecords, (row) => row.part_code || row.part_name, (row) => row.part_name || row.part_code);
        renderSpareHorizontalBarChart(
            "pt-consumption-chart-top-parts",
            topPartRows.slice(0, 10).map((row) => ({ label: row.label, value: Number(ptConvert(row.value).toFixed(state.ptCurrency === "SGD" ? 2 : 0)) })),
            state.ptCurrency,
            view === "part" ? "#0f766e" : "#2563eb"
        );

        const monthly = new Map();
        scopedRecords.forEach((row) => {
            const month = String(row.project_date || "").slice(0, 7);
            if (!month) return;
            monthly.set(month, (monthly.get(month) || 0) + Number(row.total_consumption || 0));
        });
        const monthlyRows = [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b));
        if (!monthlyRows.length) {
            renderSpareChartEmpty("pt-consumption-chart-trend", "No dated records for the current selection.");
        } else {
            showSpareChartCanvas("pt-consumption-chart-trend");
            createChart("pt-consumption-chart-trend", {
                type: "line",
                data: {
                    labels: monthlyRows.map(([month]) => month),
                    datasets: [{
                        label: state.ptCurrency,
                        data: monthlyRows.map(([, value]) => Number(ptConvert(value).toFixed(state.ptCurrency === "SGD" ? 2 : 0))),
                        borderColor: "#0f766e",
                        backgroundColor: "rgba(15,118,110,0.12)",
                        fill: true,
                        tension: 0.25,
                        pointRadius: 4,
                    }],
                },
                options: spareChartOptions(state.ptCurrency),
                _scroll: { axis: "x", count: monthlyRows.length },
            });
        }

        const entityRows = ptConsumptionAggregateTop(
            scopedRecords,
            (row) => {
                if (view === "general_area") return row.resolved_asset_id || row.asset_id;
                if (view === "asset") return row.asset_family_id || row.asset_family;
                return row.resolved_asset_id || row.asset_id;
            },
            (row) => {
                if (view === "general_area") return row.resolved_asset_name || row.equipment_name || row.asset_id;
                if (view === "asset") return row.asset_family || "Unresolved Family";
                return row.resolved_asset_name || row.equipment_name || row.asset_id;
            }
        );
        if (!entityRows.length) {
            renderSpareChartEmpty("pt-consumption-chart-entities", "No related contributors for the current selection.");
        } else {
            renderSpareHorizontalBarChart(
                "pt-consumption-chart-entities",
                entityRows.slice(0, 10).map((row) => ({ label: row.label, value: Number(ptConvert(row.value).toFixed(state.ptCurrency === "SGD" ? 2 : 0)) })),
                state.ptCurrency,
                "#8b5cf6"
            );
        }

        const splitRows = ptConsumptionAggregateTop(
            scopedRecords,
            (row) => view === "machine_group" ? (row.asset_family_id || row.asset_family) : (row.machine_group || ""),
            (row) => view === "machine_group" ? (row.asset_family || "Unresolved Family") : (row.machine_group || "Unclassified")
        );
        if (!splitRows.length) {
            renderSpareChartEmpty("pt-consumption-chart-split", "No split data for the current selection.");
        } else {
            renderSparePieChart(
                "pt-consumption-chart-split",
                splitRows.slice(0, 8).map((row) => ({ label: row.label, value: Number(ptConvert(row.value).toFixed(state.ptCurrency === "SGD" ? 2 : 0)) })),
                "No split data for the current selection."
            );
        }
    }

    function renderPtConsumptionTable(payload, visibleRows) {
        const meta = PT_CONSUMPTION_VIEW_META[ptConsumptionState.view] || PT_CONSUMPTION_VIEW_META.asset;
        const thead = document.getElementById("pt-consumption-head");
        if (thead) {
            thead.innerHTML = `<tr>${meta.headers.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}</tr>`;
        }
        setText("pt-consumption-table-title", meta.title);
        setText("pt-consumption-table-subtitle", meta.subtitle);
        renderSpareTable(
            "pt-consumption-body",
            visibleRows.slice(0, 150),
            meta.headers.length,
            meta.cells,
            meta.empty,
            (row) => {
                const isSelected = ptConsumptionSelection.view === ptConsumptionState.view && ptConsumptionSelection.key === row.group_key;
                return {
                    className: `pt-consumption-row${isSelected ? " is-selected" : ""}`,
                    data: {
                        "group-key": row.group_key,
                        "view-mode": ptConsumptionState.view,
                    },
                };
            }
        );
    }

    function renderPtConsumptionDrilldown(payload, visibleRows) {
        const selectedRow = getPtConsumptionSelectedRow(payload, visibleRows);
        const records = getPtConsumptionScopedRecords(payload, visibleRows);
        const clearBtn = document.getElementById("pt-consumption-clear-drilldown");
        if (!selectedRow) {
            if (clearBtn) clearBtn.classList.add("hidden");
            setText("pt-consumption-drilldown-title", "Usage Drilldown");
            setText("pt-consumption-drilldown-subtitle", "Select a grouped row above to inspect individual consumption lines.");
            renderSpareTable("pt-consumption-drilldown-body", [], 12, () => [], "Select a grouped row above to inspect detailed usage lines.");
            return;
        }
        if (clearBtn) clearBtn.classList.remove("hidden");
        setText("pt-consumption-drilldown-title", selectedRow.label || "Usage Drilldown");
        setText("pt-consumption-drilldown-subtitle", `${records.length.toLocaleString()} detailed line${records.length === 1 ? "" : "s"} for the selected ${PT_CONSUMPTION_VIEW_META[ptConsumptionState.view].label.toLowerCase()}.`);
        renderSpareTable("pt-consumption-drilldown-body", records.slice(0, 250), 12, (row) => [
            formatShortDate(row.project_date),
            row.resolved_asset_id || row.asset_id || "--",
            row.resolved_asset_name || row.equipment_name || "--",
            row.asset_family || "--",
            row.machine_group || "--",
            row.part_code || "--",
            row.part_name || "--",
            formatPtQty(row.quantity_used),
            ptFmtCurrencyOrNA(row.total_consumption),
            row.mr_wo_reference || "--",
            {
                html: `${spareStatusBadge(row.match_confidence || "Low")}<span class="table-subtext">${escapeHtml(row.match_source || "--")}</span>`,
            },
            (row.data_quality_flags || []).join("; ") || "Valid",
        ], "No detailed usage lines for the selected row.");
    }

    function syncPtConsumptionFocusOptions(payload) {
        const sel = document.getElementById("pt-consumption-focus");
        if (!sel) return;
        const rows = getPtConsumptionRows(payload, ptConsumptionState.view);
        const current = rows.some((row) => row.group_key === ptConsumptionState.focus) ? ptConsumptionState.focus : "";
        sel.innerHTML = `<option value="">All Rows</option>` + rows.slice(0, 200).map((row) => (
            `<option value="${escapeHtml(row.group_key)}">${escapeHtml(row.label || row.asset_family || row.machine_group || row.part_name || row.general_area || row.asset_id || row.group_key)}</option>`
        )).join("");
        sel.value = current;
        ptConsumptionState.focus = current;
    }

    function syncPtConsumptionCriticalities(payload) {
        const sel = document.getElementById("pt-asset-crit");
        if (!sel) return;
        const criticalities = [...new Set((payload?.by_asset || []).map((row) => row.equipment_criticality).filter(Boolean))].sort();
        _populateSelect("pt-asset-crit", criticalities, "All Criticality");
        sel.value = criticalities.includes(ptConsumptionState.criticality) ? ptConsumptionState.criticality : "";
        ptConsumptionState.criticality = sel.value || "";
        sel.disabled = ptConsumptionState.view !== "asset";
    }

    function bindPtConsumptionSelection() {
        const body = document.getElementById("pt-consumption-body");
        if (body && !body._ptConsumptionBound) {
            body._ptConsumptionBound = true;
            body.addEventListener("click", (event) => {
                const target = event.target instanceof Element ? event.target : event.target?.parentElement;
                const row = target?.closest("tr[data-group-key]");
                if (!row || !body.contains(row)) return;
                const nextKey = row.dataset.groupKey || "";
                const isSame = ptConsumptionSelection.view === ptConsumptionState.view && ptConsumptionSelection.key === nextKey;
                ptConsumptionSelection.view = ptConsumptionState.view;
                ptConsumptionSelection.key = isSame ? "" : nextKey;
                ptConsumptionState.focus = ptConsumptionSelection.key;
                const focusSel = document.getElementById("pt-consumption-focus");
                if (focusSel) focusSel.value = ptConsumptionState.focus;
                renderPtConsumptionPanel(state.ptData || {});
            });
        }

        ["pt-consumption-clear-selection", "pt-consumption-clear-drilldown"].forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn || btn._ptConsumptionClearBound) return;
            btn._ptConsumptionClearBound = true;
            btn.addEventListener("click", () => {
                ptConsumptionSelection.view = ptConsumptionState.view;
                ptConsumptionSelection.key = "";
                ptConsumptionState.focus = "";
                const focusSel = document.getElementById("pt-consumption-focus");
                if (focusSel) focusSel.value = "";
                renderPtConsumptionPanel(state.ptData || {});
            });
        });
    }

    function bindPtConsumptionControls() {
        _bindTblFilter("pt-consumption-view", (value) => {
            ptConsumptionState.view = value || "asset";
            ptConsumptionState.focus = "";
            ptConsumptionState.criticality = ptConsumptionState.view === "asset" ? ptConsumptionState.criticality : "";
            ptConsumptionSelection.view = ptConsumptionState.view;
            ptConsumptionSelection.key = "";
            renderPtConsumptionPanel(state.ptData || {});
        });
        _bindTblFilter("pt-consumption-focus", (value) => {
            ptConsumptionState.focus = value || "";
            ptConsumptionSelection.view = ptConsumptionState.view;
            ptConsumptionSelection.key = value || "";
            renderPtConsumptionPanel(state.ptData || {});
        });
        _bindTblFilter("pt-asset-search", (value) => {
            ptConsumptionState.search = String(value || "").trim().toLowerCase();
            renderPtConsumptionPanel(state.ptData || {});
        });
        _bindTblFilter("pt-asset-crit", (value) => {
            ptConsumptionState.criticality = value || "";
            renderPtConsumptionPanel(state.ptData || {});
        });
    }

    function renderPtConsumptionPanel(payload) {
        const viewSel = document.getElementById("pt-consumption-view");
        if (viewSel) viewSel.value = ptConsumptionState.view;
        const searchInput = document.getElementById("pt-asset-search");
        if (searchInput) {
            searchInput.placeholder = "Search asset, family, machine group, part, remarks...";
            searchInput.setAttribute("aria-label", "Search smart spare-part consumption");
        }
        bindPtConsumptionControls();
        bindPtConsumptionSelection();
        syncPtConsumptionFocusOptions(payload);
        syncPtConsumptionCriticalities(payload);
        const visibleRows = getPtConsumptionVisibleRows(payload);
        const clearBtn = document.getElementById("pt-consumption-clear-selection");
        if (clearBtn) clearBtn.classList.toggle("hidden", !(ptConsumptionSelection.key && ptConsumptionSelection.view === ptConsumptionState.view));
        renderPtConsumptionSummary(payload, visibleRows);
        renderPtConsumptionCharts(payload, visibleRows);
        renderPtConsumptionTable(payload, visibleRows);
        renderPtConsumptionDrilldown(payload, visibleRows);
    }

    function renderPtTables(txns, payload) {
        _ptTxnsCache = txns;
        _populateTxnFilters(txns);
        renderTxnTable();

        renderAllPtPartsTable();

        _ptByAssetCache = payload?.by_asset || [];
        renderPtConsumptionPanel(payload);

        renderSpareTable("pt-manual-review-body", (payload?.manual_review || []).slice(0, 200), 7, (r) => [
            formatShortDate(r.project_date),
            r.work_order_id || "--",
            r.asset_id || "--",
            r.translated_description || r.original_description || "--",
            spareStatusBadge(r.item_category),
            r.match_confidence || r.classification_confidence || "--",
            (r.data_quality_flags || []).join("; ") || r.parse_status || "--",
        ], "No manual review items.");

        if (ayData?.transactions?.length) {
            renderPartAssetTable(_buildPauDataFromTxns(ayData.transactions));
        } else {
            renderPartAssetTable(payload?.by_part_asset || []);
        }
    }

    // ─── Part Usage by Asset ──────────────────────────────────────────────────

    let _pauData = [];
    const _pauFilter = { search: "", cat: "" };
    let _pauSort = "wo_count";

    function _buildPauDataFromTxns(txns) {
        // Build name lookup: asset_id → best known name, from all available sources
        const nameMap = {};
        for (const a of (state.ptData?.by_asset || [])) {
            if (a.asset_id && a.equipment_name && a.equipment_name !== a.asset_id)
                nameMap[a.asset_id] = a.equipment_name;
        }
        for (const r of (ayData?.transactions || [])) {
            if (r.asset_id && r.equipment_name && r.equipment_name !== r.asset_id && !nameMap[r.asset_id])
                nameMap[r.asset_id] = r.equipment_name;
        }
        for (const r of (txns || [])) {
            if (r.asset_id && r.equipment_name && r.equipment_name !== r.asset_id && !nameMap[r.asset_id])
                nameMap[r.asset_id] = r.equipment_name;
        }

        const byDesc = {};
        for (const r of (txns || [])) {
            const desc = r.clean_description || r.original_description || r.description || "Unknown";
            const translated = r.translated_description || desc;
            const cat = r.item_category || r.category || "";
            const assetId = r.asset_id || "";
            const woId = r.work_order_id || "";
            const consumption = r.total_consumption || 0;
            const qty = r.quantity_used || 0;

            if (!byDesc[desc]) {
                byDesc[desc] = { description: desc, translated, category: cat,
                    total_consumption: 0, total_qty: 0, wo_ids: new Set(), asset_ids: new Set(), assets: {} };
            }
            const p = byDesc[desc];
            p.total_consumption += consumption;
            p.total_qty += qty;
            if (woId) p.wo_ids.add(woId);
            if (assetId) p.asset_ids.add(assetId);

            if (!p.assets[assetId]) {
                p.assets[assetId] = { asset_id: assetId, total_consumption: 0, total_qty: 0, wo_ids: new Set() };
            }
            p.assets[assetId].total_consumption += consumption;
            p.assets[assetId].total_qty += qty;
            if (woId) p.assets[assetId].wo_ids.add(woId);
        }

        return Object.values(byDesc).map((p) => {
            const assetBreakdown = Object.values(p.assets).map((a) => {
                const wos = [...a.wo_ids].filter(Boolean).sort();
                const name = nameMap[a.asset_id] || null;
                return { asset_id: a.asset_id,
                    equipment_name: name || a.asset_id || "Unknown",
                    has_name: !!name,
                    wo_count: wos.length, wo_ids: wos,
                    total_qty: Math.round(a.total_qty * 100) / 100,
                    total_consumption: Math.round(a.total_consumption * 100) / 100 };
            }).sort((a, b) => b.wo_count - a.wo_count);
            return { description: p.description, translated: p.translated, category: p.category,
                wo_count: p.wo_ids.size, asset_count: p.asset_ids.size,
                total_consumption: Math.round(p.total_consumption * 100) / 100,
                total_qty: Math.round(p.total_qty * 100) / 100,
                asset_breakdown: assetBreakdown };
        }).sort((a, b) => b.wo_count - a.wo_count);
    }

    function _pauGetSortedFiltered() {
        const s = _pauFilter.search.toLowerCase();
        let rows = _pauData;
        if (s) rows = rows.filter((r) =>
            (r.description || "").toLowerCase().includes(s) ||
            (r.translated || "").toLowerCase().includes(s)
        );
        if (_pauFilter.cat) rows = rows.filter((r) => r.category === _pauFilter.cat);
        return [...rows].sort((a, b) => (b[_pauSort] || 0) - (a[_pauSort] || 0));
    }

    function renderPartAssetTable(data) {
        _pauData = data || [];
        const cats = [...new Set(_pauData.map((r) => r.category).filter(Boolean))].sort();
        _populateSelect("pau-cat", cats, "All Categories");
        _bindTblFilter("pau-search", (v) => { _pauFilter.search = v; _renderPauRows(); });
        _bindTblFilter("pau-cat", (v) => { _pauFilter.cat = v; _renderPauRows(); });
        const sortEl = document.getElementById("pau-sort");
        if (sortEl && !sortEl._pauBound) {
            sortEl._pauBound = true;
            sortEl.addEventListener("change", (e) => { _pauSort = e.target.value; _renderPauRows(); });
        }
        _initPauModal();
        _renderPauRows();
    }

    function _renderPauRows() {
        const tbody = document.getElementById("pau-body");
        if (!tbody) return;
        const rows = _pauGetSortedFiltered();
        if (!rows.length) {
            const msg = _pauData.length === 0 ? "Awaiting data." : "No parts match the current filter.";
            tbody.innerHTML = `<tr><td colspan="8" class="empty-row">${msg}</td></tr>`;
            return;
        }
        tbody.innerHTML = rows.map((r, i) => `
            <tr class="pau-main-row" data-pau-idx="${i}" tabindex="0" title="Click to view asset breakdown">
                <td class="pau-td-rank">${i + 1}</td>
                <td class="pau-td-desc">
                    <span class="pau-desc-main">${escapeHtml(r.description || "--")}</span>
                    ${r.translated && r.translated !== r.description ? `<br><span class="pau-desc-thai">${escapeHtml(r.translated)}</span>` : ""}
                </td>
                <td>${spareStatusBadge(r.category)}</td>
                <td class="pau-td-num"><strong>${r.wo_count}</strong></td>
                <td class="pau-td-num">${r.asset_count}</td>
                <td class="pau-td-num">${ptFmtCurrency(r.total_consumption)}</td>
                <td class="pau-td-num">${r.total_qty != null ? Number(r.total_qty).toLocaleString(undefined, {maximumFractionDigits:1}) : "--"}</td>
                <td class="pau-td-expand"><span class="pau-view-hint">View ›</span></td>
            </tr>`).join("");

        tbody.querySelectorAll(".pau-main-row").forEach((row) => {
            row.addEventListener("click", () => {
                const idx = parseInt(row.dataset.pauIdx, 10);
                _openPauModal(rows[idx]);
            });
        });
    }

    // ── Modal ────────────────────────────────────────────────────────────────

    function _initPauModal() {
        const overlay = document.getElementById("pau-modal");
        if (!overlay || overlay._pauModalBound) return;
        overlay._pauModalBound = true;
        document.getElementById("pau-modal-close")?.addEventListener("click", _closePauModal);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) _closePauModal(); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") _closePauModal(); });
    }

    function _closePauModal() {
        const overlay = document.getElementById("pau-modal");
        if (overlay) overlay.hidden = true;
        document.body.style.overflow = "";
    }

    function _openPauModal(r) {
        const overlay = document.getElementById("pau-modal");
        if (!overlay) return;

        document.getElementById("pau-modal-title").textContent = r.description || "--";
        const translated = document.getElementById("pau-modal-translated");
        if (translated) {
            translated.textContent = (r.translated && r.translated !== r.description) ? r.translated : "";
            translated.style.display = translated.textContent ? "" : "none";
        }

        const stats = document.getElementById("pau-modal-stats");
        if (stats) stats.innerHTML = [
            `<span class="pau-stat-chip pau-stat-wo"><strong>${r.wo_count}</strong> Work Orders</span>`,
            `<span class="pau-stat-chip pau-stat-asset"><strong>${r.asset_count}</strong> Assets</span>`,
            `<span class="pau-stat-chip pau-stat-val"><strong>${ptFmtCurrency(r.total_consumption)}</strong> Total</span>`,
            `<span class="pau-stat-chip pau-stat-qty"><strong>${r.total_qty != null ? Number(r.total_qty).toLocaleString(undefined, {maximumFractionDigits:1}) : "--"}</strong> Qty</span>`,
            r.category ? `<span class="pau-stat-chip">${spareStatusBadge(r.category)}</span>` : "",
        ].join("");

        const tbody = document.getElementById("pau-modal-tbody");
        if (tbody) {
            const assets = r.asset_breakdown || [];
            if (!assets.length) {
                tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No asset breakdown available.</td></tr>`;
            } else {
                tbody.innerHTML = assets.map((ab, i) => `
                    <tr class="pau-modal-row">
                        <td class="pau-modal-rank">${i + 1}</td>
                        <td class="pau-modal-asset-cell">
                            <span class="pau-asset-name">${escapeHtml(ab.has_name ? ab.equipment_name : (ab.asset_id || "--"))}</span>
                            ${ab.has_name && ab.asset_id ? `<br><span class="pau-asset-id">${escapeHtml(ab.asset_id)}</span>` : ""}
                        </td>
                        <td class="pau-modal-num"><strong>${ab.wo_count}</strong></td>
                        <td class="pau-modal-num">${ptFmtCurrency(ab.total_consumption)}</td>
                        <td class="pau-modal-num">${ab.total_qty != null ? Number(ab.total_qty).toLocaleString(undefined, {maximumFractionDigits:1}) : "--"}</td>
                        <td class="pau-modal-wos">${ab.wo_ids.map((id) => `<span class="pau-wo-chip">${escapeHtml(id)}</span>`).join("")}</td>
                    </tr>`).join("");
            }
        }

        overlay.hidden = false;
        document.body.style.overflow = "hidden";
    }

    // ─── End Project Actual Transactions ─────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════════
    // External Purchase Orders (Gen PO in D365 Rev.01)
    // ═══════════════════════════════════════════════════════════════════════════

    let _epoData = null;
    const _epoFilter = {
        search: "", type: "", group: "", status: "", vendor: "",
        classification: "", delivery: "", dateFrom: "", dateTo: "",
    };
    const _epoSort = { key: "date_po", dir: "desc" };
    const _epoSupFilter = { search: "", tier: "" };
    let _epoSubtab = "parts";

    async function loadExternalPo() {
        let payload;
        try {
            payload = await fetchJson("/api/maintenance/external_po");
        } catch (e) {
            payload = { status: "error", error: String(e), records: [], summary: {}, data_quality: [], filters: {} };
        }
        _epoData = payload;
        renderEpoSection(payload);
    }

    function renderEpoSection(payload) {
        const badge = document.getElementById("epo-status-badge");
        if (badge) {
            const map = { ok: "Loaded", missing: "File not found", error: "Load error" };
            badge.textContent = map[payload.status] || payload.status;
            badge.style.background = payload.status === "ok" ? "" : "#fee2e2";
            badge.style.color = payload.status === "ok" ? "" : "#b91c1c";
        }
        renderEpoKpis(payload.summary || {});
        _epoPopulateFilters(payload.filters || {});
        _epoBindFilters();
        _epoBindTabs();
        renderEpoTable(_epoFilterRecords(payload.records || []));
        renderEpoDataQuality(payload.data_quality || [], payload.records || []);
        renderEpoSuppliers(payload.supplier_performance || []);
        renderEpoCharts(payload);
    }

    function epoFmt(v) {
        if (v == null || v === "") return "--";
        return spFmt(Number(v));
    }
    function epoNum(v, digits = 0) {
        if (v == null || v === "") return "--";
        return Number(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }

    function renderEpoKpis(summary) {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set("epo-kpi-pos", summary.unique_pos != null ? Number(summary.unique_pos).toLocaleString() : "--");
        set("epo-kpi-lines", summary.total_rows != null ? `${Number(summary.total_rows).toLocaleString()} lines` : "--");
        set("epo-kpi-ontime-rate", summary.on_time_rate != null ? `${summary.on_time_rate}%` : "--");
        set("epo-kpi-ontime-count", summary.evaluated_count != null
            ? `${(summary.on_time_count || 0).toLocaleString()} / ${summary.evaluated_count.toLocaleString()} delivered`
            : "--");
        set("epo-kpi-avg-delay", summary.avg_delay_days != null ? `${summary.avg_delay_days} d` : "--");
        set("epo-kpi-delayed-count", summary.delayed_count != null
            ? `${summary.delayed_count.toLocaleString()} delayed POs` : "--");
        set("epo-kpi-awaiting", summary.awaiting_delivery != null
            ? Number(summary.awaiting_delivery).toLocaleString() : "--");
        set("epo-kpi-spend", epoFmt(summary.total_spend));
        const topType = (summary.spend_by_type || [])[0];
        set("epo-kpi-spend-sub", topType ? `${topType.type}: ${epoFmt(topType.total)}` : "--");

        const dqBadge = document.getElementById("epo-dq-badge");
        if (dqBadge) {
            if (summary.total_flagged) {
                dqBadge.textContent = summary.total_flagged;
                dqBadge.style.display = "";
            } else {
                dqBadge.style.display = "none";
            }
        }
    }

    function _epoPopulateFilters(filters) {
        const sel = (id, opts, placeholder) => {
            const el = document.getElementById(id);
            if (!el || el._epoPopulated) return;
            el._epoPopulated = true;
            el.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` +
                (opts || []).map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
        };
        sel("epo-filter-type", filters.types_of_cost, "All Cost Types");
        sel("epo-filter-group", filters.groups_of_cost, "All Groups");
        sel("epo-filter-status", filters.statuses, "All Statuses");
        sel("epo-filter-vendor", filters.vendors, "All Vendors");
        sel("epo-filter-classification", filters.classifications, "All Classifications");
    }

    function _epoBindFilters() {
        const bind = (id, key, isDate) => {
            const el = document.getElementById(id);
            if (!el || el._epoBound) return;
            el._epoBound = true;
            el.addEventListener(isDate || el.tagName === "SELECT" ? "change" : "input", (e) => {
                _epoFilter[key] = e.target.value;
                if (_epoData) renderEpoTable(_epoFilterRecords(_epoData.records || []));
            });
        };
        bind("epo-search", "search");
        bind("epo-filter-type", "type");
        bind("epo-filter-group", "group");
        bind("epo-filter-status", "status");
        bind("epo-filter-vendor", "vendor");
        bind("epo-filter-classification", "classification");
        bind("epo-filter-delivery", "delivery");
        bind("epo-date-from", "dateFrom", true);
        bind("epo-date-to", "dateTo", true);

        // Sortable columns
        document.querySelectorAll("#epo-panel-log th[data-epo-sort]").forEach((th) => {
            if (th._epoSortBound) return;
            th._epoSortBound = true;
            th.addEventListener("click", () => {
                const k = th.dataset.epoSort;
                if (_epoSort.key === k) {
                    _epoSort.dir = _epoSort.dir === "asc" ? "desc" : "asc";
                } else {
                    _epoSort.key = k;
                    _epoSort.dir = "asc";
                }
                if (_epoData) renderEpoTable(_epoFilterRecords(_epoData.records || []));
            });
        });

        // Supplier-tab filters
        ["epo-sup-search", "epo-sup-tier"].forEach((id) => {
            const el = document.getElementById(id);
            if (!el || el._epoSupBound) return;
            el._epoSupBound = true;
            const key = id === "epo-sup-search" ? "search" : "tier";
            el.addEventListener(el.tagName === "SELECT" ? "change" : "input", (e) => {
                _epoSupFilter[key] = e.target.value;
                if (_epoData) renderEpoSuppliers(_epoData.supplier_performance || []);
            });
        });
    }

    function _epoBindTabs() {
        document.querySelectorAll(".epo-tab-btn").forEach((btn) => {
            if (btn._epoBound) return;
            btn._epoBound = true;
            btn.addEventListener("click", () => {
                document.querySelectorAll(".epo-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
                const tab = btn.dataset.epotab;
                const panels = ["overview", "suppliers", "log", "category", "spend", "quality"];
                panels.forEach((p) => {
                    const panel = document.getElementById(`epo-panel-${p}`);
                    if (panel) panel.style.display = tab === p ? "" : "none";
                });
                // Re-render charts on activation so canvases size correctly.
                if (_epoData) renderEpoCharts(_epoData);
            });
        });
        document.querySelectorAll(".epo-subtab-btn").forEach((btn) => {
            if (btn._epoSubBound) return;
            btn._epoSubBound = true;
            btn.addEventListener("click", () => {
                _epoSubtab = btn.dataset.eposubtab;
                document.querySelectorAll(".epo-subtab-btn").forEach((b) => b.classList.toggle("active", b === btn));
                document.getElementById("epo-subpanel-parts").style.display = _epoSubtab === "parts" ? "" : "none";
                document.getElementById("epo-subpanel-services").style.display = _epoSubtab === "services" ? "" : "none";
                if (_epoData) renderEpoCharts(_epoData);
            });
        });
    }

    function _epoFilterRecords(records) {
        let rows = records;
        const s = _epoFilter.search.toLowerCase();
        if (s) rows = rows.filter((r) =>
            (r.description || "").toLowerCase().includes(s) ||
            (r.pd_machine || "").toLowerCase().includes(s) ||
            (r.vendor || "").toLowerCase().includes(s) ||
            (r.po_no || "").toLowerCase().includes(s) ||
            (r.pr_no || "").toLowerCase().includes(s)
        );
        if (_epoFilter.type) rows = rows.filter((r) => r.type_of_cost === _epoFilter.type);
        if (_epoFilter.group) rows = rows.filter((r) => r.group_of_cost === _epoFilter.group);
        if (_epoFilter.status) rows = rows.filter((r) => r.status === _epoFilter.status);
        if (_epoFilter.vendor) rows = rows.filter((r) => r.vendor === _epoFilter.vendor);
        if (_epoFilter.classification) rows = rows.filter((r) => r.classification === _epoFilter.classification);
        if (_epoFilter.delivery) rows = rows.filter((r) => r.delivery_flag === _epoFilter.delivery);
        if (_epoFilter.dateFrom) rows = rows.filter((r) => r.date_po && r.date_po >= _epoFilter.dateFrom);
        if (_epoFilter.dateTo) rows = rows.filter((r) => !r.date_po || r.date_po <= _epoFilter.dateTo);

        // Sort
        const key = _epoSort.key;
        const dir = _epoSort.dir === "asc" ? 1 : -1;
        const sorted = [...rows].sort((a, b) => {
            const av = a[key], bv = b[key];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
            return String(av).localeCompare(String(bv)) * dir;
        });
        return sorted;
    }

    function _epoFlagBadges(r) {
        const parts = [];
        if (r.delivery_flag === "Ontime") parts.push(`<span class="epo-flag epo-flag-green" title="On-time">🟢</span>`);
        else if (r.delivery_flag === "Delayed") parts.push(`<span class="epo-flag epo-flag-red" title="Delayed">🔴</span>`);
        else if (r.delivery_flag === "Pending") parts.push(`<span class="epo-flag epo-flag-amber" title="Pending">🟡</span>`);
        if ((r.row_flags || []).includes("long_lead")) parts.push(`<span class="epo-flag epo-flag-orange" title="Long lead time (>60 days)">🟠</span>`);
        if ((r.row_flags || []).includes("high_value")) parts.push(`<span class="epo-flag epo-flag-warn" title="High value (>50,000 THB)">⚠️</span>`);
        if ((r.row_flags || []).includes("thai_desc")) parts.push(`<span class="epo-flag epo-flag-blue" title="Original description in Thai (auto-translated)">🌐</span>`);
        return parts.join(" ");
    }

    function renderEpoTable(rows) {
        const body = document.getElementById("epo-table-body");
        const countEl = document.getElementById("epo-row-count");
        if (!body) return;
        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="8" class="empty-row">No records match the current filters.</td></tr>`;
            if (countEl) countEl.textContent = "0 rows";
            return;
        }
        body.innerHTML = rows.slice(0, 500).map((r, index) => {
            const descCell = r.has_thai && r.description !== r.description_raw
                ? `${escapeHtml(r.description)}<span class="epo-desc-thai">${escapeHtml(r.description_raw)}</span>`
                : escapeHtml(r.description || "--");
            const rowCls = r.delivery_flag === "Delayed" ? "epo-row-delayed"
                : r.delivery_flag === "Pending" ? "epo-row-pending" : "";
            const detailId = `epo-detail-${index}`;
            return `<tr class="epo-main-row ${rowCls}" data-epo-detail-id="${detailId}" aria-expanded="false" tabindex="0">
                <td class="epo-col-po">
                    <div class="epo-po-cell">
                        <span class="epo-row-caret" aria-hidden="true">+</span>
                        <span class="epo-po-value">${escapeHtml(r.po_no || "--")}</span>
                    </div>
                </td>
                <td>${escapeHtml(r.date_po || "--")}</td>
                <td>${r.lead_time != null ? epoNum(r.lead_time) : "--"}</td>
                <td>${escapeHtml(r.date_grn || "--")}</td>
                <td>${r.actual_lead != null ? epoNum(r.actual_lead) : "--"}</td>
                <td>${r.delay_days != null ? epoNum(r.delay_days) : "--"}</td>
                <td>${r.total_price != null ? epoFmt(r.total_price) : "--"}</td>
                <td class="epo-flags-cell">${_epoFlagBadges(r)}</td>
            </tr>
            <tr class="epo-detail-row" id="${detailId}" hidden>
                <td colspan="8">
                    <div class="epo-detail-card">
                        <div class="epo-detail-meta">
                            <div class="epo-detail-chip">
                                <span>Vendor</span>
                                <strong>${escapeHtml(r.vendor || "--")}</strong>
                            </div>
                            <div class="epo-detail-chip">
                                <span>PR No.</span>
                                <strong>${escapeHtml(r.pr_no || "--")}</strong>
                            </div>
                            <div class="epo-detail-chip">
                                <span>Group</span>
                                <strong>${escapeHtml(r.group_of_cost || "--")}</strong>
                            </div>
                        </div>
                        <div class="epo-detail-copy">
                            <span>Description</span>
                            <div class="epo-detail-description">${descCell}</div>
                        </div>
                    </div>
                </td>
            </tr>`;
        }).join("");
        body.querySelectorAll(".epo-main-row").forEach((row) => {
            if (row._epoExpandBound) return;
            row._epoExpandBound = true;
            const toggle = () => {
                const detailId = row.dataset.epoDetailId;
                if (!detailId) return;
                const detailRow = document.getElementById(detailId);
                if (!detailRow) return;
                const nextState = detailRow.hidden;
                detailRow.hidden = !nextState;
                row.setAttribute("aria-expanded", nextState ? "true" : "false");
                row.classList.toggle("is-expanded", nextState);
            };
            row.addEventListener("click", toggle);
            row.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                toggle();
            });
        });
        if (countEl) countEl.textContent = `${rows.length.toLocaleString()} row${rows.length === 1 ? "" : "s"}${rows.length > 500 ? " (showing first 500)" : ""}`;
    }

    function _epoTierFromRate(rate) {
        if (rate == null) return { tier: "none", color: "#64748b", label: "No data" };
        if (rate >= 85) return { tier: "green", color: "#10b981", label: "Strong" };
        if (rate >= 70) return { tier: "amber", color: "#f59e0b", label: "Watch" };
        return { tier: "red", color: "#ef4444", label: "Action" };
    }

    function renderEpoSuppliers(suppliers) {
        const body = document.getElementById("epo-sup-body");
        if (!body) return;
        const search = _epoSupFilter.search.toLowerCase();
        const tier = _epoSupFilter.tier;
        const rows = suppliers.filter((s) => {
            if (search && !(s.vendor || "").toLowerCase().includes(search)) return false;
            if (tier) {
                const t = _epoTierFromRate(s.on_time_rate).tier;
                if (t !== tier) return false;
            }
            return true;
        });
        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="9" class="empty-row">No vendors match the filters.</td></tr>`;
            return;
        }
        body.innerHTML = rows.map((s) => {
            const t = _epoTierFromRate(s.on_time_rate);
            const rateStr = s.on_time_rate != null ? `${s.on_time_rate}%` : "—";
            return `<tr>
                <td>${escapeHtml(s.vendor || "--")}</td>
                <td>${epoNum(s.total_pos)}</td>
                <td>${epoNum(s.on_time)}</td>
                <td>${epoNum(s.delayed)}</td>
                <td>${epoNum(s.pending)}</td>
                <td>${epoNum(s.avg_delay, 1)}</td>
                <td style="color:${t.color};font-weight:600">${rateStr}</td>
                <td>${epoFmt(s.spend)}</td>
                <td><span class="epo-tier-badge epo-tier-${t.tier}">${t.label}</span></td>
            </tr>`;
        }).join("");
    }

    // ─── Chart rendering ──────────────────────────────────────────────────────
    const _epoChartTheme = {
        text: "#334155",
        grid: "rgba(148,163,184,0.25)",
        teal: "#14b8a6",
        green: "#10b981",
        red: "#ef4444",
        amber: "#f59e0b",
        blue: "#3b82f6",
        purple: "#a855f7",
        slate: "#64748b",
    };

    function _epoDestroy(id) {
        if (typeof charts !== "undefined" && charts[id]) {
            charts[id].destroy();
            delete charts[id];
        }
    }

    function _epoVisible(panelId) {
        const el = document.getElementById(panelId);
        return el && el.style.display !== "none";
    }

    function renderEpoCharts(payload) {
        if (typeof Chart === "undefined") return;
        const summary = payload.summary || {};
        const tickColor = _epoChartTheme.text;
        const gridColor = _epoChartTheme.grid;
        const legendCfg = { labels: { color: tickColor, font: { size: 11 } } };

        // Overview: delivery doughnut
        if (_epoVisible("epo-panel-overview")) {
            _epoDestroy("epo-chart-delivery");
            createChart("epo-chart-delivery", {
                type: "doughnut",
                data: {
                    labels: ["On-time", "Delayed", "Pending"],
                    datasets: [{
                        data: [summary.on_time_count || 0, summary.delayed_count || 0, summary.pending_count || 0],
                        backgroundColor: [_epoChartTheme.green, _epoChartTheme.red, _epoChartTheme.amber],
                        borderColor: "rgba(15,23,42,0.6)",
                    }],
                },
                options: { plugins: { legend: { position: "bottom", ...legendCfg } } },
            });

            // Cost type
            _epoDestroy("epo-chart-costtype");
            const types = (summary.spend_by_type || []);
            createChart("epo-chart-costtype", {
                type: "doughnut",
                data: {
                    labels: types.map((t) => t.type),
                    datasets: [{
                        data: types.map((t) => t.total),
                        backgroundColor: [_epoChartTheme.teal, _epoChartTheme.purple, _epoChartTheme.amber, _epoChartTheme.slate],
                    }],
                },
                options: { plugins: { legend: { position: "bottom", ...legendCfg } } },
            });

            // Classification split (by line count)
            _epoDestroy("epo-chart-classification");
            const cats = payload.category_summary || [];
            createChart("epo-chart-classification", {
                type: "doughnut",
                data: {
                    labels: cats.map((c) => c.classification),
                    datasets: [{
                        data: cats.map((c) => c.count),
                        backgroundColor: [_epoChartTheme.blue, _epoChartTheme.teal, _epoChartTheme.amber, _epoChartTheme.slate],
                    }],
                },
                options: { plugins: { legend: { position: "bottom", ...legendCfg } } },
            });
        }

        // Category: Parts (Stock vs Non-Stock)
        if (_epoVisible("epo-panel-category")) {
            const cats = payload.category_summary || [];
            const partCats = cats.filter((c) => c.classification === "Stock" || c.classification === "Non-Stock");
            const partsBody = document.getElementById("epo-parts-cat-body");
            if (partsBody) {
                partsBody.innerHTML = partCats.length
                    ? partCats.map((c) => `<tr>
                        <td>${escapeHtml(c.classification)}</td>
                        <td>${epoNum(c.count)}</td>
                        <td>${epoFmt(c.spend)}</td>
                        <td>${c.on_time_rate != null ? `${c.on_time_rate}%` : "—"}</td>
                    </tr>`).join("")
                    : `<tr><td colspan="4" class="empty-row">No part rows.</td></tr>`;
            }
            if (_epoSubtab === "parts") {
                _epoDestroy("epo-chart-parts-spend");
                createChart("epo-chart-parts-spend", {
                    type: "bar",
                    data: {
                        labels: partCats.map((c) => c.classification),
                        datasets: [{
                            label: "Spend (THB)",
                            data: partCats.map((c) => c.spend),
                            backgroundColor: [_epoChartTheme.blue, _epoChartTheme.teal],
                        }],
                    },
                    options: {
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { ticks: { color: tickColor }, grid: { color: gridColor } },
                            y: { ticks: { color: tickColor }, grid: { color: gridColor } },
                        },
                    },
                });
                _epoDestroy("epo-chart-parts-count");
                createChart("epo-chart-parts-count", {
                    type: "doughnut",
                    data: {
                        labels: partCats.map((c) => c.classification),
                        datasets: [{
                            data: partCats.map((c) => c.count),
                            backgroundColor: [_epoChartTheme.blue, _epoChartTheme.teal],
                        }],
                    },
                    options: { plugins: { legend: { position: "bottom", ...legendCfg } } },
                });
            }
            // Services
            const svcGroups = payload.service_groups || [];
            const svcBody = document.getElementById("epo-services-body");
            if (svcBody) {
                svcBody.innerHTML = svcGroups.length
                    ? svcGroups.map((g) => `<tr>
                        <td>${escapeHtml(g.group)}</td>
                        <td>${epoNum(g.count)}</td>
                        <td>${epoFmt(g.spend)}</td>
                        <td>${g.on_time_rate != null ? `${g.on_time_rate}%` : "—"}</td>
                    </tr>`).join("")
                    : `<tr><td colspan="4" class="empty-row">No service rows in the imported PO file.</td></tr>`;
            }
            if (_epoSubtab === "services") {
                _epoDestroy("epo-chart-services");
                const topSvc = svcGroups.slice(0, 12);
                createChart("epo-chart-services", {
                    type: "bar",
                    data: {
                        labels: topSvc.map((g) => g.group),
                        datasets: [{
                            label: "Spend (THB)",
                            data: topSvc.map((g) => g.spend),
                            backgroundColor: _epoChartTheme.purple,
                        }],
                    },
                    options: {
                        indexAxis: "y",
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { ticks: { color: tickColor }, grid: { color: gridColor } },
                            y: { ticks: { color: tickColor, font: { size: 11 } }, grid: { color: gridColor } },
                        },
                    },
                });
            }
        }

        // Spend Analysis
        if (_epoVisible("epo-panel-spend")) {
            const monthly = payload.monthly_trend || [];
            _epoDestroy("epo-chart-monthly");
            createChart("epo-chart-monthly", {
                type: "bar",
                data: {
                    labels: monthly.map((m) => m.month),
                    datasets: [{
                        label: "Spend (THB)",
                        data: monthly.map((m) => m.spend),
                        backgroundColor: _epoChartTheme.teal,
                    }],
                },
                options: {
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: tickColor }, grid: { color: gridColor } },
                        y: { ticks: { color: tickColor }, grid: { color: gridColor } },
                    },
                },
            });
            const topV = payload.top_vendors || [];
            _epoDestroy("epo-chart-top-vendors");
            createChart("epo-chart-top-vendors", {
                type: "bar",
                data: {
                    labels: topV.map((v) => v.vendor),
                    datasets: [{
                        label: "Spend (THB)",
                        data: topV.map((v) => v.spend),
                        backgroundColor: _epoChartTheme.green,
                    }],
                },
                options: {
                    indexAxis: "y",
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: tickColor }, grid: { color: gridColor } },
                        y: { ticks: { color: tickColor, font: { size: 11 } }, grid: { color: gridColor } },
                    },
                },
            });
        }
    }

    function renderEpoDataQuality(rules, records) {
        const container = document.getElementById("epo-dq-content");
        if (!container) return;
        if (!rules.length) {
            container.innerHTML = `<p class="epo-dq-empty" style="color:#10b981">✓ No data quality issues found.</p>`;
            return;
        }
        container.innerHTML = rules.map((rule) => {
            const rows = (rule.row_indices || []).map((i) => records[i]).filter(Boolean);
            const rowsHtml = `<div class="epo-dq-rows" id="epo-dq-rows-${rule.rule}">
                <table>
                    <thead><tr><th>PR No.</th><th>PO No.</th><th>Description</th><th>Machine</th><th>Vendor</th><th>Status</th><th>Total</th></tr></thead>
                    <tbody>${rows.slice(0, 50).map((r) => `<tr>
                        <td>${escapeHtml(r.pr_no || "--")}</td>
                        <td>${escapeHtml(r.po_no || "--")}</td>
                        <td>${escapeHtml(r.description || "--")}</td>
                        <td>${escapeHtml(r.pd_machine || "--")}</td>
                        <td>${escapeHtml(r.vendor || "--")}</td>
                        <td>${escapeHtml(r.status || "--")}</td>
                        <td>${r.total_price != null ? epoFmt(r.total_price) : "--"}</td>
                    </tr>`).join("")}${rows.length > 50 ? `<tr><td colspan="7" style="color:#94a3b8;font-size:0.78em">…and ${rows.length - 50} more</td></tr>` : ""}</tbody>
                </table></div>`;
            return `<div class="epo-dq-rule">
                <button class="epo-dq-rule-toggle" type="button" data-eporule="${rule.rule}">
                    <span>${escapeHtml(rule.label)}</span>
                    <span class="epo-dq-action">${escapeHtml(rule.action)}</span>
                    <span class="epo-dq-count">${rule.count}</span>
                </button>
                ${rowsHtml}
            </div>`;
        }).join("");

        container.querySelectorAll(".epo-dq-rule-toggle").forEach((btn) => {
            btn.addEventListener("click", () => {
                const panel = document.getElementById(`epo-dq-rows-${btn.dataset.eporule}`);
                if (panel) panel.classList.toggle("open");
            });
        });
    }

    // ─── End External Purchase Orders ─────────────────────────────────────────

    function ensureInspectionBreakdownGroups(groups) {
        const baseGroups = [
            { inspection: "inspection", label: "Normal Checklist with Additional Checks", count: 0, done: 0, pending: 0, overdue: 0 },
            { inspection: "standard", label: "Normal Checklist", count: 0, done: 0, pending: 0, overdue: 0 },
        ];
        const groupMap = new Map(baseGroups.map((group) => [group.inspection, { ...group }]));

        (groups || []).forEach((group) => {
            const key = group?.inspection || "";
            if (!groupMap.has(key)) {
                groupMap.set(key, { ...group });
                return;
            }

            groupMap.set(key, {
                ...groupMap.get(key),
                ...group,
            });
        });

        return [...groupMap.values()];
    }

    function buildUtilityInspectionGroups(rows) {
        const inspectedRows = filterUtilityInspectionRows(rows, "inspection");
        const standardRows = filterUtilityInspectionRows(rows, "standard");
        return [
            {
                inspection: "inspection",
                label: "Normal Checklist with Additional Checks",
                count: inspectedRows.length,
                done: inspectedRows.filter((row) => row.status === "Done").length,
                pending: inspectedRows.filter((row) => row.status === "Pending").length,
                overdue: inspectedRows.filter((row) => row.status === "Overdue").length,
            },
            {
                inspection: "standard",
                label: "Normal Checklist",
                count: standardRows.length,
                done: standardRows.filter((row) => row.status === "Done").length,
                pending: standardRows.filter((row) => row.status === "Pending").length,
                overdue: standardRows.filter((row) => row.status === "Overdue").length,
            },
        ];
    }

    function filterUtilityInspectionRows(rows, inspectionFilter) {
        if (!Array.isArray(rows) || inspectionFilter === "all") return rows || [];
        return (rows || []).filter((row) => {
            const requiresAdditionalChecks = utilityRowRequiresAdditionalChecks(row);
            return inspectionFilter === "inspection" ? requiresAdditionalChecks : !requiresAdditionalChecks;
        });
    }

    function utilityRowRequiresAdditionalChecks(row) {
        if (row?.inspection_required) return true;
        const assetCode = String(row?.asset_code || "").trim().toUpperCase();
        const overrides = UTILITY_INSPECTION_OVERRIDES[assetCode] || [];
        if (!overrides.length) return false;
        const scheduledDate = row?.scheduled_date
            ? new Date(row.scheduled_date)
            : row?.next_due_date
            ? new Date(row.next_due_date)
            : null;
        if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) return false;
        const month = scheduledDate.getMonth() + 1;
        const week = getUtilityWeekKey(scheduledDate);
        const isEveryWeek = String(row?.planned_week || row?.frequency_label_primary || "").toLowerCase().includes("every week");
        return overrides.some((override) => override.month === month && (isEveryWeek ? override.week === week : true));
    }

    function getUtilityWeekKey(dateValue) {
        const dt = new Date(dateValue);
        if (Number.isNaN(dt.getTime())) return "";
        const year = dt.getFullYear();
        const month = dt.getMonth();
        const mondayDates = [];
        for (let day = 1; day <= 31; day += 1) {
            const current = new Date(year, month, day);
            if (current.getMonth() !== month) break;
            if (current.getDay() === 1) mondayDates.push(day);
        }
        const referenceDates = mondayDates.length
            ? mondayDates
            : (() => {
                const tuesdayDates = [];
                for (let day = 1; day <= 31; day += 1) {
                    const current = new Date(year, month, day);
                    if (current.getMonth() !== month) break;
                    if (current.getDay() === 2) tuesdayDates.push(day);
                }
                return tuesdayDates;
            })();

        const dayOfMonth = dt.getDate();
        const position = referenceDates.indexOf(dayOfMonth);
        if (position === -1) return "";
        if (position === referenceDates.length - 1) return "last";
        if (position === 0) return "first";
        if (position === 1) return "second";
        if (position === 2) return "third";
        return "fourth";
    }

    function renderCriticalAttention(rows) {
        const target = document.getElementById("critical-attention-list");
        if (!target) return;
        target.innerHTML = rows.length
            ? rows.map((row) => `
                <button type="button" class="stack-item stack-item-button critical-item" data-critical-asset="${escapeHtml(row.asset_code)}">
                    <div>
                        <strong>${escapeHtml(translateDisplayText(row.asset_name))}</strong>
                        <div class="insight-meta">${escapeHtml(translateDisplayText(row.location_display || "--"))} | ${escapeHtml(row.status)}</div>
                    </div>
                    <strong>${escapeHtml(row.next_due_date_label || "--")}</strong>
                </button>
            `).join("")
            : '<div class="empty-state-block">No production-critical open items.</div>';
        target.querySelectorAll("[data-critical-asset]").forEach((button) => {
            button.addEventListener("click", async () => {
                state.hasAppliedListFilters = true;
                state.search = button.dataset.criticalAsset || "";
                state.equipmentCriticalOnly = "true";
                const input = document.getElementById("filter-search");
                if (input) input.value = state.search;
                await loadList();
            });
        });
    }

    async function loadMonthlyDetail() {
        const target = document.getElementById("monthly-detail-list");
        const title = document.getElementById("monthly-detail-title");
        const subtitle = document.getElementById("monthly-detail-subtitle");
        if (!target) return;

        const status = state.monthStatusView || "all";
        const isUtilityWithInspectionOverride = state.activeView !== "equipment" && state.monthlyInspectionFilter !== "all";
        const params = new URLSearchParams({
            month: state.selectedMonth,
            year: String(state.year),
            status,
            category: state.monthlyCategoryFilter,
            location: state.monthlyLocationFilter,
            inspection: isUtilityWithInspectionOverride ? "all" : state.monthlyInspectionFilter,
            search: "",
            sort: "due_date_asc",
        });

        const payload = await fetchJson(`${getApiBase()}/list?${params.toString()}`);
        const rows = isUtilityWithInspectionOverride
            ? filterUtilityInspectionRows(payload?.rows || [], state.monthlyInspectionFilter)
            : (payload?.rows || []);

        const statusLabelMap = {
            all: "All",
            done: "Done",
            pending: "Pending",
            overdue: "Overdue",
        };
        const statusLabel = statusLabelMap[status] || "Pending";
        const monthLabel = payload?.selected_month?.label || state.selectedMonth;
        const categoryLabel = state.monthlyCategoryFilter !== "all" ? translateDisplayText(state.monthlyCategoryFilter) : null;
        const locationLabel = state.monthlyLocationFilter !== "all" ? translateDisplayText(state.monthlyLocationFilter) : null;
        const inspectionLabel = state.monthlyInspectionFilter === "inspection"
            ? "Normal Checklist with Additional Checks"
            : state.monthlyInspectionFilter === "standard"
            ? "Normal Checklist"
            : null;
        const activeFilterLabel = inspectionLabel || locationLabel || categoryLabel;
        const isEquipment = state.activeView === "equipment";

        if (title) {
            title.textContent = categoryLabel
                ? `${statusLabel} Maintenance • ${categoryLabel}`
                : `${statusLabel} Maintenance`;
        }
        if (subtitle) {
            subtitle.textContent = categoryLabel
                ? `${monthLabel} machine list for ${statusLabel.toLowerCase()} progress in ${categoryLabel}`
                : `${monthLabel} machine list for ${statusLabel.toLowerCase()} progress`;
        }

        if (title) {
            title.textContent = activeFilterLabel
                ? `${statusLabel} ${isEquipment ? "Equipment" : "Maintenance"} - ${activeFilterLabel}`
                : `${statusLabel} ${isEquipment ? "Equipment" : "Maintenance"}`;
        }
        if (subtitle) {
            subtitle.textContent = activeFilterLabel
                ? `${monthLabel} ${isEquipment ? "equipment" : "machine"} list for ${statusLabel.toLowerCase()} progress in ${activeFilterLabel}`
                : `${monthLabel} ${isEquipment ? "equipment" : "machine"} list for ${statusLabel.toLowerCase()} progress`;
        }

        if (!rows.length) {
            target.innerHTML = `<div class="empty-state-block">No ${statusLabel.toLowerCase()} maintenance records for the selected month.</div>`;
            return;
        }

        target.innerHTML = rows.map((row) => `
            <div class="monthly-detail-item">
                <div class="monthly-detail-meta">
                    <span class="monthly-detail-code">${escapeHtml(row.asset_code)}</span>
                    <strong class="monthly-detail-name">${escapeHtml(translateDisplayText(row.asset_name))}</strong>
                    ${row.location_detail ? `<span class="monthly-detail-note">${escapeHtml(translateDisplayText(row.location_detail))}</span>` : ""}
                    ${renderInspectionSubtext(row)}
                </div>
                <div class="monthly-detail-week">
                    <span class="monthly-detail-label">Scheduled Week</span>
                    <strong>${escapeHtml(formatScheduledWeek(row))}</strong>
                </div>
                <div class="monthly-detail-status">
                    <span class="monthly-detail-label">Status</span>
                    <span class="status-pill ${statusClass(row.status)}">${escapeHtml(row.status === "Upcoming" ? "Pending" : row.status)}</span>
                </div>
            </div>
        `).join("");
    }

    async function loadList() {
        const body = document.getElementById("maintenance-table-body");
        if (!body) return;

        const maintenanceColumnCount = state.activeView === "equipment" ? 10 : 7;

        if (!state.hasAppliedListFilters) {
            body.innerHTML = `<tr><td colspan="${maintenanceColumnCount}" class="empty-row">Apply filters to load the maintenance list.</td></tr>`;
            return;
        }

        const isUtilityWithInspectionOverride = state.activeView !== "equipment" && state.inspectionFilter !== "all";
        const params = new URLSearchParams({
            month: state.listMonthFilter || state.selectedMonth,
            year: String(state.year),
            status: state.statusFilter,
            category: state.categoryFilter,
            location: state.locationFilter,
            inspection: isUtilityWithInspectionOverride ? "all" : state.inspectionFilter,
            search: state.search,
            sort: state.sort,
            aggregate: "asset",
            priority: state.activeView === "equipment" ? state.equipmentPriorityFilter : "all",
            critical: state.activeView === "equipment" ? state.equipmentCriticalOnly : "all",
            week: state.activeView === "equipment" ? state.equipmentWeekFilter : "all",
        });

        const payload = await fetchJson(`${getApiBase()}/list?${params.toString()}`);
        const rows = isUtilityWithInspectionOverride
            ? filterUtilityInspectionRows(payload?.rows || [], state.inspectionFilter)
            : (payload?.rows || []);

        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="${maintenanceColumnCount}" class="empty-row">No maintenance records match the current filters.</td></tr>`;
            return;
        }

        body.innerHTML = rows.map((row) => `
            <tr class="${row.status === "Overdue" ? "row-overdue" : ""} ${row.is_production_critical ? "row-critical" : ""}">
                <td>${escapeHtml(row.asset_code)}</td>
                <td>
                    <div class="table-primary-cell">
                        <strong>${escapeHtml(translateDisplayText(row.asset_name))}</strong>
                        ${row.location_detail ? `<span class="table-subtext">${escapeHtml(translateDisplayText(row.location_detail))}</span>` : ""}
                        ${row.is_production_critical ? '<span class="table-subtext">Production Critical</span>' : ""}
                        ${renderInspectionSubtext(row)}
                      </div>
                  </td>
                  <td>${escapeHtml(translateDisplayText(row.category))}</td>
                  <td>${escapeHtml(translateDisplayText(row.location_display || "--"))}</td>
                  <td>${renderStackedMetricCell(formatFrequencyStack(row))}</td>
                  <td>${renderStackedMetricCell(formatNextDueStack(row))}</td>
                  <td>${renderStackedMetricCell(formatLatestMaintenanceStack(row))}</td>
                  ${state.activeView === "equipment" ? `
                    <td>${escapeHtml(row.status || "--")}</td>
                    <td>${escapeHtml(String(row.days_overdue || 0))}</td>
                    <td>${escapeHtml(row.assigned_technician || "--")}</td>
                  ` : ""}
              </tr>
          `).join("");
      }

    async function loadTimeline() {
        const payload = await fetchJson(`${getApiBase()}/timeline?year=${state.year}&month=${encodeURIComponent(state.selectedMonth)}`);
        const months = payload?.months || [];
        const weeklyProgress = payload?.weekly_progress || [];

        const strip = document.getElementById("timeline-month-strip");
        if (strip) {
            strip.innerHTML = months.map((month) => `
                <button type="button" class="month-chip ${month.month_key === state.selectedMonth ? "active" : ""}" data-month="${month.month_key}">
                    <span>${escapeHtml(month.label)}</span>
                    <span class="month-total">${formatInteger(month.total)}</span>
                </button>
            `).join("");

            strip.querySelectorAll(".month-chip").forEach((button) => {
                button.addEventListener("click", async () => {
                    state.selectedMonth = button.dataset.month || state.selectedMonth;
                    syncMonthInputs();
                    await refreshMonthScopedSections();
                });
            });
        }

        createChart("timeline-chart", {
            type: "bar",
            data: {
                labels: weeklyProgress.map((week) => week.label),
                datasets: [
                    {
                        label: "Scheduled",
                        data: weeklyProgress.map((week) => week.scheduled),
                        backgroundColor: weeklyProgress.map((week) => (week.pending || 0) > 2 ? "#f59e0b" : "#0f766e"),
                        borderRadius: 10,
                    },
                    {
                        label: "Completed",
                        data: weeklyProgress.map((week) => week.completed),
                        backgroundColor: "#10b981",
                        borderRadius: 10,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: {
                            usePointStyle: true,
                            boxWidth: 10,
                            font: { family: "Inter", size: 11 },
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: "#64748b" },
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: "rgba(148, 163, 184, 0.14)" },
                        ticks: { color: "#64748b", precision: 0 },
                    },
                },
                onClick: state.activeView === "equipment" ? async (_event, elements, chart) => {
                    const point = elements?.[0];
                    if (!point) return;
                    const selectedWeek = chart.data.labels?.[point.index] || "all";
                    state.equipmentWeekFilter = state.equipmentWeekFilter === selectedWeek ? "all" : selectedWeek;
                    state.hasAppliedListFilters = true;
                    await loadList();
                } : undefined,
            },
        });
    }

    function populateSelect(id, options, useRawLabel = false) {
        const node = document.getElementById(id);
        if (!node) return;
        node.innerHTML = options.map((option) => {
            const value = option.value ?? option;
            const label = useRawLabel ? (option.label ?? value) : (option.label ?? option);
            return `<option value="${escapeHtml(String(value))}">${escapeHtml(translateDisplayText(String(label)))}</option>`;
        }).join("");
    }

    function createChart(id, config) {
        const canvas = document.getElementById(id);
        if (!canvas || typeof Chart === "undefined") return;
        if (charts[id]) charts[id].destroy();
        const scroll = config._scroll || null;
        delete config._scroll;
        const fixedCanvasSize = applyAnalysisChartScroll(canvas, scroll);
        if (fixedCanvasSize) {
            config.options = { ...(config.options || {}), responsive: false, maintainAspectRatio: false };
        }
        charts[id] = new Chart(canvas, config);
    }

    function applyAnalysisChartScroll(canvas, scroll) {
        const parent = canvas.parentElement;
        if (!parent) return false;
        parent.classList.remove("analysis-chart-scroll-x", "analysis-chart-scroll-y");
        canvas.style.width = "";
        canvas.style.height = "";
        canvas.removeAttribute("width");
        canvas.removeAttribute("height");
        if (!scroll || !scroll.count) return false;
        const axis = scroll.axis || "x";
        const count = Number(scroll.count || 0);
        const parentWidth = Math.max(parent.clientWidth || 640, 320);
        const parentHeight = Math.max(parent.clientHeight || 320, 260);
        if (axis === "x" && count > 18) {
            const width = Math.max(parentWidth, count * 72);
            parent.classList.add("analysis-chart-scroll-x");
            canvas.style.width = `${width}px`;
            canvas.style.height = `${parentHeight}px`;
            canvas.width = width;
            canvas.height = parentHeight;
            return true;
        }
        if (axis === "y" && count > 12) {
            const height = Math.max(parentHeight, count * 34 + 40);
            parent.classList.add("analysis-chart-scroll-y");
            canvas.style.width = `${parentWidth}px`;
            canvas.style.height = `${height}px`;
            canvas.width = parentWidth;
            canvas.height = height;
            return true;
        }
        return false;
    }

    function syncMonthInputs() {
        const monthSelector = document.getElementById("month-selector");
        const filterMonth = document.getElementById("filter-month");
        if (monthSelector) monthSelector.value = state.selectedMonth;
        if (filterMonth) filterMonth.value = state.listMonthFilter || state.selectedMonth;
    }

    function syncStatusControls() {
        const filterStatus = document.getElementById("filter-status");
        if (filterStatus) filterStatus.value = state.statusFilter;

        document.querySelectorAll("[data-status]").forEach((chip) => {
            chip.classList.toggle("active", (chip.dataset.status || "all") === state.monthStatusView);
        });

        document.querySelectorAll("[data-status-target]").forEach((card) => {
            card.classList.toggle("active", (card.dataset.statusTarget || "all") === state.monthStatusView);
        });
    }

    function syncFilterInputs() {
        syncStatusControls();
        const category = document.getElementById("filter-category");
        const location = document.getElementById("filter-location");
        const inspection = document.getElementById("filter-inspection");
        const sort = document.getElementById("filter-sort");
        const search = document.getElementById("filter-search");

        if (category) category.value = state.categoryFilter;
        if (location) location.value = state.locationFilter;
        if (inspection) inspection.value = state.inspectionFilter;
        if (sort) sort.value = state.sort;
        if (search) search.value = state.search;
    }

    function setText(id, value) {
        const node = document.getElementById(id);
        if (node) node.textContent = value;
    }

    function setSummaryCount(id, value) {
        const node = document.getElementById(id);
        if (!node) return;
        const label = state.activeView === "equipment" ? "No. of machine" : "No. of utilities";
        node.innerHTML = `<span class="summary-metric-number">${escapeHtml(formatInteger(value))}</span><span class="summary-subtext">${escapeHtml(label)}</span>`;
    }

    function formatInteger(value) {
        return Number(value || 0).toLocaleString();
    }

    function formatShortDate(value) {
        if (!value) return "--";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        return parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
    }

    function formatNumber(value, digits = 1) {
        const numeric = Number(value || 0);
        return numeric.toLocaleString(undefined, {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        });
    }


    function formatFrequency(row) {
        if (row.frequency_type === "monthly" && row.target_week === "every_week") return "Monthly | Every week";
        if (row.frequency_type === "monthly") return `Monthly | ${row.planned_week}`;
        return `Every ${row.frequency_value} months | ${row.planned_week}`;
    }

    function formatFrequencyStack(row) {
        if (row?.frequency_label_primary || row?.frequency_label_secondary) {
            return {
                primary: row?.frequency_label_primary || "--",
                secondary: row?.frequency_label_secondary || "",
            };
        }
        return {
            primary: row?.planned_week || "--",
            secondary: row?.frequency_type === "monthly"
                ? "Monthly"
                : `Every ${row?.frequency_value ?? "--"} months`,
        };
    }

    function formatNextDueStack(row) {
        return {
            primary: row?.next_due_date_label || "--",
            secondary: row?.next_due_week || "--",
        };
    }

    function formatLatestMaintenanceStack(row) {
        if (!row?.latest_done_week) {
            return {
                primary: "--",
                secondary: "No completed week yet",
            };
        }

        return {
            primary: row.latest_done_week,
            secondary: "",
        };
    }

    function renderStackedMetricCell(value) {
        return `
            <div class="table-metric-cell">
                <strong class="table-metric-primary">${escapeHtml(value?.primary || "--")}</strong>
                ${value?.secondary ? `<span class="table-subtext">${escapeHtml(value.secondary)}</span>` : ""}
            </div>
        `;
    }

    function renderInspectionSubtext(row) {
        if (!row?.inspection_required) return "";
        return `<span class="table-subtext">${escapeHtml(row.inspection_label || "Additional checks required beyond the normal checklist")}</span>`;
    }

    function formatScheduledWeek(row) {
        return translateDisplayText(row?.scheduled_week_label || row?.planned_week || "--");
    }

    function translateDisplayText(value) {
        const text = String(value ?? "").trim();
        if (!text) return "";

        const exactMap = {
            "\u0e40\u0e04\u0e23\u0e37\u0e48\u0e2d\u0e07 UV": "UV Machine",
            "\u0e40\u0e04\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e0b\u0e31\u0e01\u0e1c\u0e49\u0e32 1": "Washing Machine 1",
            "\u0e40\u0e04\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e0b\u0e31\u0e01\u0e1c\u0e49\u0e32 2": "Washing Machine 2",
            "\u0e40\u0e04\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e2d\u0e1a\u0e1c\u0e49\u0e32 1": "Dryer 1",
            "\u0e40\u0e04\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e2d\u0e1a\u0e1c\u0e49\u0e32 2": "Dryer 2",
            "\u0e1a\u0e19\u0e1d\u0e49\u0e32\u0e40\u0e1e\u0e14\u0e32\u0e19\u0e2d\u0e32\u0e04\u0e32\u0e23": "Ceiling Space",
            "\u0e2d\u0e32\u0e04\u0e32\u0e23\u0e1a\u0e2d\u0e22\u0e40\u0e25\u0e2d\u0e23\u0e4c": "Boiler Room",
            "\u0e2b\u0e49\u0e2d\u0e07\u0e1b\u0e31\u0e4a\u0e21\u0e25\u0e21": "Air Compressor Room",
            "\u0e42\u0e23\u0e07\u0e1a\u0e33\u0e1a\u0e31\u0e14\u0e19\u0e49\u0e33\u0e14\u0e35": "Water Treatment Plant",
            "\u0e42\u0e23\u0e07\u0e1a\u0e33\u0e1a\u0e31\u0e14\u0e19\u0e49\u0e33\u0e40\u0e2a\u0e35\u0e22": "Wastewater Treatment Plant",
        };

        if (exactMap[text]) return exactMap[text];

        let translated = text;
        const replacements = [
            ["\u0e23\u0e30\u0e1a\u0e1a\u0e40\u0e15\u0e34\u0e21\u0e2d\u0e32\u0e01\u0e32\u0e28", "Air Intake System"],
            ["\u0e23\u0e30\u0e1a\u0e1a\u0e14\u0e39\u0e14\u0e2d\u0e32\u0e01\u0e32\u0e28", "Exhaust System"],
            ["\u0e2b\u0e49\u0e2d\u0e07 Cooking", "Cooking Room"],
            ["\u0e2b\u0e49\u0e2d\u0e07\u0e25\u0e49\u0e32\u0e07\u0e1d\u0e31\u0e48\u0e07\u0e14\u0e34\u0e1a", "Raw Wash Area"],
            ["\u0e1d\u0e31\u0e48\u0e07\u0e14\u0e34\u0e1a", "Raw Side"],
            ["\u0e2d\u0e32\u0e04\u0e32\u0e23", "Building "],
            ["\u0e2b\u0e49\u0e2d\u0e07", "Room "],
        ];

        replacements.forEach(([source, replacement]) => {
            translated = translated.replaceAll(source, replacement);
        });

        return /[\u0E00-\u0E7F]/.test(translated) ? text : translated;
    }

    function statusClass(status) {
        const normalized = String(status || "").toLowerCase();
        if (normalized === "done") return "status-done";
        if (normalized === "overdue") return "status-overdue";
        return "status-pending";
    }

    function overviewStatusClass(status) {
        const normalized = String(status || "").toLowerCase();
        if (normalized === "completed") return "status-done";
        if (normalized === "pending") return "status-overdue";
        return "status-pending";
    }

    function debounce(callback, wait) {
        let timeoutId = null;
        return (...args) => {
            window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(() => callback(...args), wait);
        };
    }

    async function fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (match) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        }[match]));
    }

    // ── Specific Spare Part Usage Trend (SPT) ────────────────────────────────

    const sptState = {
        selectedKey: null,       // normalized part key (clean_description)
        dateMode: "all",         // all | year | month | custom
        selectedYears: [],       // e.g. ["2024","2025"]
        selectedYear: null,      // for month-mode year context
        selectedMonth: null,     // "01"–"12"
        startDate: null,
        endDate: null,
        metric: "total_consumption",
        txnExpanded: false,
    };

    // Strip leading "N.NN / " quantity prefix from a raw description.
    function sptStripPrefix(desc) {
        return (desc || "").replace(/^\d+\.?\d*\s*\/\s*/, "").trim();
    }

    // Normalise a description for grouping: strip prefix, lowercase, collapse spaces.
    function sptNormalise(desc) {
        return sptStripPrefix(desc || "").toLowerCase().replace(/\s+/g, " ").trim();
    }

    // Build a sorted list of unique parts from ayData.transactions.
    // Returns [{key, displayName, totalConsumption}] sorted by total desc.
    function buildSptPartList() {
        const txns = ayData?.transactions || [];
        const map = {};
        txns.forEach((r) => {
            const raw = r.translated_description || r.clean_description || r.original_description || "";
            const key = sptNormalise(raw);
            if (!key) return;
            if (!map[key]) {
                map[key] = { key, displayName: sptStripPrefix(r.translated_description || r.clean_description || raw), total: 0 };
            }
            map[key].total += r.total_consumption || 0;
        });
        return Object.values(map).sort((a, b) => b.total - a.total);
    }

    // Get the default part: highest consumption in the latest available year.
    function sptDefaultPartKey() {
        if (!ayData?.years?.length || !ayData?.top_parts_by_year) return null;
        const latestYear = String(ayData.years[ayData.years.length - 1]);
        const topParts = ayData.top_parts_by_year[latestYear] || [];
        if (!topParts.length) return null;
        const top = topParts[0];
        return sptNormalise(top.translated || top.description || "");
    }

    // Populate the spare-part search input and select dropdown.
    function populateSptPartSelector() {
        const parts = buildSptPartList();
        const sel = document.getElementById("spt-part-select");
        const search = document.getElementById("spt-part-search");
        if (!sel) return;

        function renderOptions(filter) {
            const lc = (filter || "").toLowerCase();
            const filtered = lc ? parts.filter((p) => p.displayName.toLowerCase().includes(lc)) : parts;
            sel.innerHTML = `<option value="">— select a part —</option>` +
                filtered.slice(0, 300).map((p) =>
                    `<option value="${escapeHtml(p.key)}"${p.key === sptState.selectedKey ? " selected" : ""}>${escapeHtml(p.displayName)}</option>`
                ).join("");
            if (sptState.selectedKey) sel.value = sptState.selectedKey;
        }

        renderOptions("");

        if (search) {
            search.addEventListener("input", debounce(() => renderOptions(search.value), 200));
        }
        sel.addEventListener("change", () => {
            sptState.selectedKey = sel.value || null;
            renderSptSection();
        });
    }

    // Populate year checkboxes from ayData.years.
    function populateSptYearChecks() {
        const container = document.getElementById("spt-year-checks");
        if (!container || !ayData?.years) return;
        container.innerHTML = (ayData.years || []).map((yr) => {
            const y = String(yr);
            const checked = sptState.selectedYears.includes(y) ? " checked" : "";
            return `<label class="spt-year-check"><input type="checkbox" value="${y}"${checked}> ${y}</label>`;
        }).join("");
        container.querySelectorAll("input[type=checkbox]").forEach((cb) => {
            cb.addEventListener("change", () => {
                sptState.selectedYears = [...container.querySelectorAll("input:checked")].map((c) => c.value);
                renderSptSection();
            });
        });
    }

    // Show/hide date-mode dependent controls.
    function updateSptDateControls() {
        const mode = sptState.dateMode;
        const showYear = mode === "year" || mode === "month";
        const showMonth = mode === "month";
        const showCustom = mode === "custom";
        document.getElementById("spt-year-field")?.classList.toggle("spt-hidden", !showYear);
        document.getElementById("spt-month-field")?.classList.toggle("spt-hidden", !showMonth);
        document.getElementById("spt-start-field")?.classList.toggle("spt-hidden", !showCustom);
        document.getElementById("spt-end-field")?.classList.toggle("spt-hidden", !showCustom);
    }

    // Return transactions for the currently selected part key.
    function sptGetAllForPart() {
        if (!sptState.selectedKey || !ayData?.transactions) return [];
        const key = sptState.selectedKey;
        return ayData.transactions.filter((r) => {
            const raw = r.translated_description || r.clean_description || r.original_description || "";
            return sptNormalise(raw) === key;
        });
    }

    // Apply the current date filter to a list of transactions.
    function sptApplyDateFilter(txns) {
        const mode = sptState.dateMode;
        if (mode === "all") return txns;
        if (mode === "year") {
            const years = sptState.selectedYears;
            if (!years.length) return txns;
            return txns.filter((r) => years.includes(String(r.year)));
        }
        if (mode === "month") {
            const yrs = sptState.selectedYears;
            const mo = sptState.selectedMonth;
            return txns.filter((r) => {
                const yearOk = !yrs.length || yrs.includes(String(r.year));
                const monthOk = !mo || r.month?.slice(5, 7) === mo;
                return yearOk && monthOk;
            });
        }
        if (mode === "custom") {
            const start = sptState.startDate ? new Date(`${sptState.startDate}T00:00:00`) : null;
            const end = sptState.endDate ? new Date(`${sptState.endDate}T23:59:59`) : null;
            if (!start && !end) return txns;
            return txns.filter((r) => {
                const d = new Date(`${r.project_date}T12:00:00`);
                if (start && d < start) return false;
                if (end && d > end) return false;
                return true;
            });
        }
        return txns;
    }

    // Aggregate transactions by year. Returns [{year, qty, total, lines, wos, assets, ytd}].
    function sptComputeYearly(txns) {
        const byYear = {};
        txns.forEach((r) => {
            const y = String(r.year);
            if (!byYear[y]) byYear[y] = { year: y, qty: 0, total: 0, lines: 0, wos: new Set(), assets: new Set() };
            byYear[y].qty += r.quantity_used || 0;
            byYear[y].total += r.total_consumption || 0;
            byYear[y].lines += 1;
            if (r.work_order_id) byYear[y].wos.add(r.work_order_id);
            if (r.asset_id) byYear[y].assets.add(r.asset_id);
        });
        // Determine latest year cut-off for YTD labelling.
        const allTxnDates = (ayData?.transactions || []).map((r) => r.project_date).filter(Boolean).sort();
        const latestDate = allTxnDates[allTxnDates.length - 1] || null;
        const latestYear = latestDate ? latestDate.slice(0, 4) : null;
        return Object.values(byYear).sort((a, b) => a.year.localeCompare(b.year)).map((row) => ({
            ...row,
            woCount: row.wos.size,
            assetCount: row.assets.size,
            isYtd: row.year === latestYear,
        }));
    }

    // Aggregate transactions by year+month. Returns [{year, month, qty, total, lines, wos, assets}].
    function sptComputeMonthly(txns) {
        const byMonth = {};
        txns.forEach((r) => {
            const k = r.month || "";
            if (!k) return;
            if (!byMonth[k]) byMonth[k] = { year: String(r.year), month: k, qty: 0, total: 0, lines: 0, wos: new Set(), assets: new Set() };
            byMonth[k].qty += r.quantity_used || 0;
            byMonth[k].total += r.total_consumption || 0;
            byMonth[k].lines += 1;
            if (r.work_order_id) byMonth[k].wos.add(r.work_order_id);
            if (r.asset_id) byMonth[k].assets.add(r.asset_id);
        });
        return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)).map((row) => ({
            ...row, woCount: row.wos.size, assetCount: row.assets.size,
        }));
    }

    // Compute YTD comparison between latest year and previous year using same date cut-off.
    function sptComputeYtd(allForPart) {
        if (!allForPart.length) return null;
        const sortedDates = allForPart.map((r) => r.project_date).filter(Boolean).sort();
        const latestDate = sortedDates[sortedDates.length - 1];
        if (!latestDate) return null;
        const latestYear = parseInt(latestDate.slice(0, 4), 10);
        const prevYear = latestYear - 1;
        const cutoffMMDD = latestDate.slice(5); // "MM-DD"
        function sumYear(yr) {
            const cutoff = `${yr}-${cutoffMMDD}`;
            const rows = allForPart.filter((r) => String(r.year) === String(yr) && r.project_date <= cutoff);
            return {
                total: rows.reduce((s, r) => s + (r.total_consumption || 0), 0),
                qty: rows.reduce((s, r) => s + (r.quantity_used || 0), 0),
                lines: rows.length,
            };
        }
        const curr = sumYear(latestYear);
        const prev = sumYear(prevYear);
        if (!curr.lines && !prev.lines) return null;
        const diff = curr.total - prev.total;
        const pct = prev.total > 0 ? ((diff / prev.total) * 100) : null;
        return { latestYear, prevYear, cutoffMMDD, curr, prev, diff, pct };
    }

    // Generate a plain-language trend summary from yearly data.
    function sptTrendSummary(yearly) {
        if (!yearly.length) return "Insufficient data to determine a clear trend.";
        if (yearly.length === 1) return `Only data for ${yearly[0].year} available — unable to determine trend.`;
        const totals = yearly.map((y) => y.total);
        const last = totals[totals.length - 1];
        const prev = totals[totals.length - 2];
        const first = totals[0];
        const increasing = totals.every((v, i) => i === 0 || v >= totals[i - 1]);
        const decreasing = totals.every((v, i) => i === 0 || v <= totals[i - 1]);
        const ytdRow = yearly.find((y) => y.isYtd);
        const suffix = ytdRow ? ` (${ytdRow.year} is YTD)` : "";
        if (increasing) return `Usage has been consistently increasing from ${yearly[0].year} to ${yearly[yearly.length - 1].year}.${suffix}`;
        if (decreasing) return `Usage has been consistently decreasing from ${yearly[0].year} to ${yearly[yearly.length - 1].year}.${suffix}`;
        if (last > prev && last > first) return `Usage is higher in the most recent period compared to earlier years.${suffix}`;
        if (last < prev && last < first) return `Usage appears to be reducing based on the most recent data.${suffix}`;
        if (Math.abs(last - prev) / Math.max(prev, 1) < 0.05) return `Usage appears stable across the selected period.${suffix}`;
        return `Usage shows mixed patterns — review the table below for details.${suffix}`;
    }

    // Format a metric value for display in SPT tables/cards.
    function sptFmtMetric(row, metric) {
        if (metric === "total_consumption") return spFmt(row.total);
        if (metric === "quantity_used") return row.qty != null ? Number(row.qty).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "--";
        if (metric === "transaction_count") return row.lines != null ? String(row.lines) : "--";
        if (metric === "wo_count") return row.woCount != null ? String(row.woCount) : "--";
        if (metric === "asset_count") return row.assetCount != null ? String(row.assetCount) : "--";
        return "--";
    }

    function sptMetricValue(row, metric) {
        if (metric === "total_consumption") return spConvert(row.total) || 0;
        if (metric === "quantity_used") return row.qty || 0;
        if (metric === "transaction_count") return row.lines || 0;
        if (metric === "wo_count") return row.woCount || 0;
        if (metric === "asset_count") return row.assetCount || 0;
        return 0;
    }

    // Render KPI cards.
    function renderSptKpis(filtered) {
        if (!filtered.length) {
            ["spt-kpi-total","spt-kpi-qty","spt-kpi-lines","spt-kpi-wos","spt-kpi-assets","spt-kpi-latest"].forEach((id) => setText(id, "—"));
            return;
        }
        const total = filtered.reduce((s, r) => s + (r.total_consumption || 0), 0);
        const qty = filtered.reduce((s, r) => s + (r.quantity_used || 0), 0);
        const wos = new Set(filtered.map((r) => r.work_order_id).filter(Boolean)).size;
        const assets = new Set(filtered.map((r) => r.asset_id).filter(Boolean)).size;
        const latest = filtered.map((r) => r.project_date).filter(Boolean).sort().pop() || "--";
        setText("spt-kpi-total", spFmt(total));
        setText("spt-kpi-qty", qty ? Number(qty).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "--");
        setText("spt-kpi-lines", filtered.length.toLocaleString());
        setText("spt-kpi-wos", wos.toLocaleString());
        setText("spt-kpi-assets", assets.toLocaleString());
        setText("spt-kpi-latest", latest);
    }

    // Render YTD comparison and trend summary insight row.
    function renderSptInsights(allForPart, yearly) {
        const row = document.getElementById("spt-insight-row");
        if (!row) return;
        const ytd = sptComputeYtd(allForPart);
        const summary = sptTrendSummary(yearly);
        let html = `<div class="spt-summary-card"><p class="spt-summary-text">${escapeHtml(summary)}</p></div>`;
        if (ytd) {
            const arrow = ytd.diff > 0 ? "▲" : ytd.diff < 0 ? "▼" : "–";
            const cls = ytd.diff > 0 ? "spt-ytd-up" : ytd.diff < 0 ? "spt-ytd-down" : "spt-ytd-flat";
            const pctStr = ytd.pct != null ? ` (${ytd.pct >= 0 ? "+" : ""}${ytd.pct.toFixed(1)}%)` : "";
            html += `<div class="spt-ytd-card ${cls}">
                <div class="spt-ytd-title">YTD Comparison (Jan 1 – ${ytd.cutoffMMDD.replace("-", " ")})</div>
                <div class="spt-ytd-row">
                    <span>${ytd.prevYear} YTD: <strong>${spFmt(ytd.prev.total)}</strong></span>
                    <span>${ytd.latestYear} YTD: <strong>${spFmt(ytd.curr.total)}</strong></span>
                    <span class="spt-ytd-change">${arrow} ${spFmt(Math.abs(ytd.diff))}${pctStr}</span>
                </div>
                <p class="spt-ytd-note">YTD comparison uses the same date cut-off for both years.</p>
            </div>`;
        }
        row.innerHTML = html;
    }

    // Render yearly trend chart.
    function renderSptYearlyChart(yearly) {
        const metric = sptState.metric;
        const labels = yearly.map((y) => y.isYtd ? `${y.year} YTD` : y.year);
        const values = yearly.map((y) => sptMetricValue(y, metric));
        createChart("spt-chart-yearly", {
            type: "bar",
            data: {
                labels,
                datasets: [{ label: metric, data: values, backgroundColor: "#7c3aed", borderRadius: 8 }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: "#64748b", font: { size: 12, weight: "700" } } },
                    y: { beginAtZero: true, grid: { color: "rgba(148,163,184,0.15)" }, ticks: { color: "#64748b", font: { size: 10 } } },
                },
            },
        });
    }

    // Render monthly trend chart — one series per year.
    function renderSptMonthlyChart(monthly) {
        const metric = sptState.metric;
        const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const years = [...new Set(monthly.map((r) => r.year))].sort();
        const datasets = years.map((yr, i) => {
            const byMo = new Array(12).fill(0);
            monthly.filter((r) => r.year === yr).forEach((r) => {
                const mo = parseInt(r.month.slice(5, 7), 10) - 1;
                if (mo >= 0 && mo < 12) byMo[mo] = sptMetricValue(r, metric);
            });
            return {
                label: yr,
                data: byMo,
                borderColor: AY_YEAR_COLORS[i % AY_YEAR_COLORS.length],
                backgroundColor: AY_YEAR_COLORS[i % AY_YEAR_COLORS.length] + "33",
                fill: true, tension: 0.3, pointRadius: 4, borderWidth: 2,
            };
        });
        createChart("spt-chart-monthly", {
            type: "line",
            data: { labels: MONTH_LABELS, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: true, position: "top", labels: { font: { size: 11 }, boxWidth: 14, padding: 12, usePointStyle: true, pointStyle: "circle" } } },
                scales: {
                    x: { grid: { color: "rgba(148,163,184,0.12)" }, ticks: { color: "#64748b", font: { size: 10 } } },
                    y: { beginAtZero: true, grid: { color: "rgba(148,163,184,0.15)" }, ticks: { color: "#64748b", font: { size: 10 } } },
                },
            },
        });
    }

    // Render yearly trend table.
    function renderSptYearlyTable(yearly) {
        const tbody = document.getElementById("spt-yearly-body");
        if (!tbody) return;
        if (!yearly.length) { tbody.innerHTML = `<tr><td colspan="8" class="empty-row">No data for selected filters.</td></tr>`; return; }
        tbody.innerHTML = yearly.map((row, i) => {
            const prevTotal = i > 0 ? yearly[i - 1].total : null;
            const pctChg = prevTotal != null && prevTotal > 0 ? ((row.total - prevTotal) / prevTotal * 100) : null;
            const pctStr = pctChg != null ? `<span class="${pctChg > 5 ? "ay-growth-up" : pctChg < -5 ? "ay-growth-down" : "ay-growth-flat"}">${pctChg >= 0 ? "+" : ""}${pctChg.toFixed(1)}%</span>` : "—";
            const avgPerWo = row.woCount > 0 ? spFmt(row.total / row.woCount) : "—";
            return `<tr>
                <td>${escapeHtml(row.year)}${row.isYtd ? ' <span class="spt-ytd-badge">YTD</span>' : ""}</td>
                <td>${row.qty ? Number(row.qty).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</td>
                <td>${spFmt(row.total)}</td>
                <td>${row.lines.toLocaleString()}</td>
                <td>${row.woCount.toLocaleString()}</td>
                <td>${row.assetCount.toLocaleString()}</td>
                <td>${avgPerWo}</td>
                <td>${pctStr}</td>
            </tr>`;
        }).join("");
    }

    // Render monthly trend table.
    function renderSptMonthlyTable(monthly) {
        const tbody = document.getElementById("spt-monthly-body");
        if (!tbody) return;
        if (!monthly.length) { tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No data for selected filters.</td></tr>`; return; }
        const MONTHS = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        tbody.innerHTML = monthly.map((row) => {
            const moNum = parseInt(row.month.slice(5, 7), 10);
            const moLabel = MONTHS[moNum] || row.month;
            return `<tr>
                <td>${escapeHtml(row.year)}</td>
                <td>${escapeHtml(moLabel)}</td>
                <td>${row.qty ? Number(row.qty).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</td>
                <td>${spFmt(row.total)}</td>
                <td>${row.lines.toLocaleString()}</td>
                <td>${row.woCount.toLocaleString()}</td>
                <td>${row.assetCount.toLocaleString()}</td>
            </tr>`;
        }).join("");
    }

    // Render the expandable transactions table.
    function renderSptTransactions(filtered) {
        const tbody = document.getElementById("spt-txn-body");
        if (!tbody) return;
        if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="8" class="empty-row">No transactions for selected filters.</td></tr>`; return; }
        const sorted = [...filtered].sort((a, b) => (b.project_date || "").localeCompare(a.project_date || ""));
        tbody.innerHTML = sorted.map((r) => {
            const name = sptStripPrefix(r.translated_description || r.clean_description || r.original_description || "");
            return `<tr>
                <td>${escapeHtml(r.project_date || "—")}</td>
                <td>${escapeHtml(r.transaction_id || "—")}</td>
                <td>${escapeHtml(name.slice(0, 60))}</td>
                <td>${r.quantity_used != null ? Number(r.quantity_used).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</td>
                <td>${spFmt(r.total_consumption)}</td>
                <td>${escapeHtml(r.asset_id || "—")}</td>
                <td>${escapeHtml(r.work_order_id || "—")}</td>
                <td>${escapeHtml(r.item_category || "—")}</td>
            </tr>`;
        }).join("");
    }

    // Update the subtitle with the selected part name and record count.
    function updateSptSubtitle(filtered) {
        const el = document.getElementById("spt-subtitle");
        if (!el) return;
        if (!sptState.selectedKey) { el.textContent = "Select a spare part to explore its usage over time."; return; }
        const parts = buildSptPartList();
        const part = parts.find((p) => p.key === sptState.selectedKey);
        el.textContent = part
            ? `${part.displayName} · ${filtered.length} transaction line${filtered.length !== 1 ? "s" : ""}`
            : "No matching part found.";
    }

    // Main render function — called whenever any SPT filter changes.
    function renderSptSection() {
        if (!ayData?.transactions) return;
        const allForPart = sptGetAllForPart();
        const filtered = sptApplyDateFilter(allForPart);
        const yearly = sptComputeYearly(filtered);
        const monthly = sptComputeMonthly(filtered);
        updateSptSubtitle(filtered);
        renderSptKpis(filtered);
        renderSptInsights(allForPart, yearly);
        renderSptYearlyChart(yearly);
        renderSptMonthlyChart(monthly);
        renderSptYearlyTable(yearly);
        renderSptMonthlyTable(monthly);
        if (sptState.txnExpanded) renderSptTransactions(filtered);
    }

    // Bind all SPT controls — called once after ayData is loaded.
    function bindSptControls() {
        document.getElementById("spt-date-mode")?.addEventListener("change", (e) => {
            sptState.dateMode = e.target.value;
            updateSptDateControls();
            renderSptSection();
        });
        document.getElementById("spt-month-select")?.addEventListener("change", (e) => {
            sptState.selectedMonth = e.target.value || null;
            renderSptSection();
        });
        document.getElementById("spt-start-date")?.addEventListener("change", (e) => {
            sptState.startDate = e.target.value || null;
            renderSptSection();
        });
        document.getElementById("spt-end-date")?.addEventListener("change", (e) => {
            sptState.endDate = e.target.value || null;
            renderSptSection();
        });
        document.getElementById("spt-metric")?.addEventListener("change", (e) => {
            sptState.metric = e.target.value;
            renderSptSection();
        });
        document.getElementById("spt-toggle-txn")?.addEventListener("click", () => {
            sptState.txnExpanded = !sptState.txnExpanded;
            const panel = document.getElementById("spt-txn-panel");
            const btn = document.getElementById("spt-toggle-txn");
            if (panel) panel.classList.toggle("hidden", !sptState.txnExpanded);
            if (btn) btn.textContent = sptState.txnExpanded ? "Collapse ▲" : "Expand ▼";
            if (sptState.txnExpanded) {
                const allForPart = sptGetAllForPart();
                renderSptTransactions(sptApplyDateFilter(allForPart));
            }
        });
    }

    // Initialise the SPT section — called once after ayData is populated.
    function initSptSection() {
        if (!ayData?.transactions?.length) return;
        // Pre-select the default (highest consumption in latest year).
        if (!sptState.selectedKey) {
            sptState.selectedKey = sptDefaultPartKey();
        }
        // Default year selection: all available years checked.
        if (!sptState.selectedYears.length) {
            sptState.selectedYears = (ayData.years || []).map((y) => String(y));
        }
        populateSptPartSelector();
        populateSptYearChecks();
        updateSptDateControls();
        bindSptControls();
        renderSptSection();
    }

    // Tab switching for the combined AY / SPT card
    document.querySelectorAll(".ay-tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => setAyTab(btn.dataset.aytab));
    });

    // Re-render SPT charts/tables when currency changes (called alongside other re-renders).
    // (currency change listener already calls renderAllYearsComparison — we hook in via initSptSection guard)
    document.getElementById("spare-currency-global")?.addEventListener("change", () => {
        if (ayData?.transactions?.length) renderSptSection();
    });

    // ── End SPT ──────────────────────────────────────────────────────────────
});
