// Nachgezeichnete Bildschirme fremder Apps für die Einrichtung (keine fremden Screenshots im Paket).
// Rote, nummerierte Rahmen zeigen, wo man tippt – in dieser Reihenfolge. Quelle/Version steht darunter.
import { h } from "./dom.js";
import { dialog } from "./form.js";

const hl = (n, inner, cls = "") => `<span class="hl ${cls}" data-n="${n}">${inner}</span>`;
const row = (a, b = "") => `<div class="r"><span>${a}</span>${b}</div>`;
const tg = (on) => `<span class="tg${on ? " on" : ""}"></span>`;
const cb = (on, round) => `<span class="cb${on ? " on" : ""}${round ? " round" : ""}"></span>`;

export const SHOTS = {
  firewall: { title: "Windows-Firewall", cap: "Erscheint beim ersten Start", src: "Windows 11", win: true,
    html: `<div class="bar">Windows-Sicherheitswarnung</div><div class="pad"><b>Einige Features von Heimalarm wurden blockiert.</b><span class="m">Kommunikation in diesen Netzwerken zulassen:</span>${hl(1, `${cb(true)}Private Netzwerke`)}<span>${cb(false)}Öffentliche Netzwerke</span><div class="btns">${hl(2, "Zugriff zulassen", "bt p")}<span class="bt">Abbrechen</span></div></div>` },
  notifList: { title: "Benachrichtigungen lesen", cap: "Liste der Apps · Heimalarm antippen", src: "Android 14 (Pixel), ähnlich bei Samsung",
    html: `<div class="bar">‹ Benachrichtigungen lesen</div>${row("Divera 24/7", tg(false))}<div class="r hl" data-n="1"><span>Heimalarm</span>${tg(false)}</div>${row("Google", tg(true))}${row("Wear OS", tg(true))}` },
  notifAllow: { title: "Zugriff bestätigen", cap: "Schalter an, dann „Zulassen“", src: "Android 14", dim: true,
    html: `<div class="dlg"><b>Heimalarm erlauben, Benachrichtigungen zu lesen?</b><span class="m">Die App kann alle Benachrichtigungen lesen.</span><div class="btns"><span class="bt">Nicht zulassen</span>${hl(1, "Zulassen", "bt p")}</div></div>` },
  battery: { title: "Akku-Ausnahme", cap: "Systemfrage nach „Ausnahme erlauben“", src: "Android 14", dim: true,
    html: `<div class="dlg"><b>App immer im Hintergrund ausführen lassen?</b><span class="m">Heimalarm darf dann jederzeit im Hintergrund laufen.</span><div class="btns"><span class="bt">Ablehnen</span>${hl(1, "Zulassen", "bt p")}</div></div>` },
  samsung: { title: "Nur Samsung", cap: "Einstellungen → Apps → Heimalarm → Akku", src: "One UI 6",
    html: `<div class="bar">‹ Akku</div><div class="r hl" data-n="1"><span>Nicht eingeschränkt</span>${cb(true, true)}</div>${row("Optimiert", cb(false, true))}${row("Eingeschränkt", cb(false, true))}` },
  divera: { title: "Divera im Browser", cap: "Einstellungen → Debug → Accesskey", src: "app.divera247.com",
    html: `<div class="bar">DIVERA 24/7 <span class="m">› Einstellungen</span></div><div class="cols"><div class="side"><div class="r">Profil</div><div class="r">Push</div><div class="r hl" data-n="1">Debug</div></div><div class="pad"><span class="m">Accesskey</span>${hl(2, "a8Kx…F3qZ", "key")}<span class="bt">Kopieren</span></div></div>` },
  apager: { title: "aPager PRO", cap: "Einstellungen → Smart Home", src: "Pfad bitte am eigenen Gerät prüfen", check: true, dark: true,
    html: `<div class="bar">‹ Grundeinstellungen</div>${row("Alarmton<small>Standard</small>")}${row("Rückmeldung &amp; Verfügbarkeit")}<div class="r hl" data-n="1"><span>Smart Home<small>Externer Zugriff</small></span></div>${row("Wasserkarte")}` },
  voicemonkey: { title: "Voice Monkey", cap: "Konsole → API Tokens", src: "app.voicemonkey.io/tokens",
    html: `<div class="bar">Voice Monkey <span class="m">› API Tokens</span></div><div class="r"><span>Haupt-Token<small><span class="key">••••••••</span></small></span>${hl(1, "Kopieren", "bt")}</div>${row("<span class=\"m\">Monkey: alarm-licht</span>")}` },
  docker: { title: "Auf der Zentrale", cap: "Im Ordner „zentrale“", src: "Terminal", dark: true, mono: true,
    html: `<div class="bar">Terminal</div><div class="pad">$ cd zentrale${hl(1, "$ docker compose up -d")}<span class="okt">✔ mosquitto  Started</span><span class="okt">✔ dienst     Started</span></div>` },
};

const screen = (s, big) => h("div.gs-scr" + (s.win ? ".win" : "") + (s.dim ? ".dim" : "") + (s.dark ? ".dark" : "") + (s.mono ? ".mono" : "") + (big ? ".big" : ""),
  { "aria-hidden": "true", html: s.html });

const caption = (s) => h("span.gs-src" + (s.check ? ".check" : ""), {}, (s.check ? "⚠ " : "") + s.src);

/** Vorschau neben einem Schritt; Antippen öffnet die Großansicht. */
export function shotButton(key) {
  const s = SHOTS[key];
  if (!s) return null;
  return h("button.gs-shot", { type: "button", "aria-label": `Bild: ${s.title} – vergrößern`, onclick: () => openShot(key) },
    screen(s), h("span.gs-cap", {}, h("b", {}, s.title), h("span", {}, s.cap), caption(s)));
}

export function openShot(key) {
  const s = SHOTS[key];
  dialog(s.title, h("p.hint", {}, s.cap), screen(s, true), caption(s),
    h("p.hint", {}, "Rote Zahlen: hier tippen, in dieser Reihenfolge."));
}
