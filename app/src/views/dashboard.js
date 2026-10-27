// Dashboard-Editor (nur Windows-Programm): Dashboards anlegen, Kacheln im Raster 12 × 6 platzieren,
// je Kachel einstellen und auf einem Bildschirm (Fernseher) anzeigen. Abgestimmt im Mockup docs/mockups/dashboard.html.
// Die Vorschau ist dasselbe Bild wie auf dem TV (ui/tiles.js), darüber liegt eine Ebene zum Ziehen und Größe ändern.
import { h, toast } from "../ui/dom.js";
import { field, switchRow, select, ask } from "../ui/form.js";
import { icon } from "../ui/icons.js";
import { renderBoard, startTicker, W, H, PAD, GAP, CELL_W, CELL_H } from "../ui/tiles.js";
import {
  COLS, ROWS, VIEWS, TILES, GROUPS, dashboards, getDash, addDash, removeDash, updateDash,
  addTile, placeTile, removeTile, setTileOpts, fits,
} from "../core/dashboard.js";
import { snapshot, boardUse, previewAlarm, SAMPLE_ALARM } from "../core/board.js";
import { screens } from "../core/tvlink.js";
import { has } from "../core/features.js";
import { hasPcFeatures } from "../core/platform.js";

// Zustand der Seite (bleibt beim Neuzeichnen erhalten)
const ui = { view: "ruhe", sel: null, screens: null, using: false, ticker: 0 };

// Divera-/Wetterabfrage nur, solange die Seite offen ist
function use(on) {
  if (on === ui.using) return;
  ui.using = on;
  boardUse(on ? 1 : -1);
}
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/dashboard")) use(false); });

/** Fehlt die Quelle einer Kachel? Kurzer Hinweis für die Palette. */
function missing(def) {
  if (def.needs === "divera") return has.diveraApi() ? "" : "Divera mit Schlüssel einrichten";
  if (def.needs === "logbuch") return has.logbuch() ? "" : "Einsatz-Logbuch einschalten";
  if (def.needs === "zentrale") return has.pi() ? "" : "nur mit Zentrale";
  return "";
}

/** Zelle (x, y) unter einem Punkt der Vorschau. */
function cellAt(stage, k, clientX, clientY) {
  const r = stage.getBoundingClientRect();
  const px = (clientX - r.left) / k - PAD, py = (clientY - r.top) / k - PAD;
  return {
    x: Math.max(0, Math.min(COLS - 1, Math.floor(px / (CELL_W + GAP)))),
    y: Math.max(0, Math.min(ROWS - 1, Math.floor(py / (CELL_H + GAP)))),
  };
}
const boxStyle = ({ x, y, w, h: hh }) => `grid-area:${y + 1}/${x + 1}/${y + hh + 1}/${x + w + 1}`;

