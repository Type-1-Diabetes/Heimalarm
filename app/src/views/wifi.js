// WLAN-Geräte: Shelly, Hue Bridge, WLED, Tasmota – direkt im Heimnetz, mit und ohne Zentrale.
// Dazu Heizkörperregler: FRITZ! (über die FRITZ!Box) und Shelly BLU TRV (über das BLU Gateway).
import { h, toast } from "../ui/dom.js";
import { dialog, field, select, ask } from "../ui/form.js";
import { shared, updateShared, newId } from "../core/shared.js";
import { requireAdmin } from "../core/admin.js";
import { isTauri } from "../core/platform.js";
import { WIFI_TYPES, wifiSet, huePair, hueTargets, isHeat, wifiHeatGet, fritzThermostats, bluTrvs } from "../core/wifi.js";
import { heatControl, fmtTemp } from "../ui/heat.js";

const fetchFn = async (...a) => (isTauri ? (await import("@tauri-apps/plugin-http")).fetch : fetch)(...a);
const save = (list) => updateShared({ wifi: list });
export const doSet = (d, state) => wifiSet(d, state, fetchFn)
  .then(() => toast(`${d.name}: ${state.temp != null ? fmtTemp(state.temp) : state.on ? "an" : "aus"}`))
  .catch((e) => toast(`${d.name}: ${e.message}`));

const HOST = {
  hue: ["IP der Bridge", "192.168.1.50"],
  fritz: ["Adresse der FRITZ!Box", "fritz.box"],
  shellyblu: ["IP des BLU Gateways", "192.168.178.60"],
};

export function addDialog(rerender, existing) {
  const d = existing ? structuredClone(existing) : { id: newId(), name: "", type: "shelly", host: "", user: "", target: "" };
  const body = h("div", { style: "display:grid;gap:16px" });
  let targets = [], busy = false;
  const load = async (fn) => {
    if (!d.host) return toast("Erst die Adresse eintragen");
    busy = true; paint();
    try { targets = await fn(); if (!targets.length) toast("Nichts gefunden"); }
    catch (e) { toast(e.message); }
    busy = false; paint();
  };
  const loadFritz = () => load(async () => (await fritzThermostats(d, fetchFn)).map((t) => ({ target: t.ain, name: `${t.name}${t.present ? "" : " (nicht erreichbar)"}` })));
  const pickTarget = (label, hint) => [
    targets.length > 0 && field(label, select([["", "– wählen –"], ...targets.map((t) => [t.target, t.name])], d.target, (v) => {
      d.target = v;
      if (!d.name) d.name = targets.find((t) => t.target === v)?.name.replace(/ \(.*\)$/u, "") || "";
      paint();
    }), hint),
    !targets.length && d.target && h("p.meta", {}, `Gewählt: ${d.target}`),
  ];

  const paint = () => body.replaceChildren(...[
    h("div.field", {}, h("span", {}, "Art"), select(Object.entries(WIFI_TYPES).map(([k, v]) => [k, v.label]), d.type, (v) => { d.type = v; targets = []; d.target = ""; if (v === "fritz" && !d.host) d.host = "fritz.box"; paint(); }), h("small", {}, WIFI_TYPES[d.type].hint)),
    field("Name", h("input.input", { value: d.name, placeholder: isHeat(d) ? "z. B. Heizung Wohnzimmer" : "z. B. Flurlicht", onchange: (e) => (d.name = e.target.value.trim()) }), "So heißt es in Routinen."),
    field(HOST[d.type]?.[0] || "IP-Adresse", h("input.input", { value: d.host, inputmode: "url", placeholder: HOST[d.type]?.[1] || "192.168.1.50", onchange: (e) => (d.host = e.target.value.trim()) }),
      d.type === "fritz" ? "Meist reicht „fritz.box“." : "Am besten im Router fest vergeben."),

    d.type === "hue" && h("div.group", {},
      h("h3.group-title", {}, "Bridge koppeln"),
      h("p.meta", {}, d.user ? "Gekoppelt." : "Knopf auf der Bridge drücken, dann innerhalb von 30 s „Koppeln“."),
      h("div.row", {},
        h("button.btn.small", { onclick: async () => { try { d.user = await huePair(d.host, fetchFn); toast("Bridge gekoppelt"); targets = await hueTargets(d.host, d.user, fetchFn); paint(); } catch (e) { toast(e.message); } } }, d.user ? "Neu koppeln" : "Koppeln"),
        d.user && h("button.btn.small.ghost", { onclick: () => load(() => hueTargets(d.host, d.user, fetchFn)) }, "Lampen laden")),
      ...pickTarget("Lampe oder Raum")),

    d.type === "fritz" && h("div.group", {},
      h("h3.group-title", {}, "Anmeldung an der FRITZ!Box"),
      h("p.meta", {}, "Am besten einen eigenen Benutzer anlegen: FRITZ!Box → System → FRITZ!Box-Benutzer → Hinzufügen, nur das Recht „Smart Home“."),
      h("div.fields", {},
        field("Benutzer", h("input.input", { value: d.user || "", autocomplete: "off", spellcheck: "false", onchange: (e) => (d.user = e.target.value.trim()) })),
        field("Kennwort", h("input.input", { type: "password", value: d.pass || "", autocomplete: "new-password", onchange: (e) => (d.pass = e.target.value) }), "Liegt nur in deinem Heimalarm, nicht in der Cloud.")),
      h("div.row", {}, h("button.btn.small", { disabled: busy, onclick: loadFritz }, busy ? "Wird geladen …" : "Regler laden")),
      ...pickTarget("Heizkörperregler", "Alle Regler, die an der FRITZ!Box angemeldet sind.")),

    d.type === "shellyblu" && h("div.group", {},
      h("h3.group-title", {}, "Thermostat am Gateway"),
      h("p.meta", {}, "Das TRV muss vorher in der Shelly-App mit dem BLU Gateway Gen3 verbunden sein."),
      h("div.row", {}, h("button.btn.small", { disabled: busy, onclick: () => load(() => bluTrvs(d.host, fetchFn)) }, busy ? "Wird geladen …" : "Thermostate laden")),
      ...pickTarget("Thermostat"),
      !targets.length && field("Nummer (falls die Liste leer bleibt)", h("input.input.mono", { value: d.target || "", placeholder: "200", inputmode: "numeric", onchange: (e) => (d.target = e.target.value.trim()) }), "Erstes Thermostat am Gateway = 200, das zweite 201 …")),

    isHeat(d)
      ? h("div.row", {},
        h("button.btn.small.ghost", { onclick: () => doSet(d, { on: true, temp: 21 }) }, "Test: 21 °C"),
        h("button.btn.small.ghost", { onclick: () => doSet(d, { on: false }) }, "Test: aus"))
      : h("div.row", {},
        h("button.btn.small.ghost", { onclick: () => doSet(d, { on: true }) }, "Test: an"),
        h("button.btn.small.ghost", { onclick: () => doSet(d, { on: false }) }, "Test: aus")),
    h("div.row", {},
      h("button.btn.primary", { onclick: () => {
        if (!d.name || !d.host) return toast(`Name und ${HOST[d.type]?.[0] || "IP-Adresse"} eintragen`);
        if (d.type === "hue" && (!d.user || !d.target)) return toast("Bridge koppeln und Lampe wählen");
        if (d.type === "fritz" && (!d.user || !d.target)) return toast("Anmelden und Regler wählen");
        if (d.type === "shellyblu" && !d.target) return toast("Thermostat wählen");
        const list = (shared().wifi || []).filter((x) => x.id !== d.id);
        save([...list, d]); close(); rerender(); toast("Gespeichert");
      } }, "Speichern"),
      h("button.btn", { onclick: () => close() }, "Abbrechen")),
  ].filter(Boolean));
  paint();
  const close = dialog(existing ? `Gerät: ${existing.name}` : "WLAN-Gerät hinzufügen", body);
}

