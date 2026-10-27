// Verbindung zur Zentrale (Mosquitto, WebSocket-Listener). Alle Topics siehe Context.md.
import mqtt from "mqtt";
import { settings, set, isConfigured } from "./settings.js";
import { emit, on } from "./events.js";
import { log } from "./log.js";
import { platformName } from "./platform.js";
import { receive as receiveShared, bindPublisher } from "./shared.js";
import { statsEntries, mergeEinsaetze, fingerprint } from "./stats.js";

export const APP_VERSION = import.meta.env.PACKAGE_VERSION || "0.0.0";

let client = null;

/** Live-Zustand für die Ansichten. */
export const state = {
  connected: false,
  devices: {},     // ESP32: kennung -> { online, since, ip, rssi, uptime, version, lastSeen, contact, invert, testing }
  clients: {},     // Apps: id -> { name, platform, version, online, ts, mac }
  zigbee: null,    // Zigbee2MQTT-Geräteliste (null = kein Zigbee2MQTT)
  zstate: {},      // Zigbee: friendly_name -> letzter Zustand
  zavail: {},      // Zigbee: friendly_name -> "online" | "offline"
  groups: [],      // Zigbee-Gruppen
  bridge: null,    // Zigbee2MQTT: "online" | "offline"
  permitJoinUntil: 0,
  networkmap: null,
  dienst: null,    // Zentrale-Programm: { online, version }
  diveraKeys: {},  // wer seinen Divera-Schlüssel auf der Zentrale hat: { kennung: { ok, error } } (ohne Schlüssel)
  report: null,    // I4 – letzter Selbsttest
  zlog: [],        // F5 – Protokoll der Zentrale
  pong: null,      // I3 – Antwort auf Verbindungstest
  voice: null,     // Matter-Bridge für Alexa / Google Home: { running, qr, manual, commissioned, fabrics, sensors, error }
  matter: null,    // Matter-Geräte der Zentrale: [{ id, node, name, vendor, product, online, caps }] (null = Dienst meldet nichts)
  mstate: {},      // Matter: id -> { state, brightness 0–254, color_temp }
  matterStatus: null, // Matter-Steuerung: { running, error, pairing: { busy, ok, error, at } }
};

const clientTopic = () => `heimalarm/clients/${settings().device.id}`;
const presence = (online) => JSON.stringify({
  name: settings().device.name || platformName, platform: platformName, version: APP_VERSION,
  online, ts: Date.now(), mac: settings().pc.wolMac || undefined,
});

/** Fehlertext der Zentrale in verständliche Sprache mit Hinweis übersetzen. */
export function explainMqttError(msg = "") {
  const m = String(msg);
  if (/not authori[sz]ed|bad user ?name or password|code 4|code 5/i.test(m)) return ["Benutzer oder Passwort falsch", "Unter Einstellungen → Zentrale Benutzer „heimalarm“ und das MQTT_PASSWORD der Zentrale prüfen."];
  if (/timeout|timed out/i.test(m)) return ["Zentrale antwortet nicht", "Ist die Zentrale an und im selben WLAN? IP-Adresse und Port 9001 prüfen."];
  if (/refused|ECONNREFUSED|1006|websocket/i.test(m)) return ["Verbindung abgelehnt", "Läuft der Container mosquitto? Stimmt der Port (9001 = WebSocket)?"];
  if (/ENOTFOUND|getaddrinfo|resolve/i.test(m)) return ["Adresse nicht gefunden", "Die Adresse der Zentrale ist falsch geschrieben oder nicht erreichbar."];
  return [m || "unbekannter Fehler", "Unter Test & Diagnose den Verbindungstest starten."];
}

let lastError = "";
let attempts = 0;
// Feste Sitzung: nach dem Wiederverbinden liefert die Zentrale verpasste Nachrichten nach.
// Alarme aus einer kurzen Lücke zählen, alte (PC war lange aus) nur ins Protokoll.
const REPLAY_MAX_GAP = 120e3;
let downSince = 0;          // seit wann getrennt (0 = verbunden oder unbekannt, z. B. nach App-Start)
let replayUntil = 0, replayGap = Infinity;

