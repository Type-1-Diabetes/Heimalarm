// TV-Dashboards: frei zusammengestellte Kacheln im Raster 12 × 6, je Dashboard zwei Ansichten
// (Ruhe und Alarm, wie bei Feuerwehr-Alarmmonitoren). Liegt nur auf diesem PC (settings.dashboards).
// Anzeige: tv.html in einem randlosen Fenster (src/tv.js), Inhalt kommt vom Hauptfenster (core/tvlink.js).
import { settings, set } from "./settings.js";

export const COLS = 12;
export const ROWS = 6;
export const VIEWS = { ruhe: "Ruhe", alarm: "Alarm" };

/** Gruppen in der Palette, je mit Bereichsfarbe (wie in der App). */
export const GROUPS = {
  heimalarm: { label: "Heimalarm", color: "--c-haus" },
  einsaetze: { label: "Einsätze", color: "--c-wehr" },
  divera: { label: "Divera", color: "--c-divera" },
  extra: { label: "Extra", color: "--c-extra" },
};

/** Alle Kacheln: Name, Gruppe, Symbol, Standard- und Mindestgröße. `needs` = Hinweis, wenn die Quelle fehlt. */
export const TILES = {
  alarm:        { label: "Aktueller Alarm", group: "heimalarm", icon: "bell", color: "--c-alarm", w: 8, h: 4, minW: 4, minH: 2 },
  household:    { label: "Wer fährt?", group: "heimalarm", icon: "home", w: 4, h: 2, minW: 3, minH: 1 },
  readiness:    { label: "Bereitschaft", group: "heimalarm", icon: "home", w: 3, h: 1, minW: 2, minH: 1 },
  system:       { label: "Systemstatus", group: "heimalarm", icon: "hub", w: 3, h: 2, minW: 2, minH: 2 },
  devices:      { label: "Geräte", group: "heimalarm", icon: "bulb", w: 3, h: 2, minW: 2, minH: 1, needs: "zentrale" },
  routines:     { label: "Routinen", group: "heimalarm", icon: "flow", w: 3, h: 2, minW: 2, minH: 1, needs: "routinen" },
  log:          { label: "Protokoll", group: "heimalarm", icon: "chat", w: 3, h: 2, minW: 2, minH: 2 },
  einsaetze:    { label: "Letzte Einsätze", group: "einsaetze", icon: "list", w: 3, h: 3, minW: 2, minH: 2, needs: "logbuch" },
  stats:        { label: "Statistik", group: "einsaetze", icon: "chart", w: 3, h: 2, minW: 2, minH: 1, needs: "logbuch" },
  diveraStatus: { label: "Mein Divera-Status", group: "divera", icon: "people", w: 3, h: 1, minW: 3, minH: 1, needs: "divera" },
  answers:      { label: "Rückmeldungen", group: "divera", icon: "people", w: 4, h: 4, minW: 3, minH: 2, needs: "divera" },
  availability: { label: "Verfügbarkeit", group: "divera", icon: "people", w: 3, h: 2, minW: 2, minH: 1, needs: "divera" },
  vehicles:     { label: "Fahrzeuge", group: "divera", icon: "truck", w: 3, h: 2, minW: 2, minH: 1, needs: "divera" },
  events:       { label: "Termine", group: "divera", icon: "cal", w: 3, h: 3, minW: 2, minH: 2, needs: "divera" },
  news:         { label: "Mitteilungen", group: "divera", icon: "mega", w: 3, h: 3, minW: 2, minH: 2, needs: "divera" },
  clock:        { label: "Uhr", group: "extra", icon: "clock", w: 3, h: 2, minW: 2, minH: 1 },
  weather:      { label: "Wetter", group: "extra", icon: "cloud", w: 3, h: 2, minW: 2, minH: 1 },
  note:         { label: "Notiz", group: "extra", icon: "note", w: 3, h: 1, minW: 1, minH: 1 },
  image:        { label: "Logo / Bild", group: "extra", icon: "image", w: 2, h: 2, minW: 1, minH: 1 },
};

const newId = () => Math.random().toString(36).slice(2, 9);
const tile = (type, x, y, w, h, opts = {}) => ({ id: newId(), type, x, y, w, h, opts });

