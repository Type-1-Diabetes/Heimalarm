// Daten für die Dashboard-Kacheln: sammelt alles in einem „Schnappschuss“, den Editor und TV-Fenster zeichnen.
// Läuft nur im Hauptfenster. Das TV-Fenster bekommt den Schnappschuss per Event (core/tvlink.js)
// und schickt Aktionen (Divera-Status, Bereitschaft, Einsatz beenden …) hierher zurück.
import { on, emit } from "./events.js";
import { settings } from "./settings.js";
import { shared } from "./shared.js";
import { state, publish, setDevice } from "./mqtt.js";
import { fireLocal } from "./routines-local.js";
import { answerApps } from "./engine.js";
import { readiness, setReadiness, MODES, untilText } from "./readiness.js";
import { divera, setDiveraStatus, confirmDiveraAlarm, boardPolling, refreshBoard } from "./divera.js";
import { statsEntries, summary, ANSWER_TEXT } from "./stats.js";
import { getLog } from "./log.js";
import { has } from "./features.js";
import { checkup, failedNow } from "./checkup.js";
import { direct } from "./direct.js";
import { isTauri } from "./platform.js";
import { dashboards } from "./dashboard.js";

// ── Laufender Einsatz fürs Dashboard ─────────────────────────────────────────
// Aktiv ab einem Alarm (eigener oder einer Person im Haushalt) bis „Einsatz beenden“ oder Zeitablauf.
const board = { alarm: null, answers: {} };   // answers: who -> { going, at, from }

const persons = () => (shared().persons || []).map((p) => ({ id: p.id, name: p.name || p.id }));
const inHousehold = (who) => who === settings().alarm.me || persons().some((p) => p.id === who);

on("alarm", (a) => {
  if (!inHousehold(a.who)) return;
  // Neuer Einsatz (nicht dieselbe Alarmierung einer weiteren Person): Antworten zurücksetzen
  if (!board.alarm || Date.now() - board.alarm.ts > 5 * 60e3) board.answers = {};
  board.alarm = { ...a, ts: a.ts || Date.now(), whos: [...new Set([...(board.alarm && Date.now() - board.alarm.ts < 5 * 60e3 ? board.alarm.whos : []), a.who])] };
  if (has.diveraApi()) refreshBoard();
  emit("board");
});
on("alarm-update", (a) => { if (board.alarm && a.who === board.alarm.who) { Object.assign(board.alarm, a); emit("board"); } });
on("answer", ({ going, timeout, alarm }) => {
  if (!alarm?.who || timeout) return;
  board.answers[alarm.who] = { going, at: Date.now(), from: "hier" };
  emit("board");
});
on("peer-event", (ev) => {
  if (ev?.type !== "answer" || !ev.who) return;
  board.answers[ev.who] = { going: ev.going, at: ev.at || Date.now(), from: ev.from };
  emit("board");
});
on("restore", () => { if (board.alarm) { board.alarm = null; board.answers = {}; emit("board"); } });

/** Beispiel-Einsatz, damit man die Alarm-Ansicht ohne echten Alarm sieht (Editor-Vorschau, „Alarm-Ansicht testen“). */
export const SAMPLE_ALARM = {
  keyword: "B3 Wohnungsbrand", unit: "LZ 1", address: "Musterstraße 1, Musterstadt", text: "Beispiel – kein echter Einsatz.",
  sources: ["Beispiel"], test: true, probe: false, who: "", whos: [],
};
let previewUntil = 0;
/** Alarm-Ansicht für `sec` Sekunden auf allen TV-Fenstern zeigen (Testalarm fürs Dashboard, ohne „Fährst du?“). */
export function previewAlarm(sec = 60) {
  previewUntil = Date.now() + sec * 1000;
  board.alarm = { ...SAMPLE_ALARM, ts: Date.now(), who: settings().alarm.me, whos: [settings().alarm.me], preview: true };
  emit("board");
  setTimeout(() => { if (board.alarm?.preview && Date.now() >= previewUntil) { board.alarm = null; emit("board"); } }, sec * 1000 + 50);
}

