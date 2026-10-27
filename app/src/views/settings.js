// Einstellungen. Alles wird sofort gespeichert; allgemeine Werte gleichen sich über die Zentrale ab.
import { modeChoice, setupFlow } from "../ui/setup.js";
import { startWizard, androidState, refreshAndroid } from "../core/wizard.js";
import { update, checkUpdate, installUpdate, RELEASES_URL } from "../core/update.js";
import { h, toast, fmtAgo } from "../ui/dom.js";
import { field, text, toggle, segmented, select, section, switchRow, copyText, download, dialog, ask } from "../ui/form.js";
import { settings, set, get, replace, isConfigured, mode, phoneMode } from "../core/settings.js";
import { has } from "../core/features.js";
import { on as onEvent } from "../core/events.js";
import { direct, startReceiver, renewCode, openPairing, webhookUrl, renewHookKey, pingPeer, addPeer, editPeer, removePeer, syncPeers, unpairPhone, renamePhone } from "../core/direct.js";
import { runsHere } from "../core/routines-local.js";
import { shared, updateShared, sha256, secretKey } from "../core/shared.js";
import { connect, state, publish, APP_VERSION } from "../core/mqtt.js";
import { ACTIONS, setAutostart, hibernateEnabled, enableHibernate, macAddress } from "../core/pc.js";
import { hasPcFeatures, isAndroid, isTauri } from "../core/platform.js";
import { requireAdmin, isAdmin } from "../core/admin.js";
import { androidStatus, openBatterySettings, openNotificationAccess, openFullScreenSettings, openAppDetails, sleeping, backgroundIssues, setBackgroundService, openOverlaySettings, openDndSettings, testTorch, navigateToStation } from "../core/android.js";
import { applyTheme } from "../ui/theme.js";
import { biometricLabel } from "../core/biometric.js";
import { recentApps, testAlarm } from "../core/engine.js";
import { divera, loadDivera, restartDivera } from "../core/divera.js";
import { answerApager } from "../core/apager.js";
import qrcode from "qrcode-generator";
import { normalizeKennung, normalizeKennungList, KENNUNG_HINT } from "../core/kennung.js";

/** Eingabe für Kennungen: macht Umlaute, Leerzeichen und Großbuchstaben passend und sagt Bescheid. */
function kennungInput(path, attrs = {}, list = false, after) {
  const fix = list ? normalizeKennungList : normalizeKennung;
  return h("input.input", { value: get(path) ?? "", autocomplete: "off", autocapitalize: "off", spellcheck: "false", ...attrs,
    onchange: (e) => {
      const raw = e.target.value.trim();
      const v = fix(raw);
      if (!v && !list) { e.target.value = get(path) ?? ""; toast("Kennung darf nicht leer sein"); return; }
      if (v !== raw) { e.target.value = v; toast(`Angepasst zu „${v}“ – nur a–z, 0–9 und -`); }
      set(path, v);
      after?.(v);
    } });
}
import { toneSettings, percentSlider } from "../ui/tone.js";
import { icon } from "../ui/icons.js";
import { activeSources } from "../core/features.js";
import { discordSection } from "./discord.js";
import { hassSection } from "./hass.js";
import { hotkeySection } from "./hotkeys.js";
import { discord } from "../core/discord.js";

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$|[a-z0-9-]+\.local$|[a-z0-9-]+$)/iu;
let hibernateOn = null;
let android = null;

// ── Abschnitte ─────────────────────────────────────
function peerDialog(rerender, peer) {
  const host = h("input.input", { placeholder: "z. B. 192.168.1.20", inputmode: "url", value: peer?.host || "" });
  const port = h("input.input", { placeholder: "8765", inputmode: "numeric", value: String(peer?.port || 8765) });
  const code = h("input.input", { placeholder: peer ? "nur zum Neu-Koppeln" : "8-stelliger Code", inputmode: "numeric" });
  const name = h("input.input", { placeholder: "z. B. PC Arbeitszimmer", value: peer?.nameSet ? peer.name : "" });
  const close = dialog(peer ? `„${peer.name}“ bearbeiten` : "PC koppeln",
    field("Adresse", host, "Steht am PC unter Einstellungen → Betrieb & Koppeln."),
    field("Kopplungscode", code, peer ? "Leer lassen, außer der PC wurde entkoppelt." : "Steht am PC daneben. Vorher am PC „Koppeln erlauben“ drücken. Danach bekommt dieses Handy einen eigenen Code."),
    field("Name", name, "Leer = Name des PCs übernehmen."),
    field("Port", port),
    h("div.row", {}, h("button.btn.primary", { onclick: async () => {
      const c = code.value.replace(/\D/gu, "");
      const data = { host: host.value.trim(), port: Number(port.value) || 8765, code: c, name: name.value.trim() };
      if (!data.host) return toast("Adresse eintragen");
      if ((!peer || c) && c.length !== 8) return toast("8-stelligen Code eintragen");
      close(); toast("Verbinde …");
      const ok = peer ? await editPeer(peer.id, data) : await addPeer(data);
      rerender();
      toast(ok ? "Gekoppelt – Einstellungen werden abgeglichen" : "Gespeichert, aber PC nicht erreicht");
    } }, peer ? "Speichern" : "Koppeln")));
}

function renamePhoneDialog(rerender, p) {
  const name = h("input.input", { value: p.name });
  const close = dialog("Handy umbenennen", field("Name", name, "Nur an diesem PC."),
    h("div.row", {}, h("button.btn.primary", { onclick: () => { renamePhone(p.id, name.value.trim() || p.name); close(); rerender(); } }, "Speichern")));
}

const ago = (ts) => (ts ? fmtAgo(ts) : "noch nie");

// ── Betrieb: mit oder ohne Zentrale ─────────────────
function betrieb(rerender) {
  const m = mode();
  const d = settings().direct;
  const syncHint = h("small.meta", {}, settings().sync?.enabled === false
    ? `Abgleich ist aus (Einstellungen → ${hasPcFeatures ? "Dieser PC" : isAndroid ? "Dieses Handy" : "Dieses Gerät"}).`
    : "Gekoppelte Geräte gleichen Betriebsart, Alarm-, PC- und Darstellungs-Einstellungen ab, ohne Zentrale auch Routinen und WLAN-Geräte. Divera-/aPager-Schlüssel bleiben auf dem Gerät.");
  const pcPart = () => {
    const phones = d.phones || [];
    return h("div.item", {},
      h("div.item-head", {}, h("b", {}, "Handy koppeln"), direct.error ? h("span.chip.bad", {}, "Fehler") : direct.ip ? h("span.chip.ok", {}, "bereit") : h("span.chip", {}, "startet …")),
      h("p.meta", {}, "„Koppeln erlauben“ drücken, dann am Handy unter Einstellungen → Betrieb & Koppeln → „PC koppeln“ eintragen:"),
      h("div.pair-big", {},
        h("div", {}, h("small", {}, "Adresse"), h("code", {}, direct.ip ? `${direct.ip}` : "–")),
        h("div", {}, h("small", {}, "Kopplungscode"), h("code", {}, (d.code || "–").replace(/(\d{4})(\d{4})/u, "$1 $2")))),
      direct.error && h("p.meta.err", {}, direct.error),
      h("div.row", {},
        direct.pairUntil > Date.now()
          ? [h("span.chip.ok", {}, `Koppeln erlaubt bis ${new Date(direct.pairUntil).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`),
             h("button.btn.small.ghost", { onclick: async () => { await openPairing(0); rerender(); } }, "Beenden")]
          : h("button.btn.small.primary", { onclick: async () => { await openPairing(5); rerender(); } }, "Koppeln erlauben (5 Minuten)"),
        h("button.btn.small.ghost", { onclick: async () => { if (await ask("Neuen Kopplungscode erzeugen? Bereits gekoppelte Handys bleiben gekoppelt.")) { await renewCode(); rerender(); } } }, "Neuer Kopplungscode")),
      h("small.meta", {}, "Neue Handys werden nur angenommen, solange „Koppeln erlauben“ läuft. Nach 10 falschen Codes ist ein Gerät 5 Minuten gesperrt."),
      h("div.item-head", { style: "margin-top:var(--s4)" }, h("b", {}, "Gekoppelte Handys")),
      phones.length === 0 ? h("p.meta", {}, "Noch keins.")
        : h("ul.rows.compact", {}, phones.map((p) => h("li", {}, h("div.row-main", {},
            h("div", {}, h("b", {}, p.name), h("div.meta", {}, `zuletzt ${ago(p.lastSeen)}`)),
            h("div.row", {},
              h("button.btn.small.ghost", { onclick: () => renamePhoneDialog(rerender, p) }, "Umbenennen"),
              h("button.btn.small.ghost.danger", { onclick: async () => { if (await ask(`„${p.name}“ entkoppeln? Das Handy erreicht diesen PC danach nicht mehr.`)) { await unpairPhone(p.id); rerender(); } } }, "Entkoppeln")))))),
      syncHint,
      h("small.meta", {}, "Windows fragt beim ersten Mal nach der Firewall – „Private Netzwerke“ erlauben."));
  };
  const phonePart = () => {
    const peers = d.peers || [];
    return h("div.item", {},
      h("div.item-head", {}, h("b", {}, "Gekoppelte PCs"), h("button.btn.small", { onclick: () => peerDialog(rerender) }, "PC koppeln")),
      peers.length === 0 ? h("p.meta", {}, "Noch kein PC. Ohne PC gibt es nur Meldung, Rückmeldung und Licht.")
        : h("ul.rows.compact", {}, peers.map((p) => {
            const st = direct.peers[p.id];
            return h("li", {}, h("div.row-main", {},
              h("div", {}, h("b", {}, p.name, st && h("span.badge" + (st.ok ? "" : ".bad"), {}, st.ok ? "erreichbar" : st.error)),
                h("div.meta", {}, `${p.host}:${p.port || 8765}${p.paired ? "" : " · noch nicht gekoppelt"}`)),
              h("div.row", {},
                h("button.btn.small.ghost", { onclick: () => pingPeer(p).then(rerender) }, "Prüfen"),
                h("button.btn.small.ghost", { onclick: () => peerDialog(rerender, p) }, "Bearbeiten"),
                h("button.btn.small.ghost.danger", { onclick: async () => { if (await ask(`„${p.name}“ entfernen? Am PC zusätzlich „Entkoppeln“ wählen.`)) { removePeer(p.id); rerender(); } } }, "Entfernen"))));
          })),
      peers.some((p) => p.paired) && h("div.row", {},
        h("button.btn.small.ghost", { onclick: () => syncPeers().then(() => { rerender(); toast("Abgeglichen"); }) }, "Jetzt abgleichen"),
        direct.lastSync ? h("small.meta", {}, `Zuletzt abgeglichen ${fmtAgo(direct.lastSync)}`) : null),
      syncHint,
      h("small.meta", {}, "Handy und PC müssen im selben WLAN sein."));
  };
  return section("betrieb", "Betrieb", "",
    modeChoice((v) => { set("mode", v); connect(); startReceiver(); rerender(); }),
    h("details.item.flow-wrap", {}, h("summary", {}, h("b", {}, "So läuft ein Alarm")), setupFlow()),
    hasPcFeatures ? pcPart() : phonePart(),
    m === "direkt" && switchRow("Routinen auf diesem Gerät ausführen", hasPcFeatures ? "Normalerweise macht das das Handy. Nur einschalten, wenn kein Handy Routinen ausführt." : "Licht und Alexa bei Alarm. Nur auf einem Gerät einschalten.",
      runsHere(), (v) => { set("direct.routines", v); rerender(); }),
  );
}

function verbindung(rerender) {
  const host = settings().broker.host;
  return section("verbindung", "Verbindung", "Gerät, das immer läuft (NAS, Mini-PC, Raspberry Pi). Ohne Zentrale kein Melder-Alarm.",
    h("div.fields", {},
      field("Adresse", text("broker.host", { placeholder: "z. B. 192.168.1.10", inputmode: "url", autocomplete: "off" }), "Die feste IP der Zentrale. Im WLAN-Router für dieses Gerät eine feste IP-Adresse einstellen."),
      field("Port", text("broker.port", { type: "number", min: 1, max: 65535 }), "Fast immer 9001 – nur ändern, wenn du ihn in der Zentrale geändert hast."),
      field("Benutzer", text("broker.user", { autocomplete: "off" }), "Fast immer „heimalarm“."),
      field("Passwort", text("broker.pass", { type: "password", autocomplete: "off" }), "Das Passwort, das du beim Einrichten der Zentrale in die Datei .env geschrieben hast (MQTT_PASSWORD).")),
    toggle("broker.tls", "Verschlüsselt (TLS)", "Im Heimnetz nicht nötig. Nur einschalten, wenn deine Zentrale dafür eingerichtet ist. Sonst klappt die Verbindung nicht."),
    host && !PRIVATE.test(host) && h("div.banner.warn", {}, h("div", {}, h("b", {}, "Adresse liegt nicht im Heimnetz"), "Heimalarm ist fürs Heimnetz gedacht. Stell die Zentrale nicht offen ins Internet. Für unterwegs eignet sich z. B. ein VPN über deinen Router.")),
    h("div.row", {}, h("button.btn.primary", { onclick: () => { connect(); toast("Verbinde mit der Zentrale …"); setTimeout(rerender, 1500); } }, "Speichern & verbinden")),
  );
}

