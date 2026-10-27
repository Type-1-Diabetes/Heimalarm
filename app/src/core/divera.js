// Divera 24/7 – alles mit dem persönlichen Accesskey (API-Doku: api.divera247.com).
//   GET  /api/v2/pull/all                     Einheit, Status-Listen, eigener Status
//   GET  /api/v2/alarms                       offene Alarme { items, sorting } – nur Rückfall: manche Schlüssel
//                                             (API-Schlüssel statt persönlichem Accesskey) dürfen das nicht,
//                                             pull/all liefert dieselben Alarme unter data.alarm.
//   POST /api/v2/statusgeber/set-status       eigenen Status setzen { Status: { id, note, reset_date, reset_to } }
//   POST /api/v2/alarms/confirm/{id}          Rückmeldung zu einem Einsatz { Status: { id, note } }
// In der App läuft der Abruf über das Tauri-HTTP-Plugin (kein CORS-Problem).
import { pickDetails } from "./stats.js";
import { settings, set } from "./settings.js";
import { log } from "./log.js";
import { emit } from "./events.js";
import { isTauri } from "./platform.js";
import { parseBoard } from "./divera-board.js";

const BASE = "https://app.divera247.com";
const SEEN_KEY = "heimalarm.divera.seen";
let timer = null;
let seen = new Set();
try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { /* leer */ }
let primed = seen.size > 0;

/** Laufzeit-Zustand für die Oberfläche. */
export const divera = { ok: null, error: "", lastPoll: 0, current: null, board: null };

async function http(url, opts = {}) {
  const f = isTauri ? (await import("@tauri-apps/plugin-http")).fetch : fetch;
  return f(url, { ...opts, headers: { Accept: "application/json", ...(opts.body ? { "Content-Type": "application/json" } : {}) } });
}

/** Fehler mit Endpunkt, HTTP-Code, Meldung von Divera und Hinweis – fürs Protokoll. */
class DiveraError extends Error {
  constructor(text, { path, status, server, hint } = {}) {
    super(text);
    this.detail = [`${path}${status ? ` → HTTP ${status}` : ""}`, server && `Divera: „${server}“`, hint].filter(Boolean).join(" · ");
  }
}

async function api(path, body) {
  const key = settings().divera.key;
  if (!key) throw new DiveraError("Kein Divera-Schlüssel eingetragen", { path, hint: "Unter Einstellungen → Alarmquellen → Divera eintragen." });
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}accesskey=${encodeURIComponent(key)}`;
  let r;
  try { r = await http(url, body ? { method: "POST", body: JSON.stringify(body) } : { method: "GET" }); }
  catch (e) { throw new DiveraError("Divera nicht erreichbar", { path, server: String(e?.message || e), hint: "Internet am Gerät prüfen." }); }
  const j = await r.json().catch(() => ({}));
  const server = j?.message || (Array.isArray(j?.errors) ? j.errors.join(", ") : typeof j?.errors === "object" && j?.errors ? Object.values(j.errors).flat().join(", ") : "");
  if (r.status === 401) throw new DiveraError("Divera-Schlüssel ungültig", { path, status: 401, server, hint: "Schlüssel neu kopieren, ohne Leerzeichen. Nach einem Passwortwechsel ändert Divera den persönlichen Accesskey." });
  if (r.status === 403) throw new DiveraError("Keine Berechtigung", { path, status: 403, server, hint: "Der Schlüssel ist gültig, darf diese Abfrage aber nicht. Bei einem eigenen API-Schlüssel in Divera die Rechte prüfen oder den persönlichen Accesskey nehmen." });
  if (r.status === 404) throw new DiveraError("Nicht gefunden oder keine Berechtigung", { path, status: 404, server });
  if (r.status === 429) throw new DiveraError("Zu viele Abfragen", { path, status: 429, server, hint: "Abfrage-Abstand unter Divera vergrößern." });
  if (!r.ok) throw new DiveraError(`Divera-Fehler ${r.status}`, { path, status: r.status, server });
  if (j.success === false) throw new DiveraError(server || "Divera meldet einen Fehler", { path, status: r.status, server });
  return j.data ?? j;
}

const saveSeen = () => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200))); } catch { /* egal */ } };

/** Status-Liste in der gewünschten Reihenfolge (z. B. statussorting_statusgeber). */
function statusList(cluster, sortKey) {
  const raw = cluster.status || {};
  const order = cluster[sortKey]?.length ? cluster[sortKey] : cluster.statussorting || Object.keys(raw);
  return order.map((id) => raw[id]).filter(Boolean).map((s) => ({
    id: String(s.id), name: s.name || s.shortname || `Status ${s.id}`,
    color: s.color_hex ? `#${String(s.color_hex).replace("#", "")}` : "",
  }));
}

