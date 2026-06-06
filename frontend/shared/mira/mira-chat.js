/*
 * Floating MIRA chat assistant.
 *
 * Read-only: this uses /api/mira/chat only. It never edits any maintenance
 * record or source file. Answers are based on verified dashboard data.
 */
(function () {
    "use strict";

    const CFG = window.MIRA_CONFIG || {};
    if (CFG.enabled === false) return;
    try {
        if (window.self !== window.top) return;
    } catch (_err) {
        // Cross-origin iframe guard: treat as top window.
    }

    const API = CFG.apiBase || "/api/mira";
    const PROMPTS = [
        "Summarise YTD maintenance performance",
        "What should be followed up today?",
        "Which asset has the most MR?",
        "Which functional location has the highest workload?",
        "What is the most common fault this month?",
        "What are the main PM issues?",
        "Which PM tasks are overdue?",
        "Summarise spare parts consumption",
        "Give me a one-line report summary",
    ];

    const state = {
        open: false,
        busy: false,
        mode: "chat",               // "chat" (Q&A) | "kpi" (KPI Analysis)
        providerStatus: {
            text: "Checking AI mode...",
            tone: "muted",
        },
    };

    document.addEventListener("DOMContentLoaded", init);

    function init() {
        if (document.getElementById("mira-chat-fab")) return;
        document.body.append(buildBackdrop(), buildFab(), buildDrawer());
        document.addEventListener("keydown", handleGlobalKeydown);
        updateProviderBadge("Checking AI mode...", "muted");
        pingHealth();
    }

    function ensureMounted() {
        if (!document.getElementById("mira-chat-fab")) init();
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function mascotSvg(size) {
        // MIRA identity: friendly AI face (navy) with blue eyes + smile, framed by
        // red segmented radar/tech rings. Readable down to ~22px for the FAB/avatars.
        return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
            <g fill="none" stroke="#e8392f" stroke-linecap="round">
                <circle cx="32" cy="32" r="29" stroke-width="2.4" stroke-dasharray="58 18 30 14"/>
                <circle cx="32" cy="32" r="24" stroke-width="2" stroke-dasharray="42 16 22 12" opacity="0.92"/>
                <circle cx="32" cy="32" r="19.5" stroke-width="1.5" stroke-dasharray="26 18 16 22" opacity="0.72"/>
            </g>
            <ellipse cx="32" cy="33" rx="17.5" ry="11.2" fill="#2c3a4d"/>
            <circle cx="26" cy="31" r="3.4" fill="#46b6ea"/>
            <circle cx="38" cy="31" r="3.4" fill="#46b6ea"/>
            <path d="M26.4 36.4c1.7 2.1 3.7 3.1 5.6 3.1s3.9-1 5.6-3.1" fill="none" stroke="#46b6ea" stroke-width="2.4" stroke-linecap="round"/>
        </svg>`;
    }

    window.getMiraMascotSvg = mascotSvg;
    window.getMiraProviderStatus = function getMiraProviderStatus() {
        return { ...state.providerStatus };
    };
    window.openMiraChat = function openMiraChat(prompt, options) {
        ensureMounted();
        const settings = options && typeof options === "object" ? options : {};
        openDrawer();
        const input = document.getElementById("mira-chat-input");
        const text = String(prompt || "").trim();
        if (!text) {
            input?.focus();
            return;
        }
        if (settings.send === false) {
            if (input) {
                input.value = text;
                input.focus();
            }
            return;
        }
        send(text);
    };
    window.clearMiraChat = function clearMiraChat() {
        ensureMounted();
        clearChat();
    };

    function buildBackdrop() {
        const backdrop = el("div", "mira-chat-backdrop");
        backdrop.id = "mira-chat-backdrop";
        backdrop.hidden = true;
        backdrop.addEventListener("click", closeDrawer);
        return backdrop;
    }

    function buildFab() {
        const fab = el("button", "mira-fab");
        fab.id = "mira-chat-fab";
        fab.type = "button";
        fab.title = "Ask MIRA";
        fab.setAttribute("aria-label", "Ask MIRA");
        fab.innerHTML = mascotSvg(38);
        fab.append(el("span", "mira-fab-label", "Ask MIRA"), el("span", "mira-fab-tooltip", "Ask MIRA"));
        fab.addEventListener("click", toggleDrawer);
        return fab;
    }

    function buildDrawer() {
        const drawer = el("section", "mira-chat-drawer");
        drawer.id = "mira-chat-drawer";
        drawer.hidden = true;

        const head = el("div", "mira-chat-head");
        const brand = el("div", "mira-chat-brand");
        const brandIcon = el("div", "mira-chat-brand-icon");
        brandIcon.innerHTML = mascotSvg(28);
        const brandText = el("div", "mira-chat-brand-copy");
        brandText.append(el("strong", null, "Ask MIRA"), el("span", null, "Read-only maintenance intelligence assistant"));
        brand.append(brandIcon, brandText);

        const status = el("div", "mira-chat-statuses");
        status.append(
            badge("Verified Data", "good"),
            badge("Read-only", "neutral"),
            badge("Checking AI mode...", "muted", "mira-chat-provider-badge")
        );

        const actions = el("div", "mira-chat-actions");
        const minimize = iconButton("Minimise", "\u2212", () => closeDrawer());
        const clear = iconButton("Clear chat", "Clear", clearChat);
        const close = iconButton("Close", "\u00D7", closeDrawer);
        actions.append(minimize, clear, close);

        head.append(brand, actions);

        const modeBar = buildModeBar();

        // Messages scroll area. The starter panel (suggested prompts / KPI picker)
        // lives INSIDE this area so the conversation always gets the full height.
        const log = el("div", "mira-chat-log");
        log.id = "mira-chat-log";
        log.append(welcomeMessage(), buildInlinePanel("chat"));

        const form = el("form", "mira-chat-form");
        const textarea = el("textarea", "mira-chat-input");
        textarea.id = "mira-chat-input";
        textarea.placeholder = "Ask MIRA about downtime, PM, spare parts, or follow-up actions";
        textarea.rows = 2;
        textarea.addEventListener("keydown", handleInputKeydown);
        const sendBtn = el("button", "mira-chat-send", "Send");
        sendBtn.type = "submit";
        form.append(textarea, sendBtn);
        form.addEventListener("submit", function (event) {
            event.preventDefault();
            const value = textarea.value;
            textarea.value = "";
            send(value);
        });

        const footerNote = el("div", "mira-chat-footer-note", "MIRA uses verified dashboard data only.");

        drawer.append(head, status, modeBar, log, form, footerNote);
        return drawer;
    }

    const KPI_AREAS = [
        { id: "pm", label: "PM Schedule", question: "Summarise PM schedule status." },
        { id: "downtime", label: "Downtime", question: "Summarise downtime and work orders." },
        { id: "spare", label: "Spare Parts", question: "Summarise spare parts consumption." },
        { id: "wo", label: "Work Orders / MR", question: "What are the open MR and outstanding work orders?" },
    ];

    function buildModeBar() {
        const bar = el("div", "mira-chat-mode-bar");
        const chatTab = el("button", "mira-chat-mode-tab is-active", "Chat Q&A");
        chatTab.type = "button"; chatTab.dataset.mode = "chat";
        const kpiTab = el("button", "mira-chat-mode-tab", "KPI Analysis");
        kpiTab.type = "button"; kpiTab.dataset.mode = "kpi";
        [chatTab, kpiTab].forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
        bar.append(chatTab, kpiTab);
        return bar;
    }

    // Starter panel shown inside the message area: suggested prompts (Chat Q&A)
    // or the maintenance-area picker (KPI Analysis). Kept in the scroll area so
    // it never steals height from the conversation.
    function buildInlinePanel(mode) {
        const m = mode || state.mode;
        const wrap = el("div", "mira-chat-inline mira-chat-inline-" + m);
        wrap.id = "mira-chat-inline";
        if (m === "kpi") {
            wrap.append(el("div", "mira-chat-inline-title", "Select maintenance areas to analyse"));
            const grid = el("div", "mira-chat-kpi-grid");
            KPI_AREAS.forEach((area) => {
                const item = el("label", "mira-chat-kpi-option");
                const cb = el("input"); cb.type = "checkbox"; cb.value = area.id;
                item.append(cb, el("span", null, area.label));
                grid.append(item);
            });
            wrap.append(grid);
            const analyze = el("button", "mira-chat-kpi-analyze", "Analyse selected");
            analyze.type = "button";
            analyze.addEventListener("click", analyseKpis);
            wrap.append(analyze);
            wrap.append(el("div", "mira-chat-kpi-note", "Uses the dashboard's selected period and stage. Read-only."));
        } else {
            wrap.append(el("div", "mira-chat-inline-title", "Try asking"));
            const chips = el("div", "mira-chat-chips");
            PROMPTS.forEach((prompt) => {
                const chip = el("button", "mira-chat-chip", prompt);
                chip.type = "button";
                chip.addEventListener("click", () => send(prompt));
                chips.append(chip);
            });
            wrap.append(chips);
        }
        return wrap;
    }

    function hasConversation() {
        const log = document.getElementById("mira-chat-log");
        return !!(log && log.querySelector(".mira-msg-row-user"));
    }

    function renderInlinePanel(mode) {
        const log = document.getElementById("mira-chat-log");
        if (!log) return;
        document.getElementById("mira-chat-inline")?.remove();
        const m = mode || state.mode;
        // Suggested prompts only while the chat is fresh; the KPI picker stays
        // available because choosing areas is the whole point of that mode.
        if (m === "kpi" || !hasConversation()) {
            log.append(buildInlinePanel(m));
            log.scrollTop = log.scrollHeight;
        }
    }

    function setMode(mode) {
        state.mode = mode;
        document.querySelectorAll(".mira-chat-mode-tab").forEach((tab) => {
            tab.classList.toggle("is-active", tab.dataset.mode === mode);
        });
        renderInlinePanel(mode);
    }

    function analyseKpis() {
        const selected = Array.from(document.querySelectorAll("#mira-chat-inline input:checked")).map((cb) => cb.value);
        if (!selected.length) return;
        let question;
        if (selected.length === 1) {
            question = (KPI_AREAS.find((a) => a.id === selected[0]) || {}).question;
        } else {
            const names = selected.map((id) => (KPI_AREAS.find((a) => a.id === id) || {}).label).filter(Boolean).join(", ");
            question = `Summarise maintenance performance covering ${names}.`;
        }
        setMode("chat");
        send(question);
    }

    function welcomeMessage() {
        return buildAssistantMessage({
            period_used: "Period used: YTD " + new Date().getFullYear(),
            answer: "I can summarise verified maintenance performance, explain PM issues, highlight open MR, and point out spare-parts consumption trends.",
            insight: [
                "Prompt chips send the exact question shown.",
                "If you name a month or FY, MIRA will use that period instead of the default YTD view.",
            ],
            recommended_follow_up: [
                "Ask Which asset has the most MR for workload concentration.",
                "Ask What should be followed up today for open MR, overdue PM, and backlog.",
            ],
            provider_mode_label: "Rule-based fallback",
            read_only: true,
        });
    }

    function badge(text, tone, id) {
        const node = el("span", "mira-chat-badge mira-chat-badge-" + (tone || "neutral"), text);
        if (id) node.id = id;
        return node;
    }

    function iconButton(label, text, onClick) {
        const node = el("button", "mira-chat-iconbtn", text);
        node.type = "button";
        node.setAttribute("aria-label", label);
        node.title = label;
        node.addEventListener("click", onClick);
        return node;
    }

    function toggleDrawer() {
        if (state.open) closeDrawer();
        else openDrawer();
    }

    function openDrawer() {
        state.open = true;
        const backdrop = document.getElementById("mira-chat-backdrop");
        const drawer = document.getElementById("mira-chat-drawer");
        const fab = document.getElementById("mira-chat-fab");
        if (backdrop) backdrop.hidden = false;
        if (drawer) drawer.hidden = false;
        requestAnimationFrame(() => {
            backdrop?.classList.add("is-open");
            drawer?.classList.add("is-open");
            fab?.classList.add("mira-fab-open");
        });
        document.getElementById("mira-chat-input")?.focus();
    }

    function closeDrawer() {
        state.open = false;
        const backdrop = document.getElementById("mira-chat-backdrop");
        const drawer = document.getElementById("mira-chat-drawer");
        const fab = document.getElementById("mira-chat-fab");
        backdrop?.classList.remove("is-open");
        drawer?.classList.remove("is-open");
        fab?.classList.remove("mira-fab-open");
        window.setTimeout(() => {
            if (!state.open) {
                if (backdrop) backdrop.hidden = true;
                if (drawer) drawer.hidden = true;
            }
        }, 180);
    }

    function clearChat() {
        const log = document.getElementById("mira-chat-log");
        if (!log) return;
        log.innerHTML = "";
        log.append(welcomeMessage());
        renderInlinePanel(state.mode);
    }

    function handleGlobalKeydown(event) {
        if (event.key === "Escape" && state.open) closeDrawer();
    }

    function handleInputKeydown(event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            const input = document.getElementById("mira-chat-input");
            if (!input) return;
            const value = input.value;
            input.value = "";
            send(value);
        }
    }

    function appendMessage(node) {
        const log = document.getElementById("mira-chat-log");
        if (!log) return;
        log.append(node);
        log.scrollTop = log.scrollHeight;
    }

    function buildUserMessage(text) {
        const row = el("div", "mira-msg-row mira-msg-row-user");
        const bubble = el("div", "mira-msg-bubble mira-msg-bubble-user");
        bubble.append(el("p", "mira-msg-text", text));
        row.append(bubble);
        return row;
    }

    function buildAssistantMessage(payload) {
        const row = el("div", "mira-msg-row mira-msg-row-bot");
        const avatar = el("div", "mira-msg-avatar");
        avatar.innerHTML = mascotSvg(26);
        const bubble = el("div", "mira-msg-bubble mira-msg-bubble-bot");

        const header = el("div", "mira-msg-head");
        const headBadges = el("div", "mira-msg-meta");
        if (payload.period_used || payload.period) {
            headBadges.append(badge(payload.period_used || ("Period used: " + payload.period), "soft"));
        }
        if (payload.provider_mode_label) {
            headBadges.append(badge(payload.provider_mode_label, "neutral"));
        }
        if (payload.read_only) {
            headBadges.append(badge("Read-only", "neutral"));
        }
        header.append(headBadges);
        bubble.append(header);

        bubble.append(sectionTitle("Answer"));
        bubble.append(paragraph(payload.answer || "No verified answer was available."));

        if (Array.isArray(payload.key_numbers_used) && payload.key_numbers_used.length) {
            bubble.append(listSection("Key Numbers Used", payload.key_numbers_used));
        }

        if (Array.isArray(payload.insight) && payload.insight.length) {
            bubble.append(listSection("Insight", payload.insight));
        }

        if (payload.theme_analysis && Array.isArray(payload.theme_analysis.example_descriptions) && payload.theme_analysis.example_descriptions.length) {
            bubble.append(listSection("Description Examples", payload.theme_analysis.example_descriptions));
        }

        const warnings = (((payload.view_data_used || {}).data_warnings) || []).filter(Boolean);
        if (warnings.length) {
            bubble.append(listSection("Data Notes", warnings, "warning"));
        }

        if (Array.isArray(payload.recommended_follow_up) && payload.recommended_follow_up.length) {
            bubble.append(listSection("Recommended Follow-Up", payload.recommended_follow_up));
        }

        if (payload.view_data_used) {
            bubble.append(buildDataUsed(payload.view_data_used));
        }

        row.append(avatar, bubble);
        return row;
    }

    function buildThinkingMessage() {
        const row = el("div", "mira-msg-row mira-msg-row-bot");
        row.id = "mira-chat-thinking";
        const avatar = el("div", "mira-msg-avatar");
        avatar.innerHTML = mascotSvg(26);
        const bubble = el("div", "mira-msg-bubble mira-msg-bubble-bot mira-msg-bubble-thinking");
        bubble.append(sectionTitle("MIRA is checking verified data"));
        const dots = el("div", "mira-typing");
        dots.append(el("span"), el("span"), el("span"));
        bubble.append(dots);
        row.append(avatar, bubble);
        return row;
    }

    function sectionTitle(text) {
        return el("div", "mira-msg-section-title", text);
    }

    function paragraph(text) {
        return el("p", "mira-msg-text", text);
    }

    function listSection(title, items, tone) {
        const wrap = el("div", "mira-msg-section");
        wrap.append(sectionTitle(title));
        const list = el("ul", "mira-msg-list" + (tone === "warning" ? " is-warning" : ""));
        items.forEach((item) => {
            if (!item) return;
            list.append(el("li", null, String(item)));
        });
        wrap.append(list);
        return wrap;
    }

    function buildDataUsed(viewData) {
        const details = el("details", "mira-data-used");
        const summary = el("summary", null, "View Data Used");
        const body = el("div", "mira-data-used-body");
        body.append(
            dataBlock("Source dataset / table", viewData.source_tables),
            dataBlock("Period / filter used", viewData.filters_applied),
            dataBlock("Rows loaded", viewData.rows_loaded),
            dataBlock("Rows after filter", viewData.rows_after_filter),
            dataBlock("KPI values used", viewData.kpi_values_used)
        );
        if (viewData.last_refreshed) {
            body.append(dataBlock("Last refreshed", [viewData.last_refreshed]));
        }
        details.append(summary, body);
        return details;
    }

    function dataBlock(label, items) {
        const wrap = el("div", "mira-data-block");
        wrap.append(el("div", "mira-data-block-label", label));
        const list = el("ul", "mira-data-block-list");
        const rows = Array.isArray(items) ? items : [];
        if (!rows.length) {
            list.append(el("li", "mira-data-empty", "-"));
        } else {
            rows.forEach((item) => {
                if (item && typeof item === "object" && !Array.isArray(item)) {
                    list.append(el("li", null, `${item.label || "Value"}: ${item.value || ""}`));
                } else if (item) {
                    list.append(el("li", null, String(item)));
                }
            });
        }
        wrap.append(list);
        return wrap;
    }

    function getDashboardFilters() {
        return window.MIRA_DASHBOARD_FILTERS && typeof window.MIRA_DASHBOARD_FILTERS === "object"
            ? window.MIRA_DASHBOARD_FILTERS
            : undefined;
    }

    async function pingHealth() {
        try {
            const response = await fetch(`${API}/health`, { cache: "no-store" });
            if (!response.ok) throw new Error("health");
            const payload = await response.json();
            updateProviderBadge(payload.provider_status || "Rule-based fallback", payload.llm_active ? "good" : "neutral");
        } catch (_err) {
            updateProviderBadge("LLM unavailable", "muted");
        }
    }

    function updateProviderBadge(text, tone) {
        const badgeNode = document.getElementById("mira-chat-provider-badge");
        state.providerStatus = {
            text: text || "Checking AI mode...",
            tone: tone || "neutral",
        };
        window.MIRA_PROVIDER_STATUS = { ...state.providerStatus };
        window.dispatchEvent(new CustomEvent("mira:provider-status", {
            detail: { ...state.providerStatus },
        }));
        if (!badgeNode) return;
        badgeNode.textContent = text;
        badgeNode.className = "mira-chat-badge mira-chat-badge-" + (tone || "neutral");
    }

    async function send(question) {
        const trimmed = String(question || "").trim();
        if (!trimmed || state.busy) return;

        if (!state.open) openDrawer();
        state.busy = true;
        document.getElementById("mira-chat-fab")?.classList.add("is-busy");

        // Conversation started: drop the starter panel so it can't reappear.
        document.getElementById("mira-chat-inline")?.remove();
        appendMessage(buildUserMessage(trimmed));
        appendMessage(buildThinkingMessage());

        try {
            const response = await fetch(`${API}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify(getDashboardFilters() ? { question: trimmed, filters: getDashboardFilters() } : { question: trimmed }),
            });
            removeThinking();
            if (!response.ok) {
                throw new Error(String(response.status));
            }
            const payload = await response.json();
            updateProviderBadge(payload.provider_mode_label || payload.provider_status || "Rule-based fallback", payload.llm_active ? "good" : "neutral");
            appendMessage(buildAssistantMessage(payload));
        } catch (error) {
            removeThinking();
            const code = String(error && error.message ? error.message : "");
            const message = code === "404"
                ? "MIRA chat is not available on the running backend yet. Please restart the backend and try again."
                : code.toLowerCase().includes("failed to fetch")
                ? "MIRA could not reach /api/mira/chat on this dashboard server. The local backend likely needs a restart."
                : "MIRA could not complete that request because the backend could not be reached. Please try again.";
            appendMessage(buildAssistantMessage({
                answer: message,
                insight: ["The chat UI is still read-only and no dashboard data was changed."],
                recommended_follow_up: ["Refresh the page or restart the local backend if the error continues."],
                provider_mode_label: "LLM unavailable",
                read_only: true,
            }));
            updateProviderBadge("LLM unavailable", "muted");
        } finally {
            state.busy = false;
            document.getElementById("mira-chat-fab")?.classList.remove("is-busy");
        }
    }

    function removeThinking() {
        document.getElementById("mira-chat-thinking")?.remove();
    }
})();
