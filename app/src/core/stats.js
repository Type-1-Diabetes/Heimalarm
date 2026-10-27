// Einsatz-Logbuch: jede echte eigene Alarmierung mit allen Infos, die die Quelle liefert
// (Stichwort, Einheit, Text, Adresse, Divera-Felder …), dazu Antwort, Reaktionszeit und eigene Notizen.
// Liegt auf dem Gerät (localStorage) und wird – wenn der Abgleich an ist – mit den anderen Geräten
// zusammengeführt: über die Zentrale (heimalarm/einsaetze/<kennung>) oder direkt (core/sync.js).
// Derselbe Einsatz auf zwei Geräten wird an der Zeit erkannt (± 2 Minuten) und zusammengelegt.
import { getLog } from "./log.js";
import { emit } from "./events.js";
import { settings } from "./settings.js";

/** Logbuch ist eine Zusatzfunktion: ohne Einschalten wird nichts gespeichert. */
const on = () => Boolean(settings().features?.logbuch);
import { platformName } from "./platform.js";
import { parseSybos } from "./sybos.js";

const KEY = "heimalarm.stats.v1";
const MAX = 1000;
const SAME_MS = 2 * 60e3;           // gleicher Einsatz, wenn so nah beieinander
const ANSWER_WINDOW = 2 * 3600e3;   // Antwort zählt nur für einen Alarm der letzten 2 Stunden
const FIELDS = ["keyword", "unit", "text", "address", "diveraId", "app"];

/** Ausführlicheres Stichwort gewinnt, wenn es das kürzere enthält („B3“ → „B3 Wohnungsbrand“). */
function betterKeyword(target, kw) {
  if (kw && target.keyword && kw.length > target.keyword.length && kw.toLowerCase().includes(target.keyword.toLowerCase())) target.keyword = kw;
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Nur einfache Werte übernehmen (Text, Zahl, Ja/Nein), höchstens ~1500 Zeichen. */
export function pickDetails(obj, skip = []) {
  const out = {};
  let size = 0;
  for (const [k, v] of Object.entries(obj || {})) {
    if (skip.includes(k) || v == null || v === "" || !["string", "number", "boolean"].includes(typeof v)) continue;
    const val = typeof v === "string" ? v.slice(0, 300) : v;
    size += k.length + String(val).length;
    if (size > 1500) break;
    out[k] = val;
  }
  return out;
}

/** Ältere SYBOS-Einträge mit Roh-Titel („ALARMIERUNG (LOHBR1) - 08:22:28 - ALARM“) nachträglich zerlegen. */
function fixSybos(e) {
  const sy = e && !e.deleted ? parseSybos(e.keyword, e.text) : null;
  if (!sy) return e;
  const out = { ...e, keyword: sy.keyword, text: sy.text || "" };
  if (sy.unit) { out.unit ||= sy.unit; out.units = [...new Set([...(e.units || []), sy.unit])]; }
  if (Object.keys(sy.details).length) out.details = { ...sy.details, ...e.details };
  return out;
}

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (Array.isArray(v)) return v.map((e) => fixSybos({ id: e.id || newId(), sources: e.sources || (e.source ? [e.source] : []), ...e }));
  } catch { /* leer */ }
  // Erster Start: frühere eigene Alarme aus dem Protokoll übernehmen
  return getLog("alarm")
    .filter((e) => e.text === "Alarm")
    .map((e) => {
      const parts = String(e.detail || "").split(" · ");
      return { id: newId(), ts: e.ts, source: parts[0] || "", sources: parts[0] ? [parts[0]] : [], keyword: parts[2] || "", answer: null };
    })
    .toSorted((a, b) => a.ts - b.ts);
}
let list = load();

function save({ quiet = false } = {}) {
  list.sort((a, b) => a.ts - b.ts);
  if (list.length > MAX) list = list.slice(-MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* voll */ }
  emit("einsaetze", list);
  if (!quiet) emit("sync-dirty", "einsaetze");
}
save({ quiet: true });

export const statsEntries = () => list;
export const getEinsatz = (id) => list.find((e) => e.id === id);

