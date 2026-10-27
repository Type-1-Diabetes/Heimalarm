// C – Licht & Geräte über Zigbee2MQTT: anlernen, umbenennen, entfernen, steuern,
// Gruppen, Direktverknüpfung, Erreichbarkeit, Firmware, Netzwerkkarte.
// Dazu WLAN-Geräte (wifi.js) und Matter-Geräte, die die Zentrale steuert (zentrale/dienst/src/matterctl.js).
import { h, toast, fmtAgo } from "../ui/dom.js";
import { dialog, field, select, ask } from "../ui/form.js";
import { state, z2m, setDevice, matterCmd } from "../core/mqtt.js";
import { requireAdmin } from "../core/admin.js";
import { log } from "../core/log.js";
import { has } from "../core/features.js";
import { row as wifiRow, addDialog as addWifi } from "./wifi.js";
import { shared } from "../core/shared.js";
import { WIFI_TYPES, isHeat } from "../core/wifi.js";
import { heatControl, fmtTemp } from "../ui/heat.js";
import { icon } from "../ui/icons.js";

/** Alle Eigenschaften (property) aus den Zigbee2MQTT-"exposes" sammeln. */
function props(dev) {
  const out = new Set();
  const walk = (list) => (list || []).forEach((e) => { if (e.property) out.add(e.property); walk(e.features); });
  walk(dev.definition?.exposes);
  return out;
}

const pct = (v) => Math.round(((Number(v) || 0) / 254) * 100);
const asked = (fn) => async (...a) => { if (await requireAdmin()) fn(...a); };

/** Heizkörperthermostat? (Zigbee: occupied_heating_setpoint in den exposes, Matter: Thermostat-Cluster) */
const isTrv = (p) => p.has("occupied_heating_setpoint");

function controls(name, p, s) {
  const out = [];
  if (isTrv(p)) {
    const wake = s.system_mode === "off" && p.has("system_mode") ? { system_mode: "heat" } : {};
    out.push(heatControl({ temp: s.occupied_heating_setpoint, current: s.local_temperature, off: s.system_mode === "off", battery: s.battery },
      (t) => setDevice(name, { ...wake, occupied_heating_setpoint: t }),
      p.has("system_mode") ? () => setDevice(name, { system_mode: "off" }) : null));
  }
  if (p.has("state")) {
    out.push(h("div.row", {},
      h("button.btn.small" + (s.state === "ON" ? ".primary" : ""), { onclick: () => setDevice(name, { state: "ON", transition: 1 }) }, "An"),
      h("button.btn.small" + (s.state === "OFF" ? ".primary" : ""), { onclick: () => setDevice(name, { state: "OFF", transition: 1 }) }, "Aus"),
      p.has("effect") && h("button.btn.small", { onclick: () => setDevice(name, { effect: "blink" }), title: "Kurz blinken" }, "Blinken")));
  }
  if (p.has("brightness")) {
    const val = h("span", {}, `${pct(s.brightness)} %`);
    out.push(h("label.range", {}, "Helligkeit",
      h("input", { type: "range", min: 1, max: 100, value: pct(s.brightness) || 50,
        oninput: (e) => (val.textContent = `${e.target.value} %`),
        onchange: (e) => setDevice(name, { brightness: Math.round((Number(e.target.value) / 100) * 254), transition: 1 }) }), val));
  }
  if (p.has("color_temp")) {
    out.push(h("label.range", {}, "Farbtemp.",
      h("input", { type: "range", min: 150, max: 500, value: s.color_temp || 300, onchange: (e) => setDevice(name, { color_temp: Number(e.target.value), transition: 1 }) }),
      h("span", {}, "warm")));
  }
  if (p.has("color")) {
    out.push(h("label.range", {}, "Farbe", h("input.color-input", { type: "color", value: "#ff3b2f", onchange: (e) => setDevice(name, { color: { hex: e.target.value } }) }), h("span")));
  }
  return out;
}

