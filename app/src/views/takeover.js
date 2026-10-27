// „Fährst du?“ – Vollbild-Abfrage mit Countdown (D1–D6).
// Enter = fahren, Esc = bleiben. Texte und Ton aus den Einstellungen.
// Weitere Bildschirme zeigen dieselbe Abfrage (mirror.html), die Antwort kommt per Ereignis zurück.
import { h, fmtTime } from "../ui/dom.js";
import { settings } from "../core/settings.js";
import { shared } from "../core/shared.js";
import { on } from "../core/events.js";
import { decide } from "../core/engine.js";
import { ACTIONS, takeoverWindow } from "../core/pc.js";
import { hasPcFeatures, isAndroid, isTauri } from "../core/platform.js";
import { phoneAlarm, stopPhoneAlarm } from "../core/android.js";
import { playTone, stopTone, deviceVolume, setDeviceVolume } from "../ui/sound.js";

let timer = null;
let active = null;   // laufende Abfrage: { finish }

/** Windows-Lautstärke für die Dauer des Alarms anheben (D5), danach zurück. */
async function raiseVolume(p) {
  if (!hasPcFeatures || !p.raiseSystem) return null;
  try {
    const before = await deviceVolume();
    if (!before.supported) return null;
    const target = Math.max(before.level, Number(p.systemMin) || 60);
    await setDeviceVolume(target, false);
    return before;
  } catch { return null; }
}

const SRC = { ESP32: "Melder", apager: "aPager", divera: "Divera", sybos: "SYBOS" };

/** Seitenleiste „Lagebild“: wann kam welche Quelle, welche Routinen laufen beim Alarm. */
function sideInfo(alarm) {
  const srcs = (alarm.sources || [alarm.source]).filter(Boolean);
  const routines = (shared().routines || []).filter((r) => r.enabled !== false && r.trigger?.type === "alarm" && (!r.who?.length || r.who.includes(alarm.who)));
  const rows = srcs.map((k, i) => h("li", {}, h("span", {}, SRC[k] || k),
    h("span.mono", {}, i === 0 ? fmtTime(alarm.ts) : alarm.srcAt?.[k] != null ? `+${alarm.srcAt[k]} s` : "")));
  return [
    rows.length > 0 && h("section", {}, h("h2", {}, "Eingang"), h("ul", {}, rows)),
    routines.length > 0 && h("section", {}, h("h2", {}, "Zuhause"), h("ul", {}, routines.map((r) => h("li.run", {}, h("span", {}, r.name || "Routine"))))),
  ];
}

/** Läuft gerade eine Abfrage? */
export const takeoverOpen = () => Boolean(active);
/** Abfrage schließen, ohne selbst zu entscheiden (z. B. am anderen Gerät beantwortet). */
export function closeTakeover() { active?.finish(null); }

