// Zweitbildschirm für „Fährst du?“ (D6). Zeigt, was das Hauptfenster meldet, und schickt die Antwort zurück.
// Startet weder Verbindung noch Alarm-Logik – das macht nur das Hauptfenster.
import { h } from "./ui/dom.js";

const root = document.getElementById("takeover");
const { listen, emit } = await import("@tauri-apps/api/event");
const answer = (going) => emit("takeover-answer", { going });

document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => {
  if (e.repeat || (e.key === "Enter" && e.target.closest?.("button"))) return;
  if (e.key === "Enter") answer(true);
  if (e.key === "Escape") answer(false);
});

listen("takeover-state", ({ payload: s }) => {
  root.replaceChildren(h("div.box", {},
    h("div.tag", {}, s.tag),
    h("h1", {}, s.title),
    s.extra && h("p.meta-big", {}, s.extra),
    s.address && h("p.meta", {}, s.address),
    h("div.ring", { style: `--p:${s.left / s.total}`, role: "timer", "aria-label": `Noch ${s.left} Sekunden` }, h("span", {}, String(s.left))),
    h("div.actions", {},
      h("button.btn.primary", { type: "button", onclick: () => answer(true) }, s.goText),
      h("button.btn.secondary", { type: "button", onclick: () => answer(false) }, s.stayText)),
    h("p.note", {}, s.note),
  ));
});
emit("takeover-ready", {});
