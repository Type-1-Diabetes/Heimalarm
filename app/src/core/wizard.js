// Einrichtung Schritt für Schritt: drei Fragen → persönlicher Plan → Anleitung mit Live-Prüfung.
// Fortschritt liegt in settings().wizard (nur auf diesem Gerät, nicht abgeglichen).
import { settings, set, mode, isConfigured } from "./settings.js";
import { shared } from "./shared.js";
import { state } from "./mqtt.js";
import { direct } from "./direct.js";
import { divera } from "./divera.js";
import { androidStatus } from "./android.js";
import { isAndroid, hasPcFeatures } from "./platform.js";
import { emit } from "./events.js";

/** Fragen: [id, Titel, Erklärung, Hinweis, Symbol, Bereichsfarbe] */
export const SOURCES = [
  ["esp", "Melder in der Ladeschale", "ESP32 am Relaiskontakt deines Melders", "Braucht Zentrale", "bell", "--c-alarm"],
  ["sybos", "SYBOS", "Heimalarm liest die Meldung am Handy mit", "", "bell", "--c-phone"],
  ["apager", "aPager PRO", "Mitlesen, optional Rückmeldung „Ich fahre“", "", "bell", "--c-phone"],
  ["divera", "Divera 24/7", "Über die Divera-API mit deinem Schlüssel", "", "link", "--c-net"],
];
export const ACTIONS = [
  ["pc", "„Fährst du?“ am PC", "Vollbild mit Countdown, danach Ruhezustand", "", "pc", "--c-pc"],
  ["wifi", "Licht über WLAN", "Shelly, Hue, WLED, Tasmota", "", "bulb", "--c-people"],
  ["zigbee", "Zigbee-Licht", "USB-Stick an der Zentrale", "Braucht Zentrale", "bulb", "--c-people"],
  ["alexa", "Alexa-Routine", "Über Voice Monkey (Internet)", "", "voice", "--c-voice"],
  ["matter", "Alexa & Google über Matter", "Lokal, ohne Cloud", "Braucht Zentrale", "voice", "--c-voice"],
];
export const ALWAYS = [
  ["nein", "Nein, nur Handy und PC", "Das Handy gibt den Alarm per WLAN an den PC weiter.", "phone", "--c-phone"],
  ["ja", "Ja, ein Gerät läuft immer", "Raspberry Pi, NAS, Mini-PC oder alter Laptop mit Docker.", "hub", "--c-net"],
  ["weiss", "Weiß ich nicht", "Wir starten ohne. Wechseln geht jederzeit.", "home", "--c-app"],
];
export const INTRO = [
  { key: "start", title: "Willkommen", sub: "Kurz erklärt", icon: "home", color: "--c-alarm" },
  { key: "src", title: "Alarm", sub: "Wie kommt er an?", icon: "bell", color: "--c-alarm" },
  { key: "act", title: "Bei Alarm", sub: "Was soll passieren?", icon: "flow", color: "--c-routine" },
  { key: "dev", title: "Zentrale", sub: "Läuft ein Gerät immer?", icon: "hub", color: "--c-net" },
  { key: "plan", title: "Dein Plan", sub: "Übersicht der Schritte", icon: "chart", color: "--c-app" },
];

const w = () => settings().wizard;
export const answers = () => w().answers;
export const needsPi = (a = answers()) => a.src.includes("esp") || a.act.some((x) => x === "zigbee" || x === "matter");
export const withPi = (a = answers()) => a.always === "ja";
/** Was dieses Gerät ist: Schritte für das andere Gerät werden nur angezeigt. */
export const here = hasPcFeatures ? "pc" : isAndroid ? "phone" : "both";

const has = (list, x) => list.includes(x);

/** Persönlicher Plan aus den Antworten. where: pc | phone | both | pi */
export function plan(a = answers()) {
  const p = [], z = withPi(a);
  const apps = a.src.some((x) => ["sybos", "apager", "divera"].includes(x));
  const add = (key, title, where, icon, color) => p.push({ key, title, where, icon, color });
  if (z) { add("zentrale", "Zentrale starten", "pi", "hub", "--c-net"); add("verbinden", "Mit Zentrale verbinden", "both", "net", "--c-net"); }
  else add("koppeln", "Handy mit PC koppeln", "both", "link", "--c-net");
  if (z && has(a.src, "esp")) add("esp", "Melder anschließen", "pi", "bell", "--c-alarm");
  if (has(a.src, "sybos")) add("sybos", "SYBOS mitlesen", "phone", "bell", "--c-phone");
  if (has(a.src, "apager")) add("apager", "aPager mitlesen", "phone", "bell", "--c-phone");
  if (has(a.src, "divera")) add("divera", "Divera-Schlüssel", "both", "link", "--c-net");
  if (apps) add("akku", "Im Hintergrund wach halten", "phone", "phone", "--c-phone");
  if (has(a.act, "pc")) add("pc", "„Fährst du?“ einstellen", "pc", "pc", "--c-pc");
  if (has(a.act, "wifi")) add("wifi", "WLAN-Licht hinzufügen", "both", "bulb", "--c-people");
  if (z && has(a.act, "zigbee")) add("zigbee", "Zigbee-Stick anlernen", "pi", "bulb", "--c-people");
  if (has(a.act, "alexa")) add("alexa", "Voice Monkey verbinden", "both", "voice", "--c-voice");
  if (z && has(a.act, "matter")) add("matter", "Mit Alexa/Google koppeln", "both", "voice", "--c-voice");
  add("test", "Testalarm", "both", "tool", "--c-alarm");
  return p;
}

