// PC-Funktionen (nur Windows-Programm). Ausführung im Rust-Kern, siehe src-tauri/src/lib.rs.
import { isTauri, hasPcFeatures } from "./platform.js";

export const ACTIONS = {
  hibernate: { label: "Ruhezustand", hint: "Alles bleibt offen, PC ist stromlos. Empfohlen." },
  sleep: { label: "Energiesparen", hint: "Schnell wieder da, braucht weiter etwas Strom." },
  lock: { label: "Nur sperren", hint: "PC läuft weiter, Bildschirm gesperrt." },
  shutdown: { label: "Herunterfahren", hint: "Kann an „Speichern?“-Dialogen hängen bleiben." },
  mixed: { label: "Mischform", hint: "Fährt herunter. Hängt es länger als 2 min, Ruhezustand." },
  none: { label: "Nichts tun", hint: "Nur Abfrage und Protokoll." },
};

async function callCore(cmd, args) {
  if (!isTauri) throw new Error("Nur im Programm verfügbar");
  const core = await import("@tauri-apps/api/core");
  return core.invoke(cmd, args);
}

export const runPcAction = (action) => callCore("pc_action", { action });
/** D7 – welche der Programme laufen gerade? */
export const runningProcesses = (names) => (hasPcFeatures ? callCore("running_processes", { names }) : Promise.resolve([]));
/** D8 – Medienwiedergabe stoppen */
export const stopMedia = () => (hasPcFeatures ? callCore("stop_media") : Promise.resolve());
/** D10 – Ruhezustand prüfen / einschalten (fragt nach Admin-Rechten) */
export const hibernateEnabled = () => callCore("hibernate_enabled");
export const enableHibernate = () => callCore("enable_hibernate");
/** D11 – MAC-Adresse dieses PCs ermitteln */
export const macAddress = () => callCore("mac_address");
/** D11 – Wake-on-LAN direkt aus der App (Handy oder PC) */
export const wakeOnLan = (mac) => callCore("wake_on_lan", { mac });

/** D6 – Abfrage im Vollbild auf allen Bildschirmen, immer im Vordergrund (src-tauri/src/takeover.rs). */
export async function takeoverWindow(on) {
  if (!hasPcFeatures) return;
  try { await callCore("takeover_open", { on }); }
  catch {
    // Rückfall: nur das Hauptfenster
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    if (on) { await w.unminimize(); await w.show(); await w.setAlwaysOnTop(true); await w.setFullscreen(true); await w.setFocus(); }
    else { await w.setFullscreen(false); await w.setAlwaysOnTop(false); }
  }
}

export async function setAutostart(enabled) {
  if (!hasPcFeatures) return;
  const m = await import("@tauri-apps/plugin-autostart");
  if (enabled) await m.enable(); else await m.disable();
}

/** D9 – Autostart beim Start an die Einstellung angleichen. */
export async function syncAutostart(enabled) {
  if (!hasPcFeatures) return;
  const m = await import("@tauri-apps/plugin-autostart");
  // Bei „an“ immer neu eintragen, damit der Eintrag den Hintergrund-Start (--im-hintergrund) enthält.
  if (enabled) await m.enable();
  else if (await m.isEnabled()) await m.disable();
}
