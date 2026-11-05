// Dashboard-Kacheln zeichnen: ein Schnappschuss (core/board.js) → DOM.
// Das Raster ist immer 1920 × 1080 groß und wird aufs Fenster skaliert (Monitor) bzw. verkleinert (Editor).
// Nur DOM, keine App-Logik: läuft im Hauptfenster (Editor-Vorschau) und im TV-Fenster (src/tv.js).
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { TILES, GROUPS, COLS, ROWS } from "../core/dashboard.js";

export const W = 1920, H = 1080, PAD = 24, GAP = 16;
const CELL_W = (W - 2 * PAD - (COLS - 1) * GAP) / COLS;
const CELL_H = (H - 2 * PAD - (ROWS - 1) * GAP) / ROWS;
/** Platz für Zeilen in einer Kachel der Höhe h (Kopfzeile ≈ 62 px). */
/** Breite/Höhe von n Rasterfeldern in px. */
const span = (n, cell) => n * cell + (n - 1) * GAP;
const fitRows = (t, rowH) => Math.max(1, Math.floor((t.h * CELL_H + (t.h - 1) * GAP - 62) / rowH));
/** Wie viele Einträge: was in die Kachel passt, höchstens die eingestellte Anzahl (opts.max, 0 = automatisch). */
const lim = (t, rowH) => Math.min(fitRows(t, rowH), t.opts?.max || Infinity);
/** Schalter aus den Kachel-Einstellungen; fehlt er, gilt der Standard (an). */
const on = (t, key) => t.opts?.[key] !== false;

const pad = (n) => String(n).padStart(2, "0");
const hm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hms = (ts) => `${hm(ts)}:${pad(new Date(ts).getSeconds())}`;
const dayShort = (ts) => new Date(ts).toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
const dateText = (ts) => {
  const d = new Date(ts), today = new Date();
  if (d.toDateString() === today.toDateString()) return `Heute ${hm(ts)}`;
  return `${dayShort(ts)} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
};
const dayDate = (ts) => { const d = new Date(ts); return `${dayShort(ts)} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
/** „Heute 14:02“, „Morgen 06:00“, sonst „Mo 06.11. 18:00“. */
const whenText = (ts, withTime = true) => {
  const d = new Date(ts), t = new Date(), tm = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
  const time = withTime ? ` ${hm(ts)}` : "";
  if (d.toDateString() === t.toDateString()) return `Heute${time}`;
  if (d.toDateString() === tm.toDateString()) return `Morgen${time}`;
  return `${dayDate(ts)}${time}`;
};
const NO_DIVERA = "Divera ist nicht eingerichtet.";
const LOADING = "Wird von Divera geladen …";
/** FMS 3, 4, 7, 8 = im Einsatz, 6 = außer Dienst, 1 = frei über Funk, sonst auf Wache. */
const fmsColor = (f) => (["3", "4", "7", "8"].includes(f) ? "signal" : f === "6" ? "warn" : f === "1" ? "info" : "ok");
const color = (t) => `var(${t.opts?.accent || TILES[t.type]?.color || GROUPS[TILES[t.type]?.group]?.color || "--c-extra"})`;

/** Kopfzeile: Symbol in Bereichsfarbe + Titel, rechts optional ein Zusatz. */
/** Eigene Überschrift (opts.title) geht vor; opts.header === false blendet die Kopfzeile aus. */
const head = (t, title, extra) => t.opts?.header === false ? null
  : h("div.th", {}, h("span.ico", {}, icon(TILES[t.type].icon)), h("span.ell", {}, t.opts?.title || title || TILES[t.type].label), extra && h("span.src", {}, extra));
const empty = (text) => h("p.dash-empty", {}, text);
const dot = (kind) => h("span.dot", { style: `--d:var(--${kind === "ok" ? "ok" : kind === "warn" ? "warn" : kind === "bad" ? "signal" : "surface-3"})` });
const btn = (label, onClick, extra = {}) => h("button.dbtn", { type: "button", onclick: onClick, ...extra }, label);

/** Eigene Rückmeldung zu einem Termin (participation): Text und Farbe. */
const PART = { 0: ["offen", "text-2"], 1: ["zugesagt", "ok"], 2: ["unsicher", "warn"], 3: ["abgesagt", "signal"] };

// ── Karte aus OpenStreetMap-Kacheln (nur Bilder, keine Bibliothek) ─────────────
const TILE = 256;
const OSM = "https://tile.openstreetmap.org";
/** Web-Mercator: Punkt → Pixel bei Zoomstufe z. */
function project(p, z) {
  const n = TILE * 2 ** z, r = (p.lat * Math.PI) / 180;
  return { x: ((p.lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}
/** Ausschnitt so wählen, dass alle Punkte mit Rand hineinpassen (höchstens zMax). */
function osmMap(points, w, hh, zMax, margin) {
  let z = zMax, ps;
  for (; z > 3; z--) {
    ps = points.map((p) => project(p, z));
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    if (Math.max(...xs) - Math.min(...xs) <= w - 2 * margin && Math.max(...ys) - Math.min(...ys) <= hh - 2 * margin) break;
  }
  ps = points.map((p) => ({ ...p, ...project(p, z) }));
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  const ox = Math.round((Math.min(...xs) + Math.max(...xs)) / 2 - w / 2);
  const oy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2 - hh / 2);
  const n = 2 ** z, imgs = [];
  for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + hh) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + w) / TILE); tx++) {
      imgs.push(h("img", { src: `${OSM}/${z}/${((tx % n) + n) % n}/${ty}.png`, alt: "", draggable: "false", loading: "eager", style: `left:${tx * TILE - ox}px;top:${ty * TILE - oy}px` }));
    }
  }
  const pins = ps.toSorted((a, b) => (a.kind === "alarm") - (b.kind === "alarm")).map((p) => h(`div.pin.k-${p.kind}${p.x - ox > w - 170 ? ".l" : ""}`, { style: `left:${Math.round(p.x - ox)}px;top:${Math.round(p.y - oy)}px` },
    h("i"), (w >= 600 || p.kind === "alarm") && h("span", {}, p.kind === "car" && p.fms ? `${p.label} · ${p.fms}` : p.label)));
  return h("div.map", { role: "img", "aria-label": `Karte: ${points.map((p) => p.label).join(", ")}` }, h("div.map-tiles", {}, imgs), pins);
}

