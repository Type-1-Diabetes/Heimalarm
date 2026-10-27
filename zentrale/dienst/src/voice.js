// Alexa & Google Home über Matter (lokal, ohne Cloud).
// Der Dienst stellt eine Matter-Bridge mit Kontaktsensoren bereit:
//   „Heimalarm Einsatz“ (jeder Alarm) und je Person „Einsatz <Name>“.
// Bei Alarm meldet der Sensor kurz „offen“ – das startet Routinen in Alexa / Google Home
// (Alexa erlaubt nur Sensoren als Auslöser, keine Schalter).
// Licht & Zigbee-Geräte gibt Matterbridge (eigener Container) an die Assistenten weiter.
//
// Status für die App: heimalarm/voice/status (retained) { enabled, commissioned, qr, manual, fabrics, sensors }
// Befehle:            heimalarm/cmd/voice/test {who?}  ·  heimalarm/cmd/voice/reset
import { Environment, ServerNode, Endpoint, VendorId, StorageService } from "@matter/main";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import { ContactSensorDevice } from "@matter/main/devices/contact-sensor";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";

const PORT = Number(process.env.MATTER_PORT || 5540);   // Alexa findet Matter-Geräte nur auf Port 5540
const STORAGE = process.env.MATTER_STORAGE || "./data/matter";
const Sensor = ContactSensorDevice.with(BridgedDeviceBasicInformationServer);

export function startVoice(ctx, log) {
  const cfg = () => ({ enabled: true, openSec: 30, tests: false, ...(ctx.config.voice || {}) });
  let node = null, aggregator = null;
  const sensors = new Map();   // key ("alle" | kennung) -> { ep, name, timer }
  let starting = null;
  let error = "", retryAt = 0;

  const pub = (topic, payload, retain = false) => ctx.client.publish(topic, JSON.stringify(payload), { retain, qos: 1 });

  function status() {
    const c = cfg();
    if (!node?.lifecycle?.isOnline) return pub("heimalarm/voice/status", { enabled: c.enabled, running: false, error }, true);
    const s = node.state.commissioning;
    pub("heimalarm/voice/status", {
      enabled: c.enabled, running: true, commissioned: s.commissioned,
      qr: s.pairingCodes.qrPairingCode, manual: s.pairingCodes.manualPairingCode,
      fabrics: Object.values(s.fabrics || {}).map((f) => f.label || `Hersteller ${f.rootVendorId}`),
      sensors: [...sensors.values()].map((x) => x.name), port: PORT,
    }, true);
  }

  const wanted = () => [["alle", "Heimalarm Einsatz"], ...(ctx.config.persons || []).map((p) => [p.id, `Einsatz ${p.name || p.id}`])];

  async function syncSensors() {
    for (const [key, name] of wanted()) {
      if (sensors.has(key)) continue;
      const id = `sensor-${key.replace(/[^a-z0-9]/giu, "").toLowerCase() || "x"}`;
      const ep = new Endpoint(Sensor, {
        id,
        booleanState: { stateValue: true },   // true = geschlossen = Ruhe
        bridgedDeviceBasicInformation: { nodeLabel: name, productName: "Heimalarm", productLabel: name, serialNumber: `heimalarm-${id}`, reachable: true },
      });
      await aggregator.add(ep);
      sensors.set(key, { ep, name, timer: null });
    }
  }

  async function start() {
    if (node || !cfg().enabled) return;
    const env = Environment.default;
    env.get(StorageService).location = STORAGE;
    node = await ServerNode.create({
      id: "heimalarm",
      network: { port: PORT },
      productDescription: { name: "Heimalarm", deviceType: AggregatorEndpoint.deviceType },
      basicInformation: {
        vendorName: "Heimalarm", vendorId: VendorId(0xfff1), nodeLabel: "Heimalarm",
        productName: "Heimalarm Bridge", productLabel: "Heimalarm", productId: 0x8000, serialNumber: "heimalarm-bridge",
        uniqueId: "heimalarm-bridge-uid",
      },
    });
    aggregator = new Endpoint(AggregatorEndpoint, { id: "aggregator" });
    await node.add(aggregator);
    await syncSensors();
    node.events.commissioning.commissioned.on(() => { log.info("Sprachassistent gekoppelt"); status(); });
    node.events.commissioning.fabricsChanged.on(() => status());
    await node.start();
    error = "";
    log.info("Matter-Bridge gestartet", `Port ${PORT} · ${sensors.size} Sensor(en)`);
    status();
  }

  async function stop() {
    if (!node) return;
    await node.close().catch(() => {});
    node = null; aggregator = null; sensors.clear();
    status();
  }

  /** Bei Alarm: Sensor kurz „offen“ melden. */
  async function pulse(key) {
    const s = sensors.get(key);
    if (!s) return;
    clearTimeout(s.timer);
    await s.ep.set({ booleanState: { stateValue: false } });
    s.timer = setTimeout(() => s.ep.set({ booleanState: { stateValue: true } }).catch(() => {}), cfg().openSec * 1000);
  }

  async function onAlarm(event) {
    if (!node || (event.test && !cfg().tests && !event.voiceTest)) return;
    await pulse("alle").catch((e) => log.warn("Matter-Sensor nicht geschaltet", e.message));
    if (event.who && event.who !== "alle") await pulse(event.who).catch(() => {});
  }

  function onConfig() {
    const want = cfg().enabled;
    if (want && !node && !starting && Date.now() >= retryAt) {
      starting = start().catch(async (e) => {
        error = String(e?.cause?.message || e.message);
        log.warn("Matter-Bridge startet nicht", error);
        await node?.close().catch(() => {});
        node = null; aggregator = null; sensors.clear();
        retryAt = Date.now() + 60_000;          // nicht bei jeder Änderung neu versuchen
        setTimeout(onConfig, 61_000);
        status();
      }).finally(() => { starting = null; });
    }
    else if (!want && node) stop();
    else if (node && !starting) syncSensors().then(status).catch((e) => log.warn("Matter-Sensoren", e.message));
    else status();
  }

  async function command(cmd, data) {
    if (cmd === "test") {
      log.info("Sprachassistent: Testauslösung", data.who || "alle");
      return onAlarm({ who: data.who || "alle", test: true, voiceTest: true });
    }
    if (cmd === "reset" && node) {   // alle Kopplungen löschen, neu koppelbar
      await node.erase().catch((e) => log.warn("Zurücksetzen fehlgeschlagen", e.message));
      node = null; aggregator = null; sensors.clear();
      log.info("Matter-Kopplungen gelöscht");
      onConfig();
    }
  }

  return { onAlarm, onConfig, command, status };
}
