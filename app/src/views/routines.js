// B – Routinen & Regeln. Gespeichert in der gemeinsamen Konfiguration, ausgeführt vom Zentrale-Programm.
import { h, toast } from "../ui/dom.js";
import { dialog, field, select, segmented, switchRow, copyText, download, ask } from "../ui/form.js";
import { shared, updateShared, newId } from "../core/shared.js";
import { state, publish } from "../core/mqtt.js";
import { requireAdmin } from "../core/admin.js";
import { has } from "../core/features.js";
import { fireLocal } from "../core/routines-local.js";
import { icon } from "../ui/icons.js";
import { emit } from "../core/events.js";
import { templateField, SAMPLE } from "../ui/template.js";
import { voiceMonkeyAnnounce, isHeat, WIFI_TYPES, HEAT_MIN, HEAT_MAX } from "../core/wifi.js";
import { isTauri } from "../core/platform.js";
import { settings } from "../core/settings.js";
import { MODES } from "../core/readiness.js";

// Deutsche Stimmen von Amazon Polly (Voice Monkey „voice“); leer = Standardstimme des Echos
const VOICES = [["", "Standard (wie Alexa)"], ["Vicki", "Vicki"], ["Marlene", "Marlene"], ["Daniel", "Daniel"], ["Hans", "Hans"]];
const CHIMES = [["", "Kein Ton"], ["soundbank://soundlibrary/alarms/air_horns/air_horn_01", "Signalhorn"]];
const fetchFn = async (...a) => (isTauri ? (await import("@tauri-apps/plugin-http")).fetch : fetch)(...a);

async function testAnnounce(a, btn) {
  const token = shared().voicemonkey?.token;
  if (!token) return toast("Erst den Voice-Monkey-Token eintragen (Einstellungen → Alexa, Google & HA)");
  if (!a.device) return toast("Erst den Lautsprecher eintragen");
  btn.disabled = true;
  try { const t = await voiceMonkeyAnnounce(token, a, SAMPLE, fetchFn); toast(`Alexa sagt: „${t}“`); }
  catch (e) { toast(e.message); }
  btn.disabled = false;
}

function announceRow(a, del) {
  a.speech ??= "Einsatz. {stichwort}. {adresse}";
  return h("div.item", {},
    h("div.item-head", {}, h("b", {}, "Alexa sagt an"), h("button.btn.small.ghost.danger", { onclick: del }, "Entfernen")),
    field("Lautsprecher", h("input.input", { value: a.device || "", placeholder: "z. B. echo-flur", autocomplete: "off", spellcheck: "false", onchange: (e) => (a.device = e.target.value.trim()) }),
      "ID des Echos aus voicemonkey.io → Devices → Speakers. Mehrere Echos = mehrere Aktionen."),
    templateField("Text", a.speech, (v) => (a.speech = v), { multiline: true, maxlength: 400, keys: ["stichwort", "adresse", "einheit", "uhrzeit", "person", "text"],
      hint: "Fehlt ein Wert (z. B. keine Adresse beim Melder-Alarm), fällt er einfach weg." }),
    h("div.fields", {},
      field("Stimme", select(VOICES, a.voice || "", (v) => (a.voice = v))),
      field("Ton davor", select(CHIMES, a.chime || "", (v) => (a.chime = v)))),
    switchRow("Auf dem Echo Show anzeigen", "Zeigt den Text groß auf rotem Grund, solange Alexa spricht.", a.show, (v) => (a.show = v)),
    h("div.row", {}, h("button.btn.small", { onclick: (e) => testAnnounce(a, e.currentTarget) }, "Mit Beispiel testen")));
}

const TRIGGERS = [["alarm", "Bei Alarm"], ["time", "Zu einer Uhrzeit"], ["readiness", "Wenn die Bereitschaft wechselt"], ["device", "Wenn ein Gerät …"], ["manual", "Nur per Knopf"]];
const CONDS = {
  time: "Uhrzeit von–bis", weekday: "Wochentage", sun: "Hell / dunkel", home: "Jemand zuhause (Handy im WLAN)",
  readiness: "Bereitschaft ist …", keyword: "Stichwort enthält", unit: "Einheit enthält",
};
const READY_IS = [["ready", "Verfügbar"], ["off", "Nicht verfügbar oder abwesend"], ["away", "Nicht verfügbar"], ["absent", "Abwesend"]];
const READY_TO = [["any", "Bei jedem Wechsel"], ["ready", "Wieder verfügbar"], ["off", "Nicht verfügbar oder abwesend"], ["away", "Nicht verfügbar"], ["absent", "Abwesend"]];
const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
/** Wochentage als Häkchen (1 = Montag). */
const dayPicker = (obj) => h("div.row", {}, DAYS.map((d, i) => h("label.row", { style: "gap:4px" },
  h("input", { type: "checkbox", checked: (obj.days ||= [1, 2, 3, 4, 5, 6, 7]).includes(i + 1), onchange: (e) => { obj.days = e.target.checked ? [...obj.days, i + 1].toSorted((x, y) => x - y) : obj.days.filter((x) => x !== i + 1); } }), d)));

