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
    { friendly_name: "Taster Flur", type: "EndDevice", definition: { description: "Funk-Taster", exposes: [{ type: "enum", property: "action", label: "Action", access: 1, values: ["single", "double", "hold"] }, { type: "numeric", property: "battery", access: 1 }] } },
    { friendly_name: "Heizung Wohnzimmer", type: "EndDevice", definition: { description: "Sonoff TRVZB Heizkörperthermostat", exposes: [{ type: "climate", features: [{ property: "occupied_heating_setpoint" }, { property: "local_temperature" }, { property: "system_mode" }] }, { property: "battery" }] } },
  ];
  state.zstate = { ...state.zstate, "Heizung Wohnzimmer": { occupied_heating_setpoint: 20.5, local_temperature: 19.8, system_mode: "heat", battery: 86 } };
  state.zavail = { ...state.zavail, "Heizung Wohnzimmer": "online" };
  log("ok", "Mit Zentrale verbunden", "ws://192.168.1.10:9001");
  log("alarm", "Alarm", "ESP32 · alarm/ich");
  log("action", "„Ich fahre“ → Ruhezustand", "wird ausgeführt");
  log("warn", "ESP32 „kollege“ offline");
}

/** Divera-Beispiel fürs Dashboard (?demo&divera): ein nachgebauter /pull/all-Stand, durch den echten Parser. */
export async function fillDiveraDemo() {
  const { divera } = await import("../core/divera.js");
  const { parseBoard } = await import("../core/divera-board.js");
  const s = Math.floor(Date.now() / 1000), day = 86400;
  const consumer = Object.fromEntries(["Anna Berg", "Ben Koch", "Clara Wolf", "David Roth", "Eva Lang", "Felix Hahn", "Greta Vogt", "Hans Bauer"]
    .map((n, i) => [100 + i, { stdformat_name: n, qualifications: [1 + (i % 3)] }]));
  const pull = {
    ucr: { 100: { new_alarms: 0, new_messages: 2 } },
    status: { status_id: 1, status_set_date: s - 3 * 3600, note: "" },
    cluster: {
      name: "FF Musterstadt", shortname: "FF MS", consumer,
      status: { 1: { id: 1, name: "Verfügbar", color_hex: "4cc287" }, 2: { id: 2, name: "Bedingt", color_hex: "e9a945" }, 3: { id: 3, name: "Nicht verfügbar", color_hex: "e5432f" } },
      statussorting_statusgeber: [1, 2, 3],
      qualification: { 1: { name: "Atemschutz", shortname: "AGT" }, 2: { name: "Maschinist", shortname: "MA" }, 3: { name: "Gruppenführer", shortname: "GF" } },
      vehicle: { 7: { id: 7, name: "HLF 20", shortname: "HLF 20", fmsstatus_id: 2 }, 8: { id: 8, name: "DLK 23", shortname: "DLK 23", fmsstatus_id: 6 }, 9: { id: 9, name: "MTW", shortname: "MTW", fmsstatus_id: 3 } },
      address: { street: "Wachenweg 1", zip: "12345", city: "Musterstadt", lat: 50.11, lng: 8.68 },
    },
    monitor: { 1: { 1: { all: 14 }, 2: { all: 5 }, 3: { all: 9 } } },
    news: { sorting: [31, 32, 33], items: {
      31: { id: 31, title: "Neue Dienstanweisung Rückwärtsfahren", text: "Ab sofort gilt: Rückwärtsfahren nur mit Einweiser.<br><br>Das betrifft alle Fahrzeuge, auch auf dem Hof. Bitte beim nächsten Übungsabend gemeinsam durchgehen.<br>Danke, eure Wehrführung", date: s - 2 * 3600, author_id: 103, new: true, count_read: 11, count_recipients: 32 },
      32: { id: 32, title: "Sommerfest – wer hilft mit?", text: "Am 14. findet unser Sommerfest statt. Wir brauchen Helfer für Aufbau, Grill und Kasse.", date: s - day, author_id: 101, survey: true, count_read: 25, count_recipients: 32,
        surveys: [{ id: 5, title: "Wobei hilfst du?", multiple_answers: true, access_count: true, answerSorting: [51, 52, 53],
          answers: [{ id: 51, title: "Aufbau (ab 9 Uhr)", answeredcount: 6, answeredlist: [100, 101] }, { id: 52, title: "Grill", answeredcount: 4, answeredlist: [] }, { id: 53, title: "Kasse", answeredcount: 2, answeredlist: [] }] }] },
      33: { id: 33, title: "Atemschutz-Wartung", text: "Die Geräte sind bis Freitag in der Wartung.", date: s - 3 * day, author_id: 104 },
    } },
    events: { sorting: [41, 42], items: {
      41: { id: 41, title: "Übungsabend: Technische Hilfe", text: "Thema: Rettung aus PKW. Treffpunkt Gerätehaus, Einsatzkleidung mitbringen.", start: s + day + 3600, end: s + day + 3 * 3600, address: "Gerätehaus", participation: 0, answerable: true, response_type: 2, participationcount: { 1: 12, 2: 3, 3: 4 }, new: true },
      42: { id: 42, title: "Jahreshauptversammlung", text: "", start: s + 9 * day, end: s + 9 * day + 7200, address: "Bürgerhaus", participation: 1, answerable: true, response_type: 1, participationcount: { 1: 21, 3: 2 } },
    } },
    alarm: { sorting: [61], items: { 61: { id: 61, title: "TH 1 Baum auf Straße", address: "Waldweg 3, Musterstadt", text: "Baum blockiert Fahrbahn komplett.", date: s - 2 * day, closed: true, count_recipients: 32, count_read: 28,
      ucr_answered: { 1: { 100: { ts: s - 2 * day + 90 }, 102: { ts: s - 2 * day + 140 } }, 3: { 105: { ts: s - 2 * day + 60, note: "Nachtschicht" } } }, ucr_addressed: [100, 101, 102, 103, 104, 105] } } },
    message_channel: { items: { 1: { id: 1, title: "Allgemein" }, 2: { id: 2, title: "Atemschutz" } } },
    message: { items: {
      71: { id: 71, message_channel_id: 1, author_id: 101, text: "Wer hat den Schlüssel vom MTW?", ts_create: s - 5 * 3600 },
      72: { id: 72, message_channel_id: 1, author_id: 100, text: "Hängt wieder am Brett.", ts_create: s - 4 * 3600 },
      73: { id: 73, message_channel_id: 2, author_id: 104, text: "Belastungsübung am Samstag, 10 Uhr.", ts_create: s - day },
    } },
  };
  const vehicles = [{ id: 7, name: "HLF 20", fmsstatus: 2, fmsstatus_ts: s - 5400, crew: [{ id: 100 }, { id: 102 }, { id: 106 }] }, { id: 9, name: "MTW", fmsstatus: 3, fmsstatus_ts: s - 600, fmsstatus_note: "Materialfahrt", crew: [] }];
  divera.board = parseBoard(pull, null, { vehicles });
  divera.board.denied = { vehicles: false, shifts: false };
  divera.ok = true; divera.current = "1";
}
