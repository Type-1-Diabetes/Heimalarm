// Was ist eingerichtet? Ansichten zeigen nur, was es wirklich gibt (Einstellungen zeigen immer alles).
import { settings, isConfigured, mode } from "./settings.js";
import { shared } from "./shared.js";
import { state } from "./mqtt.js";

export const has = {
  pi: () => isConfigured(),                                            // Zentrale (NAS oder Raspberry Pi)
  esp: () => isConfigured() && settings().alarm.mqtt !== false,         // Melder über ESP32
  zigbee: () => isConfigured() && state.zigbee !== null,                // Zigbee2MQTT meldet sich
  direct: () => mode() === "direkt",
  wifi: () => (shared().wifi || []).length > 0,
  matter: () => isConfigured() && (state.matter || []).length > 0,     // Matter-Geräte an der Zentrale
  /** Routinen und Geräte gibt es in beiden Betriebsarten – auch bevor die Zentrale-Adresse eingetragen ist
   *  (sonst fehlen nach „Betriebsart ändern“ die Tabs Geräte und Routinen). */
  routines: () => mode() === "zentrale" || mode() === "direkt",
  voice: () => isConfigured() && Boolean(state.voice?.enabled),
  sybos: () => Boolean(settings().alarm.apps?.sybos?.on),
  apager: () => Boolean(settings().alarm.apps?.apager?.on),
  divera: () => Boolean(settings().alarm.apps?.divera?.on),
  logbuch: () => Boolean(settings().features?.logbuch),                 // Einsatz-Logbuch (Zusatzfunktion)
  stats: () => Boolean(settings().features?.logbuch && settings().features?.stats),
  diveraApi: () => Boolean(settings().alarm.apps?.divera?.on && settings().divera.key),
};

/** Aktive Alarmquellen als Namen, z. B. ["Melder", "SYBOS"]. */
export const activeSources = () => [
  has.esp() && "Melder", has.sybos() && "SYBOS", has.apager() && "aPager", has.divera() && "Divera",
].filter(Boolean);
