// Divera-Daten fürs Dashboard aus /api/v2/pull/all (dazu optional /api/v2/alarms, /pull/vehicle-status, /shift-plans).
// Feldnamen nach der v2-Doku (api.divera247.com), abgeglichen mit dem Python-Client „divera247“, DiveraControl
// (Home Assistant) und kp-front. Jedes Feld wird vorsichtig gelesen: fehlt etwas (z. B. weil der Schlüssel es nicht
// sehen darf), bleibt die Kachel leer und zeigt einen Hinweis, statt Fehler zu werfen.
//
//   cluster.status            { id: { name, color_hex } } + statussorting_statusgeber / statussorting_alarm
//   cluster.consumer          { ucr_id: { firstname, lastname, stdformat_name, qualifications } }
//   cluster.qualification     { id: { name, shortname } } + qualificationsorting
//   cluster.vehicle           { id: { name, shortname, fmsstatus_id } }
//   cluster.address           { street, zip, city, lat, lng }                   – Standort der Einheit
//   monitor["1"][status_id]   { all, qualification: { qid: n } }              – Verfügbarkeit je Status
//   monitor["3"][ucr_id]      { status, ts, note, vehicle }                    – aktueller Status je Person
//   status                    { status_id, status_set_date, status_reset_date, status_reset_id, note, status_changes }
//   statusplan.items          { id: { title, begin_ts, end_ts, during_status_id, after_status_id } }
//   alarm / events / news     { items: { id: {…} }, sorting: [id] }
//   alarm.items[id]           title, address, lat/lng, scene_object, caller, patient, remark, units, destination_*,
//                             ucr_answered { status_id: { ucr_id: { ts, note } } }, count_recipients, count_read …
//   message.items             { id: { message_channel_id, author_id, text, ts_create } } + message_channel.items

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const byTs = (a, b) => a.ts - b.ts;
const color = (c) => (c ? `#${String(c).replace("#", "")}` : "");
const str = (v) => (v == null ? "" : String(v).trim());
/** Divera liefert UNIX-Sekunden (manchmal als Text). → Millisekunden, 0 = unbekannt. */
const ms = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n * 1000 : 0; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const geo = (lat, lng) => (num(lat) && num(lng) ? { lat: Number(lat), lng: Number(lng) } : null);
/** Text aus Divera kann HTML enthalten (Mitteilungen, Chat). */
const plain = (v) => str(v).replace(/<br\s*\/?>/giu, "\n").replace(/<\/(p|div|li|h\d)>/giu, "\n").replace(/<[^>]+>/gu, " ")
  .replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"')
  .replace(/[ \t]+/gu, " ").replace(/ *\n */gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
/** Liste von IDs (Array oder Objekt mit IDs als Schlüssel). */
const ids = (v) => (Array.isArray(v) ? v.map((x) => String(typeof x === "object" && x ? x.id ?? x.ucr_id ?? x.ucr ?? "" : x)) : Object.keys(obj(v))).filter(Boolean);

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
      const e = { name: personName(consumers, ucr) || "Mitglied", ts: Number(obj(info).ts) * 1000 || 0, status: statusNames[statusId] || "", note: str(obj(info).note) };
      (decline ? declined : coming).push(e);
    }
  }
  const addressed = Array.isArray(alarm?.ucr_addressed) ? alarm.ucr_addressed.length : Object.keys(obj(alarm?.ucr_addressed)).length;
  return { coming: coming.toSorted(byTs), declined: declined.toSorted(byTs), open: Math.max(0, addressed - seen.size), total: addressed };
}

/** Alle Angaben eines Divera-Alarms, die sich anzeigen lassen. */
function alarmDetails(a, ctx) {
  const { statusNames, consumers, vehicleNames } = ctx;
  const answered = obj(a.ucr_answered);
  const answerCount = Object.values(answered).reduce((n, p) => n + Object.keys(obj(p)).length, 0);
  const vehicles = arr(a.vehicle).map((id) => vehicleNames[id]).filter(Boolean);
  return {
    id: a.id, title: str(a.title), text: plain(a.text), address: str(a.address),
    ts: ms(a.date || a.ts_create), closed: Boolean(a.closed), priority: Boolean(a.priority),
    number: str(a.foreign_id), object: str(a.scene_object), caller: str(a.caller), patient: str(a.patient),
    remark: str(a.remark), units: str(a.units), vehicles,
    extra: [a.additional_text_1, a.additional_text_2, a.additional_text_3].map(str).filter(Boolean),
    report: plain(a.report),
    place: geo(a.lat, a.lng),
    destination: a.destination || a.destination_address ? { address: str(a.destination_address), place: geo(a.destination_lat, a.destination_lng) } : null,
    recipients: num(a.count_recipients) ?? (arr(a.ucr_addressed).length || null),
    read: num(a.count_read) ?? (arr(a.ucr_read).length || null),
    answerCount, responseUntil: ms(a.ts_response), attachments: num(a.attachment_count) || 0,
    myAnswer: a.ucr_self_status_id ? statusNames[a.ucr_self_status_id] || "" : "",
    answers: answersOf(a, statusNames, consumers),
  };
}

