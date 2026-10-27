// Updates aus GitHub Releases – wie bei RigCheck: neueste Version abfragen, Datei laden,
// Prüfsumme (<datei>.sha256 aus demselben Release) vergleichen, installieren.
// Windows: Setup still ausführen und neu starten (Rust: install_update).
// Android: APK laden und den System-Installationsdialog öffnen (Plugin: install_apk).
import { isTauri, isAndroid, hasPcFeatures } from "./platform.js";
import { settings } from "./settings.js";
import { emit } from "./events.js";
import { log } from "./log.js";
import { APP_VERSION } from "./mqtt.js";

export const LATEST_API = "https://api.github.com/repos/Type-1-Diabetes/Heimalarm/releases/latest";
export const RELEASES_URL = "https://github.com/Type-1-Diabetes/Heimalarm/releases";

/** Zustand für die Oberfläche. available: { version, tag, notes, url, sha256Url, page } */
export const update = { checking: false, installing: false, available: null, message: "", checkedAt: 0, progress: "",
  /** Laufender Download: { stage: download|verify|install, loaded, total, startedAt } */
  dl: null };

const changed = () => emit("update", update);

/** "v0.2.0" / "0.2.0-beta" → [0, 2, 0] */
export function parseVersion(text) {
  const m = String(text || "").trim().replace(/^v/iu, "").split(/[-+]/u)[0].match(/^(\d+)\.(\d+)(?:\.(\d+))?$/u);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}
export function isNewer(remote, local) {
  const a = parseVersion(remote), b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Passende Datei im Release: Windows-Setup bzw. APK. */
function pickAsset(assets) {
  const want = isAndroid ? (n) => n.endsWith(".apk") : (n) => /-setup\.exe$/iu.test(n);
  const file = assets.find((a) => want(a.name));
  if (!file) return null;
  const sha = assets.find((a) => a.name === `${file.name}.sha256`);
  return { url: file.browser_download_url, name: file.name, sha256Url: sha?.browser_download_url || null };
}

const fetchFn = async (...a) => (isTauri ? (await import("@tauri-apps/plugin-http")).fetch : fetch)(...a);

export async function checkUpdate({ quiet = false } = {}) {
  if (update.checking) return update;
  update.checking = true; update.message = "Suche nach Updates …"; changed();
  try {
    const r = await fetchFn(LATEST_API, { headers: { Accept: "application/vnd.github+json" } });
    if (r.status === 404) {
      // GitHub antwortet bei privaten Repos ohne Anmeldung mit 404 – genauso wie ohne Release.
      update.available = null;
      update.message = "Keine Releases abrufbar – das Repository ist noch privat oder hat kein Release.";
      return update;
    }
    if (r.status === 403) { update.message = "GitHub-Abfragelimit erreicht – in einer Stunde erneut versuchen."; return update; }
    if (!r.ok) throw new Error(`GitHub antwortet mit ${r.status}`);
    const j = await r.json();
    const asset = pickAsset(j.assets || []);
    if (isNewer(j.tag_name, APP_VERSION) && asset) {
      update.available = { version: String(j.tag_name).replace(/^v/iu, ""), tag: j.tag_name, notes: String(j.body || "").slice(0, 600), page: j.html_url, ...asset };
      update.message = `Heimalarm ${update.available.version} ist verfügbar (installiert: ${APP_VERSION}).`;
      if (quiet) log("info", "Update verfügbar", update.available.version);
    } else {
      update.available = null;
      update.message = `Heimalarm ist aktuell (${APP_VERSION}).`;
    }
  } catch (e) {
    update.message = `GitHub nicht erreichbar: ${e.message || e}`;
    if (!quiet) log("warn", "Update-Prüfung fehlgeschlagen", String(e.message || e));
  } finally {
    update.checking = false; update.checkedAt = Date.now(); changed();
  }
  return update;
}

/** Herunterladen, prüfen, installieren. Windows startet danach neu, Android zeigt den Installationsdialog. */
export async function installUpdate() {
  const u = update.available;
  if (!u || update.installing) return;
  if (!isTauri) { window.open(u.page, "_blank"); return; }
  update.installing = true; update.progress = ""; update.dl = { stage: "download", loaded: 0, total: 0, startedAt: Date.now() }; changed();
  let stop = NOOP;
  try {
    const core = await import("@tauri-apps/api/core");
    stop = await listenProgress(core);
    if (hasPcFeatures) {
      // Lädt, prüft, startet das Setup still und beendet die App – sie startet danach von selbst neu.
      await core.invoke("install_update", { url: u.url, shaUrl: u.sha256Url || "" });
    } else if (isAndroid) {
      const res = await core.invoke("plugin:heimalarm|install_apk", { url: u.url, shaUrl: u.sha256Url || "" });
      update.progress = res?.needsPermission
        ? "Bitte „Apps aus dieser Quelle zulassen“ für Heimalarm erlauben und dann erneut „Installieren“ tippen."
        : "Installationsdialog geöffnet – dort „Aktualisieren“ tippen.";
    }
  } catch (e) {
    update.progress = `Update fehlgeschlagen: ${e.message || e}`;
    log("warn", "Update fehlgeschlagen", String(e.message || e));
  } finally {
    stop();
    update.installing = false;
    if (update.dl?.stage !== "install" || update.progress.startsWith("Update fehlgeschlagen")) update.dl = null;
    changed();
  }
}

/** Fortschritt vom Rust-Befehl (PC) bzw. Android-Plugin – höchstens 5× pro Sekunde. */
function onProgress(p) {
  if (!p || !update.dl) return;
  update.dl = { ...update.dl, stage: p.stage, loaded: Number(p.loaded) || 0, total: Number(p.total) || 0 };
  changed();
}
const NOOP = () => {};
async function listenProgress(core) {
  const onP = onProgress;
  try {
    if (hasPcFeatures) {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen("update-progress", ({ payload }) => onP(payload));
    }
    if (isAndroid) {
      const l = await core.addPluginListener("heimalarm", "update-progress", onP);
      return () => l.unregister?.();
    }
  } catch { /* ohne Fortschritt geht es trotzdem */ }
  return NOOP;
}

/** Beim Start und danach alle 6 Stunden prüfen (abschaltbar), kurz verzögert, damit der Start nicht wartet. */
export function initUpdates() {
  if (!isTauri || settings().update?.auto === false) return;
  setTimeout(() => checkUpdate({ quiet: true }), 4000);
  // Läuft oft wochenlang im Infobereich bzw. Hintergrund – darum alle 6 Stunden erneut prüfen.
  setInterval(() => { if (settings().update?.auto !== false && !update.available) checkUpdate({ quiet: true }); }, 6 * 60 * 60 * 1000);
}
