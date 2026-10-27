// Home Assistant über MQTT-Discovery: Heimalarm erscheint dort von selbst als Gerät „Heimalarm“,
// sobald HA mit derselben Mosquitto-Zentrale verbunden ist. Keine Integration, kein Token.
//
// Entitäten (alle retained unter <prefix>/…/heimalarm_*/config):
//   binary_sensor  Einsatz (alle) + Einsatz <Person>   heimalarm/ha/einsatz/<key>        ON/OFF
//   sensor         Letztes Stichwort (+ Attribute)      heimalarm/ha/letzter              JSON
//   sensor         Letzter Alarm (Zeitstempel)          heimalarm/ha/letzter              JSON
//   binary_sensor  Melder <kennung> (Verbindung)        alarm/<kennung>/status            online/offline
//   button         Wieder da                            heimalarm/cmd/restore
//   button         Testalarm <Person>                   alarm/<kennung>  {test:true}
// Verfügbarkeit: heimalarm/dienst/status (Last Will des Dienstes).
//
// Einstellungen (gemeinsame Daten → hass): { enabled, prefix, activeMin, tests, buttons }

const BASE = "heimalarm/ha";
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_|_$/gu, "") || "x";

export function startHass(ctx, log) {
  const cfg = () => ({ enabled: false, prefix: "homeassistant", activeMin: 30, tests: false, buttons: true, ...(ctx.config.hass || {}) });
  const published = new Map();   // config-topic -> true (zum Aufräumen)
  const timers = new Map();      // key -> Timeout (Einsatz wieder AUS)
  let lastPrefix = null;

  const pub = (topic, payload, retain = true) =>
    ctx.client.publish(topic, typeof payload === "string" ? payload : JSON.stringify(payload), { retain, qos: 1 });

  const device = () => ({
    identifiers: ["heimalarm_zentrale"], name: "Heimalarm", manufacturer: "Heimalarm", model: "Zentrale", sw_version: ctx.version,
  });
  const availability = {
    availability_topic: "heimalarm/dienst/status",
    availability_template: "{{ 'online' if value_json.online else 'offline' }}",
  };

  /** Alle gewünschten Entitäten: [component, objectId, config] */
  function wanted() {
    const c = cfg();
    const persons = ctx.config.persons || [];
    const list = [];
    const ein = (key, name) => list.push(["binary_sensor", `heimalarm_einsatz_${slug(key)}`, {
      name, icon: "mdi:fire-truck", state_topic: `${BASE}/einsatz/${key}`, payload_on: "ON", payload_off: "OFF",
      json_attributes_topic: `${BASE}/einsatz/${key}/attr`,
    }]);
    ein("alle", "Einsatz");
    if (persons.length > 1) for (const p of persons) ein(p.id, `Einsatz ${p.name || p.id}`);

    // Ereignis bei JEDEM Alarm – löst Automationen auch aus, wenn „Einsatz“ schon an ist (zweiter Alarm kurz danach)
    list.push(["event", "heimalarm_alarm", {
      name: "Alarm", icon: "mdi:alarm-light", state_topic: `${BASE}/ereignis`, event_types: ["alarm", "probe", "test"],
    }]);
    list.push(["sensor", "heimalarm_stichwort", {
      name: "Letztes Stichwort", icon: "mdi:message-alert", state_topic: `${BASE}/letzter`,
      value_template: "{{ value_json.keyword or value_json.source or 'Alarm' }}", json_attributes_topic: `${BASE}/letzter`,
    }]);
    list.push(["sensor", "heimalarm_letzter_alarm", {
      name: "Letzter Alarm", device_class: "timestamp", state_topic: `${BASE}/letzter`, value_template: "{{ value_json.time }}",
    }]);
    for (const k of Object.keys(ctx.esp)) list.push(["binary_sensor", `heimalarm_melder_${slug(k)}`, {
      name: `Melder ${k}`, device_class: "connectivity", entity_category: "diagnostic",
      state_topic: `alarm/${k}/status`, payload_on: "online", payload_off: "offline",
    }]);
    if (c.buttons) {
      list.push(["button", "heimalarm_wieder_da", { name: "Einsatz beenden", icon: "mdi:home-import-outline", command_topic: "heimalarm/cmd/restore", payload_press: "{}" }]);
      for (const p of persons) list.push(["button", `heimalarm_test_${slug(p.id)}`, {
        name: persons.length > 1 ? `Testalarm ${p.name || p.id}` : "Testalarm", icon: "mdi:bell-check-outline", entity_category: "diagnostic",
        command_topic: `alarm/${p.id}`, payload_press: JSON.stringify({ source: "Home Assistant", test: true }),
      }]);
    }
    return list;
  }

  /** Discovery veröffentlichen bzw. Veraltetes entfernen. */
  function sync() {
    const c = cfg();
    const prefix = String(c.prefix || "homeassistant").replace(/\/+$/u, "");
    // Präfix geändert oder ausgeschaltet: alles Alte löschen
    if (lastPrefix && (lastPrefix !== prefix || !c.enabled)) {
      for (const t of published.keys()) pub(t, "");
      published.clear();
    }
    lastPrefix = c.enabled ? prefix : null;
    if (!c.enabled) return;

    const now = new Set();
    for (const [comp, id, conf] of wanted()) {
      const topic = `${prefix}/${comp}/${id}/config`;
      now.add(topic);
      pub(topic, { ...conf, unique_id: id, default_entity_id: `${comp}.${id}`, device: device(), ...availability });
      published.set(topic, true);
    }
    for (const t of [...published.keys()]) if (!now.has(t)) { pub(t, ""); published.delete(t); }   // Person entfernt usw.
    // Anfangszustand: kein Einsatz
    for (const [comp, id, conf] of wanted()) if (comp === "binary_sensor" && id.startsWith("heimalarm_einsatz_") && !timers.has(conf.state_topic)) pub(conf.state_topic, "OFF");
  }

  function set(key, attr) {
    const topic = `${BASE}/einsatz/${key}`;
    pub(`${topic}/attr`, attr);
    pub(topic, "ON");
    clearTimeout(timers.get(topic));
    timers.set(topic, setTimeout(() => { pub(topic, "OFF"); timers.delete(topic); }, Math.max(1, Number(cfg().activeMin) || 30) * 60e3));
  }

  function onAlarm(e) {
    const c = cfg();
    if (!c.enabled || (e.test && !c.tests)) return;
    const attr = {
      keyword: e.keyword || "", address: e.address || "", unit: e.unit || "", text: e.text || "", source: e.source || "",
      person: e.who, test: Boolean(e.test), probe: Boolean(e.probe), time: new Date().toISOString(),
    };
    pub(`${BASE}/letzter`, attr);
    pub(`${BASE}/ereignis`, { event_type: e.test ? "test" : e.probe ? "probe" : "alarm", ...attr }, false);
    set("alle", attr);
    if ((ctx.config.persons || []).length > 1) set(e.who, attr);
    log.info("Home Assistant: Einsatz gemeldet", e.keyword || e.source || "");
  }

  /** „Wieder da“ beendet den Einsatz auch in HA. */
  function onRestore() {
    if (!cfg().enabled) return;
    for (const [topic, t] of timers) { clearTimeout(t); pub(topic, "OFF"); }
    timers.clear();
  }

  let espKnown = 0;
  function onEsp() {
    const n = Object.keys(ctx.esp).length;
    if (n !== espKnown) { espKnown = n; sync(); }
  }

  return { sync, onAlarm, onRestore, onEsp };
}
