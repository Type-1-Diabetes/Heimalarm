// E1 – System-Benachrichtigung bei Alarm (Tauri-Plugin; im Browser die Web-API).
import { isTauri } from "./platform.js";
import { settings } from "./settings.js";

async function api() {
  if (isTauri) return import("@tauri-apps/plugin-notification");
  return {
    isPermissionGranted: async () => typeof Notification !== "undefined" && Notification.permission === "granted",
    requestPermission: async () => (typeof Notification === "undefined" ? "denied" : Notification.requestPermission()),
    sendNotification: ({ title, body }) => new Notification(title, { body }),
  };
}

export async function ensurePermission() {
  try {
    const n = await api();
    if (await n.isPermissionGranted()) return true;
    return (await n.requestPermission()) === "granted";
  } catch { return false; }
}

export async function notify(title, body) {
  if (!settings().notify.enabled) return;
  try {
    const n = await api();
    if (await ensurePermission()) n.sendNotification({ title, body });
  } catch { /* Benachrichtigung ist Komfort, Fehler nicht weitergeben */ }
}
