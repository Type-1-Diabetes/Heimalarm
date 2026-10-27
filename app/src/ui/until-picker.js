// Auswahl „bis wann?“ für Nicht verfügbar / Abwesend.
// Aufbau wie bei Status-Apps (Slack, Teams): oben Schnellwahl, darunter Kalender und Uhrzeit für alles andere.
// Uhrzeit als Ziffernfeld (siehe timeField in dom.js), damit am Handy die Tastatur kommt.
import { h } from "./dom.js";
import { dialog } from "./form.js";
import { icon } from "./icons.js";
import { MODES, untilText } from "../core/readiness.js";

const at = (days, hh, mm = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hh, mm, 0, 0); return d.getTime(); };
const inHours = (n) => { const d = new Date(Date.now() + n * 3600e3); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); return d.getTime(); };
const nextWeekday = (wd, hh) => { const d = new Date(); d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7 || 7)); d.setHours(hh, 0, 0, 0); return d.getTime(); };

function presets(mode) {
  const now = new Date();
  if (mode === "away") return [
    ["1 Stunde", inHours(1)],
    ["4 Stunden", inHours(4)],
    now.getHours() < 17 ? ["Heute 17:00", at(0, 17)] : ["Heute 22:00", at(0, 22)],
    ["Morgen 07:00", at(1, 7)],
  ];
  return [
    ["Morgen", at(1, 7)],
    ["Montag", nextWeekday(1, 7)],
    ["1 Woche", at(7, 7)],
    ["2 Wochen", at(14, 7)],
  ];
}

const WEEK = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const pad = (n) => String(n).padStart(2, "0");

/** Öffnet die Auswahl. Ergebnis: Zeitpunkt in ms oder null (abgebrochen). */
export function pickUntil(mode, current) {
  return new Promise((resolve) => {
    const start = new Date(current && current > Date.now() ? current : presets(mode)[mode === "away" ? 2 : 0][1]);
    let day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    let month = new Date(day.getFullYear(), day.getMonth(), 1);
    const time = h("input.input.mono", { type: "time", step: 300, value: `${pad(start.getHours())}:${pad(start.getMinutes())}`, "aria-label": "Uhrzeit" });
    const grid = h("div.cal-grid", { role: "grid" });
    const head = h("b.cal-month", {});
    const summary = h("p.until-sum", { "aria-live": "polite" });
    const ok = h("button.btn.primary", { type: "button" }, "Übernehmen");
    let done = false;

    const value = () => {
      const [hh, mm] = (/^\d\d:\d\d$/.test(time.value) ? time.value : "07:00").split(":").map(Number);
      return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm).getTime();
    };
    const update = () => {
      const v = value(), valid = v > Date.now();
      summary.textContent = valid ? `Wieder verfügbar ${untilText(v).replace(/^bis /, "am ").replace(/^am (\d\d:)/, "um $1").replace(/^am morgen/, "morgen um")}` : "Der Zeitpunkt liegt in der Vergangenheit.";
      summary.classList.toggle("bad", !valid);
      ok.disabled = !valid;
      for (const b of grid.querySelectorAll("button")) b.setAttribute("aria-pressed", String(Number(b.dataset.t) === day.getTime()));
    };
    const drawMonth = () => {
      head.textContent = month.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const first = (month.getDay() + 6) % 7;            // Montag zuerst
      const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      grid.replaceChildren(...WEEK.map((w) => h("span.cal-wd", {}, w)),
        ...Array.from({ length: first }, () => h("span")),
        ...Array.from({ length: days }, (_, i) => {
          const d = new Date(month.getFullYear(), month.getMonth(), i + 1);
          return h("button.cal-day" + (d.getTime() === today.getTime() ? ".today" : ""), {
            type: "button", "data-t": d.getTime(), disabled: d < today, "aria-label": d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }),
            onclick: () => { day = d; update(); },
          }, String(i + 1));
        }));
      update();
    };
    const step = (n) => { month = new Date(month.getFullYear(), month.getMonth() + n, 1); drawMonth(); };
    time.addEventListener("input", update);

    const chips = h("div.until-presets", {}, presets(mode).map(([label, t]) => h("button.btn.small", {
      type: "button", onclick: () => { finish(t); },
    }, label)));

    const finish = (t) => { done = true; close(); resolve(t); };
    ok.addEventListener("click", () => finish(value()));

    const close = dialog(`${MODES[mode].label} – bis wann?`,
      h("p.hint", {}, "Danach schaltet Heimalarm von selbst wieder auf „Verfügbar“."),
      chips,
      h("div.until-pick", {},
        h("div.cal", {},
          h("div.cal-head", {},
            h("button.btn.ghost.cal-nav", { type: "button", "aria-label": "Voriger Monat", onclick: () => step(-1) }, icon("back")),
            head,
            h("button.btn.ghost.cal-nav", { type: "button", "aria-label": "Nächster Monat", onclick: () => step(1) }, icon("chev"))),
          grid),
        h("label.until-time", {}, h("span", {}, "Uhrzeit"), time)),
      summary,
      h("div.row.end", {},
        h("button.btn", { type: "button", onclick: () => close() }, "Abbrechen"),
        ok));
    drawMonth();
    // Schließen über ✕, Esc oder Klick daneben = abbrechen
    const obs = new MutationObserver(() => { if (!document.body.contains(grid)) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe(document.body, { childList: true });
  });
}