/** Neuer Alarm (nur echte, eigene). */
export function recordAlarm(a) {
  if (!on()) return;
  const e = { id: newId(), ts: a.ts || Date.now(), who: a.who || "", source: a.source || "", sources: a.source ? [a.source] : [], units: a.unit ? [a.unit] : [], answer: null, device: settings().device.name || platformName };
  for (const k of FIELDS) if (a[k]) e[k] = a[k];
  if (a.details && Object.keys(a.details).length) e.details = a.details;
  if (a.viaPhone) e.via = "Handy";
  list.push(e);
  save();
}

/** Weiteres Signal desselben Einsatzes (Sperrzeit): Quelle und fehlende Infos ergänzen. */
export function addSignal(a) {
  if (!on()) return;
  const last = list.at(-1);
  if (!last || Math.abs((a.ts || Date.now()) - last.ts) > ANSWER_WINDOW) return;
  if (a.source && !last.sources.includes(a.source)) {
    last.sources.push(a.source);
    (last.srcAt ||= {})[a.source] = Math.max(0, Math.round(((a.ts || Date.now()) - last.ts) / 1000));   // Zeitversatz zum ersten Signal
  }
  // aPager ruft den Webhook je alarmierter Einheit einzeln auf → alle Einheiten sammeln
  last.units ||= last.unit ? [last.unit] : [];
  if (a.unit && !last.units.includes(a.unit)) last.units.push(a.unit);
  betterKeyword(last, a.keyword);
  for (const k of FIELDS) if (a[k] && !last[k]) last[k] = a[k];
  if (a.details) last.details = { ...a.details, ...last.details };
  save();
}

/** Verspätet verarbeitete Meldung (App lief nicht, Handy war unterwegs): zum Einsatz mit passender Zeit legen,
 *  sonst als eigenen Einsatz mit der echten Uhrzeit eintragen. Der Abgleich bringt es auf die anderen Geräte. */
export function addLate(a) {
  if (!on()) return;
  const e = list.filter((x) => !x.deleted && Math.abs(x.ts - a.ts) <= SAME_MS).toSorted((x, y) => Math.abs(x.ts - a.ts) - Math.abs(y.ts - a.ts))[0];
  if (!e) { recordAlarm(a); return; }
  if (a.source && !e.sources.includes(a.source)) {
    e.sources.push(a.source);
    (e.srcAt ||= {})[a.source] = Math.max(0, Math.round((a.ts - e.ts) / 1000));
  }
  betterKeyword(e, a.keyword);
  for (const k of FIELDS) if (a[k] && !e[k]) e[k] = a[k];
  if (a.ts < e.ts) e.ts = a.ts;   // frühester Zeitpunkt zählt (wie beim Abgleich)
  save();
}

/** going: true | false, timeout: keine Antwort am PC */
export function recordAnswer(going, { timeout = false } = {}) {
  if (!on()) return;
  const last = list.at(-1);
  if (!last || last.answer || Date.now() - last.ts > ANSWER_WINDOW) return;
  last.answer = timeout ? "timeout" : going ? "go" : "stay";
  last.answerTs = Date.now();
  save();
}

/** Eigene Angaben zu einem Einsatz (Fahrzeug, Funktion, Notiz). */
export function editEinsatz(id, patch) {
  const e = getEinsatz(id);
  if (!e) return;
  Object.assign(e, patch, { edited: Date.now() });
  save();
}

/** Rückalarm / Alarmende am letzten Einsatz vermerken. */
/** Kurzer Vermerk am letzten Einsatz (z. B. „PC nicht erreicht“). */
export function noteLast(patch) {
  if (!on()) return;
  const last = list.findLast((e) => !e.deleted);
  if (!last || Date.now() - last.ts > ANSWER_WINDOW) return;
  Object.assign(last, patch);
  save();
}

export function markEvent(ev) {
  if (!on()) return;
  const last = list.findLast((e) => !e.deleted);
  if (!last || (ev.ts || Date.now()) - last.ts > 12 * 3600e3) return;
  if (ev.event === "recall") last.recall = ev.ts || Date.now();
  else last.endTs = ev.ts || Date.now();
  last.units ||= last.unit ? [last.unit] : [];
  if (ev.unit && !last.units.includes(ev.unit)) last.units.push(ev.unit);
  save();
}

export function deleteEinsatz(id) {
  const e = getEinsatz(id);
  if (!e) return;
  // Gelöscht merken, damit der Abgleich ihn nicht von einem anderen Gerät zurückholt
  Object.assign(e, { deleted: true, edited: Date.now(), note: "", text: "", details: undefined });
  save();
}