function deviceCard(dev) {
  const name = dev.friendly_name;
  const s = state.zstate[name] || {};
  const avail = state.zavail[name];
  const p = props(dev);

  const rename = asked(() => {
    const input = h("input.input", { value: name });
    const close = dialog("Gerät umbenennen", field("Neuer Name", input, "Z. B. „Flur Decke“. Routinen mit dem alten Namen bitte anpassen."),
      h("div.row", {}, h("button.btn.primary", { onclick: () => { z2m("device/rename", { from: name, to: input.value.trim(), homeassistant_rename: false }); close(); toast("Wird umbenannt …"); } }, "Speichern")));
  });
  const remove = asked(async () => { if (await ask(`„${name}“ wirklich entfernen?`)) { z2m("device/remove", { id: name }); log("action", `Gerät entfernt: ${name}`); } });
  const ota = asked(() => { z2m("device/ota_update/check", { id: name }); toast("Firmware wird geprüft …"); });
  const otaUpdate = asked(async () => { if (await ask("Firmware jetzt aktualisieren? Das kann einige Minuten dauern.")) z2m("device/ota_update/update", { id: name }); });
  const bind = asked(() => {
    const targets = (state.zigbee || []).filter((d) => d.friendly_name !== name).map((d) => [d.friendly_name, d.friendly_name]);
    let target = targets[0]?.[0];
    const close = dialog("Direkt verknüpfen",
      h("p.meta", {}, `„${name}“ (z. B. ein Schalter) steuert dann das Ziel direkt – auch ohne Zentrale.`),
      field("Ziel", select(targets, target, (v) => (target = v))),
      h("div.row", {},
        h("button.btn.primary", { onclick: () => { z2m("device/bind", { from: name, to: target }); close(); toast("Verknüpfung wird angelegt …"); } }, "Verknüpfen"),
        h("button.btn", { onclick: () => { z2m("device/unbind", { from: name, to: target }); close(); } }, "Lösen")));
  });

  return h("div.item", {},
    h("div.item-head", {},
      h("div", {}, h("b", {}, name), h("div.meta", {}, dev.definition?.description || dev.type)),
      avail === "offline" ? h("span.chip.bad", {}, "nicht erreichbar") : avail === "online" ? h("span.chip.ok", {}, "erreichbar") : h("span.chip", {}, "unbekannt")),
    ...controls(name, p, s),
    s.update?.state === "available" && h("div.banner.warn", {}, h("div", {}, h("b", {}, "Firmware-Update verfügbar"), h("button.btn.small", { onclick: otaUpdate }, "Jetzt aktualisieren"))),
    h("div.row", {},
      h("button.btn.small.ghost", { onclick: rename }, "Umbenennen"),
      h("button.btn.small.ghost", { onclick: bind }, "Verknüpfen"),
      h("button.btn.small.ghost", { onclick: ota }, "Firmware prüfen"),
      h("button.btn.small.ghost.danger", { onclick: remove }, "Entfernen")),
    s.linkquality != null && h("p.meta", {}, `Signal ${s.linkquality} LQI${s.last_seen ? " · zuletzt " + fmtAgo(new Date(s.last_seen).getTime()) : ""}`),
  );
}

// ── Matter: Geräte, die schon in Alexa, Google Home & Co. sind, zusätzlich in Heimalarm ──
const MATTER_PROPS = { onoff: ["state"], level: ["brightness"], ct: ["color_temp"], heat: ["occupied_heating_setpoint", "system_mode"] };
const matterProps = (d) => new Set(Object.entries(d.caps || {}).filter(([, v]) => v).flatMap(([k]) => MATTER_PROPS[k] || []));

