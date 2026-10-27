# Dashboard (TV-Vollbild) – Plan

Stand: 27.10.2026 · Status: Mockup fertig (`docs/mockups/dashboard.html`), Abstimmung läuft

## Entscheidungen

| Frage | Antwort |
|---|---|
| Wo läuft es? | Windows-App, auf dem PC, an dem der Fernseher hängt. Eigenes Vollbild-Fenster auf dem TV-Bildschirm |
| Bedienen? | Anzeigen und minimal bedienen (z. B. „Mein Divera-Status“, Bereitschaft, Einsatz beenden) |
| Bei Alarm | Eigene Alarm-Ansicht je Dashboard (wie Alarmmonitore: Ruhe- und Alarm-Perspektive), ebenfalls frei zusammengestellt. „Einsatz beenden“ oder Zeitablauf schaltet zurück |
| Wie viele? | Mehrere Dashboards, jedes mit eigenem Raster |
| Aufbau | Alles frei platzierbar, festes Raster 12 × 6, Größe je Kachel wählbar, keine feste Leiste |
| Abstand | Schreibtisch, ca. 1 m |
| Farbschema | Folgt der App (hell/dunkel) |
| Bearbeiten | In der App am Hauptmonitor (neuer Menüpunkt „Dashboard“), der TV zeigt nur an |
| Vorbild | Feuerwehr-Alarmmonitore: Alamos AMweb (Ruhe-/Alarm-Perspektive mit Widgets), Divera-Monitor, Einsatzmonitor v2 |
| Nicht bauen | Einsatzkarte, Fahrzeit zum Gerätehaus |

## Datenquellen

| Quelle | Lesen | Schreiben | Grenze |
|---|---|---|---|
| Divera (`/api/v2/pull/all`, `/api/v2/alarms`) | Alarme (Titel, Text, Adresse, Priorität), Rückmeldungen je Person, eigener Status, Verfügbarkeit je Status (Anzahl), Fahrzeuge mit FMS-Status, Termine, Mitteilungen | eigener Status, Rückmeldung, FMS (nur mit Rechten) | nur, was der persönliche Accesskey sehen darf |
| aPager PRO Webhook | `unit`, `keyword`, `event` (recall/clear) | – | kein Text, keine Adresse, keine Rückmeldungen anderer |
| aPager PRO API | – | Zusage/Absage (Alarme der letzten 3 min) | Smart-Home-Abo, Verfügbarkeit nicht lesbar |
| Heimalarm | Alarm, Antworten im Haushalt, Bereitschaft, Logbuch, Statistik, Geräte, Systemstatus | Bereitschaft, Routinen, Einsatz beenden | – |

Offen: genaue Divera-Feldnamen prüfen (offizielle Doku war aus der Entwicklungsumgebung nicht erreichbar). Quellen: github.com/moehrem/DiveraControl, github.com/sebiweise/home-assistant-alamos, help.divera247.com (v2/pull).

## Kacheln

| Kachel | Quelle | Bedienen |
|---|---|---|
| Aktueller Alarm (bei Alarm Vollbild) | Heimalarm, Divera, aPager | Einsatz beenden |
| Uhr / Datum | – | – |
| Mein Divera-Status | Divera | Status setzen |
| Bereitschaft | Heimalarm | umschalten |
| Wer fährt? (Haushalt) | Heimalarm | – |
| Rückmeldungen der Wehr | Divera | – |
| Verfügbarkeit der Einheit | Divera | – |
| Fahrzeuge (FMS) | Divera | FMS setzen (mit Rechten) |
| Termine | Divera | – |
| Mitteilungen | Divera | – |
| Systemstatus | Heimalarm | – |
| Letzte Einsätze | Logbuch | – |
| Statistik (Zahl / Verlauf / nach Art) | Logbuch | – |
| Geräte | Heimalarm | optional schalten |
| Routinen (nächste, Knöpfe) | Heimalarm | Routine starten |
| Protokoll | Heimalarm | – |
| Wetter + Unwetter | DWD / Open-Meteo | – |
| Notiz | Freitext | – |
| Logo / Bild | Upload | – |

## Nächste Schritte

1. Mockup-Datei (1:1, statisch) → Design und Layout abstimmen
2. Danach: Umsetzung in der App
