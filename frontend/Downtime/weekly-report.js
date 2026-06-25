"use strict";
// Weekly Maintenance Report — PPT, PDF (print), Excel Appendix

// ── Helpers ──────────────────────────────────────────────────────────────────

function wrFmtDate(d) {
    if (!d) return "";
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt)) return "";
    return `${dt.getDate()} ${dt.toLocaleString("default", { month: "short" })} ${dt.getFullYear()}`;
}

function wrFmtHours(h) {
    const v = Number(h);
    if (!Number.isFinite(v)) return "--";
    if (v < 24) return `${v.toFixed(1)}h`;
    return `${(v / 24).toFixed(1)}d`;
}

function wrDomText(id) {
    const el = document.getElementById(id);
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "--";
}

function wrSetStatus(msg, type) {
    const el = document.getElementById("export-status");
    if (!el) return;
    el.textContent = msg;
    el.className = `import-status${type === "ok" ? " ok" : type === "error" ? " error" : ""}`;
    el.classList.remove("hidden");
    if (type === "ok") setTimeout(() => el.classList.add("hidden"), 10000);
}

function wrSetBtnState(id, loading, label) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? "Building…" : label;
}

// ── Period ────────────────────────────────────────────────────────────────────

function wrGetPeriod() {
    const val = (document.getElementById("wr-period-select") || {}).value || "this_week";
    const today = new Date();

    const setEnd = (d) => { d.setHours(23, 59, 59, 999); return d; };
    const setStart = (d) => { d.setHours(0, 0, 0, 0); return d; };

    if (val === "this_week" || val === "last_week") {
        const dow = today.getDay();
        const offsetToMon = dow === 0 ? -6 : 1 - dow;
        const thisMon = setStart(new Date(today));
        thisMon.setDate(today.getDate() + offsetToMon);
        if (val === "last_week") {
            const mon = new Date(thisMon); mon.setDate(thisMon.getDate() - 7);
            const sun = new Date(mon); sun.setDate(mon.getDate() + 6); setEnd(sun);
            return { start: mon, end: sun, label: `Week of ${wrFmtDate(mon)}`, type: "week" };
        }
        const sun = new Date(thisMon); sun.setDate(thisMon.getDate() + 6); setEnd(sun);
        return { start: thisMon, end: sun, label: `Week of ${wrFmtDate(thisMon)}`, type: "week" };
    }
    if (val === "this_month") {
        const s = new Date(today.getFullYear(), today.getMonth(), 1);
        const e = setEnd(new Date(today.getFullYear(), today.getMonth() + 1, 0));
        return { start: s, end: e, label: `${s.toLocaleString("default", { month: "long" })} ${s.getFullYear()}`, type: "month" };
    }
    if (val === "last_month") {
        const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const e = setEnd(new Date(today.getFullYear(), today.getMonth(), 0));
        return { start: s, end: e, label: `${s.toLocaleString("default", { month: "long" })} ${s.getFullYear()}`, type: "month" };
    }
    // ytd / fy
    const fyStart = today.getMonth() >= 3
        ? new Date(today.getFullYear(), 3, 1)
        : new Date(today.getFullYear() - 1, 3, 1);
    return { start: fyStart, end: setEnd(new Date(today)), label: `FY ${fyStart.getFullYear()}/${String(today.getFullYear()).slice(2)} YTD`, type: "fy" };
}

function wrInPeriod(dateVal, start, end) {
    if (!dateVal) return false;
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    return !isNaN(d) && d >= start && d <= end;
}

// ── Data compilation ──────────────────────────────────────────────────────────

async function wrLoadEntries() {
    let allRows = [];
    try {
        const r = await fetch(buildDowntimeApiUrl({ period: "all_years", work_orders_only: "1" }), { cache: "no-store" });
        if (r.ok) { const p = await r.json(); allRows = getWorkOrderRows(p.management); }
    } catch (_) {
        allRows = getWorkOrderRows(getManagement());
    }
    if (!assetListData.length) {
        try {
            const r = await fetch("/api/asset-list", { cache: "no-store" });
            if (r.ok) { const d = await r.json(); assetListData = d.machines || []; }
        } catch (_) {}
    }
    return buildOrganizedExportEntries(allRows, buildAssetListLookup());
}

