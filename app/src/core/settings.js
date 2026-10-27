// Lokale Einstellungen dieses Geräts, mit Standardwerten.
// Nummern verweisen auf die Funktionsliste (Context.md, „Funktionsliste“).
// Was für alle Geräte gleich sein soll, liegt in shared.js (über die Zentrale synchronisiert).
import { emit } from "./events.js";

const KEY = "heimalarm.settings.v1";

export const defaults = {
  // Betrieb: "zentrale" (Raspberry Pi) oder "direkt" (Handy und PC ohne Pi)
  mode: "",               // leer = automatisch: mit eingetragener Zentrale → "zentrale"
  // Direktverbindung ohne Zentrale: PC empfängt, Handy sendet
  direct: {
    port: 8765,
    code: "",             // PC: Kopplungscode (wird erzeugt)
    hookKey: "",          // PC: Schlüssel für den aPager-Webhook direkt an diesen PC (wird erzeugt)
    peers: [],            // Handy: gekoppelte PCs [{ id, name, host, port, code, paired }] – code = eigener Code dieses Handys
    phones: [],           // PC: gekoppelte Handys [{ id, name, code, pairedAt, lastSeen }]
    routines: null,       // Routinen auf diesem Gerät ausführen (null = automatisch: nur Handy)
  },
  // F1, F2, H1 – Verbindung zur Zentrale (Mosquitto über WebSocket)
  broker: { host: "", port: 9001, tls: false, user: "", pass: "" },
  // A – Alarmeingang
  alarm: {
    me: "ich",              // eigene Kennung, passend zum ESP32-Topic alarm/<kennung>
    mqtt: true,             // A1 – Alarm vom ESP32 über MQTT
    notifications: false,   // (alt) – ersetzt durch alarm.apps
    lockoutSec: 60,         // A4 – Sperrzeit je Person
    holdSec: 60,            // Handy: Alarm aus einer Alarm-App so lange halten, wenn die Zentrale gerade weg ist (0 = aus, max. 120)
    offlineWarnSec: 120,    // A8 – Warnung, wenn ESP32 so lange offline ist
    heartbeatSec: 180,      // A9 – ohne Lebenszeichen so lange → Warnung
    minDurationMs: 50,      // A3 – Mindestdauer des Kontakts (wird an den ESP32 gesendet)
    testMode: false,        // A11 – alle Alarme nur als Test behandeln
    // A1/A6 – Alarm-Apps auf dem Handy: Benachrichtigung mitlesen (nur Android). Mehrere gleichzeitig möglich.
    apps: {
      sybos:  { on: false, pkg: "at.syPhone" },
      apager: { on: false, pkg: "org.xcrypt.apager.android2" },
      divera: { on: false, pkg: "" },     // Paketname über „Erkennen“ ermitteln
    },
    filterApps: "",                             // weitere Apps (Paketnamen, Teile reichen)
    filterWords: "ALARMIERUNG, Alarm, Einsatz", // A6 – Schlüsselwörter
  },
  // D – Windows-PC
  pc: {
    silent: false,          // „Aus“: keine Abfrage „Fährst du?“ auf diesem PC (Testalarm geht weiter)
    action: "hibernate",    // D1 – hibernate | sleep | lock | shutdown | mixed | none
    countdownSec: 30,       // D2
    onTimeout: "run",       // D3 – run | cancel
    autostart: true,        // D9
    alsoFor: "",            // Abfrage auch bei Alarmen dieser Kennungen (Komma), z. B. gemeinsamer PC
    title: "Fährst du?",    // D4 – Texte im Fenster
    goText: "Ich fahre",
    stayText: "Ich fahre nicht",
    sound: true,            // D5 – Ton während des Countdowns
    volume: 70,             // Lautstärke des Tons in Heimalarm (0–100), zusätzlich zur Windows-Lautstärke
    tone: "",               // "" = Melder-Ton, sonst Dateiname eines eigenen Tons (src-tauri/src/sound.rs)
    raiseSystem: false,     // Windows-Lautstärke bei Alarm anheben und Stummschaltung aufheben
    systemMin: 60,          // … auf mindestens so viel Prozent
    exceptions: "",         // D7 – kein Ruhezustand, wenn eines dieser Programme läuft (z. B. obs64.exe)
    stopMedia: true,        // D8 – Medienwiedergabe vorher stoppen
    // Vor dem Ruhezustand Tasten an Programme senden (z. B. Strg+S in Blender). core/hotkeys.js
    hotkeys: { enabled: false, waitSec: 2, rules: [] },   // rules: [{ id, exe, name, keys, on }]
    quietFrom: "",          // D12 – Zeitfenster ohne Reaktion (leer = aus)
    quietTo: "",
    wolMac: "",             // D11 – MAC dieses PCs zum Aufwecken (wird angezeigt)
  },
  // Handy – Alarm auf diesem Handy (nur Android, AlarmSound.kt)
  phone: {
    mode: "",               // Bei Alarm: heimalarm (Vollbild wie am PC) · app (Alarm-App öffnen) · off (nichts). "" = alt: aus silent abgeleitet
    silent: false,          // „Aus“ (alt, = mode off): bei Alarm nichts anzeigen, kein Ton, keine Vibration (Weiterleiten, Routinen, Protokoll laufen weiter)
    dnd: false,             // „Nicht stören“ aufheben …
    dndMin: 15,             // … für so viele Minuten, danach wie vorher
    torch: false,           // Taschenlampe blinken …
    torchSec: 30,           // … so viele Sekunden
    wake: false,            // Bildschirm einschalten …
    wakeSec: 30,            // … so viele Sekunden
    navigate: "off",        // off · go = bei „Ich fahre“ Navigation zum Gerätehaus starten
    station: "",            // Ziel der Navigation: Adresse oder „52.12,10.34“
    sound: false,           // eigenen Alarmton spielen (die Alarm-App klingelt meist schon)
    tone: "",               // "" = Melder-Ton, sonst id eines eigenen Tons
    volume: 80,             // Lautstärke des Tons (0–100), innerhalb der Wecker-Lautstärke
    durationSec: 60,        // so lange klingeln, wenn niemand „Stopp“ tippt
    fullscreen: true,       // Alarm auch auf dem Sperrbildschirm groß anzeigen
    ask: true,              // Abfrage „Fährst du?“ öffnen (aus = nur Mitteilung, Ton, Vibration)
    notify: true,           // Mitteilung in der Statusleiste
    vibrate: true,
  },
  // Divera 24/7 – persönlicher Zugang. Bleibt auf diesem Gerät (wird nicht abgeglichen).
  divera: {
    key: "",                // persönlicher Accesskey (Divera → Einstellungen → Debug → Accesskey)
    poll: false,            // Alarme direkt bei Divera abfragen
    pollSec: 20,
    answerGo: "",           // Rückmeldung zum Divera-Einsatz bei „Ich fahre“ (Status-ID)
    answerStay: "",         // … bei „Ich fahre nicht“
    statusGo: "",           // eigener Status bei „Ich fahre“ (leer = nichts setzen)
    statusStay: "",         // … bei „Ich fahre nicht“
    note: "",               // Freitext zur Rückmeldung (z. B. „per Heimalarm“)
    resetMin: 0,            // Status nach X Minuten zurücksetzen (0 = aus)
    resetTo: "",            // … auf diesen Status
    answer: false,          // Rückmeldung zum Einsatz senden (optional, Standard aus)
    setStatus: false,       // eigenen Status setzen (optional, Standard aus)
    unit: "",               // Name der Einheit (nur Anzeige)
    statuses: [],           // Statusgeber-Liste [{ id, name, color }]
    answers: [],            // Rückmelde-Status für Einsätze
  },
  // aPager PRO – Rückmeldung per API (Smart-Home-Abo nötig). Bleibt auf diesem Gerät.
  apager: { key: "", feedback: false, silent: false },   // feedback = Zusage/Absage senden (optional, Standard aus)
  // E – dieses Gerät
  device: { id: "", name: "" },
  notify: { enabled: true },       // E1
  ui: { theme: "dark" },           // E5 – dark (Standard) | light
  // H4 – App-Sperre (lokal, SHA-256 der PIN)
  lock: { pinHash: "", biometric: false },   // biometric = zusätzlich Fingerabdruck / Windows Hello
  // Android: Hintergrund-Dienst für zuverlässigen Empfang
  android: { service: true, batteryAsked: false, restart: true, samsungDone: false },   // restart = beendete App von selbst neu starten
  // Beim Start auf GitHub nach einer neueren Version suchen
  update: { auto: true },
  // Abgleich der Einstellungen (Zentrale und gekoppelte Geräte); intervalSec = wie oft ohne Zentrale abgeglichen wird
  sync: { enabled: true, intervalSec: 120 },
  // Discord Rich Presence (nur Windows): „Im Einsatz“ im Discord-Profil. Platzhalter wie {stichwort}, siehe ui/template.js
  discord: {
    enabled: false,
    appName: "",            // Name der Discord-App (nur für die Vorschau)
    clientId: "",           // Application-ID aus discord.com/developers – ihr Name steht als „Spielt …“ im Profil
    start: "alarm",         // alarm = sofort bei Alarm · go = erst bei „Ich fahre“
    onStay: "clear",        // clear = bei „Ich fahre nicht“ wieder entfernen · keep = stehen lassen
    listShows: 2,           // Mitgliederliste: 0 Name der App · 1 Zeile 2 · 2 Zeile 1 („Im Einsatz“)
    type: 0,                // 0 Spielt · 3 Schaut · 2 Hört · 5 Tritt an bei
    details: "Im Einsatz",  // erste Zeile
    state: "{stichwort}",   // zweite Zeile
    timer: "since",         // since = „seit 12:34“ · remaining = Restzeit · none
    durationMin: 90,        // so lange bleibt der Status (danach automatisch weg)
    largeImage: "",         // Bild-Schlüssel aus „Rich Presence → Art Assets“ oder https-Adresse
    largeText: "Heimalarm",
    smallImage: "",
    smallText: "{einheit}",
    buttons: [{ label: "", url: "" }, { label: "", url: "" }],
    clearOnRestore: true,   // „Wieder da“ beendet den Status
    resume: true,           // nach dem Aufwachen aus dem Ruhezustand wieder anzeigen
    tests: false,           // auch bei Testalarmen anzeigen
  },
  // Zusatzfunktionen – bewusst aus, bis man sie einschaltet
  features: { logbuch: false, stats: false },
  // Einrichtungs-Assistent (nur dieses Gerät): Fortschritt, Antworten, von Hand abgehakte Schritte. core/wizard.js
  wizard: { done: false, step: 0, answers: { src: [], act: [], always: "nein" }, ok: {} },
};

