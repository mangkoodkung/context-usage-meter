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
    meterStyle: "bar",    // bar, capsule, or blocks
    advancedMode: false,   // reveal non-bar meter styles
    advancedScale: 85,     // visual size (%) for Advanced meters except Aura
    orbIcon: "heart",      // heart, star, sparkle, moon, or paw
    familiarType: "cat",   // selected Context Familiar character
    setupVersion: 0,        // first-run Context Size assistant
    contextProfile: "",     // flash, pro, custom, or current
    managedContextSize: 0,  // last Context Size applied to SillyTavern
    orbX: null,
    orbY: null,
    customPrompt: "#ff9ecd",
    customOver: "#ff477e",
    customReserve: "#c9a7f0",
    panelTheme: "system",   // Quick Menu accent; independent from meter colors
    panelCustom: "#a99af5",
    savedThemes: [],      // user-saved custom color sets: [{name, prompt, over, reserve}]
};

let isCompacting = false;
let isRecapping = false;
let recapText = "";
let lastStats = null;
let prevDanger = false;
let prevWarn = false;
let suppressAltClick = false;
let orbIdleTimer = null;
let oaiSettings = null; // linked to ST's live Chat Completion settings (source of truth for context/reserve)
let closeQuickSettingsDialog = null;

const RECAP_ENABLED = false; // paused until the recap output is reliable enough for release
const DETACHED_METER_STYLES = new Set(["orb", "familiar", "constellation", "bookmark"]);
const SCALABLE_METER_STYLES = new Set(["ring", "badge", "orb", "familiar", "constellation", "bookmark"]);

/* ---------------- settings ---------------- */
function getSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];
    for (const k in defaultSettings) if (s[k] === undefined) s[k] = defaultSettings[k];
    s.thresholdPct = Math.max(50, Math.min(80, Number(s.thresholdPct) || 80));
    s.setupVersion = Number(s.setupVersion) || 0;
    s.managedContextSize = Number(s.managedContextSize) || 0;
    s.advancedScale = Math.max(50, Math.min(120, Number(s.advancedScale) || 85));
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

function warningNotice(msg, title = "Context Meter") {
    try {
        if (window.toastr) toastr.warning(msg, title, {
            timeOut: 0,
            extendedTimeOut: 0,
            closeButton: true,
            tapToDismiss: true,
            preventDuplicates: true,
            newestOnTop: true,
        });
    } catch (e) { /* ignore */ }
}

const CONTEXT_SETUP_VERSION = 1;
const MAX_UNLOCKED_CONTEXT = 2000000;

function normalizeContextSize(value) {
    const size = Math.round(Number(value));
    return Number.isFinite(size) && size >= 512 && size <= MAX_UNLOCKED_CONTEXT ? size : 0;
}

// Write to SillyTavern's actual Chat Completion Context Size, not only this
// extension's warning budget. Unlock ST's range when the chosen value needs it.
function applySillyTavernContextSize(value, profile = "custom") {
    const size = normalizeContextSize(value);
    if (!size) {
        toast("error", "กรุณาใส่ Context Size ระหว่าง 512–2,000,000");
        return false;
    }

    const slider = document.getElementById("openai_max_context");
    const counter = document.getElementById("openai_max_context_counter");
    const unlock = document.getElementById("oai_max_context_unlocked");
    const currentMax = Math.max(Number(slider?.max) || 0, Number(counter?.max) || 0);

    if (size > currentMax) {
        if (oaiSettings) oaiSettings.max_context_unlocked = true;
        if (unlock) {
            unlock.checked = true;
            // Keep this local: ST records the unlock without reconnecting the API.
            if (window.jQuery) $(unlock).trigger("input", [{ source: "preset" }]);
            else unlock.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (slider) slider.max = String(MAX_UNLOCKED_CONTEXT);
        if (counter) counter.max = String(MAX_UNLOCKED_CONTEXT);
    }

    if (oaiSettings) oaiSettings.openai_max_context = size;
    if (slider) {
        if (Number(slider.max) < size) slider.max = String(size);
        slider.value = String(size);
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (counter) {
        if (Number(counter.max) < size) counter.max = String(size);
        counter.value = String(size);
    }

    const s = getSettings();
    s.contextProfile = profile;
    s.managedContextSize = size;
    s.setupVersion = CONTEXT_SETUP_VERSION;
    saveSettingsDebounced();
    syncContextSizeField();
    renderBar();
    toast("success", `ตั้ง Context Size ของ SillyTavern เป็น ${fmt(size)} แล้ว`);
    return true;
}

function syncContextSizeField() {
    const input = document.getElementById("cum_context_size");
    const current = document.getElementById("cum_context_current");
    const size = getMaxContext();
    if (input && document.activeElement !== input) input.value = String(size);
    if (current) current.textContent = `ค่าที่ SillyTavern ใช้อยู่ตอนนี้: ${fmt(size)} tokens`;
}

function closeContextDialog() {
    document.getElementById("cum-context-dialog")?.remove();
}

function shieldContextDialog(modal) {
    // ST closes side drawers when it receives a click outside them. Dialog
    // controls must not bubble up and accidentally close the settings drawer.
    ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
        modal.addEventListener(type, (event) => event.stopPropagation());
    });
}