const blank = () => ({
  id: newId(), name: "Neue Routine", enabled: true, who: [],
  trigger: { type: "alarm" }, conditions: { mode: "and", items: [] },
  actions: [{ type: "device", device: "", payload: { state: "ON", brightness: 254 }, transition: 1, offAfterSec: 0 }],
  restoreAfterMin: 0,
});

/** Vorlage: Alexa sagt den Einsatz an */
const templateAnnounce = () => ({
  ...blank(), name: "Alarm: Alexa sagt an",
  actions: [{ type: "announce", device: "", speech: "Einsatz. {stichwort}. {adresse}", chime: "soundbank://soundlibrary/alarms/air_horns/air_horn_01" }],
});

/** B – Vorlage: Licht bei Alarm (nachts gedimmt), passend zum Konzept */
const template = () => ({
  ...blank(), name: "Alarm nachts: Licht an",
  conditions: { mode: "and", items: [{ type: "sun", is: "dark" }] },
  actions: [{ type: "device", device: "", payload: { state: "ON", brightness: 3 }, transition: 1, offAfterSec: 300 }],
});

// ── Routine als Satz ──────────────────────────────
const personName = (id) => (shared().persons || []).find((p) => p.id === id)?.name || id;
const dayText = (days) => {
  if (!days?.length || days.length === 7) return "täglich";
  const k = days.join();
  if (k === "1,2,3,4,5") return "Mo–Fr";
  if (k === "6,7") return "am Wochenende";
  return days.map((d) => DAYS[d - 1]).join(", ");
};
const triggerText = (r) => {
  const t = r.trigger || {};
  if (t.type === "alarm") return r.who?.length ? `Bei Alarm für ${r.who.map(personName).join(" oder ")}` : "Bei jedem Alarm";
  if (t.type === "time") return `${dayText(t.days).replace(/^./, (c) => c.toUpperCase())} um ${t.at || "07:00"}`;
  if (t.type === "readiness") return (t.to || "any") === "any" ? "Wenn die Bereitschaft wechselt" : `Wenn die Bereitschaft auf „${READY_TO.find(([k]) => k === t.to)?.[1]}“ wechselt`;
  if (t.type === "device") return `Wenn ${t.device || "ein Gerät"} ${t.property || "action"} = ${t.value || "?"} meldet`;
  return "Per Knopf";
};
const condText = (c) => ({
  time: () => `zwischen ${c.from || "22:00"} und ${c.to || "06:00"}`,
  weekday: () => dayText(c.days),
  sun: () => ((c.is || "dark") === "dark" ? "es dunkel ist" : "es hell ist"),
  home: () => (!c.who || c.who === "any" ? "jemand zuhause ist" : `${state.clients?.[c.who]?.name || "das Handy"} zuhause ist`),
  readiness: () => `Bereitschaft „${READY_IS.find(([k]) => k === (c.is || "off"))?.[1]}“`,
  keyword: () => `Stichwort „${c.contains || "…"}“ enthält`,
  unit: () => `Einheit „${c.contains || "…"}“ enthält`,
}[c.type]?.() || c.type);
const STATE_TEXT = { ON: "an", OFF: "aus", TOGGLE: "umschalten" };
const actionText = (a) => {
  if (a.type === "device") {
    const p = a.payload || {}, extra = [p.brightness !== undefined && `${Math.round((p.brightness / 254) * 100)} %`, p.color?.hex && "Farbe"].filter(Boolean);
    return `${a.device || "Gerät"} ${STATE_TEXT[p.state || "ON"]}${extra.length ? ` (${extra.join(", ")})` : ""}${Number(a.offAfterSec) > 0 ? `, nach ${a.offAfterSec} s aus` : ""}`;
  }
  if (a.type === "heat") return `${a.device || "Heizung"} ${a.mode === "off" ? "aus" : `auf ${a.temp ?? 16} °C`}`;
  if (a.type === "delay") return `${a.sec || 0} s warten`;
  if (a.type === "announce") return "Alexa sagt an";
  if (a.type === "voicemonkey") return `Alexa-Routine ${a.device || ""}`.trim();
  if (a.type === "divera") return `Divera-Status ${a.statusName || a.statusId || "…"}`;
  if (a.type === "readiness") return `Bereitschaft „${MODES[a.mode]?.label || a.mode}“`;
  if (a.type === "webhook") return "Webhook aufrufen";
  if (a.type === "restore") return "Zustand zurücksetzen";
  return a.type;
};
/** Ganze Routine als ein lesbarer Satz. */
function sentence(r) {
  const items = r.conditions?.items || [];
  const cond = items.length ? `, nur wenn ${items.map(condText).join(r.conditions.mode === "or" ? " oder " : " und ")}` : "";
  const acts = (r.actions || []).map(actionText);
  const after = has.pi() && Number(r.restoreAfterMin) > 0 ? ` Nach ${r.restoreAfterMin} min wird alles zurückgesetzt.` : "";
  return `${triggerText(r)}${cond}: ${acts.length ? acts.join(" → ") : "noch keine Aktion"}.${after}`;
}