/** Wer ist gerade in welchem Status: aus monitor["3"] (je Person), sonst monitor["2"] (je Status). */
function peopleByStatus(mon, consumers, order) {
  const byUser = obj(mon["3"]);
  const out = Object.fromEntries(order.map((id) => [id, []]));
  const add = (sid, ucr, e) => {
    const name = personName(consumers, ucr);
    if (!name || !out[sid]) return;
    out[sid].push({ id: String(ucr), name, ts: ms(e.ts), note: str(e.note), quals: arr(obj(consumers[ucr]).qualifications).map(String) });
  };
  if (Object.keys(byUser).length) {
    for (const [ucr, e] of Object.entries(byUser)) add(String(obj(e).status ?? obj(e).status_id), ucr, obj(e));
  } else {
    for (const [sid, block] of Object.entries(obj(mon["2"]))) for (const e of arr(obj(block).all)) add(sid, obj(e).id ?? obj(e).ucr, obj(e));
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return out;
}

/** Eigener Status mit Zeitpunkt, Rücksetzen und anstehenden Änderungen (Statusplan). */
function myStatusOf(d, statusNames, statusRaw, vehicleNames, now) {
  const st = obj(d.status);
  if (st.status_id == null) return null;
  const id = String(st.status_id);
  const resetAt = ms(st.status_reset_date);
  const upcoming = [];
  for (const c of arr(st.status_changes)) {
    const ts = ms(c.ts);
    if (ts > now) upcoming.push({ ts, end: 0, title: "", status: statusNames[c.status] || "", note: str(c.note) });
  }
  for (const p of ordered(d.statusplan)) {
    const begin = ms(p.begin_ts), end = ms(p.end_ts);
    if (!begin || (end || begin) < now) continue;
    upcoming.push({ ts: begin, end, title: str(p.title), status: statusNames[p.during_status_id] || "", after: statusNames[p.after_status_id] || "", fullday: Boolean(p.fullday), repeat: Boolean(p.repeat) });
  }
  return {
    id, name: statusNames[id] || `Status ${id}`, color: color(obj(statusRaw[id]).color_hex),
    since: ms(st.status_set_date || st.ts), note: str(st.note), vehicle: vehicleNames[st.vehicle] || "",
    resetAt: resetAt > now ? resetAt : 0, resetTo: statusNames[st.status_reset_id] || "",
    upcoming: upcoming.toSorted(byTs).slice(0, 8),
  };
}

/** Letzte Chat-Nachrichten aus allen Kanälen, neueste zuerst. */
function messagesOf(d, consumers, mine) {
  const channels = obj(obj(d.message_channel).items);
  return Object.values(obj(obj(d.message).items))
    .filter((m) => !m.deleted && !m.hidden && str(m.text))
    .map((m) => ({
      id: m.id, text: plain(m.text), ts: ms(m.ts_create), author: personName(consumers, m.author_id) || "",
      channelId: String(m.message_channel_id ?? ""), channel: str(obj(channels[m.message_channel_id]).title),
      attachments: num(m.attachment_count) || 0, own: mine.has(String(m.author_id)),
    }))
    .toSorted((a, b) => b.ts - a.ts)
    .slice(0, 80);
}

/** Chat-Kanäle mit Titel und Zahl der Nachrichten (fürs Lesefenster). */
function channelsOf(d, messages) {
  const raw = obj(obj(d.message_channel).items);
  const out = Object.values(raw).filter((c) => !c.deleted && !c.archived).map((c) => ({
    id: String(c.id), title: str(c.title) || "Kanal", count: messages.filter((m) => m.channelId === String(c.id)).length,
    last: messages.find((m) => m.channelId === String(c.id))?.ts || 0,
  }));
  return out.toSorted((a, b) => b.last - a.last);
}

/** Umfragen einer Mitteilung mit Antworten, Anzahl und eigener Wahl. */
function surveysOf(n, mine) {
  return arr(n.surveys).map((sv) => {
    const raw = obj(sv);
    const list = arr(raw.answers);
    const order = arr(raw.answerSorting).map(String);
    const answers = list.map((a) => ({
      id: String(a.id), title: str(a.title) || "Antwort", count: num(a.answeredcount),
      mine: ids(a.answeredlist).some((u) => mine.has(u)),
    })).toSorted((a, b) => (order.length ? order.indexOf(a.id) - order.indexOf(b.id) : 0));
    const notes = list.flatMap((a) => arr(a.custom_answers)).map((c) => ({ ucr: String(obj(c).id ?? ""), note: str(obj(c).note), ts: ms(obj(c).ts) })).filter((c) => c.note);
    return {
      id: String(raw.id ?? ""), title: str(raw.title) || "Umfrage", multiple: Boolean(raw.multiple_answers), custom: Boolean(raw.custom_answers),
      until: raw.response_until ? ms(raw.ts_response) : 0, showCount: raw.access_count !== false, answers,
      myNote: notes.find((c) => mine.has(c.ucr))?.note || "",
    };
  });
}

/** Alles, was die Dashboard-Kacheln aus Divera brauchen. `extra` = optionale Antworten weiterer Endpunkte. */
export function parseBoard(pull, alarms = null, extra = {}) {
  const d = obj(pull);
  const c = obj(d.cluster);
  const statusRaw = obj(c.status);
  const statusNames = Object.fromEntries(Object.entries(statusRaw).map(([id, s]) => [id, obj(s).name || obj(s).shortname || `Status ${id}`]));
  const consumers = obj(c.consumer);
  const now = Date.now();
  // Eigene Mitgliedschaft(en) in der Einheit: Schlüssel von d.ucr (UserClusterRelation)
  const mine = new Set(Object.keys(obj(d.ucr)));

  // Verfügbarkeit: je Status die Anzahl (monitor["1"] = anonym, für die ganze Einheit)
  const mon = obj(d.monitor);
  const mon1 = obj(mon["1"]);
  const order = (Array.isArray(c.statussorting_statusgeber) && c.statussorting_statusgeber.length ? c.statussorting_statusgeber : Object.keys(statusRaw)).map(String);
  const statuses = order.filter((id) => statusRaw[id]).map((id) => ({ id, name: statusNames[id], color: color(statusRaw[id].color_hex) }));
  const availability = statuses.map((s) => ({ ...s, count: Number(obj(mon1[s.id]).all) || 0 }));

  // Qualifikationen: Namen und Anzahl je Status (monitor["1"][status].qualification)
  const qRaw = obj(c.qualification);
  const qOrder = (Array.isArray(c.qualificationsorting) && c.qualificationsorting.length ? c.qualificationsorting : Object.keys(qRaw)).map(String);
  const qualifications = qOrder.filter((id) => qRaw[id]).map((id) => ({ id, name: str(qRaw[id].name) || `Qualifikation ${id}`, short: str(qRaw[id].shortname) }));
  const qualByStatus = Object.fromEntries(statuses.map((s) => [s.id, Object.fromEntries(Object.entries(obj(obj(mon1[s.id]).qualification)).map(([q, n]) => [String(q), Number(n) || 0]))]));

  // Fahrzeuge: aus pull/all, genauer (Zeitpunkt, Notiz, Position) aus /pull/vehicle-status
  const fmsText = obj(obj(c.fms_status).items);
  const vStatus = Object.fromEntries(arr(extra.vehicles).map((v) => [String(v.id), v]));
  const crewOf = (v) => ids(obj(vStatus[String(v.id)]).crew ?? v.crew).map((u) => personName(consumers, u)).filter(Boolean);
  const vehicles = Object.values(obj(c.vehicle)).map((v) => {
    const live = obj(vStatus[String(v.id)]);
    const fms = live.fmsstatus ?? v.fmsstatus ?? v.fmsstatus_id;
    return {
      id: String(v.id ?? ""), name: v.shortname || v.name || "Fahrzeug", full: v.name || "",
      fms: fms != null ? String(fms) : "", fmsText: obj(fmsText[v.fmsstatus_id]).name || str(live.fmsstatus_note) || v.fmsstatus_note || "",
      since: ms(live.fmsstatus_ts ?? v.fmsstatus_ts), place: geo(live.lat ?? v.lat, live.lng ?? v.lng),
      note: str(live.fmsstatus_note ?? v.fmsstatus_note), crew: crewOf(v),
    };
  });
  for (const v of arr(extra.vehicles)) {
    if (vehicles.some((x) => x.id === String(v.id))) continue;
    vehicles.push({ id: String(v.id ?? ""), name: v.shortname || v.name || "Fahrzeug", full: v.fullname || v.name || "", fms: v.fmsstatus != null ? String(v.fmsstatus) : "", fmsText: str(v.fmsstatus_note), since: ms(v.fmsstatus_ts), place: geo(v.lat, v.lng), note: str(v.fmsstatus_note), crew: crewOf(v) });
  }
  const vehicleNames = Object.fromEntries(vehicles.map((v) => [v.id, v.name]));

  const events = ordered(d.events)
    .map((e) => {
      const pc = obj(e.participationcount);
      return {
        id: e.id, title: e.title || "Termin", text: plain(e.text), author: personName(consumers, e.author_id) || "",
        start: ms(e.start), end: ms(e.end), place: e.address || "", fullday: Boolean(e.fullday),
        type: num(e.response_type) ?? 2, note: str(e.note), isNew: Boolean(e.new),
        read: num(e.count_read), recipients: num(e.count_recipients), attachments: num(e.attachment_count) || 0,
        mine: num(e.participation) || 0,   // 1 = Ja, 2 = Unsicher, 3 = Nein, 0 = keine Rückmeldung
        yes: num(pc["1"]) ?? null, maybe: num(pc["2"]) ?? null, no: num(pc["3"]) ?? null,
        answerable: Boolean(e.answerable), until: ms(e.ts_response),
      };
    })
    .filter((e) => e.start && (e.end || e.start) >= now)
    .toSorted((a, b) => a.start - b.start);

  const news = ordered(d.news)
    .filter((n) => !n.deleted && !n.hidden)
    .map((n) => ({
      id: n.id, title: n.title || "Mitteilung", text: plain(n.text), ts: ms(n.date || n.ts_create),
      author: personName(consumers, n.author_id) || "", place: str(n.address),
      survey: Boolean(n.survey) || arr(n.surveys).length > 0, surveys: surveysOf(n, mine), isNew: Boolean(n.new),
      read: num(n.count_read), recipients: num(n.count_recipients), attachments: num(n.attachment_count) || 0,
    }))
    .toSorted((a, b) => b.ts - a.ts);

  // Alarme: offene aus /alarms (falls erlaubt), sonst aus pull/all. Verlauf mit beendeten aus pull/all.
  const ctx = { statusNames, consumers, vehicleNames };
  const all = ordered(alarms && typeof alarms === "object" ? alarms : d.alarm);
  const pullAlarms = ordered(d.alarm);
  const history = [...new Map([...pullAlarms, ...all].filter((a) => a && !a.deleted && !a.hidden).map((a) => [String(a.id), a])).values()]
    .map((a) => alarmDetails(a, ctx))
    .toSorted((a, b) => b.ts - a.ts);
  const open = history.filter((a) => !a.closed);
  const alarm = open[0] || null;

  const addr = obj(c.address);
  const place = geo(addr.lat, addr.lng ?? addr.long);
  const unit = {
    name: c.name || c.shortname || "", short: c.shortname || "",
    address: [str(addr.street), [str(addr.zip), str(addr.city)].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    place, members: Object.keys(consumers).length, vehicles: vehicles.length, qualifications: qualifications.length,
    newAlarms: Object.values(obj(d.ucr)).reduce((n, u) => n + (Number(obj(u).new_alarms) || 0), 0),
    newMessages: Object.values(obj(d.ucr)).reduce((n, u) => n + (Number(obj(u).new_messages) || 0), 0),
  };

  const messages = messagesOf(d, consumers, mine);

  const shifts = arr(extra.shifts)
    .map((s) => ({ id: s.id, name: str(s.name) || "Dienstplan", start: ms(s.ts_start), end: ms(s.ts_end) }))
    .filter((s) => !s.end || s.end >= now)
    .toSorted((a, b) => (a.start || 0) - (b.start || 0));

  return {
    unit: unit.name,
    unitInfo: unit,
    myStatus: d.status?.status_id != null ? String(d.status.status_id) : null,
    me: myStatusOf(d, statusNames, statusRaw, vehicleNames, now),
    statuses, availability, qualifications, qualByStatus,
    people: peopleByStatus(mon, consumers, statuses.map((s) => s.id)),
    vehicles, events, news, alarm, alarms: history.slice(0, 12),
    messages,
    channels: channelsOf(d, messages),
    shifts, shiftsLoaded: Array.isArray(extra.shifts), vehiclesLive: Array.isArray(extra.vehicles),
    at: now,
  };
}
