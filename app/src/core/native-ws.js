// WebSocket über den nativen Netzweg der App (Rust, tauri-plugin-websocket) statt über die WebView.
// Grund: In der Android-WebView bleibt ws:// zur Zentrale bei manchen Geräten stumm (kein Fehler, keine Antwort),
// obwohl der Port erreichbar ist. mqtt.js bekommt dieses Objekt über `createWebsocket` und behandelt es wie
// einen Browser-WebSocket (readyState, addEventListener, send, close, bufferedAmount).
// Nur ws:// (ohne TLS) – für wss:// bleibt die WebView zuständig.

const CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3;

export class NativeWebSocket {
  #ws = null;
  #queue = Promise.resolve();   // Sendereihenfolge sicher einhalten
  #listeners = { open: new Set(), message: new Set(), error: new Set(), close: new Set() };

  constructor(url, protocols = []) {
    Object.assign(this, { CONNECTING, OPEN, CLOSING, CLOSED });
    this.url = url;
    this.readyState = CONNECTING;
    this.binaryType = "arraybuffer";
    this.bufferedAmount = 0;
    this.protocol = protocols[0] || "";
    this.#open(url, protocols);
  }

  addEventListener(type, fn) { this.#listeners[type]?.add(fn); }
  removeEventListener(type, fn) { this.#listeners[type]?.delete(fn); }
  #emit(type, ev = {}) {
    this[`on${type}`]?.(ev);
    for (const fn of this.#listeners[type] || []) { try { fn(ev); } catch (e) { console.warn("native-ws", e); } }
  }

  async #open(url, protocols) {
    try {
      const { default: WS } = await import("@tauri-apps/plugin-websocket");
      // Mosquitto nimmt die Verbindung nur mit Unterprotokoll „mqtt“ an
      const ws = await WS.connect(url, protocols.length ? { headers: { "Sec-WebSocket-Protocol": protocols.join(", ") } } : undefined);
      if (this.readyState !== CONNECTING) { ws.disconnect().catch(() => {}); return; }   // inzwischen abgebrochen (Zeitüberschreitung)
      this.#ws = ws;
      ws.addListener((m) => this.#onMessage(m));
      this.readyState = OPEN;
      this.#emit("open");
    } catch (e) {
      if (this.readyState === CLOSED) return;
      this.#emit("error", { message: String(e?.message || e) });
      this.#finish(1006, String(e?.message || e));
    }
  }

  #onMessage(m) {
    if (this.readyState === CLOSED) return;
    if (m?.type === "Binary") this.#emit("message", { data: new Uint8Array(m.data).buffer });
    else if (m?.type === "Text") this.#emit("message", { data: m.data });
    else if (m?.type === "Ping" || m?.type === "Pong") return;
    else if (m?.type === "Close") this.#finish(m.data?.code ?? 1005, m.data?.reason || "");
    else { this.#emit("error", { message: String(m) }); this.#finish(1006, String(m)); }   // Lesefehler der Verbindung
  }

  send(chunk) {
    if (this.readyState !== OPEN) throw new Error("WebSocket ist nicht offen");
    const data = typeof chunk === "string" ? { type: "Text", data: chunk } : { type: "Binary", data: Array.from(chunk) };
    const size = data.data.length;
    this.bufferedAmount += size;
    this.#queue = this.#queue
      .then(() => this.#ws?.send(data))
      .catch((e) => { this.#emit("error", { message: String(e?.message || e) }); this.#finish(1006, String(e?.message || e)); })
      .finally(() => { this.bufferedAmount = Math.max(0, this.bufferedAmount - size); });
  }

  close() {
    if (this.readyState === CLOSED || this.readyState === CLOSING) return;
    const ws = this.#ws;
    this.readyState = CLOSING;
    if (ws) ws.disconnect().catch(() => {});
    this.#finish(1000, "");
  }

  #finish(code, reason) {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.#ws = null;
    this.#emit("close", { code, reason, wasClean: code === 1000 });
  }
}
