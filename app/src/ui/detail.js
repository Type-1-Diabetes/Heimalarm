// Lesefenster über dem Dashboard: einzelne Mitteilung, Termin, Divera-Einsatz, Chat-Kanal oder Fahrzeug ganz lesen
// und – wo Divera es erlaubt – beantworten (Umfrage, Zu-/Absage). Nur DOM: Aktionen gehen über ctx.act ans Hauptfenster.
//   Monitor (tv.js): Ebene über dem skalierten Raster, im 1920 × 1080-Maß.
//   Handy (views/board-phone.js): Vollbild in echten Pixeln, schmal = erst Liste, dann Eintrag.
// Zustand je Fenster: { kind, id } – kind: news | event | alarm | chat | vehicle.
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { hm, whenText, dayDate, fmsColor, PART } from "./tiles.js";

const KINDS = {
  news: { label: "Mitteilungen", icon: "mega", color: "--c-divera" },
  event: { label: "Termine", icon: "cal", color: "--c-divera" },
  alarm: { label: "Divera-Einsätze", icon: "bell", color: "--c-alarm" },
  chat: { label: "Nachrichten", icon: "chat", color: "--c-divera" },
  vehicle: { label: "Fahrzeuge", icon: "truck", color: "--c-divera" },
};
export const DETAIL_KINDS = Object.keys(KINDS);

const paras = (text) => String(text || "").split(/\n{2,}/u).map((p) => p.trim()).filter(Boolean).map((p) => h("p", {}, p));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const join = (...xs) => xs.filter(Boolean).join(" · ");

/** Reichweite (empfangen, gelesen, beantwortet) – geladen auf Wunsch, sonst die Zahlen aus der Liste. */
function reachBlock(r, fallback) {
  if (r && !r.error) {
    return h("div.ds-reach", {}, [["empfangen", r.received], ["gelesen", r.viewed], ["beantwortet", r.confirmed]].map(([k, n]) => h("div", {}, h("b", {}, String(n)), h("span", {}, k))));
  }
  if (fallback?.recipients) return h("p.ds-meta", {}, `${fallback.read ?? 0} von ${fallback.recipients} gelesen`);
  return null;
}

