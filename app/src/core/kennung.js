// Kennung einer Person: Teil der Topics alarm/<kennung>. Nur a–z, 0–9 und „-“,
// sonst kommen Alarme nicht an (Leerzeichen, „/“, „#“, „+“ brechen MQTT-Topics).

const UMLAUTE = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

/** Macht aus einer Eingabe eine gültige Kennung, z. B. „Jörg Müller“ → „joerg-mueller“. */
export const normalizeKennung = (raw = "") => String(raw).trim().toLowerCase()
  .replace(/[äöüß]/gu, (c) => UMLAUTE[c])
  .replace(/[\s_]+/gu, "-")
  .replace(/[^a-z0-9-]/gu, "")
  .replace(/-+/gu, "-")
  .replace(/^-|-$/gu, "")
  .slice(0, 32);

/** Liste mit Komma, z. B. für „Abfrage auch bei Alarm von“. */
export const normalizeKennungList = (raw = "") => String(raw).split(",").map(normalizeKennung).filter(Boolean).join(", ");

export const KENNUNG_HINT = "Kurzer Name ohne Leerzeichen, z. B. „alex“. Muss auf allen deinen Geräten und im Melder gleich sein. Jede Person braucht eine eigene.";