export function connect() {
  disconnect();
  const b = settings().broker;
  if (!b.host || !isConfigured()) return;
  const url = `${b.tls ? "wss" : "ws"}://${b.host}:${b.port}`;
  lastError = ""; attempts = 0;
  log("info", "Verbinde mit der Zentrale …", `${url} · Benutzer ${b.user || "(keiner)"}`);
  client = mqtt.connect(url, {
    username: b.user || undefined,
    password: b.pass || undefined,
    // Feste ID + clean: false = feste Sitzung: Mosquitto hebt QoS-1-Alarme während einer Lücke auf und liefert sie nach.
    clientId: `heimalarm-${settings().device.id}`,
    clean: false,
    reconnectPeriod: 3000,
    connectTimeout: 8000,
    // Ping-Takt mit normalen Timern. Standard („auto“) nutzt im Browser einen Worker aus einer blob:-URL –
    // den blockiert unsere CSP (script-src 'self'), der Ping kam nie an und die Zentrale trennte alle 1,5 × keepalive.
    timerVariant: "native",
    keepalive: 60,
    will: { topic: clientTopic(), payload: presence(false), retain: true, qos: 1 },
  });
  bindPublisher((t, m, o) => client?.publish(t, m, o));

  client.on("connect", (ack) => {
    state.connected = true;
    replayGap = downSince ? Date.now() - downSince : Infinity;
    replayUntil = ack?.sessionPresent ? Date.now() + 2000 : 0;
    const gap = downSince ? Math.round((Date.now() - downSince) / 1000) : 0;
    downSince = 0;
    client.subscribe(["alarm/#", "heimalarm/#", "zigbee2mqtt/#"], { qos: 1 });
    client.publish(clientTopic(), presence(true), { retain: true, qos: 1 });
    emit("mqtt-ready");
    log("ok", gap ? `Wieder verbunden nach ${gap} s` : "Mit Zentrale verbunden", attempts > 1 ? `${url} · nach ${attempts} Versuchen` : url);
    lastError = ""; attempts = 0;
    emit("conn", state);
  });
  client.on("reconnect", () => {
    attempts++;
    // Nicht jeden Versuch protokollieren: erster, dann jeder zehnte
    if (attempts === 1 || attempts % 10 === 0) log("info", `Neuer Verbindungsversuch zur Zentrale (${attempts})`, url);
  });
  client.on("close", () => {
    if (state.connected) {
      downSince = Date.now();
      const [why, hint] = lastError ? explainMqttError(lastError) : ["Verbindung beendet", "Kurze Trennung, Heimalarm verbindet automatisch neu. Häufig? Unter Test & Diagnose prüfen."];
      log("warn", "Verbindung zur Zentrale getrennt", `${why} · ${hint}`);
    }
    state.connected = false;
    emit("conn", state);
  });
  client.on("error", (err) => {
    const msg = err?.message || String(err);
    if (msg !== lastError) {
      const [why, hint] = explainMqttError(msg);
      log("warn", `Zentrale: ${why}`, `${hint} (${msg})`);
    }
    lastError = msg;
    emit("conn-error", msg);
  });
  client.on("message", (topic, payload, packet) => {
    try { handle(topic, payload.toString().trim(), packet.retain); }
    catch (e) { console.warn("MQTT", topic, e); }
  });
}

/** Seit wann die Zentrale getrennt ist (0 = verbunden oder unbekannt). */
export const offlineSince = () => downSince;

/** Letzter Fehler der Zentrale-Verbindung (für Status und Check). */
export const mqttLastError = () => lastError;

const device = (who) => (state.devices[who] ||= { online: null, since: Date.now() });

