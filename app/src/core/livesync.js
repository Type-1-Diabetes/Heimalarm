// Live zwischen Handy und PC – in beiden Betriebsarten:
//   Antwort „Ich fahre / fahre nicht“: an einem Gerät gedrückt → die anderen schließen ihre Abfrage,
//     das Handy hört auf zu klingeln, der PC führt seine Aktion aus. Divera/aPager bekommen nur EINE Rückmeldung.
//   Protokoll: jedes Gerät verteilt seine letzten 100 Einträge (Protokoll → Andere Geräte).
// Mit Zentrale über MQTT (heimalarm/answer/<kennung>, heimalarm/devlog/<geräte-id>),
// ohne Zentrale über die Direktverbindung (GET /events, POST /event – core/direct.js).
import { on } from "./events.js";
import { settings, mode } from "./settings.js";
import { engine, decide } from "./engine.js";
import { publish, state } from "./mqtt.js";
import { sendPeerEvent } from "./direct.js";
import { log, ownLog, mergeRemoteLogs } from "./log.js";
import { platformName } from "./platform.js";
import { stopPhoneAlarm } from "./android.js";
import { takeoverOpen, closeTakeover } from "../views/takeover.js";
import { toast } from "../ui/dom.js";

const me = () => settings().device;
const devName = () => me().name || platformName;
const ANSWER_WINDOW = 15 * 60e3;   // Antworten auf ältere Alarme ignorieren

function forThisDevice(who) {
  const s = settings();
  const also = String(s.pc?.alsoFor || "").split(",").map((x) => x.trim()).filter(Boolean);
  return who === s.alarm.me || also.includes(who);
}

// ── Eigene Antwort verteilen ───────────────────────────────────────────────
on("answer", ({ going, test, timeout, remote, alarm }) => {
  if (remote || timeout || !alarm?.who || settings().sync?.enabled === false) return;
  const ev = { type: "answer", who: alarm.who, going: Boolean(going), test: Boolean(test), from: devName(), id: me().id, at: Date.now() };
  if (mode() === "zentrale") { if (state.connected) publish(`heimalarm/answer/${alarm.who}`, ev); }
  else sendPeerEvent(ev);
});

// ── Fremde Antwort übernehmen ──────────────────────────────────────────────
on("peer-event", (ev) => {
  if (!ev || ev.type !== "answer" || ev.id === me().id) return;
  // Handy ohne Zentrale ist die Drehscheibe: Antwort von PC 1 auch an PC 2 weitergeben
  if (ev.via === "pc") sendPeerEvent({ ...ev, via: undefined, peerId: undefined }, ev.peerId);
  const last = engine.last;
  if (!last || last.who !== ev.who || !forThisDevice(ev.who) || Date.now() - (last.ts || 0) > ANSWER_WINDOW) return;
  if (!takeoverOpen()) return;   // hier schon beantwortet oder abgelaufen
  closeTakeover();
  stopPhoneAlarm();
  const text = ev.going ? "Ich fahre" : "Ich fahre nicht";
  log("info", `„${text}“ am Gerät „${ev.from}“ beantwortet`);
  toast(`„${text}“ – beantwortet am ${ev.from}`);
  decide(ev.going, { test: Boolean(last.test), remote: true, from: ev.from });
});

// ── Protokoll verteilen ────────────────────────────────────────────────────
let logTimer;
function publishLog() {
  if (mode() !== "zentrale" || !state.connected || !me().id || settings().sync?.enabled === false) return;
  publish(`heimalarm/devlog/${me().id}`, { name: devName(), at: Date.now(), entries: ownLog() }, { retain: true });
}
on("log", (entry) => { if (entry) { clearTimeout(logTimer); logTimer = setTimeout(publishLog, 5000); } });
on("conn", () => { if (state.connected) { clearTimeout(logTimer); logTimer = setTimeout(publishLog, 3000); } });
on("remote-log", ({ id, data }) => { if (data) mergeRemoteLogs({ [id]: data }, me().id); });
