// Android-Funktionen über das eigene Plugin (plugins/heimalarm):
// Hintergrund-Dienst, Akku-Optimierung (E6), Benachrichtigungen mitlesen (A1/A6).
import { isTauri, isAndroid } from "./platform.js";
import { settings, set, phoneMode } from "./settings.js";
import { log } from "./log.js";
import { alarmFromNotification } from "./engine.js";

const enabled = isTauri && isAndroid;
// Sofort beim Laden, damit schon der erste Bildaufbau die Mindestabstände nutzt (tokens.css)
if (enabled) document.documentElement.classList.add("is-android");

async function call(cmd, args) {
  const core = await import("@tauri-apps/api/core");
  return core.invoke(`plugin:heimalarm|${cmd}`, args);
}

/**
 * Alarm auf dem Handy: Vollbild-Meldung (Sperrbildschirm), Vibration, Wecker-Ton – nach phone.* Einstellungen.
 * Läuft nativ (AlarmSound.kt), damit es auch im Hintergrund klingelt. Beim Testalarm nur Ton und Anzeige in der App.
 */
export function phoneAlarm({ title, text, test = false }) {
  if (!enabled) return;
  const ph = settings().phone || {};
  call("show_alarm", {
    title, text,
    fullscreen: !test && ph.fullscreen !== false && ph.ask !== false,
    notify: ph.notify !== false,
    vibrate: ph.vibrate !== false,
    sound: Boolean(ph.sound),
    tone: ph.tone || "",
    volume: Number(ph.volume) || 80,
    ms: (Number(ph.durationSec) || 60) * 1000,
    ...(test ? {} : extras()),
  }).catch((e) => log("warn", "Alarm-Anzeige am Handy fehlgeschlagen", String(e)));
}
/** Zusatzaktionen bei Alarm: „Nicht stören“ aufheben, Taschenlampe, Bildschirm an */
function extras() {
  const ph = settings().phone || {};
  return {
    dnd: Boolean(ph.dnd), torch: Boolean(ph.torch), wake: Boolean(ph.wake),
    dndMin: Number(ph.dndMin) || 15, torchSec: Number(ph.torchSec) || 30, wakeSec: Number(ph.wakeSec) || 30,
  };
}

/** Paketname der Alarm-App, die geöffnet werden soll: die, deren Benachrichtigung den Alarm ausgelöst hat,
 *  sonst die erste eingeschaltete (z. B. beim Alarm vom Melder in der Ladeschale). */
function alarmAppFor(a) {
  if (a?.app) return a.app;
  const apps = settings().alarm.apps || {};
  return Object.values(apps).find((x) => x.on && x.pkg)?.pkg || "";
}

/** Modus „Alarm-App öffnen“: Einsatz direkt in SYBOS, aPager oder Divera öffnen. */
export async function openAlarmApp(a) {
  if (!enabled) return;
  try {
    const r = await call("open_alarm_app", { app: alarmAppFor(a), ...extras() });
    log("info", r.opened ? "Alarm-App geöffnet" : "Alarm-App öffnet beim Antippen der Meldung", a?.app || "");
  } catch (e) { log("warn", "Alarm-App nicht geöffnet", String(e)); }
}

/** Navigation zum Gerätehaus (Einstellung phone.station). */
export async function navigateToStation() {
  const target = String(settings().phone?.station || "").trim();
  if (!enabled || !target) return false;
  try { await call("navigate", { target }); return true; }
  catch (e) { log("warn", "Navigation nicht gestartet", String(e)); return false; }
}

export const testTorch = () => call("test_torch");
export const openOverlaySettings = () => call("open_overlay_settings");
export const openDndSettings = () => call("open_dnd_settings");

export const stopPhoneAlarm = () => (enabled ? call("stop_alarm").catch(() => {}) : Promise.resolve());

/** Filter an den nativen Teil geben: nach einem Neustart erkennt er Alarme auch, bevor die App offen ist. */
export function configureNative() {
  if (!enabled) return;
  const s = settings().alarm;
  const pkgs = [...Object.values(s.apps || {}).filter((a) => a.on && a.pkg).map((a) => a.pkg),
    ...s.filterApps.split(",").map((x) => x.trim()).filter(Boolean)];
  const words = s.filterWords.split(",").map((x) => x.trim()).filter(Boolean);
  call("configure", { packages: pkgs, words, service: settings().android?.service !== false, silent: phoneMode() === "off", mode: phoneMode(),
    restart: settings().android?.restart !== false, notify: settings().phone?.notify !== false, ...extras() }).catch(() => {});
}

export const androidStatus = () => (enabled ? call("status") : Promise.resolve({ supported: false }));
export const openBatterySettings = () => call("open_battery_settings");
export const openNotificationAccess = () => call("open_notification_access");
export const openFullScreenSettings = () => call("open_full_screen_settings");
export const openAppDetails = () => call("open_app_details");

