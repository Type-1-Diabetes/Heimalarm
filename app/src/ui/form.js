// Bausteine für Formulare. Werte werden direkt über Pfade gespeichert (settings.js).
import { h } from "./dom.js";
import { get, set } from "../core/settings.js";
import { hasPcFeatures } from "../core/platform.js";

export const field = (label, input, hint) => h("label.field", {}, h("span", {}, label), input, hint && h("small", {}, hint));

/** Textfeld, das einen Einstellungs-Pfad bearbeitet. */
export function text(path, attrs = {}, { onSave } = {}) {
  return h("input.input", {
    value: get(path) ?? "", ...attrs,
    onchange: (e) => {
      const v = attrs.type === "number" ? Number(e.target.value) : e.target.value.trim();
      set(path, v);
      onSave?.(v);
    },
  });
}

export function toggle(path, label, hint, after) {
  return h("label.switch", {},
    h("div", {}, label, hint && h("small", {}, hint)),
    h("input", { type: "checkbox", role: "switch", checked: !!get(path), onchange: (e) => { set(path, e.target.checked); after?.(e.target.checked); } }),
  );
}

/** Freier Schalter ohne Einstellungs-Pfad. */
export function switchRow(label, hint, checked, onChange) {
  return h("label.switch", {},
    h("div", {}, label, hint && h("small", {}, hint)),
    h("input", { type: "checkbox", role: "switch", checked: !!checked, onchange: (e) => onChange(e.target.checked) }),
  );
}

export function segmented(options, value, onPick) {
  const wrap = h("div.segmented", { role: "group" });
  const render = (v) => wrap.replaceChildren(...options.map(([key, label]) =>
    h("button", { type: "button", "aria-pressed": String(v === key), onclick: () => { render(key); onPick(key); } }, label)));
  render(value);
  return wrap;
}

export function select(options, value, onChange, attrs = {}) {
  return h("select.select", { ...attrs, onchange: (e) => onChange(e.target.value) },
    options.map(([k, label]) => h("option", { value: k, selected: String(value) === String(k) }, label)));
}

export const section = (id, title, sub, ...body) =>
  h("section.card.section", { id }, h("header", {}, h("h2", {}, title), sub && h("p", {}, sub)), ...body);

/** Text in die Zwischenablage, mit Fallback. */
export async function copyText(value) {
  try { await navigator.clipboard.writeText(value); return true; }
  catch {
    const ta = h("textarea", { style: "position:fixed;opacity:0" });
    ta.value = value; document.body.append(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  }
}

/** Datei herunterladen (Windows) – auf dem Handy bleibt die Zwischenablage. */
export function download(name, content) {
  const a = h("a", { href: URL.createObjectURL(new Blob([content], { type: "application/json" })), download: name });
  document.body.append(a); a.click(); a.remove();
}

/** Einfacher Dialog mit Inhalt; gibt eine Funktion zum Schließen zurück. */
export function dialog(title, ...content) {
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => {
    wrap.remove();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("hashchange", close);
  };
  const wrap = h("div.dialog-wrap", { onclick: (e) => { if (e.target === wrap) close(); } },
    h("div.dialog", { role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div.card-head", {}, h("h2", {}, title), h("button.btn.ghost.icon", { "aria-label": "Schließen", onclick: close }, "✕")),
      ...content));
  document.body.append(wrap);
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", close);
  wrap.querySelector("input, select, textarea, button.primary")?.focus();
  return close;
}

/**
 * Rückfrage im App-Stil (statt confirm(), das in Tauri fremd aussieht und am Handy hakt).
 * Gibt true bei „OK“ zurück. Gefährliche Aktionen („löschen“, „entfernen“ …) bekommen einen roten Knopf.
 */
export function ask(question, { ok, cancel = "Abbrechen" } = {}) {
  const verb = Object.entries({ lösch: "Löschen", entfern: "Entfernen", entkoppel: "Entkoppeln", leer: "Leeren" })
    .find(([k]) => question.toLowerCase().includes(k))?.[1];
  const danger = Boolean(verb);
  const label = ok || verb || "OK";
  // Am Windows-PC: echtes Systemfenster statt Dialog in der Seite – wirkt wie ein normales Programm.
  if (hasPcFeatures) {
    return import("@tauri-apps/plugin-dialog")
      .then(({ confirm }) => confirm(question, { title: "Heimalarm", kind: danger ? "warning" : "info", okLabel: label, cancelLabel: cancel }))
      .catch(() => askInPage(question, label, cancel, danger));
  }
  return askInPage(question, label, cancel, danger);
}

function askInPage(question, label, cancel, danger) {
  return new Promise((resolve) => {
    let done = false;
    const answer = (v) => { if (done) return; done = true; close(); resolve(v); };
    const close = dialog("Bitte bestätigen",
      h("p", {}, question),
      h("div.row", { style: "justify-content:flex-end" },
        h("button.btn.ghost", { type: "button", onclick: () => answer(false) }, cancel),
        h(`button.btn.primary${danger ? ".danger" : ""}`, { type: "button", onclick: () => answer(true) }, label)));
    // Schließen per ✕, Esc oder Klick daneben = Abbrechen
    const wrap = [...document.querySelectorAll(".dialog-wrap")].pop();
    new MutationObserver((_, obs) => { if (!wrap?.isConnected) { obs.disconnect(); answer(false); } }).observe(document.body, { childList: true });
  });
}
