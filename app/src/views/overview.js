// E3 – Übersicht / Dashboard: alles Wichtige auf einen Blick.
import { outdated, GUIDE_URL } from "../core/versions.js";
import { h, fmtAgo, fmtTime, toast } from "../ui/dom.js";
import { state, publish, testDevice, renameDevice, forgetDevice, setDevice } from "../core/mqtt.js";
import { field, dialog, ask } from "../ui/form.js";
import { emit } from "../core/events.js";
import { discord, endPresence } from "../core/discord.js";
import { shared } from "../core/shared.js";
import { settings, mode } from "../core/settings.js";
import { setupFlow, setupSteps, setupDone } from "../ui/setup.js";
import { update, installUpdate } from "../core/update.js";
import { getLog } from "../core/log.js";
import { wakeOnLan } from "../core/pc.js";
import { has, activeSources } from "../core/features.js";
import { direct } from "../core/direct.js";
import { fireLocal } from "../core/routines-local.js";
import { engine, answerApps } from "../core/engine.js";
import { recordAnswer } from "../core/stats.js";
import { setDiveraStatus, divera, loadDivera } from "../core/divera.js";
import { hasPcFeatures, platformName, isTauri } from "../core/platform.js";
import { on } from "../core/events.js";
import { startWizard, inProgress, androidState } from "../core/wizard.js";
import { openNotificationAccess, backgroundIssues } from "../core/android.js";
import { MODES, readiness, setReadiness, untilText } from "../core/readiness.js";
import { pickUntil } from "../ui/until-picker.js";
import { testAlarm } from "../core/engine.js";
import { statsEntries } from "../core/stats.js";
import { checkup, runCheckup, statusKind, connectionFailed, failedNow, reconnectAll } from "../core/checkup.js";
import { doSet as wifiToggle } from "./wifi.js";
import { icon } from "../ui/icons.js";

const chip = (kind, text) => h("span.chip" + (kind ? "." + kind : ""), {}, text);

