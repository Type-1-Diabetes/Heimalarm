// Einrichtungs-Assistent. PC: Liste der Schritte links, ein Schritt rechts (wie Einstellungen).
// Handy: Vollbild ohne Leiste unten, ein Schritt nach dem anderen.
import { h, toast } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { field } from "../ui/form.js";
import { shotButton } from "../ui/guide-shots.js";
import { settings, set } from "../core/settings.js";
import { shared, updateShared } from "../core/shared.js";
import { connect, state } from "../core/mqtt.js";
import { direct, openPairing, addPeer } from "../core/direct.js";
import { divera, loadDivera } from "../core/divera.js";
import { testAlarm } from "../core/engine.js";
import { openNotificationAccess, openBatterySettings } from "../core/android.js";
import { isAndroid, hasPcFeatures } from "../core/platform.js";
import * as wz from "../core/wizard.js";

const tile = (name, color, big) => h("span.ico" + (big ? ".big" : ""), { style: `--a:var(${color})` }, icon(name));
const head = (ic, color, crumb, title) => h("div.split-head", {}, tile(ic, color, true),
  h("div", {}, h("div.crumb", {}, crumb), h("h2", {}, title)));
const lead = (t) => h("p.wz-lead", {}, t);
const note = (text, warn) => h("div.wz-note" + (warn ? ".warn" : ""), {}, icon(warn ? "bell" : "chat"), h("span", {}, text));
const go = (hash) => { location.hash = hash; };
const later = () => go("#/uebersicht");

/** Eingabe, die beim Verlassen speichert. */
const input = (value, onSave, attrs = {}) => h("input.input", { value: value || "", spellcheck: false, autocomplete: "off", ...attrs,
  onchange: (e) => onSave(e.target.value.trim()) });

/* ── Fragen ── */
function choices(list, key, multi, rerender) {
  const a = wz.answers();
  return h("div.wz-choices", { role: multi ? "group" : "radiogroup" }, list.map((o) => {
    const [id, title, text, need, ic, color] = multi ? o : [o[0], o[1], o[2], "", o[3], o[4]];
    const on = multi ? a[key].includes(id) : a.always === id;
    const rec = !multi && id === "ja" && wz.needsPi();
    return h("button.wz-choice" + (multi ? "" : ".radio"), {
      type: "button", role: multi ? "checkbox" : "radio", "aria-checked": String(on),
      onclick: () => {
        if (multi) wz.setAnswers({ [key]: on ? a[key].filter((x) => x !== id) : [...a[key], id] });
        else wz.setAnswers({ always: id });
        rerender();
      },
    }, tile(ic, color), h("b", {}, title, rec && h("span.badge.wz-rec", {}, "empfohlen")), h("small", {}, text), need && h("span.wz-need", {}, need));
  }));
}

/* ── Anleitung je Schritt ── */
const steps = (...items) => h("ol.steps.wz-steps", {}, items.filter(Boolean).map((x) => Array.isArray(x)
  ? h("li", {}, h("div", {}, h("span", { html: x[0] }), shotButton(x[1])))
  : h("li", {}, h("span", { html: x }))));
const row = (...c) => h("div.row.wz-row", {}, ...c);
const btn = (label, onclick, primary) => h("button.btn.small" + (primary ? ".primary" : ""), { type: "button", onclick }, label);
const manual = (key, rerender, label = "Erledigt") => btn(label, () => { wz.markOk(key); rerender(); });

