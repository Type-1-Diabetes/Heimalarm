// I – Test & Diagnose.
import { startWizard } from "../core/wizard.js";
import { ask } from "../ui/form.js";
import { h, toast, fmtAgo, fmtTime, fmtDate } from "../ui/dom.js";
import { state, publish, testDevice } from "../core/mqtt.js";
import { settings } from "../core/settings.js";
import { has } from "../core/features.js";
import { divera, loadDivera } from "../core/divera.js";
import { answerApager } from "../core/apager.js";
import { testAlarm, simulateContact, fullProbe } from "../core/engine.js";
import { sendToPeers } from "../core/direct.js";
import { hasPcFeatures } from "../core/platform.js";
import { selftestWhen } from "./settings.js";

/** Kontakt-Test: zeigt live, ob der Kontakt offen oder geschlossen ist. Der ESP32 meldet so lange keinen Alarm. */
function contactCard() {
  const me = settings().alarm.me;
  const d = state.devices[me];
  const set = (on) => { if (publish(`alarm/${me}/switch/kontakt_test/command`, on ? "ON" : "OFF")) toast(on ? "Kontakt-Test läuft (max. 10 Minuten)" : "Kontakt-Test beendet"); };
  const known = d?.contact !== undefined;
  return h("section.card", {},
    h("div.card-head", {}, h("h2", {}, "Kontakt-Test"),
      !d?.online ? h("span.chip.bad", {}, "ESP32 offline")
        : !known ? h("span.chip", {}, "ältere Firmware")
        : h("span.chip" + (d.contact ? ".ok" : ""), {}, d.contact ? "geschlossen" : "offen")),
    h("p.hint", {}, "Zeigt live, ob der Kontakt an der Ladeschale offen oder geschlossen ist. Während des Tests meldet der Melder keinen Alarm. So prüfst du in Ruhe die Kabel."),
    d?.testing && h("p.meta", {}, "Test läuft. Kabelenden kurz verbinden oder am Kabel wackeln: Springt die Anzeige, sitzt etwas locker. Endet nach 10 Minuten von selbst."),
    h("div.row", {}, d?.testing
      ? h("button.btn.primary", { onclick: () => set(false) }, "Test beenden")
      : h("button.btn", { onclick: () => set(true), disabled: !d?.online || !known }, "Test starten")));
}

/** Geräte, an die ein gezielter Testalarm gehen kann. */
function testTargets() {
  const out = [];
  if (has.pi()) {
    for (const [id, c] of Object.entries(state.clients)) {
      if (c?.online && id !== settings().device.id) out.push({ name: c.name || c.platform, hint: `${c.platform} · über die Zentrale`, send: async () => testDevice(id) });
    }
  }
  if (!hasPcFeatures) {
    for (const p of settings().direct.peers || []) {
      if (p.paired) out.push({ name: p.name, hint: "PC · direkt im WLAN", send: () => sendToPeers({ source: "Test", test: true, keyword: "Testalarm vom Handy" }, p.id) });
    }
  }
  return out;
}

function targetCard() {
  const list = testTargets();
  if (!list.length) return null;
  return h("section.card", {},
    h("h2", {}, "Testalarm an ein Gerät"),
    h("p.hint", {}, "Prüft genau eine Verbindung. Das Gerät zeigt die Abfrage, es passiert nichts."),
    h("ul.rows.compact", {}, list.map((t) => h("li", {}, h("div.row-main", {},
      h("div", {}, h("b", {}, t.name), h("div.meta", {}, t.hint)),
      h("button.btn.small", { onclick: async () => toast((await t.send()) ? `Testalarm an „${t.name}“ gesendet` : `„${t.name}“ nicht erreicht`) }, "Senden"))))));
}

let lastTest = null; // I3 – Ergebnis des letzten Verbindungstests

async function connectionTest(rerender) {
  const me = settings().alarm.me;
  const started = Date.now();
  lastTest = { running: true, checks: [] };
  rerender();
  if (has.pi()) publish("heimalarm/ping", String(started));
  const dv = has.diveraApi() ? loadDivera().then(() => true, () => false) : null;
  const ap = has.apager() && settings().apager.key ? answerApager(true, { quiet: true }) : null;
  await new Promise((r) => setTimeout(r, has.pi() ? 2500 : 300));
  const dvOk = dv && (await dv);
  const apRes = ap && (await ap);
  const esp = state.devices[me];
  const fresh = esp?.lastSeen && Date.now() - esp.lastSeen < settings().alarm.heartbeatSec * 1000;
  const pong = state.pong && state.pong.at >= started;
  lastTest = {
    ts: Date.now(),
    checks: [
      has.pi() && { name: "Zentrale (Mosquitto)", ok: state.connected, hint: state.connected ? settings().broker.host : "nicht verbunden" },
      has.pi() && { name: "Zentrale-Programm", ok: Boolean(pong), hint: pong ? `Version ${state.pong.version} · ${state.pong.at - started} ms` : "keine Antwort" },
      has.esp() && { name: `Melder (ESP32) „${me}“`, ok: Boolean(esp?.online), hint: esp ? (esp.online ? (fresh ? "online, Lebenszeichen aktuell" : "online, aber lange kein Lebenszeichen") : "offline") : "noch nie gemeldet" },
      has.zigbee() && { name: "Zigbee2MQTT", ok: state.bridge === "online", hint: state.bridge || "nicht gefunden" },
      has.pi() && { name: "Andere Apps", ok: Object.values(state.clients).some((c) => c.online), hint: `${Object.values(state.clients).filter((c) => c.online).length} online` },
      dv && { name: "Divera 24/7", ok: dvOk, hint: dvOk ? settings().divera.unit || "verbunden" : divera.error },
      ap && { name: "aPager PRO (Rückmeldung)", ok: apRes.ok || apRes.code === 204, hint: apRes.code === 204 ? "Schlüssel ok" : apRes.text },
    ].filter(Boolean),
  };
  rerender();
}