// ── Inhalte je Art: Liste links, Eintrag rechts ─────────────────────────────
const VIEW = {
  news: {
    items: (b) => b.news || [],
    row: (n) => ({ title: n.title, meta: join(n.ts && whenText(n.ts), n.survey && "Umfrage"), dot: n.isNew }),
    main(n, s, ctx) {
      const reach = s.divera.reach?.[`news:${n.id}`];
      return [
        h("h1", {}, n.title),
        h("p.ds-meta", {}, join(n.author, n.ts && whenText(n.ts), n.place)),
        h("div.ds-text", {}, paras(n.text).length ? paras(n.text) : h("p.ds-meta", {}, "Ohne Text.")),
        ...n.surveys.map((sv) => survey(n, sv, ctx)),
        n.attachments > 0 && h("p.ds-note", {}, icon("link"), `${plural(n.attachments, "Anhang", "Anhänge")} – in der Divera-App öffnen.`),
        reachBlock(reach, n),
      ];
    },
    open(n, ctx) { if (n.isNew) ctx.act({ type: "divera-read", kind: "news", id: n.id }); ctx.act({ type: "divera-reach", kind: "news", id: n.id }); },
  },

  event: {
    items: (b) => b.events || [],
    row: (e) => ({ title: e.title, meta: join(dayDate(e.start), e.fullday ? "ganztägig" : hm(e.start)), dot: e.isNew }),
    main(e, s, ctx) {
      const range = e.fullday ? "ganztägig" : `${hm(e.start)}${e.end && e.end !== e.start ? ` – ${hm(e.end)}` : ""} Uhr`;
      const opts = e.type === 1 ? [1, 3] : [1, 2, 3];
      const late = e.until && e.until < Date.now();
      return [
        h("div.ds-when", {}, h("span.ds-day", {}, h("b", {}, String(new Date(e.start).getDate()).padStart(2, "0")), h("span", {}, dayDate(e.start).split(" ")[0])),
          h("div", {}, h("h1", {}, e.title), h("p.ds-meta", {}, join(whenText(e.start, false), range, e.place)))),
        h("div.ds-text", {}, paras(e.text)),
        e.type !== 0 && h("section.ds-answer", { "aria-label": "Deine Rückmeldung" },
          h("h2", {}, "Deine Rückmeldung", e.until > 0 && h("span.ds-meta", {}, late ? " · Frist abgelaufen" : ` · bis ${whenText(e.until)}`)),
          e.answerable && !late
            ? h("div.ds-seg", { role: "group" }, opts.map((p) => h("button.ds-btn", {
              type: "button", "aria-pressed": String(e.mine === p), style: `--b:var(--${PART[p][1]})`,
              onclick: (ev) => { busy(ev); ctx.act({ type: "divera-event", id: e.id, participation: p }); },
            }, { 1: "Zusagen", 2: "Unsicher", 3: "Absagen" }[p])))
            : h("p.ds-meta", {}, e.mine ? `Du hast ${PART[e.mine][0]}.` : "Für diesen Termin ist keine Rückmeldung möglich."),
          (e.yes != null || e.no != null) && h("div.ds-reach.small", {}, [["zugesagt", e.yes], e.type !== 1 && ["unsicher", e.maybe], ["abgesagt", e.no]].filter((x) => x && x[1] != null)
            .map(([k, n]) => h("div", {}, h("b", {}, String(n)), h("span", {}, k))))),
        e.attachments > 0 && h("p.ds-note", {}, icon("link"), `${plural(e.attachments, "Anhang", "Anhänge")} – in der Divera-App öffnen.`),
      ];
    },
    open(e, ctx) { if (e.isNew) ctx.act({ type: "divera-read", kind: "event", id: e.id }); },
  },

  alarm: {
    items: (b) => b.alarms || [],
    row: (a) => ({ title: a.title || "Einsatz", meta: join(whenText(a.ts), a.closed ? "beendet" : "offen"), dot: !a.closed, hot: !a.closed }),
    main(a, s) {
      const facts = [["Objekt", a.object], ["Melder", a.caller], ["Patient", a.patient], ["Hinweise", a.remark],
        ["Einsatzmittel", a.units || a.vehicles.join(", ")], ["Fahrtziel", a.destination?.address], ...a.extra.map((x) => ["Zusatz", x]), ["Bericht", a.report]].filter((r) => r[1]);
      const ans = a.answers;
      const reach = s.divera.reach?.[`alarm:${a.id}`];
      return [
        h("div.ds-tags", {}, h(`span.ds-tag${a.closed ? "" : ".sig"}`, {}, a.closed ? "beendet" : "offen"), a.priority && h("span.ds-tag.sig", {}, "Sonderrechte"), a.number && h("span.ds-tag", {}, `Nr. ${a.number}`)),
        h("h1", {}, a.title || "Einsatz"),
        a.address && h("p.ds-addr", {}, a.address),
        h("p.ds-meta", {}, join(whenText(a.ts), a.responseUntil && `Rückmeldung bis ${hm(a.responseUntil)}`, a.myAnswer && `Du: ${a.myAnswer}`)),
        a.text && h("div.ds-text", {}, paras(a.text)),
        facts.length > 0 && h("dl.ds-facts", {}, facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
        (ans.coming.length > 0 || ans.declined.length > 0) && h("section.ds-people", {},
          h("div", { style: "--x:var(--ok)" }, h("h2", {}, h("b", {}, String(ans.coming.length)), " kommen"), h("ul", {}, ans.coming.map((p) => h("li", {}, p.name, p.ts && a.ts ? h("small", {}, `+${Math.max(0, Math.round((p.ts - a.ts) / 60000))} min`) : "")))),
          h("div", { style: "--x:var(--signal)" }, h("h2", {}, h("b", {}, String(ans.declined.length)), " kommen nicht"), h("ul", {}, ans.declined.map((p) => h("li", {}, p.name, p.note && h("small", {}, p.note)))))),
        a.attachments > 0 && h("p.ds-note", {}, icon("link"), `${plural(a.attachments, "Anhang", "Anhänge")} – in der Divera-App öffnen.`),
        reachBlock(reach, a),
      ];
    },
    open(a, ctx) { if (!a.preview && a.id) ctx.act({ type: "divera-reach", kind: "alarm", id: a.id }); },
  },

  chat: {
    items: (b) => (b.channels || []).filter((c) => c.count > 0),
    row: (c) => ({ title: c.title, meta: join(plural(c.count, "Nachricht", "Nachrichten"), c.last && whenText(c.last)) }),
    main(c, s) {
      const msgs = (s.divera.board.messages || []).filter((m) => m.channelId === c.id).toReversed();
      return [
        h("h1", {}, c.title),
        h("ol.ds-chat", {}, msgs.map((m) => h(`li${m.own ? ".own" : ""}`, {},
          h("div.ds-bub", {}, !m.own && h("b", {}, m.author || "Mitglied"), h("p", {}, m.text),
            h("time", {}, join(whenText(m.ts), m.attachments && plural(m.attachments, "Anhang", "Anhänge"))))))),
        h("p.ds-note", {}, "Schreiben geht in der Divera-App."),
      ];
    },
    scrollEnd: true,
  },

  vehicle: {
    items: (b) => b.vehicles || [],
    row: (v) => ({ title: v.name, meta: join(v.fms && `Status ${v.fms}`, v.fmsText), fms: v.fms }),
    main(v) {
      const c = fmsColor(v.fms);
      return [
        h("div.ds-when", {}, h("span.ds-fms", { style: `--f:var(--${c}-soft);--fc:var(--${c})` }, v.fms || "–"),
          h("div", {}, h("h1", {}, v.name), h("p.ds-meta", {}, join(v.full && v.full !== v.name && v.full, v.fmsText, v.since > 0 && `seit ${whenText(v.since)}`)))),
        v.note && v.note !== v.fmsText && h("p.ds-quote", {}, `„${v.note}“`),
        h("section.ds-crew", {}, h("h2", {}, "Besatzung"),
          v.crew?.length ? h("ul", {}, v.crew.map((n) => h("li", {}, n))) : h("p.ds-meta", {}, "Keine Besatzung eingetragen (oder dein Schlüssel sieht sie nicht).")),
      ];
    },
  },
};

/** Umfrage einer Mitteilung: Antworten als Knöpfe, Anzahl als Balken (falls sichtbar). */
function survey(n, sv, ctx) {
  const total = Math.max(1, ...sv.answers.map((a) => a.count || 0));
  const late = sv.until && sv.until < Date.now();
  return h("section.ds-answer", { "aria-label": sv.title },
    h("h2", {}, sv.title),
    h("p.ds-meta", {}, join(sv.multiple ? "Mehrere Antworten möglich" : "Eine Antwort", sv.until && (late ? "Frist abgelaufen" : `bis ${whenText(sv.until)}`))),
    h("div.ds-opts", {}, sv.answers.map((a) => h("button.ds-opt", {
      type: "button", "aria-pressed": String(a.mine), disabled: late,
      style: sv.showCount && a.count != null ? `--p:${Math.round((a.count / total) * 100)}%` : "",
      onclick: (ev) => { busy(ev); ctx.act({ type: "divera-survey", id: n.id, survey: sv.id, answer: a.id, checked: !a.mine }); },
    }, h("span.ds-opt-t", {}, a.title), sv.showCount && a.count != null && h("span.ds-opt-n", {}, String(a.count))))),
    sv.myNote && h("p.ds-quote", {}, `Deine Antwort: „${sv.myNote}“`));
}

/** Knopf als „wird gesendet“ markieren, bis der nächste Stand von Divera kommt. */
function busy(ev) {
  const b = ev.currentTarget;
  b.setAttribute("aria-busy", "true");
  for (const x of b.parentElement.querySelectorAll("button")) x.disabled = true;
}

const key = (x) => String(x.id ?? "");
/** Welche Einträge es gibt und welcher gewählt ist (Standard: der erste, schmal: keiner). */
function resolve(st, snap, narrow) {
  const v = VIEW[st.kind], b = snap.divera?.board;
  const items = b && v ? v.items(b) : [];
  const cur = items.find((x) => key(x) === String(st.id ?? "")) || (narrow ? null : items[0]) || null;
  return { v, items, cur };
}

/**
 * Lesefenster in `layer` zeichnen (oder leeren, wenn st null ist). Zeichnet nur neu, wenn sich der Inhalt geändert hat,
 * damit die Scroll-Position beim Lesen bleibt. host = { act, close(), select(id) }.
 */
export function mountDetail(layer, st, snap, host, { phone = false } = {}) {
  if (!st || !KINDS[st.kind] || !snap?.divera) {
    if (layer.firstChild) layer.replaceChildren();
    layer.dataset.sig = "";
    return;
  }
  const narrow = phone && innerWidth < 760;
  const { v, items, cur } = resolve(st, snap, narrow);
  const sig = JSON.stringify([st.kind, cur ? key(cur) : "", narrow, snap.theme, items.map((x) => v.row(x)), cur, cur && snap.divera.reach?.[`${st.kind}:${cur.id}`]]);
  if (layer.dataset.sig === sig) return;
  const scroll = layer.querySelector(".ds-main")?.scrollTop ?? null;
  const sameItem = layer.dataset.item === `${st.kind}:${cur ? key(cur) : ""}`;
  layer.dataset.sig = sig;
  layer.dataset.item = `${st.kind}:${cur ? key(cur) : ""}`;

  const k = KINDS[st.kind];
  const showList = !narrow || !cur;
  const showMain = !narrow || cur;
  const list = showList && h("nav.ds-list", { "aria-label": k.label }, items.length ? items.map((x) => {
    const r = v.row(x);
    return h(`button.ds-row${r.hot ? ".hot" : ""}`, { type: "button", "aria-current": cur && key(x) === key(cur) ? "true" : "false", onclick: () => host.select(key(x)) },
      r.fms != null && h("span.ds-fms.sm", { style: `--f:var(--${fmsColor(r.fms)}-soft);--fc:var(--${fmsColor(r.fms)})` }, r.fms || "–"),
      h("span.ds-row-t", {}, r.dot && h("i.ds-dot", { "aria-label": "neu" }), h("b", {}, r.title), r.meta && h("small", {}, r.meta)));
  }) : h("p.ds-meta.pad", {}, snap.divera.board ? "Nichts vorhanden." : "Wird von Divera geladen …"));
  const main = showMain && h("article.ds-main", { tabindex: "-1" },
    narrow && h("button.ds-back", { type: "button", onclick: () => host.select(null) }, icon("back"), k.label),
    cur ? v.main(cur, snap, host) : h("p.ds-meta", {}, "Nichts ausgewählt."));

  const panel = h(`section.ds-panel${narrow ? ".narrow" : ""}`, { role: "dialog", "aria-modal": "true", "aria-label": k.label, style: `--a:var(${k.color})` },
    h("header.ds-head", {}, h("span.ico", {}, icon(k.icon)), h("h2", {}, k.label), items.length > 1 && h("span.src", {}, String(items.length)),
      h("button.ds-x", { type: "button", onclick: () => host.close(), "aria-label": "Schließen" }, h("span", {}, "Schließen"), icon("x"))),
    h(`div.ds-body${showList && showMain ? "" : ".one"}`, {}, list, main));
  // Einblenden nur beim ersten Öffnen – neue Daten (gelesen, Reichweite, Abruf) zeichnen ohne Animation neu
  const still = layer.querySelector(":scope > .ds") ? ".still" : "";
  layer.replaceChildren(h(`div.ds${phone ? ".phone" : ".tv"}${still}`, { "data-theme": snap.theme }, h("div.ds-scrim", { onclick: () => host.close() }), panel));

  const m = layer.querySelector(".ds-main");
  if (m && sameItem && scroll != null) m.scrollTop = scroll;
  else if (m && v.scrollEnd) m.scrollTop = m.scrollHeight;
  // Beim ersten Öffnen eines Eintrags: gelesen melden, Reichweite holen
  if (cur && !sameItem) v.open?.(cur, host);
}