/** Verbindung prüfen und Einheit, Status-Listen und eigenen Status laden. */
export async function loadDivera() {
  const d = await api("/api/v2/pull/all");
  const c = d.cluster || {};
  set("divera.unit", c.name || c.shortname || "");
  set("divera.statuses", statusList(c, "statussorting_statusgeber"));
  set("divera.answers", statusList(c, "statussorting_alarm"));
  divera.current = d.status?.status_id != null ? String(d.status.status_id) : null;
  divera.ok = true; divera.error = "";
  emit("divera", divera);
  return { unit: c.name || "", statuses: settings().divera.statuses, answers: settings().divera.answers };
}

/** Neue Alarme seit der letzten Abfrage. Beim ersten Abruf wird nur gemerkt, nichts ausgelöst. */
let alarmsEndpoint = "pull";   // "pull" = /api/v2/pull/all, sonst /api/v2/alarms

/** Offene Alarme { items, sorting }: aus pull/all (geht mit jedem gültigen Schlüssel), sonst /alarms. */
async function fetchAlarms() {
  if (alarmsEndpoint === "pull") {
    const d = await api("/api/v2/pull/all");
    if (d.status?.status_id != null) divera.current = String(d.status.status_id);
    if (d.alarm && typeof d.alarm === "object") return d.alarm;
    alarmsEndpoint = "alarms";
    log("info", "Divera: Alarme werden jetzt über einen anderen Weg abgefragt");
  }
  return api("/api/v2/alarms");
}

export async function pollDivera() {
  try {
    const d = await fetchAlarms();
    const items = d.items || {};
    const ids = (d.sorting || Object.keys(items)).map(String);
    const fresh = [];
    for (const id of ids) {
      const a = items[id];
      if (!a || seen.has(id)) continue;
      seen.add(id);
      const ts = (a.date || a.ts_create || 0) * 1000;
      if (primed && !a.closed && !a.deleted && Date.now() - ts < 15 * 60_000) fresh.push(a);
    }
    primed = true;
    saveSeen();
    if (divera.ok === false) log("ok", "Divera-Abfrage klappt wieder");
    divera.ok = true; divera.error = ""; divera.lastPoll = Date.now();
    for (const a of fresh) {
      emit("divera-alarm", {
        source: "Divera", keyword: String(a.title || "Alarm").slice(0, 80),
        text: String(a.text || "").slice(0, 1000), address: a.address || "", diveraId: a.id,
        details: pickDetails(a, ["title", "text", "address", "id", "ts_create", "ts_update", "date"]),   // alle weiteren einfachen Felder für das Einsatz-Logbuch
      });
    }
  } catch (e) {
    if (divera.error !== e.message) log("warn", `Divera-Abfrage fehlgeschlagen: ${e.message}`, e.detail || "");
    divera.ok = false; divera.error = e.message;
  }
  emit("divera", divera);
}

const nameOf = (list, id) => list.find((s) => s.id === String(id))?.name || `Status ${id}`;

/** Eigenen Status setzen, optional mit Rücksetzen nach X Minuten. */
export async function setDiveraStatus(id) {
  const d = settings().divera;
  if (!id || !d.key) return false;
  const Status = { id: Number(id) };
  if (d.note) Status.note = d.note;
  if (d.resetMin > 0 && d.resetTo) { Status.reset_date = Math.floor(Date.now() / 1000) + d.resetMin * 60; Status.reset_to = Number(d.resetTo); }
  try {
    await api("/api/v2/statusgeber/set-status", { Status });
    divera.current = String(id);
    log("action", `Divera-Status: ${nameOf(d.statuses, id)}`);
    emit("divera", divera);
    return true;
  } catch (e) { log("warn", `Divera-Status nicht gesetzt: ${e.message}`, e.detail || ""); return false; }
}

