// Nur Entwicklung: simuliert ESP32 und Zigbee2MQTT, um App und Dienst ohne Hardware zu prüfen.
//   node tools/sim.js [mqtt://127.0.0.1:1883]
// Befehle über stdin:  alarm [kennung]   – Alarm auslösen
import mqtt from "mqtt";
import { createInterface } from "node:readline";

const c = mqtt.connect(process.argv[2] || "mqtt://127.0.0.1:1883", { clientId: "heimalarm-sim" });
const devices = [
  { friendly_name: "Flur Decke", ieee_address: "0x01", type: "Router", definition: { description: "LED-Lampe E27, dimmbar, Farbe", exposes: [{ type: "light", features: [{ property: "state" }, { property: "brightness" }, { property: "color_temp" }, { property: "color" }] }, { property: "effect" }] } },
  { friendly_name: "Schlafzimmer", ieee_address: "0x02", type: "Router", definition: { description: "LED-Panel, warm/kalt", exposes: [{ type: "light", features: [{ property: "state" }, { property: "brightness" }, { property: "color_temp" }] }] } },
  { friendly_name: "Küche Stecker", ieee_address: "0x03", type: "Router", definition: { description: "Zwischenstecker", exposes: [{ type: "switch", features: [{ property: "state" }] }] } },
  { friendly_name: "Taster Bett", ieee_address: "0x04", type: "EndDevice", definition: { description: "Funk-Taster", exposes: [{ property: "action" }, { property: "battery" }] } },
];
const states = {
  "Flur Decke": { state: "OFF", brightness: 120, color_temp: 320, linkquality: 168 },
  "Schlafzimmer": { state: "OFF", brightness: 40, color_temp: 400, linkquality: 120 },
  "Küche Stecker": { state: "ON", linkquality: 92 },
  "Taster Bett": { battery: 87, linkquality: 64 },
};

c.on("connect", () => {
  const r = { retain: true };
  c.publish("alarm/ich/status", "online", r);
  c.publish("alarm/ich/sensor/wifi_signal/state", "-58", r);
  c.publish("alarm/ich/sensor/uptime/state", "273600", r);
  c.publish("alarm/ich/text_sensor/ip/state", "192.168.1.42", r);
  c.publish("alarm/ich/text_sensor/version/state", "2026.10.0", r);
  c.publish("alarm/ich/number/min_duration/state", "50", r);
  c.publish("zigbee2mqtt/bridge/state", JSON.stringify({ state: "online" }), r);
  c.publish("zigbee2mqtt/bridge/devices", JSON.stringify([{ type: "Coordinator", ieee_address: "0x00", friendly_name: "Coordinator" }, ...devices]), r);
  c.publish("zigbee2mqtt/bridge/groups", JSON.stringify([{ id: 1, friendly_name: "Flur + Küche", members: [{ ieee_address: "0x01" }, { ieee_address: "0x03" }] }]), r);
  for (const [n, s] of Object.entries(states)) {
    c.publish(`zigbee2mqtt/${n}`, JSON.stringify(s), r);
    c.publish(`zigbee2mqtt/${n}/availability`, JSON.stringify({ state: n === "Taster Bett" ? "offline" : "online" }), r);
  }
  c.subscribe(["zigbee2mqtt/+/set", "zigbee2mqtt/bridge/request/#", "alarm/+/number/+/command"]);
  console.log("Simulation bereit. Befehl: alarm [kennung]");
});

c.on("message", (topic, buf) => {
  const p = topic.split("/");
  const msg = buf.toString();
  console.log("←", topic, msg);
  if (p[0] === "zigbee2mqtt" && p[2] === "set") {
    const s = (states[p[1]] ||= {});
    const set = JSON.parse(msg);
    if (set.state === "TOGGLE") set.state = s.state === "ON" ? "OFF" : "ON";
    Object.assign(s, set);
    c.publish(`zigbee2mqtt/${p[1]}`, JSON.stringify(s), { retain: true });
  } else if (topic === "zigbee2mqtt/bridge/request/networkmap") {
    c.publish("zigbee2mqtt/bridge/response/networkmap", JSON.stringify({ status: "ok", data: { value: { nodes: [{ ieeeAddr: "0x00", type: "Coordinator" }], links: [
      { source: { ieeeAddr: "0x01" }, target: { ieeeAddr: "0x00" }, linkquality: 168 },
      { source: { ieeeAddr: "0x02" }, target: { ieeeAddr: "0x01" }, linkquality: 120 },
      { source: { ieeeAddr: "0x04" }, target: { ieeeAddr: "0x02" }, linkquality: 64 },
    ] } } }));
  } else if (p[0] === "alarm" && p[2] === "number") {
    c.publish(`alarm/${p[1]}/number/${p[3]}/state`, msg, { retain: true });
  }
});

createInterface({ input: process.stdin }).on("line", (l) => {
  const [cmd, who = "ich"] = l.trim().split(/\s+/u);
  if (cmd === "alarm") c.publish(`alarm/${who}`, "ALARM");
});
