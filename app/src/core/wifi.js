// WLAN-Geräte direkt im Heimnetz schalten – ohne Cloud, ohne Zentrale.
// Gleicher Code im Zentralen-Dienst (zentrale/dienst/src/wifi.js) – bei Änderungen beide anpassen.
//
// Gerät: { id, name, type, host, user?, target? }
//   shelly  – Gen2/3: /rpc/Switch.Set, Gen1: /relay/0 (automatisch)
//   hue     – Hue Bridge (lokale API v1): user = Schlüssel aus „Koppeln“, target = "light:3" | "group:1"
//   wled    – /json/state
//   tasmota – /cm?cmnd=…
//   fritz   – Heizkörperregler an der FRITZ!Box (AHA-HTTP): host = fritz.box, user/pass = FRITZ!Box-Benutzer, target = AIN
//   shellyblu – Shelly BLU TRV über das BLU Gateway Gen3: host = Gateway, target = Komponente (z. B. 200)
// Zustand: { on: bool, bri?: 0–100 } – Thermostate: { temp: °C } oder { on: false } (aus/Frostschutz)
// Thermostat-Payload im Zigbee-Format (Routinen, „Wieder da“): { occupied_heating_setpoint: °C, system_mode: "off"|"heat" }

export const WIFI_TYPES = {
  shelly: { label: "Shelly", hint: "Schalter, Zwischenstecker, Dimmer" },
  hue: { label: "Philips Hue Bridge", hint: "auch IKEA- und andere Zigbee-Lampen an der Bridge" },
  wled: { label: "WLED", hint: "LED-Streifen" },
  tasmota: { label: "Tasmota", hint: "umgeflashte Steckdosen und Lampen" },
  fritz: { label: "FRITZ! Heizkörperregler", hint: "FRITZ!Smart Thermo 301/302, FRITZ!DECT 301/302, Comet DECT – über die FRITZ!Box", heat: true },
  shellyblu: { label: "Shelly BLU TRV", hint: "Heizkörperthermostat über das Shelly BLU Gateway Gen3", heat: true },
};

/** Ist das WLAN-Gerät ein Heizkörperthermostat? */
export const isHeat = (dev) => Boolean(WIFI_TYPES[dev?.type]?.heat);
export const HEAT_MIN = 8, HEAT_MAX = 28;
const clampTemp = (t) => Math.max(HEAT_MIN, Math.min(HEAT_MAX, Math.round(Number(t) * 2) / 2));

/** Zigbee-Payload in einen WLAN-Zustand umwandeln (Licht oder Thermostat). */
export function payloadToState(dev, p = {}) {
  if (isHeat(dev)) {
    if (String(p.system_mode || "").toLowerCase() === "off" || String(p.state || "").toUpperCase() === "OFF") return { on: false };
    return p.occupied_heating_setpoint != null ? { on: true, temp: Number(p.occupied_heating_setpoint) } : { on: true };
  }
  return { on: String(p.state || "ON").toUpperCase() !== "OFF", bri: p.brightness != null ? (Number(p.brightness) / 254) * 100 : null };
}

/** Routinen-Aktion „Heizung“ { mode: set|off, temp } als Zigbee-Payload. */
export const heatPayload = (a) => (a.mode === "off" ? { system_mode: "off" } : { occupied_heating_setpoint: clampTemp(a.temp ?? 16) });
export const describeHeat = (a) => `Heizung ${a.device}: ${a.mode === "off" ? "aus" : `${String(clampTemp(a.temp ?? 16)).replace(".", ",")} °C`}`;

/** Zigbee-Payload auf ein WLAN-Gerät anwenden. */
export const wifiApply = (dev, payload, fetchFn) => wifiSet(dev, payloadToState(dev, payload), fetchFn);

const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const put = (body) => ({ ...json(body), method: "PUT" });
const clamp = (v) => Math.max(1, Math.min(100, Math.round(v)));

async function ok(r) {
  if (!r.ok) throw new Error(`Gerät antwortet mit Fehler ${r.status}`);
  return r.json().catch(() => ({}));
}

