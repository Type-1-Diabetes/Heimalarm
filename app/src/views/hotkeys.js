// Einstellungen → Vor dem Ruhezustand („Vor dem Ruhezustand speichern“).
// Je Programm eine Tastenkombination. Programme wählt man aus den gerade offenen Fenstern (Suchliste),
// die Tasten nimmt man einfach auf.
import { h, toast } from "../ui/dom.js";
import { section, toggle, field } from "../ui/form.js";
import { settings, set } from "../core/settings.js";
import { newId } from "../core/shared.js";
import { KNOWN, STATUS, prettyKeys, listWindows, sendHotkey } from "../core/hotkeys.js";
import { icon } from "../ui/icons.js";

const rules = () => settings().pc.hotkeys.rules || [];
const saveRules = (list) => set("pc.hotkeys.rules", list);
const updateRule = (id, patch) => saveRules(rules().map((r) => (r.id === id ? { ...r, ...patch } : r)));
const nameOf = (exe) => { const stem = exe.replace(/\.exe$/u, ""); return KNOWN[exe]?.name || stem.charAt(0).toUpperCase() + stem.slice(1); };

const kbd = (keys) => !keys ? h("span.keys-none", {}, "Tasten wählen") : h("span.keys", { "aria-label": prettyKeys(keys).join(" plus ") },
  ...prettyKeys(keys).flatMap((k, i) => [i ? h("span.keys-plus", { "aria-hidden": "true" }, "+") : null, h("kbd", {}, k)]));

/* ── Tasten aufnehmen ─────────────────────────── */
const CODE = { Enter: "Enter", Escape: "Esc", Space: "Space", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
function comboFrom(e) {
  let main = "";
  if (/^Key[A-Z]$/u.test(e.code)) main = e.code.slice(3);
  else if (/^Digit\d$/u.test(e.code)) main = e.code.slice(5);
  else if (/^F\d{1,2}$/u.test(e.code)) main = e.code;
  else main = CODE[e.code] || "";
  if (!main) return null;   // nur Umschalt/Strg gedrückt – weiter warten
  return [e.ctrlKey && "Ctrl", e.shiftKey && "Shift", e.altKey && "Alt", e.metaKey && "Win", main].filter(Boolean).join("+");
}

function recorder(rule, onDone) {
  const box = h("button.keys-rec", { type: "button", "aria-label": "Tastenkombination aufnehmen" });
  let rec = false;
  const paint = () => box.replaceChildren(rec ? h("span.rec-hint", {}, h("span.rec-dot"), "Jetzt Tasten drücken … (Esc = abbrechen)") : kbd(rule.keys));
  const stop = () => { rec = false; box.classList.remove("on"); window.removeEventListener("keydown", onKey, true); paint(); };
  const onKey = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape" && !e.ctrlKey && !e.shiftKey && !e.altKey) return stop();
    const c = comboFrom(e);
    if (!c) return;
    if (!/\+/u.test(c) && !/^F\d/u.test(c)) { toast("Bitte mit Strg, Alt oder Umschalt – sonst tippst du Buchstaben ins Programm"); return; }
    rule.keys = c; stop(); onDone(c);
  };
  box.addEventListener("click", () => { if (rec) return stop(); rec = true; box.classList.add("on"); window.addEventListener("keydown", onKey, true); paint(); });
  box.addEventListener("blur", () => rec && stop());
  paint();
  return box;
}