// ── Vorschau mit Bearbeitungsebene ───────────────────────────────────────────
function stageView(dash, rerender) {
  const tiles = dash.views[ui.view];
  let snap = snapshot();
  if (ui.view === "alarm" && !snap.alarm) snap = { ...snap, alarm: { ...SAMPLE_ALARM, ts: Date.now() - 95_000, preview: true } };
  const board = renderBoard(dash, ui.view, snap, { act: () => {} });
  board.inert = true;

  const edit = h("div.dash-edit", { style: `width:${W}px;height:${H}px` });
  // freie Zellen sichtbar machen
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (fits(tiles, { x, y, w: 1, h: 1 })) edit.append(h("div.dash-cell", { style: boxStyle({ x, y, w: 1, h: 1 }) }));
  }
  const ghost = h("div.dash-ghost", { hidden: true });
  edit.append(ghost);

  const stage = h("div.dash-scale.dash-stage", {}, board, edit);
  const k = () => Number(getComputedStyle(stage).getPropertyValue("--k")) || 0.5;

  for (const t of tiles) {
    const def = TILES[t.type];
    const handle = h("button.dash-handle", { type: "button", "aria-label": "Größe ändern", title: "Ziehen: Größe ändern" });
    const box = h("div.dash-box" + (ui.sel === t.id ? ".sel" : ""), {
      style: boxStyle(t), tabindex: "0", role: "button", "aria-pressed": String(ui.sel === t.id),
      "aria-label": `${def.label}, ${t.w} breit, ${t.h} hoch. Pfeiltasten verschieben, mit Umschalt Größe ändern, Entf entfernt.`,
      onkeydown: (e) => {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (d) {
          e.preventDefault();
          const ok = e.shiftKey ? placeTile(dash.id, ui.view, t.id, { w: t.w + d[0], h: t.h + d[1] }) : placeTile(dash.id, ui.view, t.id, { x: t.x + d[0], y: t.y + d[1] });
          if (!ok) toast("Dort ist kein Platz");
          ui.sel = t.id; rerender(); focusSel();
        } else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeTile(dash.id, ui.view, t.id); ui.sel = null; rerender(); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ui.sel = t.id; rerender(); focusSel(); }
      },
    }, h("span.dash-box-label", {}, icon(def.icon), def.label, h("small", {}, `${t.w} × ${t.h}`)), handle);

    // Ziehen: verschieben (auf der Kachel) oder Größe ändern (Ecke unten rechts)
    box.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const resize = e.target === handle;
      const start = cellAt(stage, k(), e.clientX, e.clientY);
      let rect = { x: t.x, y: t.y, w: t.w, h: t.h }, moved = false;
      box.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const c = cellAt(stage, k(), ev.clientX, ev.clientY);
        rect = resize
          ? { x: t.x, y: t.y, w: Math.max(def.minW, Math.min(COLS - t.x, c.x - t.x + 1)), h: Math.max(def.minH, Math.min(ROWS - t.y, c.y - t.y + 1)) }
          : { x: Math.max(0, Math.min(COLS - t.w, t.x + c.x - start.x)), y: Math.max(0, Math.min(ROWS - t.h, t.y + c.y - start.y)), w: t.w, h: t.h };
        moved ||= rect.x !== t.x || rect.y !== t.y || rect.w !== t.w || rect.h !== t.h;
        ghost.hidden = !moved;
        ghost.style.cssText = boxStyle(rect);
        ghost.classList.toggle("bad", !fits(tiles, rect, t.id));
      };
      const up = () => {
        box.removeEventListener("pointermove", move);
        box.removeEventListener("pointerup", up);
        box.removeEventListener("pointercancel", up);
        ghost.hidden = true;
        ui.sel = t.id;
        if (moved && !placeTile(dash.id, ui.view, t.id, rect)) toast("Dort ist kein Platz");
        rerender();
        focusSel();
      };
      box.addEventListener("pointermove", move);
      box.addEventListener("pointerup", up);
      box.addEventListener("pointercancel", up);
    });
    edit.append(box);
  }

  // Aus der Palette auf das Raster ziehen
  edit.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/x-kachel")) e.preventDefault(); });
  edit.addEventListener("drop", (e) => {
    const type = e.dataTransfer.getData("text/x-kachel");
    if (!type) return;
    e.preventDefault();
    const id = addTile(dash.id, ui.view, type, cellAt(stage, k(), e.clientX, e.clientY));
    if (!id) toast("Kein Platz frei – erst eine Kachel verkleinern oder entfernen");
    ui.sel = id; rerender();
  });
  // Klick auf eine freie Stelle hebt die Auswahl auf
  edit.addEventListener("pointerdown", (e) => { if (e.target === edit || e.target.classList.contains("dash-cell")) { ui.sel = null; rerender(); } });

  // Größe an die Breite anpassen
  const fit = () => { const w = stage.clientWidth; if (w) stage.style.setProperty("--k", String(w / W)); };
  new ResizeObserver(fit).observe(stage);
  queueMicrotask(fit);
  clearInterval(ui.ticker);
  ui.ticker = startTicker(board);
  return stage;
}
const focusSel = () => queueMicrotask(() => document.querySelector(".dash-box.sel")?.focus());