function handle(topic, msg, retained) {
  const p = topic.split("/");
  if (p[0] === "heimalarm") return handleHeimalarm(p, msg);
  if (p[0] === "zigbee2mqtt") return handleZigbee(p, msg);
  if (p[0] !== "alarm" || !p[1]) return;

  const who = p[1];
  if (p.length === 2) {
    if (retained) return; // alte Alarme beim Verbinden nicht erneut auslösen
    const data = parseAlarm(msg);
    if (data && Date.now() < replayUntil) {   // aus der Lücke nachgeliefert
      if (replayGap > REPLAY_MAX_GAP) { log("info", "Alter Alarm aus der Verbindungslücke – nicht ausgelöst", `alarm/${who} · Lücke ${Number.isFinite(replayGap) ? Math.round(replayGap / 1000) + " s" : "unbekannt (App neu gestartet)"}`); return; }
      log("warn", "Alarm aus der Verbindungslücke nachgeliefert", `alarm/${who} · ${Math.round(replayGap / 1000)} s getrennt`);
    }
    if (data) emit("alarm-in", { who, ts: Date.now(), ...data });
    return;
  }
  if (p.length === 3 && p[2] === "event") {   // Rückalarm / Alarmende (aPager-Webhook)
    try { emit("alarm-event", { who, ts: Date.now(), ...JSON.parse(msg) }); } catch { /* nicht lesbar */ }
    return;
  }
  const d = device(who);
  d.lastSeen = Date.now();
  if (p[2] === "status") {
    const online = msg === "online";
    if (d.online !== online) {
      d.online = online; d.since = Date.now(); d.warned = false;
      log(online ? "ok" : "warn", `ESP32 „${who}“ ${online ? "online" : "offline"}`);
    }
  } else if (p.at(-1) === "state") {
    const id = p.at(-2);
    if (id === "wifi_signal") d.rssi = Number(msg);
    else if (id === "uptime") {
      const n = Number(msg);
      // Laufzeit springt zurück → ESP32 ist neu gestartet (z. B. Strom weg, Kabel auf RST statt auf dem Kontakt-Pin)
      if (!retained && d.uptime != null && n < d.uptime) log("warn", `ESP32 „${who}“ neu gestartet`, "Strom oder WLAN kurz weg? Steckt ein Kabel versehentlich auf RST?");
      d.uptime = n;
    }
    else if (id === "kontakt") {
      const closed = msg === "ON";
      if (!retained && d.testing && d.contact !== undefined && d.contact !== closed) log("info", `Kontakt-Test „${who}“: ${closed ? "geschlossen" : "offen"}`);
      d.contact = closed; d.contactTs = Date.now();
    }
    else if (id === "alarm_bei_offen") d.invert = msg === "ON";
    else if (id === "kontakt_test") d.testing = msg === "ON";
    // Status-LED (esp32/led/logik.yaml)
    else if (id === "led_typ") d.ledType = msg;            // "rgb" | "einfarbig"
    else if (id === "led") d.ledOn = msg === "ON";
    else if (id === "led_ruhelicht") d.ledIdle = msg === "ON";
    else if (id === "led_helligkeit") d.ledLevel = Number(msg);
    else if (id === "led_modus") d.ledMode = msg;
    else if (id === "ip") d.ip = msg;
    else if (id === "version") d.version = msg;
    else if (id === "heimalarm_firmware") d.fw = Number(msg) || 0;
    else if (id === "min_duration") d.minDuration = Number(msg);
  }
  emit("devices", state);
}

/** "ALARM" vom ESP32 oder JSON { source, keyword, unit, test, probe } */
export function parseAlarm(msg) {
  if (/^alarm$/iu.test(msg)) return { source: "ESP32" };
  if (msg.startsWith("{")) { try { return { source: "Zentrale", ...JSON.parse(msg) }; } catch { return null; } }
  return null;
}

function handleHeimalarm(p, msg) {
  const json = () => JSON.parse(msg || "null");
  if (p[1] === "clients" && p[2]) {
    if (!msg) { delete state.clients[p[2]]; emit("devices", state); return; }   // Gerät aus der Liste entfernt
    state.clients[p[2]] = json();
    // Verspätetes "offline" einer alten Verbindung (Last Will) überschreiben
    if (p[2] === settings().device.id && state.connected && !state.clients[p[2]]?.online) {
      client.publish(clientTopic(), presence(true), { retain: true, qos: 1 });
    }
  }
  else if (p[1] === "config" && p[2] === "shared") return receiveShared(msg);
  else if (p[1] === "cmd" && p[3] && p[3] === settings().device.id) return deviceCommand(p[2], msg);
  else if (p[1] === "einsaetze" && p[2] === settings().alarm.me) return receiveEinsaetze(msg);
  else if (p[1] === "answer" && p[2]) { try { emit("peer-event", { ...json(), via: "zentrale" }); } catch { /* unlesbar */ } return; }
  else if (p[1] === "devlog" && p[2]) { try { emit("remote-log", { id: p[2], data: json() }); } catch { /* unlesbar */ } return; }
  else if (p[1] === "dienst" && p[2] === "status") state.dienst = json();
  else if (p[1] === "report") state.report = json();
  else if (p[1] === "voice" && p[2] === "status") state.voice = json();
  else if (p[1] === "matter" && p[2] === "devices") state.matter = json() || [];
  else if (p[1] === "matter" && p[2] === "state") state.mstate = json() || {};
  else if (p[1] === "matter" && p[2] === "status") state.matterStatus = json();
  else if (p[1] === "divera" && p[2] === "keys") { state.diveraKeys = json() || {}; emit("divera", null); }
  else if (p[1] === "pong") state.pong = { ...json(), at: Date.now() };
  else if (p[1] === "log" && p[2] === "recent") state.zlog = json() || [];
  else if (p[1] === "log" && !p[2]) { state.zlog.unshift(json()); state.zlog.length = Math.min(state.zlog.length, 200); }
  else return;
  emit("devices", state);
}