/* ── Programm wählen: Suchliste der offenen Fenster ── */
function appPicker({ onPick, onClose, taken }) {
  let items = [], q = "", active = 0, loading = true, failed = "";
  const input = h("input.input.picker-search", { type: "search", placeholder: "Programm suchen …", autocomplete: "off", spellcheck: "false",
    role: "combobox", "aria-expanded": "true", "aria-controls": "hk-list", "aria-autocomplete": "list" });
  const list = h("ul.picker-list", { id: "hk-list", role: "listbox", "aria-label": "Offene Programme" });
  const wrap = h("div.picker", {}, h("label.search.picker-field", {}, icon("search"), input), list,
    h("p.picker-foot", {}, "Zeigt Programme mit offenem Fenster. Nicht dabei? Programm öffnen und ", h("button.link-btn", { type: "button", onclick: () => load() }, "neu laden"), "."));

  const rows = () => {
    const norm = q.trim().toLowerCase();
    const open = items.filter((w) => !norm || `${w.exe} ${w.title} ${nameOf(w.exe, w.title)}`.toLowerCase().includes(norm));
    const known = Object.entries(KNOWN).filter(([exe, k]) => !items.some((w) => w.exe === exe) && (!norm || `${exe} ${k.name}`.toLowerCase().includes(norm)))
      .map(([exe]) => ({ exe, title: "", known: true }));
    const custom = norm && /^[\w .+-]+$/u.test(norm) && ![...open, ...known].some((w) => w.exe === norm || w.exe === `${norm}.exe`)
      ? [{ exe: norm.endsWith(".exe") ? norm : `${norm}.exe`, title: "", custom: true }] : [];
    return { open, known, custom, all: [...open, ...known, ...custom] };
  };
  const option = (w, i) => {
    const used = taken.includes(w.exe);
    const hint = KNOWN[w.exe]?.keys ? prettyKeys(KNOWN[w.exe].keys).join("+") : "";
    return h("li.picker-opt" + (i === active ? ".active" : "") + (used ? ".used" : ""), {
      id: `hk-opt-${i}`, role: "option", "aria-selected": String(i === active), "aria-disabled": used ? "true" : null,
      onmousedown: (e) => e.preventDefault(), onmouseenter: () => { active = i; mark(); }, onclick: () => !used && onPick(w),
    },
    h("span.picker-badge", { "aria-hidden": "true" }, nameOf(w.exe, w.title).slice(0, 1).toUpperCase()),
    h("span.picker-text", {},
      h("b", {}, w.custom ? `„${w.exe}“ verwenden` : nameOf(w.exe, w.title)),
      h("small", {}, w.custom ? "Eigener Programmname – muss genau stimmen" : w.known ? `${w.exe} · gerade nicht offen` : `${w.exe}${w.title ? " · " + w.title : ""}`)),
    used ? h("span.chip", {}, "schon drin") : w.elevated ? h("span.chip.warn", { title: STATUS.elevated }, "Admin") : hint && h("span.picker-hint", {}, hint));
  };
  const group = (label, arr, offset) => arr.length ? [h("li.picker-group", { role: "presentation" }, label), ...arr.map((w, i) => option(w, i + offset))] : [];
  const mark = () => list.querySelectorAll(".picker-opt").forEach((el) => {
    const on = el.id === `hk-opt-${active}`;
    el.classList.toggle("active", on); el.setAttribute("aria-selected", String(on));
    if (on) { input.setAttribute("aria-activedescendant", el.id); el.scrollIntoView({ block: "nearest" }); }
  });
  const paint = () => {
    if (loading) return list.replaceChildren(h("li.picker-empty", {}, "Suche offene Programme …"));
    if (failed) return list.replaceChildren(h("li.picker-empty", {}, failed));
    const r = rows();
    active = Math.min(active, Math.max(0, r.all.length - 1));
    while (active < r.all.length - 1 && taken.includes(r.all[active].exe)) active++;   // „schon drin“ überspringen
    list.replaceChildren(...group("Gerade offen", r.open, 0), ...group("Bekannte Programme", r.known, r.open.length),
      ...group("Eigenes", r.custom, r.open.length + r.known.length),
      r.all.length ? null : h("li.picker-empty", {}, "Nichts gefunden. Den Programmnamen eintippen, z. B. „blender“."));
    mark();
  };
  input.addEventListener("input", () => { q = input.value; active = 0; paint(); });
  input.addEventListener("keydown", (e) => {
    const all = rows().all;
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(all.length - 1, active + 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
    else if (e.key === "Enter") { e.preventDefault(); const w = all[active]; if (w && !taken.includes(w.exe)) onPick(w); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  });
  const load = async () => {
    loading = true; failed = ""; paint();
    try { items = await listWindows(); } catch (e) { failed = `Programme nicht lesbar: ${e}`; }
    loading = false; paint();
  };
  load();
  queueMicrotask(() => input.focus());
  return wrap;
}

/* ── Abschnitt ─────────────────────────────── */
async function test(r, btn) {
  btn.disabled = true;
  toast(`${r.name}: kommt gleich nach vorn …`);
  try {
    const res = await sendHotkey(r.exe, r.keys);
    toast(res.status === "sent" ? `${r.name}: ${prettyKeys(r.keys).join("+")} gesendet` : `${r.name} ${STATUS[res.status] || res.status}`);
  } catch (e) { toast(String(e)); }
  btn.disabled = false;
}

export function hotkeySection(rerender) {
  const hk = settings().pc.hotkeys;
  let picking = false;
  const body = h("div.hk");


  const ruleRow = (r) => h("li.hk-rule" + (r.on === false ? ".off" : ""), {},
    h("span.picker-badge", { "aria-hidden": "true" }, (r.name || r.exe).slice(0, 1).toUpperCase()),
    h("div.hk-name", {}, h("b", {}, r.name || r.exe), h("small", {}, r.exe)),
    recorder(r, (keys) => { updateRule(r.id, { keys }); toast(`${r.name}: ${prettyKeys(keys).join("+")}`); }),
    h("div.hk-actions", {},
      h("button.btn.small.ghost", { type: "button", onclick: (e) => test(r, e.currentTarget) }, "Testen"),
      h("label.mini-switch", { title: r.on === false ? "Aus" : "An" },
        h("input", { type: "checkbox", role: "switch", checked: r.on !== false, "aria-label": `${r.name} an/aus`, onchange: (e) => { updateRule(r.id, { on: e.target.checked }); paint(); } })),
      h("button.btn.small.ghost.danger.icon", { type: "button", "aria-label": `${r.name} entfernen`, title: "Entfernen", onclick: () => { saveRules(rules().filter((x) => x.id !== r.id)); paint(); } }, icon("x"))));

  const paint = () => {
    const list = rules();
    body.replaceChildren(
      list.length
        ? h("ul.hk-list", {}, list.map(ruleRow))
        : h("div.hk-empty", {}, h("b", {}, "Noch kein Programm"), h("span", {}, "Füge z. B. Blender hinzu – Heimalarm drückt dann Strg + S, bevor der PC schläft.")),
      picking
        ? appPicker({
          taken: list.map((r) => r.exe),
          onClose: () => { picking = false; paint(); },
          onPick: (w) => {
            const rule = { id: newId(), exe: w.exe, name: nameOf(w.exe, w.title), keys: KNOWN[w.exe] ? KNOWN[w.exe].keys : "Ctrl+S", on: true };
            saveRules([...rules(), rule]); picking = false; paint();
            toast(rule.keys ? `${rule.name} hinzugefügt – Taste mit Klick auf ${prettyKeys(rule.keys).join("+")} ändern` : `${rule.name} hinzugefügt – jetzt auf „Tasten wählen“ klicken`);
          },
        })
        : h("div.row", {}, h("button.btn.small", { type: "button", onclick: () => { picking = true; paint(); } }, "+ Programm hinzufügen")));
  };
  paint();

  return section("hotkeys", "Vor dem Ruhezustand speichern", "Heimalarm holt jedes Programm kurz nach vorn und drückt die Tasten, als würdest du es selbst tun. Danach geht der PC in die gewählte Aktion.",
    toggle("pc.hotkeys.enabled", "Tasten an Programme senden", "Nur nach „Ich fahre“ oder ohne Antwort, nicht beim Testalarm.", () => rerender()),
    hk.enabled && body,
    hk.enabled && field("Danach warten (Sekunden)", h("input.input", { type: "number", min: 0, max: 30, value: hk.waitSec,
      onchange: (e) => set("pc.hotkeys.waitSec", Math.min(30, Math.max(0, Number(e.target.value) || 0))) }), "Zeit zum Speichern, bevor der PC schläft. Große Blender-Dateien brauchen eher 5 s."),
    hk.enabled && h("details.group", {}, h("summary.group-title", {}, "Gut zu wissen"),
      h("ul.hk-notes", {},
        h("li", {}, "Noch nie gespeicherte Dateien öffnen bei Strg + S „Speichern unter“ – der Dialog bleibt dann offen."),
        h("li", {}, "Programme, die als Administrator laufen, nehmen keine Tasten von Heimalarm an. Sie sind in der Liste markiert."),
        h("li", {}, "Bei „Nichts tun“ als PC-Aktion wird nichts gesendet."),
        h("li", {}, "Ein laufendes Blender-Rendering wird nicht abgebrochen, nur die Szene gespeichert."))),
  );
}
