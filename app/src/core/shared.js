// Gemeinsame Konfiguration für alle Geräte – liegt retained auf der Zentrale:
//   heimalarm/config/shared   { persons, routines, location, vacation, lockoutSec, webhookSecret, adminPinHash, common }
// Der Zentrale-Programm liest dieselben Daten und führt die Routinen aus.
// `common` enthält die synchronisierten allgemeinen Einstellungen (SYNC_KEYS) für Handy und PC.
import { emit, on } from "./events.js";
import { settings, replace, SYNC_KEYS, mode } from "./settings.js";

const TOPIC = "heimalarm/config/shared";

export const sharedDefaults = {
  persons: [{ id: "ich", name: "Ich" }],          // G1
  routines: [],                                   // B
  location: { lat: 51.16, lon: 10.45 },           // F6 – für Sonnenauf-/-untergang (Standard: Mitte Deutschlands, unter Zentrale anpassen)
  vacation: false,                                // B9 – nicht verfügbar/abwesend (aus readiness abgeleitet)
  readiness: { mode: "ready", until: null },      // Bereitschaft: ready | away | absent, endet zu „until“ (ms)
  lockoutSec: 60,                                 // A4 (Zentrale)
  webhookSecret: "",                              // H2
  adminPinHash: "",                               // G3
  common: null,                                   // synchronisierte Einstellungen
  wifi: [],                                       // WLAN-Geräte [{ id, name, type, host, user, target }]
  voicemonkey: { token: "" },                     // Alexa-Routinen über Voice Monkey (Cloud)
  hass: { enabled: false, prefix: "homeassistant", activeMin: 30, tests: false, buttons: true }, // Home Assistant (MQTT-Discovery, nur mit Zentrale)
  selftest: { enabled: true, days: [7], at: "10:00", esp: true, apps: true, zigbee: true }, // I4 – automatischer Selbsttest der Zentrale (1 = Montag)
};

// Ohne Zentrale liegen die gemeinsamen Daten (Routinen, Geräte, Personen) auf diesem Gerät.
const LOCAL_KEY = "heimalarm.shared.local";
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch { return null; } };
const saveLocal = (d) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(d)); } catch { /* voll */ } };

let data = { ...structuredClone(sharedDefaults), ...loadLocal() };
let loaded = false;
let publishFn = null;

export const shared = () => data;
export const sharedLoaded = () => loaded;

/** Wird von mqtt.js beim Verbinden gesetzt. */
export function bindPublisher(fn) { publishFn = fn; }

export function receive(msg) {
  try { data = { ...structuredClone(sharedDefaults), ...JSON.parse(msg || "{}") }; } catch { return; }
  loaded = true;
  saveLocal(data);
  // Allgemeine Einstellungen von anderen Geräten übernehmen
  if (settings().sync.enabled && data.common) {
    for (const k of [...SYNC_KEYS, "pc"]) {
      if (!data.common[k]) continue;
      // Die Kennung bleibt je Gerät (mehrere Personen können eine Zentrale teilen)
      const incoming = k === "alarm" ? { ...data.common[k], me: settings().alarm.me }
        : k === "pc" ? { ...data.common[k], alsoFor: settings().pc.alsoFor, wolMac: settings().pc.wolMac } : data.common[k];
      if (JSON.stringify(incoming) !== JSON.stringify(settings()[k])) replace(k, incoming);
    }
  }
  emit("shared", data);
}

/** Änderung speichern und an alle Geräte verteilen. */
export function updateShared(patch) {
  data = { ...data, ...patch };
  saveLocal(data);
  if (mode() === "zentrale") publishFn?.(TOPIC, JSON.stringify(data), { retain: true, qos: 1 });
  emit("shared", data);
  emit("shared-local", patch);   // für den Abgleich ohne Zentrale (core/sync.js)
}

/** Ohne Zentrale: gemeinsame Daten von einem anderen Gerät übernehmen (nicht weiterverteilen). */
export function replaceShared(next) {
  data = { ...structuredClone(sharedDefaults), ...next, common: data.common };
  saveLocal(data);
  emit("shared", data);
}

// Lokale Änderungen an allgemeinen Einstellungen weitergeben
on("settings", ({ path, silent }) => {
  if (silent || !settings().sync.enabled || !loaded) return;
  const root = path.split(".")[0];
  // PC-Einstellungen gelten für alle PCs gleich – außer „Auch für“ und MAC (je PC)
  if (!SYNC_KEYS.includes(root) && !(root === "pc" && !/^pc\.(alsoFor|wolMac)/u.test(path))) return;
  const common = {};
  for (const k of SYNC_KEYS) common[k] = settings()[k];
  const { alsoFor: _a, wolMac: _w, ...pc } = settings().pc || {};
  common.pc = pc;
  updateShared({ common });
});

export const newId = () => Math.random().toString(36).slice(2, 9);
/** Geheimer Schlüssel (Webhooks): 128 Bit aus dem sicheren Zufallsgenerator, 32 Hex-Zeichen. */
export const secretKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(text) {
  if (!globalThis.crypto?.subtle) {
    // Fallback ohne sicheren Kontext (sollte in der App nicht vorkommen)
    let x = 2166136261;
    for (const c of text) x = Math.imul(x ^ c.codePointAt(0), 16777619) >>> 0;
    return "fnv" + x.toString(16);
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
