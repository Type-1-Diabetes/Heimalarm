// Ohne Zentrale: Handy und PC direkt im Heimnetz.
//   PC:    nimmt Alarme und Einstellungen an (Rust-Empfänger, Port 8765).
//          Neue Handys koppeln mit dem Kopplungscode und bekommen einen eigenen Code –
//          so lässt sich jedes Handy einzeln entkoppeln.
//   Handy: schickt jeden erkannten Alarm an alle gekoppelten PCs und gleicht die
//          Einstellungen in beide Richtungen ab (holt ab, schickt zurück – core/sync.js).
import { settings, set, mode } from "./settings.js";
import { log } from "./log.js";
import { emit, on } from "./events.js";
import { isTauri, hasPcFeatures, platformName } from "./platform.js";
import { bundle, applyBundle, syncEnabled, SYNC_LABELS } from "./sync.js";
import { secretKey } from "./shared.js";

export const direct = { ip: "", error: "", peers: {}, lastSync: 0 };   // peers: id -> { ok, error, at }

const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => String(b % 100).padStart(2, "0")).join("");
async function http() { return isTauri ? (await import("@tauri-apps/plugin-http")).fetch : fetch; }
async function invoke(cmd, args) { return (await import("@tauri-apps/api/core")).invoke(cmd, args); }
const deviceName = () => settings().device.name || platformName;

// ── PC ─────────────────────────────────────────────────────────────────────

/** PC: Empfänger starten bzw. Codes aktualisieren – in beiden Betriebsarten (für den Abgleich). */
export async function startReceiver() {
  if (!hasPcFeatures || !isTauri) return;
  if (!settings().direct.code) set("direct.code", newCode());
  if (!settings().direct.hookKey) set("direct.hookKey", secretKey());
  const d = settings().direct;
  try {
    direct.ip = await invoke("direct_server", {
      port: d.port, code: d.code, phones: (d.phones || []).map((p) => p.code), name: deviceName(), hook: d.hookKey,
    });
    direct.error = "";
    await publishConfig();
    if (!direct.listening) {
      direct.listening = true;
      const { listen } = await import("@tauri-apps/api/event");
      await listen("direct-alarm", (e) => {
        try { emit("alarm-in", { who: settings().alarm.me, ts: Date.now(), ...JSON.parse(e.payload), viaPhone: true }); }
        catch { log("warn", "Alarm vom Handy nicht lesbar"); }
      });
      await listen("direct-event", (e) => {
        try { emit("peer-event", { ...JSON.parse(e.payload), via: "phone" }); }
        catch { log("warn", "Nachricht vom Handy nicht lesbar"); }
      });
      await listen("direct-config", (e) => {
        try { applyBundle(JSON.parse(e.payload)); }
        catch { log("warn", "Einstellungen vom Handy nicht lesbar"); }
      });
      await listen("direct-webhook", (e) => {
        const raw = String(e.payload);
        const cut = raw.indexOf("\n");
        receiveWebhook(cut < 0 ? raw : raw.slice(0, cut), cut < 0 ? "" : raw.slice(cut + 1));
      });
      await listen("direct-pair", (e) => {
        try {
          const { code, info } = JSON.parse(e.payload);
          // Dasselbe Handy erneut gekoppelt → alten Eintrag (und damit den alten Code) ersetzen
          const phones = (settings().direct.phones || []).filter((p) => !(info.id && p.id === info.id));
          set("direct.phones", [...phones, { id: info.id || Math.random().toString(36).slice(2, 8), name: info.name || "Handy", code, pairedAt: Date.now(), lastSeen: Date.now() }]);
          log("ok", `Handy „${info.name || "Handy"}“ gekoppelt`);
          openPairing(0);   // ein Handy pro Freigabe
          startReceiver();
        } catch { log("warn", "Kopplung nicht lesbar"); }
      });
      await listen("direct-seen", (e) => {
        const phones = settings().direct.phones || [];
        const p = phones.find((x) => x.code === e.payload);
        if (p && Date.now() - (p.lastSeen || 0) > 60e3) {
          set("direct.phones", phones.map((x) => (x === p ? { ...x, lastSeen: Date.now() } : x)), { silent: true });
          emit("direct", direct);
        }
      });
    }
  } catch (e) { direct.error = String(e); log("warn", "Empfang für das Handy nicht gestartet", direct.error); }
  emit("direct", direct);
}

