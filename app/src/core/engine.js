// Alarm-Logik in der App: Sperrzeit je Person, eigene vs. fremde Alarme, Test/Probe,
// Ruhezeiten und Ausnahmen am PC, Ablauf nach „Fährst du?“.
// Routinen (Licht usw.) laufen im Zentrale-Programm, damit sie auch ohne Handy/PC funktionieren.
import { on, emit } from "./events.js";
import { settings, mode, phoneMode } from "./settings.js";
import { sendToPeers } from "./direct.js";
import { log } from "./log.js";
import { hasPcFeatures, isAndroid, isTauri } from "./platform.js";
import { ACTIONS, runPcAction, runningProcesses, stopMedia } from "./pc.js";
import { notify } from "./notify.js";
import { publish, state } from "./mqtt.js";
import { fmtTime } from "../ui/dom.js";
import { answerDivera } from "./divera.js";
import { answerApager } from "./apager.js";
import { presenceSettled } from "./discord.js";
import { runHotkeys } from "./hotkeys.js";
import { parseSybos } from "./sybos.js";
import { recordAlarm, recordAnswer, addSignal, addLate, markEvent, noteLast } from "./stats.js";
import { readiness } from "./readiness.js";
const offDuty = () => readiness().mode !== "ready";

const lastByWho = new Map();
export const engine = { last: null };

export function init() {
  on("alarm-in", (a) => {
    if (a.from && a.from === settings().device.id) return;   // eigener gehaltener Alarm kommt zurück – hier schon ausgelöst
    if (a.held) log("info", `Alarm ${a.held} s verzögert`, "Das Handy hatte ihn gehalten, weil die Zentrale kurz weg war");
    handleAlarm(a);
  });
  on("conn", sendHeld);
  // Nachgereichte Einsatzinfos: Meldung mit Stichwort und Ort nachschicken (nur wenn vorher eine Meldung kam)
  on("alarm-update", (a) => {
    if (!a.notified) return;
    const extra = [a.keyword, a.unit].filter(Boolean).join(" · ");
    notify(a.own ? `Heimalarm: ${a.keyword || "Einsatz"}` : `Heimalarm: Alarm von ${a.who}`, [fmtTime(a.ts), a.keyword ? a.unit : extra, a.address].filter(Boolean).join(" · "));
  });
  on("divera-alarm", (data) => forward(data));
  on("webhook-alarm", (data) => forward(data));   // aPager-Webhook direkt am PC
  on("test-request", () => testAlarm());   // Testalarm an dieses Gerät (von einem anderen Gerät)
  on("alarm-event", (ev) => alarmEvent(ev));   // Rückalarm / Alarmende (aPager-Webhook)
}

/** Alarm aus einer App-Quelle (Benachrichtigung, Divera): über die Zentrale an alle Geräte, ohne Verbindung nur hier. */
/** Gehaltene Alarme, solange die Zentrale weg ist (nur echte, nicht Tests). */
const held = [];

function forward(data) {
  const me = settings().alarm.me;
  if (mode() === "direkt") {
    handleAlarm({ who: me, ts: Date.now(), ...data });
    // Handy → gekoppelte PCs. Nicht erreicht (PC aus, Handy unterwegs): PC macht nichts, Einsatz bekommt einen Vermerk.
    if (!hasPcFeatures && (settings().direct.peers || []).length) sendToPeers(data).then((ok) => { if (!ok && !data.test && !data.probe) noteLast({ pcMissed: true }); });
    return;
  }
  if (state.connected && publish(`alarm/${me}`, data)) return;
  handleAlarm({ who: me, ts: Date.now(), ...data });
  // Zentrale gerade weg: echten Alarm halten und nachreichen, sobald sie wieder da ist (Einstellung „Alarm halten“)
  const hold = Math.min(120, Math.max(0, Number(settings().alarm.holdSec) || 0));
  if (hold && !data.test && !data.probe && mode() === "zentrale") {
    held.push({ data, ts: Date.now() });
    log("warn", "Zentrale nicht erreichbar – Alarm wird gehalten", `bis zu ${hold} s, danach nur auf diesem Gerät`);
  }
}

