// Alarmton wählen und testen – gleich für PC (pc.*) und Handy (phone.*).
// Zeigt auch die Lautstärke des Geräts (Windows bzw. „Wecker“ am Handy), damit klar ist, wie laut es wirklich wird.
import { h, toast } from "./dom.js";
import { field, select } from "./form.js";
import { settings, set } from "../core/settings.js";
import { hasPcFeatures } from "../core/platform.js";
import { playTone, stopTone, listTones, uploadTone, pickTone, deleteTone, deviceVolume, setDeviceVolume, canCustomTone } from "./sound.js";

const ADD = "__add__";
const TEST_MS = 4000;
let tones = null;        // Liste eigener Töne (einmal laden, nach Änderungen neu)
let volume = null;       // Geräte-Lautstärke { supported, level, muted }

/** Regler mit Prozentanzeige, die sich beim Ziehen sofort ändert; gespeichert wird beim Loslassen. */
export function percentSlider(labelText, value, onSave, { min = 0, max = 100, hint } = {}) {
  const out = h("output", {}, `${value} %`);
  return h("div.field", {},
    h("span", {}, labelText, " ", out),
    h("input.slider", {
      type: "range", min, max, step: 1, value, "aria-label": labelText,
      oninput: (e) => { out.textContent = `${e.target.value} %`; },
      onchange: (e) => onSave(Number(e.target.value)),
    }),
    hint && h("small", {}, hint));
}

/**
 * Bausteine für den Alarmton.
 * @param {"pc"|"phone"} key – Einstellungs-Bereich
 */
export function toneSettings(key, rerender) {
  const c = settings()[key];
  if (canCustomTone && tones === null) listTones().then((l) => { tones = l; rerender(); });
  if (volume === null) deviceVolume().then((v) => { volume = v; rerender(); });
  const list = tones || [];
  const known = !c.tone || list.some((t) => t.id === c.tone);
  const deviceName = hasPcFeatures ? "Windows-Lautstärke" : "Wecker-Lautstärke des Handys";

  const choose = async (v) => {
    if (v !== ADD) { set(`${key}.tone`, v); rerender(); return; }
    try {
      const added = hasPcFeatures ? await chooseFile() : await pickTone();
      if (!added) { rerender(); return; }
      const id = typeof added === "string" ? added : added.id;
      tones = null;
      set(`${key}.tone`, id);
      toast("Ton übernommen");
    } catch (e) { toast(String(e?.message || e)); }
    rerender();
  };

  let playing = false;
  const testBtn = h("button.btn.small", {
    type: "button",
    onclick: async () => {
      if (playing) { stopTone(); return reset(); }
      playing = true; testBtn.textContent = "Stopp";
      const s = settings()[key];
      await playTone({ tone: s.tone, volume: s.volume, ms: TEST_MS });
      setTimeout(reset, TEST_MS);
    },
  }, "Ton testen");
  const reset = () => { playing = false; testBtn.textContent = "Ton testen"; };

  const v = volume || {};
  return [
    field("Ton",
      h("div.row", {},
        select([["", "Melder-Ton (eingebaut)"], ...list.map((t) => [t.id, t.name]), ...(known ? [] : [[c.tone, "fehlt – Melder-Ton wird genutzt"]]), ...(canCustomTone ? [[ADD, "Eigenen Ton hinzufügen …"]] : [])],
          c.tone, choose, { style: "flex:1", "aria-label": "Alarmton" }),
        c.tone && canCustomTone && h("button.btn.small.ghost.danger", {
          type: "button",
          onclick: async () => {
            try { await deleteTone(c.tone); } catch { /* schon weg */ }
            tones = null; set(`${key}.tone`, ""); rerender();
          },
        }, "Entfernen")),
      canCustomTone ? "MP3, WAV, OGG oder FLAC. Der Ton bleibt nur auf diesem Gerät und wiederholt sich, bis jemand antwortet." : "Eigene Töne gehen im Programm auf PC und Handy."),
    percentSlider("Lautstärke Heimalarm", c.volume, (n) => set(`${key}.volume`, n),
      { min: 10, hint: "Anteil an der Geräte-Lautstärke darunter." }),
    v.supported && percentSlider(deviceName, v.level, async (n) => {
      try { await setDeviceVolume(n, false); volume = await deviceVolume(); rerender(); } catch (e) { toast(String(e)); }
    }, { hint: v.muted ? "Stumm geschaltet – Regler bewegen hebt das auf." : undefined }),
    v.supported && h("p.meta", {}, "Hörbar etwa ", h("b", {}, `${Math.round((c.volume * (v.muted ? 0 : v.level)) / 100)} %`), " der vollen Lautstärke."),
    h("div.row", {}, testBtn,
      h("button.btn.small.ghost", { type: "button", onclick: () => { volume = null; rerender(); } }, "Lautstärke neu lesen")),
  ];
}

/** PC: Dateiauswahl öffnen und Datei an den Rust-Kern geben. */
function chooseFile() {
  return new Promise((resolve, reject) => {
    const input = h("input", { type: "file", accept: "audio/mpeg,audio/wav,audio/ogg,audio/flac,.mp3,.wav,.ogg,.flac", style: "display:none" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      try { resolve(await uploadTone(file)); } catch (e) { reject(e); }
    });
    input.addEventListener("cancel", () => { input.remove(); resolve(null); });
    document.body.append(input);
    input.click();
  });
}
