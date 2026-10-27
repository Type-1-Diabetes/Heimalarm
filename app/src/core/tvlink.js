// Hauptfenster ↔ TV-Fenster (tv.html). Öffnet/schließt die Fenster der eingeschalteten Dashboards,
// schickt ihnen den Schnappschuss (core/board.js) und führt ihre Bedienungen aus.
// Nur im Windows-Programm; im Browser und am Handy passiert hier nichts.
import { on } from "./events.js";
import { log } from "./log.js";
import { hasPcFeatures, isTauri } from "./platform.js";
import { dashboards } from "./dashboard.js";
import { snapshot, act, alarmActive, boardUse } from "./board.js";

const open = new Map();   // id -> Bildschirm-Schlüssel, für den das Fenster gerade offen ist
let tauriEvent = null;
let core = null;

/** Bildschirme für die Auswahl im Editor: [{ key, name, width, height, primary }]. */
export async function screens() {
  if (!isTauri || !hasPcFeatures) return [];
  core ||= await import("@tauri-apps/api/core");
  try { return await core.invoke("tv_screens"); } catch { return []; }
}

/** Schnappschuss + je Dashboard, ob die Alarm-Ansicht gilt. */
export function tvState() {
  return { snap: snapshot(), dashes: dashboards(), alarm: Object.fromEntries(dashboards().map((d) => [d.id, d.alarmSwitch !== false && alarmActive(d.backMin)])) };
}

let pushTimer = 0;
function push() {
  if (!tauriEvent || !open.size) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => tauriEvent.emit("tv-state", tvState()).catch(() => {}), 250);
}

/** Fenster an die Einstellungen angleichen: eingeschaltete öffnen, andere schließen. */
async function syncWindows() {
  if (!isTauri || !hasPcFeatures) return;
  core ||= await import("@tauri-apps/api/core");
  const want = new Map(dashboards().filter((d) => d.on).map((d) => [d.id, d.monitor || ""]));
  for (const [id, screen] of open) {
    if (want.get(id) === screen) continue;
    await core.invoke("tv_open", { id, screen, on: false }).catch(() => {});
    open.delete(id);
    boardUse(-1);
  }
  for (const [id, screen] of want) {
    if (open.has(id)) continue;
    try {
      await core.invoke("tv_open", { id, screen, on: true });
      open.set(id, screen);
      boardUse(+1);
      log("info", "Dashboard geöffnet", dashboards().find((d) => d.id === id)?.name || id);
    } catch (e) { log("warn", "Dashboard ließ sich nicht öffnen", String(e)); }
  }
  push();
}

export async function initTv() {
  if (!isTauri || !hasPcFeatures) return;
  tauriEvent = await import("@tauri-apps/api/event");
  await tauriEvent.listen("tv-ready", () => push());
  await tauriEvent.listen("tv-action", ({ payload }) => act(payload));
  for (const ev of ["board", "divera", "conn", "devices", "shared", "log", "alarm", "alarm-update", "restore"]) on(ev, push);
  on("settings", ({ path }) => { if (path === "dashboards") syncWindows(); else if (path.startsWith("ui")) push(); });
  setInterval(push, 30_000);   // Zeitabläufe („Zurück nach“, Termine) auch ohne Ereignis
  syncWindows();
}