/** Läuft gerade ein Einsatz (fürs Umschalten auf die Alarm-Ansicht)? */
export function alarmActive(backMin = 60) {
  const a = board.alarm;
  if (!a) return false;
  if (Date.now() - a.ts > Math.max(5, backMin) * 60e3) { board.alarm = null; return false; }
  return true;
}

// ── Wetter (Bright Sky: Daten des DWD, ohne Schlüssel) ───────────────────────
const weather = { now: null, alerts: [], at: 0, error: "" };
async function http(url) {
  const f = isTauri ? (await import("@tauri-apps/plugin-http")).fetch : fetch;
  const r = await f(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function refreshWeather() {
  const { lat, lon } = shared().location || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  try {
    const [cur, al] = await Promise.all([
      http(`https://api.brightsky.dev/current_weather?lat=${lat}&lon=${lon}`),
      http(`https://api.brightsky.dev/alerts?lat=${lat}&lon=${lon}`).catch(() => ({ alerts: [] })),
    ]);
    const w = cur.weather || {};
    weather.now = {
      temp: w.temperature, condition: w.condition || "", icon: w.icon || "",
      wind: w.wind_speed_10 ?? w.wind_speed_30 ?? null, gust: w.wind_gust_speed_10 ?? null,
    };
    weather.alerts = (al.alerts || []).map((x) => ({ title: x.headline_de || x.event_de || "Warnung", severity: x.severity || "", until: x.expires ? Date.parse(x.expires) : 0 }));
    weather.at = Date.now(); weather.error = "";
  } catch (e) { weather.error = String(e.message || e); }
  emit("board");
}

// ── Systemstatus wie auf „Start“ ─────────────────────────────────────────────
function system() {
  const s = settings(), out = [];
  if (has.pi()) out.push({ name: "Zentrale", ok: state.connected ? "ok" : "bad", text: state.connected ? "verbunden" : "getrennt" });
  if (has.esp()) {
    const ids = [s.alarm.me, ...persons().map((p) => p.id).filter((id) => id !== s.alarm.me)];
    for (const id of ids) {
      const d = state.devices[id];
      if (!d) { if (id === s.alarm.me) out.push({ name: `Melder „${id}“`, ok: "warn", text: "noch nie gemeldet" }); continue; }
      out.push({ name: `Melder „${id}“`, ok: d.online ? "ok" : "warn", text: d.online ? (d.rssi ? `${d.rssi} dBm` : "online") : "offline" });
    }
  }
  if (has.direct() && !has.pi()) out.push({ name: "Empfang vom Handy", ok: direct.error ? "bad" : "ok", text: direct.error ? "gestört" : "bereit" });
  if (has.diveraApi()) out.push({ name: "Divera", ok: divera.ok === false ? "bad" : "ok", text: divera.ok === false ? divera.error || "Fehler" : "verbunden" });
  for (const c of Object.values(state.clients || {})) {
    if (c.name === (s.device.name || "")) continue;
    out.push({ name: c.name || c.platform, ok: c.online ? "ok" : "warn", text: c.online ? "online" : "offline" });
  }
  return { items: out.slice(0, 8), failed: failedNow(), running: checkup.running };
}

function devices() {
  const out = [];
  for (const d of (state.zigbee || []).filter((x) => x.type !== "Coordinator")) {
    const st = state.zstate[d.friendly_name] || {};
    if ("state" in st) out.push({ name: d.friendly_name, on: st.state === "ON" });
  }
  for (const d of state.matter || []) {
    const st = state.mstate[d.id] || {};
    if ("state" in st) out.push({ name: d.name, on: st.state === "ON", offline: !d.online });
  }
  return out.slice(0, 12);
}

/** Alles für die Kacheln. `forView` nur zum Kennzeichnen, die Daten sind für beide Ansichten gleich. */
export function snapshot() {
  const s = settings();
  const r = readiness();
  const a = board.alarm;
  const logbuch = has.logbuch();
  const ppl = persons();
  return {
    theme: s.ui.theme === "light" ? "light" : "dark",
    me: s.alarm.me,
    alarm: a ? {
      keyword: a.keyword || "", unit: a.unit || "", address: a.address || "", text: a.text || "",
      ts: a.ts, sources: a.sources || [a.source].filter(Boolean), test: Boolean(a.test), probe: Boolean(a.probe), who: a.who, whos: a.whos || [a.who], preview: Boolean(a.preview),
    } : null,
    household: (ppl.length ? ppl : [{ id: s.alarm.me, name: s.alarm.me }]).map((p) => {
      const ans = board.answers[p.id];
      const alarmed = Boolean(a && (a.whos || [a.who]).includes(p.id));
      return { id: p.id, name: p.name, alarmed, going: ans ? ans.going : null, at: ans?.at || 0 };
    }),
    readiness: { mode: r.mode, label: MODES[r.mode]?.label || r.mode, until: untilText(r.until), hint: MODES[r.mode]?.hint || "" },
    system: system(),
    divera: has.diveraApi() ? {
      ok: divera.ok, error: divera.error, current: divera.current,
      statuses: s.divera.statuses || [], answers: s.divera.answers || [], board: divera.board,
    } : null,
    logbuch,
    einsaetze: logbuch ? statsEntries().filter((e) => !e.deleted).slice(-8).toReversed().map((e) => ({ keyword: e.keyword || "Einsatz", ts: e.ts, answer: e.answer ? ANSWER_TEXT[e.answer] || e.answer : "" })) : [],
    stats: logbuch && has.stats() ? summary() : null,
    log: getLog().slice(0, 10).map((e) => ({ kind: e.kind, text: e.text, ts: e.ts })),
    devices: has.pi() ? devices() : [],
    routines: (shared().routines || []).filter((x) => x.enabled !== false).slice(0, 10).map((x) => ({ id: x.id, name: x.name || "Routine", manual: x.trigger?.type === "manual" })),
    weather: { ...weather },
    at: Date.now(),
  };
}

/** Aktion aus einer Kachel (Editor-Vorschau oder TV-Fenster). */
export async function act(a) {
  switch (a?.type) {
    case "divera-status": await setDiveraStatus(a.id); refreshBoard(); break;
    case "readiness": if (MODES[a.mode]) setReadiness(a.mode, a.until || null); break;
    case "restore":
      if (board.alarm?.preview) { board.alarm = null; break; }   // Beispiel: nur zurückschalten, nichts an der Zentrale auslösen
      emit("restore"); publish("heimalarm/cmd/restore", {});
      break;
    case "answer": {
      const d = settings().divera, id = board.alarm?.diveraId || divera.board?.alarm?.id;
      const st = a.going ? d.answerGo : d.answerStay;
      if (id && st) await confirmDiveraAlarm(id, st); else await answerApps(a.going);
      if (board.alarm) { board.answers[settings().alarm.me] = { going: a.going, at: Date.now(), from: "Dashboard" }; }
      refreshBoard();
      break;
    }
    case "device": setDevice(a.name, { state: a.on ? "ON" : "OFF", transition: 1 }); break;
    case "routine": {
      const r = (shared().routines || []).find((x) => x.id === a.id);
      if (r) { if (has.pi()) publish("heimalarm/cmd/run", { id: r.id, test: false }); else fireLocal(r, { manual: true }); }
      break;
    }
    default: return;
  }
  emit("board");
}

// ── Abfragen nur, solange ein Dashboard läuft oder bearbeitet wird ─────────────
let users = 0, wxTimer = null;
function needs(type) { return dashboards().some((d) => Object.values(d.views).some((v) => v.some((t) => t.type === type))); }
/** Editor oder TV-Fenster melden sich an/ab. Startet Divera- und Wetterabfrage nach Bedarf. */
export function boardUse(delta) {
  users = Math.max(0, users + delta);
  const diveraTiles = ["diveraStatus", "answers", "availability", "vehicles", "events", "news"].some(needs);
  boardPolling(users && has.diveraApi() && diveraTiles ? 60 : 0);
  clearInterval(wxTimer); wxTimer = null;
  if (users && needs("weather")) { refreshWeather(); wxTimer = setInterval(refreshWeather, 15 * 60e3); }
}
on("alarm", () => { if (users && has.diveraApi()) boardPolling(15); });   // bei Alarm Rückmeldungen schneller holen
on("restore", () => boardUse(0));