function sendHeld() {
  if (!held.length || !state.connected) return;
  const me = settings().alarm.me;
  const hold = Math.min(120, Math.max(0, Number(settings().alarm.holdSec) || 0)) * 1000;
  for (const { data, ts } of held.splice(0)) {
    const age = Date.now() - ts;
    if (age > hold) { log("info", "Gehaltener Alarm nicht weitergegeben", `${Math.round(age / 1000)} s alt – länger als „Alarm halten“`); continue; }
    publish(`alarm/${me}`, { ...data, held: Math.round(age / 1000), from: settings().device.id });
    noteLast({ held: Math.round(age / 1000) });
    log("action", "Gehaltener Alarm weitergegeben", `${Math.round(age / 1000)} s verzögert`);
  }
}

export const ALARM_APPS = {
  sybos: { label: "SYBOS" },
  apager: { label: "aPager PRO" },
  divera: { label: "Divera 24/7" },
};
/** Zuletzt gesehene Apps mit Benachrichtigungen (nur Paketnamen), zum Erkennen des richtigen Pakets. */
export const recentApps = new Map();

const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
function inQuietTime() {
  const { quietFrom, quietTo } = settings().pc;
  if (!quietFrom || !quietTo) return false;
  const d = new Date(), n = d.getHours() * 60 + d.getMinutes(), a = toMin(quietFrom), b = toMin(quietTo);
  return a <= b ? n >= a && n < b : n >= a || n < b;
}

/** Der Melder meldet nur „Alarm“, Stichwort und Ort kommen Sekunden später aus aPager, Divera oder SYBOS.
 *  Fehlendes beim laufenden Einsatz ergänzen und „alarm-update“ senden: Vollbild, Meldung und Discord ziehen nach. */
const INFO = ["keyword", "unit", "address", "text", "diveraId"];
function mergeInfo(a) {
  const last = engine.last;
  if (!last || last.who !== a.who || last.test) return;
  let changed = false;
  for (const k of INFO) {
    if (!a[k]) continue;
    const better = k === "keyword" && last.keyword && a.keyword.length > last.keyword.length && a.keyword.toLowerCase().includes(last.keyword.toLowerCase());
    if (!last[k] || better) { last[k] = a[k]; changed = true; }
  }
  if (a.source && !(last.sources ||= [last.source]).includes(a.source)) {
    last.sources.push(a.source);
    (last.srcAt ||= {})[a.source] = Math.max(0, Math.round((a.ts - last.ts) / 1000));   // Vollbild: „aPager +6 s“
    changed = true;
  }
  if (changed) emit("alarm-update", last);
}

function handleAlarm(a) {
  const s = settings().alarm;
  const test = Boolean(a.test || s.testMode);
  const probe = Boolean(a.probe);
  if (a.source === "ESP32" && !s.mqtt) return;
  // A4 – Sperrzeit: weiteres Signal derselben Person kurz danach ist derselbe Einsatz (A5 – Quellen zusammenführen)
  if (!test && !probe && a.ts - (lastByWho.get(a.who) || 0) < s.lockoutSec * 1000) {
    log("info", "Weiteres Signal zusammengeführt (Sperrzeit)", `${a.source} · ${a.who}`);
    if (a.who === s.me) addSignal(a);   // Quelle und weitere Infos beim Einsatz ergänzen
    mergeInfo(a);
    return;
  }
  if (!test && !probe) lastByWho.set(a.who, a.ts);

  const own = a.who === s.me;
  // Ein PC kann zusätzlich für weitere Personen gelten (gemeinsamer PC)
  const also = String(settings().pc?.alsoFor || "").split(",").map((x) => x.trim()).filter(Boolean);
  const forThisPc = own || (hasPcFeatures && also.includes(a.who));
  engine.last = { ...a, own, test: test || probe, probe };
  const extra = [a.keyword, a.unit].filter(Boolean).join(" · ");
  log("alarm", probe ? "Generalprobe" : test ? "Testalarm" : own ? "Alarm" : `Alarm von „${a.who}“`,
    `${a.source} · alarm/${a.who}${extra ? " · " + extra : ""}`);
  emit("alarm", engine.last);
  if (own && !test && !probe) recordAlarm(a);   // Einsatz-Statistik

  // Nicht verfügbar / Abwesend (Start → Bereitschaft): verbunden, aber bei Alarm passiert nichts
  if (offDuty() && !test && !probe) { log("info", "Nicht verfügbar – keine Abfrage, kein Ton"); return; }
  if (forThisPc && hasPcFeatures) {
    if (settings().pc?.silent && !test && !probe) { log("info", "PC bei Alarm aus – keine Abfrage"); return; }
    if (inQuietTime() && !test && !probe) { log("info", "Ruhezeit am PC – keine Abfrage"); return; } // D12
    emit("takeover", engine.last);
  } else if (own && isTauri && isAndroid && !test) {
    const pm = phoneMode();
    if (pm === "off" && !probe) { log("info", "Handy bei Alarm aus – nichts angezeigt"); return; }
    if (a.phoneDone) { log("info", "Alarm-App wurde schon geöffnet"); return; }
    if (pm === "app") { emit("phone-open-app", engine.last); return; }   // core/android.js öffnet SYBOS/aPager/Divera
    if (settings().phone?.ask === false) { emit("phone-alert", engine.last); return; }   // ohne Abfrage: nur Mitteilung, Ton, Vibration
    emit("takeover", engine.last);   // Handy: groß anzeigen, Ton/Vibration (AlarmSound.kt), Rückmeldung per Knopf
  } else if (!test) {
    engine.last.notified = true;
    notify(own ? "Heimalarm: Einsatz" : `Heimalarm: Alarm von ${a.who}`, `${fmtTime(a.ts)}${extra ? " · " + extra : " · Einsatzinfos folgen"}`);
  }
}

