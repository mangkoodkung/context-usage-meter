// Context Usage Meter — Stage 1 (meter + overflow warning + manual compact)
// Scope: Chat Completion only. Does NOT auto-mutate the chat. Compaction is user-initiated.
// Verify-in-test items are marked with: // VERIFY

import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, generateQuietPrompt } from "../../../../script.js";
import { eventSource, event_types } from "../../../events.js";
import { getTokenCountAsync } from "../../../tokenizers.js";

const extensionName = "context-usage-meter";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const defaultSettings = {
    enabled: true,
    thresholdPct: 80,     // warn (amber) at this % of context
    reserveOverride: 0,   // 0 = auto-detect Response Reserve from ST
    keepLast: 10,         // messages kept visible after compaction
    autoWarnToast: true,  // toast when prompt crosses the overflow line / threshold
    lastRecap: "",        // remembered last recap (for reopen)
    colorTheme: "basic",  // bar color scheme (preset name or "custom")
    customPrompt: "#ff9ecd",
    customOver: "#ff477e",
    customReserve: "#c9a7f0",
    savedThemes: [],      // user-saved custom color sets: [{name, prompt, over, reserve}]
};

let isCompacting = false;
let isRecapping = false;
let recapText = "";
let lastStats = null;
let prevDanger = false;
let prevWarn = false;
let oaiSettings = null; // linked to ST's live Chat Completion settings (source of truth for context/reserve)

/* ---------------- settings ---------------- */
function getSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];
    for (const k in defaultSettings) if (s[k] === undefined) s[k] = defaultSettings[k];
    return s;
}

/* ---------------- helpers ---------------- */
// read a field and any twin (ST pairs a slider + a number "counter"); take the larger,
// because a typed value beats a slider that got clamped to its max.
function readNumMax(...ids) {
    let best = 0;
    for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const v = Number(el.value);
        if (Number.isFinite(v) && v > best) best = v;
    }
    return best;
}

function getMaxContext() {
    if (oaiSettings && Number(oaiSettings.openai_max_context) > 0) return Number(oaiSettings.openai_max_context);
    let m = Math.max(
        readNumMax("openai_max_context", "openai_max_context_counter"),
        readNumMax("max_context", "max_context_counter"),
    );
    if (!m) { try { m = Number(getContext().maxContext) || 0; } catch (e) { /* ignore */ } }
    return m > 0 ? m : 4096;
}

function getReserve() {
    const s = getSettings();
    if (s.reserveOverride > 0) return s.reserveOverride;                     // manual override wins
    if (oaiSettings && Number(oaiSettings.openai_max_tokens) > 0) return Number(oaiSettings.openai_max_tokens);
    const r = readNumMax("openai_max_tokens", "openai_max_tokens_counter");  // last-resort DOM read
    return r > 0 ? r : 512;
}

const fmt = (n) => Math.round(n).toLocaleString();

async function runSlash(cmd) {
    const ctx = getContext();
    if (typeof ctx.executeSlashCommandsWithOptions === "function") return ctx.executeSlashCommandsWithOptions(cmd);
    if (typeof ctx.executeSlashCommands === "function") return ctx.executeSlashCommands(cmd);
    throw new Error("Slash command API not found");
}

function toast(kind, msg, title) {
    try { if (window.toastr) toastr[kind](msg, title || "Context Meter", { timeOut: 8000 }); }
    catch (e) { /* ignore */ }
}

/* ---------------- UI ---------------- */
const COLOR_THEMES = {
    basic:  { prompt: "#4a9d6a", over: "#d1584f", reserve: "#d99a4e" },
    sakura: { prompt: "#ff9ecd", over: "#ff477e", reserve: "#c9a7f0" },
    mint:   { prompt: "#7ad9b6", over: "#ff7096", reserve: "#bdefe0" },
    peach:  { prompt: "#ffb59e", over: "#ff5d73", reserve: "#ffd9a0" },
    cottoncandy: { prompt: "#a0e7e5", over: "#ff9aa2", reserve: "#ffb7ff" },
    galaxy: { prompt: "#8a7bff", over: "#ff5ea8", reserve: "#59d2fe" },
    neon:   { prompt: "#00e5a0", over: "#ff3d81", reserve: "#ffd23f" },
    pastel: { prompt: "#9ad0a0", over: "#e79aa0", reserve: "#ecd39a" },
    ocean:  { prompt: "#3fa7d6", over: "#ef476f", reserve: "#ffd166" },
    mono:   { prompt: "#7f868f", over: "#ef4444", reserve: "#b8bcc4" },
};
function applyTheme(name) {
    let t;
    if (name === "custom") {
        const s = getSettings();
        t = { prompt: s.customPrompt, over: s.customOver, reserve: s.customReserve };
    } else {
        t = COLOR_THEMES[name] || COLOR_THEMES.basic;
    }
    const wrap = document.getElementById("cum-wrap");
    if (!wrap) return;
    wrap.style.setProperty("--cum-prompt", t.prompt);
    wrap.style.setProperty("--cum-over", t.over);
    wrap.style.setProperty("--cum-reserve", t.reserve);
}

