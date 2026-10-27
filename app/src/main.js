// Einstieg: Einstellungen laden, Verbindung aufbauen, Ansichten rendern.
import { initUpdates } from "./core/update.js";
import { on } from "./core/events.js";
import { connect, state } from "./core/mqtt.js";
import { init as initEngine } from "./core/engine.js";
import { settings } from "./core/settings.js";
import { log } from "./core/log.js";
import { applyTheme, themeToggle } from "./ui/theme.js";
import { syncAutostart } from "./core/pc.js";
import { ensurePermission, notify } from "./core/notify.js";
import { isAndroid, isTauri, hasPcFeatures } from "./core/platform.js";
import { h, toast } from "./ui/dom.js";
import { overview } from "./views/overview.js";
import { logView, einsaetzeView } from "./views/log.js";
import { settingsView } from "./views/settings.js";
import { showTakeover } from "./views/takeover.js";
import { devicesView } from "./views/devices.js";
import { routinesView } from "./views/routines.js";
import { diagnoseView } from "./views/diagnose.js";
import { dashboardView, dashDragging } from "./views/dashboard.js";
import { wizardView, wizardKeys } from "./views/wizard.js";
import { needsWizard, startWizard, refreshAndroid } from "./core/wizard.js";
import { initAndroid } from "./core/android.js";
import { appLock } from "./core/admin.js";
import { restartDivera } from "./core/divera.js";
import { has } from "./core/features.js";
import { startReceiver, startSync } from "./core/direct.js";
import "./core/livesync.js";
import { initLocalRoutines } from "./core/routines-local.js";
import { initDiscord } from "./core/discord.js";
import { initReadiness } from "./core/readiness.js";
import { initCheckup } from "./core/checkup.js";
import { initTv } from "./core/tvlink.js";

const routes = {
  uebersicht: overview, geraete: devicesView, routinen: routinesView,
  einsaetze: einsaetzeView, protokoll: logView, dashboard: dashboardView, einstellungen: settingsView, diagnose: diagnoseView, einrichtung: wizardView,
};
const NAV_OF = { diagnose: "einstellungen", einrichtung: "einstellungen" };
const view = document.getElementById("view");

function current() {
  const r = location.hash.replace("#/", "").split("/")[0];
  return routes[r] ? r : "uebersicht";
}
const anchor = () => location.hash.replace("#/", "").split("/")[1];