function showHighContextConfirmation(size, onConfirm, onCancel = null) {
    closeContextDialog();
    const modal = document.createElement("div");
    modal.id = "cum-context-dialog";
    modal.className = "cum-context-modal";
    modal.innerHTML = `
        <div class="cum-context-backdrop"></div>
        <section class="cum-context-dialog cum-context-confirm" role="alertdialog" aria-modal="true" aria-labelledby="cum-confirm-title">
            <div class="cum-dialog-icon">⚠</div>
            <h3 id="cum-confirm-title">ยืนยัน Context Size ที่สูงมาก</h3>
            <p>คุณต้องการใช้ <b>${fmt(size)} tokens</b> ใช่หรือไม่?</p>
            <p class="cum-dialog-note">หากตั้ง Context Size สูงเกินไป จำนวน Token ที่ใช้งานอาจสูงมาก และโมเดลหรือผู้ให้บริการบางรายอาจไม่รองรับ</p>
            <div class="cum-dialog-actions">
                <button type="button" class="menu_button cum-dialog-cancel">กลับไปแก้ไข</button>
                <button type="button" class="menu_button cum-primary cum-dialog-confirm">ยืนยันและใช้งาน</button>
            </div>
        </section>`;
    document.body.appendChild(modal);
    shieldContextDialog(modal);
    const cancel = () => {
        closeContextDialog();
        onCancel?.();
    };
    modal.querySelector(".cum-dialog-cancel").addEventListener("click", cancel);
    modal.querySelector(".cum-context-backdrop").addEventListener("click", cancel);
    modal.querySelector(".cum-dialog-confirm").addEventListener("click", () => {
        closeContextDialog();
        onConfirm();
    });
    modal.querySelector(".cum-dialog-cancel").focus();
}

function requestContextSizeApply(size, profile = "custom", onDone = null, onCancel = null) {
    const normalized = normalizeContextSize(size);
    if (!normalized) {
        toast("error", "กรุณาใส่ Context Size ระหว่าง 512–2,000,000");
        return;
    }
    const apply = () => {
        if (applySillyTavernContextSize(normalized, profile)) onDone?.();
    };
    if (normalized > 200000) showHighContextConfirmation(normalized, apply, onCancel);
    else apply();
}

function showContextSetup() {
    closeContextDialog();
    const currentSize = getMaxContext();
    const modal = document.createElement("div");
    modal.id = "cum-context-dialog";
    modal.className = "cum-context-modal";
    modal.innerHTML = `
        <div class="cum-context-backdrop"></div>
        <section class="cum-context-dialog cum-context-setup" role="dialog" aria-modal="true" aria-labelledby="cum-setup-title">
            <div class="cum-setup-kicker">✦ SAFE CONTEXT SETUP</div>
            <h3 id="cum-setup-title">วันนี้คุณใช้โมเดลแบบไหน?</h3>
            <p>ค่าที่เลือกจะเปลี่ยน <b>Context Size จริงของ SillyTavern</b> และมิเตอร์จะอิงค่าเดียวกันทันที</p>
            <div class="cum-profile-grid" role="radiogroup" aria-label="เลือก Context Size">
                <label class="cum-profile-card">
                    <input type="radio" name="cum_setup_profile" value="flash" checked />
                    <span class="cum-profile-icon">⚡</span><span><b>Gemini Flash</b><small>Community preset · 90,000 tokens</small></span>
                </label>
                <label class="cum-profile-card">
                    <input type="radio" name="cum_setup_profile" value="pro" />
                    <span class="cum-profile-icon">✦</span><span><b>Gemini Pro</b><small>Community preset · 200,000 tokens</small></span>
                </label>
                <label class="cum-profile-card cum-profile-custom">
                    <input type="radio" name="cum_setup_profile" value="custom" />
                    <span class="cum-profile-icon">⌁</span><span><b>กำหนดเอง</b><small>เลือกให้เหมาะกับโมเดลและผู้ให้บริการ</small></span>
                </label>
            </div>
            <label class="cum-setup-custom-field" hidden>
                <span>Context Size ที่ต้องการ</span>
                <span class="cum-input-suffix"><input class="text_pole" id="cum_setup_custom_size" type="number" min="512" max="2000000" step="1" value="${currentSize}" /><em>token</em></span>
            </label>
            <div class="cum-setup-current">ค่าปัจจุบันใน SillyTavern: <b>${fmt(currentSize)} tokens</b></div>
            <div class="cum-dialog-actions">
                <button type="button" class="menu_button cum-use-current">ใช้ค่าปัจจุบัน</button>
                <button type="button" class="menu_button cum-primary cum-setup-apply">ตั้งค่าและเริ่มใช้งาน</button>
            </div>
        </section>`;
    document.body.appendChild(modal);
    shieldContextDialog(modal);

    const customWrap = modal.querySelector(".cum-setup-custom-field");
    const customInput = modal.querySelector("#cum_setup_custom_size");
    const selectedProfile = () => modal.querySelector('input[name="cum_setup_profile"]:checked')?.value || "flash";
    modal.querySelectorAll('input[name="cum_setup_profile"]').forEach((radio) => {
        radio.addEventListener("change", () => {
            customWrap.hidden = selectedProfile() !== "custom";
            if (!customWrap.hidden) customInput.focus();
        });
    });
    modal.querySelector(".cum-use-current").addEventListener("click", () => {
        const s = getSettings();
        s.contextProfile = "current";
        s.managedContextSize = currentSize;
        s.setupVersion = CONTEXT_SETUP_VERSION;
        saveSettingsDebounced();
        closeContextDialog();
        syncContextSizeField();
    });
    modal.querySelector(".cum-setup-apply").addEventListener("click", () => {
        const profile = selectedProfile();
        const size = profile === "flash" ? 90000 : profile === "pro" ? 200000 : customInput.value;
        requestContextSizeApply(size, profile, closeContextDialog, showContextSetup);
    });
    modal.querySelector('input[name="cum_setup_profile"]:checked').focus();
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
const PANEL_ACCENTS = {
    rose: "#ff9ecd",
    violet: "#a99af5",
    blue: "#59b8ff",
    mint: "#66d9b5",
    amber: "#f1b85b",
};

function applyPanelTheme(name = getSettings().panelTheme) {
    const s = getSettings();
    const accent = name === "custom" ? s.panelCustom : PANEL_ACCENTS[name] || "";
    const targets = [
        document.querySelector(".context-usage-meter-settings"),
        document.getElementById("cum-quick-settings-modal"),
    ];
    for (const target of targets) {
        if (!target) continue;
        if (target.id === "cum-quick-settings-modal") {
            if (accent) target.style.setProperty("--cum-dialog-accent", accent);
            else target.style.removeProperty("--cum-dialog-accent");
        } else {
            if (accent) target.style.setProperty("--cum-ui-accent", accent);
            else target.style.removeProperty("--cum-ui-accent");
        }
    }
    const custom = document.getElementById("cum_panel_custom_wrap");
    if (custom) custom.hidden = name !== "custom";
}

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
    const alt = document.getElementById("cum-alt-meter");
    const panel = document.getElementById("cum-panel");
    if (alt) {
        alt.style.setProperty("--cum-prompt", t.prompt);
        alt.style.setProperty("--cum-over", t.over);
        alt.style.setProperty("--cum-reserve", t.reserve);
    }
    if (panel) {
        panel.style.setProperty("--cum-prompt", t.prompt);
        panel.style.setProperty("--cum-over", t.over);
        panel.style.setProperty("--cum-reserve", t.reserve);
    }
    const sendForm = document.getElementById("send_form");
    if (sendForm) {
        sendForm.style.setProperty("--cum-prompt", t.prompt);
        sendForm.style.setProperty("--cum-over", t.over);
        sendForm.style.setProperty("--cum-reserve", t.reserve);
    }
}

