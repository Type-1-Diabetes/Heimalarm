// B – Routinen & Regeln.
//
// Routine = { id, name, enabled, who: [kennung] (leer = alle),
//   trigger: { type: "alarm" | "time" | "device" | "manual" | "readiness", at, device, property, value, to },
//   conditions: { mode: "and" | "or", items: [ { type, ... } ] },
//   actions: [ { type: "device" (Zigbee, WLAN oder Matter) | "heat" {device, mode: set|off, temp} | "group" | "delay" | "restore" | "publish" | "divera" | "readiness" | "webhook", ... } ],
//   restoreAfterMin }  // B8: vorherigen Zustand nach X min wiederherstellen (0 = aus)
//
// Bedingungen: time {from,to} · weekday {days:[1..7]} · sun {is:"dark"|"light"} ·
//              home {who:"any"|clientId} · keyword {contains} · unit {contains} · readiness {is: ready|off|away|absent}
//
// „Nicht verfügbar“/„Abwesend“ pausiert nur Routinen mit Auslöser „Bei Alarm“ – Zeit-, Geräte- und
// Bereitschafts-Routinen laufen weiter (sonst könnte z. B. „um 6 Uhr wieder verfügbar“ nie laufen).
import SunCalc from "suncalc";
import { wifiApply, wifiHeatGet, isHeat, heatPayload, describeHeat, voiceMonkey, voiceMonkeyAnnounce } from "./wifi.js";

