/*
 * Floating MIRA chat assistant — visible on every dashboard page.
 *
 * Read-only: it only asks /api/mira/query (intent routing -> verified KPI metrics
 * -> Ollama or rule-based wording). It never creates/edits/closes MR/WO/PM or any
 * source record. Answers always include Key Numbers Used + View Data Used so the
 * user can audit the figures.
 */
(function () {
    "use strict";

    const CFG = window.MIRA_CONFIG || {};
    if (CFG.enabled === false) return;
    // Don't render a second chat inside an embedded iframe (e.g. the Downtime tab
    // inside the Maintenance app) — the parent page already shows the floating chat.
    try { if (window.self !== window.top) return; } catch (_e) { /* cross-origin: treat as top */ }
    const API = CFG.apiBase || "/api/mira";

    const CHIPS = [
        "Summarise this month's maintenance performance",
        "What is the most common fault this month?",
        "Which asset has the most MR?",
        "Which functional location has the highest workload?",
        "What are the top open MR?",
        "What are the main PM issues?",
        "Which PM tasks are overdue?",
        "Summarise spare parts consumption",
        "Which machines need attention?",
        "Give me a one-line report summary",
    ];

    let open = false;
    let busy = false;

    document.addEventListener("DOMContentLoaded", init);

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function init() {
        if (document.getElementById("mira-chat-fab")) return;
        document.body.appendChild(buildFab());
        document.body.appendChild(buildDrawer());
    }

    function botIcon(size) {
        // Cute bot head (SATS-inspired blue/green) — NOT the SATS logo.
        return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">
            <defs><linearGradient id="miraBotG" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#10b981"/>
            </linearGradient></defs>
            <rect x="9" y="14" width="30" height="24" rx="9" fill="url(#miraBotG)"/>
            <circle cx="24" cy="8" r="3" fill="#10b981"/><rect x="23" y="9" width="2" height="6" fill="#2563eb"/>
            <circle cx="19" cy="26" r="3.4" fill="#fff"/><circle cx="29" cy="26" r="3.4" fill="#fff"/>
            <circle cx="19" cy="26" r="1.5" fill="#0f172a"/><circle cx="29" cy="26" r="1.5" fill="#0f172a"/>
            <rect x="19" y="32" width="10" height="2.4" rx="1.2" fill="#e0f2fe"/>
        </svg>`;
    }

    function buildFab() {
        const fab = el("button", "mira-fab");
        fab.id = "mira-chat-fab";
        fab.type = "button";
        fab.setAttribute("aria-label", "Ask MIRA");
        fab.innerHTML = botIcon(34);
        fab.appendChild(el("span", "mira-fab-label", "Ask MIRA"));
        fab.addEventListener("click", toggle);
        return fab;
    }

    function buildDrawer() {
        const d = el("section", "mira-chat-drawer");
        d.id = "mira-chat-drawer";
        d.hidden = true;

        const head = el("div", "mira-chat-head");
        const brand = el("div", "mira-chat-brand");
        brand.innerHTML = botIcon(22);
        brand.appendChild(el("strong", null, "Ask MIRA"));
        head.append(brand);
        const headBtns = el("div", "mira-chat-head-btns");
        const clearBtn = el("button", "mira-chat-iconbtn", "Clear");
        clearBtn.type = "button";
        clearBtn.addEventListener("click", clearChat);
        const closeBtn = el("button", "mira-chat-iconbtn", "✕");
        closeBtn.type = "button";
        closeBtn.setAttribute("aria-label", "Close");
        closeBtn.addEventListener("click", toggle);
        headBtns.append(clearBtn, closeBtn);
        head.append(headBtns);

        const sub = el("div", "mira-chat-sub", "Read-only — answers from verified dashboard data.");

        const log = el("div", "mira-chat-log");
        log.id = "mira-chat-log";
        log.append(botBubble("Hi — I'm MIRA. Ask about downtime, PM, spare parts, top assets, or what to follow up. I only use verified dashboard data."));

        const chips = el("div", "mira-chat-chips");
        CHIPS.forEach((c) => {
            const chip = el("button", "mira-chat-chip", c);
            chip.type = "button";
            chip.addEventListener("click", () => send(c));
            chips.append(chip);
        });

        const form = el("form", "mira-chat-form");
        const input = el("input", "mira-chat-input");
        input.id = "mira-chat-input";
        input.type = "text";
        input.placeholder = "Ask MIRA a question…";
        input.autocomplete = "off";
        const sendBtn = el("button", "mira-chat-send", "Send");
        sendBtn.type = "submit";
        form.append(input, sendBtn);
        form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); input.value = ""; });

        d.append(head, sub, log, chips, form);
        return d;
    }

    function toggle() {
        open = !open;
        const d = document.getElementById("mira-chat-drawer");
        const fab = document.getElementById("mira-chat-fab");
        if (d) d.hidden = !open;
        if (fab) fab.classList.toggle("mira-fab-open", open);
        if (open) document.getElementById("mira-chat-input")?.focus();
    }

    function clearChat() {
        const log = document.getElementById("mira-chat-log");
        if (log) { log.innerHTML = ""; log.append(botBubble("Chat cleared. Ask me anything about the verified dashboard data.")); }
    }

    function userBubble(text) { const b = el("div", "mira-bubble mira-bubble-user"); b.append(el("p", null, text)); return b; }
    function botBubble(text) { const b = el("div", "mira-bubble mira-bubble-bot"); b.append(el("p", null, text)); return b; }

    function append(node) {
        const log = document.getElementById("mira-chat-log");
        if (!log) return;
        log.append(node);
        log.scrollTop = log.scrollHeight;
    }

    async function send(question) {
        question = String(question || "").trim();
        if (!question || busy) return;
        busy = true;
        append(userBubble(question));
        const thinking = botBubble("MIRA is checking the verified data…");
        thinking.classList.add("mira-bubble-thinking");
        append(thinking);
        try {
            // Inherit the dashboard's selected period/stage as the base filter; the
            // question's own period (if any) overrides it on the backend (Step 11/12).
            const baseFilters = (window.MIRA_DASHBOARD_FILTERS && typeof window.MIRA_DASHBOARD_FILTERS === "object")
                ? window.MIRA_DASHBOARD_FILTERS : undefined;
            const res = await fetch(`${API}/chat`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(baseFilters ? { question, filters: baseFilters } : { question }),
            });
            const json = await res.json();
            thinking.remove();
            renderAnswer(json);
        } catch (err) {
            thinking.remove();
            append(botBubble("Data unavailable — the MIRA backend could not be reached for the selected filter."));
        } finally {
            busy = false;
        }
    }

    function renderAnswer(json) {
        json = json || {};
        const bubble = el("div", "mira-bubble mira-bubble-bot");

        // Period chip (so it's obvious the right period was used).
        if (json.period || json.intent) {
            const meta = el("div", "mira-ans-meta");
            if (json.period) meta.append(el("span", "mira-ans-pill", json.period));
            if (json.intent) meta.append(el("span", "mira-ans-pill mira-ans-pill-intent", json.intent));
            bubble.append(meta);
        }

        // Direct answer
        bubble.append(el("p", "mira-ans-text", json.answer || "Data unavailable for the selected period/filter."));

        // Key Numbers Used
        const nums = json.key_numbers_used || [];
        if (nums.length) bubble.append(block("Key Numbers Used", nums));

        // AI-Suggested Theme Analysis (fault questions)
        const theme = json.theme_analysis;
        if (theme && theme.top_theme) {
            const t = block("AI-Suggested Theme Analysis", [
                `Top theme: ${theme.top_theme} (${theme.top_theme_count}/${theme.rows_loaded}, ${theme.top_theme_pct}%)`,
                `Top asset: ${theme.top_theme_asset || "—"}`,
                `Top functional location: ${theme.top_theme_functional_location || "—"}`,
            ]);
            bubble.append(t);
            if ((theme.example_descriptions || []).length) {
                bubble.append(block("Example Descriptions", theme.example_descriptions));
            }
            bubble.append(el("p", "mira-ans-caveat", theme.note
                || "AI-suggested classifications based on MR descriptions; confirm root cause by engineering review."));
        }

        // Maintenance Risk Insights (backend-scored; not a prediction).
        // Prefer real machine assets for "which machines need attention".
        const risk = json.risk_insights;
        const riskList = (risk && (risk.top_machine_assets || risk.top_assets)) || [];
        if (risk && riskList.length) {
            bubble.append(block("Maintenance Risk Insights", riskList.slice(0, 5).map((a) =>
                `${a.asset_name}: risk ${a.risk_score} (${a.risk_level}, ${a.mr_count} MR)`
                + (a.is_placeholder ? " · placeholder" : ""))));
            bubble.append(el("p", "mira-ans-caveat", risk.note || "Risk signal, not a failure prediction."));
        }

        // Recommended Follow-Up
        const follow = json.recommended_follow_up || [];
        if (follow.length) bubble.append(block("Recommended Follow-Up", follow));

        // View Data Used (collapsible)
        const vdu = json.view_data_used;
        if (vdu) {
            const det = el("details", "mira-ans-details");
            det.append(el("summary", null, "View Data Used"));
            const body = el("div", "mira-ans-vdu");
            (vdu.filters_applied || []).forEach((s) => body.append(el("div", "mira-ans-vdu-row", s)));
            (vdu.source_tables || []).slice(0, 3).forEach((s) => body.append(el("div", "mira-ans-vdu-row", `Source: ${s}`)));
            (vdu.data_warnings || []).forEach((w) => body.append(el("div", "mira-ans-vdu-row mira-ans-warn", `⚠ ${w}`)));
            if (vdu.last_refreshed) body.append(el("div", "mira-ans-vdu-row", `Last refreshed: ${vdu.last_refreshed}`));
            if (json.provider_status) body.append(el("div", "mira-ans-vdu-row", `AI: ${json.provider_status}`));
            det.append(body);
            bubble.append(det);
        }
        append(bubble);
    }

    function block(title, items) {
        const wrap = el("div", "mira-ans-block");
        wrap.append(el("div", "mira-ans-block-title", title));
        const ul = el("ul", "mira-ans-list");
        items.forEach((t) => ul.append(el("li", null, String(t))));
        wrap.append(ul);
        return wrap;
    }
})();
