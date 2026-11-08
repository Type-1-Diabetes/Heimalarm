// Dashboard-Fenster (weiterer Monitor): zeichnet das Dashboard aus dem Schnappschuss des Hauptfensters und schickt Bedienungen zurück.
// Startet weder Verbindung noch Alarm-Logik – das macht nur das Hauptfenster (core/tvlink.js).
// Lesefenster (ui/detail.js) liegt als eigene Ebene darüber und bleibt beim Neuzeichnen stehen.
import { renderBoard, startTicker, W, H } from "./ui/tiles.js";
import { mountDetail } from "./ui/detail.js";
import { h } from "./ui/dom.js";

const root = document.getElementById("tv");
const id = decodeURIComponent(location.hash.slice(1));
const { listen, emit } = await import("@tauri-apps/api/event");
const IDLE_MS = 3 * 60e3;   // Lesefenster schließt sich nach 3 Minuten ohne Bedienung (der Monitor soll nicht darauf stehen bleiben)
let ticker = 0;
let last = null;
let detail = null;          // { kind, id }
let lastView = "ruhe";
let idleTimer = 0;
const layer = h("div.ds-layer");

const touch = () => { clearTimeout(idleTimer); if (detail) idleTimer = setTimeout(() => setDetail(null), IDLE_MS); };
function setDetail(next) { detail = next; touch(); drawDetail(); }
const host = {
  act: (a) => emit("tv-action", a),
  open: (d) => setDetail({ kind: d.kind, id: d.id ?? null }),
  select: (x) => setDetail({ ...detail, id: x }),
  close: () => setDetail(null),
};

function fit() { root.style.setProperty("--k", String(Math.min(innerWidth / W, innerHeight / H))); }
addEventListener("resize", fit);
fit();

function drawDetail() { if (last) mountDetail(layer, detail, last.snap, host); }

function draw() {
  if (!last) return;
  const dash = last.dashes.find((d) => d.id === id);
  document.documentElement.dataset.theme = last.snap.theme;
  if (!dash) { root.replaceChildren(h("p.dash-empty", { style: "padding:48px" }, "Dieses Dashboard gibt es nicht mehr.")); return; }
  const view = last.alarm[id] && dash.views.alarm?.length ? "alarm" : "ruhe";
  // Bei Alarm hat die Alarm-Ansicht Vorrang: offenes Lesefenster schließen
  if (view === "alarm" && lastView !== "alarm") detail = null;
  lastView = view;
  const board = renderBoard(dash, view, last.snap, host);
  clearInterval(ticker);
  // Nur das Raster tauschen – die Ebene bleibt im DOM (sonst springt die Scroll-Position im Lesefenster)
  const old = root.querySelector(":scope > .dash-board");
  if (old && layer.parentNode === root) old.replaceWith(board); else root.replaceChildren(board, layer);
  ticker = startTicker(board);
  drawDetail();
}

document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && detail) setDetail(null); else touch(); });
document.addEventListener("pointerdown", touch, true);

await listen("tv-state", ({ payload }) => { last = payload; draw(); });
emit("tv-ready", { id });
