// Aufbau verständlich machen: Betriebsart wählen, Weg des Alarms als Schaubild, Checkliste mit echtem Status.
import { h } from "./dom.js";
import { settings, mode } from "../core/settings.js";
import { state } from "../core/mqtt.js";
import { has, activeSources } from "../core/features.js";
import { direct } from "../core/direct.js";
import { hasPcFeatures } from "../core/platform.js";

/** Die zwei Betriebsarten als große Auswahl statt Umschalter. */
export const MODES = [
  { id: "zentrale", title: "Mit Zentrale",
    text: "Ein Gerät, das immer läuft: NAS, Mini-PC, Raspberry Pi oder ein alter Laptop mit Docker. Nötig für den Melder in der Ladeschale.",
    meta: "Melder · Alarm-Apps · alle Geräte" },
  { id: "direkt", title: "Ohne Zentrale",
    text: "Nur Handy und PC im selben WLAN. Der Alarm kommt über SYBOS, aPager oder Divera aufs Handy und geht an den PC.",
    meta: "Alarm-Apps · Handy → PC" },
];

export function modeChoice(onPick) {
  const m = mode();
  return h("div.mode-choice", { role: "radiogroup", "aria-label": "Betriebsart" },
    MODES.map((o) => h("button.mode-card", { type: "button", role: "radio", "aria-checked": String(m === o.id), onclick: () => onPick(o.id) },
      h("span.mode-title", {}, o.title),
      h("span.mode-text", {}, o.text),
      h("span.mode-meta", {}, o.meta))));
}

/* ── Schaubild: woher kommt der Alarm, wer gibt ihn weiter, was passiert ── */
const node = (title, text, ok) =>
  h("li.flow-node" + (ok === true ? ".ok" : ok === false ? ".off" : ""), {},
    h("b", {}, title), text && h("small", {}, text));

const flow = (label, ...cols) => h("div.flow", { role: "group", "aria-label": label }, h("div.flow-cols", {}, ...cols));
const column = (label, ...nodes) => h("div.flow-col", {}, h("span.flow-label", {}, label), h("ul", {}, ...nodes));

export function setupFlow() {
  const s = settings();
  if (mode() === "zentrale") {
    const melder = has.esp() ? Boolean(state.devices[s.alarm.me]?.online) : null;
    return flow("So läuft ein Alarm mit Zentrale",
      column("Alarm kommt an",
        node("Melder in der Ladeschale", "ESP32 am Relaiskontakt der Ladeschale", melder),
        node("Alarm-Apps", "SYBOS, aPager, Divera auf dem Handy", (has.sybos() || has.apager() || has.divera()) || null)),
      column("Zentrale",
        node("Zentrale", s.broker.host ? `${s.broker.host} · läuft immer` : "Adresse unter „Verbindung“ eintragen", s.broker.host ? state.connected : false)),
      column("Das passiert",
        node("Alle PCs", "mit deiner Kennung: „Fährst du?“, danach Ruhezustand"),
        node("Handy", "Meldung und Rückmeldung"),
        node("Licht & Alexa", "Routinen der Zentrale")));
  }
  const peers = (s.direct.peers || []).length;
  const paired = hasPcFeatures ? Boolean(direct.ip) : peers > 0;
  return flow("So läuft ein Alarm ohne Zentrale",
    column("Alarm kommt an",
      node("Alarm-App auf dem Handy", "SYBOS, aPager oder Divera – Heimalarm liest mit", (has.sybos() || has.apager() || has.divera()) || null)),
    column("Handy gibt weiter",
      node("Handy", "per WLAN an alle gekoppelten PCs", paired || null)),
    column("Das passiert",
      node("Alle gekoppelten PCs", "„Fährst du?“, danach Ruhezustand", paired || null),
      node("Licht & Alexa", "WLAN-Geräte und Voice Monkey vom Handy")));
}

/* ── Checkliste: richtet sich nach Betriebsart und zeigt, was schon erledigt ist ── */
export function setupSteps() {
  const s = settings();
  const z = mode() === "zentrale";
  const src = activeSources().length > 0;
  const steps = z ? [
    ["Zentrale verbinden", s.broker.host ? (state.connected ? `Verbunden mit ${s.broker.host}` : `${s.broker.host} – nicht erreichbar`) : "IP der Zentrale (NAS, Mini-PC, Raspberry Pi …) eintragen, Port 9001.", state.connected, "#/einstellungen/verbindung"],
    ["Alarmquelle einschalten", src ? activeSources().join(" · ") : "„Melder“ für die Ladeschale, dazu nach Wunsch SYBOS, aPager oder Divera.", src, "#/einstellungen/quellen"],
    ["Kennung prüfen", `Auf Melder, Handy und jedem PC dieselbe: ${s.alarm.me || "–"}`, Boolean(s.alarm.me), "#/einstellungen/alarm"],
    ["Testen", "Test & Diagnose → Testalarm. Zeigt die Abfrage, ohne dass etwas passiert.", null, "#/diagnose"],
  ] : [
    [hasPcFeatures ? "Handy koppeln" : "PC koppeln", hasPcFeatures ? "Adresse und Code dieses PCs am Handy eintragen." : "Jeden PC einzeln hinzufügen – Adresse und Code stehen am PC unter Einstellungen → Betrieb & Koppeln.", hasPcFeatures ? null : (s.direct.peers || []).length > 0, "#/einstellungen/betrieb"],
    ["Alarm-App wählen", src ? activeSources().join(" · ") : "SYBOS, aPager oder Divera einschalten (am Handy).", src, "#/einstellungen/quellen"],
    ["Testen", "Test & Diagnose → Testalarm. Zeigt die Abfrage, ohne dass etwas passiert.", null, "#/diagnose"],
  ];
  return h("ol.steps", {}, steps.map(([title, text, done, href]) =>
    h("li" + (done ? ".done" : ""), {}, h("div", {}, h("a.step-link", { href }, title), h("small", {}, text)))));
}

export const setupDone = () => activeSources().length > 0 && (mode() === "zentrale" ? state.connected : true);
