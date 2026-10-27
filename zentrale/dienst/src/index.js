// Heimalarm-Dienst auf der Zentrale.
// Führt Routinen aus (auch wenn Handy und PC aus sind), nimmt Webhooks an,
// merkt sich Gerätezustände (für „Wieder da“), schreibt ein Zentralen-Protokoll
// und macht einen wöchentlichen Selbsttest.
import mqtt from "mqtt";
import { createLog } from "./log.js";
import { createRules } from "./rules.js";
import { startWebhook } from "./webhook.js";
import { startSelftest, SELFTEST_DEFAULTS } from "./selftest.js";
import { startVoice } from "./voice.js";
import { startHass } from "./hass.js";
import { startDivera } from "./divera.js";
import { startMatterCtl } from "./matterctl.js";

export const VERSION = "0.2.10";
const URL = process.env.MQTT_URL || "mqtt://mosquitto:1883";

const client = mqtt.connect(URL, {
  username: process.env.MQTT_USER || undefined,
  password: process.env.MQTT_PASS || undefined,
  clientId: "heimalarm-dienst",
  will: { topic: "heimalarm/dienst/status", payload: JSON.stringify({ online: false }), retain: true, qos: 1 },
});

const DEFAULTS = { voice: { enabled: true, openSec: 30, tests: false }, persons: [], routines: [], location: { lat: 51.16, lon: 10.45 }, vacation: false, readiness: { mode: "ready", until: null }, lockoutSec: 60, webhookSecret: "", hass: { enabled: false, prefix: "homeassistant", activeMin: 30, tests: false, buttons: true }, selftest: SELFTEST_DEFAULTS };

/** Gemeinsamer Zustand, den alle Module lesen. */
export const ctx = {
  client,
  config: structuredClone(DEFAULTS),
  devices: {},   // Zigbee: friendly_name -> letzter Zustand
  zigbee: [],    // Geräteliste von zigbee2mqtt/bridge/devices
  clients: {},   // Heimalarm-Apps: id -> { online, platform, name }
  esp: {},       // kennung -> { online }
  bridge: null,  // zigbee2mqtt/bridge/state
  version: VERSION,
};

const log = createLog(client);
const rules = createRules(ctx, log);
const voice = startVoice(ctx, log);
ctx.matter = startMatterCtl(ctx, log, (name, s) => rules.onDevice(name, s));
const hass = startHass(ctx, log);
ctx.divera = startDivera(ctx, log);
let rawShared = {};
/** Routinen-Aktion „Bereitschaft setzen“: gemeinsame Daten ändern (wie die App, verschachtelte Felder komplett). */
ctx.updateShared = (patch) => {
  rawShared = { ...rawShared, ...patch };
  client.publish("heimalarm/config/shared", JSON.stringify(rawShared), { retain: true, qos: 1 });
};
ctx.onAlarmAccepted = (e) => { voice.onAlarm(e).catch(() => {}); hass.onAlarm(e); };

client.on("connect", () => {
  client.publish("heimalarm/dienst/status", JSON.stringify({ online: true, version: VERSION, ts: Date.now() }), { retain: true, qos: 1 });
  client.subscribe([
    "heimalarm/config/shared", "heimalarm/clients/+", "heimalarm/cmd/#", "heimalarm/ping",
    "alarm/+", "alarm/+/status", "zigbee2mqtt/bridge/devices", "zigbee2mqtt/bridge/state", "zigbee2mqtt/+",
  ], { qos: 1 });
  log.info("Dienst gestartet", `Version ${VERSION}`);
  setTimeout(() => { voice.onConfig(); hass.sync(); ctx.matter.boot(); }, 1500); // ohne gespeicherte Konfiguration trotzdem starten
});

client.on("message", (topic, buf, packet) => {
  const msg = buf.toString();
  const parts = topic.split("/");
  try {
    if (topic === "heimalarm/config/shared") {
      rawShared = JSON.parse(msg || "{}");
      ctx.config = { ...structuredClone(DEFAULTS), ...rawShared };
      rules.reschedule();
      voice.onConfig();
      hass.sync();
    } else if (parts[0] === "heimalarm" && parts[1] === "clients") {
      if (msg) ctx.clients[parts[2]] = JSON.parse(msg);
      else delete ctx.clients[parts[2]];   // Gerät in der App entfernt
    } else if (topic === "heimalarm/ping") {
      client.publish("heimalarm/pong", JSON.stringify({ id: msg, version: VERSION, ts: Date.now(), bridge: ctx.bridge, zigbee: ctx.zigbee.length }));
    } else if (parts[0] === "heimalarm" && parts[1] === "cmd") {
      const cmd = parts.slice(2).join("/"), data = msg ? JSON.parse(msg) : {};
      if (parts[2] === "voice") voice.command(parts.slice(3).join("/"), data);
      else if (parts[2] === "matter") ctx.matter.command(parts.slice(3).join("/"), data);
      else if (parts[2] === "divera") ctx.divera.command(parts.slice(3).join("/"), data);
      else rules.command(cmd, data);
      if (cmd === "restore") hass.onRestore();
    } else if (parts[0] === "alarm" && parts.length === 3 && parts[2] === "status") {
      ctx.esp[parts[1]] = { online: msg === "online", ts: Date.now() };
      hass.onEsp();
    } else if (parts[0] === "alarm" && parts.length === 2 && !packet.retain) {
      rules.onAlarm(parts[1], parseAlarm(msg));
    } else if (topic === "zigbee2mqtt/bridge/devices") {
      ctx.zigbee = JSON.parse(msg).filter((d) => d.type !== "Coordinator");
    } else if (topic === "zigbee2mqtt/bridge/state") {
      ctx.bridge = msg.startsWith("{") ? JSON.parse(msg).state : msg;
    } else if (parts[0] === "zigbee2mqtt" && parts.length === 2 && parts[1] !== "bridge") {
      ctx.devices[parts[1]] = { ...ctx.devices[parts[1]], ...JSON.parse(msg) };
      rules.onDevice(parts[1], ctx.devices[parts[1]]);
    }
  } catch (e) {
    log.warn("Nachricht nicht lesbar", `${topic}: ${e.message}`);
  }
});

/** "ALARM" vom ESP32 oder JSON { keyword, unit, test, probe, source } */
export function parseAlarm(msg) {
  const t = msg.trim();
  if (/^alarm$/iu.test(t)) return { source: "ESP32" };
  if (t.startsWith("{")) return JSON.parse(t);
  return null;
}

startWebhook(ctx, log);
startSelftest(ctx, log);