async function wrBuildData() {
    const period = wrGetPeriod();
    const { start, end } = period;
    const entries = await wrLoadEntries();
    const now = new Date();

    const periodEntries = entries.filter(e => wrInPeriod(e.raisedDate, start, end));
    const openEntries = entries.filter(e => isNormalOpenMrStatus(e.status));
    const criticalOpen = openEntries.filter(e => e.criticality === "Critical");
    const notAck = openEntries.filter(e => isMrNewStatus(e.status) && !e.workOrder);
    const finished = entries.filter(e => isMrFinishedStatus(e.status));
    const periodFinished = periodEntries.filter(e => isMrFinishedStatus(e.status));

    // MTTR
    const ttrVals = finished.filter(e => e.ttrHours !== null).map(e => e.ttrHours);
    const avgMttr = ttrVals.length ? ttrVals.reduce((s, v) => s + v, 0) / ttrVals.length : null;

    // MTBF
    const intervals = buildExportMtbfIntervals(entries);
    const avgMtbfHours = intervals.length ? intervals.reduce((s, i) => s + i.gapHours, 0) / intervals.length : null;

    // Top 10 machines by period MR count
    const machMap = new Map();
    periodEntries.forEach(e => {
        const key = e.assetId || e.machineName; if (!key) return;
        const b = machMap.get(key) || { name: e.machineName, assetId: e.assetId, criticality: e.criticality, total: 0, open: 0 };
        b.total++; if (isNormalOpenMrStatus(e.status)) b.open++;
        machMap.set(key, b);
    });
    const topMachines = [...machMap.values()].sort((a, b) => b.total - a.total).slice(0, 10);

    // Repeated failures (all-time, >2 records)
    const repMap = new Map();
    entries.forEach(e => {
        if (!e.assetId) return;
        const b = repMap.get(e.assetId) || { name: e.machineName, count: 0 };
        b.count++; repMap.set(e.assetId, b);
    });
    const repeatedMachines = [...repMap.values()].filter(v => v.count > 2).sort((a, b) => b.count - a.count).slice(0, 5);

    // Worst MTTR machines
    const assetTtrMap = new Map();
    finished.forEach(e => {
        if (!e.assetId || e.ttrHours === null) return;
        const b = assetTtrMap.get(e.assetId) || { name: e.machineName, criticality: e.criticality, vals: [] };
        b.vals.push(e.ttrHours); assetTtrMap.set(e.assetId, b);
    });
    const worstMttr = [...assetTtrMap.values()]
        .map(v => ({ ...v, avg: v.vals.reduce((s, x) => s + x, 0) / v.vals.length }))
        .sort((a, b) => b.avg - a.avg).slice(0, 5);

    // Oldest open MR
    const oldestOpen = openEntries
        .map(e => ({ ...e, ageDays: e.raisedDate ? Math.round((now - e.raisedDate) / 86400000) : 0 }))
        .sort((a, b) => b.ageDays - a.ageDays).slice(0, 10);

    // Monthly trend (last 12 months)
    const mvMap = new Map();
    entries.forEach(e => {
        if (e.raisedDate) {
            const k = `${e.raisedDate.getFullYear()}-${String(e.raisedDate.getMonth() + 1).padStart(2, "0")}`;
            const b = mvMap.get(k) || { key: k, raised: 0, finished: 0, ttrSum: 0, ttrCount: 0 };
            b.raised++; mvMap.set(k, b);
        }
        if (isMrFinishedStatus(e.status) && e.actualEnd) {
            const k = `${e.actualEnd.getFullYear()}-${String(e.actualEnd.getMonth() + 1).padStart(2, "0")}`;
            const b = mvMap.get(k) || { key: k, raised: 0, finished: 0, ttrSum: 0, ttrCount: 0 };
            b.finished++; if (e.ttrHours !== null) { b.ttrSum += e.ttrHours; b.ttrCount++; }
            mvMap.set(k, b);
        }
    });
    const monthlyTrend = [...mvMap.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-12);

    // Data quality
    const invalidEntries = entries.filter(e => !isDataQualityValid(e.row));
    const dataReliabilityPct = entries.length ? Math.round((entries.length - invalidEntries.length) / entries.length * 100) : 100;

    // SLA — read from already-rendered DOM (avoids recomputing SLA targets)
    const sla = {
        overall: wrDomText("wo-sla-overall"),
        openOverdue: wrDomText("wo-sla-open-overdue"),
        worstSeverity: wrDomText("wo-sla-worst-severity"),
        worstRate: wrDomText("wo-sla-worst-rate"),
        reviewCount: wrDomText("wo-sla-review-count"),
        missingDates: wrDomText("wo-sla-missing-dates"),
        metCount: wrDomText("wo-sla-met-count"),
        validCount: wrDomText("wo-sla-valid-count"),
    };

    // Critical machine status from DOM
    const critMach = {
        active: wrDomText("act-count-active"),
        inactive: wrDomText("act-count-maintenance"),
        total: wrDomText("act-count-total"),
    };

    // Duplicate count from DOM
    const dupEl = document.getElementById("dup-sameday-count");
    const dupCount = dupEl ? (parseInt(dupEl.textContent) || 0) : 0;

    // Critical WO count
    const critWoCount = entries.filter(e => e.criticality === "Critical").length;

    // MIRA summary (best-effort)
    let miraSummary = "";
    try {
        const r = await fetch("/api/mira", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: `Write a 2-sentence executive summary for a weekly maintenance report. Period: ${period.label}. Open MR: ${openEntries.length}, Critical: ${criticalOpen.length}, Awaiting acknowledgement: ${notAck.length}, Avg MTTR: ${avgMttr !== null ? wrFmtHours(avgMttr) : "N/A"}, MR raised this period: ${periodEntries.length}, completed: ${periodFinished.length}. Be concise and management-focused. No bullet points.`,
            }),
            signal: AbortSignal.timeout(10000),
        });
        if (r.ok) { const d = await r.json(); miraSummary = d.reply || d.response || d.message || ""; }
    } catch (_) {}

    if (!miraSummary) {
        const rate = periodEntries.length ? Math.round(periodFinished.length / periodEntries.length * 100) : 0;
        miraSummary = `${period.label}: ${periodEntries.length} maintenance requests raised with ${periodFinished.length} completed (${rate}% closure). ${criticalOpen.length > 0 ? `${criticalOpen.length} critical open MRs require immediate management attention.` : "No critical open MRs outstanding — maintenance performance is on track."}`;
    }

    // Late/overdue rows from DOM drill-down table
    const lateRows = [];
    document.querySelectorAll("#wo-sla-drilldown-body tr").forEach(tr => {
        const cells = [...tr.querySelectorAll("td")].map(td => td.textContent.trim());
        if (cells.length >= 3 && cells.some(c => c && c !== "--" && c !== "Loading SLA exceptions.")) lateRows.push(cells);
    });

    return {
        period, entries, periodEntries, openEntries, criticalOpen, notAck,
        finished, periodFinished, topMachines, repeatedMachines, worstMttr,
        oldestOpen, avgMttr, avgMtbfHours, intervals, monthlyTrend,
        invalidEntries, dataReliabilityPct, sla, critMach, dupCount,
        miraSummary, lateRows, critWoCount,
    };
}

// ── PPT colours ───────────────────────────────────────────────────────────────

const WRC = {
    headerBg: "1e293b", headerFg: "FFFFFF",
    accent: "6366f1", green: "16a34a", amber: "d97706",
    red: "dc2626", blue: "2563eb", slate: "64748b",
    lightBg: "f8fafc", border: "e2e8f0", text: "1e293b", sub: "94a3b8",
    white: "FFFFFF",
};

function wrPptKpi(slide, x, y, w, h, label, value, valColor) {
    slide.addShape("rect", { x, y, w, h, fill: { color: WRC.lightBg }, line: { color: WRC.border, pt: 0.5 } });
    slide.addText(label, { x: x + 0.1, y: y + 0.07, w: w - 0.2, h: 0.28, fontSize: 7.5, color: WRC.sub, fontFace: "Calibri" });
    slide.addText(value, { x: x + 0.1, y: y + 0.3, w: w - 0.2, h: 0.48, fontSize: 20, bold: true, color: valColor || WRC.text, fontFace: "Calibri" });
}

function wrPptHeader(slide, title, sub) {
    slide.addShape("rect", { x: 0, y: 0, w: "100%", h: 0.88, fill: { color: WRC.headerBg } });
    slide.addText(title, { x: 0.38, y: 0.08, w: 10, h: 0.42, fontSize: 20, bold: true, color: WRC.headerFg, fontFace: "Calibri" });
    if (sub) slide.addText(sub, { x: 0.38, y: 0.5, w: 10, h: 0.28, fontSize: 9.5, color: WRC.sub, fontFace: "Calibri" });
}

function wrPptSlideNum(slide, n, total) {
    slide.addText(`${n} / ${total}`, { x: 12.1, y: 7.2, w: 1.0, h: 0.22, fontSize: 7.5, color: WRC.sub, fontFace: "Calibri", align: "right" });
}

function wrTh(text, opts = {}) {
    return { text, options: { bold: true, fontSize: 7.5, fill: { color: WRC.headerBg }, color: WRC.headerFg, fontFace: "Calibri", ...opts } };
}

function wrTd(text, opts = {}) {
    return { text: String(text ?? ""), options: { fontSize: 7, fontFace: "Calibri", ...opts } };
}

function wrTdAlt(text, i, opts = {}) {
    return wrTd(text, { fill: { color: i % 2 ? WRC.lightBg : WRC.white }, ...opts });
}

// ── PPT export ────────────────────────────────────────────────────────────────