/** Rückalarm („recall“) oder Alarmende („clear“), z. B. vom aPager-Webhook: kein neuer Alarm. */
function alarmEvent(ev) {
  const label = ev.event === "recall" ? "Rückalarm – Einsatz zurückgenommen" : "Alarmende";
  const extra = [ev.keyword, ev.unit].filter(Boolean).join(" · ");
  log("info", ev.who === settings().alarm.me ? label : `${label} („${ev.who}“)`, extra || ev.source || "");
  if (ev.who !== settings().alarm.me) return;
  markEvent(ev);
  if (ev.event === "recall") notify("Heimalarm: Rückalarm", extra ? `Einsatz zurückgenommen · ${extra}` : "Einsatz zurückgenommen");
}

/** I1 – Testalarm nur in dieser App (keine Routinen). */
export function testAlarm() {
  handleAlarm({ who: settings().alarm.me, source: "Test", ts: Date.now(), test: true });
  if (!hasPcFeatures) emit("takeover", engine.last);
}

/** A11 – Melder-Alarm nachspielen: geht über die Zentrale an alle Geräte, Routinen laufen im Testmodus. */
export const simulateContact = () => { publish(`alarm/${settings().alarm.me}/led/test`, "test"); return publish(`alarm/${settings().alarm.me}`, { source: "Simulation", test: true }); };

/** I2 – Generalprobe: Routinen schalten wirklich, PC-Aktion wird nur angezeigt. */
export const fullProbe = () => (mode() === "direkt" ? (forward({ source: "Generalprobe", probe: true }), true) : publish(`alarm/${settings().alarm.me}`, { source: "Generalprobe", probe: true }));

/** Älter als das: kein Alarm mehr, nur Einsatzinfos ergänzen. */
const LATE_MS = 2 * 60e3;
/** Schon verarbeitete Benachrichtigungen (live und aus dem Puffer kann dieselbe kommen). */
const seenNotes = new Map();

