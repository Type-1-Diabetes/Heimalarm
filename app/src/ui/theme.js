// E5 – Dunkel (Standard) oder Hell. Umschalter in Navigation und Seitenkopf.
import { settings, set } from "../core/settings.js";
import { h } from "./dom.js";
import { hasPcFeatures } from "../core/platform.js";

const ORDER = ["dark", "light"];
const LABEL = { dark: "Dunkel", light: "Hell" };
const ICON = {
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
};

const current = () => (settings().ui.theme === "light" ? "light" : "dark");

export function applyTheme() {
  document.documentElement.dataset.theme = current();
  document.querySelectorAll("[data-theme-toggle]").forEach(paint);
  // Windows: Titelleiste passend hell/dunkel
  if (hasPcFeatures) import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setTheme(current())).catch(() => {});
}

function paint(btn) {
  const t = current();
  btn.innerHTML = `${ICON[t]}<span>${LABEL[t]}</span>`;
  btn.title = `Farbschema: ${LABEL[t]} – wechseln zu ${LABEL[t === "dark" ? "light" : "dark"]}`;
  btn.setAttribute("aria-label", btn.title);
}

/** Knopf, der zwischen Dunkel und Hell wechselt. */
export function themeToggle(extraClass = "") {
  const btn = h("button.theme-toggle" + (extraClass ? "." + extraClass : ""), {
    type: "button", "data-theme-toggle": true,
    onclick: () => {
      set("ui.theme", ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length]);
      applyTheme();
    },
  });
  paint(btn);
  return btn;
}