function toggleCustomColors(show) {
    const el = document.getElementById("cum_custom_colors");
    if (el) el.style.display = show ? "block" : "none";
}

function refreshSavedThemes() {
    const sel = document.getElementById("cum_saved");
    if (!sel) return;
    const list = getSettings().savedThemes || [];
    sel.innerHTML = "";
    if (!list.length) {
        const o = document.createElement("option");
        o.value = ""; o.textContent = "(ยังไม่มีชุดบันทึก)";
        sel.appendChild(o);
        return;
    }
    list.forEach((t, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = t.name || ("ชุด " + (i + 1));
        sel.appendChild(o);
    });
}

function saveCurrentTheme() {
    const s = getSettings();
    if (!Array.isArray(s.savedThemes)) s.savedThemes = [];
    const nameEl = document.getElementById("cum_save_name");
    let name = (nameEl && nameEl.value.trim()) || "";
    if (!name) name = "ชุด " + (s.savedThemes.length + 1);
    s.savedThemes.push({ name, prompt: s.customPrompt, over: s.customOver, reserve: s.customReserve });
    saveSettingsDebounced();
    if (nameEl) nameEl.value = "";
    refreshSavedThemes();
    const sel = document.getElementById("cum_saved");
    if (sel) sel.value = String(s.savedThemes.length - 1);
    toast("success", `บันทึกชุดสี "${name}" แล้ว`);
}

function loadSavedTheme(index) {
    const s = getSettings();
    const t = (s.savedThemes || [])[index];
    if (!t) return;
    s.customPrompt = t.prompt; s.customOver = t.over; s.customReserve = t.reserve;
    s.colorTheme = "custom";
    saveSettingsDebounced();
    const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    setVal("cum_c_prompt", t.prompt); setVal("cum_c_reserve", t.reserve); setVal("cum_c_over", t.over);
    setVal("cum_theme", "custom");
    toggleCustomColors(true);
    applyTheme("custom");
}

function deleteSavedTheme() {
    const sel = document.getElementById("cum_saved");
    if (!sel || sel.value === "") return;
    const s = getSettings();
    const idx = Number(sel.value);
    if (!s.savedThemes || !s.savedThemes[idx]) return;
    const nm = s.savedThemes[idx].name;
    s.savedThemes.splice(idx, 1);
    saveSettingsDebounced();
    refreshSavedThemes();
    toast("info", `ลบชุด "${nm}" แล้ว`);
}

function initBar() {
    if (document.getElementById("cum-wrap")) return;
    const wrap = document.createElement("div");
    wrap.id = "cum-wrap";
    wrap.innerHTML = `
        <div id="cum-bar" title="แตะเพื่อดู/ซ่อนรายละเอียด">
            <div id="cum-seg-prompt" class="cum-seg" style="width:0%" title="พรอมท์ที่ส่งรอบนี้ (system prompt + user/assistant)"></div>
            <div id="cum-seg-free" class="cum-seg" style="width:100%" title="ที่ว่างที่ยังใช้ได้"></div>
            <div id="cum-seg-over" class="cum-seg" style="width:0%" title="พรอมท์ล้ำเข้ามากินที่ของคำตอบ"></div>
            <div id="cum-seg-reserve" class="cum-seg" style="width:0%" title="พื้นที่กันไว้ให้โมเดลตอบ"></div>
        </div>
        <div id="cum-panel">
            <span id="cum-label">–</span>
            <span id="cum-detail"></span>
        </div>
        <div id="cum-alert">
            <span id="cum-alert-text">พรอมท์ล้ำโซนคำตอบ — โมเดลอาจตอบไม่ออก</span>
            <button id="cum-compact-inline" class="menu_button" type="button">สรุปเนื้อหาทั้งหมด</button>
        </div>`;

    const form = document.getElementById("send_form");
    if (form && form.parentNode) form.parentNode.insertBefore(wrap, form);
    else document.body.appendChild(wrap);

    document.getElementById("cum-bar").addEventListener("click", () => wrap.classList.toggle("expanded"));
    document.getElementById("cum-compact-inline").addEventListener("click", makeRecap);
    applyTheme(getSettings().colorTheme);
}

