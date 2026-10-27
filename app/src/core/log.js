// E7 – Protokoll aller Ereignisse: wann was passiert, gemacht oder ausgeführt wurde.
import { emit } from "./events.js";

const KEY = "heimalarm.log.v1";
const MAX = 500;

/** Arten: alarm | action | ok | warn | info */
let entries = [];
try { entries = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch {}

/** Schlüssel aus Fehlermeldungen entfernen (Adressen enthalten z. B. ?accesskey=… oder ?authToken=…). */
const redact = (v) => String(v ?? "").replace(/((?:accesskey|authtoken|token|key|password|pass)=)[^&\s)"'<>]+/giu, "$1***");

export function log(kind, text, detail = "") {
  const entry = { ts: Date.now(), kind, text: redact(text), detail: redact(detail) };
  entries.unshift(entry);
  entries.length = Math.min(entries.length, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch {}
  emit("log", entry);
  return entry;
}

export const getLog = (kind) => (kind ? entries.filter((e) => e.kind === kind) : entries);

export function clearLog() {
  entries = [];
  try { localStorage.removeItem(KEY); } catch {}
  emit("log", null);
}

// ── Protokoll der anderen Geräte (Handy ↔ PC, mit und ohne Zentrale) ───────
// { <geräte-id>: { name, at, entries } } – nur zum Ansehen, wird nicht weiterverändert.
const RKEY = "heimalarm.log.remote";
let remote = {};
try { remote = JSON.parse(localStorage.getItem(RKEY) || "{}") || {}; } catch {}

/** Eigene letzte Einträge zum Verschicken. */
export const ownLog = (n = 100) => entries.slice(0, n);
export const remoteLogs = () => remote;

/** Fremde Protokolle übernehmen, wo sie neuer sind. `selfId` wird nie übernommen. */
export function mergeRemoteLogs(incoming, selfId) {
  let changed = false;
  for (const [id, v] of Object.entries(incoming || {})) {
    if (id === selfId || !v || !Array.isArray(v.entries)) continue;
    if ((remote[id]?.at || 0) >= (Number(v.at) || 0)) continue;
    remote[id] = { name: String(v.name || "Gerät").slice(0, 60), at: Number(v.at) || Date.now(), entries: v.entries.slice(0, 100) };
    changed = true;
  }
  if (changed) {
    try { localStorage.setItem(RKEY, JSON.stringify(remote)); } catch {}
    emit("log", null);
  }
  return changed;
}

/** Einträge aller anderen Geräte, neueste zuerst, mit Gerätename. */
export const getRemoteLog = () => Object.values(remote)
  .flatMap((d) => d.entries.map((e) => ({ ...e, dev: d.name })))
  .toSorted((a, b) => b.ts - a.ts);