function matterCard(d) {
  const s = state.mstate[d.id] || {};
  const rename = asked(() => {
    const input = h("input.input", { value: d.name });
    const close = dialog("Gerät umbenennen", field("Neuer Name", input, "Z. B. „Flur Decke“. Routinen mit dem alten Namen bitte anpassen."),
      h("div.row", {}, h("button.btn.primary", { onclick: () => { matterCmd("rename", { id: d.id, name: input.value.trim() }); close(); toast("Wird umbenannt …"); } }, "Speichern")));
  });
  const remove = asked(async () => {
    if (await ask(`„${d.name}“ aus Heimalarm entfernen? In Alexa bzw. Google Home bleibt es.`)) { matterCmd("remove", { node: d.node }); log("action", `Matter-Gerät entfernt: ${d.name}`); }
  });
  return h("div.item", {},
    h("div.item-head", {},
      h("div", {}, h("b", {}, d.name), h("div.meta", {}, [d.vendor, d.product].filter(Boolean).join(" · ") || "Matter")),
      d.online ? h("span.chip.ok", {}, "erreichbar") : h("span.chip.bad", {}, "nicht erreichbar")),
    ...controls(d.name, matterProps(d), s),
    h("div.row", {},
      h("button.btn.small.ghost", { onclick: rename }, "Umbenennen"),
      h("button.btn.small.ghost.danger", { onclick: remove }, "Entfernen")),
    h("p.meta", {}, "Gesteuert von der Zentrale, lokal über Matter. Alexa bzw. Google Home können das Gerät weiter schalten."));
}

let pairCode = "";
function matterAddCard() {
  const st = state.matterStatus, p = st?.pairing || {};
  const tooOld = state.connected && state.dienst?.online !== false && !st;
  const code = h("input.input.mono", { value: pairCode, placeholder: "1234-567-8901 oder MT:…", autocomplete: "off", inputmode: "text",
    oninput: (e) => (pairCode = e.target.value) });
  const pair = asked(() => {
    if (!pairCode.trim()) return toast("Erst den Kopplungscode eintragen");
    if (matterCmd("pair", { code: pairCode.trim() })) { toast("Wird gekoppelt – das dauert bis zu einer Minute"); pairCode = ""; }
  });
  return h("section.card", {},
    h("ol.pair-steps", {},
      h("li", {}, h("b", {}, "Alexa: "), "Geräte → Gerät öffnen → Zahnrad → „Andere Assistenten und Apps“ → „Neu hinzufügen“."),
      h("li", {}, h("b", {}, "Google Home: "), "Gerät öffnen → Zahnrad → „Verknüpfte Matter-Apps und -Dienste“ → „App verknüpfen“."),
      h("li", {}, "Andere Apps (SmartThings, Smart Life, Eve …): beim Gerät „Mit anderer App teilen“ bzw. „Kopplungsmodus“."),
      h("li", {}, "Den angezeigten Code hier eintragen:")),
    h("div.fields", {}, field("Kopplungscode", code, "11 Ziffern oder QR-Text. Gilt meist 15 Minuten.")),
    h("div.row", {},
      p.busy ? h("button.btn.primary", { disabled: true }, "Wird gekoppelt …") : h("button.btn.primary", { onclick: pair, disabled: !state.connected || tooOld }, "Koppeln")),
    p.ok && !p.busy && h("div.banner.ok", {}, h("div", {}, h("b", {}, "Gekoppelt"), `${p.ok} – steht jetzt in der Geräteliste.`)),
    p.error && !p.busy && h("div.banner.warn", {}, h("div", {}, h("b", {}, "Nicht gekoppelt"), p.error)),
    st?.error && !st.running && h("div.banner.warn", {}, h("div", {}, h("b", {}, "Matter-Steuerung startet nicht"), st.error)),
    tooOld && h("div.banner.warn", {}, h("div", {}, h("b", {}, "Zentrale aktualisieren"), "Das Zentrale-Programm kennt Matter-Geräte noch nicht. Auf der Zentrale: ", h("code", {}, "docker compose up -d --build dienst"))),
    h("p.hint", {}, "Neue Geräte zuerst in Alexa oder Google Home einrichten, denn Heimalarm koppelt nicht über Bluetooth. Thread-Geräte brauchen einen Thread-Router im Haus (z. B. Echo 4, Nest Hub, HomePod)."));
}