/** Diese Bereiche werden zwischen Handy und PC abgeglichen (pc.* nur zwischen PCs). */
export const SYNC_KEYS = ["alarm", "notify", "ui", "features"];

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base && k in base ? merge(base[k], v) : v;
  }
  return out;
}

function load() {
  try { return merge(defaults, JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch { return structuredClone(defaults); }
}

let current = load();
// Alte Standardwerte (vor den Alarm-Apps) übernehmen
if (/^\s*at\.syPhone,\s*com\.alamos\s*$/u.test(current.alarm.filterApps)) {
  current.alarm.filterApps = "";
  if (current.alarm.notifications) { current.alarm.apps.sybos.on = true; current.alarm.apps.apager.on = true; }
}
if (current.ui.theme !== "light") current.ui.theme = "dark";
if (!current.device.id) current.device.id = Math.random().toString(36).slice(2, 10);
save();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* Speicher voll/gesperrt */ }
}

export const settings = () => current;

/** Wert per Pfad lesen, z. B. get("pc.countdownSec"). */
export const get = (path) => path.split(".").reduce((o, k) => o?.[k], current);

/** Was das Handy bei Alarm tut: heimalarm · app · off */
export const phoneMode = () => { const p = settings().phone || {}; return ["heimalarm", "app", "off"].includes(p.mode) ? p.mode : (p.silent ? "off" : "heimalarm"); };

/** Wert per Pfad setzen. `silent` = nicht an die Zentrale weitergeben (z. B. beim Empfang). */
export function set(path, value, { silent = false } = {}) {
  const keys = path.split(".");
  let obj = current;
  keys.slice(0, -1).forEach((k) => (obj = obj[k] ??= {}));
  if (obj[keys.at(-1)] === value) return;
  obj[keys.at(-1)] = value;
  save();
  emit("settings", { path, value, silent });
}

/** Ganze Bereiche übernehmen (Sync, Backup-Import). */
export function replace(section, value, { silent = true } = {}) {
  current[section] = merge(defaults[section] ?? {}, value);
  save();
  emit("settings", { path: section, value, silent });
}

/** Betriebsart: mit Zentrale (Pi) oder direkt zwischen Handy und PC. */
export const mode = () => current.mode || (current.broker.host ? "zentrale" : "direkt");
export const isConfigured = () => mode() === "zentrale" && Boolean(current.broker.host);