function alarm(rerender) {
  const me = settings().alarm.me;
  return section("alarm", "Alarm", "Wie die App mit Alarmen umgeht – egal aus welcher Quelle.",
    h("div.fields", {},
      field("Meine Kennung", kennungInput("alarm.me", {}, false, rerender), KENNUNG_HINT),
      field("Sperrzeit (Sekunden)", text("alarm.lockoutSec", { type: "number", min: 0, max: 600 }), "Kommt derselbe Alarm in dieser Zeit noch einmal (z. B. erst vom Melder, dann von SYBOS), zählt er als ein Einsatz."),
      field("Alarm halten (Sekunden)", text("alarm.holdSec", { type: "number", min: 0, max: 120 }), "Handy: Ist die Zentrale gerade nicht erreichbar, wird ein Alarm aus SYBOS, aPager oder Divera so lange gehalten und dann an die PCs weitergegeben. 0 = aus, höchstens 120.")),
    me === "ich" && h("div.banner.warn", {}, h("div", {}, h("b", {}, "Noch die Standard-Kennung „ich“"), "Passt, solange nur eine Person Heimalarm nutzt. Bei mehreren Personen bekommt jede eine eigene Kennung, sonst lösen sie sich gegenseitig aus.")),
    toggle("alarm.testMode", "Testmodus", "Alle Alarme nur anzeigen – der PC bleibt an."),
    h("div.row", {}, h("button.btn", { onclick: testAlarm }, "Testalarm"), h("a.btn.ghost", { href: "#/diagnose" }, "Weitere Tests")),
    h("details.item", {}, h("summary", {}, h("b", {}, "Wo muss die Kennung überall stehen?")),
      h("ul.meta", {},
        h("li", {}, "In der App auf jedem eigenen PC und Handy (hier)"),
        h("li", {}, "Im ESP32: ", h("code", {}, "kennung:"), " oben in der YAML-Datei"),
        h("li", {}, "Für weitere Personen unter Personen"))),
  );
}

// ── Alarmquellen ───────────────────────────────────
// Aufbau je Quelle: Kopfzeile (Name, Kurzinfo was aktiv ist, Schalter) → aufgeklappt in Gruppen
// „Zugang“, „Alarm empfangen“, „Rückmeldung“. Alles optional, jede Quelle für sich.

/** Paketname per „Erkennen“: zuletzt gesehene Apps mit Benachrichtigungen zur Auswahl. */
function pickPackage(path, rerender) {
  // Live gesehene (laufende App) und nativ gemerkte (auch ohne laufende App) zusammen, neueste zuerst
  const native = (androidState()?.recentApps || []).toReversed();
  const list = [...new Set([...[...recentApps.keys()].toReversed(), ...native])];
  const st = androidState();
  if (isAndroid && st?.supported && !st.notificationAccess) { askNotifAccess(rerender); return; }
  const close = dialog("App erkennen",
    h("p.meta", {}, list.length ? "Apps mit den letzten Benachrichtigungen. Tippe auf die Alarm-App." : "Noch keine Benachrichtigung gesehen. Schick dir aus der Alarm-App eine Testmeldung und öffne das hier erneut."),
    list.length > 0 && h("ul.rows.compact", {}, list.map((pkg) => h("li", {}, h("button.btn.ghost.pick", { onclick: () => { set(path, pkg); close(); rerender(); toast("Übernommen"); } }, h("code", {}, pkg))))));
}

