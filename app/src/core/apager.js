// aPager PRO – Rückmeldung über die Alamos-API (benötigt das Smart-Home-Abo in aPager PRO).
// GET https://alamos-backend.ey.r.appspot.com/fe2/feedback/user/external?authToken=…&mode=accept|reject
// Gilt für Alarme der letzten 3 Minuten. Schlüssel: aPager → Verfügbarkeit → Zahnrad → „Externer Zugriff“.
import { settings } from "./settings.js";
import { log } from "./log.js";
import { isTauri } from "./platform.js";

const URL_BASE = "https://alamos-backend.ey.r.appspot.com/fe2/feedback/user/external";
const CODES = { 204: "Kein Alarm in den letzten 3 Minuten", 400: "Angaben fehlen", 403: "API-Schlüssel falsch", 409: "Smart-Home-Abo fehlt" };

/** Rückmeldung senden. `going` = komme / komme nicht. Liefert { ok, text }. */
export async function answerApager(going, { quiet = false } = {}) {
  const a = settings().apager;
  if (!a.key) return { ok: false, text: "Kein API-Schlüssel" };
  const f = isTauri ? (await import("@tauri-apps/plugin-http")).fetch : fetch;
  const url = `${URL_BASE}?authToken=${encodeURIComponent(a.key)}&mode=${going ? "accept" : "reject"}${a.silent ? "&suppressNotification=true" : ""}`;
  try {
    const r = await f(url, { method: "GET" });
    const text = r.status === 200 ? (going ? "Zusage an aPager gesendet" : "Absage an aPager gesendet") : CODES[r.status] || `Fehler ${r.status}`;
    if (!quiet) log(r.status === 200 ? "action" : "warn", `aPager: ${text}`);
    return { ok: r.status === 200, code: r.status, text };
  } catch (e) {
    if (!quiet) log("warn", "aPager nicht erreichbar", String(e.message || e));
    return { ok: false, text: "Nicht erreichbar" };
  }
}
