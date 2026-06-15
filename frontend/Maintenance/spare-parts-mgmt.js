/*
 * Spare Parts Management page controller.
 *
 * This file owns the page-level header, source filters, and section tabs.
 * Existing dashboard modules remain the source of truth for their own tables,
 * charts, and calculations; the controller simply makes the page easier to scan.
 */
(function () {
    "use strict";

    const API = "/api/spare-parts";
    const TAB_KEYS = [
        "overview",
        "grgi",
        "supplier",
        "classification",
        "catalogue",
        "usage",
        "trends",
        "intelligence",
        "data_quality",
    ];
    const TABS = [
        ["overview", "Overview"],
        ["grgi", "GR vs GI"],
        ["supplier", "Supplier & Vendor Performance"],
        ["classification", "Gen PO Classification"],
        ["catalogue", "Spare Parts Catalogue"],
        ["usage", "Usage by Asset"],
        ["trends", "YOY / Part Trends"],
        ["intelligence", "Asset Parts Intelligence"],
        ["data_quality", "Data Quality"],
    ];
    const LEGACY_SELECTORS = [
        ".spare-import-card",
        ".spare-overview-shell",
        "#asset-parts-intelligence-card",
        ".spare-view-selector",
        '[data-spare-panel-content="external"]',
        '[data-spare-panel-content="inventory"]',
        '[data-spare-panel-content="comparison"]',
        ".pt-header-card",
        ".pt-kpi-grid",
        ".pt-chart-grid",
        "#epo-section",
        ".pt-transactions-card",
        ".spare-table-grid",
        "#ay-combined-section",
    ];

    const state = { stage: "all", category: "all", year: "all", month: "all", tab: "overview" };
    const refs = {};
    let cache = emptyCache();
    let charts = {};
    let mounted = false;

    function emptyCache() {
        return { overview: null, received: null, issued: null, analysis: null, importStatus: null };
    }

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }

    function esc(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function money(value) {
        if (value == null || Number.isNaN(Number(value))) return "--";
        return "THB " + Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    function num(value) {
        if (value == null || Number.isNaN(Number(value))) return "--";
        return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    function pct(value) {
        return value == null || Number.isNaN(Number(value)) ? "--" : Number(value).toFixed(1) + "%";
    }

    function days(value) {
        return value == null || Number.isNaN(Number(value)) ? "--" : Number(value).toFixed(1) + " d";
    }

    function qs() {
        const params = new URLSearchParams();
        if (state.stage !== "all") params.set("stage", state.stage);
        if (state.category !== "all") params.set("equipmentCategory", state.category);
        if (state.year !== "all") params.set("year", state.year);
        if (state.month !== "all") params.set("month", state.month);
        return params.toString() ? "?" + params.toString() : "";
    }

    async function fetchJson(url, options) {
        const response = await fetch(url, Object.assign({ cache: "no-store" }, options || {}));
        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }
        if (!response.ok) {
            throw new Error((payload && payload.message) || `${response.status} ${response.statusText}`);
        }
        return payload;
    }

    function renderShell(root) {
        root.innerHTML = "";

        const card = el("section", "card-shell spm-card");
        const head = el("div", "section-head spm-head");
        const titleWrap = el("div", "spm-title-wrap");
        titleWrap.append(el("h2", null, "Spare Parts Management"));
        titleWrap.append(
            el(
                "p",
                "section-subtitle",
                "Goods Received (PO/GRN), Goods Issued / Consumption, Supplier Performance, Spare Parts Classification, and Asset Usage Intelligence."
            )
        );
        head.append(titleWrap, buildFilters());

        const actions = el("div", "spm-actions");
        const importToggle = el("button", "toggle-btn spm-import-toggle", "Manage Imports");
        importToggle.type = "button";
        importToggle.addEventListener("click", () => {
            const panel = document.getElementById("spm-import-panel");
            if (!panel) return;
            panel.classList.toggle("hidden");
            importToggle.classList.toggle("active", !panel.classList.contains("hidden"));
            if (!panel.classList.contains("hidden")) refreshImportPanel(cache.importStatus);
        });
        actions.append(importToggle);

        card.append(head, actions, buildTabs(), buildStatusLine(), buildImportPanel());
        root.append(card);

        const dynamic = el("div", "spm-dynamic-root");
        dynamic.id = "spm-dynamic-root";
        root.append(dynamic);
    }

    function buildFilters() {
        const wrap = el("div", "filter-grid spm-filters");

        function makeField(label, options, value, onChange) {
            const field = el("label", "control-field");
            field.append(el("span", null, label));
            const select = el("select");
            options.forEach(([optionValue, optionLabel]) => {
                const option = el("option", null, optionLabel);
                option.value = optionValue;
                option.selected = optionValue === value;
                select.append(option);
            });
            select.addEventListener("change", () => {
                onChange(select.value);
                syncLegacyDateFilters();
                void load();
            });
            field.append(select);
            return { field, select };
        }

        wrap.append(
            makeField(
                "Stage",
                [["all", "All Stages"], ["Stage 1", "Stage 1"], ["Stage 2", "Stage 2"]],
                state.stage,
                (value) => {
                    state.stage = value;
                }
            ).field
        );
        wrap.append(
            makeField(
                "Category",
                [
                    ["all", "All"],
                    ["Production Equipment", "Production Equipment"],
                    ["Utilities", "Utilities"],
                    ["Unclassified", "Unclassified"],
                ],
                state.category,
                (value) => {
                    state.category = value;
                }
            ).field
        );

        const yearField = makeField("Year", [["all", "All"]], state.year, (value) => {
            state.year = value;
        });
        refs.yearSel = yearField.select;
        wrap.append(yearField.field);

        const monthField = makeField("Month", [["all", "All"]], state.month, (value) => {
            state.month = value;
        });
        refs.monthSel = monthField.select;
        wrap.append(monthField.field);
        return wrap;
    }

    function buildTabs() {
        const tabs = el("div", "spm-tabs");
        tabs.setAttribute("role", "tablist");
        TABS.forEach(([key, label]) => {
            const button = el("button", "spm-tab" + (state.tab === key ? " active" : ""), label);
            button.type = "button";
            button.dataset.spmTab = key;
            button.setAttribute("role", "tab");
            button.setAttribute("aria-selected", state.tab === key ? "true" : "false");
            button.addEventListener("click", () => setActiveTab(key));
            tabs.append(button);
        });
        return tabs;
    }

    function buildStatusLine() {
        const line = el(
            "p",
            "spm-status",
            "Sources: Gen PO Stage 1 & Stage 2 for PO/GRN. Project Actual Transactions for Goods Issued / Consumption."
        );
        line.id = "spm-status";
        return line;
    }

    function buildImportPanel() {
        const panel = el("div", "spm-import-panel hidden");
        panel.id = "spm-import-panel";
        panel.append(
            el(
                "p",
                "spm-import-intro",
                "Import each source into its slot. Gen PO Stage 1 & 2 feed Goods Received (PO/GRN); Project Actual Transactions feeds Goods Issued / Consumption; Inventory feeds stock levels. Both Gen PO stages combine under “All Stages”."
            )
        );

        const grid = el("div", "spm-import-slots");
        grid.append(buildImportSlot("Stage 1", "Stage 1 Gen PO", "Import Stage 1 Gen PO", `${API}/import-stage-1-gen-po`));
        grid.append(buildImportSlot("Stage 2", "Stage 2 Gen PO", "Import Stage 2 Gen PO", `${API}/import-stage-2-gen-po`));
        grid.append(buildImportSlot("Consumption", "Project Actual Transactions", "Import Consumption", `${API}/import-consumption`));
        grid.append(buildImportSlot("Inventory", "Inventory / Stock", "Import Inventory", `${API}/import-inventory`));
        panel.append(grid);

        const consumption = el("div", "spm-import-consumption");
        consumption.id = "spm-consumption-status";
        consumption.textContent = "Goods Issued source: Project Actual Transactions.";
        panel.append(consumption);
        return panel;
    }

    function buildImportSlot(key, title, label, url) {
        const slot = el("div", "spm-import-slot");
        slot.dataset.stage = key;

        const head = el("div", "spm-import-slot-head");
        head.append(el("strong", null, title));
        const badge = el("span", "spm-import-badge off", "Not uploaded");
        badge.dataset.role = "badge";
        head.append(badge);
        slot.append(head);

        const meta = el("div", "spm-import-meta", "Checking status...");
        meta.dataset.role = "meta";
        slot.append(meta);

        const file = el("input", "spm-import-file");
        file.type = "file";
        file.accept = ".xlsx,.xls,.csv";
        file.dataset.role = "file";
        slot.append(file);

        const button = el("button", "toggle-btn spm-import-go", label);
        button.type = "button";
        button.addEventListener("click", () => {
            void doImport(url, slot);
        });
        slot.append(button);

        const warn = el("div", "spm-import-warn hidden");
        warn.dataset.role = "warn";
        slot.append(warn);
        return slot;
    }

    function setWarn(node, text, tone) {
        if (!node) return;
        node.textContent = text || "";
        node.className = "spm-import-warn" + (tone ? " " + tone : "") + (text ? "" : " hidden");
    }

    async function doImport(url, slot) {
        const file = slot.querySelector('[data-role="file"]');
        const warn = slot.querySelector('[data-role="warn"]');
        const button = slot.querySelector(".spm-import-go");
        if (!file || !file.files || !file.files.length) {
            setWarn(warn, "Choose an Excel file first.", "err");
            return;
        }

        const formData = new FormData();
        formData.append("file", file.files[0]);
        setWarn(warn, "Importing...", "");
        if (button) button.disabled = true;

        try {
            const result = await fetchJson(url, { method: "POST", body: formData });
            setWarn(warn, result.message || "Imported.", result.ok ? "ok" : "err");
            if (result.ok) {
                file.value = "";
                cache = emptyCache();
                await load();
            }
        } catch (error) {
            setWarn(warn, "Import error: " + error.message, "err");
        } finally {
            if (button) button.disabled = false;
        }
    }

    function refreshImportPanel(payload) {
        const importStatus = payload || {};
        ["Stage 1", "Stage 2"].forEach((stage) => {
            const slot = document.querySelector(`.spm-import-slot[data-stage="${stage}"]`);
            if (!slot) return;

            const status = importStatus[stage] || {};
            const badge = slot.querySelector('[data-role="badge"]');
            const meta = slot.querySelector('[data-role="meta"]');
            const warn = slot.querySelector('[data-role="warn"]');

            if (badge) {
                badge.textContent = status.uploaded ? "Uploaded" : "Not uploaded";
                badge.className = "spm-import-badge " + (status.uploaded ? "ok" : "off");
            }

            if (meta) {
                const bits = [];
                if (status.file_name) bits.push(status.file_name);
                if (status.row_count != null) bits.push(num(status.row_count) + " rows");
                if (status.imported_at) bits.push("imported " + String(status.imported_at).slice(0, 16).replace("T", " "));
                else if (status.source === "auto-discovered") bits.push("auto-discovered in data/");
                meta.innerHTML = bits.length ? bits.map(esc).join(" | ") : "No file yet - import to enable this stage.";
            }

            if ((status.missing_required || []).length) {
                setWarn(warn, "Missing required column(s): " + status.missing_required.join(", "), "err");
            } else if ((status.missing_recommended || []).length) {
                setWarn(warn, "Optional column(s) not found: " + status.missing_recommended.join(", "), "note");
            } else if ((status.issues || []).length) {
                setWarn(warn, status.issues[0], "note");
            } else {
                setWarn(warn, "", "");
            }
        });

        // Consumption + Inventory slots map to their own status keys.
        [["Consumption", importStatus["Goods Issued"] || {}], ["Inventory", importStatus["Inventory"] || {}]].forEach(([key, status]) => {
            const slot = document.querySelector(`.spm-import-slot[data-stage="${key}"]`);
            if (!slot) return;
            const badge = slot.querySelector('[data-role="badge"]');
            const meta = slot.querySelector('[data-role="meta"]');
            if (badge) {
                badge.textContent = status.uploaded ? "Uploaded" : "Not uploaded";
                badge.className = "spm-import-badge " + (status.uploaded ? "ok" : "off");
            }
            if (meta) {
                const bits = [];
                if (status.file_name) bits.push(status.file_name);
                if (status.transaction_count != null) bits.push(num(status.transaction_count) + " transactions");
                if (status.row_count != null) bits.push(num(status.row_count) + " rows");
                meta.innerHTML = bits.length ? bits.map(esc).join(" | ") : "No file yet - import to enable.";
            }
        });

        const consumption = document.getElementById("spm-consumption-status");
        if (consumption) {
            const issued = importStatus["Goods Issued"] || {};
            consumption.innerHTML = `<strong>Goods Issued / Consumption</strong> - source: Project Actual Transactions | ${
                issued.uploaded ? esc(num(issued.transaction_count) + " transactions loaded") : "not loaded"
            }.`;
        }
    }

    async function load() {
        const dynamic = document.getElementById("spm-dynamic-root");
        if (dynamic && !cache.overview) dynamic.innerHTML = '<div class="spm-skeleton"></div>';

        try {
            const query = qs();
            const [overview, received, issued, analysis, importStatus] = await Promise.all([
                fetchJson(`${API}/overview${query}`),
                fetchJson(`${API}/goods-received${query}`),
                fetchJson(`${API}/goods-issued${query}`),
                fetchJson(`${API}/item-vendor-analysis${query}`),
                fetchJson(`${API}/import-status`),
            ]);
            cache = { overview, received, issued, analysis, importStatus };
            populateDateFilters(received, issued);
            renderStatus(overview, importStatus);
            refreshImportPanel(importStatus);
            renderDynamicPanel();
            applyTabVisibility();
        } catch (error) {
            if (dynamic) {
                dynamic.innerHTML = `<p class="spm-muted">Could not load spare-parts data (${esc(error.message)}). Make sure the backend is running.</p>`;
            }
        }
    }

    function populateDateFilters(received, issued) {
        const months = new Set();
        const addMonths = (rows) => (rows || []).forEach((row) => {
            if (row && row.month) months.add(String(row.month));
        });
        addMonths(received && received.monthly_po_value);
        addMonths(received && received.monthly_received_value);
        addMonths(issued && issued.monthly_issued_value);

        const yearOptions = Array.from(new Set(Array.from(months).map((month) => month.slice(0, 4)).filter(Boolean))).sort().reverse();
        const monthOptions = Array.from(months).filter(Boolean).sort().reverse();
        if (state.year !== "all" && !yearOptions.includes(state.year)) yearOptions.unshift(state.year);
        if (state.month !== "all" && !monthOptions.includes(state.month)) monthOptions.unshift(state.month);
        updateSelect(refs.yearSel, [["all", "All"]].concat(yearOptions.map((year) => [year, year])), state.year);
        updateSelect(refs.monthSel, [["all", "All"]].concat(monthOptions.map((month) => [month, monthLabel(month)])), state.month);
    }

    function updateSelect(select, options, value) {
        if (!select) return;
        select.innerHTML = "";
        options.forEach(([optionValue, label]) => {
            const option = el("option", null, label);
            option.value = optionValue;
            option.selected = optionValue === value;
            select.append(option);
        });
    }

    function monthLabel(month) {
        const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
        if (!match) return month;
        const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
        return date.toLocaleString(undefined, { month: "short", year: "numeric" });
    }

    function syncLegacyDateFilters() {
        syncLegacySelect("spare-year-filter", state.year);
        syncLegacySelect("spare-month-filter", state.month);
    }

    function syncLegacySelect(id, value) {
        const select = document.getElementById(id);
        if (!select) return;
        const options = Array.from(select.options || []);
        if (!options.some((option) => option.value === value)) return;
        if (select.value === value) return;
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function renderStatus(overview, importStatus) {
        const status = document.getElementById("spm-status");
        if (!status) return;
        const receivedStatus = (overview && overview.goods_received_status) || {};
        const issuedStatus = (importStatus && importStatus["Goods Issued"]) || {};
        const quality = (overview && overview.data_quality) || {};
        const s1 = receivedStatus["Stage 1"] || {};
        const s2 = receivedStatus["Stage 2"] || {};
        status.innerHTML =
            `Sources: Gen PO Stage 1 & Stage 2 for PO/GRN. Project Actual Transactions for Goods Issued / Consumption. ` +
            `<span class="spm-status-muted">Stage 1: ${esc(s1.file_name || "not loaded")} | Stage 2: ${esc(s2.file_name || "not loaded")} | Consumption: ${
                issuedStatus.uploaded ? esc(num(issuedStatus.transaction_count) + " rows") : "not loaded"
            } | Data quality: ${num(quality.missing_grn_number)} missing GRN, ${num(quality.rows_without_asset)} issued rows without mapped asset.</span>`;
    }

    function setActiveTab(tab) {
        if (!TAB_KEYS.includes(tab)) tab = "overview";
        state.tab = tab;
        document.querySelectorAll(".spm-tab").forEach((button) => {
            const active = button.dataset.spmTab === tab;
            button.classList.toggle("active", active);
            button.setAttribute("aria-selected", active ? "true" : "false");
        });
        renderDynamicPanel();
        applyTabVisibility();
    }

    function managedElements() {
        return LEGACY_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    }

    function hideAllManaged() {
        managedElements().forEach((node) => {
            node.dataset.sparePageHidden = "true";
        });
    }

    function showSelector(selector) {
        document.querySelectorAll(selector).forEach((node) => {
            delete node.dataset.sparePageHidden;
        });
    }

    function hideSelector(selector) {
        document.querySelectorAll(selector).forEach((node) => {
            node.dataset.sparePageHidden = "true";
        });
    }

    function showLegacyPanel(panelName) {
        document.querySelectorAll("[data-spare-panel]").forEach((button) => {
            button.classList.toggle("is-active", button.dataset.sparePanel === panelName);
        });
        document.querySelectorAll("[data-spare-panel-content]").forEach((panel) => {
            panel.classList.toggle("is-active", panel.dataset.sparePanelContent === panelName);
        });
    }

    function applyCatalogueChildVisibility(mode) {
        const grid = document.querySelector(".spare-table-grid");
        const catalogue = document.querySelector(".pt-parts-combined-card");
        const insights = document.querySelector(".pt-insights-card");
        if (!grid) return;
        if (mode === "catalogue") {
            delete grid.dataset.sparePageHidden;
            if (catalogue) catalogue.style.display = "";
            if (insights) insights.style.display = "none";
        } else if (mode === "usage") {
            delete grid.dataset.sparePageHidden;
            if (catalogue) catalogue.style.display = "none";
            if (insights) insights.style.display = "";
        } else {
            if (catalogue) catalogue.style.display = "";
            if (insights) insights.style.display = "";
        }
    }

    function applyTabVisibility() {
        hideAllManaged();
        hideSelector(".spare-view-selector");
        hideSelector('[data-spare-panel-content="comparison"]');
        hideSelector('[data-spare-panel-content="inventory"]');
        hideSelector('[data-spare-panel-content="external"]');
        applyCatalogueChildVisibility("none");

        if (state.tab === "overview") {
            showSelector(".spare-overview-shell");
        } else if (state.tab === "supplier") {
            showSelector("#epo-section");
        } else if (state.tab === "classification") {
            showLegacyPanel("external");
            showSelector('[data-spare-panel-content="external"]');
        } else if (state.tab === "catalogue") {
            showSelector(".spare-table-grid");
            applyCatalogueChildVisibility("catalogue");
        } else if (state.tab === "usage") {
            showSelector(".pt-header-card");
            showSelector(".pt-kpi-grid");
            showSelector(".pt-chart-grid");
            showSelector(".pt-transactions-card");
            showSelector(".spare-table-grid");
            applyCatalogueChildVisibility("usage");
        } else if (state.tab === "trends") {
            showSelector("#ay-combined-section");
        } else if (state.tab === "intelligence") {
            showSelector("#asset-parts-intelligence-card");
        } else if (state.tab === "data_quality") {
            showSelector(".spare-import-card");
        }

        window.setTimeout(() => {
            window.dispatchEvent(new Event("resize"));
            if (state.tab === "supplier") document.querySelector(".epo-tab-btn.active")?.dispatchEvent(new Event("click", { bubbles: true }));
        }, 80);
    }

    function renderDynamicPanel() {
        const root = document.getElementById("spm-dynamic-root");
        if (!root) return;
        destroyCharts();
        root.innerHTML = "";

        if (state.tab === "overview") root.append(renderOverviewSummary());
        else if (state.tab === "grgi") root.append(renderGrGiPanel());
        else if (state.tab === "data_quality") root.append(renderDataQualityPanel());
    }

    function kpiGrid(items, compact) {
        const grid = el("div", "summary-grid spm-kpi-grid" + (compact ? " spm-kpi-grid-compact" : ""));
        items.forEach(([label, value, tone]) => {
            const card = el("article", "summary-card summary-card-kpi spm-kpi" + (tone ? " spm-kpi-" + tone : ""));
            card.append(el("span", "summary-label", label), el("strong", null, value));
            grid.append(card);
        });
        return grid;
    }

    function renderOverviewSummary() {
        const panel = el("section", "card-shell spm-compact-panel");
        const received = (cache.overview && cache.overview.goods_received_kpis) || {};
        const issued = (cache.overview && cache.overview.goods_issued_kpis) || {};
        const head = el("div", "section-head spm-panel-head");
        const copy = el("div");
        copy.append(el("h2", null, "GR / GI Snapshot"));
        copy.append(el("p", "section-subtitle", "Compact receiving and consumption context for the overview below."));
        head.append(copy);
        panel.append(head);
        panel.append(
            kpiGrid(
                [
                    ["Goods Received / GRN", money(received.received_value), "green"],
                    ["Pending GRN", money(received.pending_value), "amber"],
                    ["Goods Issued / Consumption", money(issued.total_issued_value), "blue"],
                    ["Top Consumed Part", issued.top_consumed_part || "--"],
                ],
                true
            )
        );
        return panel;
    }

    function renderGrGiPanel() {
        const panel = el("section", "card-shell spm-analysis-panel");
        const received = cache.received || {};
        const issued = cache.issued || {};
        const gr = received.kpis || {};
        const gi = issued.kpis || {};

        const head = el("div", "section-head spm-panel-head");
        const copy = el("div");
        copy.append(el("h2", null, "Goods Received vs Goods Issued"));
        copy.append(el("p", "section-subtitle", "Goods Received is based on PO/GRN records. Goods Issued / Consumption is based on Project Actual Transactions."));
        head.append(copy);
        panel.append(head);

        panel.append(
            kpiGrid(
                [
                    ["Goods Received / GRN", money(gr.received_value), "green"],
                    ["Pending GRN", money(gr.pending_value), "amber"],
                    ["Goods Issued / Consumption", money(gi.total_issued_value), "blue"],
                    ["Issue Transactions", num(gi.issue_transactions)],
                    ["Internal Non_Bill Value", money(gi.internal_non_billable_value), "amber"],
                ],
                true
            )
        );
        panel.append(
            el(
                "p",
                "spm-data-note",
                "Non_Bill marks internal or non-billable usage classification. It does not define Goods Issued by itself."
            )
        );

        const grid = el("div", "spm-chart-grid");
        grid.append(chartCard("Monthly GR vs GI Trend", "spm-grgi-trend"));
        grid.append(barCard("Top Purchased Items", topPurchasedItems(received.rows), money));
        grid.append(barCard("Top Consumed Items", issued.top_items_by_value, money));
        grid.append(barCard("Consumption by Category", issued.consumption_by_category, money));
        panel.append(grid);

        window.setTimeout(() => drawGrGiTrend(received, issued), 30);
        return panel;
    }

    function renderDataQualityPanel() {
        const panel = el("section", "card-shell spm-analysis-panel");
        const overview = cache.overview || {};
        const quality = overview.data_quality || {};
        const analysis = cache.analysis || {};
        const manualRows = analysis.high_purchase_low_issue || [];

        const head = el("div", "section-head spm-panel-head");
        const copy = el("div");
        copy.append(el("h2", null, "Data Quality"));
        copy.append(el("p", "section-subtitle", "Missing fields, mapping gaps, and source availability are kept here so management views stay concise."));
        head.append(copy);
        panel.append(head);

        panel.append(
            kpiGrid(
                [
                    ["Missing GRN No.", num(quality.missing_grn_number), "amber"],
                    ["Missing PO Date", num(quality.missing_date), "amber"],
                    ["Missing KPI Status", num(quality.missing_kpi_status), "amber"],
                    ["Rows Without Qty", num(quality.rows_without_qty), "amber"],
                    ["Rows Without Asset", num(quality.rows_without_asset), "amber"],
                    ["Rows Without Value", num(quality.rows_without_total), "amber"],
                    ["Unclassified PO Rows", num(quality.unclassified_count), "amber"],
                    ["Unclassified Issued Rows", num(quality.unclassified_asset_count), "amber"],
                ],
                true
            )
        );

        panel.append(importStatusList());
        panel.append(
            tableSection(
                "High Purchase / Low Issue Review",
                manualRows,
                [
                    ["Item", "item"],
                    ["Purchased Value", "purchased_value", "money"],
                    ["Issued Value", "issued_value", "money"],
                ],
                "No high purchase / low issue signals at the current filters."
            )
        );
        return panel;
    }

    function importStatusList() {
        const section = el("div", "spm-source-grid");
        const status = cache.importStatus || {};
        ["Stage 1", "Stage 2", "Goods Issued"].forEach((key) => {
            const item = status[key] || {};
            const card = el("article", "spm-source-card " + (item.uploaded ? "ok" : "off"));
            card.append(el("strong", null, key));
            card.append(el("span", null, item.uploaded ? (item.file_name || `${num(item.transaction_count)} transactions`) : "Not loaded"));
            if ((item.missing_required || []).length) {
                card.append(el("small", null, "Missing: " + item.missing_required.join(", ")));
            }
            section.append(card);
        });
        return section;
    }

    function topPurchasedItems(rows) {
        const grouped = new Map();
        (rows || []).forEach((row) => {
            const label = row.description || row.item_number || "Unmatched";
            grouped.set(label, (grouped.get(label) || 0) + (Number(row.total_price) || 0));
        });
        return Array.from(grouped.entries())
            .map(([label, value]) => ({ label, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);
    }

    function chartCard(title, canvasId) {
        const card = el("div", "spm-chart-card");
        card.append(el("div", "spm-chart-title", title));
        const wrap = el("div", "spm-chart-canvas-wrap");
        const canvas = el("canvas");
        canvas.id = canvasId;
        wrap.append(canvas);
        card.append(wrap);
        return card;
    }

    function barCard(title, items, formatter) {
        const card = el("div", "spm-chart-card");
        card.append(el("div", "spm-chart-title", title));
        const list = el("div", "spm-barlist");
        const rows = Array.isArray(items) ? items.filter((item) => item && item.value != null) : [];
        const max = rows.reduce((memo, item) => Math.max(memo, Math.abs(Number(item.value) || 0)), 0) || 1;

        if (!rows.length) {
            list.append(el("p", "spm-muted", "No data."));
        } else {
            rows.slice(0, 10).forEach((item) => {
                const row = el("div", "spm-bar-row");
                row.append(el("span", "spm-bar-label", item.label || "--"));
                const track = el("div", "spm-bar-track");
                const fill = el("div", "spm-bar-fill");
                fill.style.width = Math.max(2, (Math.abs(Number(item.value) || 0) / max) * 100) + "%";
                track.append(fill);
                row.append(track, el("span", "spm-bar-val", formatter(item.value)));
                list.append(row);
            });
        }

        card.append(list);
        return card;
    }

    function tableSection(title, rows, cols, emptyText) {
        const safeRows = Array.isArray(rows) ? rows : [];
        const section = el("div", "spm-table-section");
        section.append(el("h3", "spm-subtitle", `${title} (${num(safeRows.length)} rows)`));
        const wrap = el("div", "table-wrapper spm-table-wrap");
        if (!safeRows.length) {
            wrap.append(el("p", "spm-muted spm-table-empty", emptyText || "No data."));
            section.append(wrap);
            return section;
        }
        wrap.innerHTML =
            `<table class="spm-table"><thead><tr>${cols.map((col) => `<th>${esc(col[0])}</th>`).join("")}</tr></thead><tbody>` +
            safeRows
                .slice(0, 100)
                .map((row) => `<tr>${cols.map((col) => `<td>${esc(cellVal(row[col[1]], col[2]))}</td>`).join("")}</tr>`)
                .join("") +
            "</tbody></table>";
        section.append(wrap);
        return section;
    }

    function cellVal(value, type) {
        if (value == null || value === "") return "--";
        if (type === "money") return money(value);
        if (type === "num") return num(value);
        return value;
    }

    function destroyCharts() {
        Object.values(charts).forEach((chart) => {
            try {
                chart.destroy();
            } catch (error) {}
        });
        charts = {};
    }

    function monthlyMap(rows) {
        return Object.fromEntries((rows || []).map((row) => [row.month, Number(row.value) || 0]));
    }

    function drawGrGiTrend(received, issued) {
        const canvas = document.getElementById("spm-grgi-trend");
        if (!canvas || typeof Chart === "undefined") return;
        const grn = received.monthly_received_value || [];
        const pending = received.monthly_pending_value || [];
        const gi = issued.monthly_issued_value || [];
        const months = Array.from(new Set([].concat(grn, pending, gi).map((row) => row.month).filter(Boolean))).sort();
        const grnMap = monthlyMap(grn);
        const pendingMap = monthlyMap(pending);
        const giMap = monthlyMap(gi);
        charts.grgi = new Chart(canvas.getContext("2d"), {
            type: "bar",
            data: {
                labels: months,
                datasets: [
                    { label: "Received / GRN", data: months.map((month) => grnMap[month] || 0), backgroundColor: "#10b981", borderRadius: 4, maxBarThickness: 18 },
                    { label: "Pending GRN", data: months.map((month) => pendingMap[month] || 0), backgroundColor: "#f59e0b", borderRadius: 4, maxBarThickness: 18 },
                    { label: "Goods Issued", data: months.map((month) => giMap[month] || 0), backgroundColor: "#3b82f6", borderRadius: 4, maxBarThickness: 18 },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } },
                scales: {
                    x: { grid: { display: false } },
                    y: {
                        beginAtZero: true,
                        ticks: { callback: (value) => "THB " + (Number(value) / 1e6).toFixed(1) + "M" },
                    },
                },
            },
        });
    }

    window.renderSpareMgmt = function () {
        const root = document.getElementById("spare-mgmt-root");
        if (!root) return;
        if (!mounted) {
            renderShell(root);
            mounted = true;
            applyTabVisibility();
            void load();
        } else {
            applyTabVisibility();
        }
    };

    function maybeRender() {
        const view = document.getElementById("spare-parts-view");
        if (view && !view.classList.contains("hidden")) window.renderSpareMgmt();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", maybeRender);
    else maybeRender();

    document.addEventListener("click", (event) => {
        if (event.target.closest('[data-view-tab="spare_parts"]')) {
            setTimeout(maybeRender, 60);
        }
    });
})();