// ── Palette ─────────────────────────────────────────────────────────────────
function palette(dash, rerender) {
  const used = new Set(dash.views[ui.view].map((t) => t.type));
  return h("section.card.dash-palette", {},
    h("h2", {}, "Kachel hinzufügen"),
    h("p.hint", {}, "Antippen legt die Kachel an die erste freie Stelle, oder auf das Raster ziehen."),
    Object.entries(GROUPS).map(([g, grp]) => h("div.pal-row", {},
      h("span.pal-lbl", {}, grp.label),
      Object.entries(TILES).filter(([, d]) => d.group === g).map(([type, d]) => {
        const miss = missing(d);
        return h("button.pk" + (used.has(type) ? ".used" : ""), {
          type: "button", draggable: "true", style: `--a:var(${d.color || grp.color})`,
          title: miss ? `${d.label} – ${miss}` : d.label,
          ondragstart: (e) => { e.dataTransfer.setData("text/x-kachel", type); e.dataTransfer.effectAllowed = "copy"; },
          onclick: () => {
            const id = addTile(dash.id, ui.view, type);
            if (!id) return toast("Kein Platz frei – erst eine Kachel verkleinern oder entfernen");
            ui.sel = id; rerender();
          },
        }, h("i", {}, icon(d.icon)), d.label, miss && h("small", {}, miss));
      }))));
}

// ── Einstellungen der gewählten Kachel ───────────────────────────────────────
function stepper(label, value, onStep) {
  return h("div.stepper", { role: "group", "aria-label": label },
    h("button", { type: "button", "aria-label": `${label} kleiner`, onclick: () => onStep(-1) }, "−"),
    h("span", {}, `${value} ${label}`),
    h("button", { type: "button", "aria-label": `${label} größer`, onclick: () => onStep(1) }, "+"));
}

/** Bild verkleinern (höchstens 600 px), damit es in den Einstellungen Platz hat. */
function pickImage(onDone) {
  const inp = h("input", { type: "file", accept: "image/png,image/jpeg,image/svg+xml,image/webp" });
  inp.addEventListener("change", () => {
    const f = inp.files?.[0];
    if (!f) return;
    const img = new Image();
    img.addEventListener("load", () => {
      const s = Math.min(1, 600 / Math.max(img.width, img.height));
      const c = h("canvas", { width: Math.round(img.width * s), height: Math.round(img.height * s) });
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      onDone(c.toDataURL("image/png"));
      URL.revokeObjectURL(img.src);
    });
    img.src = URL.createObjectURL(f);
  });
  inp.click();
}

