// Routinen ohne Zentrale: führt dieselben Routinen wie das Zentrale-Programm aus –
// auf dem Handy (oder dem Gerät, das dafür eingestellt ist). Schaltet WLAN-Geräte und Alexa (Voice Monkey).
import SunCalc from "suncalc";
import { on } from "./events.js";
import { settings, mode } from "./settings.js";
import { shared } from "./shared.js";
import { log } from "./log.js";
import { isTauri, hasPcFeatures } from "./platform.js";
import { wifiApply, heatPayload, describeHeat, voiceMonkey, voiceMonkeyAnnounce } from "./wifi.js";
import { readiness, setReadiness, MODES } from "./readiness.js";
import { setDiveraStatusRaw } from "./divera.js";
const offDuty = () => readiness().mode !== "ready";

const fetchFn = async (...a) => (isTauri ? (await import("@tauri-apps/plugin-http")).fetch : fetch)(...a);

/** Läuft die Ausführung auf diesem Gerät? Ohne Zentrale standardmäßig nur auf dem Handy. */
export const runsHere = () => mode() === "direkt" && (settings().direct.routines ?? !hasPcFeatures);

const toMin = (t = "00:00") => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
function check(c, ev) {
  const now = new Date(), n = now.getHours() * 60 + now.getMinutes();
  switch (c.type) {
    case "time": { const a = toMin(c.from), b = toMin(c.to); return a <= b ? n >= a && n < b : n >= a || n < b; }
    case "weekday": return (c.days || []).includes(((now.getDay() + 6) % 7) + 1);
    case "sun": {
      const { lat, lon } = shared().location || {};
      const t = SunCalc.getTimes(now, lat, lon);
      const dark = now < t.sunrise || now > t.sunset;
      return c.is === "light" ? !dark : dark;
    }
    case "keyword": return String(ev.keyword || "").toLowerCase().includes(String(c.contains || "").toLowerCase());
    case "unit": return String(ev.unit || "").toLowerCase().includes(String(c.contains || "").toLowerCase());
    case "readiness": { const m = readiness().mode; return c.is === "off" ? m !== "ready" : m === (c.is || "ready"); }
    default: return true;   // „home“ gibt es nur mit Zentrale
  }
}

function switchDevice(name, payload) {
  const dev = (shared().wifi || []).find((d) => d.name === name);
  if (!dev) return log("warn", `Gerät „${name}“ ohne Zentrale nicht erreichbar`, "Ohne Zentrale gehen nur WLAN-Geräte");
  return wifiApply(dev, payload, fetchFn).catch((e) => log("warn", `WLAN-Gerät ${name}`, e.message));
}

function runActions(r, dry, ev = {}) {
  let wait = 0;
  for (const a of r.actions || []) {
    if (a.type === "delay") { wait += (Number(a.sec) || 0) * 1000; continue; }
    const go = () => {
      if (dry) return log("info", `Probe: ${a.type === "heat" ? describeHeat(a) : a.device || a.group || a.type}`, r.name);
      if (a.type === "device" || a.type === "group") {
        switchDevice(a.device || a.group, a.payload || { state: "ON" });
        if (Number(a.offAfterSec) > 0) setTimeout(() => switchDevice(a.device || a.group, { state: "OFF" }), a.offAfterSec * 1000);
      } else if (a.type === "heat") {
        switchDevice(a.device, heatPayload(a));
        log("action", describeHeat(a), r.name);
      } else if (a.type === "voicemonkey") {
        const token = shared().voicemonkey?.token;
        if (!token) return log("warn", "Voice Monkey: kein Token eingetragen");
        voiceMonkey(token, a.device, fetchFn).then(() => log("action", "Alexa-Routine gestartet", a.device)).catch((e) => log("warn", "Voice Monkey", e.message));
      } else if (a.type === "announce") {
        const token = shared().voicemonkey?.token;
        if (!token) return log("warn", "Alexa-Ansage: kein Voice-Monkey-Token eingetragen");
        voiceMonkeyAnnounce(token, a, ev, fetchFn).then((t) => log("action", "Alexa sagt an", t)).catch((e) => log("warn", "Alexa-Ansage", e.message));
      } else if (a.type === "divera") {
        // Ohne Zentrale nur mit dem eigenen Schlüssel dieses Geräts
        if (a.who && a.who !== settings().alarm.me) return log("warn", "Divera-Status nicht gesetzt", `Ohne Zentrale nur für die eigene Kennung (${settings().alarm.me})`);
        setDiveraStatusRaw(a);
      } else if (a.type === "readiness") {
        setReadiness(a.mode, a.mode === "ready" ? null : nextTime(a.untilAt));
        log("action", "Bereitschaft gesetzt", MODES[a.mode]?.label || a.mode);
      } else if (a.type === "webhook") {
        webhook(a, ev);
      }
    };
    if (wait) setTimeout(go, wait); else go();
  }
}

