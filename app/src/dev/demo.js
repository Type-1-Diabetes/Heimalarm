// Beispieldaten für die Entwicklung (nur mit `npm run dev` und ?demo).
import { log } from "../core/log.js";

export function fillDemo(state) {
  const now = Date.now();
  state.connected = true;
  state.dienst = { online: true, version: "0.2.8" };   // älter als passend → Hinweis „Zentrale aktualisieren“
  import("../core/update.js").then(({ update }) => { update.available = { version: "0.2.0", page: "#", url: "#", notes: "Updates direkt in der App" }; });
  import("../core/divera.js").then(({ divera }) => { divera.ok = true; divera.current = "1"; divera.loading = true; });
  state.voice = { enabled: true, running: true, commissioned: false, qr: "MT:Y.K90SO527NHQL71V00", manual: "36360023599", fabrics: [], sensors: ["Heimalarm Einsatz", "Einsatz Daniel", "Einsatz Kollege"] };
  state.matter = [{ id: "1-1", node: "1", name: "Wohnzimmer Stehlampe", vendor: "Nanoleaf", product: "Essentials A19", online: true, caps: { onoff: true, level: true, ct: true } }, { id: "2-1", node: "2", name: "Kaffeemaschine", vendor: "Eve", product: "Energy", online: true, caps: { onoff: true } }, { id: "3-1", node: "3", name: "Heizung Bad", vendor: "Eve", product: "Thermo", online: true, caps: { heat: true } }];
  state.mstate = { "1-1": { state: "ON", brightness: 180, color_temp: 320 }, "2-1": { state: "OFF" }, "3-1": { occupied_heating_setpoint: 22, local_temperature: 21.3, system_mode: "heat" } };
  state.matterStatus = { running: true, error: "", pairing: { busy: false } };
  state.devices = {
    ich: { online: true, since: now - 3 * 3600e3, ledType: "rgb", ledOn: true, ledLevel: 40, ledMode: "Alles", rssi: -58, uptime: 3 * 86400 + 4 * 3600, ip: "192.168.1.42", version: "2026.10.0" },
    kollege: { online: false, since: now - 25 * 60e3, rssi: -81, uptime: 5400, ip: "192.168.1.57", version: "2026.10.0" },
  };
  state.clients = {
    a: { name: "PC Arbeitszimmer", platform: "Windows", version: "0.1.0", online: true, ts: now },
    b: { name: "Pixel 8", platform: "Android", version: "0.1.0", online: true, ts: now - 60e3 },
    c: { name: "Laptop", platform: "Windows", version: "0.1.0", online: false, ts: now - 2 * 86400e3 },
  };
  state.zigbee = [
    { friendly_name: "Flur Decke", type: "Router", definition: { description: "LED-Lampe E27" } },
    { friendly_name: "Küche Stecker", type: "Router", definition: { description: "Zwischenstecker" } },
    { friendly_name: "Heizung Wohnzimmer", type: "EndDevice", definition: { description: "Sonoff TRVZB Heizkörperthermostat", exposes: [{ type: "climate", features: [{ property: "occupied_heating_setpoint" }, { property: "local_temperature" }, { property: "system_mode" }] }, { property: "battery" }] } },
  ];
  state.zstate = { ...state.zstate, "Heizung Wohnzimmer": { occupied_heating_setpoint: 20.5, local_temperature: 19.8, system_mode: "heat", battery: 86 } };
  state.zavail = { ...state.zavail, "Heizung Wohnzimmer": "online" };
  log("ok", "Mit Zentrale verbunden", "ws://192.168.1.10:9001");
  log("alarm", "Alarm", "ESP32 · alarm/ich");
  log("action", "„Ich fahre“ → Ruhezustand", "wird ausgeführt");
  log("warn", "ESP32 „kollege“ offline");
}