/** Startaufbau wie im abgestimmten Mockup (docs/mockups/dashboard.html). */
function starter(name = "Schreibtisch") {
  return {
    id: newId(), name, monitor: "", on: false, alarmSwitch: true, backMin: 60,
    views: {
      ruhe: [
        tile("clock", 0, 0, 3, 2), tile("diveraStatus", 0, 2, 3, 1), tile("readiness", 0, 3, 3, 1), tile("system", 0, 4, 3, 2),
        tile("availability", 3, 0, 3, 2), tile("vehicles", 3, 2, 3, 2), tile("weather", 3, 4, 3, 2),
        tile("events", 6, 0, 3, 3), tile("news", 6, 3, 3, 3),
        tile("einsaetze", 9, 0, 3, 3), tile("stats", 9, 3, 3, 2), tile("note", 9, 5, 3, 1, { text: "" }),
      ],
      alarm: [
        tile("alarm", 0, 0, 8, 4), tile("answers", 8, 0, 4, 4),
        tile("household", 0, 4, 4, 2), tile("vehicles", 4, 4, 4, 2),
        tile("clock", 8, 4, 4, 1), tile("weather", 8, 5, 4, 1),
      ],
    },
  };
}

export const dashboards = () => settings().dashboards || [];
export const getDash = (id) => dashboards().find((d) => d.id === id) || null;

/** Änderung an einer Kopie, dann speichern (löst „settings“ aus → Editor und TV-Fenster zeichnen neu). */
function mutate(fn) {
  const list = structuredClone(dashboards());
  const out = fn(list);
  set("dashboards", list);
  return out;
}

export function addDash(name) {
  return mutate((list) => {
    const d = starter(name || (list.length ? `Dashboard ${list.length + 1}` : "Schreibtisch"));
    list.push(d);
    return d.id;
  });
}
export const removeDash = (id) => mutate((list) => { const i = list.findIndex((d) => d.id === id); if (i >= 0) list.splice(i, 1); });
export const updateDash = (id, patch) => mutate((list) => { const d = list.find((x) => x.id === id); if (d) Object.assign(d, patch); });

/** Passt das Rechteck ins Raster, ohne andere Kacheln zu überdecken? */
export function fits(tiles, { x, y, w, h }, ignoreId = "") {
  if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > COLS || y + h > ROWS) return false;
  return !tiles.some((t) => t.id !== ignoreId && x < t.x + t.w && t.x < x + w && y < t.y + t.h && t.y < y + h);
}

/** Erste freie Stelle für eine Kachel dieser Größe (zeilenweise von oben links), sonst null. */
export function freeSpot(tiles, w, h) {
  for (let y = 0; y + h <= ROWS; y++) for (let x = 0; x + w <= COLS; x++) if (fits(tiles, { x, y, w, h })) return { x, y };
  return null;
}

/** Kachel hinzufügen. Ist die Standardgröße nicht frei, wird es die Mindestgröße. Liefert die ID oder null (kein Platz). */
export function addTile(dashId, view, type, at = null) {
  const def = TILES[type];
  if (!def) return null;
  return mutate((list) => {
    const tiles = list.find((d) => d.id === dashId)?.views[view];
    if (!tiles) return null;
    let spot = null;
    // Standardgröße zuerst, sonst die größte, die noch passt (bis zur Mindestgröße)
    const sizes = [];
    for (let w = def.w; w >= def.minW; w--) for (let h = def.h; h >= def.minH; h--) sizes.push([w, h]);
    sizes.sort((a, b) => b[0] * b[1] - a[0] * a[1]);
    for (const [w, h] of sizes) {
      if (at && fits(tiles, { ...at, w, h })) spot = { ...at, w, h };
      else { const s = freeSpot(tiles, w, h); if (s) spot = { ...s, w, h }; }
      if (spot) break;
    }
    if (!spot) return null;
    const t = tile(type, spot.x, spot.y, spot.w, spot.h, type === "note" ? { text: "" } : {});
    tiles.push(t);
    return t.id;
  });
}

/** Lage/Größe ändern, nur wenn es passt. Liefert true bei Erfolg. */
export function placeTile(dashId, view, tileId, rect) {
  const d = getDash(dashId);
  const t = d?.views[view]?.find((x) => x.id === tileId);
  if (!t) return false;
  const def = TILES[t.type];
  const next = { x: rect.x ?? t.x, y: rect.y ?? t.y, w: Math.max(def.minW, rect.w ?? t.w), h: Math.max(def.minH, rect.h ?? t.h) };
  if (!fits(d.views[view], next, tileId)) return false;
  if (next.x === t.x && next.y === t.y && next.w === t.w && next.h === t.h) return true;
  mutate((list) => Object.assign(list.find((x) => x.id === dashId).views[view].find((x) => x.id === tileId), next));
  return true;
}

export const removeTile = (dashId, view, tileId) => mutate((list) => {
  const tiles = list.find((d) => d.id === dashId)?.views[view];
  const i = tiles?.findIndex((t) => t.id === tileId) ?? -1;
  if (i >= 0) tiles.splice(i, 1);
});

export const setTileOpts = (dashId, view, tileId, opts) => mutate((list) => {
  const t = list.find((d) => d.id === dashId)?.views[view]?.find((x) => x.id === tileId);
  if (t) t.opts = { ...t.opts, ...opts };
});
