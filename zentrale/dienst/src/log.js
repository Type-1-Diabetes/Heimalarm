// F5 – Zentralen-Protokoll: jede Meldung live auf heimalarm/log,
// die letzten 200 zusätzlich retained auf heimalarm/log/recent.
const MAX = 200;

export function createLog(client) {
  const recent = [];
  const write = (kind, text, detail = "") => {
    const e = { ts: Date.now(), kind, text, detail, origin: "Zentrale" };
    console.log(`[${new Date(e.ts).toISOString()}] ${kind.padEnd(6)} ${text}${detail ? " – " + detail : ""}`);
    recent.unshift(e);
    recent.length = Math.min(recent.length, MAX);
    client.publish("heimalarm/log", JSON.stringify(e));
    client.publish("heimalarm/log/recent", JSON.stringify(recent), { retain: true });
  };
  return {
    info: (t, d) => write("info", t, d),
    ok: (t, d) => write("ok", t, d),
    warn: (t, d) => write("warn", t, d),
    alarm: (t, d) => write("alarm", t, d),
    action: (t, d) => write("action", t, d),
  };
}
