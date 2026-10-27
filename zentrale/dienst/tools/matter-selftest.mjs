// Lokaler Test (nicht für CI): simulierte Matter-Lampe + Alexa-Sensoren (voice.js) + Matter-Steuerung im selben Prozess.
// Aufruf im Ordner zentrale/dienst:  node tools/matter-selftest.mjs <leerer-ordner>
import { resolve } from "node:path";
const dir = resolve(process.argv[2] || "./data/selftest");
process.env.MATTER_STORAGE = `${dir}/voice`;
process.env.MATTER_CTL_STORAGE = `${dir}/ctl`;
process.env.MATTER_PORT = "5541";   // nicht 5540: dort läuft der echte Dienst
const { Environment, ServerNode, StorageService, VendorId } = await import("@matter/main");
const { DimmableLightDevice } = await import("@matter/main/devices/dimmable-light");
const { StorageBackendDisk } = await import("@matter/nodejs");
const { startVoice } = await import("../src/voice.js");
const { startMatterCtl } = await import("../src/matterctl.js");

const msgs = {};
const ctx = { config: { persons: [], wifi: [] }, zigbee: [], devices: {}, client: { publish: (t, m) => { msgs[t] = JSON.parse(m); } } };
const log = { info: (...a) => console.log("info", ...a), warn: (...a) => console.log("warn", ...a), action: () => {} };
const voice = startVoice(ctx, log);
voice.onConfig();

// Simulierte Lampe in eigener Umgebung
const lenv = new Environment("lampe", Environment.default);
const ls = new StorageService(lenv, (ns) => new StorageBackendDisk(resolve(dir, "lampe", ns)));
lenv.set(StorageService, ls);
const lamp = await ServerNode.create({
  environment: lenv, id: "lampe", network: { port: 5560 },
  commissioning: { passcode: 20202021, discriminator: 3840 },
  basicInformation: { vendorName: "Testfirma", vendorId: VendorId(0xfff1), productName: "Testlampe", productId: 0x8001, nodeLabel: "Testlampe", serialNumber: "t1", uniqueId: "t1" },
});
const { Endpoint } = await import("@matter/main");
await lamp.add(new Endpoint(DimmableLightDevice, { id: "licht" }));
await lamp.start();
const code = lamp.state.commissioning.pairingCodes.manualPairingCode;
console.log("Lampe bereit, Code", code);

const events = [];
const ctl = startMatterCtl(ctx, log, (n, s) => events.push([n, s.state, s.brightness]));
ctl.boot();
await ctl.command("pair", { code });
console.log("status", JSON.stringify(msgs["heimalarm/matter/status"]));
await new Promise((r) => setTimeout(r, 1500));
console.log("devices", JSON.stringify(msgs["heimalarm/matter/devices"]));
const dev = msgs["heimalarm/matter/devices"]?.[0];
if (!dev) { console.log("FEHLER: kein Gerät"); process.exit(1); }
await ctl.switchByName(dev.name, { state: "ON", brightness: 127 });
await new Promise((r) => setTimeout(r, 1500));
console.log("lampe onOff", lamp.parts.get("licht").state.onOff.onOff, "level", lamp.parts.get("licht").state.levelControl.currentLevel);
console.log("state", JSON.stringify(msgs["heimalarm/matter/state"]));
await ctl.command("rename", { id: dev.id, name: "Flur" });
console.log("renamed", msgs["heimalarm/matter/devices"][0].name);
console.log("voice", JSON.stringify({ running: msgs["heimalarm/voice/status"]?.running, port: msgs["heimalarm/voice/status"]?.port }));
await ctl.command("remove", { node: dev.node });
console.log("nach remove", JSON.stringify(msgs["heimalarm/matter/devices"]), "events", events.length);
process.exit(0);