function guide(key, rerender) {
  const s = settings();
  switch (key) {
    case "koppeln": return hasPcFeatures ? {
      lead: "Das Handy schickt den Alarm per WLAN an diesen PC. Beide müssen im selben WLAN sein.",
      steps: steps("Unten „Koppeln erlauben“ drücken. Der PC nimmt dann 5 Minuten lang neue Handys an.",
        "Am <b>Handy</b> in der Einrichtung Adresse und Code abtippen.",
        ["Fragt Windows nach der Firewall: Haken bei „Private Netzwerke“, dann „Zugriff zulassen“.", "firewall"]),
      body: [h("div.fields", {}, field("Adresse dieses PCs", h("input.input.mono", { readonly: true, value: direct.ip ? `${direct.ip}:${s.direct.port}` : "wird ermittelt …" })),
        field("Code", h("input.input.mono", { readonly: true, value: s.direct.code || "—" }))),
      row(direct.pairUntil > Date.now() ? h("span.chip.ok", {}, "Koppeln ist erlaubt") : btn("Koppeln erlauben (5 Minuten)", async () => { await openPairing(5); rerender(); }, true))],
      wait: "Warte auf das Handy …", ok: "Handy gekoppelt",
    } : {
      lead: "Dieses Handy schickt den Alarm per WLAN an deinen PC. Beide müssen im selben WLAN sein.",
      steps: steps("Am <b>PC</b> in der Einrichtung „Koppeln erlauben“ drücken.", "Adresse und Code vom PC hier eintragen.", "„Koppeln“ tippen."),
      body: (() => {
        const host = h("input.input.mono", { placeholder: "192.168.178.24", inputmode: "decimal" });
        const code = h("input.input.mono", { placeholder: "8-stelliger Code", inputmode: "numeric" });
        return [h("div.fields", {}, field("Adresse des PCs", host), field("Code", code)),
          row(btn("Koppeln", async () => {
            const [hp, port] = host.value.trim().split(":");
            if (!hp || !code.value.trim()) return toast("Adresse und Code eintragen");
            const ok = await addPeer({ host: hp, port: Number(port) || 8765, code: code.value.replace(/\s/g, "") });
            toast(ok ? "PC gekoppelt" : "PC nicht erreicht – Adresse, Code und WLAN prüfen");
            rerender();
          }, true))];
      })(),
      wait: (s.direct.peers || []).length ? "PC noch nicht erreicht" : "Noch kein PC gekoppelt", ok: "PC gekoppelt",
    };
    case "zentrale": return {
      lead: "Die Zentrale läuft in Docker auf deinem Gerät, das immer an ist.",
      steps: steps("Ordner <code>zentrale</code> aus dem Repository auf das Gerät kopieren, dazu den Ordner <code>esp32</code>.",
        ["<b>Raspberry Pi:</b> 1. <code>docker compose up -d</code> ausführen. 2. Nach jedem <code>git pull</code> auch <code>cp -r ../esp32/* esp32/</code> (sonst baut ESPHome die alte Firmware).<br><b>UGREEN-NAS:</b> In der Docker-App Projekt <code>heimalarm</code> erstellen und bereitstellen.", "docker"],
        "Mit Zigbee-Stick zusätzlich <code>--profile zigbee</code>. Auf der NAS für ESPHome in <code>docker-compose.yml</code> die Zeile <code>profiles: [\"esphome\"]</code> löschen – die Docker-App beachtet Profile aus <code>.env</code> nicht.",
        "Im WLAN-Router dem Gerät eine feste IP-Adresse geben und sie notieren, z. B. <code>192.168.178.5</code>."),
      body: [row(manual(key, rerender, "Zentrale läuft"))], ok: "Zentrale läuft",
    };
    case "verbinden": return {
      lead: "Gib die Adresse der Zentrale ein. Die Verbindung wird sofort geprüft.",
      steps: steps("Adresse eintragen.", "„Verbinden“ drücken."),
      body: (() => {
        const host = input(s.broker.host, () => {}, { placeholder: "192.168.178.5", inputmode: "decimal" });
        return [field("Adresse der Zentrale", host), row(btn("Verbinden", () => {
          set("broker.host", host.value.trim()); set("mode", "zentrale"); connect(); toast("Verbinde …");
        }, true))];
      })(),
      wait: state.connected ? "" : "Nicht verbunden", ok: "Zentrale erreichbar",
    };
    case "esp": return {
      lead: "Der ESP32 liest den Relaiskontakt der Ladeschale und meldet den Alarm an die Zentrale.",
      steps: steps("Relaiskontakt vorher messen: Er muss potentialfrei sein, sonst Optokoppler verwenden.",
        "<code>esp32/secrets.example.yaml</code> als <code>secrets.yaml</code> kopieren, WLAN und Zentrale eintragen.",
        `Nur die Datei für dein Board nehmen (<code>alarm-ich.yaml</code>, <code>-s3</code> oder <code>-d1mini</code>), dort die Kennung „${s.alarm.me}“ eintragen und mit ESPHome flashen. Die anderen beiden in ESPHome löschen – sie heißen gleich, eine falsche Firmware legt den Melder lahm.`,
        "In ESPHome: ⋮ → Validieren, dann Installieren → Im Netzwerk. Findet es den ESP32 nicht: Erweiterte Optionen → Geräte-IP.",
        "Kontakt an GPIO27 und GND (ESP32-S3: GPIO4, direkt neben RST – genau hinsehen).", "Unter Test &amp; Diagnose mit dem Kontakt-Test die Kabel prüfen."),
      body: [row(btn("Zu „Melder (ESP32)“", () => go("#/einstellungen/melder")), manual(key, rerender))], ok: "Melder meldet sich",
    };
    case "sybos": case "apager": {
      const ap = key === "apager";
      return {
        lead: ap ? "Wie bei SYBOS. Für „Ich fahre / nicht“ brauchst du zusätzlich einen Schlüssel aus aPager und das Smart-Home-Abo."
          : "Heimalarm liest die SYBOS-Meldung mit. SYBOS selbst bleibt unverändert und alarmiert dich weiter.",
        steps: steps(["„Zugriff erlauben“ tippen. Android öffnet die Liste „Benachrichtigungen lesen“. Dort Heimalarm antippen.", "notifList"],
          ["Schalter einschalten und mit „Zulassen“ bestätigen.", "notifAllow"],
          ap ? ["Optional: in aPager den Schlüssel für externen Zugriff kopieren und unten einfügen.", "apager"] : "Zurück in die App. Der Haken erscheint von selbst."),
        body: [ap && field("aPager-Schlüssel (optional)", input(s.apager.key, (v) => { set("apager.key", v); set("apager.feedback", Boolean(v)); }, { type: "password" })),
          isAndroid && row(btn("Zugriff erlauben", () => openNotificationAccess().catch(() => toast("Einstellung ließ sich nicht öffnen")), true)),
          !isAndroid && row(manual(key, rerender))].filter(Boolean),
        wait: "Zugriff noch nicht erlaubt", ok: "Benachrichtigungszugriff erlaubt",
      };
    }
    case "akku": return {
      lead: "Sonst beendet Android die App nach einiger Zeit, und Alarme gehen verloren.",
      steps: steps(["„Ausnahme erlauben“ tippen und mit „Zulassen“ bestätigen.", "battery"],
        ["Nur Samsung: Einstellungen → Apps → Heimalarm → Akku → „Nicht eingeschränkt“.", "samsung"]),
      body: [row(isAndroid ? btn("Ausnahme erlauben", () => { set("android.batteryAsked", true); openBatterySettings().catch(() => toast("Einstellung ließ sich nicht öffnen")); }, true) : manual(key, rerender))],
      wait: "Akku-Optimierung noch aktiv", ok: "Ausnahme erteilt",
    };
    case "divera": return {
      lead: "Dein persönlicher Schlüssel. Er bleibt nur auf diesem Gerät.",
      steps: steps("Divera im Browser öffnen und anmelden.", ["Einstellungen → Debug öffnen und den Accesskey (Divera-Schlüssel) kopieren.", "divera"], "Hier einfügen und „Prüfen“ drücken."),
      body: (() => {
        const keyField = input(s.divera.key, (v) => set("divera.key", v), { type: "password", placeholder: "Accesskey" });
        return [field("Divera-Schlüssel", keyField), row(btn("Prüfen", async () => {
          set("divera.key", keyField.value.trim());
          try { const r = await loadDivera(); toast(`Einheit „${r.unit || "?"}“ gefunden`); }
          catch (e) { toast(`Divera: ${e.message || "Schlüssel ungültig"}`); }
          rerender();
        }, true), divera.error && h("small.wz-err", {}, divera.error))];
      })(),
      wait: "Schlüssel noch nicht geprüft", ok: `Einheit „${s.divera.unit || "Divera"}“ gefunden`,
    };
    case "pc": return {
      lead: "Bei Alarm erscheint ein Vollbild mit Countdown. Antwortest du nicht, passiert danach die gewählte Aktion.",
      steps: steps("Countdown wählen. 30 Sekunden passen für die meisten.", "Wählen, was danach passiert.", "Autostart mit Windows bleibt an."),
      body: [h("div.fields", {},
        field("Countdown", h("select.select", { onchange: (e) => { set("pc.countdownSec", Number(e.target.value)); wz.markOk(key); rerender(); } },
          [15, 30, 60, 120].map((v) => h("option", { value: v, selected: s.pc.countdownSec === v }, `${v} Sekunden`)))),
        field("Danach", h("select.select", { onchange: (e) => { set("pc.action", e.target.value); wz.markOk(key); rerender(); } },
          [["hibernate", "Ruhezustand"], ["sleep", "Energiesparen"], ["lock", "Nur sperren"], ["none", "Nichts"]]
            .map(([v, l]) => h("option", { value: v, selected: s.pc.action === v }, l))))),
        row(manual(key, rerender, "Übernehmen"))],
      ok: "Gespeichert",
    };
    case "wifi": return {
      lead: "Licht im Heimnetz schaltet Heimalarm direkt, ohne Cloud.",
      steps: steps("Seite „Geräte“ öffnen und „WLAN-Gerät hinzufügen“ wählen.", "Art wählen (Shelly, Hue, WLED, Tasmota) und die Adresse eintragen.", "Bei Hue den Knopf auf der Bridge drücken."),
      body: [row(btn("Zu „Geräte“", () => go("#/geraete"), true), manual(key, rerender))],
      wait: "Noch kein WLAN-Gerät", ok: "WLAN-Gerät vorhanden",
    };
    case "zigbee": return {
      lead: "Zigbee-Lampen und -Schalter laufen über einen USB-Stick an der Zentrale.",
      steps: steps("Stick einstecken und <code>docker compose --profile zigbee up -d</code> ausführen.", "In Heimalarm „Geräte“ öffnen und „Anlernen“ drücken.", "Lampe in den Kopplungsmodus bringen (meist 5× ein- und ausschalten)."),
      body: [row(btn("Zu „Geräte“", () => go("#/geraete"), true), manual(key, rerender))], ok: "Erledigt",
    };
    case "alexa": return {
      lead: "Voice Monkey startet eine Alexa-Routine. Dafür brauchst du ein kostenloses Konto bei voicemonkey.io.",
      steps: steps("Bei voicemonkey.io anmelden und einen „Monkey“ anlegen, z. B. alarm-licht.",
        ["In der Konsole „API Tokens“ öffnen und den Token kopieren.", "voicemonkey"],
        "In der Alexa-App eine Routine mit dem Monkey als Auslöser anlegen. In Heimalarm unter „Routinen“ die Aktion „Alexa“ wählen."),
      body: [field("Voice-Monkey-Token", input(shared().voicemonkey?.token, (v) => { updateShared({ voicemonkey: { ...shared().voicemonkey, token: v } }); rerender(); }, { type: "password" }))],
      wait: "Noch kein Token", ok: "Token gespeichert",
    };
    case "matter": return {
      lead: "Die Zentrale meldet Alarme als Kontaktsensor an Alexa oder Google Home. Das läuft lokal.",
      steps: steps("„Alexa, Google & HA“ öffnen und die Sprachassistenten einschalten.", "In der Alexa- oder Google-Home-App „Matter-Gerät hinzufügen“ wählen.", "Den QR-Code aus Heimalarm scannen."),
      body: [row(btn("Zu „Alexa, Google & HA“", () => go("#/einstellungen/sprache"), true), manual(key, rerender))], ok: "Erledigt",
    };
    case "test": return {
      lead: "Einmal ausprobieren, ohne Folgen. Kein Ruhezustand, keine Rückmeldung an Apps.",
      steps: steps("„Testalarm senden“ drücken.", hasPcFeatures ? "„Fährst du?“ erscheint mit TEST-Kennzeichen." : "Die Alarmanzeige erscheint mit TEST-Kennzeichen.", "Fenster schließen. Fertig."),
      body: [row(btn("Testalarm senden", () => { testAlarm(); wz.markOk(key); }, true))], ok: "Testalarm gesendet",
    };
    default: return { lead: "", steps: null, body: [] };
  }
}