export function clearStats() {
  const now = Date.now();
  for (const e of list) Object.assign(e, { deleted: true, edited: now });
  save();
}

/** Einträge eines anderen Geräts übernehmen. Liefert true, wenn sich hier etwas geändert hat. */
export function mergeEinsaetze(remote) {
  if (!Array.isArray(remote) || !on()) return false;
  let changed = false;
  for (const raw of remote) {
    if (!raw || typeof raw.ts !== "number") continue;
    const r = fixSybos(raw);
    const l = list.find((e) => e.id === r.id) || list.find((e) => !e.deleted && !r.deleted && Math.abs(e.ts - r.ts) <= SAME_MS);
    if (!l) { list.push(structuredClone(r)); changed = true; continue; }
    const before = JSON.stringify(l);
    // Eigene Angaben und Löschen: neuere Bearbeitung gewinnt
    if ((r.edited || 0) > (l.edited || 0)) {
      for (const k of ["note", "vehicle", "role", "deleted", "edited"]) if (k in r) l[k] = r[k];
      if (r.deleted) Object.assign(l, { text: "", details: undefined });
    }
    if (l.deleted) { if (JSON.stringify(l) !== before) changed = true; continue; }
    // Infos aus der Quelle ergänzen
    for (const k of [...FIELDS, "answer", "answerTs", "via", "recall", "endTs", "srcAt", "pcMissed", "held"]) if (r[k] && !l[k]) l[k] = r[k];
    betterKeyword(l, r.keyword);
    for (const s of r.sources || []) if (!l.sources.includes(s)) l.sources.push(s);
    if (r.units?.length) { l.units ||= []; for (const u of r.units) if (!l.units.includes(u)) l.units.push(u); }
    if (r.details) l.details = { ...r.details, ...l.details };
    if (r.ts < l.ts) l.ts = r.ts;                 // frühester Zeitpunkt zählt
    if (r.id < l.id) l.id = r.id;                 // auf allen Geräten dieselbe ID
    if (JSON.stringify(l) !== before) changed = true;
  }
  if (changed) save({ quiet: true });
  return changed;
}

/** Fingerabdruck des Stands, um Ping-Pong beim Abgleich zu vermeiden. */
export const fingerprint = () => JSON.stringify(list.map((e) => [e.id, e.edited || 0, e.answer || "", (e.sources || []).length, (e.units || []).length, e.recall || 0, e.endTs || 0]));
/** Alle Einheiten eines Einsatzes. */
export const unitsOf = (e) => (e.units?.length ? e.units : e.unit ? [e.unit] : []);

// ── Auswertung ─────────────────────────────────────────────────────────────

export const CATEGORIES = [
  ["Gefahrgut", /\babc\b|gefahrgut|gas(geruch|austritt)?\b|cbrn/iu],
  ["Wasserrettung", /wasserrettung|person im wasser|ertrinken|eisrettung/iu],
  ["Brand", /\bb\s?\d|brand|feuer|rauch|\bbma\b|brandmelde/iu],
  ["Technische Hilfe", /\bth\b|\bthl\b|technische hilfe|\bvu\b|verkehrsunfall|eingeklemmt|türöffnung|ölspur|baum/iu],
  ["Rettungsdienst", /\brd\b|rettungsdienst|notfall|first responder|\bfr\b|reanimation|notarzt|\bnef\b|\brtw\b/iu],
  ["Unwetter", /unwetter|sturm|hochwasser|überflutung|wasserschaden|keller/iu],
];
export function category(e) {
  const s = `${e.keyword || ""} ${e.text || ""}`;
  return CATEGORIES.find(([, re]) => re.test(s))?.[0] || "Sonstiges";
}

const alive = () => list.filter((e) => !e.deleted);
const countBy = (arr, fn) => {
  const m = {};
  for (const x of arr) { const k = fn(x); if (k != null && k !== "") m[k] = (m[k] || 0) + 1; }
  return Object.entries(m).toSorted((a, b) => b[1] - a[1]);
};
const isNight = (e) => { const h = new Date(e.ts).getHours(); return h >= 22 || h < 6; };
const goRate = (arr) => {
  const ans = arr.filter((e) => e.answer === "go" || e.answer === "stay");
  return ans.length ? { pct: Math.round((ans.filter((e) => e.answer === "go").length / ans.length) * 100), n: ans.length } : null;
};
const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