function applyMeterStyle(name) {
    const wrap = document.getElementById("cum-wrap");
    if (!wrap) return;
    const allowed = ["bar", "capsule", "blocks", "ring", "badge", "orb", "familiar", "constellation", "bookmark", "aura"];
    const style = allowed.includes(name) ? name : "bar";
    wrap.dataset.meterStyle = style;
    applyAdvancedScale(getSettings().advancedScale);
    toggleAdvancedSizeControl(SCALABLE_METER_STYLES.has(style));
    toggleOrbIconPicker(style === "orb");
    toggleFamiliarPicker(style === "familiar");
    toggleFloatingTools(DETACHED_METER_STYLES.has(style));
    const panel = document.getElementById("cum-panel");
    const alt = document.getElementById("cum-alt-meter");
    const sendForm = document.getElementById("send_form");
    sendForm?.classList.toggle("cum-aura-active", style === "aura");
    if (DETACHED_METER_STYLES.has(style)) {
        if (alt && alt.parentElement !== document.body) document.body.appendChild(alt);
        if (panel && panel.parentElement !== document.body) document.body.appendChild(panel);
        alt?.classList.add("cum-floating-meter");
        if (alt) alt.dataset.floatingStyle = style;
        panel?.classList.add("cum-floating-panel");
        panel?.classList.toggle("open", wrap.classList.contains("expanded"));
        applyTheme(getSettings().colorTheme);
        requestAnimationFrame(positionFloatingOrb);
        wakeFloatingOrb();
    } else if (panel) {
        clearTimeout(orbIdleTimer);
        orbIdleTimer = null;
        if (alt && alt.parentElement === document.body) document.getElementById("cum-bar")?.after(alt);
        if (panel && panel.parentElement === document.body) alt?.after(panel);
        alt?.classList.remove("cum-floating-meter", "idle", "dragging", "warn", "danger");
        if (alt) delete alt.dataset.floatingStyle;
        panel?.classList.remove("cum-floating-panel", "open");
        alt?.style.removeProperty("left");
        alt?.style.removeProperty("top");
        panel.style.removeProperty("width");
        panel.style.removeProperty("left");
        panel.style.removeProperty("top");
    }
}

function applyAdvancedScale(value) {
    const scale = Math.max(50, Math.min(120, Number(value) || 85));
    const alt = document.getElementById("cum-alt-meter");
    const input = document.getElementById("cum_advanced_size");
    const output = document.getElementById("cum_advanced_size_value");
    if (alt) alt.style.setProperty("--cum-advanced-scale", `${scale / 100}`);
    if (input && Number(input.value) !== scale) input.value = String(scale);
    if (output) output.textContent = `${scale}%`;
    if (DETACHED_METER_STYLES.has(getSettings().meterStyle)) requestAnimationFrame(positionFloatingOrb);
}

function toggleAdvancedSizeControl(show) {
    const control = document.getElementById("cum_advanced_size_control");
    if (!control) return;
    control.hidden = !show;
    control.setAttribute("aria-hidden", String(!show));
}

function toggleAdvancedStyles(show) {
    const group = document.getElementById("cum_advanced_styles");
    if (!group) return;
    group.hidden = !show;
    group.setAttribute("aria-hidden", String(!show));
}

function syncMeterStyleInputs(style) {
    document.querySelectorAll('input[name="cum_meter_style"]').forEach((input) => {
        input.checked = input.value === style;
    });
}

const ORB_ICON_CLASSES = {
    heart: "fa-heart",
    star: "fa-star",
    sparkle: "fa-wand-magic-sparkles",
    moon: "fa-moon",
    paw: "fa-paw",
};