/** PC: aPager-PRO-Webhook direkt am PC (ohne Zentrale). Gleiche Auswertung wie zentrale/dienst/src/webhook.js. */
function receiveWebhook(query, body) {
  const q = Object.fromEntries(new URLSearchParams(query));
  let json = {};
  try { json = body.trim().startsWith("{") ? JSON.parse(body) : {}; } catch { /* kein JSON */ }
  const all = { ...q, ...json };
  const event = String(all.event || "").toLowerCase();
  const data = { source: "Webhook", keyword: String(all.keyword || ""), unit: String(all.unit || "") };
  if (event === "recall" || event === "clear") {
    emit("alarm-event", { who: settings().alarm.me, ts: Date.now(), event, ...data });
    return;
  }
  for (const k of ["text", "address"]) if (typeof all[k] === "string" && all[k]) data[k] = all[k].slice(0, 1000);
  const details = {};
  for (const [k, v] of Object.entries(all)) {
    if (["who", "keyword", "unit", "text", "address", "event"].includes(k) || v == null || v === "" || typeof v === "object") continue;
    if (JSON.stringify(details).length > 1500) break;
    details[k] = typeof v === "string" ? v.slice(0, 300) : v;
  }
  if (Object.keys(details).length) data.details = details;
  log("ok", "aPager-Webhook empfangen", [data.keyword, data.unit].filter(Boolean).join(" · ") || "ohne Stichwort");
  emit("webhook-alarm", data);   // engine.js: wie ein Alarm aus einer App (mit Zentrale an alle Geräte)
}

/** PC: Adresse für den aPager-Webhook (in aPager unter Labor → Webhooks eintragen). */
export const webhookUrl = () => (direct.ip && settings().direct.hookKey ? `http://${direct.ip}:${settings().direct.port}/apager/${settings().direct.hookKey}` : "");
export async function renewHookKey() { set("direct.hookKey", secretKey()); await startReceiver(); }

/** PC: aktuellen Stand für GET /config hinterlegen und wartende Handys sofort wecken. */
async function publishConfig({ notify = true } = {}) {
  if (!hasPcFeatures || !isTauri) return;
  try {
    await invoke("direct_set_config", { json: JSON.stringify(syncEnabled() ? bundle() : {}) });
    if (notify && syncEnabled()) await invoke("direct_push", { json: JSON.stringify({ type: "config", ts: Date.now() }) });
  } catch { /* nicht verfügbar */ }
}

/** Live-Nachricht an die anderen Geräte ohne Zentrale (z. B. Antwort „Ich fahre“).
 *  PC: an alle wartenden Handys. Handy: an alle gekoppelten PCs (außer `exceptId`). */
export async function sendPeerEvent(ev, exceptId) {
  if (hasPcFeatures) {
    if (!isTauri) return;
    try { await invoke("direct_push", { json: JSON.stringify(ev) }); } catch { /* Empfänger aus */ }
    return;
  }
  const peers = (settings().direct.peers || []).filter((p) => p.paired && p.id !== exceptId);
  await Promise.all(peers.map((p) => call(p, "/event", ev).catch(() => { /* PC aus */ })));
}

/** PC: Koppeln für 5 Minuten erlauben (sonst lehnt der PC neue Handys ab). */
export async function openPairing(minutes = 5) {
  if (!hasPcFeatures || !isTauri) return;
  await invoke("direct_pairing", { minutes });
  direct.pairUntil = minutes ? Date.now() + minutes * 60e3 : 0;
  emit("direct", direct);
  clearTimeout(openPairing.t);
  if (minutes) openPairing.t = setTimeout(() => { direct.pairUntil = 0; emit("direct", direct); }, minutes * 60e3);
}

/** PC: neuen Kopplungscode erzeugen. Bereits gekoppelte Handys bleiben gekoppelt. */
export async function renewCode() { set("direct.code", newCode()); await startReceiver(); }

