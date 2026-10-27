// Verbindungs-Check für die Status-Karte auf Start: prüft nacheinander, was eingerichtet ist,
// und meldet jeden Schritt („verbinde Zentrale …“, „Zentrale ok“). Ergebnis: alles ok oder fehlgeschlagen.
// Läuft beim Start, nach jedem Verbindungsabbruch und auf Knopfdruck.
import { emit, on } from "./events.js";
import { settings } from "./settings.js";
import { state, mqttLastError, explainMqttError, connect, offlineSince } from "./mqtt.js";
import { log } from "./log.js";
import { restartDivera } from "./divera.js";
import { startReceiver } from "./direct.js";
import { has } from "./features.js";
import { direct, pingPeer } from "./direct.js";
import { divera, loadDivera } from "./divera.js";
import { hasPcFeatures } from "./platform.js";

export const checkup = {
  running: false,
  line: "",            // aktuelle Zeile („verbinde …“ oder „… ok“)
  lineOk: null,        // true/false für die Farbe des Ergebnisses, null = läuft
  failed: [],          // Namen, die nicht erreichbar waren
  done: false,         // mindestens einmal durchgelaufen
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Bis zu `ms` warten, bis `test()` wahr ist. */
async function until(test, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (test()) return true; await sleep(250); }
  return test();
}

/** Was geprüft wird – nur, was eingerichtet ist (wie die Übersicht). */
function steps() {
  const s = settings();
  const list = [];
  // why(): Grund und Hinweis, wenn der Schritt fehlschlägt (landet im Protokoll)
  if (has.pi()) list.push({ name: `Zentrale ${s.broker.host}:${s.broker.port}`, run: () => until(() => state.connected, 8000),
    why: () => (mqttLastError() ? explainMqttError(mqttLastError()).join(" · ") : "Keine Antwort in 8 s · Ist die Zentrale an, IP und Port 9001 richtig, PC und Zentrale im selben Netz?") });
  // Melder: erst entscheiden, wenn die Zentrale ihre gespeicherten Meldungen geschickt hat.
  if (has.esp()) {
    list.push({ name: "Melder", run: async () => {
      await until(() => state.devices[s.alarm.me], 5000);
      return until(() => state.devices[s.alarm.me]?.online, 3000);
    },
    why: () => {
      if (!state.connected) return "Ohne Zentrale kein Melder";
      if (state.devices[s.alarm.me]) return `ESP32 „${s.alarm.me}“ meldet sich offline · Strom und WLAN (2,4 GHz) prüfen`;
      return `ESP32 „${s.alarm.me}“ hat sich noch nie gemeldet · Ist er an? Kennung überall „${s.alarm.me}“? mqtt_pw richtig?`;
    } });
  }
  if (has.direct() && hasPcFeatures) list.push({ name: "Empfang vom Handy", run: () => until(() => direct.ip && !direct.error, 4000),
    why: () => direct.error || "Empfänger nicht gestartet · Port 8765 frei? Firewall „Private Netzwerke“ erlaubt?" });
  if (has.direct() && !hasPcFeatures) for (const p of s.direct.peers || []) list.push({ name: p.name || p.host, run: () => pingPeer(p),
    why: () => `${direct.peers[p.id]?.error || "nicht erreichbar"} · PC an, Heimalarm offen, gleiches WLAN, Adresse ${p.host}:${p.port}?` });
  if (has.diveraApi()) list.push({ name: "Divera", run: async () => { await loadDivera().catch((e) => { divera.ok = false; divera.error = e.message; divera.detail = e.detail; }); return divera.ok !== false; },
    why: () => [divera.error, divera.detail].filter(Boolean).join(" · ") || "Abfrage fehlgeschlagen" });
  return list;
}

let runId = 0;
export async function runCheckup({ reason = "" } = {}) {
  const id = ++runId;
  const list = steps();
  log("info", `Verbindungen werden geprüft${reason ? ` (${reason})` : ""}`, list.map((x) => x.name).join(" · ") || "Nichts eingerichtet, was geprüft werden kann");
  Object.assign(checkup, { running: true, failed: [], line: "", lineOk: null });
  const show = (line, ok = null) => { if (id !== runId) return; checkup.line = line; checkup.lineOk = ok; emit("checkup", checkup); };
  for (const st of list) {
    show(`verbinde ${st.name} …`);
    let ok = false;
    try { ok = Boolean(await st.run()); } catch { ok = false; }
    if (id !== runId) return;
    show(`${st.name} ${ok ? "ok" : "fehlgeschlagen"}`, ok);
    if (!ok) { checkup.failed.push(st.name); log("warn", `Prüfung fehlgeschlagen: ${st.name}`, st.why?.() || ""); }
    await sleep(ok ? 350 : 900);
  }
  if (id !== runId) return;
  if (list.length && !checkup.failed.length) { show("Alle Verbindungen ok", true); await sleep(900); }
  if (id !== runId) return;
  if (list.length) log(checkup.failed.length ? "warn" : "ok", checkup.failed.length ? `Prüfung beendet: ${checkup.failed.length} von ${list.length} fehlgeschlagen` : `Prüfung beendet: alle ${list.length} Verbindungen ok`, checkup.failed.join(" · "));
  Object.assign(checkup, { running: false, done: true });
  emit("checkup", checkup);
}

/** Beim Start und bei Verbindungsabbruch automatisch prüfen. */
let downTimer = 0;
export function initCheckup() {
  runCheckup({ reason: "Start" });
  let was = state.connected;
  on("conn", () => {
    // Kurze Wackler (Neuverbindung in wenigen Sekunden) nicht prüfen und nicht als „Verbindet“ zeigen
    if (was && !state.connected) {
      clearTimeout(downTimer);
      downTimer = setTimeout(() => { if (!state.connected && !checkup.running) runCheckup({ reason: "Verbindung seit 10 s getrennt" }); }, 10e3);
    }
    if (!was && state.connected && checkup.failed.length && !checkup.running) runCheckup({ reason: "wieder verbunden" });
    was = state.connected;
  });
  // Divera fällt später aus oder kommt wieder → Status sofort anpassen
  on("divera", () => emit("checkup", checkup));
}

/** Knopf „Neu verbinden“: alle Verbindungen neu aufbauen und dann prüfen. */
export async function reconnectAll() {
  log("action", "Neu verbinden", "Zentrale, Empfang, Divera werden neu aufgebaut");
  if (has.pi()) connect();
  if (has.direct() && hasPcFeatures) await startReceiver().catch(() => {});
  if (has.diveraApi()) restartDivera();
  await new Promise((r) => setTimeout(r, 300));
  return runCheckup({ reason: "Neu verbinden" });
}

/** Für die Status-Karte: "wait" (Verbindet), "off" (Inaktiv) oder "ok" (Aktiv). */
export const statusKind = (vacation) => (checkup.running ? "wait" : vacation ? "off" : "ok");
/** Ist gerade etwas nicht erreichbar? Letzter Check – oder jetzt live: Zentrale getrennt, Divera-Abfrage scheitert.
 *  „Verbunden“ zeigt die Pille nur, wenn wirklich alles steht. */
export function failedNow() {
  const live = [];
  if (has.pi() && checkup.done && !state.connected && (!offlineSince() || Date.now() - offlineSince() > 10e3)) live.push("Zentrale");
  if (has.diveraApi() && divera.ok === false) live.push("Divera");
  return [...new Set([...checkup.failed.map((n) => n.split(" ")[0]), ...live])];
}
export const connectionFailed = () => failedNow().length > 0;