// ── Einzelne Kacheln ───────────────────────────────────────────────────────
const R = {
  clock(t) {
    const big = t.h >= 2;
    // Ziffern wachsen mit der Kachel (3 × 2 ≈ 128 px wie im Mockup)
    const fs = big ? Math.round(Math.min(span(t.w, CELL_W) / 3.6, (span(t.h, CELL_H) - 90) * 0.62)) : Math.round(Math.min(span(t.w, CELL_W) / 6, 72));
    return [head(t), h("div.clock" + (big ? "" : ".row"), {},
      h("div.big", { "data-clock": "hm", style: `font-size:${fs}px` }, "--:--", on(t, "seconds") && h("small", { "data-clock": "s", style: `font-size:${Math.round(fs * 0.44)}px` }, "")),
      on(t, "date") && h("div.sub", { "data-clock": "date" }, ""))];
  },

  alarm(t, s, ctx) {
    const a = s.alarm;
    if (!a) return [head(t), h("div.calm", {}, h("span.dot", { style: "--d:var(--ok)" }), h("b", {}, "Kein Einsatz"), h("span.sub", {}, "Bei Alarm erscheinen hier Stichwort, Adresse und Text."))];
    const big = t.w >= 6 && t.h >= 3;
    const tag = a.preview ? "BEISPIEL" : a.probe ? "GENERALPROBE" : a.test ? "TEST" : "ALARM";
    return [
      h("div.lage-top", {},
        h("span.live", {}, h("i"), tag),
        ...a.sources.map((x) => h("span.chip", {}, x)),
        h("div.since", {}, h("span", {}, `seit ${hms(a.ts)}`), h("b", { "data-since": String(a.ts) }, "00:00"))),
      h("h1" + (big ? "" : ".sm"), {}, a.keyword || "Einsatz"),
      a.unit && h("div.kw", {}, a.unit),
      a.address && h("div.addr" + (big ? "" : ".sm"), {}, a.address),
      a.text && t.h >= 3 && on(t, "text") && h("div.txt", {}, a.text),
      !a.address && !a.text && h("div.kw", {}, "Einsatzinfos folgen …"),
      t.h >= 3 && on(t, "buttons") && h("div.act", {},
        s.divera && btn([icon("check"), "Ich komme"], () => ctx.act({ type: "answer", going: true }), { class: "go" }),
        s.divera && btn("Ich komme nicht", () => ctx.act({ type: "answer", going: false })),
        btn("Einsatz beenden", () => ctx.act({ type: "restore" }))),
    ];
  },

  household(t, s) {
    const rows = s.household.slice(0, lim(t, 47));
    return [head(t), h("ul.rows", {}, rows.map((p) => {
      const st = !s.alarm ? ["none", "kein Einsatz"] : !p.alarmed ? ["none", "nicht alarmiert"]
        : p.going === true ? ["ok", `Ich fahre · ${hms(p.at)}`] : p.going === false ? ["bad", "Ich fahre nicht"] : ["warn", "noch keine Antwort"];
      return h("li", {}, dot(st[0]), h("b.ell", {}, p.name), h("span.r", {}, st[1]));
    }))];
  },

  readiness(t, s, ctx) {
    const r = s.readiness, ok = r.mode === "ready";
    return [head(t), h("div.ready", {},
      dot(ok ? "ok" : "warn"),
      h("div.ell", {}, h("b", {}, r.label), h("div.sub", {}, ok ? "Alarme lösen alles aus" : r.until || r.hint)),
      btn(ok ? "Auf nicht verfügbar" : "Auf verfügbar", () => ctx.act({ type: "readiness", mode: ok ? "away" : "ready" })))];
  },

  system(t, s) {
    const items = s.system.items.slice(0, lim(t, 47));
    if (!items.length) return [head(t), empty("Nichts eingerichtet, was geprüft werden kann.")];
    return [head(t), h("ul.rows", {}, items.map((i) => h("li", {}, dot(i.ok), h("span.ell", {}, i.name), h("span.r" + (i.ok === "ok" ? "" : `.${i.ok}`), {}, i.text))))];
  },

  devices(t, s, ctx) {
    if (!s.devices.length) return [head(t), empty("Keine schaltbaren Geräte gefunden.")];
    return [head(t), h("ul.rows", {}, s.devices.slice(0, lim(t, 47)).map((d) => h("li", {},
      dot(d.offline ? "warn" : d.on ? "ok" : "none"), h("span.ell", {}, d.name),
      btn(d.on ? "Aus" : "An", () => ctx.act({ type: "device", name: d.name, on: !d.on }), { class: "small" }))))];
  },

  routines(t, s, ctx) {
    if (!s.routines.length) return [head(t), empty("Noch keine Routine.")];
    return [head(t), h("ul.rows", {}, s.routines.slice(0, lim(t, 47)).map((r) => h("li", {},
      h("span.ell", {}, r.name),
      r.manual ? btn("Start", () => ctx.act({ type: "routine", id: r.id }), { class: "small" }) : h("span.r", {}, "automatisch"))))];
  },

  log(t, s) {
    const kind = { alarm: "bad", warn: "warn", ok: "ok", action: "ok" };
    return [head(t), h("ul.rows.tight", {}, s.log.slice(0, lim(t, 38)).map((e) => h("li", {}, dot(kind[e.kind] || "none"), h("span.ell", {}, e.text), h("span.r.mono", {}, hm(e.ts)))))];
  },

  einsaetze(t, s) {
    if (!s.logbuch) return [head(t), empty("Einsatz-Logbuch ist aus (Einstellungen → Zusatzfunktionen).")];
    if (!s.einsaetze.length) return [head(t), empty("Noch kein Einsatz im Logbuch.")];
    return [head(t), h("ul.rows", {}, s.einsaetze.slice(0, lim(t, 74)).map((e) => h("li", {},
      h("div.ev.ell", {}, h("b.ell", {}, e.keyword), h("span", {}, [dateText(e.ts), e.answer].filter(Boolean).join(" · "))))))];
  },

  stats(t, s) {
    if (!s.stats) return [head(t, "Einsätze"), empty("Statistik ist aus (Einstellungen → Zusatzfunktionen).")];
    const st = s.stats, max = Math.max(1, ...st.months.map((m) => m.count));
    return [head(t, `Einsätze ${new Date().getFullYear()}`),
      h("div.statline", {}, h("span.big", {}, String(st.year)), h("span.sub", {}, st.goRate != null ? `${st.goRate} % gefahren` : `${st.last30} in 30 Tagen`)),
      t.h >= 2 && on(t, "chart") && h("div.spark", {}, st.months.map((m, i) => h("i" + (i === 11 ? ".now" : ""), { style: `height:${Math.round((m.count / max) * 100)}%`, title: `${m.label}: ${m.count}` }))),
      t.h >= 2 && on(t, "chart") && h("div.months", {}, st.months.map((m) => h("span", {}, m.label.slice(0, 1))))];
  },

  diveraStatus(t, s, ctx) {
    const d = s.divera;
    if (!d) return [head(t), empty("Divera ist nicht eingerichtet.")];
    const list = d.statuses.slice(0, Math.max(3, t.w));
    if (!list.length) return [head(t), empty("Status-Liste wird geladen …")];
    return [head(t), h("div.choices", { style: `grid-template-columns:repeat(${Math.min(list.length, t.w >= 4 ? 4 : 3)},1fr)` }, list.slice(0, t.w >= 4 ? 4 : 3).map((st) =>
      btn([h("span.dot", { style: `--d:${st.color || "var(--text-2)"}` }), h("span.ell", {}, st.name)],
        () => ctx.act({ type: "divera-status", id: st.id }), { class: d.current === st.id ? "on" : "", style: `--b:${st.color || "var(--ok)"}`, "aria-pressed": String(d.current === st.id) })))];
  },

  answers(t, s) {
    const b = s.divera?.board;
    if (!s.divera) return [head(t), empty("Divera ist nicht eingerichtet.")];
    const ans = b?.alarm?.answers;
    if (!ans) return [head(t), empty(s.alarm ? "Noch keine Rückmeldungen von Divera." : "Bei einem Divera-Alarm siehst du hier, wer kommt.")];
    const rows = Math.min(fitRows(t, 47) - 3, t.opts?.max || Infinity);   // 3 Zeilen für die Zusammenfassung oben
    return [head(t),
      h("div.rm-sum", {},
        h("div", { style: "--x:var(--ok)" }, h("b", {}, String(ans.coming.length)), h("span", {}, "kommen")),
        h("div", { style: "--x:var(--signal)" }, h("b", {}, String(ans.declined.length)), h("span", {}, "kommen nicht")),
        h("div", { style: "--x:var(--text-2)" }, h("b", {}, String(ans.open)), h("span", {}, "offen"))),
      rows > 0 && ans.coming.length > 0 && h("ul.rows", {},
        ans.coming.slice(0, rows).map((p) => h("li", {}, dot("ok"), h("span.ell", {}, p.name), h("span.r.mono", {}, b.alarm.ts && p.ts ? `+${Math.floor((p.ts - b.alarm.ts) / 60000)}:${pad(Math.floor(((p.ts - b.alarm.ts) / 1000) % 60))}` : ""))),
        ans.coming.length > rows && h("li.sub", {}, `und ${ans.coming.length - rows} weitere`))];
  },

  availability(t, s) {
    const b = s.divera?.board;
    if (!s.divera) return [head(t), empty("Divera ist nicht eingerichtet.")];
    const av = (b?.availability || []).filter((x) => x.count > 0 || t.h >= 2);
    if (!av.length) return [head(t), empty("Keine Verfügbarkeit von Divera.")];
    return [head(t, "Verfügbarkeit der Einheit", b.unit),
      h("div.stack", {}, av.map((x) => h("i", { style: `flex:${x.count};background:${x.color || "var(--text-2)"}` }))),
      t.h >= 2 && on(t, "legend") && h("div.legend", {}, av.slice(0, t.h >= 3 ? 8 : 4).map((x) => h("div", {}, h("b", { style: `color:${x.color || "var(--text)"}` }, String(x.count)), h("span.ell", {}, x.name)))),
      t.h < 2 && h("div.sub", {}, av.slice(0, 3).map((x) => `${x.count} ${x.name}`).join(" · "))];
  },

  vehicles(t, s) {
    const v = s.divera?.board?.vehicles;
    if (!s.divera) return [head(t), empty("Divera ist nicht eingerichtet.")];
    if (!v?.length) return [head(t), empty("Keine Fahrzeuge in Divera.")];
    return [head(t), h("ul.rows", {}, v.slice(0, lim(t, 59)).map((x) => h("li", {},
      h("span.fms", { style: `--f:var(--${fmsColor(x.fms)}-soft);--fc:var(--${fmsColor(x.fms)})` }, x.fms || "–"),
      h("b.ell", {}, x.name),
      (x.fmsText || (x.since > 0 && on(t, "since"))) && h("span.r", {}, [x.fmsText, x.since > 0 && on(t, "since") && h("span.mono", {}, ` ${x.fmsText ? "· " : ""}${hm(x.since)}`)]))))];
  },

  events(t, s) {
    const ev = s.divera?.board?.events;
    if (!s.divera) return [head(t), empty("Divera ist nicht eingerichtet.")];
    if (!ev?.length) return [head(t), empty("Keine anstehenden Termine.")];
    return [head(t), h("ul.rows", {}, ev.slice(0, lim(t, 87)).map((e) => h("li", {},
      h("span.date", {}, h("b", {}, pad(new Date(e.start).getDate())), h("span", {}, dayShort(e.start))),
      h("div.ev.ell", {}, h("b.ell", {}, e.title), h("span.ell", {}, [e.fullday ? "ganztägig" : hm(e.start), e.place, on(t, "answers") && e.yes != null && `${e.yes} zugesagt`].filter(Boolean).join(" · "))),
      on(t, "answers") && (e.mine || e.answerable) && h("span.part", { style: `--p:var(--${PART[e.mine][1]})` }, PART[e.mine][0]))))];
  },

  news(t, s) {
    const n = s.divera?.board?.news;
    if (!s.divera) return [head(t), empty("Divera ist nicht eingerichtet.")];
    if (!n?.length) return [head(t), empty("Keine Mitteilungen.")];
    return [head(t), h("div.news", {}, n.slice(0, Math.min(Math.max(1, Math.floor(t.h * 1.1)), t.opts?.max || Infinity)).map((x) => h("article", {},
      h("h3.ell", {}, x.isNew && h("span.new", { "aria-label": "neu" }), x.title), h("p", {}, x.text.replace(/<[^>]+>/g, " ")),
      (x.ts || x.survey) && h("time", {}, [x.ts && dateText(x.ts), x.survey && "Umfrage", on(t, "read") && x.recipients ? `${x.read ?? 0}/${x.recipients} gelesen` : ""].filter(Boolean).join(" · ")))))];
  },

  diveraDetails(t, s) {
    if (!s.divera) return [head(t), empty(NO_DIVERA)];
    const a = s.divera.board?.alarm;
    if (!a) return [head(t), empty(s.alarm ? "Zu diesem Alarm hat Divera keine Details." : "Bei einem Divera-Einsatz stehen hier Objekt, Melder, Hinweise, Einsatzmittel und Fahrtziel.")];
    const rows = [
      ["Objekt", a.object], ["Melder", a.caller], ["Patient", a.patient], ["Hinweise", a.remark],
      ["Einsatzmittel", a.units || a.vehicles.join(", ")], ["Fahrtziel", a.destination?.address],
      ...a.extra.map((x) => ["Zusatz", x]), t.opts?.text === true && ["Meldung", a.text], on(t, "report") && ["Bericht", a.report],
    ].filter((r) => r && r[1]);
    const foot = [
      a.recipients ? `${a.read ?? 0} von ${a.recipients} gelesen` : "",
      a.responseUntil ? `Rückmeldung bis ${hm(a.responseUntil)}` : "",
      a.attachments ? `${a.attachments} ${a.attachments === 1 ? "Anhang" : "Anhänge"}` : "",
      a.myAnswer ? `Du: ${a.myAnswer}` : "",
    ].filter(Boolean);
    return [head(t, "", a.preview ? "Beispiel" : a.number ? `Nr. ${a.number}` : ""),
      (a.priority || a.closed) && h("div.tags", {}, a.priority && h("span.tag.sig", {}, "Sonderrechte"), a.closed && h("span.tag", {}, "beendet")),
      rows.length ? h("dl.facts", {}, rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))
        : empty("Divera hat zu diesem Einsatz nur Stichwort und Adresse."),
      foot.length > 0 && t.h >= 2 && on(t, "foot") && h("div.facts-foot", {}, foot.join(" · "))];
  },

  diveraMap(t, s) {
    if (!s.divera) return [head(t), empty(NO_DIVERA)];
    const b = s.divera.board;
    if (!b) return [head(t), empty(LOADING)];
    const a = b.alarm, pts = [];
    if (a?.place) pts.push({ ...a.place, kind: "alarm", label: "Einsatz" });
    if (a?.destination?.place && on(t, "dest")) pts.push({ ...a.destination.place, kind: "dest", label: "Ziel" });
    if (b.unitInfo?.place && on(t, "home") && (!a || on(t, "homeAlarm"))) pts.push({ ...b.unitInfo.place, kind: "home", label: b.unitInfo.short || "Wache" });
    if (t.opts?.vehicles === true) for (const v of b.vehicles.filter((x) => x.place)) pts.push({ ...v.place, kind: "car", label: v.name, fms: v.fms });
    if (!pts.length) return [head(t), empty(a ? "Divera liefert für diesen Einsatz keine Koordinaten." : "In Divera ist kein Standort der Einheit hinterlegt. Bei Einsätzen mit Koordinaten erscheint hier die Karte.")];
    const W0 = span(t.w, CELL_W), H0 = span(t.h, CELL_H);
    return [osmMap(pts, W0, H0, { near: 17, far: 13 }[t.opts?.zoom] || 16, Math.round(Math.max(36, Math.min(120, Math.min(W0, H0) * 0.2)))),
      head(t, a ? "Einsatzort" : "Standort", a?.preview ? "Beispiel" : ""),
      a?.address && on(t, "address") && h("div.map-addr.ell", {}, a.address),
      h("div.map-attr", {}, "© OpenStreetMap-Mitwirkende")];
  },

  diveraAlarms(t, s) {
    if (!s.divera) return [head(t), empty(NO_DIVERA)];
    const list = (s.divera.board?.alarms || []).filter((a) => on(t, "closed") || !a.closed);
    if (!s.divera.board) return [head(t), empty(LOADING)];
    if (!list.length) return [head(t), empty("Keine Einsätze in Divera.")];
    return [head(t), h("ul.rows", {}, list.slice(0, lim(t, 74)).map((a) => h("li", {},
      dot(a.closed ? "none" : "bad"),
      h("div.ev.ell", {}, h("b.ell", {}, a.title || "Einsatz"), h("span.ell", {}, [dateText(a.ts), a.address].filter(Boolean).join(" · "))),
      t.w >= 3 && h("span.r.mono", {}, a.answers.coming.length ? `${a.answers.coming.length} kommen` : a.closed ? "beendet" : ""))))];
  },

  myStatus(t, s) {
    if (!s.divera) return [head(t), empty(NO_DIVERA)];
    const m = s.divera.board?.me;
    if (!m) return [head(t), empty(s.divera.board ? "Divera meldet keinen eigenen Status." : LOADING)];
    const sub = [m.since && `seit ${whenText(m.since)}`, m.vehicle].filter(Boolean).join(" · ");
    const reset = m.resetAt ? `bis ${whenText(m.resetAt)}${m.resetTo ? `, dann ${m.resetTo}` : ""}` : "";
    const up = t.h >= 2 && on(t, "plan") ? m.upcoming.slice(0, Math.max(0, lim(t, 47) - 2)) : [];
    return [head(t),
      h("div.me" + (t.h < 2 ? ".row" : ""), { style: `--m:${m.color || "var(--ok)"}` },
        h("span.me-dot"), h("div.ell", {}, h("b.ell", {}, m.name), h("div.sub.ell", {}, t.h < 2 && reset ? reset : sub))),
      reset && t.h >= 2 && h("div.me-reset", {}, icon("clock"), reset),
      m.note && t.h >= 2 && h("div.sub.ell", {}, `„${m.note}“`),
      up.length > 0 && h("ul.rows.tight", {}, up.map((u) => h("li", {},
        h("span.mono", {}, whenText(u.ts)), h("span.ell", {}, [u.title, u.status && `→ ${u.status}`].filter(Boolean).join(" ")))))];
  },

  people(t, s) {
    if (!s.divera) return [head(t), empty(NO_DIVERA)];
    const b = s.divera.board;
    if (!b) return [head(t), empty(LOADING)];
    const only = t.opts?.status || "";
    const groups = b.statuses.filter((st) => !only || st.id === only).map((st) => ({ ...st, list: b.people[st.id] || [] })).filter((g) => g.list.length);
    const total = Object.values(b.people).reduce((n, l) => n + l.length, 0);
    if (!total) return [head(t), empty("Divera zeigt deinem Schlüssel keine Namen. Die Anzahl je Status steht in „Verfügbarkeit“.")];
    if (!groups.length) return [head(t, only ? b.statuses.find((x) => x.id === only)?.name : ""), empty("Gerade niemand in diesem Status.")];
    const qn = Object.fromEntries(b.qualifications.map((q) => [q.id, q.short || q.name]));
    // Platz: Zeilen à 40 px, Spalten à ≥ 220 px. Je Gruppe eine Kopfzeile, dann die Namen.
    const cols = Math.max(1, Math.floor((span(t.w, CELL_W) - 44) / 220));
    let lines = fitRows(t, 40), hidden = 0;
    const out = [];
    for (const g of groups) {
      if (lines < 2) { hidden += g.list.length; continue; }
      const headLine = only ? 0 : 1;
      const fit = Math.min(g.list.length, (lines - headLine) * cols);
      const shown = g.list.length > fit ? fit - 1 : fit;
      lines -= headLine + Math.ceil(Math.max(1, fit) / cols);
      hidden += g.list.length - shown;
      out.push(h("section.pg", { style: `--g:${g.color || "var(--text-2)"}` },
        !only && h("div.pg-h", {}, h("span.dot", { style: `--d:${g.color || "var(--text-2)"}` }), h("b.ell", {}, g.name), h("span.mono", {}, String(g.list.length))),
        h("ul.pg-l", { style: `grid-template-columns:repeat(${cols},minmax(0,1fr))` },
          g.list.slice(0, shown).map((p) => h("li.ell", {}, p.name, on(t, "quals") && p.quals.length > 0 && h("small", {}, p.quals.map((q) => qn[q]).filter(Boolean).slice(0, 3).join(" ")))),
          g.list.length > shown && h("li.more", {}, `+ ${g.list.length - shown}`))));
    }
    return [head(t, only ? b.statuses.find((x) => x.id === only)?.name : "", only ? String(groups[0].list.length) : hidden ? `${total} Personen` : ""), h("div.pgs", {}, out)];
  },

  quals(t, s) {
    if (!s.divera) return [head(t), empty(NO_DIVERA)];
    const b = s.divera.board;
    if (!b) return [head(t), empty(LOADING)];
    if (!b.qualifications.length) return [head(t), empty("In Divera sind keine Qualifikationen angelegt.")];
    const st = b.statuses.find((x) => x.id === t.opts?.status) || b.statuses[0];
    const counts = b.qualByStatus[st?.id] || {};
    const list = b.qualifications.map((q) => ({ ...q, n: counts[q.id] || 0 })).filter((q) => q.n > 0 || on(t, "zero"));
    if (!list.length) return [head(t, "", st?.name), empty(`Niemand mit Qualifikation im Status „${st?.name || "?"}“.`)];
    const cols = Math.max(2, Math.min(6, Math.floor((span(t.w, CELL_W) - 44) / 150)));
    const rows = Math.max(1, Math.floor((span(t.h, CELL_H) - 62 - 38) / 86));
    return [head(t, "", st?.name),
      h("div.qgrid", { style: `grid-template-columns:repeat(${cols},minmax(0,1fr))` }, list.slice(0, cols * rows).map((q) =>
        h("div" + (q.n ? "" : ".zero"), { title: q.name }, h("b", {}, String(q.n)), h("span.ell", {}, q.short || q.name))))];
  },

  chat(t, s) {
    if (!s.divera) return [head(t), empty(NO_DIVERA)];
    const m = s.divera.board?.messages;
    if (!m) return [head(t), empty(LOADING)];
    if (!m.length) return [head(t), empty("Keine Nachrichten in Divera.")];
    return [head(t), h("div.news.chat", {}, m.slice(0, Math.min(Math.max(1, Math.floor(t.h * 1.4)), t.opts?.max || Infinity)).map((x) => h("article", {},
      h("div.chat-h", {}, h("b.ell", {}, x.author || "Mitglied"), x.channel && on(t, "channel") && t.w >= 3 && h("span.ell", {}, x.channel), x.ts > 0 && h("time", {}, dateText(x.ts))),
      h("p", {}, x.text))))];
  },

  shifts(t, s) {
    if (!s.divera) return [head(t), empty(NO_DIVERA)];
    const b = s.divera.board;
    if (b?.denied?.shifts) return [head(t), empty("Dienstpläne gibt es für deinen Schlüssel nicht (Recht fehlt oder die Einheit nutzt sie nicht).")];
    if (!b?.shiftsLoaded) return [head(t), empty(LOADING)];
    if (!b.shifts.length) return [head(t), empty("Keine aktuellen Dienstpläne.")];
    return [head(t), h("ul.rows", {}, b.shifts.slice(0, lim(t, 74)).map((x) => h("li", {},
      h("div.ev.ell", {}, h("b.ell", {}, x.name), h("span.ell", {}, [x.start > 0 && whenText(x.start, false), x.end && `bis ${whenText(x.end, false)}`].filter(Boolean).join(" "))),
      x.start > 0 && x.start <= Date.now() && (!x.end || x.end >= Date.now()) && h("span.r", {}, "läuft"))))];
  },

  unit(t, s) {
    if (!s.divera) return [head(t), empty(NO_DIVERA)];
    const u = s.divera.board?.unitInfo;
    if (!u) return [head(t), empty(LOADING)];
    const nums = [["Mitglieder", u.members], ["Fahrzeuge", u.vehicles], ["Qualifikationen", u.qualifications]].filter(([, n]) => n > 0);
    if (t.h < 2) return [h("div.unit.row", {}, h("span.ico.unit-ico", {}, icon("building")),
      h("div.ell", {}, h("b.ell", {}, u.name || "Einheit"), h("div.sub.ell", {}, nums.map(([k, n]) => `${n} ${k}`).join(" · ") || u.address)))];
    return [head(t, u.name || "Einheit"),
      u.address && h("div.sub.ell", {}, u.address),
      h("div.unit-nums", {}, nums.map(([k, n]) => h("div", {}, h("b", {}, String(n)), h("span", {}, k)))),
      (u.newAlarms > 0 || u.newMessages > 0) && on(t, "new") && h("div.sub", {}, [u.newAlarms > 0 && (u.newAlarms === 1 ? "1 ungelesener Einsatz" : `${u.newAlarms} ungelesene Einsätze`), u.newMessages > 0 && (u.newMessages === 1 ? "1 ungelesene Mitteilung" : `${u.newMessages} ungelesene Mitteilungen`)].filter(Boolean).join(" · "))];
  },

  weather(t, s) {
    const w = s.weather;
    if (!w?.now) return [head(t, "Wetter", "DWD"), empty(w?.error ? `Wetter nicht abrufbar (${w.error})` : "Wetter wird geladen. Falscher Ort? Einstellungen → Zentrale → Standort.")];
    const n = w.now, alert = w.alerts[0];
    const cond = { dry: "Trocken", fog: "Nebel", rain: "Regen", sleet: "Schneeregen", snow: "Schnee", hail: "Hagel", thunderstorm: "Gewitter" }[n.condition] || "";
    return [head(t, "Wetter", "DWD"),
      h("div.wx" + (t.h < 2 ? ".row" : ""), {}, h("span.big", {}, `${Math.round(n.temp)}°`),
        h("div.ell", {}, h("b", {}, cond || "Aktuell"), h("div.sub", {}, n.wind != null && on(t, "wind") ? `Wind ${Math.round(n.wind)} km/h${n.gust ? ` · Böen ${Math.round(n.gust)}` : ""}` : ""))),
      alert && on(t, "alerts") && t.h >= 2 && h("div.warnbox", {}, icon("wind"), h("span", {}, alert.title, alert.until ? h("span.until", {}, ` bis ${dayShort(alert.until)} ${hm(alert.until)}`) : "")),
      alert && on(t, "alerts") && t.h < 2 && h("div.warn-inline", {}, alert.title)];
  },

  note(t) {
    const text = String(t.opts?.text || "").trim();
    // Kurze Notiz in großer Kachel: Schrift wächst mit (22 px bei 3 × 1, höchstens 64 px)
    const fs = Math.round(Math.max(22, Math.min(64, Math.sqrt((span(t.w, CELL_W) * (span(t.h, CELL_H) - 62)) / Math.max(20, text.length)) * 0.9)));
    return [head(t, t.opts?.title || "Notiz"), text ? h("p.note-text" + (t.opts?.align === "center" ? ".center" : ""), { style: `font-size:${fs}px` }, text) : empty("Text im Editor eintragen.")];
  },

  image(t) {
    return t.opts?.src ? [h("img.dash-img" + (t.opts.fit === "cover" ? ".cover" : ""), { src: t.opts.src, alt: t.opts.alt || "" })] : [head(t), empty("Bild im Editor wählen.")];
  },
};