/** Gespeicherten Wert behalten, auch wenn er (noch) nicht in der Liste steht. */
const keep = (list, v) => (v && !list.some(([k]) => k === v) ? [...list, [v, v]] : list);

// ── Gerät als Auslöser: Eigenschaften und Werte aus den Zigbee-exposes ──
function deviceProps(name) {
  const d = has.pi() ? (state.zigbee || []).find((x) => x.friendly_name === name) : null;
  const out = new Map();
  const walk = (list) => (list || []).forEach((e) => {
    if (e.property && (e.access === undefined || e.access & 1)) {
      const values = e.type === "enum" ? e.values : e.type === "binary" ? [e.value_on, e.value_off] : null;
      if (!out.has(e.property)) out.set(e.property, { label: e.label || e.property, values: values?.filter((v) => v !== undefined).map(String) || null });
    }
    walk(e.features);
  });
  walk(d?.definition?.exposes);
  return out;
}

const save = (routines) => updateShared({ routines });
const devNames = () => [["", "– Gerät wählen –"],
  ...(has.pi() ? (state.zigbee || []).map((d) => [d.friendly_name, d.friendly_name]) : []),
  ...(has.pi() ? state.groups.map((g) => [g.friendly_name, `Gruppe: ${g.friendly_name}`]) : []),
  ...(has.pi() ? (state.matter || []).map((d) => [d.name, `${d.name} (Matter)`]) : []),
  ...(shared().wifi || []).map((d) => [d.name, `${d.name} (WLAN)`])];

/** Zigbee-Gerät mit Solltemperatur in den exposes? */
const zigbeeTrv = (d) => {
  let hit = false;
  const walk = (list) => (list || []).forEach((e) => { if (e.property === "occupied_heating_setpoint") hit = true; walk(e.features); });
  walk(d.definition?.exposes);
  return hit;
};
/** Alle Heizkörperthermostate, die eine Routine stellen kann. */
const heatNames = () => [
  ...(has.pi() ? (state.zigbee || []).filter(zigbeeTrv).map((d) => [d.friendly_name, `${d.friendly_name} (Zigbee)`]) : []),
  ...(has.pi() ? (state.matter || []).filter((d) => d.caps?.heat).map((d) => [d.name, `${d.name} (Matter)`]) : []),
  ...(shared().wifi || []).filter(isHeat).map((d) => [d.name, `${d.name} (${WIFI_TYPES[d.type].label})`])];

/** Aktion „Heizung“: Thermostat auf eine Temperatur stellen oder ausschalten. */
function heatRow(a, del) {
  const list = heatNames();
  const known = !a.device || list.some(([k]) => k === a.device);
  const tempField = field("Temperatur (°C)", h("input.input", { type: "number", min: HEAT_MIN, max: HEAT_MAX, step: 0.5, inputmode: "decimal", value: a.temp ?? 16,
    onchange: (e) => (a.temp = Math.max(HEAT_MIN, Math.min(HEAT_MAX, Number(e.target.value) || 16))) }), `${HEAT_MIN}–${HEAT_MAX} °C in halben Grad.`);
  const box = h("div.fields", {},
    field("Thermostat", select([["", "– Thermostat wählen –"], ...list, ...(known ? [] : [[a.device, `${a.device} (nicht gefunden)`]])], a.device || "", (v) => (a.device = v))),
    field("Einstellen", select([["set", "Auf Temperatur"], ["off", "Aus (Frostschutz)"]], (a.mode ||= "set"), (v) => { a.mode = v; tempField.hidden = v === "off"; })),
    tempField);
  tempField.hidden = a.mode === "off";
  return h("div.item", {},
    h("div.item-head", {}, h("b", {}, "Heizung"), h("button.btn.small.ghost.danger", { onclick: del }, "Entfernen")),
    list.length === 0 && h("p.meta.warn", {}, "Noch kein Thermostat eingerichtet – unter Licht & Geräte hinzufügen."),
    box,
    h("p.meta", {}, has.pi()
      ? "Die vorherige Temperatur kommt mit „Einsatz beenden“ oder nach der Zeit unten zurück."
      : "Ohne Zentrale merkt sich Heimalarm die vorherige Temperatur nicht – dafür eine zweite Routine anlegen."));
}

/** Routine ausführen – mit Zentrale dort, ohne Zentrale hier. */
const run = (r, test = false) => (has.pi() ? publish("heimalarm/cmd/run", { id: r.id, test }) : fireLocal(r, { manual: true, test }));