export function createRules(ctx, log) {
  const lastAlarm = new Map();   // Sperrzeit je Person
  const timers = new Set();      // laufende Verzögerungen / Ausschalt-Timer
  let snapshot = null;           // B8 – Zustand vor der letzten Routine
  const reading = new Map();     // WLAN-Thermostate: Sollwert wird vor dem Umstellen gelesen
  let clock = null;
  let lastMode = null;           // für den Auslöser „Bereitschaft wechselt“

  /** Bereitschaft wie in der App: abgelaufene Zeit zählt schon als „verfügbar“. */
  function readinessMode() {
    const r = ctx.config.readiness;
    if (r?.mode && r.mode !== "ready") return r.until && r.until <= Date.now() ? "ready" : r.mode;
    return ctx.config.vacation ? "absent" : "ready";
  }

  const pub = (topic, payload) => ctx.client.publish(topic, typeof payload === "string" ? payload : JSON.stringify(payload), { qos: 1 });
  const wifiDev = (name) => (ctx.config.wifi || []).find((d) => d.name === name);
  /** Zigbee-Payload ({ state, brightness 0–254 } bzw. { occupied_heating_setpoint }) auf WLAN-Gerät anwenden. */
  const setWifi = (dev, payload) => wifiApply(dev, payload, fetch).catch((e) => log.warn(`WLAN-Gerät ${dev.name}`, e.message));
  /** Gerät oder Gruppe schalten – Zigbee über MQTT, WLAN direkt, Matter über den Controller. */
  const switchDevice = (name, payload) => {
    const w = wifiDev(name);
    if (w) setWifi(w, payload);
    else if (ctx.matter?.byName(name)) ctx.matter.switchByName(name, payload).catch((e) => log.warn(`Matter-Gerät ${name}`, e.message));
    else pub(`zigbee2mqtt/${name}/set`, payload);
  };
  const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

  // ── Bedingungen ───────────────────────────────────
  function minutesNow(d = new Date()) { return d.getHours() * 60 + d.getMinutes(); }
  const toMin = (hhmm = "00:00") => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };

  function check(cond, event) {
    switch (cond.type) {
      case "time": {
        const n = minutesNow(), a = toMin(cond.from), b = toMin(cond.to);
        return a <= b ? n >= a && n < b : n >= a || n < b; // über Mitternacht
      }
      case "weekday": return (cond.days || []).includes(((new Date().getDay() + 6) % 7) + 1); // 1 = Montag
      case "sun": {
        const { lat, lon } = ctx.config.location || {};
        const t = SunCalc.getTimes(new Date(), lat, lon);
        const dark = Date.now() < t.sunrise.getTime() || Date.now() > t.sunset.getTime();
        return cond.is === "light" ? !dark : dark;
      }
      case "home": {
        const phones = Object.entries(ctx.clients).filter(([, c]) => c.online && c.platform === "Android");
        return cond.who && cond.who !== "any" ? phones.some(([id]) => id === cond.who) : phones.length > 0;
      }
      case "keyword": return String(event?.keyword || "").toLowerCase().includes(String(cond.contains || "").toLowerCase());
      case "unit": return String(event?.unit || "").toLowerCase().includes(String(cond.contains || "").toLowerCase());
      case "readiness": {
        const m = readinessMode();
        return cond.is === "off" ? m !== "ready" : m === (cond.is || "ready");
      }
      default: return true;
    }
  }

  function allowed(routine, event) {
    const items = routine.conditions?.items || [];
    if (items.length === 0) return true;
    return routine.conditions.mode === "or" ? items.some((c) => check(c, event)) : items.every((c) => check(c, event));
  }

  // ── Aktionen ─────────────────────────────────────
  function takeSnapshot(actions) {
    const names = new Set(actions.filter((a) => a.type === "device" || a.type === "heat").map((a) => a.device));
    const snap = {};
    snapshot = snap;
    reading.clear();
    for (const n of names) {
      const w = wifiDev(n);
      if (w && isHeat(w)) {
        // Sollwert vorher lesen; die Aktion „Heizung“ wartet darauf, Licht nicht
        reading.set(n, wifiHeatGet(w, fetch)
          .then((s) => { snap[n] = s.off ? { system_mode: "off" } : { occupied_heating_setpoint: s.temp }; })
          .catch((e) => log.warn(`Heizung ${n}: Sollwert nicht gelesen`, e.message)));
        continue;
      }
      const s = ctx.devices[n];
      if (s) snap[n] = pick(s, ["state", "brightness", "color_temp", "color", "occupied_heating_setpoint", "system_mode"]);
    }
  }

  function restore() {
    if (!snapshot) return log.info("Nichts wiederherzustellen");
    for (const [n, s] of Object.entries(snapshot)) switchDevice(n, s);
    log.action("Vorheriger Zustand wiederhergestellt", Object.keys(snapshot).join(", "));
    snapshot = null;
  }

  async function runActions(routine, { dry = false, event = {} } = {}) {
    let wait = 0;
    for (const a of routine.actions || []) {
      if (a.type === "delay") { wait += (Number(a.sec) || 0) * 1000; continue; }
      const run = () => {
        if (dry) return log.info(`Probe: ${describe(a)}`, routine.name);
        if (a.type === "device") {
          switchDevice(a.device, { ...a.payload, ...(a.transition && !wifiDev(a.device) ? { transition: Number(a.transition) } : {}) });
          if (Number(a.offAfterSec) > 0) later(Number(a.offAfterSec) * 1000, () => switchDevice(a.device, { state: "OFF" })); // B7
        } else if (a.type === "heat") {
          const p = heatPayload(a);
          Promise.resolve(reading.get(a.device)).then(() => switchDevice(a.device, p));
          log.action(describeHeat(a), routine.name);
        } else if (a.type === "group") {
          pub(`zigbee2mqtt/${a.group}/set`, a.payload || { state: "ON" });
        } else if (a.type === "voicemonkey") {
          const token = ctx.config.voicemonkey?.token;
          if (!token) log.warn("Voice Monkey: kein Token eingetragen");
          else voiceMonkey(token, a.device, fetch).then(() => log.action("Alexa-Routine gestartet", a.device)).catch((e) => log.warn("Voice Monkey", e.message));
        } else if (a.type === "announce") {
          const token = ctx.config.voicemonkey?.token;
          if (!token) log.warn("Alexa-Ansage: kein Voice-Monkey-Token eingetragen");
          else voiceMonkeyAnnounce(token, a, event, fetch).then((t) => log.action("Alexa sagt an", t)).catch((e) => log.warn("Alexa-Ansage", e.message));
        } else if (a.type === "divera") {
          ctx.divera?.setStatus(a);
        } else if (a.type === "readiness") {
          const until = a.mode === "ready" ? null : nextTime(a.untilAt);
          ctx.updateShared?.({ readiness: { mode: a.mode, until }, vacation: a.mode !== "ready" });
          log.action("Bereitschaft gesetzt", `${READY[a.mode] || a.mode}${until ? " bis " + new Date(until).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : ""}`);
        } else if (a.type === "webhook") {
          webhook(a, event);
        } else if (a.type === "publish") {
          pub(a.topic, a.payload ?? "");
        } else if (a.type === "restore") {
          restore();
        }
      };
      if (wait > 0) later(wait, run); else run();
    }
  }

  function describe(a) {
    if (a.type === "device") return `${a.device}: ${JSON.stringify(a.payload)}`;
    if (a.type === "heat") return describeHeat(a);
    if (a.type === "group") return `Gruppe ${a.group}`;
    if (a.type === "voicemonkey") return `Alexa-Routine ${a.device}`;
    if (a.type === "announce") return `Alexa-Ansage auf ${a.device}`;
    if (a.type === "divera") return `Divera-Status ${a.who}: ${a.statusName || a.statusId}`;
    if (a.type === "readiness") return `Bereitschaft: ${READY[a.mode] || a.mode}`;
    if (a.type === "webhook") return `Webhook ${a.method || "GET"} ${a.url}`;
    return a.type;
  }

  function fire(routine, event = {}) {
    if (!routine.enabled) return;
    if (routine.trigger?.type === "alarm" && readinessMode() !== "ready") return log.info("Nicht verfügbar: Routine übersprungen", routine.name); // B9
    // Per Knopf ausgeführt: Bedingungen gelten nicht
    if (!event.manual && !allowed(routine, event)) return log.info("Bedingungen nicht erfüllt", routine.name);
    const dry = Boolean(event.test);
    log.action(dry ? `Routine (Test): ${routine.name}` : `Routine: ${routine.name}`, event.who ? `alarm/${event.who}` : routine.trigger?.type);
    if (!dry) takeSnapshot(routine.actions || []);
    runActions(routine, { dry, event });
    if (!dry && Number(routine.restoreAfterMin) > 0) later(routine.restoreAfterMin * 60e3, restore);
  }

  // ── Auslöser ─────────────────────────────────────
  function onAlarm(who, data) {
    if (!data) return;
    const lockMs = (ctx.config.lockoutSec ?? 60) * 1000;
    if (!data.test && !data.probe && Date.now() - (lastAlarm.get(who) || 0) < lockMs) return;
    if (!data.test && !data.probe) lastAlarm.set(who, Date.now());
    log.alarm(data.test ? "Testalarm" : data.probe ? "Generalprobe" : "Alarm", `${data.source || "?"} · alarm/${who}${data.keyword ? " · " + data.keyword : ""}`);
    const event = { ...data, who, test: Boolean(data.test) };
    ctx.onAlarmAccepted?.(event);
    for (const r of ctx.config.routines || []) {
      if (r.trigger?.type !== "alarm") continue;
      if (r.who?.length && !r.who.includes(who)) continue;   // G2 – Routinen pro Person
      fire(r, event);
    }
  }

  function onDevice(name, s) {
    for (const r of ctx.config.routines || []) {
      const t = r.trigger || {};
      if (t.type === "device" && t.device === name && String(s?.[t.property]) === String(t.value)) fire(r, { device: name });
    }
  }

  function command(cmd, data) {
    if (cmd === "restore") return restore();                                 // B8 – „Wieder da“
    if (cmd === "run") {                                                     // B2 – manuell
      const r = (ctx.config.routines || []).find((x) => x.id === data.id);
      if (r) fire({ ...r, enabled: true }, { manual: true, test: Boolean(data.test) });
      return;
    }
    if (cmd === "wol" && data.mac) return wol(data.mac);                      // D11
  }

  function wol(mac) {
    import("node:dgram").then(({ createSocket }) => {
      const hex = mac.replace(/[^0-9a-f]/giu, "");
      const m = Buffer.from(hex, "hex");
      const pkt = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(m)]);
      const s = createSocket("udp4");
      s.bind(() => { s.setBroadcast(true); s.send(pkt, 9, "255.255.255.255", () => s.close()); });
      log.action("Wake-on-LAN gesendet", mac);
    });
  }

  /** Auslöser „Bereitschaft wechselt“ – nach jeder neuen Konfiguration und jede Minute (Ablauf der Zeit). */
  function checkReadiness() {
    const m = readinessMode();
    if (lastMode === null) { lastMode = m; return; }   // Start: kein Wechsel
    if (m === lastMode) return;
    const from = lastMode; lastMode = m;
    for (const r of ctx.config.routines || []) {
      const t = r.trigger || {};
      if (t.type !== "readiness") continue;
      if (t.to === "off" ? m === "ready" : t.to && t.to !== "any" && t.to !== m) continue;
      fire(r, { readiness: m, from });
    }
  }

  // Zeit-Auslöser: jede Minute prüfen (Wochentage optional direkt am Auslöser)
  function reschedule() {
    clearInterval(clock);
    checkReadiness();
    clock = setInterval(() => {
      const now = new Date(), hhmm = now.toTimeString().slice(0, 5), day = ((now.getDay() + 6) % 7) + 1;
      for (const r of ctx.config.routines || []) {
        const t = r.trigger || {};
        if (t.type === "time" && t.at === hhmm && (!t.days?.length || t.days.includes(day))) fire(r, { time: hhmm });
      }
      checkReadiness();
    }, 60e3);
  }

  async function webhook(a, event) {
    if (!/^https?:\/\//u.test(a.url || "")) return log.warn("Webhook: Adresse fehlt oder ungültig", a.url || "");
    const fill = (t) => String(t || "").replace(/\{(\w+)\}/gu, (_, k) => encodeURIComponent(event?.[k] ?? ""));
    try {
      const r = await fetch(fill(a.url), { method: a.method || "GET", ...(a.method === "POST" ? { headers: { "Content-Type": "application/json" }, body: a.body || JSON.stringify({ event: event?.readiness ? "readiness" : event?.who ? "alarm" : "routine", ...event }) } : {}), signal: AbortSignal.timeout(10e3) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      log.action("Webhook gesendet", a.url.replace(/\?.*/u, ""));
    } catch (e) { log.warn("Webhook fehlgeschlagen", `${a.url.replace(/\?.*/u, "")}: ${e.message}`); }
  }

  return { onAlarm, onDevice, command, reschedule };
}

const READY = { ready: "Verfügbar", away: "Nicht verfügbar", absent: "Abwesend" };

/** Nächstes Vorkommen von „HH:MM“ als ms (heute oder morgen); leer = ohne Ende. */
function nextTime(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number), d = new Date();
  d.setHours(h, m || 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
