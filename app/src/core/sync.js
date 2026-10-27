// Abgleich ohne Zentrale: Handy und PCs halten dieselben Einstellungen.
// Jeder Bereich hat einen Zeitstempel der letzten Änderung – beim Abgleich gewinnt der neuere Stand.
// Das Handy ist die Drehscheibe: Es holt bei jedem PC ab (GET /config) und schickt den
// zusammengeführten Stand zurück (POST /config). So kommen Änderungen auch von PC zu PC.
//
// Bereiche:
//   betrieb  Betriebsart + Zentrale-Adresse
//   alarm, notify, ui   allgemeine Einstellungen (SYNC_KEYS; die Kennung bleibt je Gerät)
//   pc       PC-Einstellungen (ohne „Auch für“ und MAC – die gelten je PC)
//   shared   Routinen, WLAN-Geräte, Personen, Voice Monkey … (nur wenn beide ohne Zentrale laufen)
//   einsaetze  Einsatz-Logbuch – wird zusammengeführt (core/stats.js), nicht ersetzt
// Divera-/aPager-Schlüssel, App-PIN und Gerätename bleiben immer auf dem Gerät.
import { on, emit } from "./events.js";
import { settings, set, replace, mode, SYNC_KEYS } from "./settings.js";
import { shared, replaceShared } from "./shared.js";
import { hasPcFeatures } from "./platform.js";
import { statsEntries, mergeEinsaetze } from "./stats.js";
import { ownLog, remoteLogs, mergeRemoteLogs } from "./log.js";
import { platformName } from "./platform.js";

const TS_KEY = "heimalarm.sync.ts";
const SECTIONS = ["betrieb", ...SYNC_KEYS, "pc", "shared"];
const PC_LOCAL = ["alsoFor", "wolMac"];

function loadTs() {
  let t = {};
  try { t = JSON.parse(localStorage.getItem(TS_KEY) || "{}") || {}; } catch { /* leer */ }
  // Erster Start mit Abgleich: Der Stand des Handys gilt (1 schlägt 0), bis jemand etwas ändert.
  for (const s of SECTIONS) if (typeof t[s] !== "number") t[s] = hasPcFeatures ? 0 : 1;
  return t;
}
const ts = loadTs();
const saveTs = () => { try { localStorage.setItem(TS_KEY, JSON.stringify(ts)); } catch { /* voll */ } };

export const syncEnabled = () => settings().sync?.enabled !== false;

function touch(section) {
  ts[section] = Date.now();
  saveTs();
  emit("sync-dirty", section);
}

function sectionOf(path) {
  const root = String(path).split(".")[0];
  if (root === "mode" || root === "broker") return "betrieb";
  if (root === "pc") return PC_LOCAL.includes(String(path).split(".")[1]) ? null : "pc";
  return SYNC_KEYS.includes(root) ? root : null;
}

on("settings", ({ path, silent }) => {
  if (silent) return;
  const sec = sectionOf(path);
  if (sec) touch(sec);
});
on("shared-local", () => { if (mode() === "direkt") touch("shared"); });

const strip = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !keys.includes(k)));

/** Eigener Stand zum Verschicken. */
export function bundle() {
  const s = settings();
  const out = { ts: { ...ts }, mode: mode(), betrieb: { mode: mode(), broker: s.broker }, pc: strip(s.pc, PC_LOCAL) };
  for (const k of SYNC_KEYS) out[k] = s[k];
  if (mode() === "direkt") out.shared = strip(shared(), ["common"]);
  if (settings().features?.logbuch) out.einsaetze = statsEntries();   // Einsatz-Logbuch: wird zusammengeführt, nicht ersetzt
  // Protokolle: eigenes + die schon bekannten anderer Geräte (das Handy reicht sie von PC zu PC weiter)
  if (s.device?.id) out.devlogs = { ...remoteLogs(), [s.device.id]: { name: s.device.name || platformName, at: Date.now(), entries: ownLog() } };
  return out;
}

/** Fremden Stand übernehmen, wo er neuer ist. Liefert die geänderten Bereiche. */
export function applyBundle(b) {
  if (!b || typeof b !== "object" || !b.ts || !syncEnabled()) return [];
  const changed = [];
  for (const sec of SECTIONS) {
    const theirs = Number(b.ts[sec]) || 0;
    if (!b[sec] || theirs <= ts[sec]) continue;
    if (sec === "betrieb") {
      if (b.betrieb.broker) replace("broker", b.betrieb.broker);
      if (b.betrieb.mode === "zentrale" || b.betrieb.mode === "direkt") set("mode", b.betrieb.mode, { silent: true });
    } else if (sec === "alarm") {
      replace("alarm", { ...b.alarm, me: settings().alarm.me });
    } else if (sec === "pc") {
      replace("pc", { ...b.pc, ...Object.fromEntries(PC_LOCAL.map((k) => [k, settings().pc[k]])) });
    } else if (sec === "shared") {
      // Routinen usw. nur abgleichen, wenn hier auch ohne Zentrale gearbeitet wird (sonst kommen sie von der Zentrale)
      if (mode() !== "direkt" || b.mode !== "direkt") continue;
      replaceShared(b.shared);
    } else {
      replace(sec, b[sec]);
    }
    ts[sec] = theirs;
    changed.push(sec);
  }
  if (Array.isArray(b.einsaetze) && mergeEinsaetze(b.einsaetze)) changed.push("einsaetze");
  if (b.devlogs) mergeRemoteLogs(b.devlogs, settings().device?.id);
  if (changed.length) { saveTs(); emit("sync-applied", changed); }
  return changed;
}

export const SYNC_LABELS = { betrieb: "Betriebsart", alarm: "Alarm", notify: "Meldungen", ui: "Darstellung", pc: "PC-Einstellungen", shared: "Routinen & Geräte", einsaetze: "Einsätze" };