// ── Editor ─────────────────────────────────────────
const condRow = (c, del) => h("div.item", {},
    h("div.item-head", {}, h("b", {}, CONDS[c.type]), h("button.btn.small.ghost.danger", { onclick: del }, "Entfernen")),
    c.type === "time" && h("div.fields", {},
      field("Von", h("input.input", { type: "time", value: c.from || "22:00", onchange: (e) => (c.from = e.target.value) })),
      field("Bis", h("input.input", { type: "time", value: c.to || "06:00", onchange: (e) => (c.to = e.target.value) }))),
    c.type === "weekday" && dayPicker(c),
    c.type === "sun" && select([["dark", "Nur wenn es dunkel ist"], ["light", "Nur wenn es hell ist"]], (c.is ||= "dark"), (v) => (c.is = v)),
    c.type === "home" && select([["any", "Irgendein Handy"], ...Object.entries(state.clients).filter(([, x]) => x.platform === "Android").map(([id, x]) => [id, x.name])], (c.who ||= "any"), (v) => (c.who = v)),
    c.type === "readiness" && select(READY_IS, (c.is ||= "off"), (v) => (c.is = v)),
    (c.type === "keyword" || c.type === "unit") && h("input.input", { value: c.contains || "", placeholder: c.type === "keyword" ? "z. B. B3 oder RD" : "z. B. LOHBR", onchange: (e) => (c.contains = e.target.value) }),
  );

/** Aktion „Divera-Status setzen“. Mit Zentrale braucht die Person ihren Schlüssel dort (Einstellungen → Alarmquellen → Divera). */
function diveraRow(a, del) {
  const me = settings().alarm.me, list = settings().divera.statuses || [];
  const opts = [["", "– Status wählen –"], ...list.map((x) => [x.id, x.name])];
  const statusField = (key, label, hint) => list.length
    ? field(label, select(opts, a[key] || "", (v) => { a[key] = v; if (key === "statusId") a.statusName = list.find((x) => x.id === v)?.name || ""; }), hint)
    : field(label, h("input.input", { type: "number", value: a[key] || "", placeholder: "Status-ID", onchange: (e) => (a[key] = e.target.value) }), hint || "Liste erscheint, sobald dein Divera-Schlüssel eingetragen ist.");
  const persons = [[me, `${me} (dieses Gerät)`], ...(shared().persons || []).filter((p) => p.id !== me).map((p) => [p.id, `${p.name} (${p.id})`])];
  const keyInfo = has.pi() && state.diveraKeys?.[a.who];
  const warn = has.pi() ? (!keyInfo ? "Für diese Person liegt kein Schlüssel auf der Zentrale. Hinterlegen unter Einstellungen → Alarmquellen → Divera „Auf der Zentrale hinterlegen“." : keyInfo.ok === false ? `Schlüssel auf der Zentrale ungültig: ${keyInfo.error}` : "")
    : a.who !== me ? "Ohne Zentrale nur für die eigene Kennung." : !settings().divera.key ? "Erst den Divera-Schlüssel eintragen." : "";
  return h("div.item", {},
    h("div.item-head", {}, h("b", {}, "Divera-Status setzen"), h("button.btn.small.ghost.danger", { onclick: del }, "Entfernen")),
    h("div.fields", {},
      field("Für", select(persons, (a.who ||= me), (v) => (a.who = v))),
      statusField("statusId", "Status"),
      field("Zurücksetzen nach (min)", h("input.input", { type: "number", min: 0, max: 1440, value: a.resetMin || 0, onchange: (e) => (a.resetMin = Number(e.target.value)) }), "0 = bleibt. Divera setzt selbst zurück, auch wenn Heimalarm aus ist."),
      statusField("resetTo", "… auf", "Nur wenn oben mehr als 0 Minuten stehen."),
      field("Notiz", h("input.input", { value: a.note || "", maxlength: 80, placeholder: "optional", onchange: (e) => (a.note = e.target.value) }))),
    warn && h("p.meta.warn", {}, warn));
}