const FAMILIAR_MOODS = {
    cat: { normal: "😺", warn: "😿", danger: "🙀" },
    ghost: { normal: "👻", warn: "😶‍🌫️", danger: "💀" },
    star: { normal: "🌟", warn: "⭐", danger: "💥" },
    bunny: { normal: "🐰", warn: "🥺", danger: "😱" },
    fox: { normal: "🦊", warn: "😟", danger: "😱" },
    bear: { normal: "🐻", warn: "🥺", danger: "😵" },
    frog: { normal: "🐸", warn: "😥", danger: "😵‍💫" },
    chick: { normal: "🐥", warn: "😟", danger: "😱" },
    panda: { normal: "🐼", warn: "😥", danger: "😵" },
    alien: { normal: "👽", warn: "😟", danger: "🤯" },
    robot: { normal: "🤖", warn: "⚠️", danger: "💢" },
    dragon: { normal: "🐲", warn: "😤", danger: "🔥" },
};

function toggleOrbIconPicker(show) {
    const picker = document.getElementById("cum_orb_icons");
    if (!picker) return;
    picker.hidden = !show;
    picker.setAttribute("aria-hidden", String(!show));
}

function applyOrbIcon(name) {
    const iconName = ORB_ICON_CLASSES[name] ? name : "heart";
    const icon = document.getElementById("cum-orb-icon");
    if (icon) icon.className = `fa-solid ${ORB_ICON_CLASSES[iconName]}`;
    document.querySelectorAll('input[name="cum_orb_icon"]').forEach((input) => {
        input.checked = input.value === iconName;
    });
}

function toggleFamiliarPicker(show) {
    const picker = document.getElementById("cum_familiar_types");
    if (!picker) return;
    picker.hidden = !show;
    picker.setAttribute("aria-hidden", String(!show));
}

function toggleFloatingTools(show) {
    const tools = document.getElementById("cum_floating_tools");
    if (!tools) return;
    tools.hidden = !show;
    tools.setAttribute("aria-hidden", String(!show));
}

function applyFamiliarType(name, mood = "normal") {
    const type = FAMILIAR_MOODS[name] ? name : "cat";
    const character = document.getElementById("cum-familiar-character");
    if (character) character.textContent = FAMILIAR_MOODS[type][mood] || FAMILIAR_MOODS[type].normal;
    document.querySelectorAll('input[name="cum_familiar_type"]').forEach((input) => {
        input.checked = input.value === type;
    });
}

function getViewportBounds() {
    const viewport = window.visualViewport;
    return {
        left: viewport?.offsetLeft || 0,
        top: viewport?.offsetTop || 0,
        width: viewport?.width || window.innerWidth,
        height: viewport?.height || window.innerHeight,
    };
}

function getClampedOrbPosition(x, y) {
    const viewport = getViewportBounds();
    const rect = document.getElementById("cum-alt-meter")?.getBoundingClientRect();
    const width = rect?.width || (viewport.width <= 1000 ? 52 : 58);
    const height = rect?.height || (viewport.width <= 1000 ? 52 : 58);
    const margin = 10;
    return {
        x: Math.max(viewport.left + margin, Math.min(viewport.left + viewport.width - width - margin, x)),
        y: Math.max(viewport.top + margin, Math.min(viewport.top + viewport.height - height - margin, y)),
    };
}

function wakeFloatingOrb() {
    const alt = document.getElementById("cum-alt-meter");
    if (!alt) return;
    clearTimeout(orbIdleTimer);
    alt.classList.remove("idle");
    const wrap = document.getElementById("cum-wrap");
    if (!DETACHED_METER_STYLES.has(getSettings().meterStyle) || wrap?.classList.contains("expanded") || wrap?.classList.contains("danger")) return;
    orbIdleTimer = setTimeout(() => alt.classList.add("idle"), 2800);
}

function positionFloatingOrb() {
    const alt = document.getElementById("cum-alt-meter");
    if (!alt || !DETACHED_METER_STYLES.has(getSettings().meterStyle)) return;
    const s = getSettings();
    const viewport = getViewportBounds();
    const fallbackX = viewport.left + viewport.width - (viewport.width <= 1000 ? 66 : 72);
    const fallbackY = viewport.top + Math.round(viewport.height * 0.48);
    const hasSavedX = s.orbX !== null && s.orbX !== "" && Number.isFinite(Number(s.orbX));
    const hasSavedY = s.orbY !== null && s.orbY !== "" && Number.isFinite(Number(s.orbY));
    const pos = getClampedOrbPosition(hasSavedX ? Number(s.orbX) : fallbackX, hasSavedY ? Number(s.orbY) : fallbackY);
    alt.style.left = `${pos.x}px`;
    alt.style.top = `${pos.y}px`;
    if (document.getElementById("cum-wrap")?.classList.contains("expanded")) positionFloatingPanel();
}

function positionFloatingPanel() {
    const wrap = document.getElementById("cum-wrap");
    const alt = document.getElementById("cum-alt-meter");
    const panel = document.getElementById("cum-panel");
    if (!wrap || !alt || !panel || !DETACHED_METER_STYLES.has(getSettings().meterStyle)) return;
    const viewport = getViewportBounds();
    const orb = alt.getBoundingClientRect();
    const panelWidth = Math.min(270, viewport.width - 24);
    const gap = 10;
    const fitsRight = orb.right + gap + panelWidth <= viewport.left + viewport.width - 12;
    const left = fitsRight ? orb.right + gap : orb.left - panelWidth - gap;
    panel.style.width = `${panelWidth}px`;
    panel.style.left = `${Math.max(viewport.left + 12, Math.min(viewport.left + viewport.width - panelWidth - 12, left))}px`;
    panel.style.top = `${Math.max(viewport.top + 12, Math.min(viewport.top + viewport.height - 132, orb.top))}px`;
}