export function showTakeover(alarm) {
  active?.finish(null);   // eine neue Abfrage ersetzt eine noch offene
  const root = document.getElementById("takeover");
  const p = settings().pc;
  const test = Boolean(alarm.test);
  const onPhone = isTauri && isAndroid;
  // Handy: so lange, wie es klingeln soll; danach ohne Rückmeldung zu
  const total = Math.max(5, onPhone ? Number(settings().phone?.durationSec) || 60 : p.countdownSec);
  let left = total;
  let done = false;
  let restore = null;
  const unlisten = [];

  const num = h("span.count-num", { "aria-hidden": "true" }, String(left));
  const fill = h("i", { style: "width:100%" });
  const ring = h("div.count", { role: "img", "aria-label": `Noch ${left} Sekunden` }, num,
    h("div.count-bar", {}, h("div.count-track", {}, fill), h("small", {}, onPhone ? "Sekunden" : p.onTimeout === "run" ? `Sekunden bis ${ACTIONS[p.action]?.label || p.action}` : "Sekunden")));
  const side = h("aside.side");
  const showSide = () => { const c = sideInfo(alarm).filter(Boolean); side.replaceChildren(...c); side.hidden = !c.length; };
  const live = h("p.sr-only", { "aria-live": "assertive", "aria-atomic": "true" });
  const label = ACTIONS[p.action]?.label || p.action;
  let extra = [alarm.keyword, alarm.unit].filter(Boolean).join(" · ");
  // Melder zuerst: Stichwort und Ort kommen meist ein paar Sekunden später (engine.js → „alarm-update“)
  const waiting = () => !test && !alarm.keyword && !alarm.address && alarm.source === "ESP32";
  const extraEl = h("p.meta-big", {}, extra);
  const addrEl = h("p.meta", {}, alarm.address || "");
  const showInfo = () => {
    extra = [alarm.keyword, alarm.unit].filter(Boolean).join(" · ");
    extraEl.textContent = extra || (waiting() ? (Date.now() - alarm.ts > 90e3 ? "Keine Einsatzinfos" : "Einsatzinfos folgen …") : "");
    extraEl.classList.toggle("pending", !extra && waiting());
    addrEl.textContent = alarm.address || "";
    showSide();
    extraEl.hidden = !extraEl.textContent; addrEl.hidden = !addrEl.textContent;
  };
  const tag = alarm.probe ? "Generalprobe · PC-Aktion nur angezeigt" : test ? "Testalarm · es passiert nichts" : `Einsatz · ${fmtTime(alarm.ts)}`;
  const note = onPhone ? "Ohne Antwort: keine Rückmeldung" : p.onTimeout === "run" ? `Ohne Antwort: ${label}` : "Ohne Antwort: keine Aktion";

  /** going = true/false: Antwort; null = ersetzt (keine Entscheidung). Läuft genau einmal. */
  const finish = (going, timeout = false) => {
    if (done) return;
    done = true;
    active = null;
    clearInterval(timer); timer = null;
    stopTone();
    if (onPhone) stopPhoneAlarm();
    if (restore) setDeviceVolume(restore.level, restore.muted).catch(() => {});
    document.removeEventListener("keydown", keys);
    unlisten.forEach((u) => u());
    root.hidden = true; root.replaceChildren();
    takeoverWindow(false);
    if (going !== null) decide(going, { test, timeout });
  };
  const keys = (e) => {
    if (e.repeat) return;
    // Enter auf einem fokussierten Knopf löst dessen Klick aus – nicht zusätzlich hier
    if (e.key === "Enter" && e.target.closest?.("#takeover button")) return;
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };
  active = { finish };

  // Zustand an die anderen Bildschirme senden
  const broadcast = async () => {
    if (!hasPcFeatures) return;
    try {
      const { emit } = await import("@tauri-apps/api/event");
      emit("takeover-state", { tag, title: p.title || "Fährst du?", extra, address: alarm.address || "", left: Math.max(left, 0), total, goText: p.goText || "Ich fahre", stayText: p.stayText || "Ich fahre nicht", note });
    } catch { /* nur Komfort */ }
  };
  unlisten.push(on("alarm-update", (a) => { if (a === alarm || a.ts === alarm.ts) { Object.assign(alarm, a); showInfo(); broadcast(); } }));
  if (hasPcFeatures) {
    import("@tauri-apps/api/event").then(async ({ listen }) => {
      if (done) return;
      unlisten.push(await listen("takeover-answer", ({ payload }) => finish(Boolean(payload?.going))));
      unlisten.push(await listen("takeover-ready", broadcast));
    }).catch(() => {});
  }

  root.replaceChildren(h("div.lage", {},
    h("div.box", {},
      h("div.tag", {}, tag),
      h("h1", {}, p.title || "Fährst du?"),
      extraEl,
      addrEl,
      ring, live,
      h("div.actions", {},
        h("button.btn.primary", { type: "button", onclick: () => finish(true) }, p.goText || "Ich fahre", !onPhone && h("kbd", {}, "Enter")),
        h("button.btn.secondary", { type: "button", onclick: () => finish(false) }, p.stayText || "Ich fahre nicht", !onPhone && h("kbd", {}, "Esc"))),
      h("p.note", {}, note)),
    side));
  showInfo();
  root.hidden = false;
  takeoverWindow(true);
  raiseVolume(p).then((v) => { if (done && v) setDeviceVolume(v.level, v.muted).catch(() => {}); else restore = v; });
  if (onPhone) {
    // Handy: Vollbild-Meldung (auch Sperrbildschirm), Vibration und Wecker-Ton laufen nativ weiter, auch wenn die App im Hintergrund ist
    phoneAlarm({ title: p.title || "Fährst du?", text: [tag, extra].filter(Boolean).join(" · "), test });
  } else if (p.sound) playTone({ tone: p.tone, volume: p.volume, ms: 0 });
  document.addEventListener("keydown", keys);
  root.querySelector(".btn.primary").focus();
  live.textContent = `${p.title || "Fährst du?"} Noch ${left} Sekunden. Enter fahren, Escape bleiben.`;

  clearInterval(timer);
  timer = setInterval(() => {
    left -= 1;
    const l = Math.max(left, 0);
    num.textContent = String(l);
    fill.style.width = `${(l / total) * 100}%`;
    ring.setAttribute("aria-label", `Noch ${l} Sekunden`);
    if (l > 0 && (l % 10 === 0 || l <= 5)) live.textContent = `Noch ${l} Sekunden`;
    if (extraEl.classList.contains("pending")) showInfo();
    broadcast();
    if (left <= 0) finish(p.onTimeout === "run", true);
  }, 1000);
  broadcast();
}
