// Dashboard am Handy: zeigt die am PC gebauten Dashboards (abgeglichen über core/shared.js bzw. core/sync.js).
//   Hoch: Kacheln untereinander in drei Spalten (Reihenfolge wie am PC, von oben links), zum Scrollen.
//   Quer: das Raster 1:1 wie am Monitor, aufs Handy verkleinert. Kachel antippen = groß. Hält man das Handy
//         hochkant, wird um 90° gedreht – einfach das Handy drehen.
// Daten und Bedienung laufen wie im Hauptfenster am PC: core/board.js (Schnappschuss, act), eigener Divera-Abruf.
// Die Ansicht ist ein dauerhaftes Element: main.js setzt es nicht bei jedem Ereignis neu (Scroll-Position, Lesefenster).
import { h } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { on } from "../core/events.js";
import { settings, set } from "../core/settings.js";
import { dashboards } from "../core/dashboard.js";
import { snapshot, act, alarmActive, boardUse } from "../core/board.js";
import { renderBoard, renderTile, startTicker, W, H, PAD, GAP, CELL_W, CELL_H } from "../ui/tiles.js";
import { mountDetail } from "../ui/detail.js";
import { log } from "../core/log.js";
import { boardMode } from "../core/android.js";

const COLS_HOCH = 3;
const el = h("div.pb");
let active = false, ticker = 0, wake = null, detail = null, zoom = null, timer = 0;
const layer = h("div.pb-layer");
const zoomLayer = h("div.pb-layer");

const pref = () => ({ id: "", orient: "auto", awake: true, ...settings().phoneBoard });
const setPref = (patch) => set("phoneBoard", { ...pref(), ...patch });
const portraitDevice = () => innerHeight >= innerWidth;
/** Gewählte Ausrichtung → „hoch“ oder „quer“ (auto folgt dem Handy). */
const orient = () => { const o = pref().orient; return o === "hoch" || o === "quer" ? o : portraitDevice() ? "hoch" : "quer"; };
const full = () => document.body.classList.contains("board-full");

const host = {
  act: (a) => act(a),
  open: (d) => { detail = { kind: d.kind, id: d.id ?? null }; zoom = null; paint(); },
  select: (x) => { detail = { ...detail, id: x }; paint(); },
  close: () => { detail = null; paint(); },
};

function currentDash() {
  const list = dashboards();
  return list.find((d) => d.id === pref().id) || list[0] || null;
}

// ── Bildschirm anlassen, Vollbild ────────────────────────────────────────────
// Android-App: nativ (Leisten ausblenden, FLAG_KEEP_SCREEN_ON). Browser: Wake Lock und Fullscreen-API.
async function keepAwake(onOff) {
  if (await boardMode(onOff && full(), onOff && pref().awake)) return;
  try {
    if (onOff && !wake && pref().awake && "wakeLock" in navigator && !document.hidden) {
      wake = await navigator.wakeLock.request("screen");
      wake.addEventListener?.("release", () => { wake = null; });
    } else if (!onOff && wake) { await wake.release(); wake = null; }
  } catch (e) { log("info", "Bildschirm anlassen geht hier nicht", String(e?.message || e)); }
}
document.addEventListener("visibilitychange", () => { if (active && !document.hidden) keepAwake(true); });

async function setFull(onOff) {
  document.body.classList.toggle("board-full", onOff);
  if (onOff) showExit(); else exitBtn.remove();
  if (await boardMode(onOff, active && pref().awake)) { paint(); return; }
  try {
    if (onOff && !document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    if (!onOff && document.fullscreenElement) await document.exitFullscreen?.();
  } catch { /* WebView ohne Vollbild-API: Leisten bleiben, die App-Leiste ist trotzdem weg */ }
  paint();
}
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && full()) { document.body.classList.remove("board-full"); paint(); } });

// „Vollbild aus“: kleiner runder Knopf in der Ecke, blendet sich nach 3 s aus. Antippen irgendwo holt ihn zurück.
const exitBtn = h("button.pb-exit", { type: "button", "aria-label": "Vollbild beenden", title: "Vollbild beenden", onclick: () => setFull(false) }, icon("x"));
let exitTimer = 0;
function showExit() {
  if (!full()) return;
  if (!exitBtn.isConnected) el.append(exitBtn);
  exitBtn.classList.remove("dim");
  clearTimeout(exitTimer);
  exitTimer = setTimeout(() => exitBtn.classList.add("dim"), 3000);
}
el.addEventListener("pointerdown", () => { if (full()) showExit(); }, true);