/** Alarm aus einer Android-Benachrichtigung (A1/A6). ts = Zeitpunkt der Benachrichtigung. */
export function alarmFromNotification({ app, title, text, ts, handled = false }) {
  const s = settings().alarm;
  const pkg = String(app || "").toLowerCase();
  if (pkg) { recentApps.delete(pkg); recentApps.set(pkg, Date.now()); if (recentApps.size > 12) recentApps.delete(recentApps.keys().next().value); }
  // Welche aktivierte Alarm-App passt?
  let source = null;
  for (const [id, a] of Object.entries(s.apps || {})) {
    if (a.on && a.pkg && pkg.includes(a.pkg.toLowerCase())) { source = ALARM_APPS[id]?.label || id; break; }
  }
  if (!source) {
    const extra = s.filterApps.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (extra.some((x) => pkg.includes(x))) source = "Benachrichtigung";
  }
  if (!source) return;
  const words = s.filterWords.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const body = `${title} ${text}`.toLowerCase();
  if (words.length && !words.some((w) => body.includes(w))) return;
  const now = Date.now();
  const at = Number(ts) > 0 && Number(ts) <= now ? Number(ts) : now;
  const key = `${pkg}|${at}|${title}`;
  for (const [k, t] of seenNotes) if (now - t > 24 * 3600e3) seenNotes.delete(k);
  if (seenNotes.has(key)) return;
  seenNotes.set(key, now);
  const data = { source, keyword: String(title || "").slice(0, 80), text: String(text || "").slice(0, 1000), app: pkg, ts: at };
  // SYBOS: „ALARMIERUNG (Fahrzeug) - Zeit - Stichwort“ in Stichwort, Einheit und Einsatznummer zerlegen
  const sy = pkg.includes("syphone") ? parseSybos(title, text) : null;
  if (sy) Object.assign(data, { keyword: sy.keyword.slice(0, 80), text: sy.text.slice(0, 1000) }, sy.unit ? { unit: sy.unit } : {}, Object.keys(sy.details).length ? { details: sy.details } : {});
  if (now - at > LATE_MS) {
    // Zu spät für „Fährst du?“ und Routinen: nur den Einsatz im Logbuch ergänzen
    log("info", "Verspätete Meldung – Einsatz ergänzt, kein Alarm", `${source} · ${fmtTime(at)} · ${Math.round((now - at) / 60e3)} min später verarbeitet`);
    addLate({ who: s.me, ...data });
    return;
  }
  forward({ ...data, ...(handled ? { phoneDone: true } : {}) });
}

/** Antwort an die Alarm-Apps weitergeben, die dafür eingerichtet sind. */
export async function answerApps(going) {
  const s = settings();
  const jobs = [];
  if (s.alarm.apps.divera.on && s.divera.key) jobs.push(answerDivera(going, engine.last));
  if (s.alarm.apps.apager.on && s.apager.key && s.apager.feedback) jobs.push(answerApager(going).then((r) => r.ok));
  return (await Promise.all(jobs)).some(Boolean);
}

/** Ergebnis der Abfrage „Fährst du?“ */
/** remote = am anderen Gerät beantwortet: nicht erneut an Divera/aPager melden. */
export async function decide(going, { test = false, timeout = false, remote = false, from = "" } = {}) {
  const p = settings().pc;
  if (!test) recordAnswer(going, { timeout });
  emit("answer", { going, test, timeout, remote, from, alarm: engine.last });   // z. B. Discord-Status (core/discord.js)
  // Rückmeldung an Divera / aPager (nicht bei Tests, nicht ohne Antwort)
  if (!test && !timeout && !remote) answerApps(going);
  if (!going) {
    log("info", timeout ? "Keine Antwort – keine Aktion (Einstellung „Abbrechen“)" : "„Ich fahre nicht“ – keine Aktion");
    return;
  }
  let action = p.action;
  const why = timeout ? "Keine Antwort" : "„Ich fahre“";
  // D7 – Ausnahmen: bestimmte Programme verhindern die PC-Aktion
  const names = p.exceptions.split(",").map((x) => x.trim()).filter(Boolean);
  if (hasPcFeatures && names.length && action !== "none" && action !== "lock") {
    const running = await runningProcesses(names).catch(() => []);
    if (running.length) { log("info", `Ausnahme aktiv (${running.join(", ")}) – PC wird nur gesperrt`); action = "lock"; }
  }
  const label = ACTIONS[action]?.label || action;
  if (test || action === "none" || !hasPcFeatures) {
    log("action", `${why} → ${label}`, test ? "Test: nicht ausgeführt" : "nicht ausgeführt");
    return;
  }
  if (p.stopMedia) await stopMedia().catch(() => {}); // D8
  await runHotkeys().catch((e) => log("warn", "Tasten vor dem Ruhezustand", String(e)));   // z. B. Strg+S in Blender
  // Discord-Status soll noch rausgehen, bevor der PC schläft (höchstens 3 s warten)
  await Promise.race([presenceSettled(), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
  log("action", `${why} → ${label}`, "wird ausgeführt");
  try { await runPcAction(action); }
  catch (e) { log("warn", `${label} fehlgeschlagen`, String(e)); }
}
