// I4 – Automatischer Selbsttest: prüft ESP32, Apps, Zigbee und veröffentlicht einen Bericht
// retained auf heimalarm/report. Wann und was geprüft wird, steht in shared.selftest
// { enabled, days:[1..7] (1 = Montag), at:"HH:MM", esp, apps, zigbee } – Standard: sonntags 10:00, alles.
export const SELFTEST_DEFAULTS = { enabled: true, days: [7], at: "10:00", esp: true, apps: true, zigbee: true };

export function startSelftest(ctx, log) {
  const cfg = () => ({ ...SELFTEST_DEFAULTS, ...ctx.config.selftest });
  const run = (why) => {
    const c = cfg();
    const esp = Object.entries(ctx.esp).map(([who, s]) => ({ name: `ESP32 ${who}`, ok: s.online }));
    const apps = Object.values(ctx.clients).filter((x) => x.online).length;
    const checks = [
      { name: "Zentrale-Dienst", ok: true },
      ...(c.esp ? (esp.length ? esp : [{ name: "ESP32", ok: false, hint: "kein ESP32 gemeldet" }]) : []),
      ...(c.apps ? [{ name: "Apps verbunden", ok: apps > 0, hint: `${apps} online` }] : []),
      // Zigbee nur prüfen, wenn Zigbee2MQTT schon einmal da war – sonst ist es nicht eingerichtet
      ...(c.zigbee && ctx.bridge ? [{ name: "Zigbee2MQTT", ok: ctx.bridge === "online", hint: String(ctx.bridge) }] : []),
    ];
    const report = { ts: Date.now(), ok: checks.every((x) => x.ok), checks, manual: why === "manual" };
    ctx.client.publish("heimalarm/report", JSON.stringify(report), { retain: true, qos: 1 });
    (report.ok ? log.ok : log.warn)(why === "manual" ? "Selbsttest" : "Automatischer Selbsttest", report.ok ? "alles in Ordnung" : checks.filter((x) => !x.ok).map((x) => x.name).join(", "));
  };
  let lastRun = "";
  setInterval(() => {
    const c = cfg();
    if (!c.enabled) return;
    const d = new Date();
    const day = ((d.getDay() + 6) % 7) + 1; // 1 = Montag
    const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const key = `${d.toDateString()} ${hhmm}`;
    if (hhmm === c.at && (c.days || []).includes(day) && key !== lastRun) { lastRun = key; run("auto"); }
  }, 30e3);
  ctx.client.on("message", (topic) => { if (topic === "heimalarm/cmd/selftest") run("manual"); });
}