/** Eine Kachel. `ctx.act(aktion)` schickt Bedienungen ans Hauptfenster. */
export function renderTile(t, snap, ctx) {
  const def = TILES[t.type];
  if (!def) return h("div.t");
  let body;
  try { body = R[t.type](t, snap, ctx); }
  catch (e) { console.warn("Kachel", t.type, e); body = [head(t), empty("Kachel konnte nicht gezeichnet werden.")]; }
  const lage = t.type === "alarm" && snap.alarm;
  // Hintergrund (opts.surface: plain = ohne Fläche, accent = in der Kachelfarbe) und Schriftgröße (opts.size: s / l)
  const surf = !lage && ["plain", "accent"].includes(t.opts?.surface) ? `.s-${t.opts.surface}` : "";
  const ts = { s: 0.85, l: 1.2, xl: 1.45 }[t.opts?.size];
  return h(`div.t.t-${t.type}${lage ? ".lage" : ""}${surf}`, {
    style: `grid-area:${t.y + 1}/${t.x + 1}/${t.y + t.h + 1}/${t.x + t.w + 1};--a:${color(t)}${ts ? `;--ts:${ts}` : ""}`, "data-id": t.id,
  }, ...[body].flat());
}

/** Das ganze Raster (1920 × 1080). */
export function renderBoard(dash, view, snap, ctx) {
  return h(`div.dash-board${view === "alarm" ? ".alarmv" : ""}`, { "data-theme": snap.theme }, (dash?.views?.[view] || []).map((t) => renderTile(t, snap, ctx)));
}

/** Uhr und „seit Alarm“ jede Sekunde aktualisieren, ohne neu zu zeichnen. */
export function startTicker(root) {
  const tick = () => {
    const now = new Date();
    for (const el of root.querySelectorAll("[data-clock=hm]")) el.firstChild.nodeValue = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    for (const el of root.querySelectorAll("[data-clock=s]")) el.textContent = `:${pad(now.getSeconds())}`;
    for (const el of root.querySelectorAll("[data-clock=date]")) el.textContent = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
    for (const el of root.querySelectorAll("[data-since]")) {
      const s = Math.max(0, Math.floor((now - Number(el.dataset.since)) / 1000));
      el.textContent = s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    }
  };
  tick();
  return setInterval(tick, 1000);
}

export { CELL_W, CELL_H };