let lastSystem = 0, lastChat = 0, hasCounts = false;
let lastMaxCtx = -1, lastReserve = -1;

// Count tokens for the outgoing prompt (async), store them, then draw.
async function updateMeter(chatArray) {
    const s = getSettings();
    if (!s.enabled) { const wrap = document.getElementById("cum-wrap"); if (wrap) wrap.style.display = "none"; return; }

    let systemTokens = 0, chatTokens = 0;
    for (const msg of (chatArray || [])) {
        const text = (msg && msg.content) ? msg.content : "";
        const c = await getTokenCountAsync(text);
        if (msg && msg.role === "system") systemTokens += c; else chatTokens += c;
    }
    lastSystem = systemTokens;
    lastChat = chatTokens;
    hasCounts = true;
    renderBar();
}

// Draw the bar from the stored token counts + the CURRENT context/reserve settings.
// Safe to call any time (e.g. when ST's context-size slider moves) — no re-tokenizing.
function renderBar() {
    const s = getSettings();
    initBar();
    const w = document.getElementById("cum-wrap");
    if (!w) return;
    if (!s.enabled) { w.style.display = "none"; return; }
    w.style.display = "";
    if (!hasCounts) return;

    const systemTokens = lastSystem, chatTokens = lastChat;
    const prompt = systemTokens + chatTokens;
    const maxCtx = getMaxContext();   // read live every render → follows ST's context slider
    const reserve = getReserve();
    const overflowLine = Math.max(0, maxCtx - reserve);
    const usagePct = maxCtx > 0 ? (prompt / maxCtx) * 100 : 0;

    const danger = prompt >= overflowLine;                 // eating reserve => reply won't fit
    const warn = !danger && usagePct >= s.thresholdPct;

    // segment widths (contiguous: green -> free -> over -> reserve)
    const green = Math.min(prompt, overflowLine);
    const free = Math.max(0, overflowLine - prompt);
    const over = Math.max(0, prompt - overflowLine);
    const reserveLeft = Math.max(0, maxCtx - Math.max(prompt, overflowLine));
    const maxBar = Math.max(maxCtx, prompt) || 1;
    const pct = (v) => (v / maxBar) * 100;

    const setW = (id, v) => { const e = document.getElementById(id); if (e) e.style.width = pct(v) + "%"; };
    setW("cum-seg-prompt", green);
    setW("cum-seg-free", free);
    setW("cum-seg-over", over);
    setW("cum-seg-reserve", reserveLeft);

    const label = document.getElementById("cum-label");
    const detail = document.getElementById("cum-detail");
    if (label) label.textContent = `ส่งรอบนี้ ${fmt(prompt)} / ${fmt(maxCtx)} (${usagePct.toFixed(0)}%)`;
    if (detail) detail.innerHTML = `system prompt ${fmt(systemTokens)} · user/assistant ${fmt(chatTokens)} · ที่ว่าง ${fmt(free)}<span class="cum-reserve-detail"> · กันไว้ตอบ ${fmt(reserve)}</span>`;

    w.classList.toggle("warn", warn);
    w.classList.toggle("danger", danger);

    const live = document.getElementById("cum_live");
    if (live) live.textContent = `รอบล่าสุด: ส่ง ${fmt(prompt)} โทเคน (${usagePct.toFixed(0)}%) · เพดาน ${fmt(maxCtx)} · กันไว้ตอบ ${fmt(reserve)}${danger ? " · ⚠ ล้ำที่ของคำตอบ" : ""}`;

    lastStats = { prompt, maxCtx, reserve, usagePct, danger, warn };
    lastMaxCtx = maxCtx;
    lastReserve = reserve;
}

