# Heimalarm – Projekt-Kontext

> Arbeitsgrundlage für alle, die am Projekt mitarbeiten (Menschen und KI).
> **Vor jeder Änderung lesen:** Abschnitt [Abhängigkeiten](#abhängigkeiten--was-braucht-was) und [Vorsicht bei Änderungen](#vorsicht-bei-änderungen) zeigen, was sonst kaputtgehen kann.
> Anleitungen für Nutzer: `docs/anleitungen/*.pdf` (Überblick, Einrichtung mit ESP32), NAS kurz: `docs/Einrichtung-NAS.md`.

## Was ist Heimalarm?

Eine App für **Windows-PC und Android-Handy**, die einen Einsatz-Alarm zuhause weitergibt (Feuerwehr, Rettungsdienst, Wasserwacht, Katastrophenschutz …):

- **Alarm kommt an** über den Melder in der Ladeschale (ESP32 liest den Relaiskontakt, z. B. Motorola TPG2200) und/oder über Alarm-Apps (SYBOS, aPager PRO, Divera 24/7).
- **PC:** Vollbild **„Fährst du?“** mit Countdown, danach Ruhezustand (einstellbar).
- **Handy:** Meldung, Rückmeldung an Divera/aPager, Divera-Status.
- **Zuhause:** Routinen schalten Licht (Zigbee, WLAN-Geräte) und starten Alexa/Google-Routinen.

Zwei **Betriebsarten** (Einstellungen → Betrieb & Koppeln):

| | Mit Zentrale | Ohne Zentrale („direkt“) |
|---|---|---|
| Wer verteilt den Alarm | Raspberry Pi (Mosquitto) | Handy schickt per WLAN an gekoppelte PCs |
| Wer führt Routinen aus | Zentralen-Dienst auf dem Pi | Handy (`routines-local.js`) |
| ESP32-Melder, Zigbee, Matter, Webhook, Selbsttest | ✅ | – |
| WLAN-Geräte, Voice Monkey, Divera, aPager-Rückmeldung | ✅ | ✅ |

**Grundsätze:** kostenlos, Open Source, lokal (Cloud nur, wo der Nutzer sie ausdrücklich wählt: Divera, aPager-API, Voice Monkey), eine Codebasis für PC und Handy. Heimalarm ist eine **Komfortfunktion** – Melder und Alarm-App bleiben die eigentliche Alarmierung.

Der Melder wird ausschließlich über einen **ESP32** an der Steckklemme der Ladeschale gelesen.

## Arbeitsweise & Regeln

- **Workflows kurz und schnell halten.** Wörtlich vom Projektinhaber:
  > „Ich möchte das die workflows kurz und schnell ist, es soll keine selftest etc enthalten so dads wenn wir commiten und pushen bsw eine Release version erstellen wollen das es nicht lange dauert wenn wir zb nur bug fixes gemacht haben“

  Konkret: keine Tests, kein Linting, keine Prüfschritte in GitHub Actions. Normale Pushes lösen keinen Build aus. Nur ein Tag `v*` (oder manueller Start) baut das Release.
- **Prüfen passiert lokal** (siehe [Prüfen](#prüfen-lokal-nicht-in-ci)): Oxlint muss 0 Befunde haben.
- **UI in HTML, CSS und JavaScript** (Tauri 2). Kein Framework, ES-Module, klein und modular.
- **Texte kurz, informativ, gut lesbar**, auf Deutsch, ohne Fachjargon. Keine bestimmte Router-Marke voraussetzen („im WLAN-Router“ statt „FRITZ!Box“). Jede Einstellung hat einen Satz Erklärung.
- **Nur zeigen, was eingerichtet ist:** Übersicht, Diagnose, Navigation und Protokoll blenden alles aus, was der Nutzer nicht nutzt (`core/features.js`). **Einstellungen zeigen immer alles.**
- **Tests nicht im Dashboard:** Testalarm und Simulation liegen unter Einstellungen → Kennung & Sperrzeit bzw. Test & Diagnose.
- **Ohne Vorwissen einrichtbar:** sinnvolle Standardwerte, „In 3 Schritten startklar“, Testalarm ohne Folgen.
- **Responsiv:** PC = schmale Symbolleiste links, Handy (≤ 760 px) = Leiste unten mit Pillen-Markierung. Einstellungen, Geräte und Routinen sind zwei Spalten (Liste links, eine Seite rechts); am Handy Liste → Unterseite mit „Zurück“.
- **Einstellungen** (`views/settings.js` → `PAGES`): Bereiche nach Fragen gruppiert (Alarm · Bei Alarm · Zuhause · Verbindung · App). Jeder Bereich hat `desc` (was drinsteht, Liste links), `status` (kurzer Zustand rechts), `lead` (ein Satz oben auf der Seite) und `scope` (für wen es gilt: nur dieses Gerät, alle deine Geräte, Zentrale/Admin). Ein Bereich bündelt einen oder mehrere Abschnitte (`sections`). Hat eine Seite nur einen Abschnitt, versteckt CSS dessen Überschrift. Eingabefelder stehen am PC als Zeile (Name links, Feld rechts). Scroll-Position von Liste und Seite bleibt beim Neuzeichnen und beim Wechsel stehen (`settingsView` merkt sie, `main.js` scrollt in den Einstellungen nicht selbst).
- **Dunkel ist Standard**, Hell die zweite Auswahl. **Weiche Ecken** (`--radius-sm` 8 px, `--radius` 12 px, `--radius-lg` 16 px), Flächen statt Rahmenlinien. **Bereichsfarben** (`--c-alarm`, `--c-net`, `--c-pc` …) – derselbe Bereich hat überall dieselbe Farbe.
- **PC und Handy zeigen dieselben Teile** (Start: Status, Kennzahlen, Licht & Geräte, Schnellaktionen, Zuletzt) – nur die Anordnung unterscheidet sich.
- **Keine Geheimnisse im Repo.** WLAN-, MQTT- und Signier-Daten nur lokal (`secrets.yaml`) oder als GitHub-Secret. API-Schlüssel der Nutzer (Divera, aPager) bleiben nur auf dem Gerät. **Ausnahme (bewusst, freiwillig):** Wer „Divera-Status per Routine“ einschaltet, gibt seinen Divera-Accesskey der Zentrale – er liegt dann nur in `zentrale/dienst/data/divera.json`, nie in den gemeinsamen Daten.
- **Repo ist öffentlich.** Deshalb besonders streng: nie Passwörter, Schlüssel, IPs oder Kennungen aus dem eigenen Heimnetz committen (siehe Punkt oben). GitHub Actions sind für öffentliche Repos kostenlos. **iOS-Build** vorerst nicht vorgesehen.
- **UI-Arbeit** mit den Skills `/impeccable` und `/frontend-design`.
- **Nicht raten:** Bei unklaren Anforderungen oder unbekannten Schnittstellen nachfragen bzw. Quelle prüfen (Doku, Spec).

## Release erstellen (Kurzanleitung – immer so vorgehen, nur nach anweisung)

1. Version hochzählen: `app/package.json` → `"version"` **und** `app/src-tauri/Cargo.toml` → `version` (gleich halten, z. B. `0.1.6`). Dienst-Version nur, wenn sich `zentrale/dienst` geändert hat. ESP32-Firmware geändert → `HEIMALARM_FW` in **allen drei** `esp32/alarm-ich*.yaml` hochzählen. Die App warnt auf Start, wenn Zentrale oder ESP32 älter sind (`core/versions.js`; Sollwerte liest `vite.config.js` beim Bauen aus `zentrale/dienst/package.json` und `esp32/alarm-ich.yaml`).
2. Lokal prüfen: `cd app && npx -y oxlint@latest src` (0 Befunde) und `cd src-tauri && cargo check`.
3. Committen und auf `main` pushen.
4. Release starten: GitHub → *Actions → Release → Run workflow*, Feld **Version = `v0.1.6`** (mit `v`, gleich wie in `package.json`). Aus einer Claude-Session: `gh api -X POST repos/Type-1-Diabetes/Heimalarm/actions/workflows/release.yml/dispatches -f ref=main -f 'inputs[version]=v0.1.6'` (Tags pushen geht dort nicht). Leeres Feld = nur bauen, kein Release.
5. Ergebnis prüfen: Release enthält `Heimalarm_<v>_x64-setup.exe`, `Heimalarm-v<v>.apk` **und** die beiden `.sha256` – ohne sie scheitert das Update in der App.
6. Nutzer müssen nichts tun: PC und Handy zeigen beim nächsten Start „Heimalarm x ist verfügbar“ → **Installieren**.

Nie ändern: Secret `ANDROID_DEBUG_KEYSTORE` (sonst gehen Android-Updates nicht mehr drüber, Nutzer müssten deinstallieren) und die Asset-Namen (`*-setup.exe`, `*.apk`, `<datei>.sha256`), nach denen `core/update.js` sucht.

## Ordner – was liegt wo

```
Heimalarm/
├─ README.md               Für Nutzer: was es kann, Einrichtung, kompatible Geräte
├─ Context.md              Diese Datei (für Entwicklung)
├─ .github/workflows/
│  └─ release.yml          Build nur bei Tag v*: Windows (.exe, NSIS) + Android (.apk, Release-Build, mit dem festen Schlüssel signiert)
├─ app/                    Die App für PC und Handy (Tauri 2)
│  ├─ mirror.html          „Fährst du?“ auf weiteren Bildschirmen (src/mirror.js, nur Anzeige + Antwort)
│  ├─ index.html           Grundgerüst, Navigation (5 Punkte; Handy: „Mehr“ statt „Einstellungen“)
│  ├─ package.json         Version der App (gilt auch für tauri.conf.json), Skript „lint“
│  ├─ vite.config.js       Port 1420, setzt PACKAGE_VERSION
│  ├─ .oxlintrc.json       Lint-Regeln
│  ├─ public/fonts/        Archivo, JetBrains Mono (offline)
│  ├─ src/                 Oberfläche (HTML/CSS/JS) – siehe „App-Struktur“
│  ├─ src-tauri/           Rust-Kern + Tauri-Konfiguration
│  │  ├─ src/lib.rs        Befehle: PC-Aktionen, Prozesse, Medien, Ruhezustand, MAC, Wake-on-LAN
│  │  ├─ src/direct.rs     Empfänger für Alarme vom Handy (ohne Zentrale), Port 8765
│  │  ├─ src/sound.rs      Alarmton nativ (rodio), eigene Töne in <AppData>/sounds, Windows-Lautstärke lesen/setzen
│  │  ├─ src/takeover.rs   „Fährst du?“ auf allen Monitoren (mirror.html), Fokus erzwingen, Tray-Tooltip
│  │  ├─ capabilities/     Rechte der Oberfläche: default.json (inkl. HTTP-Scope), desktop.json (Autostart)
│  │  └─ tauri.conf.json   Fenster, Bundle, Android-Einstellungen
│  └─ plugins/heimalarm/   Eigenes Tauri-Plugin (Rust + Kotlin) für Android:
│                          AlarmListener (Benachrichtigungen mitlesen), KeepAliveService (Hintergrund), Akku-Optimierung,
│                          AlarmSound (Wecker-Ton, Vibration, Vollbild-Meldung), Native (Filter + Puffer, BootReceiver)
├─ zentrale/               Alles für den Raspberry Pi (nur Betriebsart „Mit Zentrale“)
│  ├─ docker-compose.yml   mosquitto · dienst · zigbee2mqtt (Profil zigbee) · matterbridge (Profil matter)
│  ├─ mosquitto/           mosquitto.conf (1883 TCP, 9001 WebSocket)
│  └─ dienst/              Zentralen-Dienst (Node.js)
│     ├─ src/index.js      Start, MQTT, Konfiguration (DEFAULTS), verteilt Nachrichten
│     ├─ src/rules.js      Routinen: Auslöser, Bedingungen, Aktionen, „Wieder da“, Wake-on-LAN
│     ├─ src/webhook.js    aPager-Webhook (Port 8080, mit Schlüssel)
│     ├─ src/selftest.js   automatischer Selbsttest (Zeitplan aus shared.selftest)
│     ├─ src/hass.js       Home Assistant (MQTT-Discovery)
│     ├─ src/divera.js     Divera-Status per Routine (Schlüssel in data/divera.json)
│     ├─ src/voice.js      Matter-Bridge (Kontaktsensoren für Alexa/Google), Port 5540 (Alexa koppelt nur über 5540)
│     ├─ src/matterctl.js  Matter-Steuerung: Geräte aus Alexa/Google/SmartThings mitsteuern (Speicher data/matter-ctl, freier Port)
│     ├─ src/wifi.js       WLAN-Geräte + Voice Monkey (KOPIE von app/src/core/wifi.js)
│     ├─ src/log.js        Protokoll der Zentrale
│     └─ tools/            devbroker.js (Test-Broker), sim.js (ESP32/Zigbee-Simulator), matter-selftest.mjs (Matter-Test am Pi)
├─ esp32/                  ESPHome (Status-LED als Paket in esp32/led/: logik.yaml + Hardware rgb-gpio48/38, einfarbig-esp32/-d1mini): alarm-ich.yaml (ESP32, GPIO27), alarm-ich-s3.yaml (ESP32-S3, GPIO4), alarm-ich-d1mini.yaml (ESP8266, D5/GPIO14), secrets.example.yaml
└─ docs/                   Einrichtung-NAS.md, logo.svg, ablauf.svg, ohne-pi.svg, screenshots/,
                           anleitungen/*.pdf (gebaut aus anleitungen/quelle/*.html mit build.py)
```

### App-Struktur (`app/src/`)

| Datei | Aufgabe |
|---|---|
| `main.js` | Start, Router, Live-Aktualisierung, ESP32-Warnungen, startet Divera-Abfrage, PC-Empfänger, lokale Routinen |
| **core/** | |
| `settings.js` | Lokale Einstellungen + Standardwerte, `mode()`, `isConfigured()`, `SYNC_KEYS` |
| `shared.js` | Gemeinsame Daten (Personen, Routinen, WLAN-Geräte, Voice Monkey …): mit Zentrale retained über MQTT, ohne lokal |
| `features.js` | `has.*` – was ist eingerichtet? Steuert, was Ansichten zeigen |
| `mqtt.js` | Verbindung zur Zentrale, Topics auswerten, Zigbee-Befehle, `state` |
| `engine.js` | Alarm-Logik: Quellen, Sperrzeit je Person, Test/Probe, Ruhezeit, „Fährst du?“, Antwort an Apps |
| `direct.js` | Ohne Zentrale: PC-Empfänger, Koppeln/Entkoppeln, Handy sendet an gekoppelte PCs, Abgleich anstoßen |
| `sync.js` | Abgleich ohne Zentrale: Bereiche, Zeitstempel, `bundle()`/`applyBundle()` |
| `stats.js` | Einsatz-Logbuch: speichern, zusammenführen, Statistik, Jahresrückblick, CSV |
| `routines-local.js` | Ohne Zentrale: Routinen auf dem Handy ausführen |
| `wifi.js` | WLAN-Geräte (Shelly, Hue, WLED, Tasmota), Heizkörperregler (FRITZ!Box AHA, Shelly BLU TRV) + Voice Monkey (KOPIE in zentrale/dienst/src/wifi.js) |
| `divera.js` | Divera-API: laden, Alarme abfragen, Rückmeldung, Status |
| `apager.js` | aPager-Rückmeldung (Alamos-API) |
| `pc.js` | PC-Funktionen (Rust-Befehle) |
| `android.js` | Android-Plugin (Dienst, Akku, Benachrichtigungen) |
| `admin.js` | Admin-PIN (G3), App-Sperre (H4) |
| `wizard.js` | Einrichtungs-Assistent: Fragen → Plan → Anleitung, Live-Prüfung je Schritt, Fortschritt in `settings().wizard` (nur lokal) |
| `notify.js`, `log.js`, `platform.js`, `events.js` | Systemmeldung, Geräte-Protokoll, Plattform, Ereignisse |
| **views/** | `wizard` (Einrichtung, Route `#/einrichtung`), `overview` (Übersicht), `devices` + `wifi` (Geräte), `routines`, `log` (Seite **Einsätze** `#/einsaetze` = `einsaetzeView`, Seite **Protokoll** = `logView`, nur Technik), `settings`, `diagnose`, `takeover` („Fährst du?“) |
| **ui/** | `guide-shots.js` (nachgezeichnete Bildschirme fremder Apps für die Einrichtung), `dom.js` (`h()`, toast), `form.js` (Felder, Schalter, Dialog, `ask()` statt `confirm()`), `theme.js`, `sound.js` (Ton abspielen/stoppen, eigene Töne, Geräte-Lautstärke), `tone.js` (Einstellungs-Bausteine Ton + Lautstärke für `pc`/`phone`) |
| **styles/** | `tokens.css` (Farben, Schrift, Radien), `base`, `layout`, `components`, `takeover` |
| `dev/demo.js` | Beispieldaten (nur `npm run dev` mit `?demo`) |

Neue Funktion = Modul in `core/` + ggf. Ansicht in `views/`. Lokale Einstellungen in `settings.js` (`defaults`), gemeinsame in `shared.js` (`sharedDefaults`) und im Dienst (`DEFAULTS` in `index.js`) mit Standardwert ergänzen. Sichtbarkeit über `features.js`.

## Abhängigkeiten – was braucht was

```
                ┌──────────── Mit Zentrale ─────────────┐
ESP32 ──MQTT──► Mosquitto ◄──WebSocket 9001──► App (PC/Handy)
                   ▲   ▲                          │
   Zigbee2MQTT ────┘   └──── Zentralen-Dienst ────┘ (Routinen, Webhook, Matter, Selbsttest)
                                 │
              WLAN-Geräte (HTTP) ┘ · Voice Monkey (Internet) · Alexa/Google (Matter, mDNS)

                ┌──────────── Ohne Zentrale ────────────┐
Alarm-App ─► Handy (liest mit) ──HTTP 8765 + Code──► PC (direct.rs)
                 └─► WLAN-Geräte (HTTP) · Voice Monkey (Internet)
Divera-API ◄── PC und Handy fragen selbst ab (beide Betriebsarten)
```

| Teil | Braucht | Wird gebraucht von |
|---|---|---|
| **ESP32** | WLAN, Mosquitto (1883), `secrets.yaml` | Quelle „Melder“ |
| **Mosquitto** | Docker auf dem Pi, `zentrale/.env` mit `MQTT_PASSWORD` (Pflicht, sonst startet der Container nicht; `allow_anonymous false`) | ESP32, Dienst, Zigbee2MQTT, Matterbridge, App (9001) |
| **Zentralen-Dienst** | Mosquitto, `network_mode: host` (Wake-on-LAN, Matter-mDNS), Volume `dienst/data` | Routinen, Webhook, Matter-Sensoren, Selbsttest, „Wieder da“ |
| **Zigbee2MQTT** | Zigbee-USB-Stick, Mosquitto, Profil `zigbee` | Seite Geräte (Zigbee), Routinen mit Zigbee-Geräten, Matterbridge |
| **Matterbridge** | Zigbee2MQTT, Profil `matter`, Port 8283 | Zigbee-Licht in Alexa/Google |
| **Matter-Sensoren** (`voice.js`) | IPv6 + mDNS im Heimnetz, Dienst | Alexa/Google-Routinen bei Alarm |
| **Matter-Steuerung** (`matterctl.js`) | IPv6 + mDNS, Dienst; Gerät per „Mit anderer App teilen“-Code; Thread-Geräte zusätzlich ein Thread-Router | Geräte-Seite (Matter), Routinen, „Wieder da“ |
| **App (Zentrale)** | Adresse der Zentrale, Port 9001 | – |
| **App (direkt), PC** | `direct.rs`, freier Port 8765, Firewall „Private Netzwerke“ | Handy sendet Alarme |
| **App (direkt), Handy** | Android-Plugin (Benachrichtigungen, Hintergrund-Dienst), gekoppelte PCs | Routinen ohne Zentrale |
| **Android-Plugin** | Rechte: Benachrichtigungszugriff, Akku-Ausnahme, Foreground-Service | SYBOS/aPager/Divera mitlesen |
| **Divera** | persönlicher Accesskey, Internet, HTTP-Scope `*.divera247.com` | Quelle Divera, Rückmeldung, Status-Karte |
| **aPager-Rückmeldung** | API-Schlüssel + Smart-Home-Abo, Scope `alamos-backend…` | „Ich fahre / nicht“ |
| **WLAN-Geräte** | Geräte-IP im Heimnetz, Scope `http://*:*/*` | Routinen (Handy oder Dienst) |
| **Voice Monkey** | Token, Internet, Scope `api-v3.voicemonkey.io` | Routinen-Aktion „Alexa“ |

## Schnittstellen

### MQTT-Topics (nur mit Zentrale)

| Topic | Inhalt | Von → An |
|---|---|---|
| `alarm/<kennung>` | `ALARM` oder JSON `{source, keyword, unit, text, address, diveraId, test, probe}` | ESP32, Webhook, App → alle |
| `alarm/<kennung>/event` | `{event: recall\|clear, source, keyword, unit}` – Rückalarm / Alarmende, **kein** Alarm (Dienst hört nicht zu, Apps vermerken es am Einsatz) | Webhook → Apps |
| `alarm/<kennung>/status` | `online` / `offline` (Last Will) | ESP32 |
| `alarm/<kennung>/sensor/wifi_signal\|uptime/state`, `…/text_sensor/ip\|version/state` | WLAN, Laufzeit, IP, Firmware | ESP32 |
| `alarm/<kennung>/text_sensor/heimalarm_firmware/state` | Firmware-Stand (`HEIMALARM_FW`), für die Warnung „ESP32 aktualisieren“ | ESP32 |
| `alarm/<kennung>/number/min_duration/command\|state` | Mindestdauer Kontakt (A3) | App ↔ ESP32 |
| `alarm/<kennung>/switch/alarm_bei_offen\|kontakt_test/command\|state` | Kontakt-Logik, Kontakt-Test | App ↔ ESP32 |
| `alarm/<kennung>/binary_sensor/kontakt/state` | Kontakt roh, `ON` = geschlossen | ESP32 |
| `alarm/<kennung>/ota` | `<url>|<md5>` Firmware-Update (A10) | App → ESP32 |
| `heimalarm/clients/<id>` | `{name, platform, version, online, ts, mac}` (retained, Last Will); leer = aus der Liste entfernt | jede App |
| `heimalarm/config/shared` | gemeinsame Daten (retained), siehe unten | Apps ↔ Dienst |
| `heimalarm/answer/<kennung>` | `{type:"answer", who, going, test, from, id, at}` – Antwort live an alle Geräte (`core/livesync.js`) | App → App |
| `heimalarm/devlog/<geräte-id>` | `{name, at, entries}` letzte 100 Protokolleinträge (retained) | App → App |
| `heimalarm/cmd/run\|restore\|wol\|selftest` | Routine, „Wieder da“, Wake-on-LAN, Selbsttest | App → Dienst |
| `heimalarm/einsaetze/<kennung>` | Einsatz-Logbuch (Liste, retained); jedes Gerät führt zusammen und schreibt zurück, wenn es mehr weiß | Apps ↔ Apps |
| `heimalarm/cmd/test\|rename/<geräte-id>` | Testalarm an genau ein Gerät, Gerät umbenennen `{name}` | App → App |
| `heimalarm/cmd/voice/test\|reset` | Matter-Sensor testen, Kopplungen löschen | App → Dienst |
| `heimalarm/cmd/divera/key` | `{who, key}` Divera-Schlüssel hinterlegen (leer = löschen), nicht retained | App → Dienst |
| `heimalarm/divera/keys` | `{<kennung>: {ok, error, ts}}` wer einen Schlüssel hinterlegt hat – ohne Schlüssel (retained) | Dienst |
| `heimalarm/cmd/matter/pair\|set\|rename\|remove` | `{code}` · `{id, payload}` (Zigbee-Format) · `{id, name}` · `{node}` | App → Dienst |
| `heimalarm/matter/status` | `{running, error, pairing: {busy, ok, error, at}}` (retained) | Dienst |
| `heimalarm/matter/devices` | `[{id, node, name, vendor, product, online, caps: {onoff, level, ct}}]` (retained) | Dienst |
| `heimalarm/matter/state` | `{<id>: {state, brightness 0–254, color_temp}}` (retained) | Dienst |
| `heimalarm/voice/status` | `{enabled, running, qr, manual, commissioned, fabrics, sensors, error}` (retained) | Dienst |
| `heimalarm/log`, `heimalarm/log/recent` | Protokoll der Zentrale | Dienst |
| `heimalarm/report` | Selbsttest-Bericht `{ts, ok, checks, manual}` (retained) | Dienst |
| `heimalarm/dienst/status`, `heimalarm/ping` → `heimalarm/pong` | Dienst-Status, Verbindungstest | Dienst |
| `zigbee2mqtt/#` | Geräte, Gruppen, Zustände, Befehle | Zigbee2MQTT |
| `homeassistant/<comp>/heimalarm_*/config` | MQTT-Discovery für Home Assistant (retained, nur wenn `shared.hass.enabled`) | Dienst (`hass.js`) |
| `heimalarm/ha/einsatz/<key>` (+`/attr`), `heimalarm/ha/letzter`, `heimalarm/ha/ereignis` | Einsatz ON/OFF je Person bzw. „alle“, letzter Alarm (JSON), Ereignis bei jedem Alarm (`event.heimalarm_alarm`, nicht retained) | Dienst → Home Assistant |

### Ports

| Port | Wo | Wofür |
|---|---|---|
| 1883 | Pi | MQTT (ESP32, Dienst, Matterbridge) |
| 9001 | Pi | MQTT über WebSocket (App) |
| 8080 | Pi | aPager-Webhook `/alarm/<schlüssel>?who=<kennung>&keyword=&unit=[&event=recall\|clear]` |
| 8081 | Pi | Zigbee2MQTT-Oberfläche |
| 5540 | Pi | Matter-Sensoren (Dienst) – Alexa koppelt nur über 5540 |
| frei (UDP) | Pi | Matter-Steuerung (`matterctl.js`) – vom System gewählt, kein fester Port, keine Freigabe nötig |
| 5540, 8283 | Pi | Matterbridge (Matter, Oberfläche) – belegt dann 5540, nicht zusammen mit den Sensoren für Alexa |
| 8765 | PC | Empfänger: Handy-Kopplung, Abgleich, Alarme vom Handy; `/apager/<schlüssel>` = aPager-Webhook direkt an den PC |

### Direktverbindung (ohne Zentrale)

Kopfzeile `X-Heimalarm-Key`. **Kopplungscode** (am PC angezeigt) erlaubt nur `GET /ping` und `POST /pair` `{id, name}` → Antwort `{code, name}` = **eigener Code dieses Handys**. Mit dem eigenen Code: `GET /ping` (`paired:true`), `POST /alarm` (JSON wie `alarm/<kennung>`), `GET /config` / `POST /config` (Abgleich). Falscher Code → 403. PC: Liste `direct.phones` (Umbenennen, Entkoppeln = Code ungültig), „Neuer Kopplungscode“ lässt gekoppelte Handys gekoppelt. Handy: `direct.peers` mit `paired`; ältere Kopplungen holen sich beim ersten Kontakt automatisch einen eigenen Code. Der PC-Empfänger läuft in beiden Betriebsarten. **aPager-Webhook direkt an den PC:** `GET|POST /apager/<direct.hookKey>?keyword=&unit=[&event=]` (kein Header, Schlüssel im Pfad) → Event `direct-webhook` → `webhook-alarm` in `engine.js` (wie eine App-Quelle; mit Zentrale an alle verteilt). aPager auf dem Handy ruft die Adresse selbst auf, also nur im selben WLAN. Nur Heimnetz, kein TLS.

### Abgleich ohne Zentrale (`core/sync.js`)

Bereiche mit Zeitstempel (localStorage `heimalarm.sync.ts`): `betrieb` (Betriebsart + Zentrale-Adresse), `alarm`/`notify`/`ui` (Kennung bleibt je Gerät), `pc` (ohne `alsoFor`, `wolMac`), `shared` (Routinen, WLAN-Geräte, Personen …; nur wenn beide ohne Zentrale). Neuerer Stand gewinnt. Das Handy ist die Drehscheibe: holt bei jedem PC ab (`GET /config`), führt zusammen, schickt zurück (`POST /config`) – beim Start, alle 2 min, beim Zurückkehren in die App und kurz nach jeder Änderung. Der PC hinterlegt seinen Stand per Rust-Befehl `direct_set_config`. Erster Start: Stand des Handys gilt. Schalter `sync.enabled` gilt für beide Wege (Zentrale und direkt). Divera-/aPager-Schlüssel, App-PIN, Gerätename nie.

### Externe APIs

| Dienst | Endpunkte | Schlüssel |
|---|---|---|
| **Divera 24/7** (Spec: `api.divera247.com/docs/*.yaml`) | `GET /api/v2/pull/all` (Einheit, `cluster.status`, `statussorting_statusgeber`/`_alarm`, `status.status_id`) · `GET /api/v2/alarms` · `POST /api/v2/alarms/confirm/{id}` `{Status:{id,note}}` · `POST /api/v2/statusgeber/set-status` `{Status:{id,note,reset_date,reset_to}}` | `?accesskey=` persönlich; ungültig → 401 |
| **aPager PRO Webhook** (Smart-Home-Paket, Labor → Webhooks) | GET (Query) oder POST (JSON): nur `unit` + `keyword` (Namen in aPager änderbar), ab Android 6.9 ein Aufruf je Einheit; `event=recall\|clear` bei Rückalarm/Alarmende (laut Home-Assistant-Integration). **Keine** Alarmtexte/Adresse (Alamos überträgt sie nie). Mehrere Aufrufe → ein Einsatz mit `units[]` | – |
| **aPager PRO** (Alamos) | `GET alamos-backend.ey.r.appspot.com/fe2/feedback/user/external?authToken&mode=accept\|reject[&suppressNotification=true]` – 200 ok, 204 kein Alarm (3 min), 403 Schlüssel, 409 kein Abo | aPager → Verfügbarkeit → Externer Zugriff |
| **Voice Monkey** | `GET https://api-v3.voicemonkey.io/trigger?token&device` (Routine) · `GET …/announce?token&device&speech&voice&chime&language&text_display` (Ansage, Gerät = „Speaker“) | Token aus voicemonkey.io |
| **Discord RPC** (nur Windows) | Named Pipe `\\.\pipe\discord-ipc-0…9`, Handshake `{v:1, client_id}`, `SET_ACTIVITY` (`src-tauri/src/discord.rs`) | Application-ID aus discord.com/developers (kein Geheimnis) |
| **Shelly** | Gen2/3 `/rpc/Switch.Set`, `/rpc/Light.Set`; Gen1 `/relay/0?turn=` | – |
| **Hue Bridge** (API v1) | `POST /api {devicetype}` nach Knopfdruck → Schlüssel; `PUT /api/<key>/lights/<id>/state`, `/groups/<id>/action` | Schlüssel aus Koppeln |
| **WLED / Tasmota** | `POST /json/state` · `/cm?cmnd=Power On\|Dimmer 40` | – |
| **FRITZ!Box** (AHA-HTTP) | `GET/POST /login_sid.lua?version=2` (PBKDF2, ab FRITZ!OS 7.24) → SID · `/webservices/homeautoswitch.lua?switchcmd=getdevicelistinfos\|sethkrtsoll&ain=&param=` (16–56 = 8–28 °C in 0,5-Schritten, 253 aus, 254 an) | FRITZ!Box-Benutzer mit Recht „Smart Home“ (Kennwort in `shared.wifi`) |
| **Shelly BLU Gateway Gen3** | `/rpc/Shelly.GetComponents` (`blutrv:200`…) · `/rpc/BluTrv.GetStatus?id=200` · `/rpc/BluTrv.Call?id=200&method="TRV.SetTarget"&params={"id":0,"target_C":17}` | – |
| **SYBOS** | keine offene Schnittstelle für Mitglieder (syBOS-Webservices nur mit Berechtigung der Verwaltung, liefern Einsatzarchiv). Nur Mitlesen der Benachrichtigung. | – |

Android-Paketnamen: SYBOS `at.syPhone`, aPager PRO `org.xcrypt.apager.android2`, Divera über „Erkennen“ in der App.

## Daten & Einstellungen

| Wo | Inhalt | Synchronisiert? |
|---|---|---|
| `settings.js` (localStorage `heimalarm.settings.v1`) | Betrieb, Verbindung, Alarm (Kennung, Quellen, Filter), PC, Gerät, Theme, App-PIN, Android, `divera` (Accesskey!), `apager` (Schlüssel!), `direct` (Code, gekoppelte PCs) | nur `SYNC_KEYS` = `alarm`, `notify`, `ui` (Kennung bleibt je Gerät), nur mit Zentrale |
| `shared.js` (`heimalarm/config/shared` bzw. localStorage `heimalarm.shared.local`) | Personen, Routinen, Standort, Bereitschaft (`readiness {mode: ready|away|absent, until}` + abgeleitet `vacation`), Webhook-Schlüssel, Admin-PIN-Hash, `voice`, `wifi` (Geräte), `voicemonkey.token`, `common` (synchronisierte Einstellungen) | mit Zentrale an alle Geräte; ohne Zentrale nur lokal |
| Dienst `DEFAULTS` (`zentrale/dienst/src/index.js`) | Standardwerte derselben gemeinsamen Daten | – |
| `localStorage heimalarm.divera.seen` | bereits gesehene Divera-Alarme | – |
| `localStorage heimalarm.stats.v1` | **Einsatz-Logbuch** (`core/stats.js`): jede echte eigene Alarmierung `{id, ts, who, source, sources[], keyword, unit, text, address, diveraId, app, details{}, answer, answerTs, device, via, vehicle, role, note, edited, deleted}`, max. 1000. Anzeige: Protokoll → Einsätze (Detail, Notizen, Statistik, Art, Jahresrückblick, CSV) | ja: mit Zentrale `heimalarm/einsaetze/<kennung>` (retained), ohne über `/config`; zusammengeführt, nicht ersetzt |
| `settings.features` | Zusatzfunktionen, **Standard aus**: `logbuch`, `stats` (braucht Logbuch). Abgeglichen (in `SYNC_KEYS`). Sichtbarkeit über `has.logbuch()` / `has.stats()` | ja |
| `localStorage heimalarm.sync.ts` | Zeitstempel der Abgleich-Bereiche (ohne Zentrale) | – |

Routine (gleiches Format in App und Dienst; Aktion `announce` = Alexa-Ansage `{device, speech, voice, chime, show}`, Text mit Platzhaltern `{stichwort} {adresse} {einheit} {uhrzeit} {quelle} {person} {text}` → `fillTemplate` in `wifi.js`):
`{ id, name, enabled, who:[kennung], trigger:{type: alarm|time|readiness|device|manual, at, days:[1..7], to, device, property, value}, conditions:{mode: and|or, items:[{type: time|weekday|sun|home|readiness|keyword|unit, …}]}, actions:[{type: device|heat|group|delay|restore|voicemonkey|announce|divera|readiness|webhook|publish, …}], restoreAfterMin }`
Aktion `heat` = `{ device, mode: set|off, temp }` → Zigbee-Payload `{ occupied_heating_setpoint }` bzw. `{ system_mode: "off" }` (`heatPayload` in `wifi.js`); gilt für Zigbee, Matter (Thermostat-Cluster in `matterctl.js`) und WLAN-Thermostate. Die Zentrale liest den Sollwert von WLAN-Thermostaten vor dem Umstellen (für „Wieder da“).
- `divera {who, statusId, statusName, note, resetMin, resetTo}` – mit Zentrale nur mit dort hinterlegtem Schlüssel, ohne Zentrale nur für die eigene Kennung. `readiness {mode, untilAt:"HH:MM"}` setzt `shared.readiness`. `webhook {url, method}`.
- „Nicht verfügbar/Abwesend“ pausiert **nur Routinen „Bei Alarm“** – Zeit-, Bereitschafts- und Geräte-Routinen laufen weiter.
Aktion `device` schaltet ein WLAN-Gerät, wenn ein Gerät mit diesem Namen in `shared.wifi` steht, sonst Zigbee.

## Vorsicht bei Änderungen

Diese Stellen hängen zusammen – eine Seite ändern heißt die andere mitziehen:

- **`app/src/core/wifi.js` ⇄ `zentrale/dienst/src/wifi.js`** sind dieselbe Datei. Immer beide ändern (kopieren). Enthält auch `fillTemplate` und `voiceMonkeyAnnounce`.
- **Discord-Status** (`core/discord.js`, `views/discord.js`, `src-tauri/src/discord.rs`): nur Windows, Einstellungen lokal in `settings.discord`. Hört auf die Ereignisse `alarm`, `answer` (aus `engine.decide`) und `restore` („Wieder da“). `engine.decide` wartet bis 3 s auf `presenceSettled()`, damit der Status vor dem Ruhezustand rausgeht. Laufender Einsatz in localStorage `heimalarm.discord.active`. Zeiten an Discord in Sekunden; `status_display_type` steuert den Text in der Mitgliederliste.
- **Tasten vor dem Ruhezustand** (`core/hotkeys.js`, `views/hotkeys.js`, `src-tauri/src/hotkeys.rs`): `pc.hotkeys {enabled, waitSec, rules:[{id, exe, name, keys, on}]}`, lokal je PC. Rust `window_list` (sichtbare Fenster, exe klein, `elevated`) und `send_hotkey` (Fenster nach vorn + `SendInput`). Tasten-Schreibweise `Ctrl+Shift+S`, Namen in `hotkeys.rs → vk`. Läuft in `engine.decide` nach „Medien stoppen“, vor Discord/Ruhezustand. Braucht windows-sys-Feature `Win32_Security` (Admin-Erkennung).
- **Home Assistant** (`zentrale/dienst/src/hass.js`): Konfiguration `shared.hass` (auch im Dienst-`DEFAULTS`). Entity-IDs (`heimalarm_einsatz_alle`, `heimalarm_alarm` …) nicht umbenennen – Automationen der Nutzer hängen daran. Discovery nutzt `default_entity_id` (`object_id` ist in HA veraltet).
- **Selbsttest** (`zentrale/dienst/src/selftest.js`): Zeitplan in `shared.selftest {enabled, days:[1..7] (1 = Montag), at:"HH:MM", esp, apps, zigbee}`, Standard sonntags 10:00. Steht in `sharedDefaults` (App) und als `SELFTEST_DEFAULTS` im Dienst – beide gleich halten. Einstellen unter Einstellungen → Zentrale (Admin); Zigbee wird nur geprüft, wenn Zigbee2MQTT schon einmal gemeldet war. „Jetzt ausführen“ (`heimalarm/cmd/selftest`) geht auch, wenn der Zeitplan aus ist.
- **Routinen-Format** wird in `views/routines.js` gebaut und von `zentrale/dienst/src/rules.js` **und** `core/routines-local.js` ausgeführt. Neue Aktion/Bedingung in allen dreien.
- **Gemeinsame Daten:** neues Feld in `shared.js` (`sharedDefaults`) **und** Dienst `DEFAULTS`. Der Dienst übernimmt die Konfiguration flach (`{...DEFAULTS, ...cfg}`) – verschachtelte Objekte immer komplett schreiben.
- **Alarm-JSON** (`alarm/<kennung>`, `POST /alarm`): `parseAlarm` gibt es in `core/mqtt.js` und `zentrale/dienst/src/index.js`; `engine.js` und `rules.js` lesen `keyword`, `unit`, `test`, `probe`, `diveraId`.
- **Status-LED** (`esp32/led/logik.yaml`): App liest `text_sensor/led_typ` (rgb | einfarbig) und zeigt danach Farbe/Helligkeit/Modus oder nur an/aus (`views/settings.js` → `ledSection`, Tabelle `LED_EVENTS` = Tabelle in der ESP32-Anleitung, beide gleich halten). App sendet `alarm/<k>/led/status` (Bereitschaft, retained, `core/readiness.js`) und `alarm/<k>/led/test` (test | demo).
- **Alarm halten (Handy):** Zentrale weg → echter App-Alarm wird bis `alarm.holdSec` (Standard 60, max 120) gehalten und mit `{held, from}` nachgereicht; das sendende Handy ignoriert den eigenen (`from`). Ohne Zentrale: PC nicht erreicht → PC macht nichts, Einsatz bekommt `pcMissed`.
- **ESP32-Topics** (`alarm/<kennung>/…`) kommen aus `esp32/alarm-ich.yaml` bzw. `alarm-ich-s3.yaml` (`topic_prefix`, beide gleich halten). Umbenennen bricht App-Anzeige, Warnungen und Selbsttest.
- **Links nach außen** (`<a href="https://…">`) öffnet die WebView nicht selbst: `main.js` fängt Klicks ab und gibt sie an `@tauri-apps/plugin-opener` (`openUrl`, Recht `opener:default`).
- **MQTT-Verbindung** (`core/mqtt.js`): `timerVariant: "native"` ist Pflicht – der Standard nutzt einen Worker aus einer `blob:`-URL, den die CSP blockiert; dann kommt kein Ping an und Mosquitto trennt alle 1,5 × keepalive. Feste clientId + `clean: false`: verpasste QoS-1-Alarme kommen nach dem Wiederverbinden; nachgelieferte Alarme lösen nur aus, wenn die Lücke < 2 min war.
- **Melder zuerst, Infos danach:** Folgesignale in der Sperrzeit ergänzen den laufenden Einsatz (`engine.js` → `mergeInfo`, Ereignis `alarm-update`): Vollbild, Systemmeldung und Discord ziehen Stichwort/Ort nach; Einsatz speichert Zeitversatz je Quelle (`srcAt`).
- **HTTP aus der App** geht nur zu Adressen im Scope von `capabilities/default.json`. Neue externe API → Scope ergänzen, sonst schlägt `fetch` still fehl.
- **Benachrichtigungen mitlesen** (`AlarmListener.kt`): Titel (groß), Kurztext, Langtext (`EXTRA_BIG_TEXT`), Zeilen (`EXTRA_TEXT_LINES`), Unter-/Zusatztext – zusammengefügt als `text`. Einsatzdetails kommen nur aus Alarm-Apps (Divera-API am meisten, aPager/SYBOS über die Benachrichtigung), der ESP32 liefert nur „Kontakt zu“.
- **Alarm-Infos:** Alles, was eine Quelle mehr liefert, kommt als `details` (nur einfache Werte, ≤ 1500 Zeichen) ins Alarm-JSON – Divera (`pickDetails` in `divera.js`), Webhook (alle weiteren Parameter, `webhook.js`). Neue Felder mit eigener Bedeutung in `FIELDS` von `stats.js` aufnehmen.
- **Sicherheit Zentrale:** Mosquitto nur mit Passwort (`zentrale/.env`, Vorlage `.env.example`); Dienst und Zigbee2MQTT bekommen es per Umgebungsvariable.
- **Webhook-Schlüssel** (Zentrale `shared.webhookSecret`, PC `direct.hookKey`): 32 Hex-Zeichen aus `crypto.getRandomValues` (`secretKey()` in `core/shared.js`). Vergleich in fester Zeit (Dienst: `timingSafeEqual`, Rust: `same()` in `direct.rs`). Webhook der Zentrale sperrt eine Adresse nach 10 falschen Schlüsseln für 5 Minuten (429), wie der PC-Empfänger.
- **Sicherheit PC-Empfänger:** nach 10 falschen Codes ist eine IP 5 min gesperrt (429); `POST /pair` nur, solange am PC „Koppeln erlauben“ läuft (Rust `direct_pairing`, 5 min, schließt nach einer Kopplung).
- **Backup** enthält Schlüssel/Passwörter/Codes nur mit Schalter „mitsichern“; beim Wiederherstellen bleiben vorhandene Schlüssel erhalten. **Protokoll** schwärzt `accesskey=`, `authToken=`, `token=` usw. (`core/log.js`).
- **Abgleich ohne Zentrale:** Neue Einstellung, die abgeglichen werden soll → in einen Bereich von `core/sync.js` einordnen; was je Gerät bleiben muss, in `PC_LOCAL` bzw. aus `bundle()` heraushalten. `direct.rs` und `direct.js` gehören zusammen (Endpunkte, Events `direct-alarm|config|pair|seen`).
- **Kennung** (`core/kennung.js`): nur `a–z`, `0–9`, `-` (max. 32). Eingaben in Einstellungen (Meine Kennung, Personen, „Abfrage auch bei Alarm von“) laufen durch `normalizeKennung`. Standard bleibt `ich` (passt zur ESP32-YAML), die App warnt dann. Gleiche Regel in YAML-Kommentaren und Doku.
- **Test-Begriffe** einheitlich: Testalarm, Testmodus, „Melder-Alarm nachspielen“ (`simulateContact`, `test:true`) und „Generalprobe“ (`fullProbe`, `probe:true`). Nicht „Probe“ allein – das Wort meint bei Einsatzkräften den Probealarm. Erklärtabelle in `views/diagnose.js`.
- **Bestätigungen am PC** (`ui/form.js → ask`): Windows nutzt `@tauri-apps/plugin-dialog` (`confirm`, Rechte in `capabilities/desktop.json`, Plugin nur `cfg(desktop)` in `lib.rs`), Android den Dialog in der Seite.
- **Mauszeiger:** kein `cursor: pointer` auf Knöpfen, Schaltern, Zeilen (wirkt sonst wie eine Webseite). Nur Textlinks zeigen die Hand (`base.css`).
- **Keine Konzept-Nummern (A3, D5 …) und keine Fachwörter (MQTT, WebSocket, Dienst) in sichtbaren Texten.** Nummern nur in Code-Kommentaren.
- **Rust-Befehle** müssen in `lib.rs` → `generate_handler!` stehen; Namen in JS (`invoke("…")`) gleich halten.
- **Android-Plugin:** Kotlin-Name `heimalarm`, Event `notification` `{app, title, text}` – wird in `core/android.js` abgehört.
- **Sperrzeit** prüft `engine.js` (App) und `rules.js` (Dienst) getrennt; `routines-local.js` verlässt sich auf `engine.js`.
- **Einrichtung:** Erster Start springt auf `#/einrichtung`, außer es ist schon etwas eingerichtet (dann `wizard.done` automatisch). Neue Funktion mit eigener Einrichtung → Schritt in `core/wizard.js` (`plan()`, `check()`) und Anleitung in `views/wizard.js` (`guide()`) ergänzen. Klickwege fremder Apps stehen als Nachbau in `ui/guide-shots.js` – bei App-Updates prüfen (aPager-Pfad noch unbestätigt).
- **Sichtbarkeit:** Neue Karten/Seiten über `has.*` in `features.js` freischalten, sonst erscheinen sie auch bei Nutzern ohne diese Ausstattung.
- **Betriebsart:** `isConfigured()` ist nur im Zentrale-Betrieb wahr. Code, der „ist eine Zentrale da?“ fragt, nutzt `has.pi()` bzw. `isConfigured()`, nicht nur `broker.host`.
- **Windows-Update:** `install_update` startet das Setup direkt mit `/P /UPDATE /R` (früher über eine abgelöste PowerShell, die beim Beenden verloren ging; ab 0.1.7).
- **Updates (wie RigCheck):** `core/update.js` fragt beim Start und alle 6 h `releases/latest` ab (404 = noch kein Release), sucht `*-setup.exe` bzw. `*.apk` plus `<datei>.sha256`. Windows: Rust `install_update` lädt per PowerShell, prüft SHA256, startet das Setup mit `/P` und danach die App neu. Android: Plugin `install_apk` lädt, prüft, öffnet den System-Installationsdialog (FileProvider `UpdateFileProvider`, Erlaubnis `REQUEST_INSTALL_PACKAGES`). Beide laden nur von `github.com/Type-1-Diabetes/Heimalarm/releases/download/`. Der Release-Workflow muss die `.sha256`-Dateien mit hochladen, sonst bricht das Update ab.
- **Android-Signierschlüssel:** Secret `ANDROID_DEBUG_KEYSTORE` (base64 eines Keystores, Alias `androiddebugkey`, Passwörter `android`) wird im Workflow nach `~/.android/debug.keystore` geschrieben. Ab 0.1.24 baut der Workflow eine **Release-APK** (nicht debugbar, R8 verkleinert) und signiert sie mit `zipalign` + `apksigner` mit genau diesem Schlüssel – so gehen Updates weiter über die alten Debug-Versionen (gleiche App-ID `de.heimalarm.app`, gleiches Zertifikat). Fehlt das Secret, bricht der Build ab. Schlüssel niemals wechseln oder verlieren. Neue Plugin-Klassen, die per Reflection laufen, stehen über `plugins/heimalarm/android/consumer-rules.pro` unter Schutz vor R8.
- **Mehrere PCs:** Jeder PC entscheidet selbst – `own` (eigene Kennung) oder `pc.alsoFor` (weitere Kennungen, lokal, nicht synchronisiert) → „Fährst du?“. Ohne Zentrale schickt das Handy an alle `direct.peers`.
- **ESP32-Schalter aus der App:** `alarm/<kennung>/switch/alarm_bei_offen/command` (ON = Alarm, wenn der Kontakt öffnet; bleibt gespeichert) und `…/switch/kontakt_test/command` (ON = Kontakt-Test: kein ALARM, endet nach 10 min). Roher Kontakt: `…/binary_sensor/kontakt/state` (ON = geschlossen) → `state.devices[k].contact`. Alle drei YAMLs gleich halten. Ältere Firmware meldet `contact` nicht – die App zeigt dann „ältere Firmware“.
- **ESP32-Neustart:** sinkt `uptime`, schreibt `mqtt.js` „ESP32 neu gestartet“ ins Protokoll (Hinweis auf Kabel an RST beim S3).
- **ESP32-S3-Log:** `logger: hardware_uart: UART0` in `alarm-ich-s3.yaml`, damit das Log an der Buchse COM/UART erscheint.
- **Matter-Speicher** (`zentrale/dienst/data/matter`) enthält die Kopplungen. Löschen = alle Alexa/Google-Kopplungen weg.
- **Matter-Steuerung** (`zentrale/dienst/src/matterctl.js`): eigene `Environment` mit eigenem `StorageService` → `data/matter-ctl` (getrennt von `voice.js`; „Kopplungen löschen“ für die Sensoren berührt die gesteuerten Geräte nicht und umgekehrt). Startet nur, wenn dort schon etwas liegt oder gekoppelt wird. Namen in `data/matter-ctl/heimalarm.json`. Geräte heißen wie Zigbee-Geräte über den Namen (eindeutig gegen Zigbee/WLAN) und melden Zustand im Zigbee-Format in `ctx.devices` → Routinen (`switchDevice`), „Wieder da“ und Geräte-Auslöser brauchen keinen Sonderfall. App: `setDevice()` schickt an Matter, wenn der Name ein Matter-Gerät ist. Eigene Bridges (Heimalarm, Matterbridge) werden beim Koppeln abgewiesen (Schleife). Braucht `@project-chip/matter.js` (gleiche Version wie `@matter/main`). Kein Bluetooth-Koppeln: neue Geräte erst in Alexa/Google einrichten. Live-Test nur am Pi (`docker compose exec dienst node tools/matter-selftest.mjs /tmp/mt`).
- **Alarmton:** `ui/sound.js` ist die einzige Stelle, die Töne startet. Windows → Rust `sound_*` (spielt auch bei verstecktem Fenster), Android → Plugin `play_sound`/`show_alarm` (Wecker-Lautstärke, `USAGE_ALARM`), Browser → Web Audio. Ton `""` = eingebauter Melder-Ton (in `sound.rs` und `AlarmSound.kt` gleich erzeugt – beide ändern). Eigene Töne liegen nur auf dem Gerät (PC: `<AppData>/sounds`, nur mp3/wav/ogg/flac; Handy: `files/sounds`), werden nicht synchronisiert.
- **„Fährst du?“ auf mehreren Monitoren:** `takeover.js` sendet jede Sekunde `takeover-state`, `mirror.js` antwortet mit `takeover-answer`. Fensterlabels `takeover-<n>` müssen in `capabilities/default.json` → `windows` stehen. `finish()` läuft genau einmal (Sperre `done`).
- **Alarm am Handy:** eigener Alarm → `emit("takeover")` auch am Handy (Rückmeldung per Knopf), dazu `phoneAlarm()` → Vollbild-Meldung, Vibration, optional Ton. Laufzeit = `phone.durationSec`. Ohne Antwort keine Rückmeldung.
- **Nach Neustart (Android):** `BootReceiver` startet den Dienst. Läuft die WebView nicht, prüft `AlarmListener` mit den Filtern aus `configure` (aus `settings.alarm`, siehe `configureNative()`), puffert (10 min) und öffnet die App per Vollbild-Meldung; `initAndroid()` holt den Puffer mit `pending_notifications` ab. Filterlogik in `Native.matches` grob gleich halten wie `alarmFromNotification`.
- **Cleartext (Android):** `res/xml/heimalarm_network.xml` im Plugin erlaubt http/ws für alle Ziele (Android kann nicht nach IP-Bereich filtern). Gilt auch für signierte Release-APKs.
- **Android 17 – Heimnetz-Berechtigung:** Ab `targetSdk` 37 sperrt Android 17 das lokale Netz (Zentrale, PC, WLAN-Geräte → nur Timeout), bis `ACCESS_LOCAL_NETWORK` erlaubt ist. Die Tauri-Vorlage setzt 37; `release.yml` stellt nach `tauri android init` auf 36 zurück. Abfrage (`request_local_network`) und Manifest-Eintrag sind eingebaut – targetSdk erst anheben, wenn auf echtem Android-17-Gerät geprüft.
- **CSP** in `tauri.conf.json`: Skripte nur aus der App, `connect-src` offen für Heimnetz. Inline-`<script>` oder fremde Skript-Quellen gehen nicht mehr.
- **Einstellungen neu zeichnen:** Abschnitte mit `part()` (PC, Android, Personen, Alexa, Zentrale, Sicherheit, Backup, Updates) zeichnen nur sich selbst neu. Ändert ein Abschnitt, was andere zeigen, normales `rerender` (ganze Seite) nutzen.
- **WebView2 im Hintergrund:** `additionalBrowserArgs` in `tauri.conf.json` schaltet die Timer-Drosselung versteckter Fenster ab (sonst trennt die Zentrale den PC alle ~90 s, weil MQTT-Pings ausbleiben). `takeover.rs` → `BROWSER_ARGS` muss **genau gleich** sein – WebView2 erlaubt keine unterschiedlichen Argumente im selben Programm. MQTT `keepalive: 120` als zusätzliche Sicherheit.
- **Divera-Alarme** kommen aus `GET /api/v2/pull/all` → `data.alarm` (geht mit jedem gültigen Schlüssel); `/api/v2/alarms` nur als Rückfall – eigene API-Schlüssel dürfen das oft nicht (403). Fehler tragen Endpunkt, HTTP-Code, Divera-Meldung und Hinweis (`DiveraError.detail`) ins Protokoll.
- **Protokoll = Fehlersuche:** Verbinden, Trennen (mit Grund, `explainMqttError`), Wiederverbinden, jeder Prüfschritt mit Ergebnis und Hinweis (`checkup.js` → `why()`), PC erreichbar/nicht. Neue Verbindungen bitte genauso protokollieren. Die Pille auf Start zeigt „Fehlgeschlagen: …“, solange irgendwo etwas live nicht klappt (`failedNow()`), nicht nur nach dem letzten Check.
- **Im Hintergrund:** Windows schließt per X nur das Fenster (Symbol im Infobereich, `lib.rs` → `setup_tray`); Autostart startet mit `--im-hintergrund` verborgen; zweiter Start holt das Fenster per Single-Instance nach vorn. Android: Vordergrund-Dienst + einmalige Abfrage der Akku-Ausnahme (`android.batteryAsked`). Nach einem Neustart startet der `BootReceiver` den Dienst (siehe „Nach Neustart“).
- **Safe-Area (Handy):** `core/android.js` fragt die Insets beim Start mehrfach ab (sie sind anfangs oft 0) und bei Größenänderung; bis dahin gelten über `:root.is-android` Mindestabstände (28/48 px). Abstände zu Status-/Navigationsleiste nur über `--safe-top`/`--safe-bottom` (tokens.css). Die Android-App setzt `--inset-top/-bottom` aus den Fenster-Insets (`HeimalarmPlugin.kt`), weil die WebView `env(safe-area-inset-*)` oft als 0 meldet.
- **Handy bei Alarm** (`phone.mode`: `heimalarm` · `app` · `off`, alt `phone.silent`): `engine.js` → Ereignis `phone-open-app` → `android.js` → Plugin `open_alarm_app`. Kotlin `PhoneActions.kt` merkt sich das Tipp-Ziel der Alarm-Benachrichtigung (`AlarmListener`) und öffnet es; ohne Recht „Über anderen Apps einblenden“ nur, wenn Heimalarm sichtbar ist (sonst Vollbild-Meldung → `onResume` reicht weiter). Zusatz: „Nicht stören“ (Zugriff nötig), Taschenlampe, Bildschirm an, Navigation bei „Ich fahre“ (`phone.station`). Native-Werte gehen per `configure` an `Native.kt`, damit es auch ohne laufende App klappt.
- **Plugin-Befehle:** Was JS am Heimalarm-Plugin aufruft (auch `registerListener` für `addPluginListener`), muss in `plugins/heimalarm/build.rs` → `COMMANDS` und in `permissions/default.toml` stehen, sonst „not allowed“.
- **`run()` in lib.rs** braucht `#[cfg_attr(mobile, tauri::mobile_entry_point)]` direkt darüber, sonst scheitert der Android-Build.
- **Android-Symbole** liegen fertig in `src-tauri/icons/android` (adaptiv: weißes Haus auf `#C42D21`) und werden im Release-Workflow kopiert – nicht mit `tauri icon` überschreiben.
- **Version** steht nur in `app/package.json` (Tauri liest sie von dort); Dienst-Version in `zentrale/dienst/src/index.js` (`VERSION`) und `package.json`.
- **CI** (`release.yml`): Android nutzt das vorinstallierte SDK/NDK des Runners (kein setup-android). Keine Test-/Lint-Schritte hinzufügen (Regel oben).

## Anleitungen (PDF)

Quelle: `docs/anleitungen/quelle/` – `uebersicht.html`, `esp32.html`, gemeinsames `stil.css` (gleiche Farben/Ecken wie die App), gemeinsame Seiten in `teile/` (PC, Handy, Testen – `{{inc:name|schlüssel=wert}}`), Symbole `{{i:name}}`. Bauen: `python3 docs/anleitungen/quelle/build.py` (Playwright + Chromium). Jede `<section class="page">` ist eine A4-Seite mit fester Höhe – nach Änderungen die PDFs ansehen, ob nichts abgeschnitten ist. Screenshots in `docs/screenshots` kommen aus `npm run dev` mit `?demo`. **Bei Änderungen an Menünamen oder Abläufen in der App die Anleitungen mitziehen.**

## Design-System

Farbwelt **„Leitstelle, lebendig“**: ruhig und kontrastreich, Signalrot nur für Alarm und Hauptaktion, jeder Bereich mit eigener Farbe (Symbol, Balken, Zeitleiste). Dunkel ist Standard. Ecken 8/12/16 px, Schalter und Chips als Pillen.

Start (`views/overview.js`, `styles/home.css`): Status-Karte **Aktiv / Verbindet / Nicht verfügbar / Abwesend**. Unten die **Bereitschaft** (`core/readiness.js`): Verfügbar · Nicht verfügbar (gelb, `--warn`) · Abwesend (violett, `--c-absent`). Die beiden letzten fragen per `ui/until-picker.js` (Schnellwahl, Kalender, Uhrzeit) „bis wann?“ und springen danach von selbst auf Verfügbar (`initReadiness`, Dienst prüft `readiness.until` in `rules.js`). `shared.vacation` bleibt als Ja/Nein daneben – `engine.js`, `rules.js`, Discord, `routines-local.js` lesen es (App über `readiness()`, das abgelaufene Zeiten schon als verfügbar zählt). „Verbindet“ erst nach 10 s Trennung (`checkup.js`, `offlineSince()`). Darunter eine Pille: „Verbunden“, rot „Verbindung fehlgeschlagen“ oder während „Verbindet“ der laufende Check aus `core/checkup.js` (eine Zeile wie im Terminal). Die Pille liegt absolut in einem festen Platzhalter (`.stslot`) – nichts darf sich durch ihren Text verschieben. Symbole aus `ui/icons.js`. Einstellungs-Bereiche: `PAGES` in `views/settings.js` (neuer Abschnitt → einem Bereich zuordnen, in `BUILD` eintragen und – falls gerätegebunden – in `AVAILABLE`).
Schriftgrößen: mindestens 14 px (Labels), Hilfstexte 15 px, Fließtext 16 px.

| Token | Hell | Dunkel | Einsatz |
|---|---|---|---|
| `--bg` | `#f4f2ee` | `#0e1013` | Hintergrund |
| `--surface` | `#ffffff` | `#171a1f` | Karten, Navigation |
| `--line` | `#e2ddd4` | `#2c313a` | Linien |
| `--text` / `--text-2` | `#16181d` / `#4c525d` | `#f1f2f4` / `#a3aab5` | Text / Hilfstext |
| `--signal` | `#c42d21` | `#e5432f` | Alarm, Hauptknopf |
| `--ok` | `#24704a` | `#4cc287` | Verbunden, online |
| `--warn` | `#8f5d0e` | `#e9a945` | Warnungen |
| `--info` | `#2c5a88` | `#7cb0e4` | Hinweise, Fokus |
| `--radius-lg` / `--radius` / `--radius-sm` | 16 / 12 / 8 px | | Status-Karte / Karten / Knöpfe, Felder |
| `--c-alarm` `--c-net` `--c-pc` `--c-phone` `--c-people` `--c-voice` `--c-safe` `--c-app` | je Bereich | | Symbol-Kacheln, Balken, Zeitleiste |

Schrift: **Archivo** (Text, Titel), **JetBrains Mono** (Topics, Uhrzeiten, Codes) – in `app/public/fonts`. Logo: Haus mit Funkwellen auf Signalrot, `docs/logo.svg`. README-Grafiken (`docs/*.svg`) nutzen dieselben Farben und passen sich hell/dunkel an.

## Fahrplan

| Stufe | Inhalt | Stand |
|---|---|---|
| 1 | ESP32, Mosquitto-Zentrale, App-Grundgerüst | ✅ |
| 2 | Windows: „Fährst du?“, Ruhezustand, Autostart | ✅ |
| 3 | Zigbee2MQTT + Zentralen-Dienst: Routinen, Licht | ✅ erste Version |
| 4 | Handy: Geräte anlernen, steuern, Routinen | ✅ erste Version |
| 5 | Android: Benachrichtigungen mitlesen, Hintergrund-Dienst, Webhook | ✅ auf echtem Gerät zu prüfen |
| 6 | Alexa & Google über Matter (Sensoren + Matterbridge) | ✅ Kopplung am Pi zu prüfen |
| 6b | Matter-Geräte aus Alexa/Google/SmartThings in Heimalarm steuern (`matterctl.js`) | ✅ am Pi mit echtem Gerät zu prüfen |
| 7 | Alarmquellen wählbar, Divera-API, aPager-Rückmeldung | ✅ mit echtem Zugang zu prüfen |
| 8 | Nur zeigen, was eingerichtet ist | ✅ |
| 9 | Ohne Zentrale: Handy↔PC, WLAN-Geräte, Routinen auf dem Handy, Voice Monkey | ✅ mit echten Geräten zu prüfen |

## Funktionsliste – Einschränkungen

Nummern wie im früheren Konzept (A–I, nur noch in Code-Kommentaren). Alles in erster Version umgesetzt, außer:

- **Windows-Signatur:** optional über Secrets `WINDOWS_CERTIFICATE` (base64 .pfx) + `WINDOWS_CERTIFICATE_PASSWORD`; ohne warnt SmartScreen.
- **E2 Widget:** kein echtes Android-Widget; Ersatz: Karte „Schnellaktionen“ („Wieder da“, Routinen „Nur per Knopf“).
- **D5 Ton:** nativ mit eigener Lautstärke und eigenem Ton; Windows-Lautstärke wird angezeigt und kann bei Alarm angehoben werden (`pc.raiseSystem`, danach zurück).
- **A10 Firmware-Update:** braucht eine `.ota.bin` im Heimnetz plus MD5.
- **C10 Netzwerkkarte:** Tabelle statt Grafik. **H4 App-Sperre:** PIN, dazu optional Fingerabdruck (Android) bzw. Windows Hello.
- **F4 Updates:** prüft GitHub-Releases (Repo ist öffentlich).
- **Ohne Zentrale:** kein ESP32, kein Zigbee (außer über Hue Bridge), kein Google Home, keine Bedingung „Jemand zuhause“, kein „Vorher-Zustand“.
- **Koppeln Handy↔PC:** per Adresse + Kopplungscode (kein QR-Scan); danach eigener Code je Handy.
- **Optionale Funktionen sind Standard aus:** Logbuch, Statistik, Rückmeldung an Divera (`divera.answer`, `divera.setStatus`) und aPager (`apager.feedback`). Neue Zusatzfunktion → Schalter unter Einstellungen → Funktionen bzw. bei der Quelle, Standard `false`.
- **App-Sperre biometrisch:** `core/biometric.js` – Android `tauri-plugin-biometric` (nur mobile Abhängigkeit, Recht in `capabilities/mobile.json`), Windows Hello über Rust-Befehl `windows_hello` (`windows`-Crate 0.62 wie Tauri). PIN bleibt immer Rückfall (`lock.biometric`).
- **Abgleich-Intervall** ohne Zentrale: `sync.intervalSec` (Standard 120 s), einstellbar unter Einstellungen → Dieses Handy.
- **Handy-Layout:** Dialoge `max-height: 100%` im Raster der `.dialog-wrap` (Safe-Area-Abstand), `overscroll-behavior: none` auf html/body (sonst zieht der Android-Gummiband-Effekt die feste Leiste unten mit). „So läuft ein Alarm“ ist aufklappbar.
- **Anleitungen:** `docs/anleitungen/*.pdf` (Quellen nicht im Repo; bei Änderungen an Abläufen aktualisieren).
- **Layout:** volle Breite am Monitor (`--content-max: none`), Seiten auf PC und Handy identisch.
- **Einsatz-Logbuch:** derselbe Einsatz auf zwei Geräten wird an der Zeit erkannt (± 2 min). Löschen bleibt als Markierung gespeichert, damit der Abgleich ihn nicht zurückholt. Art (Brand, TH, RD …) wird aus dem Stichwort erraten (`CATEGORIES`).

| Bereich | Wo in der App |
|---|---|
| Betrieb, Kopplung | Einstellungen → Betrieb & Koppeln |
| A Alarmeingang | Einstellungen → Alarmquellen, Melder (ESP32), Kennung & Sperrzeit · `engine.js` |
| B Routinen | Seite Routinen (Dienst bzw. Handy führt aus) |
| C Licht & Geräte | Seite Geräte (WLAN, Zigbee) |
| D Windows-PC | Einstellungen → „Fährst du?“, Vor dem Ruhezustand, Discord · Vollbild-Abfrage |
| E Handy | Übersicht, Protokoll, Einstellungen → Handy bei Alarm, Hintergrund & Rechte, Dieses Handy |
| F Zentrale | Einstellungen → Zentrale, Sicherheit & Backup · Protokoll → Zentrale |
| G Personen | Einstellungen → Personen, Sicherheit · Routinen „Für wen“ |
| H Sicherheit | Einstellungen → Zentrale, Sicherheit & Backup |
| I Test & Diagnose | Einstellungen → Kennung & Sperrzeit (Testalarm) · Test & Diagnose |
| Sprachassistenten | Einstellungen → Alexa, Google & HA |

## Prüfen (lokal, nicht in CI)

```bash
cd app && npm install
npm run lint                 # Oxlint – muss 0 Befunde haben
npm run dev                  # http://localhost:1420/?demo – Beispieldaten
npx tauri dev                # als Windows-Programm
cd src-tauri && cargo check  # Rust (ohne GTK unter Linux: cargo check --target x86_64-pc-windows-gnu, braucht mingw-w64)

cd zentrale/dienst && npm install
npm run devbroker                          # Test-Broker (Terminal 1)
MQTT_URL=mqtt://127.0.0.1:1883 npm start   # Dienst (Terminal 2)
node tools/sim.js                          # ESP32/Zigbee-Simulator (Terminal 3) – App mit 127.0.0.1 verbinden

esphome config esp32/alarm-ich.yaml        # ESP32-Konfiguration
git tag vX.Y.Z && git push --tags          # Release (.exe + .apk)
```

Nicht in der Cloud-Testumgebung prüfbar: Matter (braucht IPv6/mDNS), echte Android-Benachrichtigungen, Windows-PC-Aktionen.

## Offene Punkte / Hinweise

- Relaiskontakt der Ladeschale vor dem Anschluss messen (potentialfrei?). Sonst Optokoppler. Anschluss TPG2200: Steckklemme; keine Litze in Dupont-Buchsen (WAGO 221 dazwischen).
- Android: Akku-Optimierung trotz Hintergrund-Dienst ausschalten (Einstellungen → Android).
- Neu und am echten Gerät zu prüfen: Ton/Vibration/Vollbild am Handy, Neustart-Puffer, Zweitmonitor-Fenster, Fokus-Trick, eigener Ton (Kotlin ist ohne Android-SDK nicht lokal geprüft).
- Android-APK ist **debug-signiert**; fester Signierschlüssel als GitHub-Secret folgt.
- Divera: Status-Namen aus `pull/all` mit echtem Zugang prüfen; Divera-App-Paketname per „Erkennen“.
- Teilen von Alarmen zwischen Haushalten: Idee, nicht geplant.
