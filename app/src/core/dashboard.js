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

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Nächste freie Stelle zu `want` (Manhattan-Abstand). Erst in voller Größe, sonst kleiner bis zur Mindestgröße. */
function nearestSpot(placed, want, w0, h0, def) {
  const sizes = [];
  for (let w = w0; w >= def.minW; w--) for (let h = h0; h >= def.minH; h--) sizes.push([w, h]);
  sizes.sort((a, b) => b[0] * b[1] - a[0] * a[1]);
  for (const [w, h] of sizes) {
    let best = null, dist = Infinity;
    for (let y = 0; y + h <= ROWS; y++) for (let x = 0; x + w <= COLS; x++) {
      const r = { x, y, w, h };
      if (placed.some((p) => overlaps(p, r))) continue;
      const d = Math.abs(x - want.x) + Math.abs(y - want.y);
      if (d < dist) { dist = d; best = r; }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Kachel `id` auf `rect` legen und überdeckte Kacheln neu ordnen.
 * Verschieben auf genau eine Kachel = Tausch (beide wechseln die Plätze, wenn es passt).
 * Sonst rücken die überdeckten Kacheln in den frei gewordenen Platz, beim Größe ändern an die nächste freie Stelle.
 * Liefert { id: {x, y, w, h} } für alle Kacheln, deren Lage sich ändert, oder null, wenn es nicht aufgeht.
 */
export function planPlace(tiles, id, rect) {
  const self = tiles.find((t) => t.id === id);
  if (!self) return null;
  const def = TILES[self.type];
  const next = { x: rect.x, y: rect.y, w: Math.max(def.minW, rect.w), h: Math.max(def.minH, rect.h) };
  if (next.x < 0 || next.y < 0 || next.x + next.w > COLS || next.y + next.h > ROWS) return null;
  const others = tiles.filter((t) => t.id !== id);
  const hit = others.filter((t) => overlaps(t, next)).toSorted((a, b) => a.y - b.y || a.x - b.x);
  if (!hit.length) return { [id]: next };
  const moved = next.x !== self.x || next.y !== self.y;

  // Tausch: Ziel nimmt den alten Platz, die gezogene Kachel den des Ziels (beide in eigener Größe)
  if (moved && hit.length === 1 && next.w === self.w && next.h === self.h) {
    const o = hit[0];
    const a = { x: o.x, y: o.y, w: self.w, h: self.h }, b = { x: self.x, y: self.y, w: o.w, h: o.h };
    const rest = others.filter((t) => t !== o);
    const inGrid = (r) => r.x + r.w <= COLS && r.y + r.h <= ROWS;
    if (inGrid(a) && inGrid(b) && !overlaps(a, b) && !rest.some((t) => overlaps(t, a) || overlaps(t, b))) return { [id]: a, [o.id]: b };
  }

  const placed = [...others.filter((t) => !hit.includes(t)), next];
  const out = { [id]: next };
  for (const t of hit) {
    // Beim Verschieben: gleicher Abstand im frei gewordenen Platz. Beim Größe ändern: möglichst nah an der alten Stelle.
    const want = moved ? { x: self.x + (t.x - next.x), y: self.y + (t.y - next.y) } : { x: t.x, y: t.y };
    const spot = nearestSpot(placed, want, t.w, t.h, TILES[t.type]);
    if (!spot) return null;
    placed.push(spot);
    out[t.id] = spot;
  }
  return out;
}

/** Lage/Größe ändern; überdeckte Kacheln werden getauscht bzw. neu geordnet (planPlace). Liefert true bei Erfolg. */
export function placeTile(dashId, view, tileId, rect) {
  const tiles = getDash(dashId)?.views[view];
  const t = tiles?.find((x) => x.id === tileId);
  if (!t) return false;
  const plan = planPlace(tiles, tileId, { x: rect.x ?? t.x, y: rect.y ?? t.y, w: rect.w ?? t.w, h: rect.h ?? t.h });
  if (!plan) return false;
  const changed = Object.entries(plan).filter(([id, r]) => { const o = tiles.find((x) => x.id === id); return o.x !== r.x || o.y !== r.y || o.w !== r.w || o.h !== r.h; });
  if (changed.length) mutate((list) => {
    const ts = list.find((x) => x.id === dashId).views[view];
    for (const [id, r] of changed) Object.assign(ts.find((x) => x.id === id), r);
  });
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