/* ── Seite ── */
export function wizardView(rerender) {
  const st = settings().wizard.step, p = wz.plan(), tot = wz.total();
  const isLast = st === tot - 1;
  const next = () => {
    if (st === 4) wz.applyAnswers();
    if (isLast) { wz.finish(); toast("Einrichtung abgeschlossen"); go("#/uebersicht"); return; }
    wz.setStep(st + 1); rerender(); focusTop();
  };
  const back = () => { if (st > 0) { wz.setStep(st - 1); rerender(); focusTop(); } };
  wizardView.keys = { next, back, later };

  // Linke Liste (am Handy ausgeblendet)
  const item = (it, idx) => {
    // Fragen: erledigt, wenn vorbei. Anleitung: nur, wenn die Prüfung passt (übersprungen bleibt offen).
    const done = idx < 5 ? idx < st : wz.check(it.key);
    return h("button.split-item.wz-item" + (done && idx !== st ? ".done" : idx > st ? ".todo" : ""), {
      type: "button", "aria-current": idx === st ? "page" : null,
      onclick: () => { if (idx >= 5 && st <= 4) wz.applyAnswers(); wz.setStep(idx); rerender(); },
    }, tile(done && idx !== st ? "check" : it.icon, it.color),
    h("span.split-item-text", {}, h("b", {}, it.title), h("small" + (done && idx !== st ? ".ok" : ""), {}, done && idx !== st ? "Erledigt" : it.sub || wz.WHERE[it.where])));
  };
  const list = h("aside.split-list.wz-list", { "aria-label": "Schritte" },
    h("h1", {}, "Einrichtung"),
    h("p.wz-sub", {}, `Schritt ${st + 1} von ${tot} · ${wz.withPi() ? "Mit Zentrale" : "Ohne Zentrale"}`),
    h("div.wz-meter", {}, h("i", { style: `width:${(st / (tot - 1)) * 100}%` })),
    h("nav.split-nav", {}, wz.INTRO.map((it, i) => item(it, i)), h("div.split-grp", {}, "Anleitung"), p.map((it, i) => item(it, 5 + i))),
    h("p.wz-later", {}, hasPcFeatures ? "Esc: später fortsetzen. Neu starten unter Einstellungen → Einrichtung." : "Neu starten unter Mehr → Einrichtung."));

  // Inhalt rechts
  const body = [];
  const a = wz.answers();
  if (st === 0) body.push(head("home", "--c-alarm", "Erster Start", "In ein paar Minuten startklar"),
    lead("Drei kurze Fragen. Danach bekommst du eine Anleitung nur für deine Geräte, Schritt für Schritt. Du kannst jederzeit aufhören und später weitermachen."),
    h("div.card", {}, h("ol.steps", {},
      h("li", {}, h("span", {}, h("b", {}, "Was du hast"), h("small", {}, "Melder, Alarm-Apps, Licht, ein Gerät, das immer läuft"))),
      h("li", {}, h("span", {}, h("b", {}, "Dein Plan"), h("small", {}, "Nur die Schritte, die du brauchst"))),
      h("li", {}, h("span", {}, h("b", {}, "Testalarm"), h("small", {}, "Ohne Folgen, nur zum Ausprobieren"))))),
    note("Heimalarm ist eine Komfortfunktion. Melder und Alarm-App bleiben die eigentliche Alarmierung."));
  else if (st === 1) body.push(head("bell", "--c-alarm", "Frage 1 von 3", "Wie kommt der Alarm an?"), lead("Alles ankreuzen, was du nutzt."), choices(wz.SOURCES, "src", true, rerender));
  else if (st === 2) body.push(head("flow", "--c-routine", "Frage 2 von 3", "Was soll bei Alarm passieren?"), lead("Lässt sich später jederzeit erweitern."), choices(wz.ACTIONS, "act", true, rerender));
  else if (st === 3) body.push(head("hub", "--c-net", "Frage 3 von 3", "Läuft ein Gerät rund um die Uhr?"),
    lead(wz.needsPi() ? "Für deine Auswahl brauchst du eine Zentrale, also ein Gerät, das immer an ist." : "Für deine Auswahl reicht es auch ohne."),
    choices(wz.ALWAYS, "always", false, rerender),
    wz.needsPi() && !wz.withPi() && note("Melder, Zigbee und Matter gehen nur mit Zentrale. Ohne sie lassen wir diese Schritte weg.", true));
  else if (st === 4) body.push(head("chart", "--c-app", wz.withPi() ? "Betriebsart: Mit Zentrale" : "Betriebsart: Ohne Zentrale", `Dein Plan · ${p.length} Schritte`),
    lead("Rechts steht, wo du den Schritt machst. Was schon passt, wird automatisch abgehakt. Mit „Anleitung starten“ werden deine Antworten gespeichert."),
    h("div.wz-plan", {}, p.map((it) => h("div.wz-pi", {}, tile(it.icon, it.color), h("b", {}, it.title), h("span.wz-where", {}, wz.WHERE[it.where])))),
    a.src.length === 0 && note("Du hast keine Alarmquelle gewählt. Ohne Quelle kommt kein Alarm an.", true));
  else {
    const it = p[st - 5], g = guide(it.key, rerender), mine = wz.isMine(it.where), ok = wz.check(it.key);
    body.push(head(it.icon, it.color, `Schritt ${st - 4} von ${p.length} · ${wz.WHERE[it.where]}`, it.title), lead(g.lead));
    if (!mine) body.push(note(it.where === "phone" ? "Diesen Schritt machst du am Handy, in der Einrichtung von Heimalarm dort." : "Diesen Schritt machst du am PC."));
    body.push(h("div.card.wz-card", {}, g.steps, mine && g.body,
      (g.ok || g.wait) && h("span.chip" + (ok ? ".ok" : ".warn"), { role: "status" }, ok ? g.ok : g.wait || "Noch offen")));
  }

  const actions = h("div.wz-actions", {},
    st === 0 ? h("button.btn.ghost", { type: "button", onclick: later }, "Später") : h("button.btn.ghost", { type: "button", onclick: back }, "Zurück"),
    h("span.wz-sp"),
    st >= 5 && !isLast && h("button.btn.ghost.wz-skip", { type: "button", onclick: next }, "Überspringen"),
    h("button.btn.primary", { type: "button", onclick: next }, st === 0 ? "Los geht’s" : st === 4 ? "Anleitung starten" : isLast ? "Fertig" : "Weiter"));

  const top = h("div.wz-top", {},
    st > 0 ? h("button.wz-back", { type: "button", onclick: back }, icon("back"), "Zurück") : h("b", {}, "Einrichtung"),
    h("span.wz-count", {}, `${st + 1} / ${tot}`),
    h("button.btn.ghost.small", { type: "button", onclick: later }, "Später"));

  return h("div.split.has-detail.wz", {}, list,
    h("section.split-detail.wz-detail", { "aria-live": "polite" }, top,
      h("div.wz-meter.wz-meter-phone", {}, h("i", { style: `width:${(st / (tot - 1)) * 100}%` })),
      h("div.wz-body", {}, ...body.filter(Boolean)), actions));
}

function focusTop() {
  queueMicrotask(() => { document.querySelector(".wz-detail h2")?.focus?.(); document.querySelector(".wz-detail")?.scrollTo?.(0, 0); window.scrollTo(0, 0); });
}

/** Enter = Weiter, Esc = später (nur am PC, nicht in Eingabefeldern oder Dialogen). */
export function wizardKeys(e) {
  if (!location.hash.startsWith("#/einrichtung") || document.querySelector(".dialog-wrap")) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  const k = wizardView.keys;
  if (!k) return;
  if (e.key === "Enter" && !document.activeElement?.closest?.("button")) { e.preventDefault(); k.next(); }
  else if (e.key === "Escape") k.later();
}