// Re-render when context size or reserve changes by ANY means (typed number, slider, preset, API switch).
function pollLimits() {
    if (!hasCounts) return;
    if (getMaxContext() !== lastMaxCtx || getReserve() !== lastReserve) renderBar();
}

function onGenerationEnded() {
    const s = getSettings();
    if (!s.enabled || !lastStats) return;
    if (s.autoWarnToast) {
        if (lastStats.danger && !prevDanger) {
            toast("warning", "พรอมท์ล้ำที่ของคำตอบแล้ว โมเดลอาจตอบไม่ออก — ลองสรุปเนื้อหาทั้งหมดแล้วเริ่มแชทใหม่");
        } else if (lastStats.warn && !prevWarn && !lastStats.danger) {
            toast("info", `ใช้ context ไป ${lastStats.usagePct.toFixed(0)}% แล้ว (ถึงเกณฑ์เตือน) — พิจารณาสรุปหรือเริ่มแชทใหม่`);
        }
    }
    prevDanger = lastStats.danger;
    prevWarn = lastStats.warn;
}

/* ---------------- compaction (reserved for a later stage; not wired in option A) ---------------- */
async function doCompact() {
    if (isCompacting) return;
    const s = getSettings();
    const ctx = getContext();
    const chatLen = (ctx.chat && ctx.chat.length) ? ctx.chat.length : 0;
    if (chatLen <= s.keepLast) { toast("info", "ข้อความยังน้อย ยังไม่ต้องบีบอัด"); return; }

    isCompacting = true;
    try {
        await runSlash("/summarize");                       // refresh summary via built-in engine
        const end = chatLen - s.keepLast - 1;               // hide 0..end, keep last N visible
        if (end >= 0) await runSlash(`/hide 0-${end}`);     // VERIFY: /hide range syntax
        toast("success", "สรุปและบีบอัดแล้ว — คืนได้ด้วย /unhide");
    } catch (e) {
        console.error(`[${extensionName}] compact failed:`, e);
        toast("error", "บีบอัดไม่สำเร็จ ดู console (F12)");
    } finally {
        isCompacting = false;
    }
}

/* ---------------- recap ("The Summarizer" prompt by xo.nara) ---------------- */
async function loadRecapPrompt() {
    try { recapText = await $.get(`${extensionFolderPath}/recap-prompt.txt`); }
    catch (e) { console.error(`[${extensionName}] recap-prompt.txt load failed:`, e); recapText = ""; }
}

function sendTrigger(word) {
    const ta = document.getElementById("send_textarea");
    const btn = document.getElementById("send_but");
    if (!ta || !btn) throw new Error("send UI not found");
    ta.value = word;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    btn.click();
}