/** Routinen-Aktion ohne Zentrale: Status mit eigenem Schlüssel setzen { statusId, statusName, note, resetMin, resetTo }. */
export async function setDiveraStatusRaw(a) {
  const Status = { id: Number(a.statusId) };
  if (a.note) Status.note = a.note;
  if (Number(a.resetMin) > 0 && a.resetTo) { Status.reset_date = Math.floor(Date.now() / 1000) + Number(a.resetMin) * 60; Status.reset_to = Number(a.resetTo); }
  try {
    await api("/api/v2/statusgeber/set-status", { Status });
    divera.current = String(a.statusId);
    log("action", `Divera-Status: ${a.statusName || a.statusId}`, "Routine");
    emit("divera", divera);
  } catch (e) { log("warn", `Divera-Status nicht gesetzt: ${e.message}`, e.detail || ""); }
}

/** Rückmeldung zu einem Divera-Einsatz. */
export async function confirmDiveraAlarm(alarmId, statusId) {
  const d = settings().divera;
  if (!alarmId || !statusId || !d.key) return false;
  try {
    await api(`/api/v2/alarms/confirm/${encodeURIComponent(alarmId)}`, { Status: { id: Number(statusId), ...(d.note ? { note: d.note } : {}) } });
    log("action", `Divera-Rückmeldung: ${nameOf(d.answers, statusId)}`);
    return true;
  } catch (e) { log("warn", `Divera-Rückmeldung fehlgeschlagen: ${e.message}`, e.detail || ""); return false; }
}

/** Antwort auf „Fährst du?“ an Divera: Rückmeldung zum Einsatz (falls von Divera) und/oder Status. */
export async function answerDivera(going, alarm) {
  const d = settings().divera;
  if (!d.key) return false;
  const answer = d.answer ? (going ? d.answerGo : d.answerStay) : "";      // nur wenn eingeschaltet
  const status = d.setStatus ? (going ? d.statusGo : d.statusStay) : "";
  let ok = false;
  if (alarm?.diveraId && answer) ok = await confirmDiveraAlarm(alarm.diveraId, answer);
  if (status) ok = (await setDiveraStatus(status)) || ok;
  return ok;
}

/** Abfrage starten/stoppen je nach Einstellungen. */
export function restartDivera() {
  clearInterval(timer); timer = null;
  const d = settings().divera;
  const on = settings().alarm.apps?.divera?.on;
  if (!on || !d.poll || !d.key) { divera.ok = d.key ? divera.ok : null; return; }
  pollDivera();
  timer = setInterval(pollDivera, Math.max(10, Number(d.pollSec) || 20) * 1000);
}

// ── Dashboard: Einheit, Fahrzeuge, Termine, Mitteilungen, Rückmeldungen ──
let boardTimer = null;
let boardAlarms = true;   // /alarms für Rückmeldungen versuchen; fällt weg, wenn der Schlüssel es nicht darf

/** Einmal alles fürs Dashboard laden (pull/all, dazu /alarms für die Rückmeldungen). */
export async function refreshBoard() {
  if (!settings().divera.key) { divera.board = null; return; }
  try {
    const pull = await api("/api/v2/pull/all");
    let alarms = null;
    if (boardAlarms) {
      try { alarms = await api("/api/v2/alarms"); }
      catch { boardAlarms = false; }
    }
    divera.board = parseBoard(pull, alarms);
    if (divera.board.myStatus) divera.current = divera.board.myStatus;
    divera.ok = true; divera.error = "";
  } catch (e) {
    if (divera.error !== e.message) log("warn", `Divera fürs Dashboard: ${e.message}`, e.detail || "");
    divera.ok = false; divera.error = e.message;
  }
  emit("divera", divera);
}

/** Abruf fürs Dashboard: alle `sec` Sekunden, 0 = aus. Bei Alarm schneller (Rückmeldungen). */
export function boardPolling(sec) {
  clearInterval(boardTimer); boardTimer = null;
  if (!sec || !settings().divera.key) return;
  refreshBoard();
  boardTimer = setInterval(refreshBoard, Math.max(10, sec) * 1000);
}