function inspector(dash, rerender) {
  const t = dash.views[ui.view].find((x) => x.id === ui.sel);
  if (!t) {
    return h("aside.card.dash-inspect", {},
      h("h2", {}, "Kachel wählen"),
      h("p.hint", {}, "Kachel antippen, um Größe und Inhalt einzustellen. Ziehen verschiebt, die Ecke unten rechts ändert die Größe."),
      h("p.hint", {}, "Tastatur: Pfeile verschieben, Umschalt + Pfeile ändern die Größe, Entf entfernt."));
  }
  const def = TILES[t.type];
  const grow = (dw, dh) => { if (!placeTile(dash.id, ui.view, t.id, { w: t.w + dw, h: t.h + dh })) toast(dw + dh < 0 ? "Kleiner geht diese Kachel nicht" : "Dort ist kein Platz"); rerender(); };
  const other = ui.view === "ruhe" ? "alarm" : "ruhe";
  const miss = missing(def);
  return h("aside.card.dash-inspect", { style: `--a:var(${def.color || GROUPS[def.group].color})` },
    h("h2", {}, h("span.ico", {}, icon(def.icon)), def.label),
    miss && h("p.dash-warn", {}, `Zeigt erst etwas, wenn die Quelle da ist: ${miss}.`),
    h("div.field", {}, h("span", {}, "Größe"), h("div.steppers", {}, stepper("breit", t.w, (d) => grow(d, 0)), stepper("hoch", t.h, (d) => grow(0, d)))),
    t.type === "note" && [
      field("Überschrift", h("input.input", { value: t.opts?.title || "", placeholder: "Notiz", maxlength: 40, onchange: (e) => { setTileOpts(dash.id, ui.view, t.id, { title: e.target.value.trim() }); rerender(); } })),
      field("Text", h("textarea.input", { rows: 4, maxlength: 400, value: t.opts?.text || "", onchange: (e) => { setTileOpts(dash.id, ui.view, t.id, { text: e.target.value }); rerender(); } })),
    ],
    t.type === "image" && h("div.row", {},
      h("button.btn.small", { type: "button", onclick: () => pickImage((src) => { setTileOpts(dash.id, ui.view, t.id, { src }); rerender(); }) }, t.opts?.src ? "Anderes Bild" : "Bild wählen"),
      t.opts?.src && h("button.btn.small.ghost", { type: "button", onclick: () => { setTileOpts(dash.id, ui.view, t.id, { src: "" }); rerender(); } }, "Entfernen")),
    t.type === "weather" && h("p.hint", {}, "Daten vom Deutschen Wetterdienst über Bright Sky. Ort: Einstellungen → Zentrale → Standort."),
    t.type === "answers" && h("p.hint", {}, "Wer kommt, wer nicht, wer offen ist – aus Divera. Sichtbar ist nur, was dein Divera-Schlüssel sehen darf."),
    t.type === "alarm" && h("p.hint", {}, "Mit aPager allein kommen nur Stichwort und Einheit an, mit Divera oder SYBOS auch Adresse und Text."),
    h("div.row", {},
      h("button.btn.small", { type: "button", onclick: () => {
        const id = addTile(dash.id, other, t.type);
        toast(id ? `In die ${VIEWS[other]}-Ansicht kopiert` : `In der ${VIEWS[other]}-Ansicht ist kein Platz`);
        if (id) setTileOpts(dash.id, other, id, t.opts || {});
      } }, `Auch in „${VIEWS[other]}“`),
      h("button.btn.small.ghost.danger", { type: "button", onclick: () => { removeTile(dash.id, ui.view, t.id); ui.sel = null; rerender(); } }, "Kachel entfernen")));
}

// ── Linke Spalte: Dashboards und Anzeige ─────────────────────────────────────
function listPane(dash, rerender) {
  if (ui.screens === null) { ui.screens = []; screens().then((s) => { ui.screens = s; rerender(); }); }
  const scr = ui.screens.map((s, i) => [s.key, `${s.name || `Bildschirm ${i + 1}`} · ${s.width}×${s.height}${s.primary ? " (Hauptbildschirm)" : ""}`]);
  return h("aside.split-list", {},
    h("h1", {}, "Dashboards"),
    h("nav.split-nav", { "aria-label": "Dashboards" },
      dashboards().map((d) => h("a.split-item", { href: `#/dashboard/${d.id}`, "aria-current": dash?.id === d.id ? "page" : null },
        h("span.ico", { style: `--a:var(${d.on ? "--c-pc" : "--text-2"})` }, icon("tv")),
        h("span.split-item-text", {}, h("b", {}, d.name), h("small", {}, d.on ? "läuft auf dem Fernseher" : "aus")),
        h("span.chev", {}, icon("chev")))),
      h("button.btn.small.dash-new", { type: "button", onclick: () => { const id = addDash(); location.hash = `#/dashboard/${id}`; } }, icon("plus"), "Neues Dashboard")),
    dash && h("div.dash-settings", {},
      h("div.split-grp", {}, "Anzeige"),
      field("Name", h("input.input", { value: dash.name, maxlength: 40, onchange: (e) => { updateDash(dash.id, { name: e.target.value.trim() || dash.name }); rerender(); } })),
      field("Bildschirm",
        scr.length ? select([["", "Automatisch"], ...scr], dash.monitor || "", (v) => updateDash(dash.id, { monitor: v }))
          : h("p.hint", {}, "Bildschirme werden gesucht …"),
        "Automatisch = der erste Bildschirm, der nicht der Hauptbildschirm ist."),
      switchRow("Auf dem Bildschirm zeigen", "Vollbild, startet mit Heimalarm.", dash.on, (v) => { updateDash(dash.id, { on: v }); rerender(); }),
      switchRow("Bei Alarm umschalten", "auf die Alarm-Ansicht", dash.alarmSwitch !== false, (v) => updateDash(dash.id, { alarmSwitch: v })),
      field("Zurück nach (Minuten)", h("input.input", { type: "number", min: 5, max: 720, value: dash.backMin || 60, onchange: (e) => updateDash(dash.id, { backMin: Math.min(720, Math.max(5, Number(e.target.value) || 60)) }) }),
        "Wenn niemand „Einsatz beenden“ drückt."),
      h("button.btn.small.ghost.danger", { type: "button", onclick: async () => {
        if (!(await ask(`Dashboard „${dash.name}“ löschen?`, { ok: "Löschen" }))) return;
        removeDash(dash.id); location.hash = "#/dashboard"; rerender();
      } }, "Dashboard löschen")));
}

