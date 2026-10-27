// Discord Rich Presence (nur Windows-PC): zeigt Freunden im Profil „Im Einsatz“.
// Der Rust-Kern (src-tauri/src/discord.rs) spricht lokal mit dem Discord-Programm – offiziell, ohne Token.
// Ablauf: Alarm bzw. „Ich fahre“ → Aktivität setzen · nach X Minuten / „Wieder da“ / „Einsatz beenden“ → entfernen.
// Der laufende Einsatz liegt in localStorage, damit er nach Ruhezustand oder Neustart wieder erscheint.
import { on, emit } from "./events.js";
import { settings, set } from "./settings.js";
import { hasPcFeatures } from "./platform.js";
import { log } from "./log.js";
import { fillTemplate } from "./wifi.js";
import { readiness } from "./readiness.js";
const offDuty = () => readiness().mode !== "ready";

const KEY = "heimalarm.discord.active";
export const ACTIVITY_TYPES = [[0, "Spielt"], [3, "Schaut"], [2, "Hört"], [5, "Tritt an bei"]];
export const PRESETS = {
  diskret: { label: "Diskret", hint: "Nur „Beschäftigt“, keine Details", details: "Gerade beschäftigt", state: "", timer: "none", smallImage: "", largeText: "" },
  standard: { label: "Standard", hint: "„Im Einsatz“ und Stichwort", details: "Im Einsatz", state: "{stichwort}", timer: "since" },
  voll: { label: "Ausführlich", hint: "Mit Einheit und Ort", details: "Im Einsatz · {einheit}", state: "{stichwort} – {adresse}", timer: "since" },
};

/** Status für die Einstellungsseite. */
export const discord = { running: null, ok: null, error: "", active: null };

const enabled = () => hasPcFeatures && settings().discord?.enabled && /^\d{5,}$/u.test(settings().discord?.clientId || "");
const cfg = () => settings().discord;

async function core(cmd, args) {
  const c = await import("@tauri-apps/api/core");
  return c.invoke(cmd, args);
}

const loadActive = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
const saveActive = (a) => { try { if (a) localStorage.setItem(KEY, JSON.stringify(a)); else localStorage.removeItem(KEY); } catch { /* gesperrt */ } };

/** Discord verlangt 2–128 Zeichen je Zeile. */
const line = (s) => { const t = String(s || "").trim().slice(0, 128); return t.length >= 2 ? t : t ? `${t} ` : ""; };
const isUrl = (u) => /^https:\/\/\S+$/u.test(String(u || "").trim());

/** Aktivität aus den Einstellungen und dem Einsatz bauen (auch für die Vorschau). */
export function buildActivity(c, ev = {}, start = Date.now()) {
  const f = (t) => line(fillTemplate(t, ev));
  const a = { type: Number(c.type) || 0, instance: false };
  const details = f(c.details), state = f(c.state);
  if (details) a.details = details;
  if (state) a.state = state;
  // RPC erwartet Unix-Zeit in Sekunden
  const sec = Math.floor(start / 1000);
  if (c.timer === "since") a.timestamps = { start: sec };
  else if (c.timer === "remaining") a.timestamps = { start: sec, end: sec + Math.max(1, Number(c.durationMin) || 90) * 60 };
  // Was in der Mitgliederliste steht: 0 Name der App · 1 Zeile 2 · 2 Zeile 1
  const listShows = Number(c.listShows) || 0;
  if (listShows === 2 && details) a.status_display_type = 2;
  else if (listShows === 1 && state) a.status_display_type = 1;
  const assets = {};
  if (c.largeImage?.trim()) { assets.large_image = c.largeImage.trim(); const t = f(c.largeText); if (t) assets.large_text = t; }
  if (c.smallImage?.trim()) { assets.small_image = c.smallImage.trim(); const t = f(c.smallText); if (t) assets.small_text = t; }
  if (Object.keys(assets).length) a.assets = assets;
  const buttons = (c.buttons || []).filter((b) => b?.label?.trim() && isUrl(b.url)).slice(0, 2)
    .map((b) => ({ label: fillTemplate(b.label, ev).slice(0, 32) || "Link", url: b.url.trim() }));
  if (buttons.length) a.buttons = buttons;
  return a;
}

let pending = Promise.resolve();
/** Wartet, bis der letzte Status an Discord raus ist (vor dem Ruhezustand). */
export const presenceSettled = () => pending;

function push(activity) {
  pending = pushNow(activity);
  return pending;
}

async function pushNow(activity) {
  try {
    await core("discord_set", { clientId: cfg().clientId.trim(), activity });
    discord.ok = true; discord.error = ""; discord.running = true;
    return true;
  } catch (e) {
    discord.ok = false; discord.error = String(e);
    return false;
  } finally { emit("discord", discord); }
}