// split the model output into an English half and a Thai half
function splitRecap(text) {
    const t = (text || "").replace(/```/g, "").replace(/^>.*$/gm, "");
    const enIdx = t.search(/=+\s*CONVERSATION SUMMARY \(EN\)/i);
    const thIdx = t.search(/=+\s*สรุปบทสนทนา\s*\(ไทย\)/);
    if (enIdx !== -1 && thIdx !== -1 && thIdx > enIdx) {
        return { en: t.slice(enIdx, thIdx).trim(), th: t.slice(thIdx).trim() };
    }
    return { en: t.trim(), th: "" }; // format not matched → show it all in the English tab
}

// build the tabbed content element (EN / Thai + copy) — reused by both popup paths
function buildRecapContent(data) {
    const content = document.createElement("div");
    content.className = "cum-recap-content";
    content.innerHTML = `
        <div class="cum-recap-tabs">
            <button class="cum-recap-tab active" data-tab="en" type="button">English</button>
            <button class="cum-recap-tab" data-tab="th" type="button">ไทย</button>
            <button class="cum-recap-copy menu_button" type="button">คัดลอก</button>
        </div>
        <textarea class="cum-recap-text" readonly></textarea>`;

    const ta = content.querySelector(".cum-recap-text");
    const tabs = content.querySelectorAll(".cum-recap-tab");
    let current = "en";
    const draw = () => { ta.value = data[current]; };
    draw();

    tabs.forEach((btn) => btn.addEventListener("click", () => {
        tabs.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        current = btn.dataset.tab;
        draw();
    }));

    content.querySelector(".cum-recap-copy").addEventListener("click", async () => {
        const txt = data[current];
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt);
            else { ta.focus(); ta.select(); document.execCommand("copy"); }
            toast("success", "คัดลอกแล้ว");
        } catch (e) {
            ta.focus(); ta.select(); document.execCommand("copy");
            toast("success", "คัดลอกแล้ว");
        }
    });
    return content;
}

// show the recap. Prefer ST's native popup (correct on mobile); fall back to a custom overlay.
function showRecap(text) {
    const { en, th } = splitRecap(text);
    const data = { en: en || "(ไม่พบส่วน English)", th: th || "(ไม่พบส่วนไทย)" };
    const content = buildRecapContent(data);

    const ctx = getContext();
    if (typeof ctx.callGenericPopup === "function") {
        const type = (ctx.POPUP_TYPE && ctx.POPUP_TYPE.TEXT) ? ctx.POPUP_TYPE.TEXT : 1;
        ctx.callGenericPopup(content, type, "", { wide: true, large: true, okButton: "ปิด", allowVerticalScrolling: true });
        return;
    }

    // fallback overlay
    const old = document.getElementById("cum-recap-modal");
    if (old) old.remove();
    const modal = document.createElement("div");
    modal.id = "cum-recap-modal";
    const backdrop = document.createElement("div");
    backdrop.id = "cum-recap-backdrop";
    const panel = document.createElement("div");
    panel.id = "cum-recap-panel";
    const head = document.createElement("div");
    head.id = "cum-recap-head";
    head.innerHTML = `<span id="cum-recap-title">สรุปเนื้อหาทั้งหมด</span><span id="cum-recap-close" title="ปิด">✕</span>`;
    panel.appendChild(head);
    panel.appendChild(content);
    modal.appendChild(backdrop);
    modal.appendChild(panel);
    document.body.appendChild(modal);
    const close = () => modal.remove();
    head.querySelector("#cum-recap-close").addEventListener("click", close);
    backdrop.addEventListener("click", close);
}

// toggle the buttons into a "busy" state while generating
function setRecapBusy(busy) {
    const s = document.getElementById("cum_compact_btn");
    const i = document.getElementById("cum-compact-inline");
    if (s) { s.disabled = busy; s.value = busy ? "กำลังสรุป..." : "สรุปเนื้อหาทั้งหมด (EN+TH)"; }
    if (i) { i.disabled = busy; i.textContent = busy ? "กำลังสรุป..." : "สรุปเนื้อหาทั้งหมด"; }
}

// reopen the last recap without regenerating
function reopenRecap() {
    const saved = getSettings().lastRecap;
    if (saved && saved.trim()) showRecap(saved);
    else toast("info", "ยังไม่มีสรุปล่าสุด — กด 'สรุปเนื้อหาทั้งหมด' ก่อน");
}

async function makeRecap() {
    if (isRecapping) return;
    isRecapping = true;
    setRecapBusy(true);
    let busyToast = null;
    try {
        if (window.toastr) busyToast = toastr.info("กำลังสรุปเนื้อหาทั้งหมด (EN+TH)... รอสักครู่", "Context Meter", { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false });
        if (typeof generateQuietPrompt !== "function") {
            console.error(`[${extensionName}] generateQuietPrompt is not available`);
            toast("error", "เรียก generateQuietPrompt ไม่ได้ (ดู console)");
            return;
        }
        if (!recapText) await loadRecapPrompt();
        const out = await generateQuietPrompt(recapText, false, true); // (prompt, quietToLoud=false, skipWIAN=true)
        console.log(`[${extensionName}] recap chars:`, (out || "").length);
        if (out && out.trim()) {
            getSettings().lastRecap = out;   // remember for reopen
            saveSettingsDebounced();
            showRecap(out);
        } else {
            toast("error", "โมเดลไม่คืนบทสรุป ลองใหม่ หรือเช็ก console");
        }
    } catch (e) {
        console.error(`[${extensionName}] recap failed:`, e);
        toast("error", "สรุปไม่สำเร็จ ดู console (F12)");
    } finally {
        isRecapping = false;
        setRecapBusy(false);
        if (busyToast && window.toastr) toastr.clear(busyToast);
    }
}

/* ---------------- settings drawer wiring ---------------- */
function bindSettingsUI() {
    const s = getSettings();
    const set = (id, val) => {
        const e = document.getElementById(id);
        if (!e) return;
        if (e.type === "checkbox") e.checked = !!val; else e.value = val;
    };
    set("cum_enabled", s.enabled);
    set("cum_toast", s.autoWarnToast);
    set("cum_threshold", s.thresholdPct);
    set("cum_reserve", s.reserveOverride);
    set("cum_keep", s.keepLast);
    set("cum_theme", s.colorTheme);
    set("cum_c_prompt", s.customPrompt);
    set("cum_c_reserve", s.customReserve);
    set("cum_c_over", s.customOver);
    toggleCustomColors(s.colorTheme === "custom");
    refreshSavedThemes();

    const on = (id, ev, fn) => { const e = document.getElementById(id); if (e) e.addEventListener(ev, fn); };
    on("cum_enabled", "input", (e) => { s.enabled = !!e.target.checked; saveSettingsDebounced(); renderBar(); });
    on("cum_toast", "input", (e) => { s.autoWarnToast = !!e.target.checked; saveSettingsDebounced(); });
    on("cum_threshold", "input", (e) => { s.thresholdPct = Number(e.target.value) || 80; saveSettingsDebounced(); renderBar(); });
    on("cum_reserve", "input", (e) => { s.reserveOverride = Number(e.target.value) || 0; saveSettingsDebounced(); renderBar(); });
    on("cum_theme", "change", (e) => { s.colorTheme = e.target.value; saveSettingsDebounced(); toggleCustomColors(s.colorTheme === "custom"); applyTheme(s.colorTheme); });
    on("cum_c_prompt", "input", (e) => { s.customPrompt = e.target.value; saveSettingsDebounced(); applyTheme("custom"); });
    on("cum_c_reserve", "input", (e) => { s.customReserve = e.target.value; saveSettingsDebounced(); applyTheme("custom"); });
    on("cum_c_over", "input", (e) => { s.customOver = e.target.value; saveSettingsDebounced(); applyTheme("custom"); });
    on("cum_save_btn", "click", saveCurrentTheme);
    on("cum_saved", "change", (e) => { if (e.target.value !== "") loadSavedTheme(Number(e.target.value)); });
    on("cum_del_btn", "click", deleteSavedTheme);
    on("cum_keep", "input", (e) => { s.keepLast = Number(e.target.value) || 10; saveSettingsDebounced(); });
    on("cum_compact_btn", "click", makeRecap);
    on("cum_reopen_btn", "click", reopenRecap);
}

/* ---------------- init ---------------- */
jQuery(async () => {
    console.log(`[${extensionName}] loading...`);

    // link ST's live Chat Completion settings (auto-follows context/response-length changes)
    try {
        const mod = await import("../../../openai.js");
        oaiSettings = mod.oai_settings || null;
        console.log(`[${extensionName}] oai_settings linked:`, !!oaiSettings);
    } catch (e) {
        console.warn(`[${extensionName}] could not link oai_settings (falling back to DOM):`, e);
    }

    try {
        const html = await $.get(`${extensionFolderPath}/settings.html`);
        $("#extensions_settings2").append(html);
        bindSettingsUI();
    } catch (e) {
        console.error(`[${extensionName}] settings.html load failed:`, e);
    }

    initBar();
    loadRecapPrompt();

    // follow ST's context-size / response-length fields live (slider drag OR typed number)
    ["openai_max_context", "max_context", "openai_max_tokens"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) { el.addEventListener("input", renderBar); el.addEventListener("change", renderBar); }
    });
    // safety net for cases the events miss (typing a number, loading a preset, switching API)
    setInterval(pollLimits, 750);

    // one-time diagnostic: list candidate limit fields so auto-detect can be wired to the right id
    try {
        const cands = [...document.querySelectorAll("input")]
            .filter((e) => /max|token|context|amount|length/i.test(e.id) && e.value)
            .map((e) => ({ id: e.id, value: e.value }));
        console.log(`[${extensionName}] limit-field candidates:`, cands);
    } catch (e) { /* ignore */ }

    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async (data) => {
        if (isCompacting || isRecapping) return; // ignore dry-runs fired by our own summarize/recap
        if (!data || !data.chat) return;
        try { await updateMeter(data.chat); }
        catch (e) { console.error(`[${extensionName}] updateMeter error:`, e); }
    });

    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);

    console.log(`[${extensionName}] ✅ loaded`);
});