/** Standby-Bucket ab „selten“ (40) oder Hintergrund gesperrt: Android legt die App schlafen (Samsung „Tiefschlaf“). */
export const sleeping = (st) => Boolean(st?.backgroundRestricted) || Number(st?.standbyBucket) >= 40;

/** Was fehlt, damit Heimalarm im Hintergrund zuverlässig läuft. Für Start-Hinweis und „Hintergrund & Rechte“. */
export function backgroundIssues(st) {
  if (!st?.supported) return [];
  const a = settings().android || {};
  const out = [];
  if (a.service === false) out.push({ id: "service", title: "Hintergrund-Dienst ist aus", why: "Android beendet Heimalarm dann nach kurzer Zeit." });
  if (st.batteryOptimized) out.push({ id: "akku", title: "Akku-Optimierung ist an", why: "Android pausiert Heimalarm, Alarme kommen verspätet an." });
  if (sleeping(st)) out.push({ id: "schlaf", title: "Android legt Heimalarm schlafen", why: "App-Infos → Akku → „Nicht eingeschränkt“." });
  else if (st.samsung && !a.samsungDone) out.push({ id: "samsung", title: "Samsung: „Nie in Standby“ prüfen", why: "Einstellungen → Akku → Hintergrundnutzungslimits → Nie in den Standby versetzte Apps → Heimalarm." });
  if (a.restart !== false && st.overlayAllowed === false) out.push({ id: "neustart", title: "Auto-Neustart braucht eine Erlaubnis", why: "„Über anderen Apps einblenden“, sonst darf Heimalarm sich nicht selbst starten." });
  return out;
}
export async function setBackgroundService(on) {
  if (!enabled) return;
  await call("set_service", { enabled: on });
  set("android.service", on);
}

/** Abstand zu Status- und Navigationsleiste übernehmen. Die Werte kommen vom Fenster;
 *  beim Start sind sie oft noch 0, daher mehrmals nachfragen und bei Größenänderung erneut. */
async function syncInsets() {
  try {
    const st = await call("status");
    const root = document.documentElement.style;
    if (st.insetTop) root.setProperty("--inset-top", `${st.insetTop}px`);
    if (st.insetBottom) root.setProperty("--inset-bottom", `${st.insetBottom}px`);
    return Boolean(st.insetTop && st.insetBottom);
  } catch { return false; }
}

async function watchInsets() {
  for (const ms of [0, 150, 400, 1000, 2500]) {
    await new Promise((r) => setTimeout(r, ms));
    if (await syncInsets()) break;
  }
  window.addEventListener("resize", () => syncInsets());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncInsets(); });
}

export async function initAndroid() {
  if (!enabled) return;
  watchInsets();
  const core = await import("@tauri-apps/api/core");
  try {
    await core.addPluginListener("heimalarm", "notification", (n) => alarmFromNotification(n));
    // Alarme, die erkannt wurden, bevor die App lief (z. B. nach Neustart des Handys)
    const { items = [] } = await call("pending_notifications");
    for (const n of items) alarmFromNotification(n);
  } catch (e) {
    log("warn", "Benachrichtigungen mitlesen nicht verfügbar", String(e));
  }
  // Android 17+: ohne diese Erlaubnis erreicht die App weder Zentrale noch PC noch WLAN-Geräte (nur Timeout).
  try {
    const { granted } = await call("request_local_network");
    if (!granted) log("warn", "Zugriff aufs Heimnetz nicht erlaubt", "Android-Einstellungen → Apps → Heimalarm → Berechtigungen → Geräte in der Nähe / Lokales Netzwerk erlauben.");
  } catch { /* ältere App-Version des Plugins */ }
  configureNative();
  const { on } = await import("./events.js");
  on("phone-open-app", (a) => openAlarmApp(a));
  on("phone-alert", (a) => phoneAlarm({ title: a.keyword || "Einsatz", text: [a.unit, a.address].filter(Boolean).join(" · ") || "Heimalarm" }));
  // „Ich fahre“ am Handy → Navigation zum Gerätehaus
  on("answer", ({ going, test, remote }) => {
    if (going && !test && !remote && settings().phone?.navigate === "go") navigateToStation();
  });
  on("settings", ({ path }) => { if (path.startsWith("alarm") || path.startsWith("android") || path.startsWith("phone")) configureNative(); });
  if (settings().android?.service !== false) {
    setBackgroundService(true).catch((e) => log("warn", "Hintergrund-Dienst nicht gestartet", String(e)));
  }
  // Beim ersten Start einmal um die Ausnahme von der Akku-Optimierung bitten (sonst stoppt Android die App im Hintergrund).
  if (!settings().android?.batteryAsked) {
    try {
      const s = await call("status");
      if (s.batteryOptimized) await openBatterySettings();
    } catch (e) {
      log("warn", "Akku-Optimierung nicht abgefragt", String(e));
    }
    set("android.batteryAsked", true);
  }
}
