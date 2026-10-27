// Einstellungen → Discord: Rich Presence „Im Einsatz“ (nur Windows).
// Oben die Einrichtung in 3 Schritten, daneben die Live-Vorschau, darunter alle Optionen.
import { h, toast } from "../ui/dom.js";
import { field, toggle, segmented, select, section, copyText } from "../ui/form.js";
import { settings, set, get } from "../core/settings.js";
import { templateField, SAMPLE } from "../ui/template.js";
import { icon } from "../ui/icons.js";
import { discord, buildActivity, testPresence, endPresence, checkDiscord, applyPreset, PRESETS, ACTIVITY_TYPES } from "../core/discord.js";
import { on } from "../core/events.js";

const PORTAL = "https://discord.com/developers/applications";
const VERB = Object.fromEntries(ACTIVITY_TYPES);
const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); const hrs = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${hrs ? hrs + ":" : ""}${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`; };
const until = (ts) => new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const isImg = (v) => String(v || "").trim().startsWith("https://");
const pic = (v) => h("img", { src: v.trim(), alt: "", referrerpolicy: "no-referrer" });

let watching = false, redraw = () => {};

/** So sieht es im Discord-Profil aus. */
function preview(c) {
  const a = buildActivity(c, SAMPLE, Date.now() - 12 * 60e3);
  const name = c.appName?.trim() || "Feuerwehr";
  const timeText = c.timer === "since" ? `${clock(12 * 60e3)} vergangen` : c.timer === "remaining" ? `${clock((Number(c.durationMin) || 90) * 60e3 - 12 * 60e3)} übrig` : "";
  return h("div.rp", { "aria-label": "Vorschau: so sehen deine Freunde den Status" },
    h("div.rp-kind", {}, `${VERB[a.type] || "Spielt"}`),
    h("div.rp-main", {},
      h("div.rp-art", {},
        h("div.rp-large", {}, isImg(c.largeImage) ? pic(c.largeImage) : icon("home")),
        c.smallImage?.trim() && h("div.rp-small", {}, isImg(c.smallImage) ? pic(c.smallImage) : null)),
      h("div.rp-lines", {},
        h("div.rp-name", {}, name),
        a.details && h("div", {}, a.details),
        a.state && h("div.rp-mute", {}, a.state),
        timeText && h("div.rp-time", {}, timeText))),
    a.buttons?.length && h("div.rp-btns", {}, a.buttons.map((b) => h("div.rp-btn", {}, b.label))),
    h("div.rp-list", {}, h("span.rp-dot"), h("span.rp-mute", {}, "Mitgliederliste: "),
      h("span", {}, `${VERB[a.type] || "Spielt"} `, h("b", {}, a.status_display_type === 2 ? a.details : a.status_display_type === 1 ? a.state : name))));
}

function step(done, now, title, ...body) {
  return h("li.gstep" + (done ? ".done" : now ? ".now" : ""), {},
    h("span.gstep-no", { "aria-hidden": "true" }, done ? icon("check") : null),
    h("div.gstep-body", {}, h("b", {}, title), ...body.flat().filter(Boolean)));
}

export function discordSection(rerender) {
  const c = settings().discord;
  redraw = rerender;
  if (!watching) { watching = true; on("discord", () => document.getElementById("discord") && redraw()); }
  if (discord.running === null) checkDiscord();

  const idOk = /^\d{17,20}$/u.test(c.clientId || "");
  const tested = discord.ok === true;
  const ready = idOk && tested;
  const card = h("div.rp-wrap");
  const paint = () => card.replaceChildren(preview(settings().discord), h("small.meta", {}, "Beispiel-Einsatz · so sehen es deine Freunde im Profil und in der Mitgliederliste."));
  paint();
  const setP = (k, v) => { set(`discord.${k}`, v); paint(); };
  const tpl = (k, label, opts = {}) => templateField(label, c[k] || "", (v) => setP(k, v.trim()), { maxlength: 128, keys: ["stichwort", "einheit", "adresse", "uhrzeit", "quelle"], ...opts });

  const statusChip = discord.running === null ? h("span.chip", {}, "prüfe …")
    : !discord.running ? h("span.chip.warn", {}, "Discord nicht gefunden")
    : discord.ok === false ? h("span.chip.bad", {}, "Fehler")
    : h("span.chip.ok", {}, "Discord läuft");

  const test = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await testPresence({ ...SAMPLE, ts: Date.now() }); toast("Vorschau ist 60 Sekunden in Discord zu sehen"); }
    catch (err) { toast(String(err.message || err)); }
    b.disabled = false; rerender();
  };

  const active = discord.active && discord.active.end > Date.now() ? discord.active : null;

  // ── Einrichtung ──
  const setup = h("ol.guide", {},
    step(Boolean(c.appName?.trim()) || idOk, !idOk, "Discord-App anlegen",
      h("p", {}, "Ihr Name steht später im Profil, z. B. „Spielt Feuerwehr“. Kostenlos, dauert eine Minute."),
      h("ol", {},
        h("li", {}, "Entwicklerportal öffnen und anmelden."),
        h("li", {}, "„New Application“ wählen, Namen eingeben, Bedingungen bestätigen.")),
      h("div.inline", {},
        field("Name der App", h("input.input", { value: c.appName || "", placeholder: "z. B. Feuerwehr", maxlength: 32,
          onchange: (e) => { setP("appName", e.target.value.trim()); } }), "Gleicher Name wie im Portal – nur für die Vorschau hier."),
        h("button.btn.small.ghost", { type: "button", onclick: () => copyText(c.appName?.trim() || "Feuerwehr").then(() => toast("Name kopiert")) }, "Kopieren")),
      h("div.row", {}, h("a.btn.small", { href: PORTAL, target: "_blank", rel: "noopener" }, "Entwicklerportal öffnen"))),
    step(idOk, !idOk && Boolean(c.appName), "Application-ID einfügen",
      h("p", {}, "Im Portal unter ", h("b", {}, "General Information → Application ID"), " auf „Copy“ klicken."),
      field("Application-ID", h("input.input", { value: c.clientId || "", inputmode: "numeric", autocomplete: "off", spellcheck: "false", placeholder: "18–20 Ziffern",
        onchange: (e) => { set("discord.clientId", e.target.value.replace(/\D/gu, "")); discord.ok = null; rerender(); } }),
        c.clientId && !idOk ? "Das sieht nicht nach einer ID aus – nur Ziffern, meist 18 oder 19." : "Kein Geheimnis, bleibt auf diesem PC.")),
    step(tested, idOk && !tested, "Ausprobieren",
      h("p", {}, "Discord muss am PC laufen (Programm, nicht im Browser). Unter ", h("b", {}, "Discord → Einstellungen → Aktivitäts-Privatsphäre"), " muss „Aktivitätsstatus teilen“ an sein."),
      h("div.row.rp-status", {}, statusChip,
        h("button.btn.small" + (idOk && !tested ? ".primary" : ""), { type: "button", disabled: !idOk, onclick: test }, "Vorschau senden (60 s)"),
        h("button.btn.small.ghost", { type: "button", onclick: () => { discord.running = null; checkDiscord(); } }, "Erneut prüfen")),
      discord.ok === false && discord.error && h("p.meta.err", {}, discord.error)));

  const setupBlock = ready
    ? h("details.group", {}, h("summary.group-title", {}, "Einrichtung erledigt – anzeigen"), setup)
    : h("div.group", {}, h("h3.group-title", {}, "In 3 Schritten startklar"), setup);

  const presetNow = Object.entries(PRESETS).find(([, p]) => p.details === c.details && p.state === c.state && p.timer === c.timer)?.[0] || "eigen";

  return section("discord", "Discord-Status", "Zeigt Freunden bei Alarm „Im Einsatz“ in Discord. Läuft lokal, ohne Bot und ohne Passwort.",
    h("div.rp-top", {},
      h("div", {},
        toggle("discord.enabled", "Bei Alarm in Discord anzeigen", ready ? "Nur bei deinen eigenen Alarmen." : "Erst die Einrichtung unten abschließen.", () => rerender()),
        active && h("div.banner", {}, h("div", {},
          h("b", {}, active.test ? "Vorschau läuft" : "Status „Im Einsatz“ ist aktiv"),
          `Bis ${until(active.end)} Uhr – danach verschwindet er von selbst.`,
          h("div.row", { style: "margin-top:8px" }, h("button.btn.small", { type: "button", onclick: () => endPresence("von Hand").then(rerender) }, "Jetzt beenden"))))),
      card),
    setupBlock,

    h("div.group", {}, h("h3.group-title", {}, "Was angezeigt wird"),
      h("div.field", {}, h("span", {}, "Vorlage"),
        segmented([...Object.entries(PRESETS).map(([k, p]) => [k, p.label]), ["eigen", "Eigene"]], presetNow, (v) => { if (v !== "eigen") { applyPreset(v); rerender(); } }),
        h("small", {}, presetNow === "eigen" ? "Eigene Texte – unten frei anpassen." : PRESETS[presetNow].hint)),
      field("In der Mitgliederliste", select([[2, "Zeile 1 (z. B. „Im Einsatz“)"], [1, "Zeile 2 (z. B. Stichwort)"], [0, "Name der App"]], c.listShows ?? 2, (v) => setP("listShows", Number(v))), "Kurztext neben deinem Namen in Servern und Freundesliste."),
      field("Art", select(ACTIVITY_TYPES.map(([k, l]) => [k, `${l} …`]), c.type, (v) => setP("type", Number(v))), "Das Wort über dem Namen. Der Name selbst kommt aus dem Entwicklerportal."),
      tpl("details", "Zeile 1", { placeholder: "z. B. Im Einsatz", hint: "Leer = Zeile weglassen." }),
      tpl("state", "Zeile 2", { placeholder: "z. B. {stichwort}", hint: "Achtung: Stichwort und Adresse sehen alle, die dein Profil sehen." })),

    h("div.group", {}, h("h3.group-title", {}, "Zeit"),
      h("div.field", {}, h("span", {}, "Anzeige"),
        segmented([["since", "Seit Alarm"], ["remaining", "Restzeit"], ["none", "Keine"]], c.timer, (v) => setP("timer", v))),
      field("Status bleibt (Minuten)", h("input.input", { type: "number", min: 5, max: 720, value: c.durationMin,
        onchange: (e) => setP("durationMin", Math.min(720, Math.max(5, Number(e.target.value) || 90))) }), "Danach verschwindet er automatisch. „Restzeit“ zählt bis dahin herunter.")),

    h("div.group", {}, h("h3.group-title", {}, "Wann"),
      h("div.field", {}, h("span", {}, "Anzeigen"),
        segmented([["alarm", "Sofort bei Alarm"], ["go", "Erst bei „Ich fahre“"]], c.start, (v) => setP("start", v)),
        h("small", {}, c.start === "go" ? "Erst nach deiner Antwort im Fenster „Fährst du?“." : "Schon während „Fährst du?“ noch läuft.")),
      h("div.field", {}, h("span", {}, "Bei „Ich fahre nicht“"),
        segmented([["clear", "Entfernen"], ["keep", "Stehen lassen"]], c.onStay, (v) => setP("onStay", v))),
      toggle("discord.clearOnRestore", "„Einsatz beenden“ entfernt den Status", "Knopf in der Übersicht."),
      toggle("discord.resume", "Nach dem Ruhezustand wieder anzeigen", "Im Ruhezustand ist auch Discord aus, Freunde sehen dich dann offline. Wacht der PC vor Ablauf auf, erscheint der Status wieder."),
      toggle("discord.tests", "Auch bei Testalarm", "Sonst nur echte Alarme und Generalprobe.")),

    h("details.group", {}, h("summary.group-title", {}, "Bilder (optional)"),
      h("p.meta", {}, "Ohne Bild zeigt Discord nur Text. Bild im Portal unter ", h("b", {}, "Rich Presence → Art Assets"), " hochladen (mind. 512 × 512 px) und hier den Namen eintragen – oder direkt eine https-Adresse."),
      h("div.img-pair", {},
        h("div.item", {}, h("b", {}, "Großes Bild"),
          field("Name oder Adresse", h("input.input", { value: c.largeImage || "", placeholder: "z. B. feuerwehr", spellcheck: "false", onchange: (e) => setP("largeImage", e.target.value.trim()) })),
          tpl("largeText", "Text beim Drüberfahren", { placeholder: "z. B. Heimalarm" })),
        h("div.item", {}, h("b", {}, "Kleines Bild"),
          field("Name oder Adresse", h("input.input", { value: c.smallImage || "", placeholder: "z. B. blaulicht", spellcheck: "false", onchange: (e) => setP("smallImage", e.target.value.trim()) })),
          tpl("smallText", "Text beim Drüberfahren", { placeholder: "z. B. {einheit}" })))),

    h("details.group", {}, h("summary.group-title", {}, "Knöpfe (optional)"),
      h("p.meta", {}, "Bis zu zwei Links unter dem Status, z. B. zur Website eurer Wehr. Nur andere sehen sie, du selbst nicht."),
      ...[0, 1].map((i) => {
        const b = (c.buttons || [])[i] || { label: "", url: "" };
        const save = (patch) => { const list = structuredClone(get("discord.buttons") || [{}, {}]); list[i] = { ...b, ...patch }; setP("buttons", list); };
        const bad = b.url && !/^https:\/\/\S+$/u.test(b.url);
        return h("div.fields", {},
          field(`Knopf ${i + 1}`, h("input.input", { value: b.label, maxlength: 32, placeholder: i ? "z. B. Mitglied werden" : "z. B. Unsere Wehr", onchange: (e) => save({ label: e.target.value }) })),
          field("Link", h("input.input", { value: b.url, type: "url", placeholder: "https://…", spellcheck: "false", onchange: (e) => { save({ url: e.target.value.trim() }); rerender(); } }), bad ? "Muss mit https:// beginnen." : null));
      })),
    h("p.meta", {}, "Daten bleiben auf diesem PC. Discord bekommt nur, was die Vorschau oben zeigt."),
  );
}
