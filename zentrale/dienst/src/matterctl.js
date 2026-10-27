// Matter-Geräte in Heimalarm (Matter-Controller, lokal, ohne Cloud).
// Gegenstück zu voice.js: dort IST die Zentrale ein Matter-Gerät (Sensoren für Alexa/Google),
// hier STEUERT sie Matter-Geräte. Nutzer teilen ein Gerät in der Alexa-/Google-/SmartThings-App
// („Mit anderer App teilen“ → Code) – Heimalarm wird zusätzliche Steuerung, Alexa bleibt gekoppelt.
//
// Eigener Speicher (data/matter-ctl), eigener Port (frei gewählt, nicht 5540) – berührt die Alexa-Sensoren nicht.
// Startet erst, wenn ein Gerät gekoppelt ist oder gekoppelt werden soll (sonst kein Matter-Verkehr).
//
// Geräte heißen wie Zigbee-Geräte über ihren Namen; Zustand im Zigbee-Format { state, brightness 0–254, color_temp },
// Thermostate { occupied_heating_setpoint °C, local_temperature °C, system_mode "off"|"heat"|"auto" },
// damit Routinen, „Wieder da“ und Geräte-Auslöser ohne Sonderfälle funktionieren.
//
// Für die App:  heimalarm/matter/status  (retained) { running, error, pairing: { busy, error, ok, at } }
//               heimalarm/matter/devices (retained) [{ id, node, name, vendor, product, online, caps: { onoff, level, ct, heat } }]
//               heimalarm/matter/state   (retained) { id: { state, brightness?, color_temp? } }
// Befehle:      heimalarm/cmd/matter/pair {code} · set {id, payload} · rename {id, name} · remove {node}
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Environment, StorageService } from "@matter/main";
import { ManualPairingCodeCodec, QrPairingCodeCodec, NodeId } from "@matter/main/types";
import { OnOff, LevelControl, ColorControl, Thermostat, BridgedDeviceBasicInformation, GeneralCommissioning } from "@matter/main/clusters";
import { StorageBackendDisk } from "@matter/nodejs";
import { CommissioningController } from "@project-chip/matter.js";
import { NodeStates } from "@project-chip/matter.js/device";

const STORAGE = resolve(process.env.MATTER_CTL_STORAGE || "./data/matter-ctl");
const META = resolve(STORAGE, "heimalarm.json");   // Namen: { names: { id: name } }
const CLUSTER = { [OnOff.Cluster.id]: "onOff", [LevelControl.Cluster.id]: "level", [ColorControl.Cluster.id]: "color", [Thermostat.Cluster.id]: "thermo" };
// Matter-Betriebsart des Thermostats ↔ Zigbee-Schreibweise
const MODE_OUT = { [Thermostat.SystemMode.Off]: "off", [Thermostat.SystemMode.Heat]: "heat", [Thermostat.SystemMode.Auto]: "auto" };
const MODE_IN = { off: Thermostat.SystemMode.Off, heat: Thermostat.SystemMode.Heat, auto: Thermostat.SystemMode.Auto };
// Eigene Matter-Bridges nicht als Gerät koppeln (Schleife): Heimalarm-Sensoren und Matterbridge.
const OWN = /heimalarm|matterbridge/iu;

/** Kopplungscode aus der App lesen: 11/21 Ziffern (mit Bindestrichen/Leerzeichen) oder QR-Text „MT:…“. */
export function parseCode(input) {
  const raw = String(input || "").trim();
  if (/^MT:/iu.test(raw)) {
    const [d] = QrPairingCodeCodec.decode(raw.toUpperCase());
    return { passcode: d.passcode, identifierData: { longDiscriminator: d.discriminator } };
  }
  const digits = raw.replace(/\D/gu, "");
  if (digits.length !== 11 && digits.length !== 21) throw new Error("Der Code hat 11 Ziffern (z. B. 1234-567-8901) oder beginnt mit MT:");
  const d = ManualPairingCodeCodec.decode(digits);
  return { passcode: d.passcode, identifierData: { shortDiscriminator: d.shortDiscriminator } };
}