/** Gerät schalten. `fetchFn` ist fetch (Node) bzw. das Tauri-HTTP-fetch (App). */
export async function wifiSet(dev, state, fetchFn) {
  const base = `http://${dev.host}`;
  const on = Boolean(state.on);
  const bri = state.bri != null ? clamp(state.bri) : null;
  switch (dev.type) {
    case "shelly": {
      if (bri != null && on) {
        const r = await fetchFn(`${base}/rpc/Light.Set?id=0&on=true&brightness=${bri}`).catch(() => null);
        if (r?.ok) return;
      }
      const r2 = await fetchFn(`${base}/rpc/Switch.Set?id=0&on=${on}`).catch(() => null);
      if (r2?.ok) return;
      await ok(await fetchFn(`${base}/relay/0?turn=${on ? "on" : "off"}`));
      return;
    }
    case "hue": {
      const [kind, id] = String(dev.target || "group:0").split(":");
      const path = kind === "light" ? `lights/${id}/state` : `groups/${id}/action`;
      const body = { on, ...(bri != null && on ? { bri: Math.round((bri / 100) * 254) } : {}) };
      const res = await ok(await fetchFn(`${base}/api/${dev.user}/${path}`, put(body)));
      if (Array.isArray(res) && res[0]?.error) throw new Error(res[0].error.description);
      return;
    }
    case "wled":
      await ok(await fetchFn(`${base}/json/state`, json({ on, ...(bri != null && on ? { bri: Math.round((bri / 100) * 255) } : {}) })));
      return;
    case "tasmota": {
      const cmd = bri != null && on ? `Dimmer ${bri}` : `Power ${on ? "On" : "Off"}`;
      await ok(await fetchFn(`${base}/cm?cmnd=${encodeURIComponent(cmd)}`));
      return;
    }
    case "fritz": {
      // 16–56 = 8–28 °C in halben Grad, 253 = aus, 254 = an (Komfort)
      const param = !on ? 253 : state.temp != null ? Math.round(clampTemp(state.temp) * 2) : 254;
      await fritzCmd(dev, "sethkrtsoll", { ain: dev.target, param }, fetchFn);
      return;
    }
    case "shellyblu": {
      if (on && state.temp == null) return;          // „an“ ohne Temperatur: nichts zu tun
      const target = on ? clampTemp(state.temp) : 4;  // „aus“ = Frostschutz (4 °C, kleinster Wert des TRV)
      await bluCall(dev, "TRV.SetTarget", { id: 0, target_C: target }, fetchFn);
      return;
    }
    default: throw new Error(`Unbekannter Gerätetyp ${dev.type}`);
  }
}

/** Thermostat lesen: { temp (Soll), current (Ist), off, battery? } – null, wenn kein Thermostat. */
export async function wifiHeatGet(dev, fetchFn) {
  if (dev.type === "fritz") {
    const t = (await fritzThermostats(dev, fetchFn)).find((x) => x.ain === dev.target);
    if (!t) throw new Error("Regler nicht an der FRITZ!Box gefunden");
    return t;
  }
  if (dev.type === "shellyblu") {
    const j = await ok(await fetchFn(`http://${dev.host}/rpc/BluTrv.GetStatus?id=${Number(dev.target) || 200}`));
    return { temp: j.target_C, current: j.current_C, off: j.target_C != null && j.target_C <= 4.5, battery: j.battery };
  }
  return null;
}

