// Divera-Status per Routine – nur für Personen, die ihren Accesskey freiwillig der Zentrale gegeben haben.
// Der Schlüssel kommt einmal über heimalarm/cmd/divera/key { who, key } (nicht retained) und liegt nur in
// data/divera.json. Er steht NICHT in den gemeinsamen Daten; nach außen meldet der Dienst nur, wer einen
// Schlüssel hinterlegt hat: heimalarm/divera/keys { <kennung>: { ok, error, ts } } (retained, ohne Schlüssel).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const FILE = process.env.DIVERA_STORE || "./data/divera.json";
const BASE = "https://app.divera247.com";

export function startDivera(ctx, log) {
  let keys = {};      // kennung -> accesskey
  let info = {};      // kennung -> { ok, error, ts }

  const publishInfo = () => ctx.client.publish("heimalarm/divera/keys", JSON.stringify(info), { retain: true, qos: 1 });
  const save = async () => { await mkdir(dirname(FILE), { recursive: true }); await writeFile(FILE, JSON.stringify(keys), { mode: 0o600 }); };

  readFile(FILE, "utf8").then((t) => { keys = JSON.parse(t || "{}"); for (const w of Object.keys(keys)) info[w] ||= { ok: null }; publishInfo(); })
    .catch(() => publishInfo());

  async function api(key, path, body) {
    const r = await fetch(`${BASE}${path}?accesskey=${encodeURIComponent(key)}`, {
      method: body ? "POST" : "GET",
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error("Accesskey ungültig");
    if (!r.ok || j.success === false) throw new Error(j?.message || `Divera-Fehler ${r.status}`);
    return j.data ?? j;
  }

  async function setKey({ who, key }) {
    if (!who) return;
    if (!key) {
      delete keys[who]; delete info[who];
      await save(); publishInfo();
      return log.info("Divera-Schlüssel entfernt", who);
    }
    try {
      await api(key, "/api/v2/pull/all");
      keys[who] = key; info[who] = { ok: true, ts: Date.now() };
      await save();
      log.info("Divera-Schlüssel hinterlegt", who);
    } catch (e) {
      info[who] = { ok: false, error: e.message, ts: Date.now() };
      log.warn("Divera-Schlüssel nicht übernommen", `${who}: ${e.message}`);
    }
    publishInfo();
  }

  /** Aktion { type: "divera", who, statusId, statusName, note, resetMin, resetTo } */
  async function setStatus(a) {
    const key = keys[a.who];
    if (!key) return log.warn("Divera-Status nicht gesetzt", `Für „${a.who}“ ist kein Schlüssel auf der Zentrale hinterlegt`);
    const Status = { id: Number(a.statusId) };
    if (a.note) Status.note = a.note;
    if (Number(a.resetMin) > 0 && a.resetTo) { Status.reset_date = Math.floor(Date.now() / 1000) + Number(a.resetMin) * 60; Status.reset_to = Number(a.resetTo); }
    try {
      await api(key, "/api/v2/statusgeber/set-status", { Status });
      log.action("Divera-Status gesetzt", `${a.who}: ${a.statusName || a.statusId}`);
    } catch (e) { log.warn("Divera-Status nicht gesetzt", `${a.who}: ${e.message}`); }
  }

  return { command: (cmd, data) => { if (cmd === "key") setKey(data).catch((e) => log.warn("Divera", e.message)); }, setStatus };
}
