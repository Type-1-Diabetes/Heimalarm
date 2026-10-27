// A7 / H2 – Webhook-Empfang, z. B. von aPager PRO.
//   POST|GET http://<zentrale>:8080/alarm/<geheimnis>?who=<kennung>&keyword=..&unit=..
// aPager sendet Stichwort und Einheit als Query oder JSON ({ keyword, unit }) – ab Android 6.9 einmal je Einheit
// (die Sperrzeit fasst sie zu einem Einsatz zusammen). event=recall|clear = Rückalarm / Alarmende.
import { createServer } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";

// Nach 10 falschen Schlüsseln ist eine Adresse 5 Minuten gesperrt (wie der PC-Empfänger).
const MAX_FAILS = 10, LOCK_MS = 5 * 60e3;
const fails = new Map(); // ip -> { n, at }
const lockedOut = (ip) => {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() - f.at > LOCK_MS) { fails.delete(ip); return false; }
  return f.n >= MAX_FAILS;
};
const recordFail = (ip) => {
  if (fails.size > 1000) for (const [k, f] of fails) if (Date.now() - f.at > LOCK_MS) fails.delete(k);   // alte Sperren aufräumen
  const f = fails.get(ip) || { n: 0, at: 0 };
  fails.set(ip, { n: f.n + 1, at: Date.now() });
};
/** Kennung wie in der App (core/kennung.js): sonst könnte „/“, „+“ oder „#“ fremde Topics treffen (z. B. alarm/x/ota). */
const KENNUNG = /^[a-z0-9-]{1,32}$/iu;
/** Vergleich in fester Zeit (über Hashes, damit auch die Länge nichts verrät). */
const sameSecret = (a, b) => timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest());

export function startWebhook(ctx, log) {
  const port = Number(process.env.WEBHOOK_PORT || 8080);
  createServer((req, res) => {
    const ip = req.socket.remoteAddress || "";
    if (lockedOut(ip)) return end(res, 429, "zu viele falsche Versuche – 5 Minuten warten");
    const url = new URL(req.url, "http://x");
    const [, route, secret] = url.pathname.split("/");
    if (route !== "alarm") return end(res, 404, "nicht gefunden");
    if (!ctx.config.webhookSecret || !sameSecret(secret || "", ctx.config.webhookSecret)) {
      recordFail(ip);
      log.warn("Webhook mit falschem Schlüssel abgelehnt", lockedOut(ip) ? `${ip} für 5 Minuten gesperrt` : ip);
      return end(res, 403, "falscher Schlüssel");
    }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
      let json = {};
      try { json = body ? JSON.parse(body) : {}; } catch { /* kein JSON */ }
      const who = String(url.searchParams.get("who") || json.who || ctx.config.persons?.[0]?.id || "ich");
      if (!KENNUNG.test(who)) return end(res, 400, "ungültige Kennung (nur a–z, 0–9 und -)");
      const payload = {
        source: "Webhook",
        keyword: url.searchParams.get("keyword") || json.keyword || "",
        unit: url.searchParams.get("unit") || json.unit || "",
      };
      // Alle weiteren einfachen Angaben mitgeben (Adresse, Text, Einsatznummer …) – fürs Einsatz-Logbuch der App
      const extra = { ...Object.fromEntries(url.searchParams), ...json };
      for (const k of ["text", "address"]) if (typeof extra[k] === "string" && extra[k]) payload[k] = extra[k].slice(0, 1000);
      const details = {};
      for (const [k, v] of Object.entries(extra)) {
        if (["who", "keyword", "unit", "text", "address", "event"].includes(k) || v == null || v === "" || !["string", "number", "boolean"].includes(typeof v)) continue;
        if (JSON.stringify(details).length > 1500) break;
        details[k] = typeof v === "string" ? v.slice(0, 300) : v;
      }
      if (Object.keys(details).length) payload.details = details;
      // aPager PRO: Rückalarm / Alarmende (event=recall|clear) ist kein neuer Alarm → eigenes Topic,
      // die Apps vermerken es am Einsatz, Routinen laufen nicht.
      const event = String(url.searchParams.get("event") || json.event || "").toLowerCase();
      if (event === "recall" || event === "clear") {
        ctx.client.publish(`alarm/${who}/event`, JSON.stringify({ event, source: "Webhook", keyword: payload.keyword, unit: payload.unit }), { qos: 1 });
        log.info(event === "recall" ? "Rückalarm empfangen" : "Alarmende empfangen", `${who} · ${payload.keyword || payload.unit || "Webhook"}`);
        return end(res, 200, "ok");
      }
      ctx.client.publish(`alarm/${who}`, JSON.stringify(payload), { qos: 1 });
      log.ok("Webhook empfangen", `${who} · ${payload.keyword || "ohne Stichwort"}${payload.unit ? " · " + payload.unit : ""}`);
      end(res, 200, "ok");
    });
  }).listen(port, () => log.info("Webhook bereit", `Port ${port}`));
}

function end(res, code, text) {
  res.writeHead(code, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}