function setupFloatingOrb(alt) {
    let dragging = false;
    let moved = false;
    let startPointerX = 0;
    let startPointerY = 0;
    let startLeft = 0;
    let startTop = 0;

    alt.addEventListener("pointerdown", (e) => {
        if (!DETACHED_METER_STYLES.has(getSettings().meterStyle) || e.button !== 0) return;
        wakeFloatingOrb();
        const rect = alt.getBoundingClientRect();
        dragging = true;
        moved = false;
        startPointerX = e.clientX;
        startPointerY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        alt.setPointerCapture?.(e.pointerId);
    });

    alt.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - startPointerX;
        const dy = e.clientY - startPointerY;
        if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
        if (!moved) return;
        e.preventDefault();
        const pos = getClampedOrbPosition(startLeft + dx, startTop + dy);
        alt.style.left = `${pos.x}px`;
        alt.style.top = `${pos.y}px`;
        alt.classList.add("dragging");
        positionFloatingPanel();
    });

    const finishDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        alt.classList.remove("dragging");
        alt.releasePointerCapture?.(e.pointerId);
        if (!moved) return;
        suppressAltClick = true;
        setTimeout(() => { suppressAltClick = false; }, 350);
        const rect = alt.getBoundingClientRect();
        const size = rect.width || 58;
        const viewport = getViewportBounds();
        const snappedX = rect.left + size / 2 < viewport.left + viewport.width / 2
            ? viewport.left + 12
            : viewport.left + viewport.width - size - 12;
        const pos = getClampedOrbPosition(snappedX, rect.top);
        alt.style.left = `${pos.x}px`;
        alt.style.top = `${pos.y}px`;
        const s = getSettings();
        s.orbX = pos.x;
        s.orbY = pos.y;
        saveSettingsDebounced();
        positionFloatingPanel();
        wakeFloatingOrb();
    };
    alt.addEventListener("pointerup", finishDrag);
    alt.addEventListener("pointercancel", finishDrag);
    window.addEventListener("resize", positionFloatingOrb);
    window.visualViewport?.addEventListener("resize", positionFloatingOrb);
    window.visualViewport?.addEventListener("scroll", positionFloatingOrb);
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
        <div id="cum-bar" role="button" tabindex="0" aria-expanded="false" aria-controls="cum-panel" title="แตะเพื่อดู/ซ่อนรายละเอียด">
            <div id="cum-seg-prompt" class="cum-seg" style="width:0%" title="พรอมท์ที่ส่งรอบนี้ (system prompt + user/assistant)"></div>
            <div id="cum-seg-free" class="cum-seg" style="width:100%" title="ที่ว่างที่ยังใช้ได้"></div>
            <div id="cum-seg-over" class="cum-seg" style="width:0%" title="พรอมท์ล้ำเข้ามากินที่ของคำตอบ"></div>
            <div id="cum-seg-reserve" class="cum-seg" style="width:0%" title="พื้นที่กันไว้ให้โมเดลตอบ"></div>
        </div>
        <div id="cum-alt-meter" role="button" tabindex="0" aria-expanded="false" aria-controls="cum-panel" title="แตะเพื่อดู/ซ่อนรายละเอียด">
            <div id="cum-alt-content">
                <div id="cum-ring" aria-hidden="true"><span id="cum-ring-value">0%</span></div>
                <div id="cum-badge" aria-hidden="true">
                    <span class="cum-badge-icon">◈</span>
                    <span id="cum-badge-value">0%</span>
                    <span id="cum-badge-tokens">—</span>
                </div>
                <div id="cum-orb" aria-hidden="true">
                    <span class="cum-orb-core"><i id="cum-orb-icon" class="fa-solid fa-heart"></i><small id="cum-orb-value">0%</small></span>
                </div>
                <div id="cum-familiar" aria-hidden="true">
                    <span id="cum-familiar-character">😺</span><span id="cum-familiar-bubble">0%</span>
                </div>
                <div id="cum-constellation" aria-hidden="true">
                    <span class="cum-star s1">✦</span><span class="cum-star s2">✦</span><span class="cum-star s3">✦</span>
                    <span class="cum-star s4">✦</span><span class="cum-star s5">✦</span><span class="cum-star s6">✦</span><span class="cum-star s7">✦</span>
                    <small id="cum-constellation-value">0%</small>
                </div>
                <div id="cum-bookmark" aria-hidden="true"><span id="cum-bookmark-value">0%</span><small>CTX</small></div>
                <div id="cum-aura-chip" aria-hidden="true"><span id="cum-aura-value">0%</span></div>
            </div>
        </div>
        <div id="cum-panel">
            <span id="cum-label">–</span>
            <span id="cum-detail"></span>
        </div>
        <div id="cum-alert">
            <span id="cum-alert-text">พรอมท์ล้ำโซนคำตอบ — โมเดลอาจตอบไม่ออก</span>
        </div>`;

    const form = document.getElementById("send_form");
    if (form && form.parentNode) form.parentNode.insertBefore(wrap, form);
    else document.body.appendChild(wrap);

    const toggleDetails = () => {
        const expanded = wrap.classList.toggle("expanded");
        document.getElementById("cum-bar").setAttribute("aria-expanded", String(expanded));
        document.getElementById("cum-alt-meter").setAttribute("aria-expanded", String(expanded));
        document.getElementById("cum-panel")?.classList.toggle("open", expanded && DETACHED_METER_STYLES.has(getSettings().meterStyle));
        if (expanded) requestAnimationFrame(positionFloatingPanel);
        wakeFloatingOrb();
    };
    const bindToggle = (element, isAlt = false) => {
        element.addEventListener("click", () => {
            if (isAlt && suppressAltClick) { suppressAltClick = false; return; }
            toggleDetails();
        });
        element.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleDetails();
            }
        });
    };
    bindToggle(document.getElementById("cum-bar"));
    const altMeter = document.getElementById("cum-alt-meter");
    bindToggle(altMeter, true);
    setupFloatingOrb(altMeter);
    applyTheme(getSettings().colorTheme);
    applyMeterStyle(getSettings().meterStyle);
    applyOrbIcon(getSettings().orbIcon);
    applyFamiliarType(getSettings().familiarType);
}

function openSettingsFromQuickMenu() {
    const settings = document.querySelector(".context-usage-meter-settings");
    if (!settings) return;
    const settingsContent = settings.querySelector(":scope > .inline-drawer > .cum-settings-content");
    if (!settingsContent) return;

    closeQuickSettingsDialog?.();
    const placeholder = document.createComment("context-usage-meter-settings-home");
    const previousContentStyle = settingsContent.getAttribute("style");
    settings.before(placeholder);

    const modal = document.createElement("div");
    modal.id = "cum-quick-settings-modal";
    modal.className = "cum-context-modal cum-quick-settings-modal";
    modal.innerHTML = `
        <div class="cum-context-backdrop"></div>
        <section class="cum-context-dialog cum-quick-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="cum-quick-settings-title">
            <header class="cum-quick-settings-heading">
                <div><small>QUICK MENU</small><h3 id="cum-quick-settings-title">Context Usage Meter</h3></div>
                <button type="button" class="menu_button cum-quick-settings-close" aria-label="ปิดหน้าต่างตั้งค่า" title="ปิด">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </header>
            <div class="cum-quick-settings-slot"></div>
        </section>`;
    modal.querySelector(".cum-quick-settings-slot").appendChild(settings);
    document.body.appendChild(modal);
    applyPanelTheme();

    const close = () => {
        if (!modal.isConnected) return;
        document.removeEventListener("keydown", onKeyDown);
        placeholder.replaceWith(settings);
        if (previousContentStyle === null) settingsContent.removeAttribute("style");
        else settingsContent.setAttribute("style", previousContentStyle);
        modal.remove();
        closeQuickSettingsDialog = null;
    };
    const onKeyDown = (event) => {
        if (event.key === "Escape") close();
    };
    closeQuickSettingsDialog = close;
    modal.querySelector(".cum-context-backdrop").addEventListener("click", close);
    modal.querySelector(".cum-quick-settings-close").addEventListener("click", close);
    document.addEventListener("keydown", onKeyDown);
    modal.querySelector(".cum-quick-settings-close").focus();
}

function initQuickMenu(attempt = 0) {
    if (document.getElementById("cum-quick-menu")) return;
    const menu = document.getElementById("extensionsMenu");
    if (!menu) {
        if (attempt < 20) setTimeout(() => initQuickMenu(attempt + 1), 250);
        return;
    }

    const item = document.createElement("div");
    item.id = "cum-quick-menu";
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("title", "เปิดการตั้งค่า Context Usage Meter");
    item.innerHTML = `
        <div class="fa-solid fa-gauge-high extensionsMenuExtensionButton" aria-hidden="true"></div>
        <span>Context Usage Meter</span>`;

    const open = () => openSettingsFromQuickMenu();
    item.addEventListener("click", open);
    item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
    });
    menu.appendChild(item);
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
    const altMeter = document.getElementById("cum-alt-meter");
    if (!s.enabled) {
        w.style.display = "none";
        if (altMeter) altMeter.style.display = "none";
        const floatingPanel = document.getElementById("cum-panel");
        if (floatingPanel) floatingPanel.style.display = "none";
        return;
    }
    w.style.display = "";
    if (altMeter) altMeter.style.removeProperty("display");
    document.getElementById("cum-panel")?.style.removeProperty("display");
    if (!hasCounts) return;

    const systemTokens = lastSystem, chatTokens = lastChat;
    const prompt = systemTokens + chatTokens;
    const maxCtx = getMaxContext();   // read live every render → follows ST's context slider
    const reserve = getReserve();
    const overflowLine = Math.max(0, maxCtx - reserve);
    const usagePct = maxCtx > 0 ? (prompt / maxCtx) * 100 : 0;
    const displayPct = Math.max(0, Math.min(100, usagePct));

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

    w.style.setProperty("--cum-usage-deg", `${displayPct * 3.6}deg`);
    altMeter?.style.setProperty("--cum-usage-deg", `${displayPct * 3.6}deg`);
    const ringValue = document.getElementById("cum-ring-value");
    const badgeValue = document.getElementById("cum-badge-value");
    const badgeTokens = document.getElementById("cum-badge-tokens");
    const orbValue = document.getElementById("cum-orb-value");
    const familiarBubble = document.getElementById("cum-familiar-bubble");
    const constellationValue = document.getElementById("cum-constellation-value");
    const bookmarkValue = document.getElementById("cum-bookmark-value");
    const auraValue = document.getElementById("cum-aura-value");
    if (ringValue) ringValue.textContent = `${usagePct.toFixed(0)}%`;
    if (badgeValue) badgeValue.textContent = `${usagePct.toFixed(0)}%`;
    if (badgeTokens) badgeTokens.textContent = `${fmt(prompt)} / ${fmt(maxCtx)}`;
    if (orbValue) orbValue.textContent = `${usagePct.toFixed(0)}%`;
    if (familiarBubble) familiarBubble.textContent = `${usagePct.toFixed(0)}%`;
    if (constellationValue) constellationValue.textContent = `${usagePct.toFixed(0)}%`;
    if (bookmarkValue) bookmarkValue.textContent = `${usagePct.toFixed(0)}%`;
    if (auraValue) auraValue.textContent = `${usagePct.toFixed(0)}%`;

    const mood = danger ? "danger" : warn ? "warn" : "normal";
    applyFamiliarType(s.familiarType, mood);
    const litStars = Math.max(1, Math.ceil(displayPct / 100 * 7));
    document.querySelectorAll("#cum-constellation .cum-star").forEach((star, index) => {
        star.classList.toggle("lit", index < litStars);
    });

    const meterLabel = `ใช้ context ${usagePct.toFixed(0)} เปอร์เซ็นต์ ส่ง ${fmt(prompt)} จาก ${fmt(maxCtx)} token แตะเพื่อดูรายละเอียด`;
    document.getElementById("cum-bar")?.setAttribute("aria-label", meterLabel);
    document.getElementById("cum-alt-meter")?.setAttribute("aria-label", meterLabel);

    const label = document.getElementById("cum-label");
    const detail = document.getElementById("cum-detail");
    if (label) label.textContent = `ส่งรอบนี้ ${fmt(prompt)} / ${fmt(maxCtx)} (${usagePct.toFixed(0)}%)`;
    if (detail) detail.innerHTML = `
        <span class="cum-detail-item">System ${fmt(systemTokens)}</span>
        <span class="cum-detail-item">Chat ${fmt(chatTokens)}</span>
        <span class="cum-detail-item">ว่าง ${fmt(free)}</span>
        <span class="cum-detail-item cum-reserve-detail">กันไว้ตอบ ${fmt(reserve)}</span>`;

    w.classList.toggle("warn", warn);
    w.classList.toggle("danger", danger);
    if (altMeter) {
        altMeter.classList.toggle("warn", warn);
        altMeter.classList.toggle("danger", danger);
        altMeter.style.setProperty("--cum-active", danger
            ? "var(--cum-over, #d1584f)"
            : warn ? "var(--cum-reserve, #d99a4e)" : "var(--cum-prompt, #4a9d6a)");
    }
    const floatingPanel = document.getElementById("cum-panel");
    floatingPanel?.style.setProperty("--cum-active", danger
        ? "var(--cum-over, #d1584f)"
        : warn ? "var(--cum-reserve, #d99a4e)" : "var(--cum-prompt, #4a9d6a)");
    const sendForm = document.getElementById("send_form");
    if (sendForm) {
        sendForm.classList.toggle("warn", warn);
        sendForm.classList.toggle("danger", danger);
        sendForm.style.setProperty("--cum-aura-alpha", `${Math.round(16 + displayPct * 0.42)}%`);
        sendForm.style.setProperty("--cum-active", danger
            ? "var(--cum-over, #d1584f)"
            : warn ? "var(--cum-reserve, #d99a4e)" : "var(--cum-prompt, #4a9d6a)");
    }

    const alertText = document.getElementById("cum-alert-text");
    if (alertText) alertText.textContent = "พรอมท์ล้ำโซนคำตอบ — โมเดลอาจตอบไม่ออก";

    const live = document.getElementById("cum_live");
    if (live) live.textContent = `รอบล่าสุด: ส่ง ${fmt(prompt)} โทเคน (${usagePct.toFixed(0)}%) · เพดาน ${fmt(maxCtx)} · กันไว้ตอบ ${fmt(reserve)}${danger ? " · ⚠ ล้ำที่ของคำตอบ" : ""}`;

    lastStats = { prompt, maxCtx, reserve, usagePct, danger, warn };
    lastMaxCtx = maxCtx;
    lastReserve = reserve;

    // Notify immediately when the real outgoing prompt crosses the user's threshold.
    if (s.autoWarnToast) {
        if (danger && !prevDanger) {
            warningNotice("พรอมท์ล้ำพื้นที่ที่กันไว้สำหรับคำตอบ โมเดลอาจตอบไม่ออก — ลองลด context หรือเริ่มแชทใหม่");
        } else if (warn && !prevWarn) {
            warningNotice(`ใช้ context ถึง ${usagePct.toFixed(0)}% แล้ว (เกณฑ์ที่ตั้งไว้ ${s.thresholdPct}%)`);
        }
    }
    prevDanger = danger;
    prevWarn = warn;
    wakeFloatingOrb();
}

// Re-render when context size or reserve changes by ANY means (typed number, slider, preset, API switch).
function pollLimits() {
    const currentMax = getMaxContext();
    syncContextSizeField();
    if (!hasCounts) return;
    if (currentMax !== lastMaxCtx || getReserve() !== lastReserve) renderBar();
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
    set("cum_context_size", getMaxContext());
    set("cum_keep", s.keepLast);
    set("cum_theme", s.colorTheme);
    set("cum_panel_theme", s.panelTheme);
    set("cum_panel_custom", s.panelCustom);
    set("cum_advanced", s.advancedMode);
    set("cum_advanced_size", s.advancedScale);
    set("cum_c_prompt", s.customPrompt);
    set("cum_c_reserve", s.customReserve);
    set("cum_c_over", s.customOver);
    toggleCustomColors(s.colorTheme === "custom");
    applyPanelTheme(s.panelTheme);
    toggleAdvancedStyles(s.advancedMode);
    applyAdvancedScale(s.advancedScale);
    toggleAdvancedSizeControl(SCALABLE_METER_STYLES.has(s.meterStyle));
    syncMeterStyleInputs(s.meterStyle);
    applyOrbIcon(s.orbIcon);
    toggleOrbIconPicker(s.meterStyle === "orb");
    applyFamiliarType(s.familiarType);
    toggleFamiliarPicker(s.meterStyle === "familiar");
    toggleFloatingTools(DETACHED_METER_STYLES.has(s.meterStyle));
    refreshSavedThemes();
    syncContextSizeField();

    const on = (id, ev, fn) => { const e = document.getElementById(id); if (e) e.addEventListener(ev, fn); };
    on("cum_enabled", "input", (e) => { s.enabled = !!e.target.checked; saveSettingsDebounced(); renderBar(); });
    on("cum_toast", "input", (e) => { s.autoWarnToast = !!e.target.checked; saveSettingsDebounced(); });
    on("cum_apply_context", "click", () => {
        const value = document.getElementById("cum_context_size")?.value;
        requestContextSizeApply(value, "custom");
    });
    on("cum_context_size", "keydown", (e) => {
        if (e.key === "Enter") requestContextSizeApply(e.target.value, "custom");
    });
    on("cum_open_setup", "click", showContextSetup);
    document.querySelectorAll("[data-cum-context-preset]").forEach((button) => {
        button.addEventListener("click", () => {
            requestContextSizeApply(button.dataset.cumContextPreset, button.dataset.cumContextProfile);
        });
    });
    on("cum_threshold", "change", (e) => {
        s.thresholdPct = Math.max(50, Math.min(80, Number(e.target.value) || 80));
        e.target.value = s.thresholdPct;
        saveSettingsDebounced();
        renderBar();
    });
    on("cum_reserve", "input", (e) => { s.reserveOverride = Number(e.target.value) || 0; saveSettingsDebounced(); renderBar(); });
    on("cum_theme", "change", (e) => { s.colorTheme = e.target.value; saveSettingsDebounced(); toggleCustomColors(s.colorTheme === "custom"); applyTheme(s.colorTheme); });
    on("cum_panel_theme", "change", (e) => { s.panelTheme = e.target.value; saveSettingsDebounced(); applyPanelTheme(s.panelTheme); });
    on("cum_panel_custom", "input", (e) => { s.panelCustom = e.target.value; saveSettingsDebounced(); applyPanelTheme("custom"); });
    document.querySelectorAll('input[name="cum_meter_style"]').forEach((input) => {
        input.addEventListener("change", (e) => {
            if (!e.target.checked) return;
            s.meterStyle = e.target.value;
            saveSettingsDebounced();
            applyMeterStyle(s.meterStyle);
        });
    });
    document.querySelectorAll('input[name="cum_orb_icon"]').forEach((input) => {
        input.addEventListener("change", (e) => {
            if (!e.target.checked) return;
            s.orbIcon = e.target.value;
            saveSettingsDebounced();
            applyOrbIcon(s.orbIcon);
        });
    });
    document.querySelectorAll('input[name="cum_familiar_type"]').forEach((input) => {
        input.addEventListener("change", (e) => {
            if (!e.target.checked) return;
            s.familiarType = e.target.value;
            saveSettingsDebounced();
            applyFamiliarType(s.familiarType, lastStats?.danger ? "danger" : lastStats?.warn ? "warn" : "normal");
        });
    });
    on("cum_orb_reset", "click", () => {
        s.orbX = null;
        s.orbY = null;
        saveSettingsDebounced();
        positionFloatingOrb();
        toast("success", "รีเซ็ตตำแหน่งมิเตอร์ลอยแล้ว");
    });
    on("cum_advanced", "input", (e) => {
        s.advancedMode = !!e.target.checked;
        if (!s.advancedMode && ["ring", "badge", "orb", "familiar", "constellation", "bookmark", "aura"].includes(s.meterStyle)) {
            s.meterStyle = "bar";
            syncMeterStyleInputs("bar");
            applyMeterStyle("bar");
        }
        saveSettingsDebounced();
        toggleAdvancedStyles(s.advancedMode);
    });
    on("cum_advanced_size", "input", (e) => {
        s.advancedScale = Math.max(50, Math.min(120, Number(e.target.value) || 85));
        applyAdvancedScale(s.advancedScale);
        saveSettingsDebounced();
    });
    on("cum_c_prompt", "input", (e) => { s.customPrompt = e.target.value; saveSettingsDebounced(); applyTheme("custom"); });
    on("cum_c_reserve", "input", (e) => { s.customReserve = e.target.value; saveSettingsDebounced(); applyTheme("custom"); });
    on("cum_c_over", "input", (e) => { s.customOver = e.target.value; saveSettingsDebounced(); applyTheme("custom"); });
    on("cum_save_btn", "click", saveCurrentTheme);
    on("cum_saved", "change", (e) => { if (e.target.value !== "") loadSavedTheme(Number(e.target.value)); });
    on("cum_del_btn", "click", deleteSavedTheme);
    on("cum_keep", "input", (e) => { s.keepLast = Number(e.target.value) || 10; saveSettingsDebounced(); });
    if (RECAP_ENABLED) {
        on("cum_compact_btn", "click", makeRecap);
        on("cum_reopen_btn", "click", reopenRecap);
    }
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
    initQuickMenu();
    if (RECAP_ENABLED) loadRecapPrompt();

    if (getSettings().setupVersion < CONTEXT_SETUP_VERSION) {
        setTimeout(showContextSetup, 450);
    }

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

    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            prevDanger = false;
            prevWarn = false;
        });
    }

    console.log(`[${extensionName}] ✅ loaded`);
});