/** Einsatz anzeigen. */
async function show(ev, { test = false } = {}) {
  if (!enabled()) return;
  const c = cfg();
  const start = Date.now();
  const minutes = test ? 1 : Math.max(1, Number(c.durationMin) || 90);
  const active = { ev: { keyword: ev.keyword, unit: ev.unit, address: ev.address, source: ev.source, who: ev.who, ts: ev.ts || start }, start, end: start + minutes * 60e3, test };
  saveActive(active);
  discord.active = active;
  const ok = await push(buildActivity(c, active.ev, start));
  log(ok ? "action" : "warn", ok ? (test ? "Discord: Test-Status gesetzt" : "Discord: „Im Einsatz“ angezeigt") : "Discord-Status nicht gesetzt", ok ? `bis ${new Date(active.end).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : discord.error);
}

/** Einsatz beenden – Status entfernen. */
export async function endPresence(why = "beendet") {
  const was = loadActive();
  saveActive(null);
  discord.active = null;
  if (!hasPcFeatures) return;
  try { await core("discord_clear"); } catch { /* Discord zu */ }
  if (was) log("info", `Discord-Status entfernt (${why})`);
  emit("discord", discord);
}

/** Vorschau für 60 Sekunden mit Beispiel-Einsatz senden. */
export async function testPresence(sample) {
  if (!hasPcFeatures) throw new Error("Nur am Windows-PC");
  if (!/^\d{5,}$/u.test(cfg().clientId || "")) throw new Error("Erst die Application-ID eintragen");
  const start = Date.now();
  const ok = await push(buildActivity(cfg(), sample, start));
  if (!ok) throw new Error(discord.error);
  const active = { ev: sample, start, end: start + 60e3, test: true };
  saveActive(active); discord.active = active;
  emit("discord", discord);
}

export async function checkDiscord() {
  if (!hasPcFeatures) return false;
  try { discord.running = await core("discord_running"); } catch { discord.running = false; }
  emit("discord", discord);
  return discord.running;
}

/** Läuft ein Einsatz? Dann (wieder) anzeigen – nach Aufwachen, Discord-Neustart, App-Neustart. Abgelaufen → entfernen. */
let lastTick = Date.now();
async function tick() {
  const now = Date.now();
  const woke = now - lastTick > 120e3;   // Ruhezustand/Energiesparen vorbei
  lastTick = now;
  const a = loadActive();
  if (!a) return;
  if (now >= a.end) return endPresence("Zeit abgelaufen");
  if (!enabled()) return;
  if (woke && !a.test && cfg().resume === false) return endPresence("PC war im Ruhezustand");
  // Nach Fehler (Discord war zu) oder Aufwachen erneut senden; sonst reicht die bestehende Verbindung
  if (woke || discord.ok !== true) {
    discord.active = a;
    await push(buildActivity(cfg(), a.ev, a.start));
  }
}

export function initDiscord() {
  if (!hasPcFeatures) return;
  discord.active = loadActive();
  on("alarm", (a) => {
    const c = cfg();
    if (!enabled() || !a?.own || (offDuty() && !a.test)) return;
    if (a.test && !a.probe && !c.tests) return;
    if (c.start === "alarm") show(a, { test: a.test && !a.probe });
  });
  on("answer", ({ going, test, timeout, alarm }) => {
    const c = cfg();
    if (!enabled()) return;
    if (test && !c.tests) return;
    if (going && c.start === "go") show(alarm || {}, { test });
    if (!going && !timeout && c.onStay === "clear" && loadActive()) endPresence("„Ich fahre nicht“");
  });
  // Stichwort/Ort kommen nach dem Melder: laufende Anzeige ergänzen
  on("alarm-update", (a) => {
    const act = loadActive();
    if (!enabled() || !act || act.test || !a?.own) return;
    act.ev = { ...act.ev, keyword: a.keyword, unit: a.unit, address: a.address };
    saveActive(act);
    discord.active = act;
    push(buildActivity(cfg(), act.ev, act.start));
  });
  on("restore", () => { if (loadActive() && cfg().clearOnRestore !== false) endPresence("„Einsatz beenden“"); });
  on("settings", ({ path }) => {
    if (path === "discord.enabled" && !settings().discord.enabled) endPresence("ausgeschaltet");
  });
  setInterval(tick, 30e3);
  setTimeout(tick, 4000);
}

/** Einstellung „Vorlage“ übernehmen. */
export function applyPreset(id) {
  const p = PRESETS[id];
  if (!p) return;
  for (const [k, v] of Object.entries(p)) if (!["label", "hint"].includes(k)) set(`discord.${k}`, v);
}