/** Kennzahlen für die Übersicht. */
export function summary(now = Date.now()) {
  const all = alive();
  const d = new Date(now);
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - 11 + i, 1);
    return {
      label: m.toLocaleDateString("de-DE", { month: "short" }).replace(".", ""),
      count: all.filter((e) => { const t = new Date(e.ts); return t.getFullYear() === m.getFullYear() && t.getMonth() === m.getMonth(); }).length,
    };
  });
  const rate = goRate(all);
  return {
    total: all.length,
    year: all.filter((e) => new Date(e.ts).getFullYear() === d.getFullYear()).length,
    last30: all.filter((e) => now - e.ts < 30 * 86400e3).length,
    goRate: rate?.pct ?? null, answered: rate?.n || 0,
    night: all.filter(isNight).length,
    sources: countBy(all.flatMap((e) => e.sources?.length ? e.sources : [e.source]), (s) => s),
    categories: countBy(all, category),
    months,
  };
}

export const years = () => [...new Set(alive().map((e) => new Date(e.ts).getFullYear()))].toSorted((a, b) => b - a);

/** Jahresrückblick. */
export function yearReview(year) {
  const ys = alive().filter((e) => new Date(e.ts).getFullYear() === year);
  if (!ys.length) return null;
  const monthName = (m) => new Date(year, Number(m), 1).toLocaleDateString("de-DE", { month: "long" });
  const topMonth = countBy(ys, (e) => new Date(e.ts).getMonth())[0];
  const topDay = countBy(ys, (e) => new Date(e.ts).getDay())[0];
  const topHour = countBy(ys, (e) => new Date(e.ts).getHours())[0];
  const reaction = ys.filter((e) => e.answer === "go" && e.answerTs).map((e) => (e.answerTs - e.ts) / 1000).filter((s) => s > 0 && s < 3600);
  const prev = alive().filter((e) => new Date(e.ts).getFullYear() === year - 1).length;
  return {
    year, count: ys.length, prev,
    goRate: goRate(ys),
    night: ys.filter(isNight).length,
    weekend: ys.filter((e) => [0, 6].includes(new Date(e.ts).getDay())).length,
    topMonth: topMonth && { name: monthName(topMonth[0]), n: topMonth[1] },
    topDay: topDay && { name: WEEKDAYS[topDay[0]], n: topDay[1] },
    topHour: topHour && { name: `${String(topHour[0]).padStart(2, "0")}–${String((Number(topHour[0]) + 1) % 24).padStart(2, "0")} Uhr`, n: topHour[1] },
    reactionSec: reaction.length ? Math.round(reaction.toSorted((a, b) => a - b)[Math.floor(reaction.length / 2)]) : null,
    categories: countBy(ys, category),
    keywords: countBy(ys, (e) => e.keyword).slice(0, 5),
  };
}

// ── Export ─────────────────────────────────────────────────────────────────

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/u.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const ANSWER_TEXT = { go: "Ich fahre", stay: "Ich fahre nicht", timeout: "keine Antwort" };

/** CSV (Semikolon, für Excel auf Deutsch), optional nur ein Jahr. */
export function toCsv(year) {
  const rows = alive().filter((e) => !year || new Date(e.ts).getFullYear() === year);
  const head = ["Datum", "Uhrzeit", "Stichwort", "Art", "Einheiten", "Adresse", "Text", "Quellen", "Antwort", "Reaktion (s)", "Rückalarm", "Ende", "Fahrzeug", "Funktion", "Notiz", "Divera-ID", "Weitere Angaben"];
  const lines = rows.map((e) => {
    const t = new Date(e.ts);
    return [
      t.toLocaleDateString("de-DE"), t.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
      e.keyword, category(e), unitsOf(e).join(", "), e.address, e.text, (e.sources || [e.source]).join(", "),
      ANSWER_TEXT[e.answer] || "", e.answerTs ? Math.round((e.answerTs - e.ts) / 1000) : "",
      e.recall ? new Date(e.recall).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "",
      e.endTs ? new Date(e.endTs).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "",
      e.vehicle, e.role, e.note, e.diveraId,
      e.details ? Object.entries(e.details).map(([k, v]) => `${k}: ${v}`).join(" | ") : "",
    ].map(csvCell).join(";");
  });
  return "﻿" + [head.join(";"), ...lines].join("\r\n");
}

export { ANSWER_TEXT };