// ── FRITZ!Box (AHA-HTTP-Schnittstelle, Anmeldung ab FRITZ!OS 7.24 mit PBKDF2) ──
const sids = new Map();   // host|user -> { sid, at }
const tag = (xml, t) => (xml.match(new RegExp(`<${t}>([^<]*)</${t}>`, "u")) || [])[1] || "";
const fromHex = (x) => new Uint8Array(x.match(/../gu).map((b) => parseInt(b, 16)));
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function pbkdf2(pw, salt, iter) {
  const key = await crypto.subtle.importKey("raw", pw, "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: Number(iter) }, key, 256);
}

async function fritzLogin(dev, fetchFn) {
  const url = `http://${dev.host || "fritz.box"}/login_sid.lua?version=2`;
  const first = await (await fetchFn(url)).text();
  const challenge = tag(first, "Challenge");
  if (!challenge.startsWith("2$")) throw new Error("FRITZ!OS zu alt – ab Version 7.24 nötig");
  const [, i1, s1, i2, s2] = challenge.split("$");
  const h1 = await pbkdf2(new TextEncoder().encode(dev.pass || ""), fromHex(s1), i1);
  const h2 = await pbkdf2(h1, fromHex(s2), i2);
  const body = `username=${encodeURIComponent(dev.user || "")}&response=${s2}$${toHex(h2)}`;
  const res = await (await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).text();
  const sid = tag(res, "SID");
  if (!sid || /^0+$/u.test(sid)) {
    const wait = Number(tag(res, "BlockTime")) || 0;
    throw new Error(wait ? `Anmeldung gesperrt – in ${wait} s erneut versuchen` : "FRITZ!Box: Benutzer oder Kennwort falsch");
  }
  sids.set(`${dev.host}|${dev.user}`, { sid, at: Date.now() });
  return sid;
}

/** Befehl an die FRITZ!Box; meldet sich bei Bedarf (neu) an. Liefert den Text der Antwort. */
async function fritzCmd(dev, cmd, args, fetchFn, retry = true) {
  const k = `${dev.host}|${dev.user}`;
  const c = sids.get(k);
  const sid = c && Date.now() - c.at < 15 * 60e3 ? c.sid : await fritzLogin(dev, fetchFn);
  const q = new URLSearchParams({ switchcmd: cmd, sid, ...Object.fromEntries(Object.entries(args || {}).map(([a, v]) => [a, String(v).replace(/\s/gu, "")])) });
  const r = await fetchFn(`http://${dev.host || "fritz.box"}/webservices/homeautoswitch.lua?${q}`);
  if (r.status === 403 && retry) { sids.delete(k); return fritzCmd(dev, cmd, args, fetchFn, false); }
  if (!r.ok) throw new Error(r.status === 400 ? "FRITZ!Box kennt den Regler nicht (AIN prüfen)" : `FRITZ!Box antwortet mit Fehler ${r.status}`);
  return r.text();
}

/** AHA-Wert in halben Grad (16–56) → °C; sonst null. */
const half = (v) => { const n = Number(v); return n >= 16 && n <= 56 ? n / 2 : null; };

/** Alle Heizkörperregler an der FRITZ!Box: [{ ain, name, temp, current, off, present, battery }]. */
export async function fritzThermostats(dev, fetchFn) {
  const xml = await fritzCmd(dev, "getdevicelistinfos", {}, fetchFn);
  return [...xml.matchAll(/<device identifier="([^"]+)"[^>]*>([\s\S]*?)<\/device>/gu)]
    .filter(([, , b]) => b.includes("<hkr>"))
    .map(([, ain, b]) => {
      const hkr = b.slice(b.indexOf("<hkr>"));
      const soll = Number(tag(hkr, "tsoll"));
      return {
        ain, name: tag(b, "name") || ain, present: tag(b, "present") === "1",
        temp: soll === 254 ? half(tag(hkr, "komfort")) : half(soll), current: half(tag(hkr, "tist")), off: soll === 253,
        battery: tag(b, "battery") ? Number(tag(b, "battery")) : null,
      };
    });
}

// ── Shelly BLU Gateway Gen3 ──
async function bluCall(dev, method, params, fetchFn) {
  const q = new URLSearchParams({ id: String(Number(dev.target) || 200), method: JSON.stringify(method), params: JSON.stringify(params) });
  const j = await ok(await fetchFn(`http://${dev.host}/rpc/BluTrv.Call?${q}`));
  if (j?.code && j?.message) throw new Error(j.message);
  return j;
}

/** Thermostate am BLU Gateway: [{ target: "200", name }]. */
export async function bluTrvs(host, fetchFn) {
  const j = await ok(await fetchFn(`http://${host}/rpc/Shelly.GetComponents?dynamic_only=true`));
  return (j.components || []).filter((c) => String(c.key).startsWith("blutrv:"))
    .map((c) => ({ target: String(c.key).split(":")[1], name: c.config?.name || `BLU TRV ${String(c.key).split(":")[1]}` }));
}

/** Hue Bridge koppeln – vorher den Knopf auf der Bridge drücken. Liefert den Schlüssel. */
export async function huePair(host, fetchFn) {
  const res = await ok(await fetchFn(`http://${host}/api`, json({ devicetype: "heimalarm#app" })));
  if (res[0]?.success?.username) return res[0].success.username;
  throw new Error(res[0]?.error?.type === 101 ? "Bitte zuerst den Knopf auf der Bridge drücken" : res[0]?.error?.description || "Koppeln fehlgeschlagen");
}

/** Lampen und Räume einer Hue Bridge: [{ target, name }] */
export async function hueTargets(host, user, fetchFn) {
  const [lights, groups] = await Promise.all([
    ok(await fetchFn(`http://${host}/api/${user}/lights`)),
    ok(await fetchFn(`http://${host}/api/${user}/groups`)),
  ]);
  return [
    ...Object.entries(groups || {}).map(([id, g]) => ({ target: `group:${id}`, name: `${g.name} (Raum)` })),
    ...Object.entries(lights || {}).map(([id, l]) => ({ target: `light:${id}`, name: l.name })),
  ];
}

/** Alexa-Routine über Voice Monkey starten (Cloud). */
export async function voiceMonkey(token, device, fetchFn) {
  const r = await fetchFn(`https://api-v3.voicemonkey.io/trigger?token=${encodeURIComponent(token)}&device=${encodeURIComponent(device)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error({ INVALID_TOKEN: "Token ungültig", DEVICE_NOT_FOUND: "Auslöser nicht gefunden", THROTTLED: "Zu viele Aufrufe", MONTHLY_QUOTA_EXCEEDED: "Monatslimit erreicht" }[j.error] || `Voice Monkey: Fehler ${r.status}`);
}

/** Platzhalter in Texten füllen: {stichwort} {einheit} {adresse} {text} {quelle} {person} {uhrzeit}. Leere fallen weg. */
export function fillTemplate(tpl, ev = {}) {
  const t = ev.ts ? new Date(ev.ts) : new Date();
  const vals = {
    stichwort: ev.keyword, einheit: ev.unit, adresse: ev.address, text: ev.text, quelle: ev.source,
    person: ev.who, uhrzeit: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`,
  };
  return String(tpl || "")
    .replace(/\{(\w+)\}/gu, (m, k) => (k in vals ? String(vals[k] ?? "").trim() : m))
    .replace(/\s+([,.:;!?])/gu, "$1").replace(/([,:;–-])\s*(?=[,.:;!?]|$)/gu, "").replace(/\s{2,}/gu, " ").trim().replace(/^[,:;–-]\s*/u, "");
}

/** Alexa spricht einen Text auf einem Echo (Voice Monkey „Speaker“-Gerät). a = { device, speech, voice, chime, show } */
export async function voiceMonkeyAnnounce(token, a, ev, fetchFn) {
  const speech = fillTemplate(a.speech || "Einsatz. {stichwort}. {adresse}", ev).slice(0, 400) || "Einsatz";
  const q = new URLSearchParams({ token, device: a.device || "", speech, language: "de-DE" });
  if (a.voice) q.set("voice", a.voice);
  if (a.chime) q.set("chime", a.chime);
  if (a.show) { q.set("text_display", speech); q.set("text_display_bg_colour", "#C42D21"); q.set("text_display_size", "40"); }
  const r = await fetchFn(`https://api-v3.voicemonkey.io/announce?${q}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error({ INVALID_TOKEN: "Token ungültig", DEVICE_NOT_FOUND: "Lautsprecher nicht gefunden", THROTTLED: "Zu viele Aufrufe", MONTHLY_QUOTA_EXCEEDED: "Monatslimit erreicht" }[j.error] || `Voice Monkey: Fehler ${r.status}`);
  return speech;
}
