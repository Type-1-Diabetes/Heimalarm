// G3 – Rollen: Mit gesetzter Admin-PIN dürfen nur Admins Routinen, Geräte, Personen
// und Zentralen-Einstellungen ändern. Alle anderen können nur steuern.
// H4 – App-Sperre: optionale PIN beim Öffnen der App (nur dieses Gerät).
import { shared, sha256 } from "./shared.js";
import { settings } from "./settings.js";
import { h } from "../ui/dom.js";
import { biometricLabel, biometricUnlock } from "./biometric.js";

let unlocked = false;

export const isAdmin = () => !shared().adminPinHash || unlocked;

/** Fragt bei Bedarf die Admin-PIN ab. Ergebnis: true = darf bearbeiten. */
export function requireAdmin() {
  if (isAdmin()) return Promise.resolve(true);
  return askPin("Admin-PIN", "Zum Bearbeiten ist die Admin-PIN nötig.", shared().adminPinHash).then((ok) => (unlocked = ok));
}

export const lockAdmin = () => { unlocked = false; };

function askPin(title, hint, hash) {
  return new Promise((resolve) => {
    const input = h("input.input", { type: "password", inputmode: "numeric", autocomplete: "off", "aria-label": "PIN" });
    const msg = h("p.meta", {}, hint);
    const done = (ok) => { wrap.remove(); resolve(ok); };
    const check = async () => {
      if ((await sha256(input.value)) === hash) done(true);
      else { msg.textContent = "PIN falsch. Bitte erneut versuchen."; input.value = ""; input.focus(); }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
    const wrap = h("div.dialog-wrap", {},
      h("div.dialog", { role: "dialog", "aria-modal": "true", "aria-label": title },
        h("h2", {}, title), msg, input,
        h("div.row", {}, h("button.btn.primary", { onclick: check }, "Entsperren"), h("button.btn", { onclick: () => done(false) }, "Abbrechen"))));
    document.body.append(wrap);
    input.focus();
  });
}

/** H4 – Sperrbildschirm beim Start, falls eine App-PIN gesetzt ist. */
export function appLock() {
  const hash = settings().lock.pinHash;
  if (!hash) return Promise.resolve();
  return new Promise((resolve) => {
    const input = h("input.input", { type: "password", inputmode: "numeric", autocomplete: "off", "aria-label": "App-PIN" });
    const msg = h("p.meta", {}, "PIN eingeben, um Heimalarm zu öffnen.");
    const check = async () => {
      if ((await sha256(input.value)) === hash) { wrap.remove(); resolve(); }
      else { msg.textContent = "PIN falsch."; input.value = ""; }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
    const bioRow = h("div.row", { hidden: true });
    const wrap = h("div.lock", {}, h("div.box", {},
      h("img", { src: "/icon.svg", width: 56, height: 56, alt: "" }), h("h1", {}, "Heimalarm"), msg, input,
      h("button.btn.primary", { onclick: check }, "Öffnen"),
      bioRow,
      h("p.meta", {}, "Alarme werden auch bei gesperrter App empfangen.")));
    document.body.append(wrap);
    input.focus();
    // Fingerabdruck / Windows Hello: gleich anbieten, PIN bleibt als Rückfall
    if (settings().lock.biometric) {
      biometricLabel().then((label) => {
        if (!label) return;
        const tryBio = async () => { if (await biometricUnlock()) { wrap.remove(); resolve(); } else msg.textContent = `${label} nicht erkannt – PIN eingeben oder erneut versuchen.`; };
        bioRow.replaceChildren(h("button.btn", { onclick: tryBio }, `Mit ${label} öffnen`));
        bioRow.hidden = false;
        tryBio();
      });
    }
  });
}