/** Aktion „Gerät schalten“: oben Gerät und Zustand, Helligkeit/Farbe nur bei „An“ und nur auf Wunsch, Feinheiten eingeklappt. */
function deviceRow(a, del) {
  a.payload ||= {};
  const box = h("div.item");
  const pct = () => Math.round(((a.payload.brightness ?? 254) / 254) * 100);
  const optional = (label, active, onToggle, control) => h("div.ropt", {},
    h("label.row", { style: "gap:6px" }, h("input", { type: "checkbox", checked: active, onchange: (e) => { onToggle(e.target.checked); render(); } }), label),
    active && control);
  const render = () => {
    const on = (a.payload.state || "ON") === "ON";
    const out = h("output", {}, `${pct()} %`);
    const more = [a.transition ? `Übergang ${a.transition} s` : "sofort", Number(a.offAfterSec) > 0 ? `aus nach ${a.offAfterSec} s` : "bleibt an"].join(" · ");
    box.replaceChildren(
      h("div.item-head", {}, h("b", {}, "Gerät schalten"), h("button.btn.small.ghost.danger", { onclick: del }, "Entfernen")),
      h("div.fields", {},
        field("Gerät oder Gruppe", select(devNames(), a.device || "", (v) => (a.device = v))),
        field("Zustand", select([["ON", "An"], ["OFF", "Aus"], ["TOGGLE", "Umschalten"]], a.payload.state || "ON", (v) => { a.payload.state = v; if (v !== "ON") { delete a.payload.brightness; delete a.payload.color; } render(); }))),
      on && h("div.ropts", {},
        optional("Helligkeit festlegen", a.payload.brightness !== undefined, (v) => { if (v) a.payload.brightness = 254; else delete a.payload.brightness; },
          h("div.rrange", {}, h("input", { type: "range", min: 1, max: 100, value: pct(), "aria-label": "Helligkeit in Prozent",
            oninput: (e) => { out.value = `${e.target.value} %`; }, onchange: (e) => (a.payload.brightness = Math.round((Number(e.target.value) / 100) * 254)) }), out)),
        optional("Farbe festlegen", a.payload.color?.hex !== undefined, (v) => { if (v) a.payload.color = { hex: "#ff3b2f" }; else delete a.payload.color; },
          h("input.color-input", { type: "color", value: a.payload.color?.hex || "#ff3b2f", "aria-label": "Farbe", onchange: (e) => (a.payload.color = { hex: e.target.value }) }))),
      h("details.more", {},
        h("summary", {}, "Mehr Optionen ", h("span.meta", {}, `(${more})`)),
        h("div.fields", {},
          field("Übergang (s)", h("input.input", { type: "number", min: 0, value: a.transition ?? 1, onchange: (e) => { a.transition = Number(e.target.value); render(); } }), "Sanft hochdimmen, z. B. 4 s. 0 = sofort."),
          field("Wieder aus nach (s)", h("input.input", { type: "number", min: 0, value: a.offAfterSec || 0, onchange: (e) => { a.offAfterSec = Number(e.target.value); render(); } }), "0 = bleibt an."))));
  };
  render();
  return box;
}

const actionRow = (a, del) => {
    if (a.type === "delay") return h("div.rwait", {}, icon("clock"), h("span", {}, "Warten"),
      h("input.input", { type: "number", min: 1, value: a.sec, "aria-label": "Sekunden warten", onchange: (e) => (a.sec = Number(e.target.value)) }), h("span", {}, "Sekunden"),
      h("button.btn.small.ghost.danger", { onclick: del }, "Entfernen"));
    if (a.type === "voicemonkey") return h("div.item", {}, h("div.item-head", {}, h("b", {}, "Alexa-Routine (Voice Monkey)"), h("button.btn.small.ghost.danger", { onclick: del }, "Entfernen")),
      field("Auslöser-ID", h("input.input", { value: a.device || "", placeholder: "z. B. heimalarm-einsatz", onchange: (e) => (a.device = e.target.value.trim()) }), "ID (nicht der Name) des „Routine Trigger“ aus voicemonkey.io → Devices, z. B. heimalarm-einsatz."));
    if (a.type === "announce") return announceRow(a, del);
    if (a.type === "divera") return diveraRow(a, del);
    if (a.type === "readiness") return h("div.item", {}, h("div.item-head", {}, h("b", {}, "Bereitschaft setzen"), h("button.btn.small.ghost.danger", { onclick: del }, "Entfernen")),
      h("div.fields", {},
        field("Auf", select(Object.entries(MODES).map(([k, m]) => [k, m.label]), (a.mode ||= "away"), (v) => { a.mode = v; })),
        field("Bis (Uhrzeit)", h("input.input", { type: "time", value: a.untilAt || "", onchange: (e) => (a.untilAt = e.target.value) }), "Nächstes Mal diese Uhrzeit, danach wieder verfügbar. Leer = bis du es änderst.")));
    if (a.type === "webhook") return h("div.item", {}, h("div.item-head", {}, h("b", {}, "Webhook aufrufen"), h("button.btn.small.ghost.danger", { onclick: del }, "Entfernen")),
      h("div.fields", {},
        field("Adresse", h("input.input.mono", { value: a.url || "", placeholder: "http://192.168.178.10:8123/api/webhook/heimalarm", inputmode: "url", autocomplete: "off", spellcheck: "false", onchange: (e) => (a.url = e.target.value.trim()) }),
          "Für Home Assistant, Node-RED, IFTTT … {stichwort} und {who} werden ersetzt."),
        field("Art", select([["GET", "GET"], ["POST", "POST (JSON)"]], (a.method ||= "GET"), (v) => (a.method = v)))));
    if (a.type === "heat") return heatRow(a, del);
    if (a.type === "restore") return h("div.item", {}, h("div.item-head", {}, h("b", {}, "Zustand zurücksetzen"), h("button.btn.small.ghost.danger", { onclick: del }, "Entfernen")),
      h("p.meta", {}, "Stellt Geräte und Heizung dieser Routine an genau dieser Stelle wieder so ein wie vor dem Auslösen – z. B. nach einem „Warten“."));
    return deviceRow(a, del);
  };


/** Ein Schritt des Editors: WENN / NUR WENN / DANN / DANACH. */
const step = (n, title, sub, ...content) => h("section.rstep", {},
  h("div.rstep-head", {}, h("span.rstep-n", { "aria-hidden": "true" }, n), h("h3", {}, title), sub && h("small", {}, sub)),
  h("div.rstep-body", {}, ...content));

