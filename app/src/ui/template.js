// Textfeld mit Platzhaltern ({stichwort} …): Knöpfe fügen an der Schreibmarke ein,
// darunter steht live, wie der Text mit einem Beispiel-Einsatz aussieht.
import { h } from "./dom.js";
import { fillTemplate } from "../core/wifi.js";

export const PLACEHOLDERS = [
  ["stichwort", "Stichwort"], ["adresse", "Adresse"], ["einheit", "Einheit"],
  ["uhrzeit", "Uhrzeit"], ["quelle", "Quelle"], ["person", "Person"], ["text", "Meldungstext"],
];

/** Beispiel-Einsatz für Vorschauen. */
export const SAMPLE = { keyword: "B3 Wohnungsbrand", address: "Hauptstraße 5", unit: "LF 20", source: "Divera", who: "ich", text: "Rauch aus Fenster, Personen im Gebäude", ts: Date.now() };

/**
 * value, onChange(v), { placeholder, maxlength, multiline, keys, ev, empty }
 * keys = welche Platzhalter angeboten werden (Standard: alle)
 */
export function templateField(label, value, onChange, opts = {}) {
  const { placeholder = "", maxlength = 200, multiline = false, keys, ev = SAMPLE, hint, empty = "(leer)" } = opts;
  const preview = h("span.tpl-out");
  const paintPreview = (v) => { const out = fillTemplate(v, ev); preview.textContent = out || empty; preview.classList.toggle("is-empty", !out); };
  const input = h(multiline ? "textarea.input.tpl-input" : "input.input.tpl-input", {
    value, placeholder, maxlength, spellcheck: "false", rows: multiline ? 3 : null,
    oninput: (e) => paintPreview(e.target.value),
    onchange: (e) => onChange(e.target.value),
  });
  if (multiline) input.value = value || "";
  const insert = (k) => {
    const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
    const add = `{${k}}`;
    input.value = (input.value.slice(0, s) + add + input.value.slice(e)).slice(0, maxlength);
    input.focus(); input.setSelectionRange(s + add.length, s + add.length);
    paintPreview(input.value); onChange(input.value);
  };
  paintPreview(value);
  const list = PLACEHOLDERS.filter(([k]) => !keys || keys.includes(k));
  return h("div.field.tpl", {},
    h("span", {}, label),
    input,
    h("div.tpl-tokens", { role: "group", "aria-label": "Platzhalter einfügen" },
      list.map(([k, l]) => h("button.tpl-token", { type: "button", title: `{${k}} einfügen`, onmousedown: (e) => e.preventDefault(), onclick: () => insert(k) }, l))),
    h("div.tpl-preview", {}, h("span.tpl-label", {}, "Beispiel"), preview),
    hint && h("small", {}, hint));
}