/** Thermostat: Zustand nachladen und Bedienung zeigen. */
function heatBox(d) {
  const box = h("div.heat-box", {}, h("p.meta", {}, "Wird gelesen …"));
  wifiHeatGet(d, fetchFn)
    .then((s) => box.replaceChildren(heatControl(s, (t) => doSet(d, { on: true, temp: t }), () => doSet(d, { on: false }))))
    .catch((e) => box.replaceChildren(h("p.meta.warn", {}, `Nicht erreichbar: ${e.message}`)));
  return box;
}

export function row(d, list, rerender) {
  const edit = async () => { if (await requireAdmin()) addDialog(rerender, d); };
  const del = async () => { if (await requireAdmin() && await ask(`„${d.name}“ entfernen?`)) { save(list.filter((x) => x.id !== d.id)); rerender(); } };
  const heat = isHeat(d);
  return h("li", {},
    h("div.row-main", {}, h("b", {}, d.name, h("span.badge", {}, WIFI_TYPES[d.type]?.label || d.type)), h("span.meta", {}, d.host)),
    heat && heatBox(d),
    h("div.row", {},
      !heat && h("button.btn.small", { onclick: () => doSet(d, { on: true }) }, "An"),
      !heat && h("button.btn.small", { onclick: () => doSet(d, { on: false }) }, "Aus"),
      h("button.btn.small.ghost", { onclick: edit }, "Bearbeiten"),
      h("button.btn.small.ghost.danger", { onclick: del }, "Entfernen")));
}

export function wifiSection(rerender) {
  const list = shared().wifi || [];
  const add = async () => { if (await requireAdmin()) addDialog(rerender); };
  const sorted = list.toSorted((a, b) => a.name.localeCompare(b.name));
  return h("section.card", {},
    h("div.card-head", {}, h("h2", {}, "WLAN-Geräte"), h("button.btn.small", { onclick: add }, "Hinzufügen")),
    list.length === 0
      ? h("p.hint", {}, "Shelly, Philips Hue (auch IKEA-Lampen an der Bridge), WLED, Tasmota und FRITZ!-Heizkörperregler. Läuft direkt im Heimnetz, auch ohne Zentrale.")
      : h("ul.rows", {}, sorted.map((d) => row(d, list, rerender))));
}