async function exportWeeklyPPT() {
    wrSetBtnState("wr-ppt-btn", true, "PPT");
    wrSetStatus("Building PowerPoint report…", "");
    try {
        const data = await wrBuildData();
        if (typeof PptxGenJS === "undefined") {
            wrSetStatus("PptxGenJS not loaded — refresh the page and try again.", "error"); return;
        }
        const { period, periodEntries, openEntries, criticalOpen, notAck, avgMttr, avgMtbfHours,
            topMachines, repeatedMachines, worstMttr, oldestOpen, sla, critMach,
            dataReliabilityPct, invalidEntries, dupCount, monthlyTrend, miraSummary, intervals,
            lateRows, critWoCount, periodFinished } = data;

        const pptx = new PptxGenJS();
        pptx.layout = "LAYOUT_WIDE";
        pptx.title = `Weekly Maintenance Report — ${period.label}`;
        pptx.author = "SFST Dashboard";

        const now = new Date();
        const genDate = `Generated ${wrFmtDate(now)}`;
        const pl = period.label;

        // ── Slide 1: Executive Summary ────────────────────────────────────────
        const s1 = pptx.addSlide();
        s1.background = { color: WRC.white };
        s1.addShape("rect", { x: 0, y: 0, w: "100%", h: 1.12, fill: { color: WRC.headerBg } });
        s1.addText("Weekly Maintenance Report", { x: 0.38, y: 0.1, w: 10, h: 0.52, fontSize: 24, bold: true, color: WRC.headerFg, fontFace: "Calibri" });
        s1.addText(`${pl}  ·  ${genDate}`, { x: 0.38, y: 0.64, w: 10, h: 0.32, fontSize: 10.5, color: WRC.sub, fontFace: "Calibri" });
        s1.addText("EXECUTIVE SUMMARY", { x: 11.0, y: 0.82, w: 2.0, h: 0.22, fontSize: 7.5, color: "475569", fontFace: "Calibri", align: "right" });
        wrPptSlideNum(s1, 1, 5);

        const kw = 3.07, kh = 0.92, ky1 = 1.22, ky2 = 2.22;
        const kx = [0.22, 0.22 + kw + 0.11, 0.22 + (kw + 0.11) * 2, 0.22 + (kw + 0.11) * 3];
        wrPptKpi(s1, kx[0], ky1, kw, kh, "MR Raised This Period", String(periodEntries.length), WRC.accent);
        wrPptKpi(s1, kx[1], ky1, kw, kh, "Open MR (All Time)", String(openEntries.length), WRC.amber);
        wrPptKpi(s1, kx[2], ky1, kw, kh, "Critical Open MR", String(criticalOpen.length), criticalOpen.length > 0 ? WRC.red : WRC.green);
        wrPptKpi(s1, kx[3], ky1, kw, kh, "Awaiting Acknowledgement", String(notAck.length), notAck.length > 0 ? WRC.amber : WRC.green);
        wrPptKpi(s1, kx[0], ky2, kw, kh, "Avg MTTR", avgMttr !== null ? wrFmtHours(avgMttr) : "--", WRC.blue);
        wrPptKpi(s1, kx[1], ky2, kw, kh, "Avg MTBF", avgMtbfHours !== null ? wrFmtHours(avgMtbfHours) : "--", WRC.blue);
        wrPptKpi(s1, kx[2], ky2, kw, kh, "SLA Compliance", sla.overall, WRC.green);
        wrPptKpi(s1, kx[3], ky2, kw, kh, "Data Reliability", `${dataReliabilityPct}%`, dataReliabilityPct >= 90 ? WRC.green : WRC.amber);

        // Top 3 machines
        s1.addText("TOP 3 AFFECTED MACHINES — THIS PERIOD", { x: 0.22, y: 3.26, w: 9, h: 0.22, fontSize: 7.5, bold: true, color: WRC.sub, fontFace: "Calibri" });
        topMachines.slice(0, 3).forEach((m, i) => {
            const tx = 0.22 + i * 4.3;
            s1.addShape("rect", { x: tx, y: 3.52, w: 4.1, h: 0.62, fill: { color: "eff6ff" }, line: { color: "bfdbfe", pt: 0.5 } });
            s1.addText(`${i + 1}. ${(m.name || m.assetId || "--").slice(0, 30)}`, { x: tx + 0.1, y: 3.54, w: 3.85, h: 0.3, fontSize: 10.5, bold: true, color: WRC.text, fontFace: "Calibri" });
            s1.addText(`${m.total} MR total · ${m.open} open · ${m.criticality || ""}`, { x: tx + 0.1, y: 3.84, w: 3.85, h: 0.22, fontSize: 8, color: WRC.sub, fontFace: "Calibri" });
        });

        // MIRA box
        s1.addShape("rect", { x: 0.22, y: 4.28, w: 12.86, h: 1.08, fill: { color: "f0f9ff" }, line: { color: "bae6fd", pt: 0.5 } });
        s1.addText("MIRA AI SUMMARY", { x: 0.36, y: 4.33, w: 4, h: 0.22, fontSize: 7.5, bold: true, color: "0369a1", fontFace: "Calibri" });
        s1.addText(miraSummary, { x: 0.36, y: 4.55, w: 12.5, h: 0.72, fontSize: 9.5, color: WRC.text, fontFace: "Calibri", wrap: true });

        // Critical machine note
        s1.addText(`Critical Machines: Active ${critMach.active} · Inactive ${critMach.inactive} · Total ${critMach.total}`, { x: 0.22, y: 5.5, w: 8, h: 0.22, fontSize: 8, color: WRC.sub, fontFace: "Calibri" });

        // ── Slide 2: Machine Issue Focus ──────────────────────────────────────
        const s2 = pptx.addSlide();
        s2.background = { color: WRC.white };
        wrPptHeader(s2, "Machine Issue Focus", `${pl}  ·  Top affected machines and reliability watch`);
        wrPptSlideNum(s2, 2, 5);

        s2.addText("TOP 10 MACHINES BY MR/WO COUNT (PERIOD)", { x: 0.22, y: 0.96, w: 7.6, h: 0.22, fontSize: 7.5, bold: true, color: WRC.sub, fontFace: "Calibri" });
        const top10rows = [
            [wrTh("#", { align: "center" }), wrTh("Machine / Asset"), wrTh("Criticality"), wrTh("Total MR", { align: "center" }), wrTh("Open MR", { align: "center" })],
            ...topMachines.map((m, i) => [
                wrTdAlt(i + 1, i, { align: "center" }),
                wrTdAlt((m.name || m.assetId || "--").slice(0, 32), i),
                wrTdAlt(m.criticality || "--", i, { color: m.criticality === "Critical" ? WRC.red : WRC.slate }),
                wrTdAlt(m.total, i, { align: "center", bold: true }),
                wrTdAlt(m.open, i, { align: "center", color: m.open > 0 ? WRC.amber : WRC.slate }),
            ]),
        ];
        s2.addTable(top10rows, { x: 0.22, y: 1.2, w: 7.6, rowH: 0.27, colW: [0.38, 3.42, 1.4, 1.2, 1.2], fontFace: "Calibri", border: { type: "solid", pt: 0.3, color: WRC.border } });

        // Right column — repeated + worst MTTR
        s2.addText("REPEATED FAILURE MACHINES (>2 MR, ALL TIME)", { x: 8.06, y: 0.96, w: 5.0, h: 0.22, fontSize: 7.5, bold: true, color: WRC.sub, fontFace: "Calibri" });
        const repRows = [
            [wrTh("Machine / Asset"), wrTh("MR Count", { align: "center" })],
            ...(repeatedMachines.length
                ? repeatedMachines.map((m, i) => [wrTdAlt((m.name || "--").slice(0, 28), i), wrTdAlt(m.count, i, { align: "center", bold: true, color: WRC.red })])
                : [[wrTd("No repeated failures detected", { color: WRC.sub, colSpan: 2 }), wrTd("")]]),
        ];
        s2.addTable(repRows, { x: 8.06, y: 1.2, w: 5.0, rowH: 0.27, colW: [3.6, 1.4], fontFace: "Calibri", border: { type: "solid", pt: 0.3, color: WRC.border } });

        s2.addText("WORST MTTR MACHINES (ALL TIME)", { x: 8.06, y: 3.3, w: 5.0, h: 0.22, fontSize: 7.5, bold: true, color: WRC.sub, fontFace: "Calibri" });
        const mttrRows = [
            [wrTh("Machine / Asset"), wrTh("Avg MTTR", { align: "right" })],
            ...(worstMttr.length
                ? worstMttr.map((m, i) => [wrTdAlt((m.name || "--").slice(0, 28), i), wrTdAlt(wrFmtHours(m.avg), i, { align: "right", bold: true, color: WRC.red })])
                : [[wrTd("No MTTR data available", { color: WRC.sub, colSpan: 2 }), wrTd("")]]),
        ];
        s2.addTable(mttrRows, { x: 8.06, y: 3.55, w: 5.0, rowH: 0.27, colW: [3.6, 1.4], fontFace: "Calibri", border: { type: "solid", pt: 0.3, color: WRC.border } });

        s2.addText("OLDEST OPEN MR", { x: 0.22, y: 4.98, w: 7.6, h: 0.22, fontSize: 7.5, bold: true, color: WRC.sub, fontFace: "Calibri" });
        const oldestRows = [
            [wrTh("MR / WO"), wrTh("Machine / Asset"), wrTh("Severity", { align: "center" }), wrTh("Raised Date", { align: "center" }), wrTh("Age (d)", { align: "right" })],
            ...(oldestOpen.slice(0, 5).map((e, i) => [
                wrTdAlt((e.maintenanceRequest || "--").slice(0, 18), i),
                wrTdAlt((e.machineName || "--").slice(0, 28), i),
                wrTdAlt(e.serviceLevel || "--", i, { align: "center" }),
                wrTdAlt(e.raisedDate ? wrFmtDate(e.raisedDate) : "--", i, { align: "center" }),
                wrTdAlt(e.ageDays || 0, i, { align: "right", bold: true, color: e.ageDays > 30 ? WRC.red : WRC.amber }),
            ])),
        ];
        s2.addTable(oldestRows, { x: 0.22, y: 5.22, w: 7.6, rowH: 0.27, colW: [1.9, 2.6, 0.9, 1.3, 0.9], fontFace: "Calibri", border: { type: "solid", pt: 0.3, color: WRC.border } });

        // ── Slide 3: SLA and Open Work Orders ────────────────────────────────
        const s3 = pptx.addSlide();
        s3.background = { color: WRC.white };
        wrPptHeader(s3, "SLA and Open Work Orders", `${pl}  ·  Response and completion performance`);
        wrPptSlideNum(s3, 3, 5);

        const sk = 3.07, shy = 1.0;
        const skx = [0.22, 0.22 + sk + 0.11, 0.22 + (sk + 0.11) * 2, 0.22 + (sk + 0.11) * 3];
        wrPptKpi(s3, skx[0], shy, sk, 0.9, "SLA Compliance", sla.overall, WRC.green);
        wrPptKpi(s3, skx[1], shy, sk, 0.9, "Overdue Open WOs", sla.openOverdue, sla.openOverdue !== "0" && sla.openOverdue !== "--" ? WRC.red : WRC.green);
        wrPptKpi(s3, skx[2], shy, sk, 0.9, "Worst Severity", sla.worstSeverity !== "--" ? `${sla.worstSeverity} (${sla.worstRate})` : "--", WRC.amber);
        wrPptKpi(s3, skx[3], shy, sk, 0.9, "Missing SLA Data", sla.reviewCount, WRC.slate);

        s3.addText("LATE / OVERDUE WORK ORDERS", { x: 0.22, y: 2.05, w: 12.86, h: 0.22, fontSize: 7.5, bold: true, color: WRC.sub, fontFace: "Calibri" });
        s3.addText("Source: SLA Response tab — Late, Open Overdue, and Missing Data records. Navigate to the SLA tab before exporting to ensure this data is loaded.", { x: 0.22, y: 2.26, w: 12.86, h: 0.2, fontSize: 7, color: WRC.sub, fontFace: "Calibri", italic: true });

        if (lateRows.length > 0) {
            const lateTableRows = [
                ["WO ID", "Equipment / Asset", "Severity", "Created Date", "Actual Start", "Actual End", "Target", "Duration", "Delay", "SLA Status"].map(h => wrTh(h)),
                ...lateRows.slice(0, 14).map((row, i) => row.map((cell, ci) => wrTdAlt(
                    (cell || "--").slice(0, ci === 1 ? 30 : 18), i,
                    { color: ci === 9 && cell.includes("Overdue") ? WRC.red : ci === 9 && cell.includes("Late") ? WRC.amber : WRC.text },
                ))),
            ];
            s3.addTable(lateTableRows, { x: 0.22, y: 2.5, w: 12.86, rowH: 0.26, fontFace: "Calibri", border: { type: "solid", pt: 0.3, color: WRC.border } });
        } else {
            s3.addShape("rect", { x: 0.22, y: 2.5, w: 12.86, h: 0.55, fill: { color: "f0fdf4" }, line: { color: "bbf7d0", pt: 0.5 } });
            s3.addText("No late or overdue work orders found. Navigate to the SLA tab first to populate this data.", { x: 0.36, y: 2.64, w: 12.5, h: 0.28, fontSize: 9.5, color: WRC.green, fontFace: "Calibri" });
        }

        // ── Slide 4: Reliability Trend ────────────────────────────────────────
        const s4 = pptx.addSlide();
        s4.background = { color: WRC.white };
        wrPptHeader(s4, "Reliability Trend", `Last 12 months  ·  MR movement and repair performance`);
        wrPptSlideNum(s4, 4, 5);

        const rk = 3.07, rky = 1.0;
        const rkx = [0.22, 0.22 + rk + 0.11, 0.22 + (rk + 0.11) * 2, 0.22 + (rk + 0.11) * 3];
        wrPptKpi(s4, rkx[0], rky, rk, 0.9, "MTBF Intervals (All Time)", String(intervals.length), WRC.blue);
        wrPptKpi(s4, rkx[1], rky, rk, 0.9, "Avg MTBF", avgMtbfHours !== null ? wrFmtHours(avgMtbfHours) : "--", WRC.blue);
        wrPptKpi(s4, rkx[2], rky, rk, 0.9, "Avg MTTR (All Time)", avgMttr !== null ? wrFmtHours(avgMttr) : "--", WRC.accent);
        wrPptKpi(s4, rkx[3], rky, rk, 0.9, "Critical Asset WO Count", String(critWoCount), critWoCount > 0 ? WRC.red : WRC.green);

        s4.addText("MONTHLY MR MOVEMENT — LAST 12 MONTHS", { x: 0.22, y: 2.03, w: 12.86, h: 0.22, fontSize: 7.5, bold: true, color: WRC.sub, fontFace: "Calibri" });
        const trendRows = [
            [wrTh("Month"), wrTh("MR Raised", { align: "center" }), wrTh("MR Finished", { align: "center" }), wrTh("Net Change", { align: "center" }), wrTh("Avg MTTR", { align: "right" }), wrTh("Closure Rate", { align: "right" })],
            ...monthlyTrend.map((m, i) => {
                const net = m.finished - m.raised;
                const cr = m.raised > 0 ? Math.round(m.finished / m.raised * 100) : null;
                return [
                    wrTdAlt(m.key, i),
                    wrTdAlt(m.raised, i, { align: "center" }),
                    wrTdAlt(m.finished, i, { align: "center" }),
                    wrTdAlt(net >= 0 ? `+${net}` : String(net), i, { align: "center", bold: true, color: net > 0 ? WRC.red : net < 0 ? WRC.green : WRC.slate }),
                    wrTdAlt(m.ttrCount ? `${exportRound2(m.ttrSum / m.ttrCount)}h` : "--", i, { align: "right" }),
                    wrTdAlt(cr !== null ? `${cr}%` : "--", i, { align: "right", color: cr >= 80 ? WRC.green : cr >= 60 ? WRC.amber : WRC.red }),
                ];
            }),
        ];
        s4.addTable(trendRows, { x: 0.22, y: 2.28, w: 12.86, rowH: 0.27, colW: [1.9, 1.9, 1.9, 1.7, 2.2, 2.2], fontFace: "Calibri", border: { type: "solid", pt: 0.3, color: WRC.border } });
        s4.addText("Net Change: positive = more raised than finished (backlog growing). Negative = more resolved than raised.", { x: 0.22, y: 6.82, w: 12.86, h: 0.22, fontSize: 7, color: WRC.sub, fontFace: "Calibri", italic: true });

        // ── Slide 5: Data Quality ─────────────────────────────────────────────
        const s5 = pptx.addSlide();
        s5.background = { color: WRC.white };
        wrPptHeader(s5, "Data Quality and Action List", `${pl}  ·  Records requiring correction and follow-up`);
        wrPptSlideNum(s5, 5, 5);

        const dqw = 2.52, dqy = 1.0;
        const dqx = [0.22, 0.22 + dqw + 0.1, 0.22 + (dqw + 0.1) * 2, 0.22 + (dqw + 0.1) * 3, 0.22 + (dqw + 0.1) * 4];
        wrPptKpi(s5, dqx[0], dqy, dqw, 0.9, "Data Reliability", `${dataReliabilityPct}%`, dataReliabilityPct >= 90 ? WRC.green : WRC.amber);
        wrPptKpi(s5, dqx[1], dqy, dqw, 0.9, "Invalid Work Orders", String(invalidEntries.length), invalidEntries.length > 0 ? WRC.red : WRC.green);
        wrPptKpi(s5, dqx[2], dqy, dqw, 0.9, "Missing SLA Data", sla.reviewCount, WRC.amber);
        wrPptKpi(s5, dqx[3], dqy, dqw, 0.9, "Duplicate WOs", String(dupCount), dupCount > 0 ? WRC.amber : WRC.green);
        wrPptKpi(s5, dqx[4], dqy, dqw, 0.9, "Missing Start / End", sla.missingDates, WRC.slate);

        s5.addText("RECORDS REQUIRING CORRECTION (TOP 15)", { x: 0.22, y: 2.05, w: 12.86, h: 0.22, fontSize: 7.5, bold: true, color: WRC.sub, fontFace: "Calibri" });

        if (invalidEntries.length > 0) {
            const corrRows = [
                [wrTh("MR / WO"), wrTh("Asset / Machine"), wrTh("Status"), wrTh("Data Quality Flag"), wrTh("Created / Raised", { align: "center" }), wrTh("Suggested Action")],
                ...invalidEntries.slice(0, 15).map((e, i) => {
                    const flag = (e.dataQuality || "Review").slice(0, 32);
                    const fl = flag.toLowerCase();
                    const action = fl.includes("duplicate") ? "Resolve duplicate entry"
                        : fl.includes("missing") ? "Add missing date / asset data"
                        : fl.includes("review") ? "Confirm or update WO status"
                        : "Review and correct record";
                    return [
                        wrTdAlt((e.maintenanceRequest || e.workOrder || "--").slice(0, 18), i),
                        wrTdAlt((e.machineName || "--").slice(0, 26), i),
                        wrTdAlt((e.status || "--").slice(0, 16), i),
                        wrTdAlt(flag, i, { color: WRC.red }),
                        wrTdAlt(e.raisedDate ? wrFmtDate(e.raisedDate) : "--", i, { align: "center" }),
                        wrTdAlt(action, i, { color: WRC.blue }),
                    ];
                }),
            ];
            s5.addTable(corrRows, { x: 0.22, y: 2.3, w: 12.86, rowH: 0.27, colW: [1.8, 2.5, 1.5, 2.8, 1.6, 2.6], fontFace: "Calibri", border: { type: "solid", pt: 0.3, color: WRC.border } });
        } else {
            s5.addShape("rect", { x: 0.22, y: 2.3, w: 12.86, h: 0.55, fill: { color: "f0fdf4" }, line: { color: "bbf7d0", pt: 0.5 } });
            s5.addText("No data quality issues found. All records are valid.", { x: 0.36, y: 2.44, w: 12.5, h: 0.28, fontSize: 10, color: WRC.green, fontFace: "Calibri" });
        }

        s5.addText(`Excel Appendix available for full drill-down on all sections.  ·  ${genDate}`, { x: 0.22, y: 7.06, w: 12.86, h: 0.22, fontSize: 7.5, color: WRC.sub, fontFace: "Calibri", italic: true });

        const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
        await pptx.writeFile({ fileName: `maintenance_report_${ts}.pptx` });
        wrSetStatus("PowerPoint report generated successfully.", "ok");

    } catch (err) {
        console.error("PPT export failed:", err);
        wrSetStatus(`PPT export failed: ${err.message}`, "error");
    } finally {
        wrSetBtnState("wr-ppt-btn", false, "PPT");
    }
}

