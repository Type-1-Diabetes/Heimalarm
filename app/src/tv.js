// Dashboard-Fenster (weiterer Monitor): zeichnet das Dashboard aus dem Schnappschuss des Hauptfensters und schickt Bedienungen zurück.
// Startet weder Verbindung noch Alarm-Logik – das macht nur das Hauptfenster (core/tvlink.js).
import { renderBoard, startTicker, W, H } from "./ui/tiles.js";
import { h } from "./ui/dom.js";

const root = document.getElementById("tv");
const id = decodeURIComponent(location.hash.slice(1));
const { listen, emit } = await import("@tauri-apps/api/event");
const ctx = { act: (a) => emit("tv-action", a) };
let ticker = 0;
let last = null;

function fit() { root.style.setProperty("--k", String(Math.min(innerWidth / W, innerHeight / H))); }
addEventListener("resize", fit);
fit();

function draw() {
  if (!last) return;
  const dash = last.dashes.find((d) => d.id === id);
  document.documentElement.dataset.theme = last.snap.theme;
  if (!dash) { root.replaceChildren(h("p.dash-empty", { style: "padding:48px" }, "Dieses Dashboard gibt es nicht mehr.")); return; }
  const view = last.alarm[id] && dash.views.alarm?.length ? "alarm" : "ruhe";
  const board = renderBoard(dash, view, last.snap, ctx);
  clearInterval(ticker);
  root.replaceChildren(board);
  ticker = startTicker(board);
}

document.addEventListener("contextmenu", (e) => e.preventDefault());

await listen("tv-state", ({ payload }) => { last = payload; draw(); });
emit("tv-ready", { id });