/** Erste lesbare Zeile der Release-Notizen – ohne Markdown, Links und „Full Changelog“. */
const noteLine = (notes = "") => notes.split("\n").map((l) => l.replace(/[*_#`>]/gu, "").replace(/https?:\/\/\S+/gu, "").trim())
  .find((l) => l && !/^full changelog:?$/iu.test(l)) || "";

/** Fehlt der Zugriff auf Benachrichtigungen, kommt kein Alarm aus SYBOS, aPager oder Divera an – direkt anbieten. */
async function askNotifAccess(rerender) {
  if (!isAndroid) return;
  if (!androidState()) await refreshAndroid();
  const st = androidState();
  if (!st?.supported || st.notificationAccess) return;
  if (await ask("Heimalarm darf Benachrichtigungen noch nicht mitlesen. Ohne diesen Zugriff wird kein Alarm aus der Alarm-App erkannt. Jetzt erlauben?", { ok: "Erlauben" })) {
    openNotificationAccess().catch(() => toast("Einstellung ließ sich nicht öffnen"));
  }
  rerender?.();
}
const notifToggle = (path, rerender, after) => (v) => { set(path, v); after?.(); rerender(); if (v) askNotifAccess(rerender); };

const group = (title, ...body) => h("div.group", {}, h("h3.group-title", {}, title), ...body.flat().filter(Boolean));

function sourceRow({ id, title, summary, on, onToggle, badge, body }) {
  return h("div.source" + (on ? ".on" : ""), { id: `quelle-${id}` },
    h("label.switch.source-head", {},
      h("div", {}, h("b", {}, title, badge), h("small", {}, summary)),
      h("input", { type: "checkbox", role: "switch", checked: on, "aria-label": `${title} als Alarmquelle`, onchange: (e) => onToggle(e.target.checked) })),
    on && body && h("div.source-body", {}, ...body.filter(Boolean)));
}

/** Benachrichtigung mitlesen (nur Android) – auf PC nur Hinweis. */
function notifGroup(id, rerender) {
  if (!isAndroid) return group("Alarm empfangen", h("p.meta", {}, id === "divera" ? "Am Handy liest Heimalarm die Divera-Benachrichtigung mit. Am PC fragt Heimalarm Divera direkt ab. Dafür unten den Divera-Schlüssel eintragen." : "Das Handy liest mit und gibt den Alarm über die Zentrale an diesen PC."));
  return group("Alarm empfangen",
    h("div.inline", {},
      field("App auf dem Handy", text(`alarm.apps.${id}.pkg`, { autocomplete: "off", placeholder: "über „Erkennen“ wählen" }), "Paketname, ein Teil reicht."),
      h("button.btn.small", { onclick: () => pickPackage(`alarm.apps.${id}.pkg`, rerender) }, "Erkennen")));
}

const statusSelect = (path, list, empty = "– nichts –") => list.length
  ? select([["", empty], ...list.map((x) => [x.id, x.name])], get(path), (v) => set(path, v))
  : text(path, { inputmode: "numeric", placeholder: "Status-ID" });

function diveraSource(rerender) {
  const d = settings().divera, on = settings().alarm.apps.divera.on;
  const load = async (e) => {
    e.target.disabled = true;
    try { const r = await loadDivera(); toast(`Verbunden${r.unit ? " · " + r.unit : ""}`); rerender(); }
    catch (err) { toast(err.message); rerender(); }
    e.target.disabled = false;
  };
  const parts = [isAndroid && settings().alarm.apps.divera.pkg && "Mitlesen", d.key && d.poll && `Abfrage ${d.pollSec} s`, d.key && (d.answer || d.setStatus) && "Rückmeldung"].filter(Boolean);
  const badge = !d.key ? null : divera.ok === false ? h("span.badge.bad", {}, "Fehler") : d.unit ? h("span.badge", {}, d.unit) : null;
  return sourceRow({
    id: "divera", title: "Divera 24/7", on, badge,
    summary: on && parts.length ? parts.join(" · ") : "Mitlesen, direkt bei Divera abfragen, Rückmeldung und Status.",
    onToggle: (v) => { set("alarm.apps.divera.on", v); restartDivera(); rerender(); },
    body: [
      group("Zugang",
        h("div.inline", {},
          field("Divera-Schlüssel (in Divera: Accesskey)", h("input.input", { type: "password", autocomplete: "off", spellcheck: "false", value: d.key, placeholder: "dvpat-…",
            onchange: (e) => { set("divera.key", e.target.value.trim()); restartDivera(); rerender(); } }), "Divera im Browser → Einstellungen → Debug → Accesskey. Bleibt auf diesem Gerät."),
          h("button.btn.small", { onclick: load, disabled: !d.key }, d.unit ? "Neu laden" : "Verbinden")),
        divera.ok === false && h("p.meta.err", {}, divera.error)),
      notifGroup("divera", rerender),
      d.key && h("div.group-cont", {},
        toggle("divera.poll", "Bei Divera abfragen", "Auch ohne Divera-Mitteilung, solange die App läuft.", () => { restartDivera(); rerender(); }),
        d.poll && field("Abfrage alle (Sekunden)", text("divera.pollSec", { type: "number", min: 10, max: 300 }, { onSave: restartDivera }), "15–30 s reichen.")),
      d.key && group("Rückmeldung bei Antwort (optional)",
        h("p.meta", {}, "Nach „Fährst du?“ am PC oder per Karte in der Übersicht. Beides ist aus, bis du es einschaltest."),
        toggle("divera.answer", "Rückmeldung zum Einsatz senden", "Antwortet in Divera auf den Alarm, z. B. „Komme“ / „Komme nicht“.", () => rerender()),
        d.answer && h("div.fields", {},
          field("Bei „Ich fahre“", statusSelect("divera.answerGo", d.answers), "Rückmeldung zum Divera-Alarm."),
          field("Bei „Ich fahre nicht“", statusSelect("divera.answerStay", d.answers))),
        toggle("divera.setStatus", "Meinen Status setzen", "Setzt deinen Divera-Status – egal über welche Quelle der Alarm kam.", () => rerender()),
        d.setStatus && h("div.fields", {},
          field("Bei „Ich fahre“", statusSelect("divera.statusGo", d.statuses)),
          field("Bei „Ich fahre nicht“", statusSelect("divera.statusStay", d.statuses))),
        d.setStatus && h("div.fields", {},
          field("Status zurücksetzen nach (min)", text("divera.resetMin", { type: "number", min: 0, max: 720 }), "0 = nie"),
          d.resetMin > 0 && field("… auf", statusSelect("divera.resetTo", d.statuses, "– wählen –"))),
        (d.answer || d.setStatus) && field("Notiz", text("divera.note", { placeholder: "z. B. per Heimalarm", maxlength: 80 }), "Optional, erscheint in Divera."),
        (d.answer || d.setStatus) && !d.statuses.length && h("p.meta", {}, "Tipp: „Verbinden“ lädt eure Status als Auswahl.")),
      d.key && has.pi() && diveraOnZentrale(rerender),
    ],
  });
}

/** Schlüssel freiwillig der Zentrale geben – nur dann kann eine Routine deinen Status setzen, auch wenn das Handy aus ist. */
function diveraOnZentrale(rerender) {
  const me = settings().alarm.me, info = state.diveraKeys?.[me];
  const send = (key) => { publish("heimalarm/cmd/divera/key", { who: me, key }); toast(key ? "Wird geprüft …" : "Schlüssel auf der Zentrale gelöscht"); setTimeout(rerender, 2500); };
  return group("Divera-Status per Routine",
    h("p.meta", {}, "Damit setzen Routinen der Zentrale deinen Divera-Status, auch wenn das Handy aus ist. Der Schlüssel liegt dafür auf der Zentrale."),
    info?.ok === false && h("p.meta.err", {}, `Nicht übernommen: ${info.error}`),
    h("div.row", {},
      info?.ok ? h("span.badge", {}, `Hinterlegt für „${me}“`) : null,
      h("button.btn.small", { disabled: !state.dienst?.online, onclick: async () => { if (await requireAdmin()) send(settings().divera.key); } }, info?.ok ? "Neu übertragen" : "Auf der Zentrale hinterlegen"),
      info && h("button.btn.small.ghost.danger", { onclick: async () => { if (await ask("Schlüssel auf der Zentrale löschen? Routinen können deinen Status dann nicht mehr setzen.")) send(""); } }, "Löschen")),
    !state.dienst?.online && h("p.meta", {}, "Zentrale-Programm nicht erreichbar."));
}

function apagerSource(rerender) {
  const a = settings().apager, on = settings().alarm.apps.apager.on;
  const parts = [isAndroid && settings().alarm.apps.apager.pkg && "Mitlesen", shared().webhookSecret && "Webhook", a.key && a.feedback && "Rückmeldung"].filter(Boolean);
  return sourceRow({
    id: "apager", title: "aPager PRO", on,
    summary: on && parts.length ? parts.join(" · ") : "Mitlesen, Webhook (Zentrale oder PC), Rückmeldung.",
    onToggle: notifToggle("alarm.apps.apager.on", rerender),
    body: [
      notifGroup("apager", rerender),
      group("Webhook (Smart-Home-Paket in aPager)",
        h("p.meta", {}, "aPager ruft bei Alarm eine Adresse auf (nur Stichwort und Einheit). So geht’s: 1. In aPager Einstellungen → Labor → Webhooks öffnen. 2. Adresse unten eintragen. 3. In der Einheit „Webhooks aktivieren“. Smart-Home-Paket nötig."),
        h("p.meta", {}, "An die Zentrale: Adresse unter ", h("a", { href: "#/einstellungen/zentrale" }, "Zentrale"), ". Geht von überall, wenn die Zentrale erreichbar ist."),
        hasPcFeatures ? h("div.field", {}, h("span", {}, "Direkt an diesen PC (ohne Zentrale)"),
          webhookUrl() ? h("code", { style: "overflow-wrap:anywhere" }, webhookUrl()) : h("small", {}, "Startet gerade …"),
          h("div.row", {},
            webhookUrl() && h("button.btn.small.ghost", { onclick: () => copyText(webhookUrl()).then(() => toast("Kopiert")) }, "Kopieren"),
            h("button.btn.small.ghost", { onclick: async () => { if (await ask("Neuen Schlüssel erzeugen? Die alte Adresse in aPager funktioniert dann nicht mehr.")) { await renewHookKey(); rerender(); } } }, "Neuer Schlüssel")),
          h("small", {}, "Funktioniert, solange das Handy mit aPager im selben WLAN ist wie der PC."))
          : h("p.meta", {}, "Direkt an einen PC geht auch: Die Adresse steht am PC unter Einstellungen → Alarmquellen → aPager PRO.")),
      group("Rückmeldung bei Antwort (optional)",
        h("div.inline", {},
          field("API-Schlüssel", h("input.input", { type: "password", autocomplete: "off", value: a.key, onchange: (e) => { set("apager.key", e.target.value.trim()); rerender(); } }),
            "aPager → Verfügbarkeit → Zahnrad → Externer Zugriff. Smart-Home-Abo nötig."),
          h("button.btn.small", { disabled: !a.key, onclick: async () => { const r = await answerApager(true, { quiet: true }); toast(r.code === 204 ? "Schlüssel gültig" : r.text); } }, "Prüfen")),
        a.key && toggle("apager.feedback", "Zusage / Absage senden", "„Ich fahre“ = komme, „Ich fahre nicht“ = komme nicht. Nur Alarme der letzten 3 Minuten."),
        a.key && toggle("apager.silent", "Ohne Bestätigungs-Push", "aPager zeigt dann keine eigene Meldung.")),
    ],
  });
}

let statusLoading = false;   // nur einmal nachladen, auch wenn der Status nicht kommt
function quellen(rerender) {
  const a = settings().alarm;
  const sybosOn = a.apps.sybos.on;
  const anyNotif = Object.values(a.apps).some((x) => x.on) || a.filterApps;
  // Status hier selbst laden – sonst erscheint der Hinweis nur, wenn vorher eine andere Seite ihn geholt hat
  const st = android || androidState();
  if (isAndroid && !st && !statusLoading) { statusLoading = true; refreshAndroid().then(() => rerender()); }
  return section("quellen", "Alarmquellen", "Mehrere gleichzeitig möglich. Die Sperrzeit macht daraus einen Einsatz.",
    isAndroid && anyNotif && st?.supported && !st.notificationAccess && h("div.banner.warn", {}, h("div", {}, h("b", {}, "Mitlesen nicht erlaubt"),
      "Ohne diesen Zugriff erkennt Heimalarm keinen Alarm aus SYBOS, aPager oder Divera. Ist der Schalter in Android ausgegraut: App-Infos von Heimalarm → ⋮ → „Eingeschränkte Einstellungen zulassen“.",
      h("div.row", { style: "margin-top:8px" }, h("button.btn.small", { onclick: () => openNotificationAccess() }, "Erlauben")))),
    h("div.sources", {},
      sourceRow({ id: "esp32", title: "Melder", summary: mode() === "zentrale" ? "Ladeschale über den ESP32. Hauptweg." : "Braucht die Zentrale (Betrieb → Mit Zentrale).", on: a.mqtt && mode() === "zentrale", onToggle: (v) => { set("alarm.mqtt", v); rerender(); } }),
      sourceRow({ id: "sybos", title: "SYBOS", on: sybosOn,
        summary: "Benachrichtigung der SYBOS-App mitlesen.",
        onToggle: notifToggle("alarm.apps.sybos.on", rerender),
        body: [notifGroup("sybos", rerender), group("Rückmeldung", h("p.meta", {}, "SYBOS bietet dafür keine offene Schnittstelle. Rückmeldung weiter in der SYBOS-App."))] }),
      apagerSource(rerender),
      diveraSource(rerender),
    ),
    isAndroid && h("details.more", {},
      h("summary", {}, "Weitere Apps & Filter"),
      field("Weitere Apps", text("alarm.filterApps", { placeholder: "z. B. de.example.alarm" }), "Paketnamen, kommagetrennt."),
      field("Schlüsselwörter", text("alarm.filterWords"), "Eines muss in der Meldung stehen. Leer = jede Meldung.")),
  );
}

// ── Sprachassistenten ──────────────────────────────
function qrSvg(textValue) {
  const q = qrcode(0, "M");
  q.addData(textValue); q.make();
  const box = h("div.qr", { role: "img", "aria-label": "Matter-QR-Code" });
  box.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  return box;
}

function sprache(rerender) {
  const v = state.voice;
  const cfg = { enabled: true, openSec: 30, tests: false, ...shared().voice };
  const setCfg = async (patch) => { if (await requireAdmin()) { updateShared({ voice: { ...cfg, ...patch } }); rerender(); } };
  const host = settings().broker.host || "<zentrale>";
  const sensors = v?.sensors || [];
  const statusChip = !state.connected ? h("span.chip", {}, "Zentrale getrennt")
    : !v ? h("span.chip", {}, "Zentrale antwortet nicht")
    : !cfg.enabled ? h("span.chip", {}, "aus")
    : v.running ? h("span.chip" + (v.commissioned ? ".ok" : ".warn"), {}, v.commissioned ? `gekoppelt · ${v.fabrics?.length || 1}` : "bereit zum Koppeln")
    : h("span.chip.bad", {}, "startet nicht");
  const vm = shared().voicemonkey || {};
  const vmItem = h("div.item", {},
    h("div.item-head", {}, h("b", {}, "Alexa über Voice Monkey"), h("span.chip" + (vm.token ? ".ok" : ""), {}, vm.token ? "eingerichtet" : "aus")),
    h("p.meta", {}, "Geht auch ohne Zentrale. In Routinen: „+ Alexa sagt an“ liest Stichwort und Adresse vor, „+ Alexa-Routine“ startet eine Routine."),
    field("API-Token", h("input.input", { type: "password", autocomplete: "off", value: vm.token || "", placeholder: "aus voicemonkey.io → Dashboard → API",
      onchange: async (e) => { if (await requireAdmin()) { updateShared({ voicemonkey: { token: e.target.value.trim() } }); rerender(); } } }),
      "Ansage: in Voice Monkey unter Devices einen „Speaker“ für deinen Echo anlegen. Routine: einen „Routine Trigger“ anlegen und in der Alexa-App als Auslöser wählen."));
  if (!has.pi()) {
    return section("sprache", "Alexa & Google Home", "Ohne Zentrale über Voice Monkey (Alexa). Matter und Google brauchen die Zentrale.", vmItem);
  }
  return section("sprache", "Alexa & Google Home", "Lokal über Matter – oder Alexa per Voice Monkey.",
    vmItem,
    h("div.item", {},
      h("div.item-head", {}, h("b", {}, "Alarm als Auslöser (Matter)"), statusChip),
      h("p.meta", {}, "Die Zentrale meldet sich als Kontaktsensor. Bei Alarm öffnet er sich kurz. Damit startest du in Alexa oder Google Home eine Routine, z. B. die Ansage „Einsatz!“ auf allen Lautsprechern."),
      switchRow("Sensoren bereitstellen", "Gilt für die ganze Zentrale.", cfg.enabled, (on) => setCfg({ enabled: on })),
      cfg.enabled && v?.error && !v.running && h("div.banner.warn", {}, h("div", {}, h("b", {}, "Matter startet nicht"), v.error)),
      cfg.enabled && v?.running && h("div.pair", {},
        qrSvg(v.qr),
        h("div.pair-text", {},
          h("b", {}, v.commissioned ? "Weiteren Assistenten koppeln" : "So koppelst du"),
          h("ol.pair-steps", {},
            h("li", {}, h("b", {}, "Alexa: "), "Geräte → + → Gerät hinzufügen → Matter."),
            h("li", {}, h("b", {}, "Google Home: "), "+ → Gerät einrichten → Neues Gerät → Matter."),
            h("li", {}, "QR-Code scannen oder Code eingeben:")),
          h("div.row", {}, h("code.pair-code", {}, v.manual.replace(/(\d{4})(\d{3})(\d{4})/u, "$1-$2-$3")),
            h("button.btn.small.ghost", { onclick: () => copyText(v.manual).then(() => toast("Kopiert")) }, "Kopieren")),
          h("small.meta", {}, "Ein Gerät kann mit Alexa und Google Home gleichzeitig gekoppelt sein. Für den zweiten Assistenten in der ersten App „Mit anderer App teilen“ wählen."))),
      cfg.enabled && sensors.length > 0 && h("div.field", {}, h("span", {}, "Sensoren"),
        h("div.row", {}, sensors.map((n) => h("span.badge", {}, n))),
        h("small", {}, "„Heimalarm Einsatz“ bei jedem Alarm, dazu einer je Person aus „Personen“.")),
      cfg.enabled && h("div.fields", {},
        field("Sensor bleibt offen (Sekunden)", h("input.input", { type: "number", min: 5, max: 600, value: cfg.openSec, onchange: (e) => setCfg({ openSec: Math.max(5, Number(e.target.value) || 30) }) }), "Danach meldet er wieder „geschlossen“.")),
      cfg.enabled && switchRow("Auch bei Testalarmen auslösen", "Sonst nur echte Alarme und Generalprobe.", cfg.tests, (on) => setCfg({ tests: on })),
      cfg.enabled && v?.running && h("div.row", {},
        h("button.btn.small", { onclick: () => { if (publish("heimalarm/cmd/voice/test", {})) toast("Sensor geöffnet – Routine sollte starten"); } }, "Routine testen"),
        v.commissioned && h("button.btn.small.ghost.danger", { onclick: async () => { if (await requireAdmin() && await ask("Alle Kopplungen mit Alexa/Google Home löschen? Routinen dort müssen danach neu angelegt werden.")) publish("heimalarm/cmd/voice/reset", {}); } }, "Kopplungen löschen"))),
    h("div.item", {},
      h("div.item-head", {}, h("b", {}, "Licht & Geräte steuern")),
      h("p.meta", {}, "Zigbee-Lichter und -Gruppen erscheinen in Alexa und Google Home („Alexa, Flurlicht an“). Dafür läuft Matterbridge auf der Zentrale."),
      h("ol.pair-steps", {},
        h("li", {}, "Auf der Zentrale: ", h("code", {}, "docker compose --profile zigbee --profile matter up -d")),
        h("li", {}, "Oberfläche öffnen, Plugin ", h("code", {}, "matterbridge-zigbee2mqtt"), " hinzufügen."),
        h("li", {}, "Den dort gezeigten QR-Code in Alexa bzw. Google Home scannen.")),
      h("div.row", {}, h("a.btn.small", { href: `http://${host}:8283`, target: "_blank", rel: "noopener" }, "Matterbridge öffnen"))),
    h("div.item", {},
      h("div.item-head", {}, h("b", {}, "Matter-Geräte in Heimalarm"),
        state.matter?.length ? h("span.chip.ok", {}, `${state.matter.length} Gerät${state.matter.length === 1 ? "" : "e"}`) : h("span.chip", {}, "keine")),
      h("p.meta", {}, "Geräte aus Alexa, Google Home & Co. kann auch Heimalarm schalten. Dort bleiben sie erhalten."),
      h("div.row", {}, h("a.btn.small", { href: "#/geraete/matter" }, "Matter-Gerät hinzufügen"))),
    h("p.meta", {}, "Nötig: ein Echo mit Matter-Unterstützung bzw. ein Nest-Lautsprecher, Nest Hub oder Google TV im selben WLAN."),
  );
}

/** Kontakt-Logik direkt im ESP32 umschalten – ohne neu zu flashen. */
function segmentedEsp(d, me) {
  const pick = (open) => () => { if (publish(`alarm/${me}/switch/alarm_bei_offen/command`, open ? "ON" : "OFF")) toast("An den ESP32 gesendet"); };
  const on = d?.invert === true, known = d?.invert !== undefined;
  return h("div.row", {},
    h("button.btn.small" + (known && !on ? ".primary" : ""), { type: "button", onclick: pick(false), disabled: !d?.online }, "schließt"),
    h("button.btn.small" + (on ? ".primary" : ""), { type: "button", onclick: pick(true), disabled: !d?.online }, "öffnet"),
    !known && h("span.meta", {}, d?.online ? "ältere Firmware – neu flashen" : "ESP32 offline"));
}

function esp32() {
  const me = settings().alarm.me;
  const d = state.devices[me];
  const url = h("input.input", { placeholder: "http://192.168.1.10/alarm-ich.ota.bin", inputmode: "url" });
  const md5 = h("input.input", { placeholder: "MD5-Prüfsumme (zeigt ESPHome beim Bauen)", autocomplete: "off" });
  return section("esp32", "Kontakt & Überwachung", null,
    h("div.fields", {},
      field("Mindestdauer Kontakt (ms)", text("alarm.minDurationMs", { type: "number", min: 10, max: 5000 }, {
        onSave: (v) => { if (publish(`alarm/${me}/number/min_duration/command`, String(v))) toast("An den ESP32 gesendet"); },
      }), `Kürzere Impulse werden ignoriert. Aktuell im ESP32: ${d?.minDuration ?? "–"} ms`),
      h("div.field", {}, h("span", {}, "Alarm, wenn der Kontakt"),
        segmentedEsp(d, me),
        h("small", {}, "Bei den meisten Ladeschalen schließt der Kontakt bei Alarm. Prüfen unter Test & Diagnose → Kontakt-Test.")),
      field("Lebenszeichen erwartet alle (s)", text("alarm.heartbeatSec", { type: "number", min: 60, max: 3600 }), "Kommt so lange nichts, gibt es eine Warnung."),
      field("Offline-Warnung nach (s)", text("alarm.offlineWarnSec", { type: "number", min: 30, max: 3600 }), "Ist der ESP32 so lange offline, kommt eine Meldung.")),
    h("div.field", {}, h("span", {}, "Firmware-Update über WLAN"), url, md5,
      h("small", {}, "Adresse einer mit ESPHome gebauten .ota.bin-Datei im Heimnetz und ihre MD5-Prüfsumme.")),
    h("div.row", {}, h("button.btn", { onclick: async () => {
      if (!url.value.trim() || md5.value.trim().length !== 32) return toast("Bitte Adresse und 32-stellige MD5-Summe eintragen");
      if (await ask("Firmware jetzt auf den ESP32 spielen? Er startet danach neu.") && publish(`alarm/${me}/ota`, `${url.value.trim()}|${md5.value.trim()}`)) toast("Update gestartet");
    } }, "Firmware aufspielen")),
  );
}

/* Status-LED am ESP32 (esp32/led/logik.yaml). Die Tabelle steht genauso in der ESP32-Anleitung (PDF). */
const LED_EVENTS = [
  ["Alarm (Kontakt)", "--signal", "rot, schnell blinkend", "schnell blinkend", "Bis der Kontakt öffnet, höchstens 60 s."],
  ["Firmware-Update", "--c-pc", "türkis, sehr schnell", "sehr schnell blinkend", ""],
  ["Test, Kontakt-Test", "--c-routine", "violett, pulsierend", "pulsierend", "Beim Kontakt-Test: Dauerlicht, solange der Kontakt geschlossen ist."],
  ["Sucht WLAN", "--c-net", "blau, langsam pulsierend", "langsam pulsierend", ""],
  ["Zentrale nicht erreicht", "--warn", "orange, blinkend", "blinkend", "Was fehlt, zeigt die App auf Start."],
  ["Mit Zentrale verbunden", "--ok", "3 s grün, dann aus", "3 s an, dann aus", ""],
  ["Nicht verfügbar", "--warn", "gelb, schwach", "aus", "Folgt der Bereitschaft auf Start."],
  ["Alles in Ordnung", "--text-2", "aus (mit Ruhelicht schwach grün)", "aus", ""],
];
const LED_MODES = [["Alles", "Alles"], ["Nur Alarm und Fehler", "Nur Alarm und Fehler"], ["Nur Alarm", "Nur Alarm"]];

function ledSection() {
  const me = settings().alarm.me;
  const d = state.devices[me];
  const send = (topic, v, ok = "An den ESP32 gesendet") => { if (publish(`alarm/${me}/${topic}`, v)) toast(ok); };
  const rgb = d?.ledType === "rgb";
  const known = Boolean(d?.ledType);
  const offline = !d?.online;
  const table = h("div.table-wrap", {}, h("table.table.led-table", {},
    h("tr", {}, h("th", {}, "Ereignis"), h("th", {}, rgb || !known ? "Farbige LED" : "LED"), !known && h("th", {}, "Einfarbige LED")),
    LED_EVENTS.map(([ev, c, col, mono, note]) => h("tr", {},
      h("td", {}, ev, note && h("small", {}, note)),
      (rgb || !known) && h("td", {}, h("span.led-dot", { style: `--a:var(${c})`, "aria-hidden": "true" }), col),
      (!rgb || !known) && h("td", {}, mono)))));
  const level = h("input", { type: "range", min: 5, max: 100, step: 5, value: d?.ledLevel ?? 40, disabled: offline || !d?.ledOn, "aria-label": "Helligkeit",
    oninput: (e) => { lvlText.textContent = `${e.target.value} %`; },
    onchange: (e) => send("number/led_helligkeit/command", e.target.value) });
  const lvlText = h("span.mono", {}, `${d?.ledLevel ?? 40} %`);
  return section("led", "LED am ESP32", "Die Lampe auf dem Board zeigt, was der Melder gerade tut. Das hilft beim Einrichten und als Kontrolle an der Ladeschale.",
    !known && h("p.hint", {}, offline ? "ESP32 offline – die Einstellungen erscheinen, sobald er sich meldet." : "Die Firmware auf dem ESP32 kennt die LED noch nicht. Einmal neu bauen und aufspielen (Anleitung ESP32, Schritt 4)."),
    known && switchRow("LED benutzen", rgb ? "Farbige LED erkannt." : "Einfarbige LED erkannt – sie zeigt Blinkmuster statt Farben.", d.ledOn !== false, (v) => send("switch/led/command", v ? "ON" : "OFF")),
    known && rgb && h("div.fields", {},
      h("div.field", {}, h("span", {}, "Helligkeit"), h("div.row", {}, level, lvlText), h("small", {}, "Nachts an der Ladeschale reichen meist 10–20 %.")),
      field("Wann leuchten", select(LED_MODES, d.ledMode || "Alles", (v) => send("select/led_modus/command", v), { disabled: offline || !d.ledOn }), "„Nur Alarm“: bleibt sonst dunkel, auch bei Fehlern.")),
    known && rgb && switchRow("Ruhelicht", "Schwach grün, solange alles in Ordnung ist – zeigt auf einen Blick, dass der Melder läuft.", d.ledIdle, (v) => send("switch/led_ruhelicht/command", v ? "ON" : "OFF")),
    known && h("div.row", {},
      h("button.btn", { type: "button", disabled: offline, onclick: () => send("led/test", "demo", "LED zeigt alle Zustände nacheinander") }, rgb ? "Alle Farben zeigen" : "Alle Muster zeigen"),
      h("button.btn.ghost", { type: "button", disabled: offline, onclick: () => send("led/test", "test", "LED zeigt 5 s „Test“") }, "Test-Signal")),
    h("h3", {}, "Was die LED zeigt"),
    table);
}

function pc(rerender) {
  const p = settings().pc;
  if (hibernateOn === null) hibernateEnabled().then((v) => { hibernateOn = v; rerender(); }).catch(() => (hibernateOn = false));
  return section("pc", "PC bei Alarm", "Was nach der Abfrage „Fährst du?“ passiert. Jeder PC mit Heimalarm fragt selbst, mehrere PCs und Laptops gehen also gleichzeitig.",
    toggle("pc.silent", "Bei Alarm aus", "Dieser PC fragt nicht „Fährst du?“ und bleibt an. Der Testalarm geht weiter.", () => rerender()),
    field("Abfrage auch bei Alarm von", kennungInput("pc.alsoFor", { placeholder: "z. B. max, anna" }, true), "Weitere Kennungen, mit Komma getrennt. Für einen gemeinsamen PC, der bei mehreren Personen ausgehen soll. Leer = nur bei eigener Kennung."),
    h("div.field", {}, h("span", {}, "Aktion"),
      select(Object.entries(ACTIONS).map(([k, v]) => [k, v.label]), p.action, (v) => { set("pc.action", v); rerender(); }),
      h("small", {}, ACTIONS[p.action]?.hint)),
    p.action === "hibernate" && hibernateOn === false && h("div.banner.warn", {}, h("div", {},
      h("b", {}, "Ruhezustand ist in Windows ausgeschaltet"), "Ohne ihn fährt der PC nicht richtig herunter.",
      h("div.row", { style: "margin-top:8px" }, h("button.btn.small", { onclick: () => enableHibernate().then(() => { toast("Bitte die Windows-Abfrage bestätigen"); setTimeout(() => { hibernateOn = null; rerender(); }, 6000); }) }, "Ruhezustand einschalten")))),
    h("div.fields", {},
      field("Countdown (Sekunden)", text("pc.countdownSec", { type: "number", min: 5, max: 300 })),
      h("div.field", {}, h("span", {}, "Ohne Antwort"), segmented([["run", "Ausführen"], ["cancel", "Abbrechen"]], p.onTimeout, (v) => set("pc.onTimeout", v)))),
    h("div.fields", {},
      field("Überschrift", text("pc.title")), field("Knopf „fahren“", text("pc.goText")), field("Knopf „bleiben“", text("pc.stayText"))),
    toggle("pc.sound", "Ton während des Countdowns", "Gut hörbar, auch mit Kopfhörern."),
    p.sound && h("div.group", {}, ...toneSettings("pc", rerender),
      toggle("pc.raiseSystem", "Windows-Lautstärke bei Alarm anheben", "Hebt eine Stummschaltung auf und stellt mindestens den Wert unten ein. Danach wieder wie vorher.", () => rerender()),
      p.raiseSystem && percentSlider("Mindestens", p.systemMin, (n) => set("pc.systemMin", n), { min: 20 })),
    toggle("pc.stopMedia", "Medien vorher stoppen", "Musik und Videos anhalten."),
    field("Ausnahmen", text("pc.exceptions", { placeholder: "z. B. obs64.exe, Teams.exe" }), "Läuft eines davon, wird der PC nur gesperrt."),
    h("div.fields", {},
      field("Ruhezeit von", text("pc.quietFrom", { type: "time" }), "Keine Abfrage in diesem Zeitraum"),
      field("bis", text("pc.quietTo", { type: "time" }))),
    h("div.field", {}, h("span", {}, "Wake-on-LAN"),
      h("div.row", {}, h("code", {}, p.wolMac || "noch nicht ermittelt"),
        h("button.btn.small", { onclick: () => macAddress().then((m) => { set("pc.wolMac", m); connect(); rerender(); toast("MAC gespeichert – andere Geräte können diesen PC wecken"); }).catch((e) => toast(String(e))) }, "MAC ermitteln")),
      h("small", {}, "Im BIOS/Netzwerkadapter muss Wake-on-LAN aktiviert sein.")),
    toggle("pc.autostart", "Mit Windows starten", "Damit kein Alarm verpasst wird.", (v) => setAutostart(v).catch(() => toast("Autostart konnte nicht geändert werden"))),
  );
}

function androidSection(rerender) {
  if (android === null) androidStatus().then((s) => { android = s; rerender(); }).catch(() => (android = { supported: false }));
  const s = android || {};
  const a = settings().android;
  const recheck = () => setTimeout(() => { android = null; rerender(); }, 4000);
  const restartBlocked = a.restart !== false && s.overlayAllowed === false;
  return section("android", "Android", "Damit Alarme auch ankommen, wenn die App im Hintergrund ist.",
    switchRow("Hintergrund-Dienst", "Dauerhafte Mitteilung, Android beendet die App dann nicht.", a.service, (v) => setBackgroundService(v).then(() => { android = null; rerender(); })),
    switchRow("Automatisch neu starten", "Startet Heimalarm neu, wenn es beendet wurde, auch nach einem Neustart des Handys.",
      a.restart !== false, (v) => { set("android.restart", v); rerender(); }),
    restartBlocked && h("div.item", {}, h("div.item-head", {}, h("b", {}, "Über anderen Apps einblenden"), h("span.chip.bad", {}, "nicht erlaubt")),
      h("small", {}, "Ohne diese Erlaubnis darf sich Heimalarm nicht selbst starten."),
      h("button.btn.small", { onclick: () => openOverlaySettings().then(recheck) }, "Erlauben")),
    h("div.item", {}, h("div.item-head", {}, h("b", {}, "Akku-Optimierung"), s.batteryOptimized ? h("span.chip.bad", {}, "aktiv – bitte ausschalten") : h("span.chip.ok", {}, "ausgeschaltet")),
      s.batteryOptimized && h("button.btn.small", { onclick: () => openBatterySettings().then(recheck) }, "Ausnahme erlauben")),
    (sleeping(s) || s.samsung) && h("div.item", {},
      h("div.item-head", {}, h("b", {}, s.samsung ? "Standby (Samsung)" : "Standby"),
        sleeping(s) ? h("span.chip.bad", {}, "schläft") : a.samsungDone ? h("span.chip.ok", {}, "eingetragen") : h("span.chip.warn", {}, "bitte prüfen")),
      h("small", {}, sleeping(s)
        ? "Android legt Heimalarm schlafen. App-Infos → Akku → „Nicht eingeschränkt“ wählen."
        : "Samsung beendet Apps trotzdem. Einstellungen → Akku → Hintergrundnutzungslimits → „Nie in den Standby versetzte Apps“ → Heimalarm hinzufügen."),
      h("div.row", {},
        h("button.btn.small", { onclick: () => openAppDetails().then(recheck) }, "App-Infos öffnen"),
        s.samsung && !sleeping(s) && !a.samsungDone && h("button.btn.small", { onclick: () => { set("android.samsungDone", true); rerender(); } }, "Eingetragen"))),
    h("div.item", {}, h("div.item-head", {}, h("b", {}, "Benachrichtigungen mitlesen"), s.notificationAccess ? h("span.chip.ok", {}, "erlaubt") : h("span.chip", {}, "nicht erlaubt")),
      !s.notificationAccess && h("button.btn.small", { onclick: () => openNotificationAccess() }, "Zugriff erlauben")),
    s.fullScreenAllowed === false && h("div.item", {}, h("div.item-head", {}, h("b", {}, "Vollbild-Meldungen"), h("span.chip.bad", {}, "nicht erlaubt")),
      h("small", {}, "Ohne diese Erlaubnis erscheint der Alarm nur als Mitteilung, nicht über dem Sperrbildschirm."),
      h("button.btn.small", { onclick: () => openFullScreenSettings().then(() => setTimeout(() => { android = null; rerender(); }, 4000)) }, "Erlauben")),
    h("p.meta", {}, a.restart !== false ? "Nach einem Neustart des Handys startet Heimalarm von selbst." : "Nach einem Neustart des Handys läuft nur der Hintergrund-Dienst. Alarme werden gemerkt und beim Öffnen weitergegeben."),
  );
}

/** Was dieses Handy bei Alarm tut (eigene Seite „Handy bei Alarm“). */
function handyAlarm(rerender) {
  if (android === null) androidStatus().then((s) => { android = s; rerender(); }).catch(() => (android = { supported: false }));
  return section("handyalarm", "Handy bei Alarm", null, ...phoneAlarmSettings(android || {}, rerender));
}

const PHONE_MODES = {
  heimalarm: "Heimalarm meldet sich selbst: Abfrage „Fährst du?“, Mitteilung, Ton und Vibration, so wie unten eingestellt.",
  app: "Heimalarm öffnet SYBOS, aPager oder Divera direkt beim Einsatz. Rückmeldung gibst du dort.",
  off: "Das Handy zeigt nichts, klingelt und vibriert nicht. Weiterleiten an den PC, Routinen und Protokoll laufen weiter.",
};

/** Auswahl einer Dauer für eine Zusatzaktion (Zahl im Einstellungs-Pfad). */
const duration = (path, label, options) =>
  field(label, select(options.map(([k, t]) => [String(k), t]), String(get(path)), (val) => set(path, Number(val))));

/** Was das Handy bei Alarm tut: Modus, Ton/Anzeige und Zusatzaktionen. */
function phoneAlarmSettings(s, rerender) {
  const ph = settings().phone;
  const pm = phoneMode();
  const recheck = () => setTimeout(() => { android = null; rerender(); }, 4000);
  const pickMode = (v) => { set("phone.mode", v); set("phone.silent", v === "off"); rerender(); };
  const needs = (title, why, label, open) => h("div.item", {},
    h("div.item-head", {}, h("b", {}, title), h("span.chip.bad", {}, "nicht erlaubt")),
    h("small", {}, why),
    h("button.btn.small", { onclick: () => open().then(recheck) }, label));
  return [
    h("div.field", {}, h("span", {}, "Bei Alarm"),
      segmented([["heimalarm", "Heimalarm"], ["app", "Alarm-App"], ["off", "Aus"]], pm, pickMode),
      h("small", {}, PHONE_MODES[pm])),

    pm === "app" && s.overlayAllowed === false && needs("Aus dem Hintergrund öffnen",
      "Ohne diese Erlaubnis öffnet sich die Alarm-App erst, wenn du die Heimalarm-Mitteilung antippst. Android-Name: „Über anderen Apps einblenden“.",
      "Erlauben", openOverlaySettings),

    pm === "heimalarm" && toggle("phone.ask", "Abfrage „Fährst du?“ öffnen", "Aus: kein Abfrage-Bildschirm, nur Mitteilung, Ton und Vibration. Rückmeldung dann in der Alarm-App.", () => rerender()),
    pm === "heimalarm" && toggle("phone.notify", "Mitteilung anzeigen", "Mitteilung in der Statusleiste mit Stichwort. Aus: keine Mitteilung von Heimalarm, die Alarm-App meldet sich ja selbst.", () => rerender()),
    pm === "heimalarm" && ph.ask !== false && ph.notify !== false && toggle("phone.fullscreen", "Groß anzeigen, auch auf dem Sperrbildschirm", "Bei eigenem Alarm erscheint Heimalarm über allem, mit Knopf „Stopp“.", () => rerender()),
    pm === "heimalarm" && ph.ask !== false && ph.notify === false && h("p.meta", {}, "Ohne Mitteilung erscheint die Abfrage nur, wenn Heimalarm gerade offen ist."),
    pm === "heimalarm" && ph.ask === false && ph.notify === false && !ph.sound && ph.vibrate === false && h("p.meta", {}, "So meldet sich das Handy bei Alarm gar nicht. Routinen, Weiterleiten an den PC und Logbuch laufen weiter."),
    pm === "heimalarm" && toggle("phone.vibrate", "Vibrieren"),
    pm === "heimalarm" && toggle("phone.sound", "Eigenen Alarmton spielen", "Meist klingelt schon die Alarm-App. Gut, wenn der Melder in der Ladeschale die einzige Quelle ist.", () => rerender()),
    pm === "heimalarm" && ph.sound && h("div.group", {}, ...toneSettings("phone", rerender),
      field("Klingelt höchstens", select([["30", "30 Sekunden"], ["60", "1 Minute"], ["120", "2 Minuten"], ["300", "5 Minuten"]], String(ph.durationSec), (v) => set("phone.durationSec", Number(v))),
        "Spielt als Wecker – auch im Lautlos-Modus hörbar, solange die Wecker-Lautstärke nicht auf 0 steht.")),

    pm !== "off" && h("h3.group-title", {}, "Zusätzlich bei Alarm"),
    pm !== "off" && toggle("phone.dnd", "„Nicht stören“ durchbrechen", "Schaltet „Nicht stören“ aus, damit die Alarm-App hörbar klingelt. Danach wieder wie vorher.", () => rerender()),
    pm !== "off" && ph.dnd && duration("phone.dndMin", "Aus für", [[5, "5 Minuten"], [15, "15 Minuten"], [30, "30 Minuten"], [60, "1 Stunde"]]),
    pm !== "off" && ph.dnd && s.dndAccess === false && needs("Zugriff auf „Nicht stören“",
      "Ohne diese Erlaubnis darf Heimalarm „Nicht stören“ nicht ausschalten.", "Erlauben", openDndSettings),
    pm !== "off" && s.torch !== false && toggle("phone.torch", "Taschenlampe blinken", "Gut zu sehen, wenn das Handy im Dunkeln liegt.", () => rerender()),
    pm !== "off" && s.torch !== false && ph.torch && duration("phone.torchSec", "Blinkt", [[10, "10 Sekunden"], [30, "30 Sekunden"], [60, "1 Minute"], [120, "2 Minuten"]]),
    pm !== "off" && s.torch !== false && ph.torch && h("button.btn.small", { onclick: () => testTorch().catch((e) => toast(String(e))) }, "Blinken testen"),
    pm !== "off" && toggle("phone.wake", "Bildschirm einschalten", "Das Display geht bei Alarm an, auch ohne Vollbild-Meldung.", () => rerender()),
    pm !== "off" && ph.wake && duration("phone.wakeSec", "Bleibt an", [[15, "15 Sekunden"], [30, "30 Sekunden"], [60, "1 Minute"], [180, "3 Minuten"]]),

    pm === "heimalarm" && h("h3.group-title", {}, "Navigation"),
    pm === "heimalarm" && switchRow("Bei „Ich fahre“ zum Gerätehaus navigieren", "Startet Google Maps oder deine Karten-App mit dem Gerätehaus als Ziel.",
      ph.navigate === "go", (v) => { set("phone.navigate", v ? "go" : "off"); rerender(); }),
    pm === "heimalarm" && ph.navigate === "go" && field("Gerätehaus", text("phone.station", { placeholder: "Hauptstraße 1, 12345 Musterstadt" }), "Adresse oder Koordinaten wie 52.12, 10.34."),
    pm === "heimalarm" && ph.navigate === "go" && h("button.btn.small", { onclick: () => navigateToStation().then((ok) => { if (!ok) toast("Erst das Gerätehaus eintragen"); }) }, "Navigation testen"),
  ];
}

// ── Zusatzfunktionen: alles aus, bis man es einschaltet ─
function funktionen(rerender) {
  const f = settings().features || {};
  return section("funktionen", "Funktionen", "Zusätzliche Funktionen. Alle sind aus, bis du sie einschaltest – gilt für alle abgeglichenen Geräte.",
    toggle("features.logbuch", "Einsatz-Logbuch", "Speichert jede echte Alarmierung mit allen Infos (Stichwort, Einheiten, Adresse, Text, Antwort). Mit Notizen, Fahrzeug und Funktion. Eigene Seite „Einsätze“ im Menü.", () => rerender()),
    f.logbuch
      ? toggle("features.stats", "Statistik und Jahresrückblick", "Zahlen, Verlauf, Verteilung nach Art und Rückblick je Jahr – aus dem Logbuch.", () => rerender())
      : h("p.meta", {}, "Statistik und Jahresrückblick gibt es, sobald das Logbuch an ist."),
    h("p.meta", {}, "Rückmeldung an Divera und aPager schaltest du unter Alarmquellen bei der jeweiligen App ein."));
}

function geraet() {
  return section("geraet", "Dieses Gerät", "So erscheint die App bei den anderen unter „Verbundene Apps“.",
    field("Gerätename", text("device.name", { placeholder: hasPcFeatures ? "z. B. PC Arbeitszimmer" : "z. B. Handy Alex", autocomplete: "off" }, { onSave: () => connect() })),
    toggle("notify.enabled", "Mitteilung bei Alarm", hasPcFeatures ? "Für Alarme anderer Personen. Eigene Alarme zeigen die Abfrage." : "Systemmeldung, auch im Hintergrund."),
    toggle("sync.enabled", "Einstellungen abgleichen", "Einstellungen mit der Zentrale und gekoppelten Geräten abgleichen. Schlüssel für Divera und aPager bleiben immer hier."),
    !hasPcFeatures && settings().sync?.enabled !== false && field("Abgleich ohne Zentrale alle",
      select([["30", "30 Sekunden"], ["60", "1 Minute"], ["120", "2 Minuten"], ["300", "5 Minuten"], ["900", "15 Minuten"]], String(settings().sync?.intervalSec || 120), (v) => set("sync.intervalSec", Number(v))),
      "Wie oft das Handy bei gekoppelten PCs nachschaut. Nach jeder Änderung und beim Öffnen der App gleicht es ohnehin sofort ab. Mit Zentrale läuft der Abgleich sofort."),
  );
}

function personen(rerender) {
  const persons = shared().persons || [];
  const edit = async () => {
    if (!(await requireAdmin())) return;
    const id = h("input.input", { placeholder: "z. B. max", autocapitalize: "off", spellcheck: "false" });
    const name = h("input.input", { placeholder: "z. B. Max" });
    const close = dialog("Person hinzufügen", field("Kennung", id, "Kurzer Name ohne Leerzeichen, wie im Melder dieser Person."), field("Name", name),
      h("div.row", {}, h("button.btn.primary", { onclick: () => { const k = normalizeKennung(id.value); if (!k) { toast("Bitte eine Kennung eintragen"); return; } if (persons.some((p) => p.id === k)) { toast(`„${k}“ gibt es schon`); return; } if (k !== id.value.trim()) toast(`Kennung angepasst zu „${k}“`); updateShared({ persons: [...persons, { id: k, name: name.value.trim() || k }] }); close(); rerender(); } }, "Hinzufügen")));
  };
  return section("personen", "Personen", "Wer an dieser Zentrale alarmiert wird. Routinen können für einzelne Personen gelten.",
    h("ul.rows", {}, persons.map((p) => h("li", {}, h("div.row-main", {},
      h("b", {}, p.name, h("span.badge", {}, p.id)),
      h("button.btn.small.ghost.danger", { onclick: async () => { if (await requireAdmin() && await ask(`${p.name} entfernen?`)) { updateShared({ persons: persons.filter((x) => x.id !== p.id) }); rerender(); } } }, "Entfernen"))))),
    h("div.row", {}, h("button.btn.small", { onclick: edit }, "Person hinzufügen")),
  );
}

function zentrale(rerender) {
  const s = shared();
  const host = settings().broker.host || "<zentrale>";
  const hook = s.webhookSecret ? `http://${host}:8080/alarm/${s.webhookSecret}?who=${settings().alarm.me}` : "";
  return section("zentrale", "Zentrale", "Gilt für alle Geräte. Änderungen nur mit Admin-Rechten.",
    h("p.meta", {}, `Zentrale-Programm: ${state.dienst?.online ? "läuft, Version " + state.dienst.version : "nicht erreichbar"}`),
    h("div.fields", {},
      field("Breitengrad", h("input.input", { type: "number", step: "0.01", value: s.location?.lat, onchange: async (e) => { if (await requireAdmin()) updateShared({ location: { ...s.location, lat: Number(e.target.value) } }); } }), "Für hell/dunkel in Routinen"),
      field("Längengrad", h("input.input", { type: "number", step: "0.01", value: s.location?.lon, onchange: async (e) => { if (await requireAdmin()) updateShared({ location: { ...s.location, lon: Number(e.target.value) } }); } }))),
    navigator.geolocation && h("div.row", {}, h("button.btn.small", { onclick: async () => {
      if (!(await requireAdmin())) return;
      navigator.geolocation.getCurrentPosition((pos) => { updateShared({ location: { lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2) } }); rerender(); toast("Standort übernommen"); }, () => toast("Standort nicht verfügbar"));
    } }, "Standort ermitteln")),
    h("div.field", {}, h("span", {}, "Webhook für aPager PRO"),
      hook ? h("code", { style: "overflow-wrap:anywhere" }, hook) : h("small", {}, "Noch kein Schlüssel – ohne Schlüssel nimmt die Zentrale keine Webhooks an."),
      h("div.row", {},
        h("button.btn.small", { onclick: async () => { if (await requireAdmin()) { updateShared({ webhookSecret: secretKey() }); rerender(); } } }, hook ? "Neuer Schlüssel" : "Schlüssel erzeugen"),
        hook && h("button.btn.small.ghost", { onclick: () => copyText(hook).then(() => toast("Kopiert")) }, "Kopieren")),
      h("small", {}, "Einrichten wie unter Alarmquellen → aPager PRO beschrieben. Alarme mehrerer Einheiten zählen als ein Einsatz.")),
  );
}

/* Automatischer Selbsttest der Zentrale (zentrale/dienst/src/selftest.js): an/aus, Tage, Uhrzeit, was geprüft wird. */
const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const selftestCfg = () => ({ enabled: true, days: [7], at: "10:00", esp: true, apps: true, zigbee: true, ...shared().selftest });
/** Kurz: „Sonntags um 10:00“, „Mo, Mi um 10:00“, „Täglich um 10:00“ oder „aus“. */
export function selftestWhen() {
  const c = selftestCfg();
  if (!c.enabled || !c.days?.length) return "aus";
  const days = c.days.length === 7 ? "Täglich" : c.days.length === 1 && c.days[0] === 7 ? "Sonntags" : c.days.map((d) => DAY_NAMES[d - 1]).join(", ");
  return `${days} um ${c.at}`;
}
function selbsttest(rerender) {
  const c = selftestCfg();
  const save = async (patch) => { if (await requireAdmin()) { updateShared({ selftest: { ...c, ...patch } }); rerender(); } };
  const dayBtns = h("div.segmented.days", { role: "group", "aria-label": "Wochentage" }, DAY_NAMES.map((d, i) => {
    const on = c.days.includes(i + 1);
    return h("button", { type: "button", "aria-pressed": String(on), disabled: !c.enabled,
      onclick: () => save({ days: on ? c.days.filter((x) => x !== i + 1) : [...c.days, i + 1].toSorted((a, b) => a - b) }) }, d);
  }));
  return section("selbsttest", "Automatischer Selbsttest", "Die Zentrale prüft regelmäßig, ob alles läuft, und legt unter Test & Diagnose einen Bericht ab. Probleme stehen auch im Protokoll.",
    switchRow("Selbsttest einschalten", c.enabled ? `Nächste Prüfung: ${selftestWhen()}.` : "Aus. Von Hand weiter unter Test & Diagnose.", c.enabled, (v) => save({ enabled: v })),
    c.enabled && h("div.field", {}, h("span", {}, "An diesen Tagen"), dayBtns,
      !c.days.length && h("small.warn", {}, "Kein Tag gewählt – der Selbsttest läuft dann nie.")),
    c.enabled && field("Uhrzeit", h("input.input", { type: "time", value: c.at, onchange: (e) => { if (e.target.value) save({ at: e.target.value }); } }), "Am besten, wenn alle Geräte an sind."),
    c.enabled && h("h3.group-title", {}, "Was geprüft wird"),
    c.enabled && switchRow("Melder (ESP32)", "Ist jeder ESP32 online?", c.esp, (v) => save({ esp: v })),
    c.enabled && switchRow("Apps", "Ist mindestens eine Heimalarm-App verbunden?", c.apps, (v) => save({ apps: v })),
    c.enabled && switchRow("Zigbee", "Läuft Zigbee2MQTT? Wird nur geprüft, wenn es eingerichtet ist.", c.zigbee, (v) => save({ zigbee: v })),
  );
}

function sicherheit(rerender) {
  const setPin = (title, after) => async () => {
    const a = h("input.input", { type: "password", inputmode: "numeric" });
    const close = dialog(title, field("Neue PIN", a, "Leer lassen zum Entfernen."),
      h("div.row", {}, h("button.btn.primary", { onclick: async () => { await after(a.value ? await sha256(a.value) : ""); close(); rerender(); toast(a.value ? "PIN gespeichert" : "PIN entfernt"); } }, "Speichern")));
  };
  return section("sicherheit", "Sicherheit", null,
    h("div.item", {}, h("div.item-head", {}, h("b", {}, "App-Sperre"), h("span.chip" + (settings().lock.pinHash ? ".ok" : ""), {}, settings().lock.pinHash ? "aktiv" : "aus")),
      h("p.meta", {}, "PIN beim Öffnen dieser App. Alarme kommen trotzdem an."),
      h("button.btn.small", { onclick: setPin("App-PIN", (v) => set("lock.pinHash", v)) }, "PIN festlegen"),
      bioToggle(rerender)),
    h("div.item", {}, h("div.item-head", {}, h("b", {}, "Admin-PIN"), h("span.chip" + (shared().adminPinHash ? ".ok" : ""), {}, shared().adminPinHash ? (isAdmin() ? "entsperrt" : "gesperrt") : "aus")),
      h("p.meta", {}, "Ohne Admin-PIN darf jeder Routinen, Geräte und Personen ändern. Mit PIN können andere nur steuern."),
      h("button.btn.small", { onclick: async () => { if (await requireAdmin()) setPin("Admin-PIN", (v) => updateShared({ adminPinHash: v }))(); } }, "PIN festlegen")),
  );
}

/** Fingerabdruck / Windows Hello zusätzlich zur App-PIN – nur zeigen, wenn das Gerät es kann. */
let bioLabel = null;
function bioToggle(rerender) {
  if (bioLabel === null) { bioLabel = ""; biometricLabel().then((l) => { bioLabel = l; if (l) rerender(); }); return null; }
  if (!bioLabel) return null;
  if (!settings().lock.pinHash) return h("p.meta", {}, `${bioLabel} geht, sobald eine App-PIN festgelegt ist (als Rückfall).`);
  return toggle("lock.biometric", `Mit ${bioLabel} entsperren`, "Die PIN bleibt als Rückfall, falls es nicht klappt.");
}

/** Backup. Ohne Häkchen bleiben Schlüssel, Passwörter und Codes draußen (Zwischenablage ist nicht geheim). */
const SECRET_SETTINGS = [["divera", "key"], ["apager", "key"], ["broker", "pass"], ["direct", "code"], ["direct", "hookKey"], ["lock", "pinHash"]];
function exportAll(withSecrets) {
  const s = structuredClone(settings());
  const sh = structuredClone(shared());
  if (!withSecrets) {
    for (const [a, b] of SECRET_SETTINGS) if (s[a]) s[a][b] = "";
    s.direct.peers = (s.direct.peers || []).map((p) => ({ ...p, code: "", paired: false }));
    s.direct.phones = [];
    sh.webhookSecret = ""; sh.adminPinHash = "";
    sh.voicemonkey = { ...sh.voicemonkey, token: "" };
    sh.wifi = (sh.wifi || []).map((d) => ({ ...d, user: "" }));
  }
  return JSON.stringify({ heimalarm: "backup", version: 1, app: APP_VERSION, ts: Date.now(), secrets: Boolean(withSecrets), settings: s, shared: sh }, null, 2);
}

/** Beim Wiederherstellen leere Geheimnisse nicht über vorhandene schreiben. */
function keepSecrets(k, v) {
  const cur = settings()[k];
  if (!cur || !v || typeof v !== "object") return v;
  const out = { ...v };
  for (const [a, b] of SECRET_SETTINGS) if (a === k && !out[b] && cur[b]) out[b] = cur[b];
  if (k === "direct") {
    if (!(out.phones || []).length) out.phones = cur.phones;
    out.peers = (out.peers || []).map((p) => { const old = (cur.peers || []).find((x) => x.host === p.host); return !p.code && old ? { ...p, code: old.code, paired: old.paired } : p; });
  }
  return out;
}

let backupSecrets = false;
function backup(rerender) {
  return section("backup", "Backup", "Einstellungen sichern oder auf ein anderes Gerät übertragen.",
    switchRow("Schlüssel und Passwörter mitsichern", "Divera-/aPager-Schlüssel, Zentrale-Passwort, PINs und Kopplungscodes. Nur einschalten, wenn du das Backup sicher aufbewahrst. Am Handy landet es in der Zwischenablage.",
      backupSecrets, (v) => { backupSecrets = v; rerender(); }),
    h("div.row", {},
      h("button.btn", { onclick: async () => { const t = exportAll(backupSecrets); if (await copyText(t)) toast(backupSecrets ? "Backup mit Schlüsseln kopiert" : "Backup (ohne Schlüssel) kopiert"); if (!isAndroid) download("heimalarm-backup.json", t); } }, "Backup erstellen"),
      h("button.btn", { onclick: () => {
        const ta = h("textarea.input", { placeholder: "Backup-Text einfügen" });
        const close = dialog("Backup wiederherstellen", ta, h("p.meta", {}, "Überschreibt die Einstellungen dieses Geräts. Gemeinsame Daten nur mit Admin-Rechten."),
          h("div.row", {}, h("button.btn.primary", { onclick: async () => {
            try {
              const b = JSON.parse(ta.value);
              for (const [k, v] of Object.entries(b.settings || {})) if (k !== "device") replace(k, keepSecrets(k, v));
              if (b.shared && (await requireAdmin())) {
                const sh = { ...b.shared };
                if (!sh.webhookSecret) sh.webhookSecret = shared().webhookSecret;
                if (!sh.adminPinHash) sh.adminPinHash = shared().adminPinHash;
                if (!sh.voicemonkey?.token) sh.voicemonkey = shared().voicemonkey;
                sh.wifi = (sh.wifi || []).map((d) => (d.user ? d : { ...d, user: (shared().wifi || []).find((x) => x.id === d.id)?.user || "" }));
                updateShared(sh);
              }
              close(); applyTheme(); connect(); rerender(); toast("Backup wiederhergestellt");
            } catch { toast("Kein gültiges Backup"); }
          } }, "Wiederherstellen")));
      } }, "Wiederherstellen")),
  );
}

const MB = (b) => (b / 1048576).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const STEPS = [["download", "Herunterladen"], ["verify", "Prüfsumme prüfen"], ["install", "Installieren"]];

/** Fortschritt: Balken (läuft auch ohne Größe), MB, Restzeit, drei Schritte. */
function updateProgress(d) {
  const pct = d.total ? Math.min(100, Math.round((d.loaded / d.total) * 100)) : null;
  const secs = (Date.now() - d.startedAt) / 1000;
  const rest = d.stage === "download" && d.total && d.loaded > 0 && secs > 2 ? Math.max(1, Math.round(((d.total - d.loaded) / d.loaded) * secs)) : null;
  const label = { download: "Wird heruntergeladen …", verify: "Prüfsumme wird geprüft …", install: isAndroid ? "Fertig – Android fragt gleich „Installieren?“, dort bestätigen." : "Setup läuft – Heimalarm startet gleich neu." }[d.stage];
  const at = STEPS.findIndex(([k]) => k === d.stage);
  return h("div.upd", {},
    h("div.upd-head", {}, h("span", {}, label), pct != null && d.stage === "download" && h("span.mono", {}, `${pct} %`)),
    d.stage !== "install" && h("div.upd-bar" + (pct == null || d.stage === "verify" ? ".indet" : ""), { role: "progressbar", "aria-label": "Update", "aria-valuemin": "0", "aria-valuemax": "100", ...(pct != null ? { "aria-valuenow": String(pct) } : {}) },
      h("i", { style: `width:${d.stage === "verify" || pct == null ? 100 : pct}%` })),
    d.stage === "download" && h("div.upd-meta.mono", {}, h("span", {}, d.total ? `${MB(d.loaded)} von ${MB(d.total)} MB` : `${MB(d.loaded)} MB geladen`), rest && h("span", {}, `noch ca. ${rest} s`)),
    h("ol.upd-steps", {}, STEPS.map(([, t], i) => h("li" + (i < at ? ".done" : i === at ? ".now" : ""), {}, t))));
}

/* Fortschritt beim Herunterladen: Die Einstellungen zeichnen sich bei Ereignissen nicht von selbst neu
   (main.js → live), darum zeichnet sich der Abschnitt „Updates“ bei jedem Update-Ereignis selbst neu. */
let updatesRe = null;
onEvent("update", () => { if (document.getElementById("updates")?.isConnected) updatesRe?.(); });

function updates(rerender) {
  updatesRe = rerender;
  const u = update;
  const when = u.checkedAt ? ` · geprüft ${new Date(u.checkedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : "";
  return section("updates", "Updates", "Neue Versionen kommen von GitHub. Die App lädt sie, prüft die Prüfsumme und installiert sie selbst.",
    h("p.meta", {}, `Installiert: ${APP_VERSION}${state.dienst?.version ? " · Zentrale " + state.dienst.version : ""}`),
    toggle("update.auto", "Automatisch nach Updates suchen", "Beim Start und alle 6 Stunden eine kurze Abfrage bei GitHub, nichts wird ohne dich installiert."),
    u.available
      ? h("div.banner.update", {}, h("div.update-body", {}, h("b", {}, `Version ${u.available.version} verfügbar`),
            u.dl ? updateProgress(u.dl) : (u.progress || noteLine(u.available.notes))),
          h("div.row", {},
            u.dl?.stage === "install" && isAndroid && !u.installing
              ? h("button.btn.primary.small", { onclick: () => installUpdate().then(rerender) }, "Installationsdialog öffnen")
              : !u.dl && h("button.btn.primary.small", { onclick: () => installUpdate().then(rerender), disabled: u.installing }, "Installieren"),
            h("a.btn.small", { href: u.available.page, target: "_blank", rel: "noopener" }, "Änderungen")))
      : h("p.meta", {}, (u.message || "Noch nicht geprüft.") + when),
    h("div.row", {},
      h("button.btn.small", { onclick: () => checkUpdate().then(rerender), disabled: u.checking }, u.checking ? "Suche …" : "Jetzt prüfen"),
      h("a.btn.small.ghost", { href: RELEASES_URL, target: "_blank", rel: "noopener" }, "Alle Versionen")),
    isAndroid && h("small.meta", {}, "Beim ersten Update fragt Android, ob Heimalarm Apps installieren darf – einmal erlauben."),
  );
}

function darstellung() {
  return section("darstellung", "Darstellung", null,
    h("div.field", {}, h("span", {}, "Farbschema"), segmented([["dark", "Dunkel"], ["light", "Hell"]], get("ui.theme"), (v) => { set("ui.theme", v); applyTheme(); })));
}

/* ── Bereiche: links die Liste (nach Fragen gruppiert), rechts genau eine Seite (Handy: Liste → Unterseite).
   Jeder Bereich sagt in der Liste, was drinsteht (desc), und rechts kurz, wie es gerade steht (status). ── */
const ok = (t) => ({ t, c: "ok" }), warn = (t) => ({ t, c: "warn" }), off = (t) => ({ t, c: "off" }), plain = (t) => ({ t, c: "plain" });
const ONLY_HERE = () => (hasPcFeatures ? ["pc", "Nur dieser PC"] : ["phone", isAndroid ? "Nur dieses Handy" : "Nur dieses Gerät"]);
const ALL_MINE = ["net", "Für alle deine Geräte"];
const ADMIN = ["lock", "Admin", "admin"];

const PAGES = () => [
  // Alarm – wie er ankommt
  { grp: "alarm", id: "quellen", label: "Alarmquellen", icon: "bell", color: "--c-alarm", sections: ["quellen"],
    desc: "Melder, SYBOS, aPager, Divera",
    lead: "Woher Heimalarm von einem Einsatz erfährt. Mehrere Quellen gleichzeitig sind normal. Kommt derselbe Alarm doppelt, zählt er als ein Einsatz.",
    scope: [ALL_MINE, ["lock", "Divera- und aPager-Schlüssel bleiben auf diesem Gerät"]],
    status: () => { const n = activeSources().length; return n ? ok(`${n} aktiv`) : warn("keine"); } },
  { grp: "alarm", id: "melder", label: "Melder (ESP32)", icon: "hub", color: "--c-alarm", sections: ["esp32", "led"],
    desc: "Kontakt, Lebenszeichen, LED, Firmware",
    lead: "Der ESP32 an der Ladeschale. Diese Werte gehen direkt an ihn – neu flashen ist nicht nötig.",
    scope: [["hub", "Wird an den ESP32 gesendet"]],
    status: () => { const d = state.devices[settings().alarm.me]; return !d ? off("nicht gemeldet") : d.online ? ok("online") : warn("offline"); },
    warn: () => state.devices[settings().alarm.me]?.online === false },
  { grp: "alarm", id: "kennung", label: "Kennung & Sperrzeit", icon: "people", color: "--c-alarm", sections: ["alarm"],
    desc: "Wer du bist, doppelte Alarme, Testmodus",
    lead: "Wer du bist und wie Heimalarm doppelte Alarme zu einem Einsatz zusammenfasst – egal aus welcher Quelle.",
    scope: [ALL_MINE],
    status: () => { const me = settings().alarm.me; return settings().alarm.testMode ? warn("Testmodus") : me === "ich" ? warn("„ich“") : plain(me); } },
  // Bei Alarm – auf diesem Gerät
  { grp: "bei", id: "faehrst", label: "„Fährst du?“", icon: "pc", color: "--c-pc", sections: ["pc"],
    desc: "Abfrage, Aktion, Countdown, Ton",
    lead: "Was dieser PC bei deinem Alarm tut. Jeder PC mit Heimalarm fragt selbst, mehrere PCs gehen also gleichzeitig.",
    scope: [["pc", "Nur dieser PC"]],
    status: () => (settings().pc.silent ? off("aus") : plain(`${ACTIONS[settings().pc.action]?.label} · ${settings().pc.countdownSec} s`)),
    warn: () => settings().pc.action === "hibernate" && hibernateOn === false },
  { grp: "bei", id: "tasten", label: "Vor dem Ruhezustand", icon: "tool", color: "--c-pc", sections: ["hotkeys"],
    desc: "Offene Arbeit speichern, Tasten senden",
    lead: "Speichert offene Arbeit, bevor der PC schläft – zum Beispiel Strg+S in Blender.",
    scope: [["pc", "Nur dieser PC"]],
    status: () => (settings().pc.hotkeys?.enabled ? ok("an") : off("aus")) },
  { grp: "bei", id: "discord", label: "Discord", icon: "chat", color: "--c-discord", sections: ["discord"],
    desc: "Status „Im Einsatz“ im Profil",
    lead: "Zeigt Freunden „Im Einsatz“ im Discord-Profil, solange du unterwegs bist.",
    scope: [["pc", "Nur dieser PC"]],
    status: () => (discord.active && discord.active.end > Date.now() ? ok("im Einsatz") : settings().discord.enabled ? ok("an") : off("aus")) },
  { grp: "bei", id: "handy", label: "Handy bei Alarm", icon: "phone", color: "--c-phone", sections: ["handyalarm"],
    desc: "Anzeige, Ton, Taschenlampe, Navigation",
    lead: "Was dieses Handy tut, wenn du alarmiert wirst.",
    scope: [["phone", "Nur dieses Handy"]],
    status: () => ({ heimalarm: plain("Heimalarm"), app: plain("Alarm-App"), off: off("aus") })[phoneMode()] },
  { grp: "bei", id: "hintergrund", label: "Hintergrund & Rechte", icon: "check", color: "--c-phone", sections: ["android"],
    desc: "Akku, Mitlesen, Vollbild",
    lead: "Damit Alarme auch ankommen, wenn die App im Hintergrund ist oder das Handy neu startet.",
    scope: [["phone", "Nur dieses Handy"]],
    status: () => { if (!android) return plain(""); const n = backgroundIssues(android).length + [!android.notificationAccess, android.fullScreenAllowed === false].filter(Boolean).length; return n ? warn(`${n} fehlt`) : ok("alles erlaubt"); },
    warn: () => backgroundIssues(android).length > 0 },
  // Zuhause
  { grp: "zuhause", id: "personen", label: "Personen", icon: "people", color: "--c-people", sections: ["personen"],
    desc: "Wer an der Zentrale alarmiert wird",
    lead: "Wer an dieser Zentrale alarmiert wird. Routinen können für einzelne Personen gelten.",
    scope: [["hub", "Für alle an der Zentrale"], ADMIN],
    status: () => { const n = (shared().persons || []).length; return plain(n ? String(n) : "nur du"); } },
  { grp: "zuhause", id: "sprache", label: "Alexa, Google & HA", icon: "voice", color: "--c-voice", sections: ["sprache", "hass"],
    desc: "Ansagen, Alarm-Sensor, Home Assistant",
    lead: "Lass Alexa den Einsatz ansagen oder starte Routinen in Alexa, Google Home oder Home Assistant.",
    scope: [["hub", "Für alle Geräte"], ADMIN],
    status: () => { const on = [state.voice?.commissioned && "Matter", shared().voicemonkey?.token && "Voice Monkey", shared().hass?.enabled && "HA"].filter(Boolean); return on.length ? ok(on.join(" · ")) : off("aus"); } },
  // Verbindung
  { grp: "verbindung", id: "betrieb", label: "Betrieb & Koppeln", icon: "net", color: "--c-net", sections: ["betrieb"],
    desc: "Mit oder ohne Zentrale, Geräte koppeln",
    lead: "Wie der Alarm zu deinen Geräten kommt. Gekoppelte Geräte übernehmen die Einstellung beim nächsten Abgleich.",
    scope: [["net", "Für alle gekoppelten Geräte"]],
    status: () => (mode() === "direkt" ? plain("Ohne Zentrale") : mode() === "zentrale" ? plain("Mit Zentrale") : warn("nicht gewählt")) },
  { grp: "verbindung", id: "zentrale", label: "Zentrale", icon: "hub", color: "--c-net", sections: ["verbindung", "zentrale", "selbsttest"],
    desc: "Adresse, Passwort, Standort, Webhook, Selbsttest",
    lead: "Das Gerät, das rund um die Uhr läuft: NAS, Mini-PC oder Raspberry Pi. Ohne sie kommt kein Melder-Alarm an.",
    scope: [[hasPcFeatures ? "pc" : "phone", "Verbindung: nur dieses Gerät"], ["lock", "Standort, Webhook, Selbsttest: Admin", "admin"]],
    status: () => (state.connected ? ok("verbunden") : isConfigured() ? warn("getrennt") : warn("nicht eingerichtet")),
    warn: () => isConfigured() && !state.connected },
  // App
  { grp: "app", id: "geraet", label: hasPcFeatures ? "Dieser PC" : isAndroid ? "Dieses Handy" : "Dieses Gerät", icon: hasPcFeatures ? "pc" : "phone", color: hasPcFeatures ? "--c-pc" : "--c-phone", sections: ["geraet"],
    desc: "Name, Mitteilung, Abgleich",
    lead: "So erscheint dieses Gerät bei den anderen – und was es mit ihnen abgleicht.",
    scope: [ONLY_HERE()],
    status: () => plain(settings().device.name || "") },
  { grp: "app", id: "funktionen", label: "Zusatzfunktionen", icon: "chart", color: "--c-app", sections: ["funktionen"],
    desc: "Einsatz-Logbuch, Statistik",
    lead: "Alles ist aus, bis du es einschaltest. Gilt für alle abgeglichenen Geräte.",
    scope: [ALL_MINE],
    status: () => (settings().features?.logbuch ? ok(settings().features?.stats ? "Logbuch · Statistik" : "Logbuch") : off("aus")) },
  { grp: "app", id: "sicherheit", label: "Sicherheit & Backup", icon: "lock", color: "--c-safe", sections: ["sicherheit", "backup"],
    desc: "App-PIN, Admin-PIN, Backup",
    lead: "Wer die App öffnen und gemeinsame Einstellungen ändern darf – und wie du alles sicherst.",
    scope: [[ONLY_HERE()[0], "App-PIN: nur hier"], ["lock", "Admin-PIN: für alle", "admin"]],
    status: () => (settings().lock?.pinHash ? ok("Sperre an") : off("Sperre aus")) },
  { grp: "app", id: "darstellung", label: "Darstellung & Updates", icon: "paint", color: "--c-app", sections: ["darstellung", "updates"],
    desc: "Hell oder dunkel, neue Versionen",
    lead: "Wie die App aussieht und wie sie sich aktuell hält.",
    scope: [["net", "Farbschema: für alle deine Geräte"]],
    status: () => (update.available ? warn(`${update.available.version} da`) : plain(APP_VERSION)),
    warn: () => Boolean(update.available) },
];
const GRP = () => ({
  alarm: ["Alarm", "Wie er ankommt"],
  bei: ["Bei Alarm", hasPcFeatures ? "Auf diesem PC" : "Auf diesem Handy"],
  zuhause: ["Zuhause", "Für alle im Haushalt"],
  verbindung: ["Verbindung", "Zentrale und Koppeln"],
  app: ["App", hasPcFeatures ? "Dieser PC" : "Dieses Gerät"],
});

const isPhone = () => window.matchMedia("(max-width: 760px)").matches;

/** Eintrag in der Liste, der woanders hinführt (Einrichtung, Test & Diagnose). */
const link = (href, ico, color, title, sub, onclick) => h("a.split-item", { href, onclick }, h("span.ico", { style: `--a:var(${color})` }, icon(ico)),
  h("span.split-item-text", {}, h("b", {}, title), h("span"), h("small", {}, sub)), h("span.chev", {}, icon("chev")));

// Scroll-Positionen bleiben beim Neuzeichnen und beim Wechsel des Bereichs stehen (nur neue Seiten beginnen oben)
let lastPage = null;
let listY = 0;

export function settingsView(rerender) {
  const z = mode() === "zentrale";
  // Positionen vom alten Stand merken, bevor er ersetzt wird
  const oldList = document.querySelector(".split-list"), oldDetail = document.querySelector(".split-detail");
  if (isPhone() ? oldList && !oldDetail : oldList) listY = isPhone() ? window.scrollY : oldList.scrollTop;
  const detailY = isPhone() ? window.scrollY : oldDetail?.scrollTop ?? 0;
  /** Abschnitt, der sich bei Änderungen allein neu zeichnet: Fokus, Scroll-Position und offene Regler
   *  im Rest der Seite bleiben erhalten. Betrieb, Verbindung, Quellen und Funktionen ändern, was die
   *  ganze Seite zeigt, und zeichnen darum weiter alles neu. */
  const part = (fn) => {
    let el = null;
    const re = () => {
      if (!el?.isConnected) return rerender();
      const next = fn(re);
      el.replaceWith(next); el = next;
      applySearch();
    };
    el = fn(re);
    return el;
  };
  // Nur die Abschnitte des sichtbaren Bereichs bauen (spart Abfragen beim Öffnen)
  const BUILD = {
    betrieb: () => betrieb(rerender),
    verbindung: () => z && verbindung(rerender),
    quellen: () => quellen(rerender),
    funktionen: () => funktionen(rerender),
    alarm: () => alarm(rerender),
    esp32: () => isConfigured() && esp32(),
    led: () => isConfigured() && ledSection(),
    pc: () => hasPcFeatures && part(pc),
    hotkeys: () => hasPcFeatures && part(hotkeySection),
    android: () => isTauri && isAndroid && part(androidSection),
    handyalarm: () => isTauri && isAndroid && part(handyAlarm),
    geraet: () => geraet(),
    personen: () => part(personen),
    sprache: () => part(sprache),
    hass: () => part(hassSection),
    discord: () => hasPcFeatures && part(discordSection),
    zentrale: () => z && part(zentrale),
    selbsttest: () => z && part(selbsttest),
    sicherheit: () => part(sicherheit),
    backup: () => part(backup),
    updates: () => isTauri && part(updates),
    darstellung: () => darstellung(),
  };
  // Welche Bereiche es auf diesem Gerät gibt (gleiche Bedingungen wie BUILD, ohne zu bauen)
  const AVAILABLE = {
    melder: isConfigured(), faehrst: hasPcFeatures, tasten: hasPcFeatures, discord: hasPcFeatures,
    handy: isTauri && isAndroid, hintergrund: isTauri && isAndroid, zentrale: z,
  };
  const pages = PAGES().filter((p) => AVAILABLE[p.id] !== false);
  const anchor = location.hash.replace("#/", "").split("/")[1] || "";
  const current = pages.find((p) => p.id === anchor) || pages.find((p) => p.sections.includes(anchor)) || (isPhone() ? null : pages[0]);
  const searching = query.trim().length > 0;

  const searchField = h("input.input", {
    type: "search", value: query, placeholder: "Einstellung suchen …", "aria-label": "Einstellungen durchsuchen",
    autocomplete: "off", spellcheck: "false", enterkeyhint: "search",
    // Beim ersten Buchstaben in die Ergebnisansicht wechseln, danach nur filtern (Fokus bleibt im Feld)
    oninput: (e) => { const was = query.trim().length > 0; query = e.target.value; if (was !== query.trim().length > 0) { rerender(); queueMicrotask(() => { const f = document.querySelector(".split-list input[type=search]"); f?.focus(); f?.setSelectionRange(f.value.length, f.value.length); }); } else applySearch(); },
    onkeydown: (e) => { if (e.key === "Escape") { query = ""; rerender(); } },
  });
  const item = (p) => {
    const s = p.status();
    return h("a.split-item", {
      href: `#/einstellungen/${p.id}`, "aria-current": !searching && current?.id === p.id ? "page" : null,
      onclick: () => { query = ""; },
    },
    h("span.ico", { style: `--a:var(${p.color})` }, icon(p.icon)),
    h("span.split-item-text", {},
      h("b", {}, p.label),
      s?.t ? h("span.st." + (p.warn?.() ? "warn" : s.c), { title: s.t }, s.t) : h("span"),
      h("small", {}, p.desc)),
    h("span.chev", {}, icon("chev")));
  };
  const grp = GRP();
  const list = h("aside.split-list", { "aria-label": "Bereiche", onscroll: (e) => { if (!isPhone()) listY = e.target.scrollTop; } },
    h("h1", {}, "Einstellungen"),
    h("label.search", {}, SEARCH_ICON(), searchField),
    h("nav.split-nav", {},
      Object.entries(grp).flatMap(([g, [label, em]]) => {
        const items = pages.filter((p) => p.grp === g);
        return items.length ? [h("div.split-grp", {}, label, h("em", {}, em)), h("div.split-sect", {}, items.map(item))] : [];
      }),
      h("div.split-grp", {}, "Hilfe"),
      h("div.split-sect", {},
        link("#/einrichtung", "home", "--c-alarm", "Einrichtung", "Schritt für Schritt neu durchgehen", () => startWizard()),
        link("#/diagnose", "tool", "--c-app", "Test & Diagnose", "Testalarm, Generalprobe, Verbindung"))));

  let detail = null;
  if (searching) {
    // Jeder Abschnitt zeigt oben, in welchem Bereich er steht
    const all = pages.flatMap((p) => p.sections.map((id) => {
      const el = BUILD[id]();
      if (el) el.querySelector("header")?.prepend(h("a.sec-crumb", { href: `#/einstellungen/${p.id}`, onclick: () => { query = ""; } }, p.label));
      return el;
    })).filter(Boolean);
    detail = h("section.split-detail", {},
      h("div.split-head", {}, h("h2", {}, "Suchergebnisse")),
      h("div.settings-body", {}, ...all,
        h("p.empty.search-empty", { hidden: true }, "Nichts gefunden. Anderen Begriff versuchen, z. B. „PIN“, „Alexa“ oder „Kennung“.")));
    queueMicrotask(applySearch);
  } else if (current) {
    const secs = current.sections.map((id) => BUILD[id]()).filter(Boolean);
    detail = h("section.split-detail", { style: `--a:var(${current.color})` },
      h("a.split-back", { href: "#/einstellungen" }, icon("back"), "Einstellungen"),
      h("header.pg-head", {},
        h("div.pg-title", {}, h("span.ico.big", { style: `--a:var(${current.color})` }, icon(current.icon)), h("h2", {}, current.label)),
        h("p.pg-desc", {}, current.lead),
        h("div.pg-meta", {}, current.scope.map(([ic, t, c]) => h("span.scope" + (c ? "." + c : ""), {}, icon(ic), t)), h("span.saved", {}, "Wird sofort gespeichert"))),
      h("div.settings-body", {}, ...secs));
    queueMicrotask(() => highlight([], []));
  }

  // Nach dem Einsetzen: Liste bleibt, wo sie war; dieselbe Seite bleibt, wo sie war; eine neue beginnt oben
  // (oder beim verlinkten Abschnitt, z. B. #/einstellungen/updates).
  const page = searching ? "?" : current?.id ?? null;
  const same = page === lastPage;
  lastPage = page;
  queueMicrotask(() => {
    const l = document.querySelector(".split-list"), d = document.querySelector(".split-detail");
    if (!isPhone() && l) l.scrollTop = listY;
    const target = !same && anchor && anchor !== current?.id ? document.getElementById(anchor) : null;
    if (isPhone()) {
      if (target) target.scrollIntoView({ block: "start" });
      else window.scrollTo(0, !d ? listY : same ? detailY : 0);
    } else if (d) {
      if (target) target.scrollIntoView({ block: "start" });
      else d.scrollTop = same ? detailY : 0;
    }
  });
  return h("div.split" + (searching ? ".searching" : detail ? ".has-detail" : ""), {}, list, detail);
}

