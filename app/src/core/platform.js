// Wo läuft die App? Steuert, welche Funktionen und Einstellungen sichtbar sind.
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
export const isAndroid = /Android/i.test(ua);
export const isWindows = /Windows/i.test(ua) && !isAndroid;

/** PC-Funktionen (Ruhezustand, Vollbild-Abfrage, Autostart) gibt es nur im Windows-Programm. */
export const hasPcFeatures = isTauri && isWindows;

export const platformName = isAndroid ? "Android" : isWindows ? "Windows" : "Browser";
