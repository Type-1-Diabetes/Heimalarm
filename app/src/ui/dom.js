// Kleiner DOM-Helfer: h("div.card", {onclick}, kinder...)
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  const isTime = name === "input" && props?.type === "time";
  if (isTime) timeField(el);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false || (isTime && (k === "type" || k === "step"))) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className += " " + v;
    else if (k === "html") el.innerHTML = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

// Uhrzeit als Textfeld mit Zifferntastatur: Das native Zeitfeld öffnet in der Android-App
// weder Tastatur noch Zeitwähler. "2215" wird zu "22:15"; unfertige Eingaben erreichen die
// eigenen input/change-Handler nicht (dieser Listener läuft als erster).
function timeField(el) {
  Object.assign(el, { type: "text", inputMode: "numeric", maxLength: 5, placeholder: "HH:MM", autocomplete: "off" });
  const norm = (raw) => {
    const d = raw.replace(/\D/g, "").slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
  };
  const valid = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  el.addEventListener("input", (e) => {
    if (!e.inputType?.startsWith("delete")) el.value = norm(el.value);
    if (!valid(el.value)) e.stopImmediatePropagation();
  });
  el.addEventListener("change", (e) => { if (el.value && !valid(el.value)) e.stopImmediatePropagation(); });
  el.addEventListener("blur", () => { el.classList.toggle("bad", !!el.value && !valid(el.value)); });
  el.addEventListener("focus", () => el.select());
}

let toastTimer = 0;
export function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

export const fmtTime = (ts) => new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const fmtDate = (ts) => new Date(ts).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
export const fmtAgo = (ts) => {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "gerade eben";
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} h`;
  return fmtDate(ts);
};