/** Editor einer Routine in der rechten Spalte (gibt den Inhalt zurück). */
function editor(routine, rerender) {
  const r = structuredClone(routine);
  const summary = h("p.rsentence", { "aria-live": "polite" });
  const refresh = () => (summary.textContent = sentence(r));
  // Jede Änderung (auch ohne Neuaufbau) aktualisiert den Satz oben; die Handler der Felder laufen vorher.
  const body = h("div.reditor", { onchange: refresh, oninput: () => setTimeout(refresh), onclick: () => setTimeout(refresh) });
  // Fertig (Speichern/Abbrechen): zurück zur Ansicht der Routine
  const close = () => { editing = null; draft = null; if (location.hash === `#/routinen/${r.id}`) rerender(); else location.hash = `#/routinen/${r.id}`; };
  const add = (a) => { r.actions.push(a); paint(); };

  const triggerDevice = () => {
    const t = r.trigger, props = deviceProps(t.device);
    t.property ||= props.has("action") ? "action" : props.keys().next().value || "action";
    const prop = props.get(t.property);
    return h("div.fields", {},
      field("Gerät", select(devNames(), t.device || "", (v) => { t.device = v; t.property = ""; t.value = ""; paint(); })),
      props.size
        ? field("Meldet", select(keep([...props].map(([k, x]) => [k, x.label === k ? k : `${x.label} (${k})`]), t.property), t.property, (v) => { t.property = v; t.value = ""; paint(); }))
        : field("Eigenschaft", h("input.input", { value: t.property, onchange: (e) => (t.property = e.target.value.trim()) }), "z. B. action, contact, occupancy"),
      prop?.values
        ? field("Wert", select(keep([["", "– Wert wählen –"], ...prop.values.map((v) => [v, v])], t.value), t.value || "", (v) => (t.value = v)))
        : field("Wert", h("input.input", { value: t.value || "", onchange: (e) => (t.value = e.target.value.trim()) }), "z. B. single, false, true"));
  };

  const paint = () => {
  const persons = shared().persons || [];
  const conds = r.conditions.items;
  const joinWord = r.conditions.mode === "or" ? "oder" : "und";
  const restoreOn = Number(r.restoreAfterMin) > 0;
  refresh();
  body.replaceChildren(...[
    h("div.rhead", {},
      field("Name", h("input.input", { value: r.name, onchange: (e) => (r.name = e.target.value) })),
      summary),

    step("1", "Wenn", "Was startet die Routine?",
      select(TRIGGERS, r.trigger.type, (v) => { r.trigger = { type: v }; paint(); }, { "aria-label": "Auslöser" }),
      r.trigger.type === "time" && h("div.fields", {},
        field("Uhrzeit", h("input.input", { type: "time", value: r.trigger.at || "07:00", onchange: (e) => (r.trigger.at = e.target.value) })),
        h("div.field", {}, h("span", {}, "An diesen Tagen"), dayPicker(r.trigger))),
      r.trigger.type === "readiness" && field("Wenn sie wechselt auf", select(READY_TO, (r.trigger.to ||= "any"), (v) => (r.trigger.to = v)), "Läuft auch, wenn die eingestellte Zeit abläuft."),
      r.trigger.type === "device" && triggerDevice(),
      // G2 – Routinen pro Person
      r.trigger.type === "alarm" && persons.length > 0 && h("div.field", {}, h("span", {}, "Für wen"),
        h("div.row", {}, persons.map((p) => h("label.rpick", { title: `Kennung: ${p.id}` },
          h("input", { type: "checkbox", checked: r.who.includes(p.id), onchange: (e) => { r.who = e.target.checked ? [...r.who, p.id] : r.who.filter((x) => x !== p.id); } }),
          p.name, p.name.toLowerCase() !== p.id.toLowerCase() && h("small", {}, p.id)))),
        h("small", {}, "Keine Auswahl = bei jedem Alarm."))),

    // B3–B5, B10 – Bedingungen
    step("2", "Nur wenn", conds.length ? null : "Optional – ohne Bedingung läuft die Routine immer.",
      conds.length >= 2 && segmented([["and", "Alle müssen zutreffen"], ["or", "Eine reicht"]], r.conditions.mode, (v) => { r.conditions.mode = v; paint(); }),
      ...conds.flatMap((c, i) => [i > 0 && h("div.rjoin", {}, joinWord), condRow(c, () => { conds.splice(i, 1); paint(); })]),
      select([["", "+ Bedingung"], ...Object.entries(CONDS)], "", (v) => { if (v) { conds.push({ type: v }); paint(); } }, { "aria-label": "Bedingung hinzufügen", class: "radd" })),

    // B6, B7 – Aktionen
    step("3", "Dann", "Wird der Reihe nach ausgeführt.",
      h("ol.ractions", {}, r.actions.map((a, i) => h("li", {}, actionRow(a, () => { r.actions.splice(i, 1); paint(); })))),
      h("div.row", {},
        h("button.btn.small", { onclick: () => add({ type: "device", device: "", payload: { state: "ON" }, transition: 1 }) }, "+ Gerät"),
        h("button.btn.small", { onclick: () => add({ type: "heat", device: heatNames()[0]?.[0] || "", mode: "set", temp: 16 }) }, "+ Heizung"),
        h("button.btn.small", { onclick: () => add({ type: "delay", sec: 5 }) }, "+ Warten"),
        h("button.btn.small", { onclick: () => add({ type: "announce", device: "", speech: "Einsatz. {stichwort}. {adresse}" }) }, "+ Alexa sagt an"),
        h("button.btn.small", { onclick: () => add({ type: "voicemonkey", device: "" }) }, "+ Alexa-Routine"),
        h("button.btn.small", { onclick: () => add({ type: "divera", who: settings().alarm.me, statusId: "" }) }, "+ Divera-Status"),
        h("button.btn.small", { onclick: () => add({ type: "readiness", mode: "away", untilAt: "" }) }, "+ Bereitschaft"),
        h("button.btn.small", { onclick: () => add({ type: "webhook", url: "", method: "GET" }) }, "+ Webhook"),
        has.pi() && h("button.btn.small", { title: "Geräte dieser Routine an dieser Stelle zurücksetzen", onclick: () => add({ type: "restore" }) }, "+ Zustand zurücksetzen"))),

    // B8 – Rückkehr (nur die Zentrale merkt sich den vorherigen Zustand)
    has.pi()
      ? step("4", "Danach", "Was passiert mit Licht und Heizung, die diese Routine geschaltet hat?",
        h("div.rchoice", { role: "radiogroup", "aria-label": "Danach" },
          h("label.rpick", {}, h("input", { type: "radio", name: `after-${r.id}`, checked: !restoreOn, onchange: () => { r.restoreAfterMin = 0; paint(); } }),
            h("span", {}, h("b", {}, "Bleibt so"), h("small", {}, "bis jemand „Einsatz beenden“ drückt"))),
          h("label.rpick", {}, h("input", { type: "radio", name: `after-${r.id}`, checked: restoreOn, onchange: () => { r.restoreAfterMin = 30; paint(); } }),
            h("span", {}, h("b", {}, "Automatisch zurücksetzen"), h("small", {}, "auf den Stand vor dem Auslösen")))),
        restoreOn && field("Zurücksetzen nach (Minuten)", h("input.input", { type: "number", min: 1, value: r.restoreAfterMin, onchange: (e) => { r.restoreAfterMin = Math.max(1, Number(e.target.value) || 1); } }),
          "„Einsatz beenden“ setzt auch vorher schon zurück."))
      : h("p.meta", {}, "Ohne Zentrale merkt sich Heimalarm den vorherigen Zustand nicht – zum Zurücksetzen eine zweite Routine anlegen."),

    h("div.row.rsave", {},
      h("button.btn.primary", { onclick: () => { const list = (shared().routines || []).filter((x) => x.id !== r.id); save([...list, r]); close(); rerender(); toast("Routine gespeichert"); } }, "Speichern"),
      h("button.btn", { onclick: () => close() }, "Abbrechen")),
  ].filter(Boolean));
  };

  paint();
  return body;
}

