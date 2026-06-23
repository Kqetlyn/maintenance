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

    const FINANCIAL_VIEWS = [
        ["engineering_opex", "Engineering OPEX"],
        ["engineering_capex", "Engineering CAPEX"],
        ["all_engineering_po", "All Engineering PO"],
        ["procurement_reference", "Procurement Reference / All Indirect PO"],
    ];
    const state = {
        stage: "all",
        category: "all",
        financialView: "engineering_opex",
        year: String(new Date().getFullYear()),
        month: "all",
        tab: "overview",
    };
    const refs = {};
    let cache = emptyCache();
    let charts = {};
    let mounted = false;
    let grgiTrendView = "monthly"; // "monthly" | "fy"

    function emptyCache() {
        return { overview: null, received: null, issued: null, analysis: null, importStatus: null, procurement: null };
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

    function financialViewLabel(view) {
        const match = FINANCIAL_VIEWS.find(([value]) => value === (view || state.financialView));
        return match ? match[1] : "Engineering OPEX";
    }

    function engineeringSpendLabel() {
        if (state.financialView === "engineering_opex") return "Engineering Operational Spend excluding CAPEX";
        if (state.financialView === "engineering_capex") return "Engineering CAPEX / Project Spend";
        return "Engineering PO YTD";
    }

    function financialScope() {
        return (cache.overview && cache.overview.financial_scope)
            || (cache.received && cache.received.financial_scope)
            || {
                label: financialViewLabel(),
                engineering_source_note: "Source: Engineering PO files",
                procurement_source_note: "Source: Indirect PO procurement file",
                consumption_source_note: "Source: Project Actual Transactions",
            };
    }

    function days(value) {
        return value == null || Number.isNaN(Number(value)) ? "--" : Number(value).toFixed(1) + " d";
    }

    function qs() {
        const params = new URLSearchParams();
        if (state.stage !== "all") params.set("stage", state.stage);
        if (state.category !== "all") params.set("equipmentCategory", state.category);
        if (state.financialView) params.set("financialView", state.financialView);
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

    function invalidateDataCaches() {
        const importStatus = cache.importStatus;
        cache = emptyCache();
        cache.importStatus = importStatus;
    }

    function requiredResourcesForTab(tab) {
        if (tab === "overview") return ["overview", "importStatus"];
        if (tab === "grgi") return ["overview", "received", "issued", "importStatus"];
        if (tab === "supplier") return ["procurement", "importStatus"];
        if (tab === "data_quality") return ["overview", "analysis", "importStatus"];
        return ["importStatus"];
    }

    function hasTabData(tab) {
        return requiredResourcesForTab(tab).every((key) => cache[key] != null);
    }

    function resourceUrl(key, query) {
        if (key === "overview") return `${API}/overview${query}`;
        if (key === "received") return `${API}/goods-received${query}`;
        if (key === "issued") return `${API}/goods-issued${query}`;
        if (key === "analysis") return `${API}/item-vendor-analysis${query}`;
        if (key === "procurement") return `${API}/procurement-reconciliation${query}`;
        if (key === "importStatus") return `${API}/import-status`;
        return null;
    }

    async function refreshImportStatusOnly() {
        cache.importStatus = await fetchJson(`${API}/import-status`);
        renderStatus(cache.overview, cache.importStatus);
        refreshImportPanel(cache.importStatus);
        return cache.importStatus;
    }

    function sourceLoadedLabel(status, countLabel) {
        if (!status || !status.uploaded) return "not loaded";
        if (status.transaction_count != null) return `${num(status.transaction_count)} ${countLabel}`;
        if (status.row_count != null) return `${num(status.row_count)} rows`;
        if (status.file_name) return status.file_name;
        return "loaded";
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
            if (!panel.classList.contains("hidden")) {
                if (cache.importStatus) refreshImportPanel(cache.importStatus);
                else void refreshImportStatusOnly();
            }
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
                invalidateDataCaches();
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
        wrap.append(
            makeField("Financial View", FINANCIAL_VIEWS, state.financialView, (value) => {
                state.financialView = value;
            }).field
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
        grid.append(buildImportSlot("Indirect PO", "Indirect PO (Official Procurement)", "Import Indirect PO", `${API}/import-indirect-po`));
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
                await refreshImportStatusOnly();
                invalidateDataCaches();
                void load({ background: true });
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

        // Indirect PO slot
        const indSlot = document.querySelector('.spm-import-slot[data-stage="Indirect PO"]');
        if (indSlot) {
            const indStatus = importStatus["Indirect PO"] || {};
            const indBadge = indSlot.querySelector('[data-role="badge"]');
            const indMeta = indSlot.querySelector('[data-role="meta"]');
            if (indBadge) {
                indBadge.textContent = indStatus.uploaded ? "Uploaded" : "Not uploaded";
                indBadge.className = "spm-import-badge " + (indStatus.uploaded ? "ok" : "off");
            }
            if (indMeta) {
                const bits = [];
                if (indStatus.file_name) bits.push(indStatus.file_name);
                if (indStatus.row_count != null) bits.push(num(indStatus.row_count) + " lines");
                if (indStatus.imported_at) bits.push("imported " + String(indStatus.imported_at).slice(0, 16).replace("T", " "));
                else if (indStatus.source === "auto-discovered") bits.push("auto-discovered in data/");
                indMeta.innerHTML = bits.length ? bits.map(esc).join(" | ") : "No file yet — import to enable reconciliation.";
            }
        }

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
                if (status.imported_at) bits.push("imported " + String(status.imported_at).slice(0, 16).replace("T", " "));
                meta.innerHTML = bits.length ? bits.map(esc).join(" | ") : "No file yet - import to enable.";
            }
        });

        const consumption = document.getElementById("spm-consumption-status");
        if (consumption) {
            const issued = importStatus["Goods Issued"] || {};
            consumption.innerHTML = `<strong>Goods Issued / Consumption</strong> - source: Project Actual Transactions | ${
                issued.uploaded ? esc(sourceLoadedLabel(issued, "transactions")) : "not loaded"
            }.`;
        }
    }

    async function load(options) {
        const opts = options || {};
        const dynamic = document.getElementById("spm-dynamic-root");
        const needed = requiredResourcesForTab(state.tab);
        const missing = opts.force ? needed.slice() : needed.filter((key) => cache[key] == null);
        const needsHeavyData = missing.some((key) => key !== "importStatus");
        if (dynamic && needsHeavyData && !opts.background) dynamic.innerHTML = '<div class="spm-skeleton"></div>';

        try {
            const query = qs();
            const entries = await Promise.all(
                missing
                    .map((key) => {
                        const url = resourceUrl(key, query);
                        if (!url) return null;
                        const promise = key === "procurement" ? fetchJson(url).catch(() => null) : fetchJson(url);
                        return promise.then((value) => [key, value]);
                    })
                    .filter(Boolean)
            );
            entries.forEach(([key, value]) => {
                cache[key] = value;
            });
            if (cache.received || cache.issued) populateDateFilters(cache.received || {}, cache.issued || {});
            renderStatus(cache.overview, cache.importStatus);
            refreshImportPanel(cache.importStatus);
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

function renderStatus(overview, importStatus) {
        const status = document.getElementById("spm-status");
        if (!status) return;
        const receivedStatus = (overview && overview.goods_received_status) || {};
        const issuedStatus = (importStatus && importStatus["Goods Issued"]) || {};
        const inventoryStatus = (importStatus && importStatus["Inventory"]) || {};
        const quality = (overview && overview.data_quality) || {};
        const s1 = receivedStatus["Stage 1"] || {};
        const s2 = receivedStatus["Stage 2"] || {};
        const indirectStatus = (importStatus && importStatus["Indirect PO"]) || {};
        status.innerHTML =
            `Sources: Gen PO Stage 1 &amp; Stage 2 for PO/GRN. Indirect PO for official procurement reference. Project Actual Transactions for GI / Consumption. Inventory is the stock snapshot. ` +
            `<span class="spm-status-muted">Stage 1: ${esc(s1.file_name || "not loaded")} | Stage 2: ${esc(s2.file_name || "not loaded")} | Indirect PO: ${
                indirectStatus.uploaded ? esc(num(indirectStatus.row_count) + " lines") : "not loaded"
            } | Consumption: ${
                issuedStatus.uploaded ? esc(sourceLoadedLabel(issuedStatus, "rows")) : "not loaded"
            } | Inventory: ${inventoryStatus.uploaded ? esc(sourceLoadedLabel(inventoryStatus, "rows")) : "not loaded"} | Data quality: ${
                num(quality.missing_received_date)
            } missing GR dates, ${num(quality.rows_without_work_order)} GI rows without WO, ${num(quality.on_hand_missing_unit_cost_or_value)} on-hand rows without value.</span>`;
    }

    function setActiveTab(tab) {
        if (!TAB_KEYS.includes(tab)) tab = "overview";
        state.tab = tab;
        document.querySelectorAll(".spm-tab").forEach((button) => {
            const active = button.dataset.spmTab === tab;
            button.classList.toggle("active", active);
            button.setAttribute("aria-selected", active ? "true" : "false");
        });
        if (hasTabData(tab)) {
            renderDynamicPanel();
            applyTabVisibility();
            return;
        }
        void load();
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
        else if (state.tab === "supplier") root.append(renderSupplierProcurementPanel());
        else if (state.tab === "data_quality") root.append(renderDataQualityPanel());
    }

    function kpiGrid(items, compact) {
        const grid = el("div", "summary-grid spm-kpi-grid" + (compact ? " spm-kpi-grid-compact" : ""));
        items.forEach(([label, value, tone, sourceNote]) => {
            const card = el("article", "summary-card summary-card-kpi spm-kpi" + (tone ? " spm-kpi-" + tone : ""));
            card.append(el("span", "summary-label", label), el("strong", null, value));
            if (sourceNote) card.append(el("span", "spm-kpi-source", sourceNote));
            grid.append(card);
        });
        return grid;
    }

    function renderOverviewSummary() {
        const panel = el("section", "card-shell spm-compact-panel spm-ov-panel");
        const received = (cache.overview && cache.overview.goods_received_kpis) || {};
        const issued   = (cache.overview && cache.overview.goods_issued_kpis) || {};
        const inv      = (cache.overview && cache.overview.inventory_kpis) || {};
        const pocat    = (cache.overview && cache.overview.po_category_kpis) || {};
        const pk       = (cache.overview && cache.overview.procurement_kpis) || {};
        const dq       = (cache.overview && cache.overview.data_quality) || {};
        const scope    = financialScope();

        // ── Header ────────────────────────────────────────────────────────────
        const head = el("div", "section-head spm-panel-head");
        const copy = el("div");
        copy.append(el("h2", null, "Spare Parts Overview"));
        copy.append(el("p", "section-subtitle", "Engineering PO, GR/GI, current on-hand inventory, and procurement reference matching."));
        head.append(copy);
        panel.append(head);

        // ── Row 1: 5 main KPI cards ───────────────────────────────────────────
        const row1 = el("div", "summary-grid spm-kpi-grid spm-ov-row-main");

        // First 4 cards via the standard pattern
        [
            ["Engineering PO Spend", money(received.total_po_value), "blue",
                scope.engineering_source_note || "Gen PO Stage 1 + Stage 2"],
            ["GRN Received", money(received.received_value), "green",
                scope.engineering_source_note || "GRN completed lines"],
            ["Open Commitment", money(received.pending_value), "amber",
                "Pending GRN / not yet received"],
            ["GI Consumed",
                issued.total_issued_value != null ? money(issued.total_issued_value) : "No GI source loaded",
                "blue",
                scope.consumption_source_note || "Project Actual Transactions"],
        ].forEach(([label, value, tone, note]) => {
            const card = el("article", `summary-card summary-card-kpi spm-kpi spm-kpi-${tone}`);
            card.append(el("span", "summary-label", label));
            card.append(el("strong", null, value));
            card.append(el("span", "spm-kpi-source", note));
            row1.append(card);
        });

        // 5th card: Current Inventory (special — shows count + value + breakdown)
        const invCard = el("article", "summary-card summary-card-kpi spm-kpi spm-kpi-green spm-kpi-inventory");
        invCard.append(el("span", "summary-label", "Current Inventory"));
        invCard.append(el("strong", null, inv.in_stock_items != null ? num(inv.in_stock_items) + " items" : "--"));
        if (inv.current_inventory_value != null) {
            invCard.append(el("div", "spm-ov-inv-value", money(inv.current_inventory_value)));
        }
        const breakdown = inv.item_group_breakdown || {};
        const breakdownParts = Object.entries(breakdown)
            .sort((a, b) => b[1] - a[1])
            .map(([g, c]) => `${c} ${g}`)
            .join(" · ");
        if (breakdownParts) invCard.append(el("div", "spm-ov-inv-breakdown", breakdownParts));
        invCard.append(el("span", "spm-kpi-source",
            inv.unvalued_in_stock_items > 0
                ? `${num(inv.unvalued_in_stock_items)} items without price match · On-hand list`
                : "Source: On-hand list"));
        row1.append(invCard);
        panel.append(row1);

        // ── Row 2: 3 category KPI cards ──────────────────────────────────────
        const row2 = el("div", "summary-grid spm-kpi-grid spm-ov-row-secondary");
        [
            ["Stock Spare Purchase",    money(pocat.stocked_spare_part_po_value),   "blue",
                pocat.stocked_spare_part_po_count != null ? num(pocat.stocked_spare_part_po_count) + " PO lines" : null],
            ["Non-stock Direct Purchase", money(pocat.non_stock_spare_part_po_value), "amber",
                pocat.non_stock_spare_part_po_count != null ? num(pocat.non_stock_spare_part_po_count) + " PO lines" : null],
            ["Services / Labour / Repair", money(pocat.service_labour_repair_po_value), "red",
                pocat.service_labour_repair_po_count != null ? num(pocat.service_labour_repair_po_count) + " PO lines · incl. contractor, calibration, cleaning" : null],
        ].forEach(([label, value, tone, sub]) => {
            const card = el("article", `summary-card summary-card-kpi spm-kpi spm-kpi-${tone} spm-kpi-dual`);
            card.append(el("span", "summary-label", label));
            card.append(el("strong", null, value));
            if (sub) card.append(el("span", "spm-kpi-sub", sub));
            row2.append(card);
        });
        panel.append(row2);

        // ── Row 3: compact procurement reference strip ────────────────────────
        if (pk.available !== false) {
            panel.append(renderProcurementReconStrip(pk));
        }

        // ── Footer note ───────────────────────────────────────────────────────
        panel.append(el("p", "spm-flow-note spm-ov-footnote",
            "Indirect PO is used as procurement reference only. Engineering spend is scoped from Stage 1 and Stage 2 Gen PO files. Current inventory is based on the On-hand list."));

        // ── Data quality note (only when issues exist) ────────────────────────
        const dqIssues = [];
        if (dq.missing_received_date > 0) dqIssues.push(`${num(dq.missing_received_date)} PO rows missing GR date`);
        if (dq.rows_without_work_order > 0) dqIssues.push(`${num(dq.rows_without_work_order)} GI rows without WO reference`);
        if ((inv.unvalued_in_stock_items || 0) > 0) dqIssues.push(`${num(inv.unvalued_in_stock_items)} on-hand items missing price match — inventory valuation is based on latest matched PO price`);
        if (pk.available !== false && (pk.price_qty_mismatch_count || 0) > 0) dqIssues.push(`${num(pk.price_qty_mismatch_count)} Engineering PO lines with amount / quantity mismatch in Indirect PO`);
        if (dqIssues.length > 0) {
            const dqNote = el("div", "spm-ov-dq-note");
            dqNote.innerHTML = "<strong>Data quality: </strong>" + dqIssues.map(esc).join(" &nbsp;·&nbsp; ");
            panel.append(dqNote);
        }

        return panel;
    }

    function renderProcurementReconStrip(pk) {
        const strip = el("div", "spm-recon-strip");
        const titleRow = el("div", "spm-recon-strip-head");
        titleRow.append(el("span", "spm-recon-strip-title", "Procurement Reference Match"));
        titleRow.append(el("span", "spm-recon-strip-note", "Indirect PO is company-wide reference — not Engineering spend"));
        strip.append(titleRow);

        const cells = el("div", "spm-recon-strip-cells");
        const matchRate = pk.match_rate_pct;
        const matchCls = matchRate == null ? "" : matchRate >= 90 ? " spm-recon-cell-good" : matchRate >= 70 ? " spm-recon-cell-warn" : " spm-recon-cell-bad";
        const mismatchCls = (pk.price_qty_mismatch_count || 0) > 0 ? " spm-recon-cell-warn" : "";

        [
            ["Company-wide Indirect PO", money(pk.total_indirect_po_value), " spm-recon-cell-ref"],
            ["Engineering PO Matched", money(pk.matched_engineering_po_value), " spm-recon-cell-good"],
            ["Not in Procurement File",
                pk.engineering_po_not_in_procurement != null
                    ? num(pk.engineering_po_not_in_procurement) + " lines"
                    : (pk.unmatched_procurement_value != null ? money(pk.unmatched_procurement_value) : "--"),
                ""],
            ["Price / Qty Mismatches", num(pk.price_qty_mismatch_count), mismatchCls],
            ["Match Rate", pct(matchRate), matchCls],
        ].forEach(([label, value, cls]) => {
            const cell = el("div", "spm-recon-cell" + (cls || ""));
            cell.append(el("span", "spm-recon-cell-label", label));
            cell.append(el("strong", "spm-recon-cell-value", value));
            cells.append(cell);
        });
        strip.append(cells);
        return strip;
    }

    function renderGrGiPanel() {
        const panel = el("section", "card-shell spm-analysis-panel");
        const received = cache.received || {};
        const issued = cache.issued || {};
        const gr = received.kpis || {};
        const gi = issued.kpis || {};
        const scope = financialScope();
        const quality = (cache.overview || {}).data_quality || {};
        const balance = gr.received_value != null && gi.total_issued_value != null
            ? Number(gr.received_value || 0) - Number(gi.total_issued_value || 0)
            : null;

        const head = el("div", "section-head spm-panel-head");
        const copy = el("div");
        copy.append(el("h2", null, "Goods Received vs Goods Issued"));
        copy.append(el("p", "section-subtitle", `${scope.label || financialViewLabel()}. Goods Received is scoped to Engineering PO files; Goods Issued is based on Project Actual Transactions.`));
        head.append(copy);
        panel.append(head);

        panel.append(
            kpiGrid(
                [
                    [engineeringSpendLabel(), money(gr.total_po_value), "blue", scope.engineering_source_note],
                    ["Actual / GRN Received", money(gr.received_value), "green", scope.engineering_source_note],
                    ["Pending GRN / Open Commitment", money(gr.pending_value), "amber", scope.engineering_source_note],
                    ["GI Consumed", money(gi.total_issued_value), "blue", scope.consumption_source_note],
                    ["GR - GI Balance", money(balance), balance == null ? "blue" : balance >= 0 ? "green" : "red", "Source: Engineering PO files and Project Actual Transactions"],
                    ["GI Non-Item Rows Excluded", num(quality.non_item_rows), "amber", scope.consumption_source_note],
                ],
                true
            )
        );
        panel.append(
            el(
                "p",
                "spm-data-note",
                "Balance = Goods Received / GRN minus Goods Issued / Consumption. Positive means receipts are ahead of usage; negative means stock drawdown."
            )
        );

        // Full-width GR vs GI trend chart
        const grgiCard = el("div", "spm-chart-card spm-grgi-full");
        const grgiHead = el("div", "spm-chart-head");
        grgiHead.append(el("span", "spm-chart-title", "GR vs GI Trend"));
        const grgiToggle = el("div", "spm-view-btns");
        [["monthly", "Monthly"], ["fy", "By FY"]].forEach(([view, label]) => {
            const btn = el("button", `spm-view-btn${grgiTrendView === view ? " active" : ""}`, label);
            btn.type = "button";
            btn.addEventListener("click", () => {
                if (grgiTrendView === view) return;
                grgiTrendView = view;
                grgiToggle.querySelectorAll(".spm-view-btn").forEach((b) => b.classList.toggle("active", b.textContent === label));
                if (charts.grgi) { charts.grgi.destroy(); charts.grgi = null; }
                drawGrGiTrend(received, issued);
            });
            grgiToggle.append(btn);
        });
        grgiHead.append(grgiToggle);
        grgiCard.append(grgiHead);
        const grgiWrap = el("div", "spm-chart-canvas-wrap spm-grgi-canvas-wrap");
        const grgiCanvas = el("canvas");
        grgiCanvas.id = "spm-grgi-trend";
        grgiWrap.append(grgiCanvas);
        grgiCard.append(grgiWrap);
        grgiCard.append(el("p", "spm-flow-note", "Source: Engineering PO files and Project Actual Transactions"));
        panel.append(grgiCard);

        // 3 bar charts in a flush row below the trend
        const barsGrid = el("div", "spm-chart-grid spm-bars-row");
        barsGrid.append(barCard("Top Purchased Items", topPurchasedItems(received.rows), money, scope.engineering_source_note));
        barsGrid.append(barCard("Top Consumed Items", issued.top_items_by_value, money, scope.consumption_source_note));
        barsGrid.append(barCard("Consumption by Category", issued.consumption_by_category, money, scope.consumption_source_note));
        panel.append(barsGrid);

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
                    ["PO Missing Item No.", num(quality.missing_item_number), "amber"],
                    ["PO Missing Value", num(quality.missing_total_price ?? quality.rows_without_total), "amber"],
                    ["PO Missing Vendor", num(quality.missing_vendor), "amber"],
                    ["PO Missing GR Date", num(quality.missing_received_date), "amber"],
                    ["GI Missing Project Date", num(quality.rows_without_date), "amber"],
                    ["GI Missing WO Ref", num(quality.rows_without_work_order), "amber"],
                    ["GI Non-Item Rows", num(quality.non_item_rows), "amber"],
                    ["On-hand Missing Qty", num(quality.on_hand_missing_quantity), "amber"],
                    ["On-hand Missing Value", num(quality.on_hand_missing_unit_cost_or_value), "amber"],
                    ["Other / Unclassified PO", num(quality.unclassified_po_rows ?? quality.unclassified_count), "amber"],
                    ["GI Missing Asset Link", num(quality.rows_without_asset), "amber"],
                ],
                true
            )
        );

        panel.append(importStatusList());
        panel.append(dataQualityNotes());
        panel.append(
            tableSection(
                "High Purchase / Low Issue Review",
                manualRows,
                [
                    ["Item", "item"],
                    ["Purchased Value", "purchased_value", "money"],
                    ["Issued Value", "issued_value", "money"],
                ],
                "No high purchase / low issue signals at the current filters.",
                "Source: Engineering PO files and Project Actual Transactions"
            )
        );
        return panel;
    }

    function importStatusList() {
        const section = el("div", "spm-source-grid");
        const status = cache.importStatus || {};
        ["Stage 1", "Stage 2", "Goods Issued", "Inventory"].forEach((key) => {
            const item = status[key] || {};
            const card = el("article", "spm-source-card " + (item.uploaded ? "ok" : "off"));
            card.append(el("strong", null, key));
            card.append(
                el(
                    "span",
                    null,
                    item.uploaded
                        ? (item.file_name || (key === "Goods Issued" ? `${num(item.transaction_count)} transactions` : `${num(item.row_count)} rows`))
                        : "Not loaded"
                )
            );
            if ((item.missing_required || []).length) {
                card.append(el("small", null, "Missing: " + item.missing_required.join(", ")));
            }
            section.append(card);
        });
        return section;
    }

    function dataQualityNotes() {
        const section = el("div", "spm-table-section");
        section.append(el("h3", "spm-subtitle", "Calculation Notes"));
        [
            "On-hand list is treated as a current stock snapshot, not a movement history.",
            "Project Actual Transactions is used for Goods Issued / consumption.",
            "Gen PO is used for PO, GR, and purchase value.",
            "Service, labour, and repair rows are kept separate from spare-part consumption.",
            "When item numbers are missing, description-based matching is less reliable.",
        ].forEach((text) => section.append(el("p", "spm-data-note", text)));
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

    function barCard(title, items, formatter, sourceNote) {
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
        if (sourceNote) card.append(el("p", "spm-flow-note", sourceNote));
        return card;
    }

    function tableSection(title, rows, cols, emptyText, sourceNote) {
        const safeRows = Array.isArray(rows) ? rows : [];
        const section = el("div", "spm-table-section");
        section.append(el("h3", "spm-subtitle", `${title} (${num(safeRows.length)} rows)`));
        const wrap = el("div", "table-wrapper spm-table-wrap");
        if (!safeRows.length) {
            wrap.append(el("p", "spm-muted spm-table-empty", emptyText || "No data."));
            section.append(wrap);
            if (sourceNote) section.append(el("p", "spm-flow-note", sourceNote));
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
        if (sourceNote) section.append(el("p", "spm-flow-note", sourceNote));
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

    function grgiChartConfig(labels, grnVals, pendingVals, giVals, balanceVals, maxBar) {
        return {
            type: "bar",
            data: {
                labels,
                datasets: [
                    { label: "Received / GRN", data: grnVals, backgroundColor: "#10b981", borderRadius: 4, maxBarThickness: maxBar },
                    { label: "Pending GRN", data: pendingVals, backgroundColor: "#f59e0b", borderRadius: 4, maxBarThickness: maxBar },
                    { label: "Goods Issued", data: giVals, backgroundColor: "#3b82f6", borderRadius: 4, maxBarThickness: maxBar },
                    { type: "line", label: "GR-GI Balance", data: balanceVals, borderColor: "#0f172a", backgroundColor: "#0f172a", borderWidth: 2, tension: 0.22, pointRadius: 3, yAxisID: "y" },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } },
                scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true, ticks: { callback: (value) => "THB " + (Number(value) / 1e6).toFixed(1) + "M" } },
                },
            },
        };
    }

    function drawGrGiTrend(received, issued) {
        const canvas = document.getElementById("spm-grgi-trend");
        if (!canvas || typeof Chart === "undefined") return;
        if (charts.grgi) { charts.grgi.destroy(); charts.grgi = null; }

        const grn = received.monthly_received_value || [];
        const pending = received.monthly_pending_value || [];
        const gi = issued.monthly_issued_value || [];

        if (grgiTrendView === "fy") {
            const yearSet = new Set();
            [grn, pending, gi].forEach((rows) => rows.forEach((r) => { if (r.month) yearSet.add(String(r.month).slice(0, 4)); }));
            const years = Array.from(yearSet).sort();
            const sumByYear = (rows) => {
                const m = {};
                rows.forEach((r) => { if (r.month) { const y = String(r.month).slice(0, 4); m[y] = (m[y] || 0) + (Number(r.value) || 0); } });
                return m;
            };
            const gm = sumByYear(grn), pm = sumByYear(pending), gim = sumByYear(gi);
            charts.grgi = new Chart(canvas.getContext("2d"), grgiChartConfig(
                years,
                years.map((y) => gm[y] || 0),
                years.map((y) => pm[y] || 0),
                years.map((y) => gim[y] || 0),
                years.map((y) => (gm[y] || 0) - (gim[y] || 0)),
                40,
            ));
            return;
        }

        // Monthly view
        const months = Array.from(new Set([].concat(grn, pending, gi).map((row) => row.month).filter(Boolean))).sort();
        const grnMap = monthlyMap(grn);
        const pendingMap = monthlyMap(pending);
        const giMap = monthlyMap(gi);
        charts.grgi = new Chart(canvas.getContext("2d"), grgiChartConfig(
            months.map(monthLabel),
            months.map((m) => grnMap[m] || 0),
            months.map((m) => pendingMap[m] || 0),
            months.map((m) => giMap[m] || 0),
            months.map((m) => (grnMap[m] || 0) - (giMap[m] || 0)),
            18,
        ));
    }

    function renderSupplierProcurementPanel() {
        const panel = el("section", "card-shell spm-compact-panel");
        const head = el("div", "section-head spm-panel-head");
        const copy = el("div");
        copy.append(el("h2", null, "Supplier & Vendor Performance (Procurement Reference)"));
        copy.append(el("p", "section-subtitle", `${financialViewLabel()}. Vendor/procurement totals come from the Indirect PO reference file; matched Engineering values come from Gen PO files.`));
        head.append(copy);
        panel.append(head);

        const pk = (cache.procurement && cache.procurement.kpis) || {};
        const vendors = (cache.procurement && cache.procurement.vendor_performance) || [];

        if (!pk.total_indirect_lines && !vendors.length) {
            panel.append(el("p", "spm-muted", "No Indirect PO data loaded. Import the Indirect PO file via Manage Imports to enable vendor reconciliation."));
            return panel;
        }

        // Summary KPIs
        panel.append(
            kpiGrid(
                [
                    ["Company-wide Indirect PO Value", money(pk.total_indirect_po_value), "blue", "Source: Indirect PO procurement file"],
                    ["PO Lines", num(pk.total_indirect_lines), "", "Source: Indirect PO procurement file"],
                    ["Engineering PO Matched in Procurement File", num(pk.matched_lines), "", "Source: Engineering PO files matched in procurement file"],
                    ["Reconciliation Match Rate", pct(pk.match_rate_pct), pk.match_rate_pct >= 80 ? "green" : "amber", "Source: Indirect PO procurement file"],
                    ["Price / Qty Mismatches", num(pk.price_qty_mismatch_count), pk.price_qty_mismatch_count > 0 ? "amber" : "", "Source: Indirect PO procurement file"],
                ],
                true
            )
        );
        panel.append(el("p", "spm-flow-note", "The procurement file is used as a reference only and may include non-engineering/company-wide purchases."));

        // Status breakdown
        const breakdown = (pk.status_breakdown || []).slice(0, 8);
        if (breakdown.length) {
            const bSection = el("div", "spm-table-section");
            bSection.append(el("h3", "spm-subtitle", "Reconciliation Status Breakdown"));
            const breakdownGrid = el("div", "spm-barlist");
            const maxCount = Math.max(...breakdown.map((b) => b.count), 1);
            breakdown.forEach((b) => {
                const row = el("div", "spm-bar-row");
                row.append(el("span", "spm-bar-label", b.label));
                const track = el("div", "spm-bar-track");
                const fill = el("div", "spm-bar-fill");
                fill.style.width = Math.max(2, (b.count / maxCount) * 100) + "%";
                fill.style.background = b.label.includes("Mismatch") || b.label === "Requires Review" ? "#f59e0b"
                    : b.label === "Matched - Same Value" ? "#10b981"
                    : b.label.includes("Only") ? "#6b7280" : "#3b82f6";
                track.append(fill);
                row.append(track, el("span", "spm-bar-val", num(b.count) + " lines"));
                breakdownGrid.append(row);
            });
            bSection.append(breakdownGrid);
            panel.append(bSection);
        }

        // Vendor table
        if (vendors.length) {
            const tSection = el("div", "spm-table-section");
            tSection.append(el("h3", "spm-subtitle", `Vendor Performance — Indirect PO (${num(vendors.length)} vendors)`));
            const wrap = el("div", "table-wrapper spm-table-wrap");
            const cols = [
                ["Vendor", "vendor"],
                ["Total PO Value", "total_po_value", "money"],
                ["PO Count", "po_count", "num"],
                ["Line Count", "line_count", "num"],
                ["Avg PO Value", "avg_po_value", "money"],
                ["Mismatches", "mismatch_count", "num"],
                ["Procurement Only", "procurement_only_count", "num"],
            ];
            wrap.innerHTML =
                `<table class="spm-table"><thead><tr>${cols.map((c) => `<th>${esc(c[0])}</th>`).join("")}</tr></thead><tbody>` +
                vendors.slice(0, 50).map((v) =>
                    `<tr>${cols.map((c) => `<td>${esc(cellVal(v[c[1]], c[2]))}</td>`).join("")}</tr>`
                ).join("") +
                "</tbody></table>";
            tSection.append(wrap);
            tSection.append(el("p", "spm-flow-note", "Source: Indirect PO procurement file"));
            panel.append(tSection);
        }

        // Procurement category breakdown
        const procCats = (cache.procurement && cache.procurement.procurement_categories) || [];
        if (procCats.length) {
            panel.append(barCard("PO Value by Procurement Category", procCats, money, "Source: Indirect PO procurement file"));
        }

        // Flag breakdown (SPARE, MAINT, etc.)
        const flags = (cache.procurement && cache.procurement.flags) || [];
        if (flags.length) {
            const flagSection = el("div", "spm-table-section");
            flagSection.append(el("h3", "spm-subtitle", "PO Value by Flag"));
            flagSection.append(barCard("", flags.slice(0, 12), money, "Source: Indirect PO procurement file"));
            panel.append(flagSection);
        }

        return panel;
    }

    function renderClassificationReconPanel() {
        const panel = el("section", "card-shell spm-compact-panel");
        const head = el("div", "section-head spm-panel-head");
        const copy = el("div");
        copy.append(el("h2", null, "Procurement Reference Check - Gen PO Classification"));
        copy.append(el("p", "section-subtitle", `${financialViewLabel()}. Engineering classification is preserved. Indirect PO reference values are shown alongside for reconciliation. Differences are flagged, not auto-corrected.`));
        head.append(copy);
        panel.append(head);

        const engRows = (cache.procurement && cache.procurement.engineering_with_reconciliation) || [];
        const pk = (cache.procurement && cache.procurement.kpis) || {};

        if (!engRows.length && !pk.available) {
            panel.append(el("p", "spm-muted", "No Indirect PO data loaded. Import the Indirect PO file via Manage Imports to enable reconciliation fields."));
            return panel;
        }

        // Reconciliation summary cards
        if (pk.available !== false) {
            panel.append(renderProcurementReconCards(pk));
        }

        // Status colour key
        const key = el("div", "spm-recon-key");
        [
            ["Matched - Same Value", "#10b981"],
            ["Matched - Price Mismatch", "#f59e0b"],
            ["Matched - Qty Mismatch", "#f59e0b"],
            ["Matched - Amount Mismatch", "#f59e0b"],
            ["Requires Review", "#ef4444"],
            ["Engineering Copy Only", "#6b7280"],
            ["Indirect PO Only", "#3b82f6"],
        ].forEach(([label, color]) => {
            const chip = el("span", "spm-recon-chip");
            chip.style.background = color;
            chip.textContent = label;
            key.append(chip);
        });
        panel.append(key);

        if (engRows.length) {
            const tSection = el("div", "spm-table-section");
            tSection.append(el("h3", "spm-subtitle", `Engineering Gen PO with Reconciliation (${num(engRows.length)} lines)`));
            const wrap = el("div", "table-wrapper spm-table-wrap");
            const cols = [
                ["Stage", "stage"],
                ["PO No.", "po_no"],
                ["PR No.", "pr_no"],
                ["Description", "description"],
                ["Vendor (Eng)", "vendor"],
                ["Official Vendor", "official_vendor"],
                ["Eng. Value", "engineering_copy_value", "money"],
                ["Indirect PO Reference Value", "official_indirect_po_value", "money"],
                ["Difference", "value_difference", "money"],
                ["Status", "recon_status"],
                ["Financial Type", "financial_type"],
                ["Category", "category"],
                ["Group of Cost", "group_of_cost"],
            ];
            const statusColor = (s) => {
                if (!s || s === "Engineering Copy Only") return "#6b7280";
                if (s === "Matched - Same Value") return "#10b981";
                if (s === "Requires Review") return "#ef4444";
                return "#f59e0b";
            };
            wrap.innerHTML =
                `<table class="spm-table"><thead><tr>${cols.map((c) => `<th>${esc(c[0])}</th>`).join("")}</tr></thead><tbody>` +
                engRows.slice(0, 200).map((r) =>
                    `<tr>${cols.map((c) => {
                        const raw = r[c[1]];
                        if (c[1] === "recon_status") {
                            return `<td><span class="spm-recon-badge" style="background:${statusColor(raw)}">${esc(raw || "--")}</span></td>`;
                        }
                        if (c[2] === "money" && c[1] === "value_difference" && raw != null) {
                            const tone = Math.abs(raw) < 1 ? "color:#10b981" : raw > 0 ? "color:#f59e0b" : "color:#ef4444";
                            return `<td style="${tone}">${esc(money(raw))}</td>`;
                        }
                        return `<td>${esc(cellVal(raw, c[2]))}</td>`;
                    }).join("")}</tr>`
                ).join("") +
                "</tbody></table>";
            tSection.append(wrap);
            tSection.append(el("p", "spm-flow-note", "Source: Engineering PO files with Indirect PO procurement file reference fields"));
            panel.append(tSection);
        }

        return panel;
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