export const total = () => INTRO.length + plan().length;
export const WHERE = { pc: "PC", phone: "Handy", both: "PC + Handy", pi: "Zentrale" };
/** Schritt gehört (auch) zu diesem Gerät? */
export const isMine = (where) => here === "both" || where === "both" || where === here || (where === "pi" && here === "pc");

/** Startwerte aus dem, was schon eingerichtet ist. */
function guess() {
  const s = settings(), apps = s.alarm.apps || {};
  const src = ["sybos", "apager", "divera"].filter((k) => apps[k]?.on);
  if (isConfigured() && s.alarm.mqtt !== false) src.push("esp");
  const act = [];
  if (hasPcFeatures || (s.direct.peers || []).length) act.push("pc");
  if ((shared().wifi || []).length) act.push("wifi");
  if (shared().voicemonkey?.token) act.push("alexa");
  return { src: src.length ? src : ["sybos"], act: act.length ? act : ["pc"], always: mode() === "zentrale" ? "ja" : "nein" };
}

/** Assistent (neu) beginnen. */
export function startWizard() {
  set("wizard", { ...w(), done: false, step: 0, answers: guess(), ok: {} });
}

export function setStep(n) {
  const max = total() - 1;
  set("wizard", { ...w(), step: Math.max(0, Math.min(n, max)) });
}

export function setAnswers(patch) {
  set("wizard", { ...w(), answers: { ...answers(), ...patch } });
}

/** Antworten in die echten Einstellungen übernehmen (beim Start der Anleitung). */
export function applyAnswers() {
  const a = answers();
  set("mode", withPi(a) ? "zentrale" : "direkt");
  const apps = structuredClone(settings().alarm.apps);
  for (const k of ["sybos", "apager", "divera"]) apps[k] = { ...apps[k], on: a.src.includes(k) };
  set("alarm.apps", apps);
  set("alarm.mqtt", withPi(a) && a.src.includes("esp"));
  emit("conn", {});
}

export function markOk(key, ok = true) {
  set("wizard", { ...w(), ok: { ...w().ok, [key]: ok } });
}

export function finish() { set("wizard", { ...w(), done: true, step: 0 }); }

/** Noch nicht fertig, aber begonnen? (Karte „Einrichtung fortsetzen“) */
export const inProgress = () => !w().done && w().step > 0;

/** Beim ersten Start: Bestandsnutzer, die schon etwas eingerichtet haben, nicht mit dem Assistenten überraschen. */
export function needsWizard() {
  if (w().done) return false;
  const s = settings();
  const set_up = isConfigured() || (s.direct.peers || []).length || (s.direct.phones || []).length
    || Object.values(s.alarm.apps || {}).some((x) => x?.on) || s.divera.key;
  if (set_up && w().step === 0) { finish(); return false; }
  return true;
}

/* ── Live-Prüfung: ist der Schritt schon erledigt? null = nicht prüfbar (Haken von Hand) ── */
let android = null;
export async function refreshAndroid() {
  if (!isAndroid) return;
  try { android = await androidStatus(); } catch { android = null; }
  emit("wizard", {});
}
/** Letzter Android-Status (Benachrichtigungszugriff, Akku …) – null, solange noch nicht geladen. */
export const androidState = () => android;

export function check(key) {
  const s = settings(), manual = Boolean(w().ok[key]);
  switch (key) {
    case "koppeln":
      if (hasPcFeatures) return (s.direct.phones || []).length > 0 || manual;
      return (s.direct.peers || []).some((p) => direct.peers[p.id]?.ok) || manual;
    case "verbinden": return Boolean(state.connected);
    case "sybos": case "apager":
      if (isAndroid && android?.supported) return Boolean(android.notificationAccess);
      return manual;
    case "akku":
      if (isAndroid && android?.supported) return android.batteryOptimized === false;
      return manual;
    case "divera": return divera.ok === true && Boolean(s.divera.key);
    case "alexa": return Boolean(shared().voicemonkey?.token);
    case "wifi": return (shared().wifi || []).length > 0 || manual;
    default: return manual;
  }
}