// ── Zeichnen ────────────────────────────────────────────────────────────────
/**
 * Hoch: Kacheln untereinander in Lesereihenfolge (wie am PC von oben links), volle Breite, Höhe nach Inhalt.
 * Wie viele Einträge eine Kachel zeigt, richtet sich weiter nach ihrer Höhe am PC. Karte und Bild behalten ihre Höhe.
 * `width` = gedachte Breite in Monitor-Pixeln: so gewählt, dass die Schrift am Handy etwa 90 % der Monitorgröße hat.
 */
const FIXED_H = ["diveraMap", "image"];
function portraitBoard(dash, view, snap, width) {
  const tiles = (dash.views[view] || []).toSorted((a, b) => a.y - b.y || a.x - b.x);
  const board = h(`div.dash-board.pb-hoch${view === "alarm" ? ".alarmv" : ""}`, { "data-theme": snap.theme, style: `width:${width}px` });
  for (const t of tiles) {
    const tile = renderTile({ ...t, w: Math.min(t.w, COLS_HOCH) }, snap, host);
    tile.style.gridArea = "auto";
    if (FIXED_H.includes(t.type)) tile.style.height = `${Math.min(t.h, 3) * CELL_H + (Math.min(t.h, 3) - 1) * GAP}px`;
    board.append(tile);
  }
  return board;
}

/** Eine Kachel groß (Quer-Ansicht, angetippt): eigenes kleines Raster in Originalgröße, aufs Handy skaliert. */
function zoomed(snap) {
  const dash = currentDash();
  const t = dash && Object.values(dash.views).flat().find((x) => x.id === zoom);
  if (!t) { zoom = null; return null; }
  const w = t.w * CELL_W + (t.w - 1) * GAP + 2 * PAD, hh = t.h * CELL_H + (t.h - 1) * GAP + 2 * PAD;
  const k = Math.min((innerWidth - 32) / w, (innerHeight - 140) / hh, 2);
  const board = h("div.dash-board.pb-zoom", { "data-theme": snap.theme,
    style: `width:${w}px;height:${hh}px;grid-template-columns:repeat(${t.w},minmax(0,1fr));grid-template-rows:repeat(${t.h},minmax(0,1fr));transform:scale(${k})` },
  renderTile({ ...t, x: 0, y: 0 }, snap, host));
  return h(`div.pz${zoomLayer.querySelector(":scope > .pz") ? ".still" : ""}`, { "data-theme": snap.theme, role: "dialog", "aria-modal": "true", "aria-label": "Kachel groß" },
    h("div.pz-scrim", { onclick: () => { zoom = null; paint(); } }),
    h("div.pz-box", { style: `width:${w * k}px;height:${hh * k}px` }, board),
    h("button.pb-fab", { type: "button", onclick: () => { zoom = null; paint(); } }, icon("x"), "Schließen"));
}

/** Antippen einer Kachel in der Quer-Ansicht: groß zeigen (Knöpfe und „Lesen“ in der Kachel gehen vor). */
function onTap(e) {
  if (orient() !== "quer" || e.target.closest("button, [data-open], a, input, select")) return;
  const t = e.target.closest(".t[data-id]");
  if (!t) return;
  zoom = t.dataset.id; paint();
}

function toolbar(dash, list) {
  const p = pref();
  return h("header.pb-bar", {},
    h("div.pb-title", {},
      h("h1", {}, "Dashboard"),
      list.length > 1
        ? h("select.select.pb-pick", { "aria-label": "Dashboard wählen", onchange: (e) => { setPref({ id: e.target.value }); detail = null; zoom = null; paint(); } },
          list.map((d) => h("option", { value: d.id, selected: d.id === dash.id }, d.name || "Dashboard")))
        : h("p", {}, dash.name || "Dashboard")),
    h("div.pb-tools", {},
      h("div.segmented", { role: "group", "aria-label": "Ausrichtung" }, [["auto", "Auto"], ["hoch", "Hoch"], ["quer", "Quer"]].map(([k, l]) =>
        h("button", { type: "button", "aria-pressed": String(p.orient === k), onclick: () => { setPref({ orient: k }); zoom = null; paint(); } }, l))),
      h("button.btn.pb-full", { type: "button", onclick: () => setFull(true) }, icon("grid"), "Vollbild")));
}

function emptyState() {
  return h("section.pb-empty", {},
    h("span.ico", {}, icon("grid")),
    h("h2", {}, "Noch kein Dashboard"),
    h("p", {}, "Dashboards baust du am PC unter „Dashboard“. Sie kommen von selbst aufs Handy, wenn Abgleich an ist (Einstellungen → Abgleich) – mit Zentrale oder direkt mit dem PC."));
}