const checkList = (checks) => h("ul.check-list", {}, checks.map((c) =>
  h("li." + (c.ok ? "ok" : "bad"), {}, h("span.dot"), h("div", {}, h("b", {}, c.name), h("div.meta", {}, c.hint || (c.ok ? "in Ordnung" : "Problem"))))));

export function diagnoseView(rerender) {
  const report = state.report;
  return h("div.page", {},
    h("header.page-head", {}, h("div", {}, h("h1", {}, "Test & Diagnose"), h("p", {}, "Alles gefahrlos ausprobieren, bevor es ernst wird."))),

    h("div.cards", {},
      h("section.card", {},
        h("h2", {}, "Testalarm (nur Anzeige)"),
        h("p.hint", {}, "Nur diese App: zeigt die Abfrage, es passiert nichts. Routinen laufen nicht."),
        h("div.row", {}, h("button.btn.primary", { onclick: testAlarm }, "Testalarm"))),
      h("section.card", {},
        h("h2", {}, "Einrichtung"),
        h("p.hint", {}, "Schritt für Schritt neu durchgehen: Fragen, persönlicher Plan, Anleitung mit Bildern."),
        h("div.row", {}, h("button.btn", { type: "button", onclick: () => { startWizard(); location.hash = "#/einrichtung"; } }, "Einrichtung starten"))),
      has.esp() && contactCard(),
      has.esp() && h("section.card", {},
        h("h2", {}, "Melder-Test (alle Geräte)"),
        h("p.hint", {}, "Wie ein echter Melder-Alarm – alle Geräte zeigen die Abfrage. Licht und PC-Aktion bleiben aus."),
        h("div.row", {}, h("button.btn", { onclick: () => { if (simulateContact()) toast("Melder-Test gesendet"); } }, "Nachspielen"))),
      has.pi() && h("section.card", {},
        h("h2", {}, "Generalprobe (schaltet wirklich)"),
        h("p.hint", {}, "Routinen schalten wirklich (Licht an). Die PC-Aktion wird nur angezeigt."),
        h("div.row", {}, h("button.btn", { onclick: async () => { if (await ask("Generalprobe starten? Licht und Geräte schalten wirklich.")) fullProbe(); } }, "Generalprobe starten"))),
    ),

    h("details.card.test-explain", {},
      h("summary", {}, h("b", {}, "Was löst welcher Test wirklich aus?")),
      h("table.test-table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Test"), h("th", {}, "Abfrage"), h("th", {}, "Licht & Routinen"), h("th", {}, "PC-Aktion"))),
        h("tbody", {}, [
          ["Testalarm", "nur dieses Gerät", "nein", "nein"],
          ["Testmodus (Schalter)", "ja, bei jedem Alarm", "mit Zentrale ja", "nein"],
          ["Kontakt-Test", "nein", "nein", "nein"],
          ["Melder-Test", "alle Geräte", "nein", "nein"],
          ["Generalprobe", "alle Geräte", "ja", "nein"],
        ].map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))),
      h("p.meta", {}, "Hat nichts mit dem Probealarm deiner Wache zu tun – der löst einen echten Alarm aus.")),

    targetCard(),

    h("section.card", {},
      h("div.card-head", {}, h("h2", {}, "Verbindungstest"),
        h("button.btn.small", { onclick: () => connectionTest(rerender), disabled: lastTest?.running }, lastTest?.running ? "Läuft …" : "Jetzt testen")),
      lastTest?.checks?.length ? checkList(lastTest.checks) : h("p.hint", {}, "Prüft alles, was eingerichtet ist."),
      lastTest?.ts && h("p.meta", {}, `Getestet ${fmtTime(lastTest.ts)}`)),

    has.pi() && h("section.card", {},
      h("div.card-head", {}, h("div", {}, h("h2", {}, "Automatischer Selbsttest"), h("p.meta", {}, selftestWhen() === "aus" ? "Automatisch: aus" : `Automatisch: ${selftestWhen()}`)),
        h("button.btn.small", { onclick: () => { publish("heimalarm/cmd/selftest", {}); toast("Selbsttest läuft auf der Zentrale"); } }, "Jetzt ausführen")),
      report ? [
        h("p.meta", {}, `${report.ok ? "Alles in Ordnung" : "Probleme gefunden"} · ${fmtDate(report.ts)} ${fmtTime(report.ts)} · ${fmtAgo(report.ts)}`),
        checkList(report.checks),
      ] : h("p.hint", {}, "Die Zentrale prüft regelmäßig alle Teile und legt hier einen Bericht ab."),
      h("a.btn.small.ghost", { href: "#/einstellungen/selbsttest" }, "Zeitplan einstellen")),
  );
}