function uptime(sec) {
  if (!Number.isFinite(sec)) return "–";
  const d = Math.floor(sec / 86400), hr = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d} T ${hr} h` : hr > 0 ? `${hr} h ${m} min` : `${m} min`;
}

/** WLAN-Signal als 4 Balken + dBm */
function signal(rssi) {
  if (!Number.isFinite(rssi)) return h("span.muted", {}, "–");
  const bars = rssi > -55 ? 4 : rssi > -67 ? 3 : rssi > -78 ? 2 : 1;
  return h("span.signal", { title: `${rssi} dBm` },
    h("span.bars", { "data-bars": bars }, h("i"), h("i"), h("i"), h("i")), `${rssi} dBm`);
}

function setupCard() {
  const z = mode() === "zentrale";
  return h("section.card.span-all.setup", {},
    h("div.card-head", {},
      h("div", {}, h("h2", {}, "Einrichtung"), h("p.meta", {}, z ? "Mit Zentrale – ein Gerät, das immer läuft, gibt den Alarm weiter." : "Ohne Zentrale – Handy und PC arbeiten direkt zusammen.")),
      h("div.row", {},
        h("button.btn.small.primary", { type: "button", onclick: () => { if (!inProgress()) startWizard(); location.hash = "#/einrichtung"; } }, inProgress() ? "Einrichtung fortsetzen" : "Schritt für Schritt"),
        h("a.btn.small", { href: "#/einstellungen/betrieb" }, "Betriebsart ändern"))),
    setupSteps(),
    h("details.flow-details", {}, h("summary", {}, "So läuft ein Alarm"), setupFlow()),
  );
}
const needsSetup = () => !setupDone();

/** Hinweis auf eine neue Version – Installieren direkt aus der Übersicht. */
function updateBanner() {
  const u = update.available;
  return h("div.banner.update", { role: "status" },
    h("div", {}, h("b", {}, `Heimalarm ${u.version} ist verfügbar`),
      update.progress || (isTauri ? "Wird geladen, geprüft und installiert – deine Einstellungen bleiben erhalten." : "Neue Version auf GitHub.")),
    h("div.row", {},
      h("button.btn.primary.small", { onclick: installUpdate, disabled: update.installing }, update.installing ? "Lädt …" : "Installieren"),
      h("a.btn.small", { href: "#/einstellungen/updates" }, "Details")));
}

/** Zentrale oder ESP32 älter als diese App – mit Link auf die Update-Anleitung. */
function outdatedBanner(list) {
  const one = list.length === 1;
  return h("div.banner.update.stale", { role: "status" },
    h("div", {},
      h("b", {}, one ? `${list[0].name} aktualisieren` : "Geräte aktualisieren"),
      h("ul.stale-list", {}, list.map((x) => h("li", {}, h("span", {}, x.name), h("span.mono", {}, `${x.have} → ${x.want}`), h("small", {}, x.how)))),
    ),
    h("div.row", {}, h("a.btn.small", { href: GUIDE_URL, target: "_blank", rel: "noopener" }, "Anleitung öffnen")));
}

/** Alarm-App eingeschaltet, aber Heimalarm darf Benachrichtigungen nicht mitlesen → kein Alarm kommt an. */
function notifAccessBanner() {
  const st = androidState();
  const appsOn = ["sybos", "apager"].some((k) => settings().alarm.apps?.[k]?.on) || settings().alarm.filterApps;
  if (!st?.supported || !appsOn || st.notificationAccess) return null;
  return h("div.banner.warn", { role: "alert" },
    h("div", {},
      h("b", {}, "Alarme aus der Alarm-App werden nicht erkannt"),
      h("p", {}, "Heimalarm darf Benachrichtigungen nicht mitlesen. Ist der Schalter ausgegraut: App-Infos → ⋮ → „Eingeschränkte Einstellungen zulassen“.")),
    h("div.row", {}, h("button.btn.small", { onclick: () => openNotificationAccess().catch(() => toast("Einstellung ließ sich nicht öffnen")) }, "Zugriff erlauben")));
}

/** Hintergrund nicht eingerichtet (Dienst, Akku, Standby, Auto-Neustart): Alarme kämen verspätet oder gar nicht. */
function backgroundBanner() {
  const list = backgroundIssues(androidState());
  if (!list.length) return null;
  const one = list.length === 1;
  return h("div.banner.update.stale", { role: "status" },
    h("div", {},
      h("b", {}, one ? list[0].title : "Heimalarm läuft im Hintergrund nicht zuverlässig"),
      one ? h("p", {}, list[0].why) : h("ul.stale-list", {}, list.map((x) => h("li", {}, h("span", {}, x.title))))),
    h("div.row", {}, h("a.btn.small", { href: "#/einstellungen/hintergrund" }, "Beheben")));
}

function espCard() {
  const me = settings().alarm.me;
  const list = Object.entries(state.devices).toSorted(([a], [b]) => (a === me ? -1 : b === me ? 1 : a.localeCompare(b)));
  return h("section.card", {},
    h("div.card-head", {}, h("h2", {}, "Melder (ESP32)")),
    list.length === 0
      ? h("p.hint", {}, "Noch kein ESP32 gemeldet. Im ESP32 prüfen: WLAN, Passwort (mqtt_pw) und Kennung „", h("code", {}, me), "“.")
      : h("ul.rows", {}, list.map(([who, d]) => h("li", {},
          h("div.row-main", {},
            h("b", {}, who, who === me ? h("span.badge", {}, "ich") : null),
            d.online ? chip("ok", "online") : d.online === false ? chip("bad", "offline") : chip("", "unbekannt")),
          h("dl.facts", {},
            h("div", {}, h("dt", {}, "WLAN"), h("dd", {}, signal(d.rssi))),
            h("div", {}, h("dt", {}, "Laufzeit"), h("dd", {}, uptime(d.uptime))),
            h("div", {}, h("dt", {}, "IP"), h("dd.mono", {}, d.ip || "–")),
            h("div", {}, h("dt", {}, "Firmware"), h("dd", {}, d.version || "–")),
          ),
        ))),
  );
}

/** D11 – PC per Wake-on-LAN wecken: direkt (App) oder über das Zentrale-Programm. */
function wake(c) {
  const viaZentrale = () => publish("heimalarm/cmd/wol", { mac: c.mac }) && toast(`Weckruf an „${c.name}“ über die Zentrale`);
  if (isTauri) wakeOnLan(c.mac).then(() => toast(`Weckruf an „${c.name}“ gesendet`)).catch(viaZentrale);
  else viaZentrale();
}

function renameClientDialog(id, c) {
  const name = h("input.input", { value: c.name || "" });
  const close = dialog("Gerät umbenennen", field("Name", name, "Das Gerät übernimmt den Namen, sobald es verbunden ist."),
    h("div.row", {}, h("button.btn.primary", { onclick: () => { const n = name.value.trim(); if (n && renameDevice(id, n)) toast(`Umbenannt in „${n}“`); close(); } }, "Speichern")));
}

function appsCard() {
  const myId = settings().device.id;
  const list = Object.entries(state.clients).filter(([, c]) => c).toSorted(([, a], [, b]) => Number(b.online) - Number(a.online) || b.ts - a.ts);
  return h("section.card", {},
    h("div.card-head", {}, h("h2", {}, "Verbundene Apps")),
    list.length === 0
      ? h("p.hint", {}, state.connected ? "Nur diese App ist verbunden." : "Sichtbar, sobald die Zentrale verbunden ist.")
      : h("ul.rows", {}, list.map(([id, c]) => h("li", {},
          h("div.row-main", {},
            h("b", {}, c.name || c.platform, id === myId ? h("span.badge", {}, "dieses Gerät") : null),
            c.online ? chip("ok", "online") : chip("", `zuletzt ${fmtAgo(c.ts)}`)),
          h("p.hint", {}, `${c.platform} · Version ${c.version}`),
          id !== myId && h("div.row", {},
            c.online && h("button.btn.small.ghost", { onclick: () => { if (testDevice(id)) toast(`Testalarm an „${c.name}“ gesendet`); } }, "Testalarm"),
            !c.online && c.mac && h("button.btn.small", { onclick: () => wake(c) }, "Aufwecken"),
            h("button.btn.small.ghost", { onclick: () => renameClientDialog(id, c) }, "Umbenennen"),
            !c.online && h("button.btn.small.ghost.danger", { onclick: async () => { if (await ask(`„${c.name}“ aus der Liste entfernen? Meldet es sich wieder, erscheint es erneut.`) && forgetDevice(id)) { toast("Entfernt"); emit("devices", state); } } }, "Entfernen")),
        ))),
  );
}

const sendAnswer = (going) => (recordAnswer(going), answerApps(going)).then((ok) => toast(ok ? "Antwort gesendet" : "Nicht angekommen – siehe Protokoll"));

/** Eigener Einsatz läuft (max. 30 min): Antwort an Divera / aPager direkt vom Handy. */
function answerCard() {
  const a = engine.last, st = settings();
  const viaDivera = st.alarm.apps.divera.on && st.divera.key && (st.divera.answerGo || st.divera.statusGo || st.divera.answerStay || st.divera.statusStay);
  const apager = st.alarm.apps.apager.on && st.apager.key && st.apager.feedback;
  if (hasPcFeatures || !a?.own || a.test || Date.now() - a.ts > 30 * 60_000 || !(viaDivera || apager)) return null;
  return h("section.card.span-all.answer", {},
    h("div.card-head", {}, h("h2", {}, `Einsatz · ${fmtTime(a.ts)}`), a.keyword && h("span.chip.bad", {}, a.keyword)),
    a.address && h("p.meta", {}, a.address),
    h("div.row", {},
      h("button.btn.primary", { onclick: () => sendAnswer(true) }, st.pc.goText || "Ich fahre"),
      h("button.btn", { onclick: () => sendAnswer(false) }, st.pc.stayText || "Ich fahre nicht")),
    h("small.meta", {}, `Meldet an ${[viaDivera && "Divera", apager && "aPager"].filter(Boolean).join(" und ")}.`));
}

/** Eigener Divera-Status: anzeigen und mit einem Tipp ändern. */
function diveraCard() {
  const d = settings().divera;
  if (!settings().alarm.apps.divera.on || !d.key || !d.statuses.length) return null;
  return h("section.card.divera-card", {},
    h("div.card-head", {}, h("h2", {}, "Mein Divera-Status"), divera.ok === false && h("span.chip.bad", {}, "Fehler")),
    h("div.status-pills", { role: "group", "aria-label": "Status setzen" }, d.statuses.map((x) =>
      h("button.status-pill", { "aria-pressed": String(divera.current === x.id), style: x.color ? `--c:${x.color}` : "",
        onclick: () => setDiveraStatus(x.id).then((ok) => toast(ok ? `Status: ${x.name}` : "Nicht gesetzt")) }, x.name))),
    h("small.meta", {}, d.unit || "Divera 24/7"));
}

/* ── Status-Karte: Aktiv / Verbindet / Inaktiv ─────────────────────────── */

const ST_TEXT = { ok: "Aktiv", wait: "Verbindet", off: "Inaktiv" };
const ST_ICON = { ok: "check", wait: "net", off: "pause" };
let stopStatus = null;

/** Pille unter dem Status. Liegt absolut in einem festen Platzhalter: der wechselnde Text
 *  verschiebt nie Knöpfe oder Kennzahlen. */
function statusPill() {
  const kind = checkup.running ? "wait" : connectionFailed() ? "bad" : "ok";
  const failed = failedNow();
  const text = checkup.running ? checkup.line || "verbinde …"
    : failed.length ? `Fehlgeschlagen: ${failed.join(", ")}` : "Verbunden";
  const pill = h("button.stpill." + kind, {
    type: "button", title: failed.length ? `Nicht erreichbar: ${failed.join(", ")} – Grund steht im Protokoll · tippen zum erneuten Prüfen` : "Tippen zum erneuten Prüfen",
    onclick: () => { if (!checkup.running) runCheckup({ reason: "Von Hand geprüft" }); },
  }, h("i", { "aria-hidden": "true" }),
  h("span" + (checkup.running && checkup.lineOk === null ? ".cur" : ""), {},
    checkup.running && checkup.lineOk !== null
      ? [checkup.line.replace(/ (ok|fehlgeschlagen)$/u, " "), h("b." + (checkup.lineOk ? "ok" : "bad"), {}, checkup.lineOk ? "ok" : (checkup.line.endsWith("fehlgeschlagen") ? "fehlgeschlagen" : ""))]
      : text));
  return pill;
}

/* Bereitschaft (ersetzt „Aktiv/Inaktiv schalten“): Verfügbar, Nicht verfügbar, Abwesend – mit Endzeit. */
async function chooseReadiness(k) {
  if (k === "ready") { setReadiness("ready"); toast("Verfügbar – Alarme lösen wieder alles aus"); return; }
  const r = readiness();
  const until = await pickUntil(k, r.mode === k ? r.until : null);
  if (!until) return;
  setReadiness(k, until);
  toast(`${MODES[k].label} ${untilText(until)} – danach wieder verfügbar`);
}

function statusCard() {
  const r = readiness();
  const off = r.mode !== "ready";
  const kind = statusKind(off);
  const slot = h("div.stslot", { "aria-live": "polite" }, statusPill());
  const title = h("h2.st-title", {}, kind === "off" ? `${MODES[r.mode].label} ${untilText(r.until)}`.trim() : ST_TEXT[kind]);
  const reconnect = h("button.btn", {
    type: "button", disabled: kind === "wait", title: "Alle Verbindungen neu aufbauen und prüfen – Ergebnis im Protokoll",
    onclick: () => reconnectAll(),
  }, "Neu verbinden");
  const ready = h("div.st-ready", {},
    h("span.st-ready-label", {}, "Bereitschaft"),
    h("div.ready-pick", { role: "group", "aria-label": "Bereitschaft" },
      Object.entries(MODES).map(([k, m]) => h("button", {
        type: "button", "data-mode": k, "aria-pressed": String(r.mode === k),
        title: k === "ready" ? m.hint : r.mode === k ? "Endzeit ändern" : "Bis wann? – danach wieder verfügbar",
        onclick: () => chooseReadiness(k),
      }, m.label))),
    h("span.st-ready-hint", {}, MODES[r.mode].hint));
  const card = h("section.status-card", { "data-st": kind, "data-ready": r.mode },
    h("div.st-pulse", { "aria-hidden": "true" }, icon(ST_ICON[kind])),
    h("div.st-text", {}, title, slot),
    h("div.st-actions", {},
      h("button.btn", { type: "button", onclick: testAlarm }, "Testalarm"),
      reconnect),
    ready);
  // Nur Pille und Zustand aktualisieren, nicht die ganze Seite (kein Springen während des Checks)
  stopStatus?.();
  stopStatus = on("checkup", () => {
    if (!card.isConnected) { stopStatus?.(); stopStatus = null; return; }
    const k = statusKind(readiness().mode !== "ready");
    card.dataset.st = k;
    card.querySelector(".st-pulse").replaceChildren(icon(ST_ICON[k]));
    slot.replaceChildren(statusPill());
    reconnect.disabled = k === "wait";
  });
  return card;
}

/* ── Kennzahlen ────────────────────────────────────────────────────────── */

const kpi = (color, label, value, ratio) => h("div.kpi", { style: `--a:var(${color})` },
  h("span.kpi-l", {}, label), h("b.kpi-n", {}, value),
  h("span.kpi-bar", { "aria-hidden": "true" }, h("i", { style: `width:${Math.round(Math.max(0, Math.min(1, ratio || 0)) * 100)}%` })));

function devicesOnline() {
  const items = [];
  if (has.pi()) for (const c of Object.values(state.clients)) if (c) items.push(Boolean(c.online));
  if (has.esp()) for (const d of Object.values(state.devices)) items.push(Boolean(d.online));
  if (has.direct() && !hasPcFeatures) for (const p of settings().direct.peers || []) items.push(Boolean(direct.peers[p.id]?.ok));
  if (has.zigbee()) for (const v of Object.values(state.zavail)) items.push(v === "online");
  return { on: items.filter(Boolean).length, all: items.length };
}

function kpis() {
  const d = devicesOnline();
  const devKpi = kpi("--c-pc", "Geräte online", d.all ? `${d.on}/${d.all}` : "–", d.all ? d.on / d.all : 0);
  if (has.logbuch()) {
    const y = new Date().getFullYear();
    const all = statsEntries().filter((e) => !e.deleted);
    const year = all.filter((e) => new Date(e.ts).getFullYear() === y);
    const prev = all.filter((e) => new Date(e.ts).getFullYear() === y - 1).length;
    const go = year.filter((e) => e.answer === "go").length;
    const secs = year.filter((e) => e.answerTs).map((e) => (e.answerTs - e.ts) / 1000).filter((x) => x >= 0).toSorted((a, b) => a - b);
    const med = secs.length ? Math.round(secs[Math.floor(secs.length / 2)]) : null;
    return h("div.kpis", {},
      kpi("--c-alarm", `Einsätze ${y}`, String(year.length), year.length / Math.max(prev, year.length, 1)),
      kpi("--ok", "Gefahren", String(go), year.length ? go / year.length : 0),
      kpi("--c-net", "Ø Antwortzeit", med == null ? "–" : `${med} s`, med == null ? 0 : 1 - Math.min(med, 60) / 60),
      devKpi);
  }
  const log = getLog("alarm");
  const a24 = log.filter((e) => Date.now() - e.ts < 86400e3).length;
  const src = activeSources();
  return h("div.kpis", {},
    kpi("--c-alarm", "Alarme 24 h", String(a24), Math.min(a24 / 3, 1)),
    kpi("--ok", "Alarme gesamt", String(log.length), log.length ? 1 : 0),
    kpi("--c-net", "Alarmquellen", String(src.length), src.length / 4),
    devKpi);
}

/* ── Licht & Geräte, Schnellaktionen, Zuletzt ─────────────────────────── */

function deviceTiles() {
  const tiles = [];
  for (const d of (state.zigbee || []).filter((x) => x.type !== "Coordinator").slice(0, 6)) {
    const name = d.friendly_name, st = state.zstate[name] || {};
    if (!("state" in st)) continue;
    const isOn = st.state === "ON";
    const bri = Number.isFinite(st.brightness) ? ` · ${Math.round((st.brightness / 254) * 100)} %` : "";
    tiles.push(h("button.dev" + (isOn ? ".on" : ""), { type: "button", "aria-pressed": String(isOn), onclick: () => setDevice(name, { state: isOn ? "OFF" : "ON", transition: 1 }) },
      h("span.dev-h", {}, h("span.ico", { style: `--a:var(${isOn ? "--warn" : "--text-2"})` }, icon("bulb")), h("span.sw" + (isOn ? ".on" : ""), { "aria-hidden": "true" })),
      h("b", {}, name), h("small", {}, isOn ? `an${bri}` : "aus")));
  }
  for (const d of (state.matter || []).slice(0, Math.max(0, 6 - tiles.length))) {
    const st = state.mstate[d.id] || {};
    if (!("state" in st)) continue;
    const isOn = st.state === "ON";
    const bri = Number.isFinite(st.brightness) ? ` · ${Math.round((st.brightness / 254) * 100)} %` : "";
    tiles.push(h("button.dev" + (isOn ? ".on" : ""), { type: "button", "aria-pressed": String(isOn), onclick: () => setDevice(d.name, { state: isOn ? "OFF" : "ON", transition: 1 }) },
      h("span.dev-h", {}, h("span.ico", { style: `--a:var(${isOn ? "--warn" : "--text-2"})` }, icon("bulb")), h("span.sw" + (isOn ? ".on" : ""), { "aria-hidden": "true" })),
      h("b", {}, d.name), h("small", {}, d.online ? (isOn ? `an${bri}` : "aus") : "nicht erreichbar")));
  }
  for (const d of (shared().wifi || []).slice(0, Math.max(0, 6 - tiles.length))) {
    tiles.push(h("div.dev", {},
      h("span.dev-h", {}, h("span.ico", { style: "--a:var(--c-net)" }, icon("bulb")),
        h("span.row", { style: "gap:6px" },
          h("button.btn.small", { type: "button", onclick: () => wifiToggle(d, { on: true }) }, "An"),
          h("button.btn.small", { type: "button", onclick: () => wifiToggle(d, { on: false }) }, "Aus"))),
      h("b", {}, d.name), h("small", {}, "WLAN")));
  }
  return tiles;
}

const q = (color, ico, label, fn) => h("button.q", { type: "button", onclick: fn }, h("span.ico", { style: `--a:var(${color})` }, icon(ico)), h("span", {}, label));

function quickActions() {
  const manual = has.routines() ? (shared().routines || []).filter((r) => r.enabled && r.trigger?.type === "manual") : [];
  const wakeable = has.pi() ? Object.values(state.clients).filter((c) => c && !c.online && c.mac) : [];
  return [
    ...manual.map((r) => q("--c-routine", "flow", r.name, () => { if (has.pi()) publish("heimalarm/cmd/run", { id: r.id }); else fireLocal(r, { manual: true }); toast(`„${r.name}“ läuft`); })),
    ...wakeable.map((c) => q("--c-net", "pc", `${c.name} wecken`, () => wake(c))),
    (has.zigbee() || has.matter()) && q("--ok", "home", "Einsatz beenden", () => { emit("restore"); if (publish("heimalarm/cmd/restore", {})) toast("Vorheriger Zustand wird wiederhergestellt"); }),
    // Discord-Status läuft, aber kein Zigbee/Matter: eigener Knopf „Einsatz beenden“
    !has.zigbee() && !has.matter() && discord.active && discord.active.end > Date.now() && q("--c-discord", "chat", "Einsatz beenden", () => { emit("restore"); endPresence("von Hand"); toast("Discord-Status entfernt"); }),
  ].filter(Boolean);
}

const KIND_COLOR = { alarm: "--c-alarm", action: "--c-routine", warn: "--warn", info: "--c-net", ok: "--ok" };
function recentPanel() {
  const ev = getLog().slice(0, 5);
  return h("section.panel", {},
    h("div.panel-head", {}, h("h3", {}, "Zuletzt"), h("a.link", { href: "#/protokoll" }, "Protokoll ›")),
    ev.length === 0 ? h("p.hint", {}, "Noch nichts passiert.")
      : h("ol.tl", {}, ev.map((e) => h("li", { style: `--a:var(${KIND_COLOR[e.kind] || "--text-2"})` },
          h("i", { "aria-hidden": "true" }),
          h("div", {}, h("b", {}, e.text), e.detail && h("small", {}, e.detail)),
          h("time.mono", {}, fmtTime(e.ts))))));
}

function devicesPanel() {
  const tiles = has.zigbee() || has.wifi() || has.matter() ? deviceTiles() : [];
  const quick = quickActions();
  if (!tiles.length && !quick.length) return null;
  return h("section.panel", {},
    tiles.length > 0 && [
      h("div.panel-head", {}, h("h3", {}, "Licht & Geräte"), h("a.link", { href: "#/geraete" }, "Alle ›")),
      h("div.devs", {}, tiles)],
    quick.length > 0 && [
      h("div.panel-head", { style: tiles.length ? "margin-top:var(--s4)" : "" }, h("h3", {}, "Schnellaktionen")),
      h("div.quick", {}, quick)]);
}

export function overview() {
  const s = settings();
  if (divera.current === null && has.diveraApi() && !divera.loading) { divera.loading = true; loadDivera().catch(() => {}); }
  const left = devicesPanel();
  const stale = outdated();
  return h("div.page.home", {},
    h("h1.sr-only", {}, `Start · ${s.device.name || platformName}`),
    statusCard(),
    notifAccessBanner(),
    backgroundBanner(),
    answerCard(),
    update.available && updateBanner(),
    stale.length > 0 && outdatedBanner(stale),
    needsSetup() && setupCard(),
    kpis(),
    h("div.home-cols" + (left ? "" : ".single"), {}, left, recentPanel()),
    h("div.home-more", {},
      has.diveraApi() && diveraCard(),
      has.esp() && espCard(),
      has.pi() && appsCard()),
  );
}