/** PC: ein Handy entkoppeln – sein Code gilt danach nicht mehr. */
export async function unpairPhone(id) {
  const p = (settings().direct.phones || []).find((x) => x.id === id);
  set("direct.phones", (settings().direct.phones || []).filter((x) => x.id !== id));
  await startReceiver();
  if (p) log("info", `Handy „${p.name}“ entkoppelt`);
}
export const renamePhone = (id, name) => set("direct.phones", (settings().direct.phones || []).map((x) => (x.id === id ? { ...x, name } : x)));

// ── Handy ──────────────────────────────────────────────────────────────────

async function call(peer, path, body) {
  const f = await http();
  const r = await f(`http://${peer.host}:${peer.port || 8765}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "X-Heimalarm-Key": peer.code, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    connectTimeout: 4000,
  });
  if (r.status === 429) throw new Error("Zu viele falsche Versuche – 5 Minuten warten");
  if (r.status === 403) {
    const msg = (await r.json().catch(() => ({}))).error || "";
    if (/Koppeln am PC/u.test(msg)) throw new Error("Am PC „Koppeln erlauben“ drücken, dann erneut");
    if (peer.paired && peer.id) updatePeer(peer.id, { paired: false });   // Code gilt nicht mehr – nicht weiter durchprobieren
    throw new Error(peer.paired ? "Vom PC entkoppelt – neu koppeln" : "Code falsch");
  }
  if (!r.ok) throw new Error(`Fehler ${r.status}`);
  return r.json();
}

const findPeer = (id) => (settings().direct.peers || []).find((p) => p.id === id);
const updatePeer = (id, patch) => set("direct.peers", (settings().direct.peers || []).map((p) => (p.id === id ? { ...p, ...patch } : p)));

/** Handy: mit dem Kopplungscode des PCs einen eigenen Code holen. */
async function pair(peer) {
  const r = await call({ ...peer, paired: false }, "/pair", { id: settings().device.id, name: deviceName() });
  if (!r.code) throw new Error("PC zu alt – dort Heimalarm aktualisieren");
  updatePeer(peer.id, { code: r.code, paired: true, name: peer.nameSet ? peer.name : (r.name || peer.name) });
  return findPeer(peer.id);
}

/** Handy: PC prüfen. Koppelt bei Bedarf (neuer PC, Update von einer älteren Version). */
export async function pingPeer(peer) {
  try {
    const p = peer.paired ? peer : await pair(peer);
    const r = await call(p, "/ping");
    if (!r.paired) throw new Error("Vom PC entkoppelt – neu koppeln");
    if (direct.peers[p.id]?.ok === false) log("ok", `PC „${p.name || p.host}“ wieder erreichbar`, `${p.host}:${p.port}`);
    direct.peers[p.id] = { ok: true, at: Date.now() };
    return true;
  } catch (e) {
    const msg = String(e?.message || e);
    if (direct.peers[peer.id]?.ok !== false || direct.peers[peer.id]?.error !== msg) {
      log("warn", `PC „${peer.name || peer.host}“ nicht erreichbar`, `${peer.host}:${peer.port} · ${msg} · PC an, Heimalarm offen, gleiches WLAN, Firewall „Private Netzwerke“ erlaubt?`);
    }
    direct.peers[peer.id] = { ok: false, error: /koppeln|code|zu alt|versuche/iu.test(msg) ? msg : "nicht erreichbar", at: Date.now() };
    return false;
  } finally { emit("direct", direct); }
}

/** Handy: Alarm an alle gekoppelten PCs – oder nur an einen (Testalarm an ein Gerät). */
export async function sendToPeers(data, onlyId) {
  const peers = (settings().direct.peers || []).filter((p) => !onlyId || p.id === onlyId);
  const res = await Promise.all(peers.map(async (p) => {
    try { await call(p, "/alarm", data); log("action", `${data.test ? "Testalarm" : "Alarm"} an „${p.name}“ gesendet`); return true; }
    catch (e) { log("warn", `„${p.name}“ nicht erreicht`, e.message); return false; }
  }));
  return res.some(Boolean);
}

/** Handy: neuen PC koppeln. */
export async function addPeer({ host, port, code, name }) {
  const peer = { id: Math.random().toString(36).slice(2, 8), host, port: port || 8765, code, name: name || host, nameSet: Boolean(name), paired: false };
  set("direct.peers", [...(settings().direct.peers || []), peer]);
  const ok = await pingPeer(peer);
  if (ok) syncPeers();
  return ok;
}

/** Handy: PC bearbeiten. Mit neuem Kopplungscode wird neu gekoppelt. */
export async function editPeer(id, { name, host, port, code }) {
  const old = findPeer(id);
  if (!old) return false;
  const patch = { name: name || old.name, nameSet: Boolean(name) || old.nameSet, host: host || old.host, port: Number(port) || old.port };
  if (code) Object.assign(patch, { code, paired: false });
  updatePeer(id, patch);
  const ok = await pingPeer(findPeer(id));
  if (ok) syncPeers();
  return ok;
}

export const removePeer = (id) => set("direct.peers", (settings().direct.peers || []).filter((p) => p.id !== id));

/** Handy: Einstellungen mit allen gekoppelten PCs abgleichen (abholen → zusammenführen → zurückschicken). */
export async function syncPeers() {
  if (hasPcFeatures || !syncEnabled()) return;
  const peers = (settings().direct.peers || []).filter((p) => p.paired);
  if (!peers.length) return;
  const got = [];
  for (const p of peers) {
    try { got.push(...applyBundle(await call(p, "/config"))); } catch { /* PC aus – nächster Versuch später */ }
  }
  if (got.length) log("info", "Einstellungen vom PC übernommen", [...new Set(got)].map((s) => SYNC_LABELS[s]).join(", "));
  const body = bundle();
  await Promise.all(peers.map((p) => call(p, "/config", body).catch(() => { /* PC aus */ })));
  direct.lastSync = Date.now();
  emit("direct", direct);
}

// ── Ablauf ─────────────────────────────────────────────────────────────────

let timer;
on("sync-dirty", () => { clearTimeout(timer); timer = setTimeout(() => (hasPcFeatures ? publishConfig() : syncPeers()), 800); });
// Vom Handy übernommen: Stand hinterlegen, aber nicht zurück an das Handy melden (sonst Ping-Pong)
on("sync-applied", () => { if (hasPcFeatures) publishConfig({ notify: false }); });
on("settings", ({ path }) => { if (hasPcFeatures && String(path).startsWith("device")) startReceiver(); });

/** Handy: beim Start abgleichen, danach im eingestellten Abstand und beim Zurückkehren in die App. */
let syncTimer;
const intervalMs = () => Math.max(15, Number(settings().sync?.intervalSec) || 120) * 1000;
function restartSyncTimer() { clearInterval(syncTimer); syncTimer = setInterval(syncPeers, intervalMs()); }
// ── Live: Handy hält zu jedem PC eine lange Abfrage offen (GET /events) ─────
const live = new Map();   // peerId -> { rev, stop }
function watchPeer(peer) {
  if (live.has(peer.id)) return;
  const w = { rev: null, stop: false };
  live.set(peer.id, w);
  (async () => {
    while (!w.stop) {
      const p = findPeer(peer.id);
      if (!p?.paired || mode() !== "direkt") break;
      try {
        const r = await call(p, `/events${w.rev == null ? "" : `?since=${w.rev}`}`);
        const first = w.rev == null;
        w.rev = Number(r.rev) || 0;
        if (first) continue;
        let cfg = false;
        for (const ev of r.events || []) {
          if (ev.type === "config") cfg = true;
          else emit("peer-event", { ...ev, via: "pc", peerId: p.id });
        }
        if (cfg) syncPeers();
      } catch {
        await new Promise((res) => setTimeout(res, 5000));   // PC aus oder WLAN weg – gleich wieder versuchen
      }
    }
    live.delete(peer.id);
  })();
}
function watchPeers() {
  const ids = new Set((settings().direct.peers || []).filter((p) => p.paired).map((p) => p.id));
  for (const [id, w] of live) if (!ids.has(id)) w.stop = true;
  for (const p of settings().direct.peers || []) if (p.paired) watchPeer(p);
}

export function startSync() {
  if (hasPcFeatures) return;
  watchPeers();
  on("settings", ({ path }) => { if (String(path).startsWith("direct.peers") || path === "mode") watchPeers(); });
  for (const p of settings().direct.peers || []) if (!p.paired) pingPeer(p);
  syncPeers();
  restartSyncTimer();
  on("settings", ({ path }) => { if (String(path).startsWith("sync")) restartSyncTimer(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncPeers(); });
}