export function dashboardView(rerender) {
  if (!hasPcFeatures) return h("section.split-detail", {}, h("p.empty", {}, "Dashboards gibt es nur im Windows-Programm."));
  use(true);
  const id = location.hash.replace("#/", "").split("/")[1];
  const dash = getDash(id) || dashboards()[0] || null;
  if (dash && ui.sel && !dash.views[ui.view].some((t) => t.id === ui.sel)) ui.sel = null;

  if (!dash) {
    return h("div.split", {}, listPane(null, rerender), h("section.split-detail", {},
      h("section.card", {}, h("h2", {}, "Ein Alarmmonitor für den Fernseher"),
        h("p", {}, "Stell dir aus Kacheln zusammen, was der Fernseher am PC zeigt: Uhr, Bereitschaft, Divera-Status, Fahrzeuge, Termine, Wetter. Bei Alarm wechselt er auf eine eigene Alarm-Ansicht mit Stichwort, Adresse und Rückmeldungen."),
        h("div.row", {}, h("button.btn.primary", { type: "button", onclick: () => { const nid = addDash(); location.hash = `#/dashboard/${nid}`; } }, "Erstes Dashboard anlegen")))));
  }

  const detail = h("section.split-detail.dash-detail", { style: "--a:var(--c-pc)" },
    h("a.split-back", { href: "#/dashboard" }, icon("back"), "Dashboards"),
    h("div.dash-head", {},
      h("h2", {}, dash.name),
      h("div.segmented", { role: "group", "aria-label": "Ansicht" }, Object.entries(VIEWS).map(([v, label]) =>
        h("button", { type: "button", "aria-pressed": String(ui.view === v), onclick: () => { ui.view = v; ui.sel = null; rerender(); } }, label))),
      h("span.dash-sp"),
      h("button.btn.small", { type: "button", disabled: !dash.on, title: dash.on ? "" : "Erst „Auf dem Bildschirm zeigen“ einschalten", onclick: () => { previewAlarm(60); toast("Alarm-Ansicht für 60 Sekunden auf dem Fernseher"); } }, "Alarm-Ansicht testen"),
      h("button.btn.small" + (dash.on ? "" : ".primary"), { type: "button", onclick: () => { updateDash(dash.id, { on: !dash.on }); rerender(); } }, dash.on ? "Vom Bildschirm nehmen" : "Auf Bildschirm zeigen")),
    ui.view === "alarm" && h("p.hint", {}, "Vorschau mit Beispiel-Einsatz. Bei einem echten Alarm stehen hier Stichwort, Adresse und Rückmeldungen."),
    h("div.dash-work", {}, stageView(dash, rerender), inspector(dash, rerender)),
    palette(dash, rerender));
  return h("div.split.has-detail", {}, listPane(dash, rerender), detail);
}

/** Beim Ziehen nicht neu zeichnen (main.js fragt das ab, bevor es die Seite neu aufbaut). */
export const dashDragging = () => Boolean(document.querySelector(".dash-ghost:not([hidden])"));
