// Einstellungen → Home Assistant: Heimalarm über MQTT-Discovery (macht das Zentrale-Programm, zentrale/dienst/src/hass.js).
import { h, toast } from "../ui/dom.js";
import { field, section, switchRow, copyText } from "../ui/form.js";
import { settings } from "../core/settings.js";
import { shared, updateShared } from "../core/shared.js";
import { state } from "../core/mqtt.js";
import { requireAdmin } from "../core/admin.js";
import { has } from "../core/features.js";
import { icon } from "../ui/icons.js";

const DEF = { enabled: false, prefix: "homeassistant", activeMin: 30, tests: false, buttons: true };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_|_$/gu, "") || "x";

function step(done, now, title, ...body) {
  return h("li.gstep" + (done ? ".done" : now ? ".now" : ""), {},
    h("span.gstep-no", { "aria-hidden": "true" }, done ? icon("check") : null),
    h("div.gstep-body", {}, h("b", {}, title), ...body.flat().filter(Boolean)));
}

/** Beispiel-Automation zum Kopieren. */
const example = () => `alias: Einsatz – Licht an
triggers:
  - trigger: state
    entity_id: event.heimalarm_alarm
conditions:
  - condition: state
    entity_id: event.heimalarm_alarm
    attribute: event_type
    state: alarm
actions:
  - action: light.turn_on
    target:
      entity_id: light.flur
  - action: notify.notify
    data:
      message: "Einsatz: {{ state_attr('event.heimalarm_alarm', 'keyword') }}"`;

export function hassSection(rerender) {
  const c = { ...DEF, ...shared().hass };
  const setCfg = async (patch) => { if (await requireAdmin()) { updateShared({ hass: { ...c, ...patch } }); rerender(); } };
  const host = settings().broker.host || "Adresse der Zentrale";
  const persons = shared().persons || [];

  if (!has.pi()) {
    return section("hass", "Home Assistant", "Braucht die Zentrale: Home Assistant liest dieselbe MQTT-Verbindung mit.",
      h("p.meta", {}, "Ohne Zentrale gibt es keinen gemeinsamen MQTT-Server. Unter Betrieb auf „Mit Zentrale“ wechseln, dann erscheint Heimalarm in Home Assistant von selbst."));
  }

  const entities = [
    ["event.heimalarm_alarm", "Alarm", "Feuert bei jedem Alarm – auch beim zweiten kurz danach. Bester Auslöser für Automationen."],
    ["binary_sensor.heimalarm_einsatz_alle", "Einsatz", `An bei jedem Alarm, ${c.activeMin} min lang. Stichwort, Adresse und Einheit als Attribute.`],
    ...(persons.length > 1 ? persons.map((p) => [`binary_sensor.heimalarm_einsatz_${slug(p.id)}`, `Einsatz ${p.name || p.id}`, "Nur für diese Person."]) : []),
    ["sensor.heimalarm_stichwort", "Letztes Stichwort", "Mit allen Angaben des letzten Alarms."],
    ["sensor.heimalarm_letzter_alarm", "Letzter Alarm", "Zeitpunkt."],
    ["binary_sensor.heimalarm_melder_…", "Melder", "Ist der ESP32 verbunden? Je Melder einer."],
    ...(c.buttons ? [["button.heimalarm_wieder_da", "Einsatz beenden", "Beendet den Einsatz, Licht zurück."], ["button.heimalarm_test_…", "Testalarm", "Je Person, ohne Folgen."]] : []),
  ];

  return section("hass", "Home Assistant", "Heimalarm erscheint als eigenes Gerät. Du brauchst dafür weder Integration noch Token. Damit baust du in Home Assistant eigene Automationen für den Einsatz.",
    h("div.group", {}, h("h3.group-title", {}, c.enabled ? "Eingerichtet" : "In 3 Schritten startklar"),
      h("ol.guide", {},
        step(c.enabled, false, "Home Assistant mit der Zentrale verbinden",
          h("p", {}, "In Home Assistant: ", h("b", {}, "Einstellungen → Geräte & Dienste → Integration hinzufügen → MQTT"), "."),
          h("p", {}, "Server ", h("code", {}, host), ", Port ", h("code", {}, "1883"), ". Benutzer und Passwort wie beim ESP32, falls gesetzt.")),
        step(c.enabled, !c.enabled, "Hier einschalten",
          switchRow("Heimalarm an Home Assistant melden", "Gilt für die ganze Zentrale. Ausschalten entfernt das Gerät wieder.", c.enabled, (v) => setCfg({ enabled: v })),
          !state.connected && h("p.meta.err", {}, "Zentrale gerade nicht verbunden – die Änderung greift, sobald sie wieder da ist.")),
        step(false, c.enabled, "Gerät „Heimalarm“ öffnen",
          h("p", {}, "Unter ", h("b", {}, "MQTT → Geräte"), " steht jetzt „Heimalarm“. Dort „Automation erstellen“ – oder das Beispiel unten kopieren.")))),

    c.enabled && h("div.group", {}, h("h3.group-title", {}, "Was Home Assistant bekommt"),
      h("div.ha-list", {}, entities.map(([id, name, hint]) => h("div.ha-row", {}, h("b", {}, name), h("code", {}, id), h("small", {}, hint))))),

    c.enabled && h("div.group", {}, h("h3.group-title", {}, "Optionen"),
      h("div.fields", {},
        field("Einsatz bleibt an (Minuten)", h("input.input", { type: "number", min: 1, max: 720, value: c.activeMin,
          onchange: (e) => setCfg({ activeMin: Math.min(720, Math.max(1, Number(e.target.value) || 30)) }) }), "„Einsatz beenden“ schaltet ihn früher aus."),
        field("Discovery-Präfix", h("input.input", { value: c.prefix, spellcheck: "false", onchange: (e) => setCfg({ prefix: e.target.value.trim() || "homeassistant" }) }), "Nur ändern, wenn du es in Home Assistant geändert hast.")),
      switchRow("Knöpfe „Einsatz beenden“ und „Testalarm“", "Damit lässt sich Heimalarm auch aus Home Assistant bedienen.", c.buttons, (v) => setCfg({ buttons: v })),
      switchRow("Auch bei Testalarmen melden", "Gut zum Ausprobieren eigener Automationen. Generalprobe meldet immer.", c.tests, (v) => setCfg({ tests: v }))),

    c.enabled && h("details.group", {}, h("summary.group-title", {}, "Beispiel-Automation"),
      h("pre.code-block", {}, example()),
      h("div.row", {}, h("button.btn.small", { type: "button", onclick: () => copyText(example()).then(() => toast("Kopiert – in Home Assistant unter Automation → YAML einfügen")) }, "Kopieren"))),
  );
}
