// Divera-Daten fürs Dashboard aus /api/v2/pull/all (und /api/v2/alarms) herauslesen.
// Die offizielle Doku war beim Bau nicht erreichbar. Die Feldnamen stammen aus Integrationen, die die API
// im Einsatz nutzen (DiveraControl für Home Assistant, kp-front). Darum wird jedes Feld vorsichtig gelesen:
// fehlt etwas, bleibt die Kachel leer und zeigt einen Hinweis, statt Fehler zu werfen.
//
//   cluster.status            { id: { name, color_hex } } + statussorting_statusgeber / statussorting_alarm
//   cluster.consumer          { ucr_id: { firstname, lastname, stdformat_name } }   – Namen der Mitglieder
//   cluster.vehicle           { id: { name, shortname, fmsstatus_id } }
//   cluster.fms_status.items  { id: { name } }                                     – Text zum FMS-Status (optional)
//   monitor["1"][status_id]   { all }                                              – Verfügbarkeit je Status
//   alarm / events / news     { items: { id: {…} }, sorting: [id] }
//   alarm.items[id].ucr_answered  { status_id: { ucr_id: { ts, note } } }

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const byTs = (a, b) => a.ts - b.ts;
const color = (c) => (c ? `#${String(c).replace("#", "")}` : "");

/** Liste in Divera-Reihenfolge: items + sorting. */
function ordered(block) {
  const items = obj(block?.items);
  const order = Array.isArray(block?.sorting) && block.sorting.length ? block.sorting : Object.keys(items);
  return order.map((id) => items[id]).filter(Boolean);
}

/** Name eines Mitglieds aus cluster.consumer, sonst null (dann zählt es nur mit). */
function personName(consumers, ucr) {
  const p = obj(consumers[ucr]);
  return p.stdformat_name || [p.firstname, p.lastname].filter(Boolean).join(" ") || null;
}

/** „Komme nicht“ enthält „komme“ – darum zuerst auf Absage prüfen. */
export const isDecline = (name) => /nicht|kein|abwesend|verhindert|absage/iu.test(String(name || ""));

/** Rückmeldungen zu einem Alarm: { coming: [{ name, ts }], declined: [...], open, total }. */
export function answersOf(alarm, statusNames, consumers) {
  const answered = obj(alarm?.ucr_answered);
  const coming = [], declined = [];
  const seen = new Set();
  for (const [statusId, people] of Object.entries(answered)) {
    const decline = isDecline(statusNames[statusId]);
    for (const [ucr, info] of Object.entries(obj(people))) {
      seen.add(ucr);
      const e = { name: personName(consumers, ucr) || "Mitglied", ts: Number(obj(info).ts) * 1000 || 0, status: statusNames[statusId] || "" };
      (decline ? declined : coming).push(e);
    }
  }
  const addressed = Array.isArray(alarm?.ucr_addressed) ? alarm.ucr_addressed.length : Object.keys(obj(alarm?.ucr_addressed)).length;
  return { coming: coming.toSorted(byTs), declined: declined.toSorted(byTs), open: Math.max(0, addressed - seen.size), total: addressed };
}

/** Alles, was die Dashboard-Kacheln aus Divera brauchen. `alarms` = optionale Antwort von /api/v2/alarms. */
export function parseBoard(pull, alarms = null) {
  const d = obj(pull);
  const c = obj(d.cluster);
  const statusRaw = obj(c.status);
  const statusNames = Object.fromEntries(Object.entries(statusRaw).map(([id, s]) => [id, obj(s).name || obj(s).shortname || `Status ${id}`]));
  const consumers = obj(c.consumer);

  // Verfügbarkeit: je Status die Anzahl (monitor["1"] = ganze Einheit)
  const mon = obj(obj(d.monitor)["1"]);
  const order = (Array.isArray(c.statussorting_statusgeber) && c.statussorting_statusgeber.length ? c.statussorting_statusgeber : Object.keys(statusRaw)).map(String);
  const availability = order.filter((id) => statusRaw[id]).map((id) => ({
    id, name: statusNames[id], color: color(statusRaw[id].color_hex), count: Number(obj(mon[id]).all) || 0,
  }));

  const fmsText = obj(obj(c.fms_status).items);
  const vehicles = Object.values(obj(c.vehicle)).map((v) => ({
    id: String(v.id ?? ""), name: v.shortname || v.name || "Fahrzeug", full: v.name || "",
    fms: v.fmsstatus_id != null ? String(v.fmsstatus_id) : "", fmsText: obj(fmsText[v.fmsstatus_id]).name || v.fmsstatus_note || "",
  }));

  const now = Date.now();
  const events = ordered(d.events)
    .map((e) => ({ title: e.title || "Termin", start: Number(e.start) * 1000 || 0, end: Number(e.end) * 1000 || 0, place: e.address || "", fullday: Boolean(e.fullday) }))
    .filter((e) => e.start && (e.end || e.start) >= now)
    .toSorted((a, b) => a.start - b.start);

  const news = ordered(d.news)
    .map((n) => ({ title: n.title || "Mitteilung", text: n.text || "", ts: Number(n.date || n.ts_create) * 1000 || 0 }))
    .toSorted((a, b) => b.ts - a.ts);

  // Offene Alarme: aus /alarms, sonst aus pull/all
  const alarmList = ordered(alarms && typeof alarms === "object" ? alarms : d.alarm).filter((a) => !a.closed && !a.deleted);
  const latest = alarmList.toSorted((a, b) => (b.date || b.ts_create || 0) - (a.date || a.ts_create || 0))[0] || null;
  const alarm = latest ? {
    id: latest.id, title: latest.title || "", text: latest.text || "", address: latest.address || "",
    ts: Number(latest.date || latest.ts_create) * 1000 || 0, answers: answersOf(latest, statusNames, consumers),
  } : null;

  return {
    unit: c.name || c.shortname || "",
    myStatus: d.status?.status_id != null ? String(d.status.status_id) : null,
    statuses: order.filter((id) => statusRaw[id]).map((id) => ({ id, name: statusNames[id], color: color(statusRaw[id].color_hex) })),
    availability, vehicles, events, news, alarm,
    at: now,
  };
}
