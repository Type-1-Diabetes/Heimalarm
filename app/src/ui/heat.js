// Bedienung eines Heizkörperthermostats: Ist-Wert, Sollwert in halben Grad (− / +), Aus.
// Gemeinsam für Zigbee-, Matter- und WLAN-Thermostate (FRITZ!, Shelly BLU).
import { h } from "./dom.js";
import { HEAT_MIN, HEAT_MAX } from "../core/wifi.js";

export const fmtTemp = (t) => (t == null || Number.isNaN(Number(t)) ? "–" : `${Number(t).toFixed(1).replace(".", ",")} °C`);

/**
 * @param {{ temp?: number, current?: number, off?: boolean, battery?: number }} s  aktueller Zustand
 * @param {(t: number) => void} onSet  neuer Sollwert (nach kurzer Pause, damit mehrere Klicks ein Befehl werden)
 * @param {(() => void) | null} onOff  Heizung aus (null = Gerät kennt kein „Aus“)
 */
export function heatControl(s, onSet, onOff) {
  let temp = s.temp ?? 20, timer = null;
  const out = h("output.heat-value", { "aria-live": "polite" }, s.off ? "Aus" : fmtTemp(temp));
  const step = (d) => {
    temp = Math.max(HEAT_MIN, Math.min(HEAT_MAX, Math.round((temp + d) * 2) / 2));
    out.textContent = fmtTemp(temp);
    root.classList.remove("is-off");
    clearTimeout(timer);
    timer = setTimeout(() => onSet(temp), 700);
  };
  const root = h("div.heat" + (s.off ? ".is-off" : ""), {},
    h("div.heat-now", {},
      h("span.meta", {}, "Raum"),
      h("b.heat-current", {}, fmtTemp(s.current)),
      s.battery != null && h("span.meta", {}, `Batterie ${s.battery} %`)),
    h("div.heat-set", { role: "group", "aria-label": "Solltemperatur" },
      h("button.btn.heat-step", { onclick: () => step(-0.5), "aria-label": "Kälter" }, "−"),
      out,
      h("button.btn.heat-step", { onclick: () => step(0.5), "aria-label": "Wärmer" }, "+"),
      onOff && h("button.btn.small.ghost", { onclick: () => { clearTimeout(timer); out.textContent = "Aus"; root.classList.add("is-off"); onOff(); } }, "Aus")));
  return root;
}
