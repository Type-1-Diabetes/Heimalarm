// D5 – Alarmton für PC und Handy.
// Windows: nativ im Rust-Kern (src-tauri/src/sound.rs), spielt auch bei verstecktem Fenster.
// Android: über das Plugin als Wecker-Ton (Lautstärke „Wecker“ des Handys), siehe AlarmSound.kt.
// Browser (nur Entwicklung): Melder-Zweiklang per Web Audio.
// Ton "" = eingebauter Melder-Ton, sonst Dateiname eines eigenen Tons.
import { isTauri, isAndroid, hasPcFeatures } from "../core/platform.js";

const onAndroid = isTauri && isAndroid;

async function invoke(cmd, args, opts) {
  const core = await import("@tauri-apps/api/core");
  return core.invoke(cmd, args, opts);
}
const plugin = (cmd, args) => invoke(`plugin:heimalarm|${cmd}`, args);

/** Können hier eigene Töne gewählt werden? */
export const canCustomTone = hasPcFeatures || onAndroid;

/* ── Web Audio (Browser) ── */
let ctx = null;
let webLoop = null;
function beep(at, freq, dur, gain) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "square"; o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.01);
  g.gain.setValueAtTime(gain, at + dur - 0.02);
  g.gain.linearRampToValueAtTime(0, at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(at); o.stop(at + dur);
}
function webTone(volume, ms) {
  try {
    ctx ||= new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    const vol = Math.max(0.02, (volume / 100) * 0.35);
    const t = ctx.currentTime;
    for (let i = 0; i * 0.6 < ms / 1000; i++) {
      beep(t + i * 0.6, 880, 0.28, vol);
      beep(t + i * 0.6 + 0.3, 660, 0.28, vol);
    }
  } catch { /* Ton ist Komfort */ }
}

/**
 * Ton abspielen. `ms` = Dauer (0 = bis stopTone()).
 * Fehler (z. B. gelöschte Datei) werfen nicht, sondern fallen auf den Melder-Ton zurück.
 */
export async function playTone({ tone = "", volume = 70, ms = 0 } = {}) {
  await stopTone();
  try {
    if (hasPcFeatures) return await invoke("sound_play", { file: tone || null, volume, ms });
    if (onAndroid) return await plugin("play_sound", { tone, volume, ms });
  } catch {
    if (tone) return playTone({ tone: "", volume, ms });
    return;
  }
  webTone(volume, ms || 1800);
  if (!ms) webLoop = setInterval(() => webTone(volume, 1800), 3000);
}

export async function stopTone() {
  clearInterval(webLoop); webLoop = null;
  try {
    if (hasPcFeatures) await invoke("sound_stop");
    else if (onAndroid) await plugin("stop_sound");
  } catch { /* nichts zu stoppen */ }
}

/** Eigene Töne auf diesem Gerät: [{ id, name }] – id wird in den Einstellungen gespeichert. */
export async function listTones() {
  try {
    if (hasPcFeatures) return (await invoke("sound_list")).map((n) => ({ id: n, name: n.replace(/\.[^.]+$/u, "") }));
    if (onAndroid) return (await plugin("list_sounds")).items || [];
  } catch { /* keine */ }
  return [];
}

/** PC: Datei aus <input type="file"> übernehmen. Gibt die id des Tons zurück. */
export async function uploadTone(file) {
  if (!hasPcFeatures) throw new Error("Nur im Windows-Programm");
  const data = new Uint8Array(await file.arrayBuffer());
  return invoke("sound_save", data, { headers: { name: encodeURIComponent(file.name) } });
}

/** Handy: Android-Dateiauswahl öffnen, Ton wird in die App kopiert. Gibt { id, name } oder null zurück. */
export async function pickTone() {
  const r = await plugin("pick_sound");
  return r?.id ? r : null;
}

export async function deleteTone(id) {
  if (hasPcFeatures) return invoke("sound_delete", { name: id });
  if (onAndroid) return plugin("delete_sound", { id });
}

/**
 * Lautstärke des Geräts: PC = Windows-Gesamtlautstärke, Handy = Lautstärke „Wecker“.
 * { supported, level (0–100), muted }
 */
export async function deviceVolume() {
  try {
    if (hasPcFeatures) return await invoke("system_volume");
    if (onAndroid) return await plugin("alarm_volume");
  } catch { /* unbekannt */ }
  return { supported: false, level: 0, muted: false };
}

/** Geräte-Lautstärke setzen (PC: Windows, Handy: Wecker). `level` 0–100, `muted` optional. */
export async function setDeviceVolume(level, muted) {
  if (hasPcFeatures) return invoke("system_volume_set", { level, muted });
  if (onAndroid) return plugin("set_alarm_volume", { level });
}
