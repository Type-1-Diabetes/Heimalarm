// Adressen wie „alarmgeber.local“ auflösen.
// Der Dienst läuft in Docker auf Alpine (musl): Dort kennt die normale Namensauflösung kein mDNS,
// fetch("http://name.local/…") scheitert mit „fetch failed“. Darum fragen wir selbst im Heimnetz nach
// (RFC 6762, „legacy unicast“: Anfrage von einem freien Port an 224.0.0.251:5353, Antwort kommt direkt zurück).
import { createSocket } from "node:dgram";

const cache = new Map();   // name -> { ip, at }
const TTL_MS = 60e3, TIMEOUT_MS = 1500;

function query(name) {
  const labels = name.split(".").filter(Boolean);
  const parts = [Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0])];   // id 0, eine Frage
  for (const l of labels) { const b = Buffer.from(l); parts.push(Buffer.from([b.length]), b); }
  parts.push(Buffer.from([0, 0, 1, 0, 1]));   // Ende, Typ A, Klasse IN
  return Buffer.concat(parts);
}

/** Name ab pos lesen (mit Komprimierung). Liefert [name, nächste Position]. */
function readName(buf, pos) {
  const out = [];
  let jumped = false, next = pos;
  for (let guard = 0; guard < 64; guard++) {
    const len = buf[pos];
    if (len === undefined) break;
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) next = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      jumped = true;
      continue;
    }
    if (len === 0) { if (!jumped) next = pos + 1; break; }
    out.push(buf.toString("utf8", pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  return [out.join(".").toLowerCase(), next];
}

/** IPv4 zu name aus einer mDNS-Antwort, sonst null. */
export function parseAnswer(buf, name) {
  if (buf.length < 12) return null;
  const qd = buf.readUInt16BE(4), an = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let pos = 12;
  for (let i = 0; i < qd; i++) pos = readName(buf, pos)[1] + 4;
  for (let i = 0; i < an && pos + 10 <= buf.length; i++) {
    const [n, p] = readName(buf, pos);
    const type = buf.readUInt16BE(p), len = buf.readUInt16BE(p + 8);
    if (type === 1 && len === 4 && n === name) return [...buf.subarray(p + 10, p + 14)].join(".");
    pos = p + 10 + len;
  }
  return null;
}

export function resolveLocal(name) {
  name = name.toLowerCase().replace(/\.$/u, "");
  const c = cache.get(name);
  if (c && Date.now() - c.at < TTL_MS) return Promise.resolve(c.ip);
  return new Promise((resolve, reject) => {
    const sock = createSocket({ type: "udp4", reuseAddr: true });
    let tries = 0, timer;
    const done = (err, ip) => { clearTimeout(timer); try { sock.close(); } catch { /* schon zu */ } err ? reject(err) : resolve(ip); };
    const send = () => {
      sock.send(query(name), 5353, "224.0.0.251", () => {});
      timer = setTimeout(() => (++tries < 3 ? send() : done(new Error(`${name} im Heimnetz nicht gefunden (mDNS) – IP-Adresse eintragen`))), TIMEOUT_MS);
    };
    sock.on("message", (msg) => {
      const ip = parseAnswer(msg, name);
      if (ip) { cache.set(name, { ip, at: Date.now() }); done(null, ip); }
    });
    sock.on("error", (e) => done(e));
    sock.bind(0, send);
  });
}

/** fetch, das „…local“-Hosts selbst auflöst. Alles andere geht unverändert an fetch. */
export async function localFetch(input, init) {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (!/\.local\.?$/iu.test(url.hostname)) return fetch(input, init);
  url.hostname = await resolveLocal(url.hostname);
  return fetch(url, init);
}