function paint() {
  if (!active) return;
  const list = dashboards();
  const dash = currentDash();
  if (!dash) { clearInterval(ticker); el.replaceChildren(emptyState()); return; }
  const snap = snapshot();
  const view = dash.alarmSwitch !== false && alarmActive(dash.backMin) && dash.views.alarm?.length ? "alarm" : "ruhe";
  if (view === "alarm") { detail = null; zoom = null; }   // Bei Alarm hat die Alarm-Ansicht Vorrang
  const o = orient();
  document.documentElement.dataset.theme = snap.theme;

  const stage = el.querySelector(".pb-stage") || h("div.pb-stage");
  const stageW = stage.getBoundingClientRect().width || el.getBoundingClientRect().width || innerWidth;
  const board = o === "hoch" ? portraitBoard(dash, view, snap, Math.round(Math.max(360, stageW / 0.9))) : renderBoard(dash, view, snap, host);
  board.addEventListener("click", onTap);
  const scaler = h(`div.pb-scale${o === "quer" ? ".quer" : ""}`, {}, board);
  stage.replaceChildren(scaler);
  if (!el.contains(stage)) el.replaceChildren(toolbar(dash, list), stage, layer, zoomLayer);
  else el.querySelector(".pb-bar")?.replaceWith(toolbar(dash, list));
  el.dataset.view = view;
  el.classList.toggle("rot", o === "quer" && portraitDevice());

  // Größe: Hoch = Breite füllen, Quer = ganz hineinpassen (gedreht, wenn das Handy hochkant ist)
  requestAnimationFrame(() => {
    const r = stage.getBoundingClientRect();
    // Innenabstand der Bühne = Abstand zu Status-/Navigationsleiste (nur im Vollbild gesetzt)
    const cs = getComputedStyle(stage), px = (k) => parseFloat(cs[k]) || 0;
    const inner = { w: r.width - px("paddingLeft") - px("paddingRight"), top: px("paddingTop"), bottom: px("paddingBottom") };
    if (o === "hoch") {
      const k = inner.w / board.offsetWidth;
      scaler.style.cssText = `height:${board.offsetHeight * k}px;--tf:scale(${k})`;
    } else {
      // Platz bis zur Leiste unten (Handy) bzw. bis zum Fensterrand
      const nav = document.querySelector(".nav")?.getBoundingClientRect();
      const bottom = !full() && nav && nav.top > innerHeight / 2 ? innerHeight - nav.top : 0;
      const avail = full()
        ? { w: inner.w, h: innerHeight - inner.top - inner.bottom }
        : { w: inner.w, h: Math.max(200, innerHeight - Math.max(0, r.top) - bottom - 12) };
      const rot = portraitDevice();
      const k = rot ? Math.min(avail.h / W, avail.w / H) : Math.min(avail.w / W, avail.h / H);
      scaler.style.cssText = rot
        ? `width:${H * k}px;height:${W * k}px;--tf:translateX(${H * k}px) rotate(90deg) scale(${k})`
        : `width:${W * k}px;height:${H * k}px;--tf:scale(${k})`;
      scaler.classList.toggle("rot", rot);
    }
  });

  clearInterval(ticker);
  ticker = startTicker(board);
  mountDetail(layer, detail, snap, host, { phone: true });
  const z = zoom && !detail ? zoomed(snap) : null;
  zoomLayer.replaceChildren(...(z ? [z] : []));
}

// Neu zeichnen bei neuen Daten (gebündelt), nicht bei jedem Ereignis einzeln
const soon = () => { if (!active) return; clearTimeout(timer); timer = setTimeout(paint, 200); };
for (const ev of ["board", "divera", "conn", "devices", "shared", "log", "alarm", "alarm-update", "restore"]) on(ev, soon);
on("settings", ({ path }) => { if (path === "dashboards" || path.startsWith("ui")) soon(); });
addEventListener("resize", soon);
setInterval(soon, 30_000);
document.addEventListener("keydown", (e) => {
  if (!active || e.key !== "Escape") return;
  if (zoom) { zoom = null; paint(); } else if (detail) host.close(); else if (full()) setFull(false);
});

/** Route „#/dashboard“ am Handy. Liefert immer dasselbe Element. */
export function phoneBoardView() {
  if (!active) {
    active = true;
    boardUse(+1);
    keepAwake(true);
    el.replaceChildren();
  }
  paint();
  return el;
}

/** Route verlassen: Abfragen, Bildschirm-anlassen und Vollbild beenden. */
export function phoneBoardLeave() {
  if (!active) return;
  active = false;
  clearInterval(ticker);
  boardUse(-1);
  keepAwake(false);
  detail = null; zoom = null;
  if (full()) setFull(false);
}