export function fireLocal(r, ev = {}) {
  if (!r.enabled && !ev.manual) return;
  if (offDuty() && r.trigger?.type === "alarm") return log("info", "Nicht verfügbar: Routine übersprungen", r.name);
  const items = r.conditions?.items || [];
  const okConds = ev.manual || !items.length || (r.conditions.mode === "or" ? items.some((c) => check(c, ev)) : items.every((c) => check(c, ev)));
  if (!okConds) return log("info", "Bedingungen nicht erfüllt", r.name);
  log("action", ev.test ? `Routine (Test): ${r.name}` : `Routine: ${r.name}`);
  runActions(r, Boolean(ev.test), ev);
}

export function initLocalRoutines() {
  on("alarm", (a) => {
    // Sperrzeit prüft engine.js schon; reine Testalarme schalten nichts, die Generalprobe schon
    if (!runsHere() || (a.test && !a.probe)) return;
    for (const r of shared().routines || []) {
      if (r.trigger?.type !== "alarm" || (r.who?.length && !r.who.includes(a.who))) continue;
      fireLocal(r, { ...a, test: false });
    }
  });
  setInterval(() => {
    if (!runsHere()) return;
    const now = new Date(), hhmm = now.toTimeString().slice(0, 5), day = ((now.getDay() + 6) % 7) + 1;
    for (const r of shared().routines || []) {
      const t = r.trigger || {};
      if (t.type === "time" && t.at === hhmm && (!t.days?.length || t.days.includes(day))) fireLocal(r, {});
    }
    checkReadiness();
  }, 60_000);
  on("shared", () => runsHere() && checkReadiness());
}

// Auslöser „Bereitschaft wechselt“
let lastMode = null;
function checkReadiness() {
  const m = readiness().mode;
  if (lastMode === null || m === lastMode) { lastMode = m; return; }
  const from = lastMode; lastMode = m;
  for (const r of shared().routines || []) {
    const t = r.trigger || {};
    if (t.type !== "readiness") continue;
    if (t.to === "off" ? m === "ready" : t.to && t.to !== "any" && t.to !== m) continue;
    fireLocal(r, { readiness: m, from });
  }
}

/** Nächstes Vorkommen von „HH:MM“ als ms; leer = ohne Ende. */
export function nextTime(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number), d = new Date();
  d.setHours(h, m || 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

async function webhook(a, ev) {
  if (!/^https?:\/\//u.test(a.url || "")) return log("warn", "Webhook: Adresse fehlt oder ungültig", a.url || "");
  const url = a.url.replace(/\{(\w+)\}/gu, (_, k) => encodeURIComponent(ev?.[k] ?? ""));
  try {
    const r = await fetchFn(url, { method: a.method || "GET", ...(a.method === "POST" ? { headers: { "Content-Type": "application/json" }, body: a.body || JSON.stringify(ev || {}) } : {}) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    log("action", "Webhook gesendet", a.url.replace(/\?.*/u, ""));
  } catch (e) { log("warn", "Webhook fehlgeschlagen", `${a.url.replace(/\?.*/u, "")}: ${e.message}`); }
}