/* ── Suche: blendet Abschnitte aus, die nicht passen, und markiert Treffer ── */
let query = "";
// Begriffe, die nicht wörtlich im Abschnitt stehen, aber danach gesucht wird
const KEYWORDS = {
  betrieb: "zentrale nas ugreen raspberry pi koppeln handy pc direkt",
  verbindung: "zentrale nas ip adresse port broker mqtt mosquitto",
  quellen: "melder esp32 sybos apager divera alarm app quelle",
  alarm: "kennung sperrzeit testalarm testmodus",
  esp32: "melder firmware update mindestdauer",
  led: "led lampe licht farbe blinken helligkeit board",
  pc: "ruhezustand herunterfahren sperren autostart windows wake on lan countdown",
  hotkeys: "speichern strg s tastenkombination blender roblox studio programm tasten taste shortcut",
  android: "akku hintergrund benachrichtigung dienst rechte erlaubnis vollbild sperrbildschirm",
  handyalarm: "vollbild vibrieren ton wecker nicht stören taschenlampe bildschirm navigation gerätehaus karte alarm-app",
  geraet: "name gerätename benachrichtigung abgleich sync intervall",
  funktionen: "logbuch statistik jahresrückblick einsätze zusatz",
  personen: "kollege kennung person",
  sprache: "alexa google matter voice monkey ansage sprachassistent echo vorlesen",
  hass: "home assistant ha mqtt discovery automation smart home",
  discord: "discord rich presence status profil spielt im einsatz freunde",
  zentrale: "webhook dienst standort",
  selbsttest: "selbsttest wöchentlich prüfung bericht sonntag automatisch",
  sicherheit: "pin sperre admin passwort",
  backup: "sichern wiederherstellen export import",
  updates: "update version aktualisieren neue github installieren",
  darstellung: "dunkel hell theme farbe design",
};
const SEARCH_ICON = () => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>';
  return svg;
};
const norm = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function applySearch() {
  const q = norm(query.trim());
  const words = q.split(/\s+/).filter(Boolean);
  const sections = [...document.querySelectorAll(".split-detail .settings-body > .section")];
  let shown = 0;
  for (const sec of sections) {
    const hay = norm(sec.textContent + " " + (KEYWORDS[sec.id] || ""));
    const hit = words.every((w) => hay.includes(w));
    sec.hidden = !hit;
    if (hit) shown++;
  }
  const empty = document.querySelector(".search-empty");
  if (empty) empty.hidden = shown > 0;
  highlight(sections.filter((s) => !s.hidden), query.trim().toLowerCase().split(/\s+/).filter(Boolean));
}
// Treffer markieren, ohne das DOM zu verändern (CSS Custom Highlight API)
function highlight(sections, words) {
  if (!globalThis.CSS?.highlights) return;
  CSS.highlights.delete("suche");
  if (!words.length) return;
  const ranges = [];
  for (const sec of sections) {
    const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const str = n.textContent.toLowerCase(); // ohne NFD, damit die Positionen stimmen
      for (const w of words) {
        for (let i = str.indexOf(w); i !== -1; i = str.indexOf(w, i + w.length)) {
          const r = new Range(); r.setStart(n, i); r.setEnd(n, i + w.length); ranges.push(r);
        }
      }
    }
  }
  CSS.highlights.set("suche", new Highlight(...ranges));
}
