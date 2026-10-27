// Vor dem Ruhezustand: Programme nach vorn holen und eine Tastenkombination senden (nur Windows).
// Rust: src-tauri/src/hotkeys.rs (window_list, send_hotkey). Aufgerufen in engine.decide.
import { settings } from "./settings.js";
import { hasPcFeatures } from "./platform.js";
import { log } from "./log.js";

/** Bekannte Programme mit passender Taste. exe immer klein geschrieben. */
export const KNOWN = {
  "blender.exe": { name: "Blender", keys: "Ctrl+S" },
  "robloxstudiobeta.exe": { name: "Roblox Studio", keys: "Ctrl+S" },
  "discord.exe": { name: "Discord", keys: "Ctrl+Shift+M" },   // Stummschalten (Discord-Standard)
  "chrome.exe": { name: "Chrome", keys: "" },                 // keine sinnvolle Vorgabe – selbst wählen
  "opera.exe": { name: "Opera GX", keys: "" },
};

export const STATUS = {
  sent: "gesendet",
  not_running: "läuft nicht",
  elevated: "läuft als Administrator – Windows lässt keine Tasten durch",
  no_focus: "ließ sich nicht nach vorn holen",
  bad_keys: "Tastenkombination ungültig",
};

/** Anzeige: "Ctrl+Shift+S" → "Strg + Umschalt + S" */
export const prettyKeys = (k) => String(k || "").split("+").filter(Boolean)
  .map((x) => ({ ctrl: "Strg", shift: "Umschalt", alt: "Alt", win: "Win", enter: "Eingabe", esc: "Esc", space: "Leertaste", delete: "Entf" }[x.toLowerCase()] || x));

async function core(cmd, args) {
  const c = await import("@tauri-apps/api/core");
  return c.invoke(cmd, args);
}

/** Sichtbare Programme: [{ exe, title, elevated }] */
export const listWindows = () => (hasPcFeatures ? core("window_list") : Promise.resolve([]));
export const sendHotkey = (exe, keys) => core("send_hotkey", { exe, keys });

/** Alle eingeschalteten Regeln nacheinander, danach kurz warten (Speichern braucht Zeit). */
export async function runHotkeys({ dry = false } = {}) {
  const h = settings().pc?.hotkeys;
  if (!hasPcFeatures || !h?.enabled) return;
  const rules = (h.rules || []).filter((r) => r.on !== false && r.exe && r.keys);
  if (!rules.length) return;
  let sent = 0;
  await new Promise((ok) => setTimeout(ok, 400));   // „Fährst du?“-Vollbild ist gerade erst zu
  for (const r of rules) {
    if (dry) { log("info", `Test: ${r.name || r.exe} → ${prettyKeys(r.keys).join("+")}`, "nicht gesendet"); continue; }
    try {
      const res = await sendHotkey(r.exe, r.keys);
      if (res.status === "sent") sent++;
      if (res.status !== "not_running") log(res.status === "sent" ? "action" : "warn", `${r.name || r.exe}: ${prettyKeys(r.keys).join("+")} ${STATUS[res.status] || res.status}`, res.title || "");
    } catch (e) { log("warn", `${r.name || r.exe}: Tasten nicht gesendet`, String(e)); }
  }
  if (sent) await new Promise((ok) => setTimeout(ok, Math.min(30, Math.max(0, Number(h.waitSec) || 2)) * 1000));
}