export function startMatterCtl(ctx, log, onDevice) {
  let ctl = null, starting = null, error = "";
  let pairing = { busy: false };
  const nodes = new Map();     // nodeId (string) -> PairedNode
  const devices = new Map();   // id "<node>-<ep>" -> { id, node, ep, name, vendor, product, caps, clients }
  const states = {};           // id -> { state, brightness?, color_temp? }
  let meta = { names: {} };
  try { meta = { names: {}, ...JSON.parse(readFileSync(META, "utf8")) }; } catch { /* noch keine Namen */ }

  const pub = (topic, payload) => ctx.client.publish(topic, JSON.stringify(payload), { retain: true, qos: 1 });
  const saveMeta = () => { mkdirSync(STORAGE, { recursive: true }); writeFileSync(META, JSON.stringify(meta, null, 2)); };

  function status() { pub("heimalarm/matter/status", { running: Boolean(ctl), error, pairing }); }

  function publishDevices() {
    pub("heimalarm/matter/devices", [...devices.values()].map((d) => ({
      id: d.id, node: d.node, name: d.name, vendor: d.vendor, product: d.product, caps: d.caps,
      online: nodes.get(d.node)?.state === NodeStates.Connected,
    })));
  }

  let stateTimer = null;
  const publishStates = () => { clearTimeout(stateTimer); stateTimer = setTimeout(() => pub("heimalarm/matter/state", states), 150); };

  /** Name eindeutig gegenüber Zigbee, WLAN und anderen Matter-Geräten halten. */
  function uniqueName(want, id) {
    const taken = new Set([
      ...(ctx.zigbee || []).map((d) => d.friendly_name), ...(ctx.config.wifi || []).map((d) => d.name),
      ...[...devices.values()].filter((d) => d.id !== id).map((d) => d.name),
    ]);
    let name = want.trim() || "Matter-Gerät", n = 2;
    while (taken.has(name)) name = `${want.trim()} ${n++}`;
    return name;
  }

  function updateState(d) {
    const c = d.clients, s = { ...states[d.id] };
    const local = (client, attr) => { try { return client?.attributes?.[attr]?.getLocal(); } catch { return undefined; } };
    const on = local(c.onOff, "onOff");
    if (on != null) s.state = on ? "ON" : "OFF";
    const lvl = local(c.level, "currentLevel");
    if (lvl != null) s.brightness = lvl;
    const ct = local(c.color, "colorTemperatureMireds");
    if (ct != null) s.color_temp = ct;
    // Thermostat: Werte in 0,01 °C
    const sp = local(c.thermo, "occupiedHeatingSetpoint");
    if (sp != null) s.occupied_heating_setpoint = sp / 100;
    const lt = local(c.thermo, "localTemperature");
    if (lt != null) s.local_temperature = lt / 100;
    const sm = local(c.thermo, "systemMode");
    if (sm != null) s.system_mode = MODE_OUT[sm] || "heat";
    states[d.id] = s;
    ctx.devices[d.name] = s;      // für „Wieder da“ und Geräte-Auslöser in Routinen
    onDevice(d.name, s);
  }

  /** Alle schaltbaren Teile eines Geräts einsammeln – auch die Geräte hinter einer Bridge. */
  function collect(node) {
    const nodeId = String(node.nodeId);
    for (const [id, d] of devices) if (d.node === nodeId) devices.delete(id);
    const info = node.basicInformation || {};
    if (OWN.test(`${info.vendorName} ${info.productName}`)) return false;
    const walk = (eps) => {
      for (const ep of eps) {
        const onOff = ep.getClusterClient(OnOff.Complete);
        const thermo = ep.getClusterClient(Thermostat.Complete);
        if (onOff || thermo) {
          const level = ep.getClusterClient(LevelControl.Complete);
          const color = ep.getClusterClient(ColorControl.Complete);
          const bridged = ep.getClusterClient(BridgedDeviceBasicInformation.Cluster);
          let label;
          try { label = bridged?.attributes?.nodeLabel?.getLocal() || bridged?.attributes?.productName?.getLocal(); } catch { /* keiner */ }
          const id = `${nodeId}-${ep.number}`;
          const base = label || info.nodeLabel || info.productLabel || info.productName || `Matter-Gerät ${nodeId}`;
          const d = {
            id, node: nodeId, ep: ep.number, vendor: info.vendorName || "", product: info.productName || "",
            caps: { onoff: Boolean(onOff), level: Boolean(level), ct: Boolean(color?.supportedFeatures?.colorTemperature), heat: Boolean(thermo) },
            clients: { onOff, level, color, thermo },
          };
          d.name = meta.names[id] || uniqueName(base, id);
          devices.set(id, d);
          updateState(d);
        }
        walk(ep.getChildEndpoints());
      }
    };
    walk(node.getDevices());
    return true;
  }

  async function attach(nodeId) {
    const node = await ctl.getNode(nodeId);
    const key = String(nodeId);
    nodes.set(key, node);
    node.events.stateChanged.on((st) => {
      if (st === NodeStates.Disconnected) log.warn("Matter-Gerät nicht erreichbar", [...devices.values()].find((d) => d.node === key)?.name || key);
      publishDevices();
    });
    node.events.initialized.on(() => { collect(node); publishDevices(); publishStates(); });
    node.events.structureChanged.on(() => { collect(node); publishDevices(); });
    node.events.attributeChanged.on(({ path: { endpointId, clusterId } }) => {
      if (!CLUSTER[clusterId]) return;
      const d = devices.get(`${key}-${endpointId}`);
      if (d) { updateState(d); publishStates(); }
    });
    if (node.initialized) collect(node);
    if (!node.isConnected) node.connect();
    return node;
  }

  async function start() {
    if (ctl) return ctl;
    if (starting) return starting;
    starting = (async () => {
      // Eigene Umgebung mit eigenem Speicherort – teilt Netzwerk und mDNS mit voice.js, nicht aber dessen Kopplungen.
      const env = new Environment("heimalarm-ctl", Environment.default);
      const storage = new StorageService(env, (ns) => new StorageBackendDisk(resolve(STORAGE, ns)));
      storage.location = STORAGE;
      env.set(StorageService, storage);
      const c = new CommissioningController({
        environment: { environment: env, id: "controller" },
        autoConnect: false,
        adminFabricLabel: "Heimalarm",
      });
      await c.start();
      ctl = c;
      error = "";
      for (const id of ctl.getCommissionedNodes()) await attach(id).catch((e) => log.warn("Matter-Gerät", e.message));
      log.info("Matter-Steuerung gestartet", `${nodes.size} Gerät(e)`);
      publishDevices(); status();
      return ctl;
    })().catch((e) => {
      error = String(e?.cause?.message || e.message);
      log.warn("Matter-Steuerung startet nicht", error);
      status();
      throw e;
    }).finally(() => { starting = null; });
    return starting;
  }

  /** Beim Dienst-Start nur loslegen, wenn schon einmal gekoppelt wurde. */
  function boot() {
    const used = existsSync(STORAGE) && readdirSync(STORAGE).some((f) => f !== "heimalarm.json");
    if (used) start().catch(() => setTimeout(boot, 60_000));
    else { status(); publishDevices(); }
  }

  async function pair(code) {
    if (pairing.busy) return;
    pairing = { busy: true, at: Date.now() };
    status();
    try {
      const { passcode, identifierData } = parseCode(code);
      await start();
      log.info("Matter-Gerät wird gekoppelt …");
      const nodeId = await ctl.commissionNode({
        commissioning: { regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor, regulatoryCountryCode: "DE" },
        discovery: { identifierData, discoveryCapabilities: { onIpNetwork: true } },
        passcode,
      });
      const node = await attach(nodeId);
      if (!node.initialized) await node.events.initialized;
      if (!collect(node)) {
        await ctl.removeNode(nodeId, true).catch(() => {});
        nodes.delete(String(nodeId));
        throw new Error("Das ist eine Bridge dieser Zentrale (Heimalarm-Sensoren oder Matterbridge) – ihre Geräte sind schon in Heimalarm.");
      }
      const names = [...devices.values()].filter((d) => d.node === String(nodeId)).map((d) => d.name);
      if (!names.length) log.warn("Matter-Gerät gekoppelt, aber nichts Schaltbares gefunden", node.basicInformation?.productName);
      else log.info("Matter-Gerät gekoppelt", names.join(", "));
      pairing = { busy: false, ok: names.join(", ") || "gekoppelt", at: Date.now() };
      publishDevices(); publishStates();
    } catch (e) {
      const msg = String(e?.cause?.message || e.message);
      const hint = /timeout|discover|not found|no device/iu.test(msg)
        ? "Gerät nicht gefunden. Code frisch erzeugen (gilt ~15 Minuten) und prüfen, ob Zentrale und Gerät im selben Netz sind."
        : msg;
      log.warn("Matter-Gerät nicht gekoppelt", hint);
      pairing = { busy: false, error: hint, at: Date.now() };
    }
    status();
  }

  const byName = (name) => [...devices.values()].find((d) => d.name === name);

  /** Zigbee-Payload { state: ON|OFF|TOGGLE, brightness 0–254, color_temp, transition s,
   *  occupied_heating_setpoint °C, system_mode } anwenden. */
  async function set(id, p = {}) {
    const d = devices.get(id);
    if (!d) throw new Error("Matter-Gerät unbekannt");
    const { onOff, level, color, thermo } = d.clients;
    if (thermo) {
      const mode = MODE_IN[String(p.system_mode || "").toLowerCase()];
      if (mode != null) await thermo.attributes.systemMode.set(mode);
      if (p.occupied_heating_setpoint != null) {
        if (mode == null && thermo.attributes.systemMode.getLocal() === Thermostat.SystemMode.Off) await thermo.attributes.systemMode.set(Thermostat.SystemMode.Heat);
        await thermo.attributes.occupiedHeatingSetpoint.set(Math.round(Number(p.occupied_heating_setpoint) * 100));
      }
    }
    if (!onOff) return;
    const tt = p.transition != null ? Math.round(Number(p.transition) * 10) : 0;
    const opts = { optionsMask: {}, optionsOverride: {} };
    const st = String(p.state || "").toUpperCase();
    if (p.brightness != null && level && st !== "OFF") {
      await level.moveToLevelWithOnOff({ level: Math.max(1, Math.min(254, Math.round(Number(p.brightness)))), transitionTime: tt, ...opts });
    } else if (st === "ON") await onOff.on();
    else if (st === "OFF") await onOff.off();
    else if (st === "TOGGLE") await onOff.toggle();
    if (p.color_temp != null && color && d.caps.ct) {
      await color.moveToColorTemperature({ colorTemperatureMireds: Math.round(Number(p.color_temp)), transitionTime: tt, ...opts });
    }
  }

  async function command(cmd, data = {}) {
    try {
      if (cmd === "pair") return await pair(data.code);
      if (cmd === "set") return await set(data.id, data.payload);
      if (cmd === "rename") {
        const d = devices.get(data.id);
        if (!d) return;
        const old = d.name;
        d.name = uniqueName(String(data.name || ""), d.id);
        meta.names[d.id] = d.name; saveMeta();
        delete ctx.devices[old]; ctx.devices[d.name] = states[d.id];
        log.info("Matter-Gerät umbenannt", `${old} → ${d.name}`);
        return publishDevices();
      }
      if (cmd === "remove" && ctl) {
        const nodeId = NodeId(BigInt(data.node));
        const names = [...devices.values()].filter((d) => d.node === String(data.node));
        await ctl.removeNode(nodeId, true).catch((e) => log.warn("Gerät meldet sich nicht ab – trotzdem entfernt", e.message));
        nodes.delete(String(data.node));
        for (const d of names) { devices.delete(d.id); delete states[d.id]; delete meta.names[d.id]; delete ctx.devices[d.name]; }
        saveMeta();
        log.info("Matter-Gerät entfernt", names.map((d) => d.name).join(", "));
        publishDevices(); publishStates();
      }
    } catch (e) {
      log.warn(`Matter: ${cmd}`, e.message);
    }
  }

  return {
    boot, command, byName,
    /** Für Routinen: Gerät nach Namen schalten. */
    switchByName: (name, payload) => set(byName(name).id, payload),
  };
}