// ── PDF (print window) ────────────────────────────────────────────────────────

async function exportWeeklyPDF() {
    wrSetBtnState("wr-pdf-btn", true, "PDF");
    wrSetStatus("Building PDF report…", "");
    try {
        const data = await wrBuildData();
        const html = wrBuildPdfHtml(data);
        const win = window.open("", "_blank", "width=1120,height=860,scrollbars=yes");
        if (!win) { wrSetStatus("Popup blocked — allow popups and try again.", "error"); return; }
        win.document.write(html);
        win.document.close();
        wrSetStatus("Report opened. Click 'Print / Save as PDF' in the new window.", "ok");
    } catch (err) {
        console.error("PDF export failed:", err);
        wrSetStatus(`PDF export failed: ${err.message}`, "error");
    } finally {
        wrSetBtnState("wr-pdf-btn", false, "PDF");
    }
}

function wrBuildPdfHtml(data) {
    const { period, periodEntries, openEntries, criticalOpen, notAck, avgMttr, avgMtbfHours,
        topMachines, repeatedMachines, worstMttr, oldestOpen, sla, critMach,
        dataReliabilityPct, invalidEntries, dupCount, monthlyTrend, miraSummary,
        intervals, lateRows, critWoCount, periodFinished } = data;

    const now = new Date();
    const escHtml = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const kpi = (label, value, cls = "") => `<div class="kpi-card"><div class="kpi-label">${escHtml(label)}</div><div class="kpi-value ${cls}">${escHtml(String(value))}</div></div>`;

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Weekly Maintenance Report — ${escHtml(period.label)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:11px;color:#1e293b;background:#fff;line-height:1.4}
@page{size:A4 landscape;margin:14mm 14mm 14mm 14mm}
@media print{.no-print{display:none!important}.page-break{page-break-after:always;height:0}}
.no-print{padding:10px 24px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:14px}
.print-btn{padding:7px 18px;background:#1e293b;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600}
.page{padding:18px 22px;max-width:100%}
.report-header{background:#1e293b;color:#fff;padding:14px 20px;margin-bottom:16px;border-radius:4px}
.report-header h1{font-size:20px;font-weight:700;margin-bottom:3px}
.report-header .sub{color:#94a3b8;font-size:10px}
.page-title{font-size:14px;font-weight:700;border-bottom:2px solid #6366f1;padding-bottom:5px;margin:14px 0 12px}
.section-label{font-size:8.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin:12px 0 7px}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
.kpi-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;padding:8px 10px}
.kpi-label{font-size:8px;color:#64748b;margin-bottom:3px}
.kpi-value{font-size:19px;font-weight:700;color:#1e293b}
.kpi-value.green{color:#16a34a}.kpi-value.red{color:#dc2626}.kpi-value.amber{color:#d97706}.kpi-value.blue{color:#2563eb}.kpi-value.purple{color:#6366f1}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:18px}
table{width:100%;border-collapse:collapse;font-size:9.5px;margin-bottom:12px}
th{background:#1e293b;color:#fff;padding:5px 7px;text-align:left;font-size:8.5px;font-weight:600}
td{padding:4px 7px;border-bottom:1px solid #e2e8f0}
tr:nth-child(even) td{background:#f8fafc}
.txt-right{text-align:right}.txt-center{text-align:center}
.fw{font-weight:700}.ok{color:#16a34a}.warn{color:#d97706}.bad{color:#dc2626}.muted{color:#64748b}
.top3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.top3-card{background:#eff6ff;border:1px solid #bfdbfe;border-radius:5px;padding:7px 10px}
.top3-name{font-size:11px;font-weight:700;margin-bottom:2px}
.top3-sub{font-size:8.5px;color:#64748b}
.mira-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:5px;padding:10px 12px;margin:12px 0}
.mira-lbl{font-size:8px;font-weight:700;color:#0369a1;margin-bottom:5px}
.footer{margin-top:16px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:8px;color:#94a3b8}
.ok-box{padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:5px;color:#16a34a;font-size:10px}
</style></head><body>
<div class="no-print">
  <button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
  <span style="font-size:11px;color:#64748b">Weekly Maintenance Report — ${escHtml(period.label)}</span>
</div>

<div class="page">
  <div class="report-header"><h1>Weekly Maintenance Report</h1><div class="sub">${escHtml(period.label)} &nbsp;·&nbsp; Generated ${wrFmtDate(now)}</div></div>
  <div class="page-title">Executive Summary</div>
  <div class="kpi-grid">
    ${kpi("MR Raised This Period", periodEntries.length, "purple")}
    ${kpi("Open MR (All Time)", openEntries.length, "amber")}
    ${kpi("Critical Open MR", criticalOpen.length, criticalOpen.length > 0 ? "red" : "green")}
    ${kpi("Awaiting Acknowledgement", notAck.length, notAck.length > 0 ? "amber" : "green")}
    ${kpi("Avg MTTR", avgMttr !== null ? wrFmtHours(avgMttr) : "--", "blue")}
    ${kpi("Avg MTBF", avgMtbfHours !== null ? wrFmtHours(avgMtbfHours) : "--", "blue")}
    ${kpi("SLA Compliance", sla.overall, "green")}
    ${kpi("Data Reliability", `${dataReliabilityPct}%`, dataReliabilityPct >= 90 ? "green" : "amber")}
  </div>
  <div class="section-label">Top 3 Affected Machines — This Period</div>
  <div class="top3">${topMachines.slice(0, 3).map((m, i) => `<div class="top3-card"><div class="top3-name">${i + 1}. ${escHtml((m.name || m.assetId || "--").slice(0, 36))}</div><div class="top3-sub">${m.total} MR &nbsp;·&nbsp; ${m.open} open &nbsp;·&nbsp; ${escHtml(m.criticality || "")}</div></div>`).join("")}</div>
  <div class="mira-box"><div class="mira-lbl">MIRA AI SUMMARY</div><div>${escHtml(miraSummary)}</div></div>
  <div style="font-size:9px;color:#94a3b8">Critical Machines: Active ${escHtml(critMach.active)} &nbsp;·&nbsp; Inactive ${escHtml(critMach.inactive)} &nbsp;·&nbsp; Total ${escHtml(critMach.total)}</div>
</div>
<div class="page-break"></div>

<div class="page">
  <div class="page-title">Machine Issue Focus</div>
  <div class="two-col">
    <div>
      <div class="section-label">Top 10 Machines by MR/WO Count (Period)</div>
      <table><thead><tr><th>#</th><th>Machine / Asset</th><th>Criticality</th><th class="txt-center">Total</th><th class="txt-center">Open</th></tr></thead><tbody>
        ${topMachines.map((m, i) => `<tr><td class="txt-center muted">${i + 1}</td><td>${escHtml((m.name || m.assetId || "--").slice(0, 32))}</td><td class="${m.criticality === "Critical" ? "bad fw" : "muted"}">${escHtml(m.criticality || "--")}</td><td class="txt-center fw">${m.total}</td><td class="txt-center ${m.open > 0 ? "warn fw" : "muted"}">${m.open}</td></tr>`).join("") || `<tr><td colspan="5" class="muted txt-center">No data for this period</td></tr>`}
      </tbody></table>
    </div>
    <div>
      <div class="section-label">Repeated Failure Machines (All Time, >2 MR)</div>
      <table><thead><tr><th>Machine / Asset</th><th class="txt-center">MR Count</th></tr></thead><tbody>
        ${repeatedMachines.map(m => `<tr><td>${escHtml((m.name || "--").slice(0, 30))}</td><td class="txt-center bad fw">${m.count}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">No repeated failures detected</td></tr>`}
      </tbody></table>
      <div class="section-label">Worst MTTR Machines (All Time)</div>
      <table><thead><tr><th>Machine / Asset</th><th class="txt-right">Avg MTTR</th></tr></thead><tbody>
        ${worstMttr.map(m => `<tr><td>${escHtml((m.name || "--").slice(0, 30))}</td><td class="txt-right bad fw">${wrFmtHours(m.avg)}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">No MTTR data</td></tr>`}
      </tbody></table>
    </div>
  </div>
  <div class="section-label">Oldest Open MR</div>
  <table><thead><tr><th>MR / WO</th><th>Machine / Asset</th><th>Severity</th><th class="txt-center">Raised Date</th><th class="txt-right">Age (Days)</th></tr></thead><tbody>
    ${oldestOpen.slice(0, 8).map(e => `<tr><td>${escHtml(e.maintenanceRequest || "--")}</td><td>${escHtml((e.machineName || "--").slice(0, 34))}</td><td>${escHtml(e.serviceLevel || "--")}</td><td class="txt-center">${e.raisedDate ? wrFmtDate(e.raisedDate) : "--"}</td><td class="txt-right fw ${e.ageDays > 30 ? "bad" : "warn"}">${e.ageDays}</td></tr>`).join("") || `<tr><td colspan="5" class="muted txt-center">No open MRs</td></tr>`}
  </tbody></table>
</div>
<div class="page-break"></div>

<div class="page">
  <div class="page-title">SLA and Open Work Orders</div>
  <div class="kpi-grid">
    ${kpi("SLA Compliance %", sla.overall, "green")}
    ${kpi("Overdue Open WOs", sla.openOverdue, sla.openOverdue !== "0" && sla.openOverdue !== "--" ? "red" : "green")}
    ${kpi("Worst Performing Severity", sla.worstSeverity !== "--" ? `${sla.worstSeverity} (${sla.worstRate})` : "--", "amber")}
    ${kpi("Missing SLA Data", sla.reviewCount, "")}
  </div>
  <div class="section-label">Late / Overdue Work Orders</div>
  ${lateRows.length > 0
      ? `<table><thead><tr><th>WO ID</th><th>Equipment / Asset</th><th>Severity</th><th>Created</th><th>Start</th><th>End</th><th>Target</th><th>Duration</th><th>Delay</th><th>SLA Status</th></tr></thead><tbody>${lateRows.slice(0, 20).map(row => `<tr>${row.map((c, ci) => `<td class="${ci === 9 && c.includes("Overdue") ? "bad fw" : ci === 9 && c.includes("Late") ? "warn fw" : ""}">${escHtml((c || "--").slice(0, ci === 1 ? 34 : 22))}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      : `<div class="ok-box">No late or overdue work orders found. Visit the SLA tab first to populate this section.</div>`}
</div>
<div class="page-break"></div>

<div class="page">
  <div class="page-title">Reliability Trend</div>
  <div class="kpi-grid">
    ${kpi("MTBF Intervals (All Time)", intervals.length, "blue")}
    ${kpi("Avg MTBF", avgMtbfHours !== null ? wrFmtHours(avgMtbfHours) : "--", "blue")}
    ${kpi("Avg MTTR (All Time)", avgMttr !== null ? wrFmtHours(avgMttr) : "--", "purple")}
    ${kpi("Critical Asset WO Count", critWoCount, critWoCount > 0 ? "red" : "green")}
  </div>
  <div class="section-label">Monthly MR Movement — Last 12 Months</div>
  <table><thead><tr><th>Month</th><th class="txt-center">MR Raised</th><th class="txt-center">MR Finished</th><th class="txt-center">Net Change</th><th class="txt-right">Avg MTTR</th><th class="txt-right">Closure Rate</th></tr></thead><tbody>
    ${monthlyTrend.map(m => {
        const net = m.finished - m.raised;
        const cr = m.raised > 0 ? Math.round(m.finished / m.raised * 100) : null;
        return `<tr><td>${escHtml(m.key)}</td><td class="txt-center">${m.raised}</td><td class="txt-center">${m.finished}</td><td class="txt-center fw ${net > 0 ? "bad" : net < 0 ? "ok" : "muted"}">${net > 0 ? "+" : ""}${net}</td><td class="txt-right">${m.ttrCount ? exportRound2(m.ttrSum / m.ttrCount) + "h" : "--"}</td><td class="txt-right fw ${cr >= 80 ? "ok" : cr >= 60 ? "warn" : cr !== null ? "bad" : "muted"}">${cr !== null ? cr + "%" : "--"}</td></tr>`;
    }).join("")}
  </tbody></table>
  <div style="font-size:8px;color:#94a3b8;margin-top:-8px">Net Change: positive = backlog growing; negative = more resolved than raised.</div>
</div>
<div class="page-break"></div>

<div class="page">
  <div class="page-title">Data Quality and Action List</div>
  <div class="kpi-grid" style="grid-template-columns:repeat(5,1fr)">
    ${kpi("Data Reliability", `${dataReliabilityPct}%`, dataReliabilityPct >= 90 ? "green" : "amber")}
    ${kpi("Invalid Work Orders", invalidEntries.length, invalidEntries.length > 0 ? "red" : "green")}
    ${kpi("Missing SLA Data", sla.reviewCount, "amber")}
    ${kpi("Duplicate WOs", dupCount, dupCount > 0 ? "amber" : "green")}
    ${kpi("Missing Start / End", sla.missingDates, "")}
  </div>
  <div class="section-label">Records Requiring Correction</div>
  ${invalidEntries.length > 0
      ? `<table><thead><tr><th>MR / WO</th><th>Asset / Machine</th><th>Status</th><th>Data Quality Flag</th><th class="txt-center">Created / Raised</th><th>Suggested Action</th></tr></thead><tbody>${invalidEntries.slice(0, 15).map(e => {
          const flag = (e.dataQuality || "Review").slice(0, 36);
          const fl = flag.toLowerCase();
          const action = fl.includes("duplicate") ? "Resolve duplicate entry" : fl.includes("missing") ? "Add missing date / asset data" : fl.includes("review") ? "Confirm or update WO status" : "Review and correct record";
          return `<tr><td>${escHtml((e.maintenanceRequest || e.workOrder || "--").slice(0, 18))}</td><td>${escHtml((e.machineName || "--").slice(0, 28))}</td><td>${escHtml((e.status || "--").slice(0, 16))}</td><td class="bad">${escHtml(flag)}</td><td class="txt-center">${e.raisedDate ? wrFmtDate(e.raisedDate) : "--"}</td><td class="warn">${escHtml(action)}</td></tr>`;
      }).join("")}</tbody></table>`
      : `<div class="ok-box">No data quality issues. All records are valid.</div>`}
  <div class="footer">Weekly Maintenance Report &nbsp;·&nbsp; ${escHtml(period.label)} &nbsp;·&nbsp; Generated ${wrFmtDate(now)} &nbsp;·&nbsp; SFST Dashboard</div>
</div>
</body></html>`;
}

// ── Excel Appendix ────────────────────────────────────────────────────────────

async function exportWeeklyExcel() {
    wrSetBtnState("wr-xl-btn", true, "Excel");
    wrSetStatus("Building Excel appendix…", "");
    try {
        if (typeof XLSX === "undefined") { wrSetStatus("XLSX library not loaded.", "error"); return; }
        const data = await wrBuildData();
        const { period, entries, openEntries, invalidEntries, intervals } = data;
        const now = new Date();

        const wb = XLSX.utils.book_new();
        wb.Props = { Title: `Weekly Maintenance Report Appendix — ${period.label}`, Author: "SFST Dashboard", CreatedDate: now };

        const addSheet = (name, headers, rows, widths = []) => {
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            if (headers.length) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } }) };
            if (widths.length) ws["!cols"] = widths.map(w => ({ wch: w }));
            XLSX.utils.book_append_sheet(wb, ws, name);
        };

        // 1. Outstanding MR
        const outRows = openEntries
            .map(e => ({ ...e, ageDays: e.raisedDate ? Math.round((now - e.raisedDate) / 86400000) : null }))
            .sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0))
            .map(e => [
                e.maintenanceRequest || "", e.workOrder || "", e.assetId || "", e.machineName || "",
                e.criticality || "", e.machineGroup || "", e.serviceLevel || "", e.status || "",
                e.raisedDate ? exportFmtDate(e.raisedDate) : "", e.ageDays ?? "",
                e.acknowledgement || "", e.description || "", e.startedBy || "", e.createdBy || "",
            ]);
        addSheet("Outstanding_MR",
            ["Maintenance Request", "Work Order", "Asset ID", "Machine / Asset", "Criticality", "Machine Group", "Severity", "Status", "Raised Date", "Age (Days)", "Ack Status", "Description", "Started By", "Created By"],
            outRows, [18, 16, 14, 28, 14, 22, 10, 14, 16, 10, 20, 40, 18, 18]);

        // 2. Machine MR Summary
        const machMap = new Map();
        entries.forEach(e => {
            const key = e.assetId || e.machineName; if (!key) return;
            const b = machMap.get(key) || { name: e.machineName, assetId: e.assetId, criticality: e.criticality, group: e.machineGroup, total: 0, open: 0, finished: 0, notAck: 0, ttrVals: [], oldestAge: 0, invalid: 0 };
            b.total++;
            if (isNormalOpenMrStatus(e.status)) { b.open++; if (e.raisedDate) b.oldestAge = Math.max(b.oldestAge, Math.round((now - e.raisedDate) / 86400000)); }
            if (isMrFinishedStatus(e.status)) b.finished++;
            if (isMrNewStatus(e.status) && !e.workOrder) b.notAck++;
            if (e.ttrHours !== null) b.ttrVals.push(e.ttrHours);
            if (!isDataQualityValid(e.row)) b.invalid++;
            machMap.set(key, b);
        });
        const machSumRows = [...machMap.values()].sort((a, b) => b.total - a.total).map(m => {
            const avgTtr = m.ttrVals.length ? exportRound2(m.ttrVals.reduce((s, v) => s + v, 0) / m.ttrVals.length) : "";
            return [m.name || "", m.assetId || "", m.criticality || "", m.group || "", m.total, m.open, m.finished, m.notAck, m.total ? exportPercent(m.finished / m.total * 100) : "", avgTtr, m.oldestAge || "", m.invalid];
        });
        addSheet("Machine_MR_Summary",
            ["Machine / Asset", "Asset ID", "Criticality", "Machine Group", "Total MR", "Open MR", "Finished MR", "Not Acknowledged", "Closure Rate", "Avg TTR Hours", "Oldest Open Age (Days)", "Invalid Records"],
            machSumRows, [30, 14, 14, 22, 10, 10, 12, 16, 14, 14, 22, 16]);

        // 3. SLA Late / Overdue (from DOM)
        const lateDomRows = [];
        document.querySelectorAll("#wo-sla-drilldown-body tr").forEach(tr => {
            const cells = [...tr.querySelectorAll("td")].map(td => td.textContent.trim());
            if (cells.length >= 3 && cells.some(c => c && c !== "--")) lateDomRows.push(cells);
        });
        addSheet("SLA_Late_Overdue",
            ["WO ID", "Equipment / Asset", "Severity / Priority", "Created Date", "Actual Start Date", "Actual End Date", "Target", "Actual Duration", "Delay", "SLA Status"],
            lateDomRows.length ? lateDomRows : [["No late or overdue records found"]], [18, 32, 16, 16, 18, 18, 12, 18, 14, 18]);

        // 4. Data Reliability Records
        const drRows = invalidEntries.map(e => [
            e.maintenanceRequest || "", e.workOrder || "", e.assetId || "", e.machineName || "",
            e.status || "", e.dataQuality || "", e.acknowledgement || "",
            e.raisedDate ? exportFmtDate(e.raisedDate) : "",
            e.actualStart ? exportFmtDate(e.actualStart) : "",
            e.actualEnd ? exportFmtDate(e.actualEnd) : "",
            e.description || "",
        ]);
        addSheet("Data_Reliability_Records",
            ["Maintenance Request", "Work Order", "Asset ID", "Machine / Asset", "Status", "Data Quality Flag", "Ack Status", "Created Date", "Actual Start", "Actual End", "Description"],
            drRows.length ? drRows : [["No invalid records"]], [18, 16, 14, 28, 14, 36, 22, 16, 16, 16, 40]);

        // 5. Machine Explorer History (all entries)
        const histRows = [...entries]
            .sort((a, b) => String(a.machineGroup || "").localeCompare(String(b.machineGroup || "")) || compareLatestMrDateDesc(a.row, b.row))
            .map(e => [
                e.maintenanceRequest || "", e.workOrder || "", e.assetId || "", e.machineName || "",
                e.criticality || "", e.machineGroup || "", e.status || "", e.serviceLevel || "", e.type || "",
                e.description || "", e.translatedDescription || "",
                e.startedBy || "", e.createdBy || "",
                e.raisedDate ? exportFmtDate(e.raisedDate) : "",
                e.actualStart ? exportFmtDate(e.actualStart) : "",
                e.actualEnd ? exportFmtDate(e.actualEnd) : "",
                e.ttrHours !== null ? exportRound2(e.ttrHours) : "",
                e.acknowledgement || "", e.dataQuality || "",
            ]);
        addSheet("Machine_Explorer_History",
            ["Maintenance Request", "Work Order", "Asset ID", "Machine / Asset", "Criticality", "Machine Group", "Status", "Severity", "Type", "Description", "Translated Description", "Started By", "Created By", "Created Date", "Actual Start", "Actual End", "TTR Hours", "Ack Status", "Data Quality Flag"],
            histRows, [18, 16, 14, 28, 14, 22, 14, 10, 14, 40, 40, 18, 18, 16, 16, 16, 12, 22, 36]);

        // 6. Duplicate WO Detection (from DOM)
        const dupRows = [];
        document.querySelectorAll("#dup-sameday-panel").forEach(panel => {
            panel.querySelectorAll("table tr").forEach(tr => {
                const cells = [...tr.querySelectorAll("td,th")].map(el => el.textContent.trim());
                if (cells.length >= 2 && cells.some(c => c)) dupRows.push(cells);
            });
        });
        addSheet("Duplicate_WO_Detection",
            ["WO / MR ID", "Asset", "Description", "Raised Date", "Status"],
            dupRows.length ? dupRows : [["No duplicates detected"]], [20, 28, 40, 16, 16]);

        const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
        XLSX.writeFile(wb, `maintenance_report_appendix_${ts}.xlsx`);
        wrSetStatus("Excel appendix generated successfully.", "ok");

    } catch (err) {
        console.error("Excel appendix failed:", err);
        wrSetStatus(`Excel export failed: ${err.message}`, "error");
    } finally {
        wrSetBtnState("wr-xl-btn", false, "Excel");
    }
}