function render() {
  const name = current();
  const y = window.scrollY;
  // Einrichtung: am Handy Vollbild ohne Leiste unten, am PC Hauptmenü gedimmt
  document.body.classList.toggle("wizard-on", name === "einrichtung");
  view.replaceChildren(routes[name](render));
  // Einstellungen kümmern sich selbst um die Scroll-Position (Liste und Seite bleiben stehen)
  const sub = anchor();
  if (name === "einstellungen") { /* views/settings.js */ }
  else if (sub) document.getElementById(sub)?.scrollIntoView({ block: "start" });
  else window.scrollTo(0, y);
  // Geräte und Routinen gibt es nur mit Zentrale
  document.querySelectorAll('.nav-item[data-route="geraete"], .nav-item[data-route="routinen"]').forEach((a) => { a.hidden = !has.routines(); });
  document.querySelectorAll('.nav-item[data-route="einsaetze"]').forEach((a) => { a.hidden = !has.logbuch(); });
  document.querySelectorAll('.nav-item[data-route="dashboard"]').forEach((a) => { a.hidden = !hasPcFeatures; });
  document.querySelectorAll(".nav-item").forEach((a) => {
    if (a.dataset.route === (NAV_OF[name] || name)) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  renderConn();
}

/** Infobereich (Windows): Tooltip zeigt, ob Alarme ankommen. */
let trayText = "";
function trayStatus() {
  if (!hasPcFeatures) return;
  const t = !has.pi() ? "bereit (ohne Zentrale)" : state.connected ? "verbunden, empfängt Alarme" : "keine Verbindung zur Zentrale";
  if (t === trayText) return;
  trayText = t;
  import("@tauri-apps/api/core").then((c) => c.invoke("tray_status", { text: t })).catch(() => {});
}

function renderConn() {
  trayStatus();
  // Unten in der Seitenleiste nur der Hell/Dunkel-Knopf – den Verbindungsstatus zeigt Start
  document.getElementById("conn-badge").replaceChildren(themeToggle());
}

// Neu zeichnen, ohne Eingaben, Dialoge oder Regler zu stören
let pending = 0;
const busy = () => document.querySelector(".dialog-wrap") || dashDragging() || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
const live = () => {
  clearTimeout(pending);
  pending = setTimeout(() => { if (current() === "einstellungen" || busy()) renderConn(); else render(); }, 120);
};

applyTheme();
// Links nach außen (https://…, target="_blank") öffnet die WebView in Tauri nicht – an den Standard-Browser geben
if (isTauri) {
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href^="http://"], a[href^="https://"]');
    if (!a || e.defaultPrevented) return;
    e.preventDefault();
    import("@tauri-apps/plugin-opener").then((o) => o.openUrl(a.href)).catch((err) => log("warn", "Link ließ sich nicht öffnen", `${a.href} · ${err}`));
  });
}
// Im Programm kein Browser-Kontextmenü (außer in Eingabefeldern: Kopieren/Einfügen)
if (isTauri && !import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => { if (!e.target.closest?.("input, textarea, [contenteditable]")) e.preventDefault(); });
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
initEngine();
initLocalRoutines();
initDiscord();
initReadiness();
on("conn", live);
on("devices", live);
on("log", live);
on("shared", live);
on("divera", live);
on("direct", live);
on("update", live);
on("wizard", live);
on("board", () => { if (current() === "dashboard") live(); });
document.addEventListener("keydown", wizardKeys);
// Zurück aus den Android-Einstellungen (Benachrichtigungszugriff, Akku): Haken sofort prüfen
document.addEventListener("visibilitychange", () => { if (!document.hidden && isAndroid) refreshAndroid(); });
on("settings", ({ path }) => { if (path.startsWith("ui")) applyTheme(); });
on("alarm", (a) => { if (!a.own) toast(`Alarm von „${a.who}“`); });
on("takeover", showTakeover);
// Innerhalb der Einstellungen bleibt die Position stehen (views/settings.js entscheidet selbst)
const inSettings = (u) => /#\/einstellungen(\/|$)/u.test(u || "");
window.addEventListener("hashchange", (e) => {
  if (!(inSettings(e.oldURL) && inSettings(e.newURL))) window.scrollTo(0, 0);
  render();
});

// A8 – Offline-Warnung, A9 – fehlendes Lebenszeichen für den eigenen ESP32
setInterval(() => {
  const a = settings().alarm;
  if (!a.mqtt) return;
  const dev = state.devices[a.me];
  if (!dev || dev.warned) return;
  if (dev.online === false && Date.now() - dev.since > a.offlineWarnSec * 1000) {
    dev.warned = true;
    log("warn", "ESP32 ist länger offline", "Stromversorgung und WLAN prüfen");
    notify("Heimalarm: ESP32 offline", "Alarme vom Melder kommen gerade nicht an.");
  } else if (dev.online && dev.lastSeen && Date.now() - dev.lastSeen > a.heartbeatSec * 1000) {
    dev.warned = true;
    log("warn", "ESP32 sendet kein Lebenszeichen", `seit über ${a.heartbeatSec} s`);
  }
}, 10000);

await appLock();
connect();
restartDivera();
startReceiver();
startSync();
initCheckup();
initTv().catch((e) => log("warn", "Dashboard-Fenster nicht verfügbar", String(e)));
on("sync-applied", (secs) => { if (secs.includes("betrieb")) connect(); render(); });
initAndroid().catch((e) => log("warn", "Android-Funktionen nicht verfügbar", String(e)));
initUpdates();
// Nur im Entwicklungsmodus: Beispieldaten mit ?demo, um die Übersicht ohne Zentrale zu prüfen
if (import.meta.env.DEV && location.search.includes("demo")) (await import("./dev/demo.js")).fillDemo(state);
// Erster Start: Einrichtung Schritt für Schritt (nicht beim versteckten Autostart-Start in den Infobereich)
if (needsWizard() && !location.hash.startsWith("#/einrichtung")) {
  if (settings().wizard.step === 0) startWizard();
  location.hash = "#/einrichtung";
}
if (isAndroid) refreshAndroid();
render();
syncAutostart(settings().pc.autostart).catch(() => log("warn", "Autostart konnte nicht gesetzt werden"));
if (isAndroid) ensurePermission();
