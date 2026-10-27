// Passen Zentrale und ESP32 zu dieser App? Die passenden Versionen setzt vite.config.js beim Bauen
// aus zentrale/dienst/package.json und esp32/alarm-ich.yaml (HEIMALARM_FW).
import { state } from "./mqtt.js";
import { has } from "./features.js";

export const WANT = {
  zentrale: import.meta.env.ZENTRALE_VERSION || "0.0.0",
  fw: Number(import.meta.env.ESP_FW) || 0,
};
export const GUIDE_URL = "https://github.com/Type-1-Diabetes/Heimalarm/blob/main/docs/anleitungen/Heimalarm-Update.pdf";

/** -1, 0, 1 für „0.2.8“ gegen „0.2.10“ */
export function cmpVersion(a = "0", b = "0") {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Veraltete Geräte: [{ key, name, have, want, how }] – nur, was eingerichtet und erreichbar ist. */
export function outdated() {
  const out = [];
  const z = state.dienst;
  if (has.pi() && z?.online && z.version && cmpVersion(z.version, WANT.zentrale) < 0) {
    out.push({ key: "zentrale", name: "Zentrale", have: z.version, want: WANT.zentrale, how: "Schritt 2 der Update-Anleitung" });
  }
  if (has.esp() && WANT.fw) {
    for (const [who, d] of Object.entries(state.devices || {})) {
      if (!d?.online || (d.fw || 0) >= WANT.fw) continue;
      out.push({ key: `esp:${who}`, name: `ESP32 „${who}“`, have: d.fw ? `Stand ${d.fw}` : "älter", want: `Stand ${WANT.fw}`, how: "Schritt 3 der Update-Anleitung" });
    }
  }
  return out;
}