function groupsSection() {
  const add = asked(() => {
    const input = h("input.input", { placeholder: "z. B. Flur + Küche" });
    const close = dialog("Neue Gruppe", field("Name", input),
      h("div.row", {}, h("button.btn.primary", { onclick: () => { z2m("group/add", { friendly_name: input.value.trim() }); close(); } }, "Anlegen")));
  });
  const addMember = (g) => asked(() => {
    const opts = (state.zigbee || []).map((d) => [d.friendly_name, d.friendly_name]);
    let dev = opts[0]?.[0];
    const close = dialog(`Gerät zu „${g.friendly_name}“`, field("Gerät", select(opts, dev, (v) => (dev = v))),
      h("div.row", {}, h("button.btn.primary", { onclick: () => { z2m("group/members/add", { group: g.friendly_name, device: dev }); close(); } }, "Hinzufügen")));
  })();

  return h("section.card", {},
    h("div.card-head", {}, h("h2", {}, "Gruppen"), h("button.btn.small", { onclick: add }, "Neue Gruppe")),
    state.groups.length === 0 ? h("p.hint", {}, "Gruppen schalten mehrere Geräte auf einmal, z. B. alle Lampen im Flur.")
      : h("div.cards", {}, state.groups.map((g) => h("div.item", {},
          h("div.item-head", {}, h("b", {}, g.friendly_name), h("span.meta", {}, `${g.members?.length || 0} Geräte`)),
          h("p.meta", {}, (g.members || []).map((m) => (state.zigbee || []).find((d) => d.ieee_address === m.ieee_address)?.friendly_name || m.ieee_address).join(", ") || "noch leer"),
          h("div.row", {},
            h("button.btn.small", { onclick: () => setDevice(g.friendly_name, { state: "ON", transition: 1 }) }, "An"),
            h("button.btn.small", { onclick: () => setDevice(g.friendly_name, { state: "OFF", transition: 1 }) }, "Aus"),
            h("button.btn.small.ghost", { onclick: () => addMember(g) }, "Gerät hinzufügen"),
            h("button.btn.small.ghost.danger", { onclick: asked(async () => { if (await ask("Gruppe löschen?")) z2m("group/remove", { id: g.friendly_name }); }) }, "Löschen")),
        ))),
  );
}

function networkSection() {
  const map = state.networkmap;
  const byIeee = (id) => (state.zigbee || []).find((d) => d.ieee_address === id)?.friendly_name || (id === map?.nodes?.find((n) => n.type === "Coordinator")?.ieeeAddr ? "Zigbee-Stick" : id);
  return h("section.card", {},
    h("div.card-head", {}, h("h2", {}, "Netzwerkkarte"), h("button.btn.small", { onclick: () => { z2m("networkmap", { type: "raw", routes: false }); toast("Wird geladen – das dauert bis zu einer Minute"); } }, "Laden")),
    !map ? h("p.hint", {}, "Zeigt, welches Gerät über welches funkt und wie gut die Verbindung ist.")
      : h("table.table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Gerät"), h("th", {}, "über"), h("th", {}, "Signal"))),
          h("tbody", {}, (map.links || []).map((l) => h("tr", {}, h("td", {}, byIeee(l.source?.ieeeAddr || l.sourceIeeeAddr)), h("td", {}, byIeee(l.target?.ieeeAddr || l.targetIeeeAddr)), h("td", {}, `${l.linkquality ?? l.lqi ?? "–"} LQI`))))),
  );
}

/** Untertitel eines Thermostats: „20,5 °C · Soll 21,0 °C“ */
const heatSub = (st) => (st.system_mode === "off" ? `${fmtTemp(st.local_temperature)} · aus` : `${fmtTemp(st.local_temperature)} · Soll ${fmtTemp(st.occupied_heating_setpoint)}`);

// ── Seite: zwei Spalten (Geräte links, gewähltes Gerät rechts) ──
const isPhone = () => window.matchMedia("(max-width: 760px)").matches;
const keyOf = () => decodeURIComponent(location.hash.replace("#/", "").split("/").slice(1).join("/") || "");
const link = (key) => `#/geraete/${encodeURIComponent(key)}`;