// ── Einsatz-Logbuch über die Zentrale abgleichen (retained je Kennung) ──
const einsaetzeTopic = () => `heimalarm/einsaetze/${settings().alarm.me}`;
let einsaetzeTimer;
function publishEinsaetze() {
  if (!client || !state.connected || settings().sync?.enabled === false || !settings().features?.logbuch) return;
  client.publish(einsaetzeTopic(), JSON.stringify(statsEntries()), { retain: true, qos: 1 });
}
function receiveEinsaetze(msg) {
  if (settings().sync?.enabled === false) return;
  let remote; try { remote = JSON.parse(msg || "[]"); } catch { return; }
  const theirs = Array.isArray(remote) ? JSON.stringify(remote.map((e) => [e.id, e.edited || 0, e.answer || "", (e.sources || []).length, (e.units || []).length, e.recall || 0, e.endTs || 0])) : "";
  mergeEinsaetze(remote);
  // Hat dieses Gerät mehr oder Neueres, den zusammengeführten Stand zurückschreiben
  if (fingerprint() !== theirs) { clearTimeout(einsaetzeTimer); einsaetzeTimer = setTimeout(publishEinsaetze, 1500 + Math.random() * 1500); }
}
on("sync-dirty", (sec) => { if (sec === "einsaetze") { clearTimeout(einsaetzeTimer); einsaetzeTimer = setTimeout(publishEinsaetze, 1000); } });

/** Befehle an genau dieses Gerät: heimalarm/cmd/test/<id>, heimalarm/cmd/rename/<id> */
function deviceCommand(cmd, msg) {
  if (cmd === "test") { log("info", "Testalarm von einem anderen Gerät"); emit("test-request"); }
  else if (cmd === "rename") {
    const name = String(JSON.parse(msg || "{}").name || "").trim().slice(0, 40);
    if (!name) return;
    set("device.name", name, { silent: true });
    client?.publish(clientTopic(), presence(true), { retain: true, qos: 1 });
    log("info", `Gerät umbenannt in „${name}“`);
  }
}

/** Gerät an der Zentrale verwalten: Testalarm, umbenennen, aus der Liste entfernen. */
export const testDevice = (id) => publish(`heimalarm/cmd/test/${id}`, {});
export const renameDevice = (id, name) => publish(`heimalarm/cmd/rename/${id}`, { name });
export const forgetDevice = (id) => { const ok = publish(`heimalarm/clients/${id}`, "", { retain: true }); if (ok) delete state.clients[id]; return ok; };

function handleZigbee(p, msg) {
  const json = () => (msg.startsWith("{") || msg.startsWith("[") ? JSON.parse(msg) : msg);
  if (p[1] === "bridge") {
    if (p[2] === "devices") state.zigbee = json().filter((d) => d.type !== "Coordinator");
    else if (p[2] === "groups") state.groups = json();
    else if (p[2] === "state") state.bridge = typeof json() === "object" ? json().state : msg;
    else if (p[2] === "info") { const i = json(); state.permitJoinUntil = i.permit_join ? Date.now() + (i.permit_join_timeout || 0) * 1000 : 0; }
    else if (p[2] === "response" && p[3] === "networkmap") state.networkmap = json().data?.value || null;
    else if (p[2] === "response") { const r = json(); if (r.status === "error") log("warn", "Zigbee2MQTT meldet einen Fehler", r.error); }
    else return;
  } else if (p.length === 2) {
    state.zstate[p[1]] = { ...state.zstate[p[1]], ...json() };
  } else if (p[2] === "availability") {
    const v = json();
    state.zavail[p[1]] = typeof v === "object" ? v.state : v;
  } else return;
  emit("devices", state);
}

export function disconnect() {
  if (client) {
    if (state.connected) client.publish(clientTopic(), presence(false), { retain: true, qos: 1 });
    client.end(false);
    client = null;
  }
  state.connected = false;
  emit("conn", state);
}

export function publish(topic, message, opts = {}) {
  if (!client || !state.connected) { log("warn", "Nicht mit der Zentrale verbunden", topic); return false; }
  client.publish(topic, typeof message === "string" ? message : JSON.stringify(message), { qos: 1, ...opts });
  return true;
}

/** Zigbee2MQTT-Befehl, z. B. z2m("device/rename", { from, to }) */
export const z2m = (cmd, payload = {}) => publish(`zigbee2mqtt/bridge/request/${cmd}`, payload);
/** Matter-Steuerung der Zentrale, z. B. matterCmd("pair", { code }) */
export const matterCmd = (cmd, data = {}) => publish(`heimalarm/cmd/matter/${cmd}`, data);
export const matterByName = (name) => (state.matter || []).find((d) => d.name === name);
/** Gerät/Gruppe schalten, z. B. setDevice("Flur", { state: "ON", brightness: 3 }) – Zigbee oder Matter. */
export const setDevice = (name, payload) => {
  const m = matterByName(name);
  return m ? matterCmd("set", { id: m.id, payload }) : publish(`zigbee2mqtt/${name}/set`, payload);
};
