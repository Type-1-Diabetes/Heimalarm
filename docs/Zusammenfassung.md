# Heimalarm – was bisher gemacht wurde

Stand: 18.10.2026 · Repo: `Type-1-Diabetes/Heimalarm` (öffentlich)

## Ausgangslage

Zwei Einsatzkräfte mit Motorola TPG2200 in der Ladeschale. Alarm kommt über den Melder sowie die Apps SYBOS, aPager PRO und Divera. Ziel: Bei Alarm soll zuhause automatisch etwas passieren. Der PC geht in den Ruhezustand, das Licht an, Alexa oder Google sagen den Einsatz an.

## Konzept

- Anleitungen als PDF in `docs/anleitungen` (Überblick, Einrichtung mit ESP32).
- Entscheidung: eine eigene App „Heimalarm“, ohne Hersteller-Cloud, kostenlos, lokal, Open Source.
- Name und Logo: Heimalarm, ein Haus mit Funkwellen auf Signalrot.

## Gebaut

| Bereich | Stand |
|---|---|
| App für Windows und Android | Tauri 2, Oberfläche in HTML/CSS/JS. Dunkel als Standard, hell wählbar, responsiv, kurze Texte, Ecken minimal gerundet. |
| „Fährst du?“ am PC | Vollbild mit Countdown und Ton. Danach Ruhezustand, Sperren, Herunterfahren oder nichts. Ausnahmen, Ruhezeiten, Medien stoppen, Wake-on-LAN, Autostart. |
| Alarmquellen | Melder (ESP32), SYBOS, aPager PRO, Divera 24/7, auch mehrere gleichzeitig. Die Sperrzeit fasst sie zu einem Einsatz zusammen. |
| Divera | Persönlicher Accesskey: Alarme abfragen, Rückmeldung zum Einsatz, eigenen Status setzen (auch mit Rücksetzen), Status-Karte auf Start. |
| aPager PRO | Mitlesen, Webhook an die Zentrale, Zu-/Absage über die Alamos-API (Smart-Home-Abo nötig). |
| SYBOS | Mitlesen der Benachrichtigung. Recherche: keine offene Schnittstelle für Mitglieder. |
| Zentrale (Docker) | Mosquitto, Heimalarm-Dienst (Routinen, Webhook, Protokoll, Selbsttest), optional Zigbee2MQTT und Matterbridge. |
| ESP32 | ESPHome-Konfiguration für ESP32 (GPIO27) und ESP32-S3 (GPIO4), Mindestdauer, Lebenszeichen, Update per WLAN. |
| Licht & Geräte | Zigbee über die Zentrale; WLAN-Geräte (Shelly, Hue, WLED, Tasmota) mit und ohne Zentrale. |
| Routinen | Auslöser Alarm/Uhrzeit/Gerät/Knopf, Bedingungen (Nacht, dunkel, Wochentag, Stichwort …), pro Person, „Wieder da“, Urlaubsmodus. |
| Alexa & Google | Lokal über Matter (Kontaktsensor „Heimalarm Einsatz“ + Matterbridge) oder Alexa über Voice Monkey. |
| Ohne Zentrale | Handy und PC koppeln sich mit Code im WLAN; Handy meldet Alarme an den PC und führt Routinen aus. |
| Bedienung | Start zeigt Aktiv/Verbindet/Inaktiv und nur, was eingerichtet ist. Einstellungen, Geräte, Routinen und Protokoll in zwei Spalten, Bereichsfarben. Testalarm auf Start und unter Test & Diagnose. Einstellungen gleichen sich zwischen Geräten ab. |
| Test & Diagnose | Testalarm, Melder-Alarm nachspielen, Generalprobe, Verbindungstest, wöchentlicher Selbsttest. |
| Sicherheit | App-PIN, Admin-PIN, API-Schlüssel bleiben auf dem Gerät, keine Geheimnisse im Repo. |
| Doku | README für Nutzer (Grafiken mit/ohne Zentrale, Geräteliste, Einrichtung), `Context.md` für Entwicklung (Ordner, Abhängigkeiten, Schnittstellen, Vorsicht bei Änderungen). |
| Release | GitHub Actions nur bei Tag `v*`: Windows `.exe` + Android `.apk`. Keine Tests im Workflow, damit Bugfix-Releases schnell gehen. |

## Hardware-Entscheidungen

- Zentrale: die vorhandene UGREEN NASync DXP2800 (Intel N100, 8 GB) statt eines Raspberry Pi. Sie reicht locker.
- Melder: ESP32-S3 DevKitC-1 (N16R8) mit Jumper-Kabeln (ELEGOO-Set), Konfiguration in `esp32/alarm-ich-s3.yaml`.
- Zigbee (optional): USB-Stick (Sonoff ZBDongle-E) oder Netzwerk-Koordinator (SLZB-06). Letzterer, weil UGREEN USB in Docker nicht offiziell unterstützt.

## Offen

- Mit echter Hardware prüfen: Koppeln Handy↔PC, Android-Mitlesen, Divera mit echtem Alarm, Matter auf der NAS, WLAN-Geräte.
- NAS-Einrichtung durchspielen (Docker-Projekt, Ports, Zigbee).
- Fester Android-Signierschlüssel; dabei Cleartext-HTTP fürs Heimnetz freigeben.
- Erstes Release `v0.1.0`.