// ── Seite: zwei Spalten (Liste links, Routine rechts) ──
let editing = null;   // id der Routine, die rechts bearbeitet wird
let draft = null;     // neue, noch nicht gespeicherte Routine

const sel = () => decodeURIComponent(location.hash.replace("#/", "").split("/")[1] || "");
const isPhone = () => window.matchMedia("(max-width: 760px)").matches;

export function routinesView(rerender) {
  const list = shared().routines || [];
  const s = shared();
  const startEdit = async (r, isNew = false) => {
    if (!(await requireAdmin())) return;
    editing = r.id; draft = isNew ? r : null;
    if (location.hash !== `#/routinen/${r.id}`) location.hash = `#/routinen/${r.id}`; else rerender();
  };

  const exportJson = () => JSON.stringify({ heimalarm: "routinen", version: 1, routines: list }, null, 2);
  const importDialog = async () => {
    if (!(await requireAdmin())) return;
    const ta = h("textarea.input", { placeholder: "Exportierten Text hier einfügen" });
    const close = dialog("Routinen importieren", ta,
      h("div.row", {}, h("button.btn.primary", { onclick: () => {
        try {
          const data = JSON.parse(ta.value);
          const incoming = (data.routines || []).map((r) => ({ ...r, id: newId() }));
          save([...list, ...incoming]); close(); rerender(); toast(`${incoming.length} Routinen importiert`);
        } catch { toast("Text ist kein gültiger Export"); }
      } }, "Importieren")));
  };

  const all = draft ? [...list, draft] : list;
  const key = sel();
  const current = key === "allgemein" ? "allgemein" : all.find((r) => r.id === key)?.id || (isPhone() ? null : all[0]?.id || "allgemein");
  if (editing && editing !== current) { editing = null; draft = null; }

  const item = (r) => h("a.split-item", { href: `#/routinen/${r.id}`, "aria-current": current === r.id ? "page" : null },
    h("span.ico", { style: `--a:var(${r.enabled ? "--c-routine" : "--text-2"})` }, icon("flow")),
    h("span.split-item-text", {}, h("b", {}, r.name), h("small", {}, r === draft ? "neu, noch nicht gespeichert" : r.enabled ? (TRIGGERS.find(([k]) => k === r.trigger?.type)?.[1] || "") : "ausgeschaltet")),
    h("span.chev", {}, icon("chev")));

  const listPane = h("aside.split-list", {},
    h("h1", {}, "Routinen"),
    h("div.row", { style: "padding:0 4px 12px;gap:8px" },
      h("button.btn.primary.small", { onclick: () => startEdit(blank(), true) }, "Neue Routine"),
      h("button.btn.small", { onclick: () => startEdit(template(), true) }, "Vorlage Licht"),
      h("button.btn.small", { onclick: () => startEdit(templateAnnounce(), true) }, "Vorlage Ansage")),
    has.pi() && !state.dienst?.online && h("p.split-warn", {}, "Zentrale-Programm nicht erreichbar – Routinen laufen erst, wenn es läuft."),

    h("nav.split-nav", { "aria-label": "Routinen" },
      all.length === 0 ? h("p.hint", { style: "padding:8px 10px" }, "Noch keine Routine. Tipp: „Vorlage Licht“ oder „Vorlage Ansage“ legt eine fertige Routine an.") : all.map(item),
      h("div.split-grp", {}, "Allgemein"),
      h("a.split-item", { href: "#/routinen/allgemein", "aria-current": current === "allgemein" ? "page" : null },
        h("span.ico", { style: "--a:var(--c-app)" }, icon("home")),
        h("span.split-item-text", {}, h("b", {}, "Einsatz beenden & Export"), h("small" + (s.vacation ? ".warn" : ""), {}, "Einsatz beenden, Sichern, Laden")),
        h("span.chev", {}, icon("chev")))));

  let detail = null;
  if (current === "allgemein") {
    detail = h("section.split-detail", { style: "--a:var(--c-app)" },
      h("a.split-back", { href: "#/routinen" }, icon("back"), "Routinen"),
      h("div.split-head", {}, h("span.ico.big", { style: "--a:var(--c-app)" }, icon("home")), h("div", {}, h("p.crumb", {}, "Routinen"), h("h2", {}, "Einsatz beenden & Export"))),
      h("p.split-sub", {}, `Routinen laufen ${has.pi() ? "auf der Zentrale" : "auf dem Handy"}.`),
      h("section.card", {},
        has.pi() && h("div.row", {}, h("button.btn", { onclick: () => { emit("restore"); publish("heimalarm/cmd/restore", {}); toast("Vorheriger Zustand wird wiederhergestellt"); } }, "Einsatz beenden – Zustand zurück"))),
      h("section.card", {}, h("h3", {}, "Sichern und laden"),
        h("p.hint", {}, "Alle Routinen als Text – zum Sichern oder für eine andere Zentrale."),
        h("div.row", {},
          h("button.btn.small", { onclick: async () => { if (await copyText(exportJson())) toast("In die Zwischenablage kopiert"); download("heimalarm-routinen.json", exportJson()); } }, "Exportieren"),
          h("button.btn.small", { onclick: importDialog }, "Importieren"))));
  } else if (current) {
    const r = all.find((x) => x.id === current);
    detail = h("section.split-detail", { style: "--a:var(--c-routine)" },
      h("a.split-back", { href: "#/routinen" }, icon("back"), "Routinen"),
      h("div.split-head", {},
        h("span.ico.big", { style: `--a:var(${r.enabled ? "--c-routine" : "--text-2"})` }, icon("flow")),
        h("div", { style: "flex:1;min-width:0" }, h("p.crumb", {}, "Routinen"), h("h2", {}, r.name)),
        r !== draft && h("input", { type: "checkbox", role: "switch", class: "mini-switch", checked: r.enabled, "aria-label": "Routine aktiv",
          onchange: async (e) => { if (await requireAdmin()) save(list.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x))); else rerender(); } })),
      editing === r.id
        ? h("section.card", {}, editor(r, rerender))
        : [
          h("section.card", {}, h("p.rsentence", {}, sentence(r)),
            h("div.row", {},
              h("button.btn.primary.small", { onclick: () => { run(r); toast(`„${r.name}“ wird ausgeführt`); } }, "Ausführen"),
              h("button.btn.small", { onclick: () => { run(r, true); toast("Test: nur im Protokoll"); } }, "Test"),
              h("button.btn.small", { onclick: () => startEdit(r) }, "Bearbeiten"),
              h("button.btn.small.ghost.danger", { onclick: async () => { if (await requireAdmin() && await ask(`„${r.name}“ löschen?`)) { save(list.filter((x) => x.id !== r.id)); location.hash = "#/routinen"; rerender(); } } }, "Löschen")))]);
  }
  return h("div.split" + (detail && current ? ".has-detail" : ""), {}, listPane, detail || h("section.split-detail.empty-pane", {}, h("p.empty", {}, "Routine links auswählen.")));
}