function zigbeeSetupCard() {
  return h("section.card", {},
    h("h2", {}, "Zigbee2MQTT noch nicht gefunden"),
    h("ol.steps", {},
      h("li", {}, h("div", {}, "Zigbee-USB-Stick an die Zentrale stecken")),
      h("li", {}, h("div", {}, "Zentrale mit Zigbee starten", h("small", {}, h("code", {}, "docker compose --profile zigbee up -d")))),
      h("li", {}, h("div", {}, "Hier „Gerät anlernen“ drücken", h("small", {}, "Die Geräte erscheinen automatisch.")))),
    h("p.hint", {}, state.connected ? "Die Zentrale ist verbunden, meldet aber kein Zigbee2MQTT." : "Zuerst die Zentrale unter Einstellungen verbinden."));
}

const pane = (title, ico, color, ...body) => h("section.split-detail", { style: `--a:var(${color})` },
  h("a.split-back", { href: "#/geraete" }, icon("back"), "Licht & Geräte"),
  h("div.split-head", {}, h("span.ico.big", { style: `--a:var(${color})` }, icon(ico)), h("div", { style: "min-width:0" }, h("p.crumb", {}, "Licht & Geräte"), h("h2", {}, title))),
  ...body);

export function devicesView(rerender) {
  const zig = has.pi() && state.zigbee ? state.zigbee.filter((d) => d.type !== "Coordinator").toSorted((a, b) => a.friendly_name.localeCompare(b.friendly_name)) : [];
  const wifi = (shared().wifi || []).toSorted((a, b) => a.name.localeCompare(b.name));
  const mat = has.pi() ? (state.matter || []).toSorted((a, b) => a.name.localeCompare(b.name)) : [];
  const entries = [
    ...zig.map((d) => ({ key: `z:${d.friendly_name}`, kind: "zigbee", d })),
    ...mat.map((d) => ({ key: `m:${d.id}`, kind: "matter", d })),
    ...wifi.map((d) => ({ key: `w:${d.id}`, kind: "wifi", d })),
  ];
  const extra = [
    has.pi() && state.zigbee && { key: "gruppen", label: "Gruppen", sub: `${state.groups.length} Gruppen`, ico: "flow" },
    has.pi() && state.zigbee && { key: "netz", label: "Netzwerkkarte", sub: "Wer funkt über wen", ico: "net" },
    has.pi() && !state.zigbee && { key: "zigbee", label: "Zigbee einrichten", sub: "Stick an der Zentrale", ico: "tool" },
    has.pi() && { key: "matter", label: "Matter-Gerät hinzufügen", sub: "Aus Alexa, Google Home & Co.", ico: "link" },
  ].filter(Boolean);
  const key = keyOf();
  const all = [...entries.map((e) => e.key), ...extra.map((e) => e.key)];
  const current = all.includes(key) ? key : isPhone() ? null : all[0] || null;

  const joinLeft = Math.max(0, Math.round((state.permitJoinUntil - Date.now()) / 1000));
  const join = asked(() => { z2m("permit_join", { time: 120 }); toast("Gerät jetzt in den Kopplungsmodus versetzen (meist 5 s Knopf halten)"); });
  const addW = async () => { if (await requireAdmin()) addWifi(rerender); };

  const item = (e) => {
    let on = false, sub = "", color = "--c-net", ico = "bulb";
    if (e.kind === "zigbee") {
      const st = state.zstate[e.d.friendly_name] || {}, av = state.zavail[e.d.friendly_name];
      on = st.state === "ON";
      if (isTrv(props(e.d))) ico = "heat";
      sub = av === "offline" ? "nicht erreichbar" : ico === "heat" ? heatSub(st) : "state" in st ? (on ? "an" : "aus") : e.d.definition?.description || e.d.type;
      color = av === "offline" ? "--signal" : on || (ico === "heat" && st.system_mode !== "off") ? "--warn" : "--c-pc";
    } else if (e.kind === "matter") {
      const st = state.mstate[e.d.id] || {};
      on = st.state === "ON";
      if (e.d.caps?.heat) ico = "heat";
      sub = !e.d.online ? "nicht erreichbar" : ico === "heat" ? `${heatSub(st)} · Matter` : "state" in st ? `${on ? "an" : "aus"} · Matter` : "Matter";
      color = !e.d.online ? "--signal" : on || (ico === "heat" && st.system_mode !== "off") ? "--warn" : "--c-voice";
    } else {
      if (isHeat(e.d)) ico = "heat";
      sub = `${WIFI_TYPES[e.d.type]?.label || e.d.type} · ${e.d.host}`;
    }
    const name = e.kind === "zigbee" ? e.d.friendly_name : e.d.name;
    return h("a.split-item", { href: link(e.key), "aria-current": current === e.key ? "page" : null },
      h("span.ico", { style: `--a:var(${color})` }, icon(ico)),
      h("span.split-item-text", {}, h("b", {}, name), h("small" + (sub === "nicht erreichbar" ? ".warn" : ""), {}, sub)),
      h("span.chev", {}, icon("chev")));
  };

  const listPane = h("aside.split-list", {},
    h("h1", {}, "Licht & Geräte"),
    h("div.row", { style: "padding:0 4px 12px;gap:8px" },
      has.pi() && state.zigbee && (joinLeft > 0
        ? h("button.btn.small", { onclick: () => z2m("permit_join", { time: 0 }) }, `Anlernen · ${joinLeft} s · Stopp`)
        : h("button.btn.primary.small", { onclick: join }, "Gerät anlernen")),
      h("button.btn.small", { onclick: addW }, "WLAN-Gerät")),
    has.pi() && state.bridge === "offline" && h("p.split-warn", {}, "Zigbee2MQTT ist offline – Stick und Container auf der Zentrale prüfen."),
    h("nav.split-nav", { "aria-label": "Geräte" },
      entries.length === 0 ? h("p.hint", { style: "padding:8px 10px" }, has.pi() ? "Noch kein Gerät. Zigbee anlernen, ein WLAN-Gerät (Shelly, Hue, WLED, Tasmota, FRITZ!-Heizkörperregler) oder ein Matter-Gerät aus Alexa bzw. Google Home hinzufügen." : "Shelly, Philips Hue, WLED, Tasmota oder FRITZ!-Heizkörperregler direkt im Heimnetz hinzufügen. Zigbee gibt es mit Zentrale.")
        : entries.map(item),
      extra.length > 0 && h("div.split-grp", {}, "Mehr"),
      extra.map((x) => h("a.split-item", { href: link(x.key), "aria-current": current === x.key ? "page" : null },
        h("span.ico", { style: "--a:var(--c-app)" }, icon(x.ico)),
        h("span.split-item-text", {}, h("b", {}, x.label), h("small", {}, x.sub)),
        h("span.chev", {}, icon("chev"))))));

  let detail = null;
  const e = entries.find((x) => x.key === current);
  if (e?.kind === "zigbee") detail = pane(e.d.friendly_name, isTrv(props(e.d)) ? "heat" : "bulb", "--c-pc", h("section.card", {}, deviceCard(e.d)));
  else if (e?.kind === "matter") detail = pane(e.d.name, e.d.caps?.heat ? "heat" : "bulb", "--c-voice", h("section.card", {}, matterCard(e.d)));
  else if (e?.kind === "wifi") detail = pane(e.d.name, isHeat(e.d) ? "heat" : "bulb", "--c-net", h("section.card", {}, h("ul.rows", {}, wifiRow(e.d, shared().wifi || [], rerender))));
  else if (current === "gruppen") detail = pane("Gruppen", "flow", "--c-app", groupsSection());
  else if (current === "netz") detail = pane("Netzwerkkarte", "net", "--c-app", networkSection());
  else if (current === "matter") detail = pane("Matter-Gerät hinzufügen", "link", "--c-voice", matterAddCard());
  else if (current === "zigbee") detail = pane("Zigbee einrichten", "tool", "--c-app", zigbeeSetupCard());
  return h("div.split" + (detail ? ".has-detail" : ""), {}, listPane, detail || h("section.split-detail.empty-pane", {}, h("p.empty", {}, "Gerät links auswählen.")));
}
