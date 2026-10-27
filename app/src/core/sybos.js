// SYBOS-Benachrichtigung zerlegen.
// Titel: „ALARMIERUNG (LOHBR1) - 08:22:28 - ALARM“
//   ALARMIERUNG  steht in jedem Einsatz (Erkennungsmerkmal)
//   (LOHBR1)     alarmiertes Fahrzeug/Einheit
//   08:22:28     Alarmzeit
//   ALARM        Einsatz-Stichwort (alles nach dem letzten „ - “)
// Text: nur Ziffern („719961“) = Einsatznummer, sonst Alarmtext.

const TITLE = /^\s*ALARMIERUNG\s*(?:\(([^)]*)\))?\s*(?:-\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*)?-\s*(.+?)\s*$/iu;

/** Liefert { keyword, unit, text, details } – oder null, wenn der Titel nicht dem SYBOS-Muster folgt. */
export function parseSybos(title, text) {
  const m = TITLE.exec(String(title || ""));
  if (!m) return null;
  const [, unit = "", time = "", keyword] = m;
  const body = String(text || "").trim();
  const nr = /^\d{3,}$/u.test(body) ? body : "";
  const details = {};
  if (nr) details.Einsatznummer = nr;
  if (time) details["Alarmzeit (SYBOS)"] = time;
  return { keyword: keyword.trim(), unit: unit.trim(), text: nr ? "" : body, details };
}
