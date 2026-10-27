# Dashboard (Alarmmonitor auf weiterem Monitor) – Plan

Stand: 27.10.2026 · Status: gebaut (Editor, Dashboard-Fenster, alle Kacheln) – Test am echten Windows-PC und mit echtem Divera-Schlüssel offen

## Entscheidungen

| Frage | Antwort |
|---|---|
| Wo läuft es? | Windows-App, auf einem weiteren Monitor am selben PC (kein Fernseher). Eigenes Vollbild-Fenster auf diesem Monitor |
| Bedienen? | Anzeigen und minimal bedienen (z. B. „Mein Divera-Status“, Bereitschaft, Einsatz beenden) |
| Bei Alarm | Eigene Alarm-Ansicht je Dashboard (wie Alarmmonitore: Ruhe- und Alarm-Perspektive), ebenfalls frei zusammengestellt. „Einsatz beenden“ oder Zeitablauf schaltet zurück |
| Wie viele? | Mehrere Dashboards, jedes mit eigenem Raster |
| Aufbau | Alles frei platzierbar, festes Raster 12 × 6, Größe je Kachel wählbar, keine feste Leiste |
| Abstand | Schreibtisch, ca. 1 m |
| Farbschema | Folgt der App (hell/dunkel) |
| Bearbeiten | In der App am Hauptmonitor (neuer Menüpunkt „Dashboard“), der Monitor zeigt nur an |
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

## Bau-Log

### Schritt 1 – Datenmodell (`app/src/core/dashboard.js`)
- Dashboards liegen in `settings.dashboards`, nur auf diesem PC (kein Abgleich mit dem Handy).
- Je Dashboard zwei Ansichten `ruhe` und `alarm`, Kacheln `{ id, type, x, y, w, h, opts }` im Raster 12 × 6.
- Neues Dashboard startet mit dem Aufbau aus dem Mockup. Überlappen und Kacheln außerhalb des Rasters werden verhindert, jede Kachelart hat eine Mindestgröße.

### Schritt 2 – Divera-Daten (`app/src/core/divera-board.js`, `refreshBoard()` in `divera.js`)
- Quelle: `/api/v2/pull/all`, dazu `/api/v2/alarms` für die Rückmeldungen (fällt still weg, wenn der Schlüssel es nicht darf).
- Feldnamen **ungeprüft gegen echte Daten** (Doku nicht erreichbar), übernommen aus DiveraControl und kp-front:
  `cluster.consumer` (Namen), `cluster.vehicle[].fmsstatus_id`, `monitor["1"][status].all`, `events`/`news` als `{ items, sorting }`, `alarm.items[].ucr_answered { status: { ucr: { ts } } }`, `ucr_addressed`.
- Absage wird am Statusnamen erkannt („nicht“, „kein“, „abwesend“, „verhindert“) – „Komme nicht“ zählt also nicht als Zusage.
- **Zu prüfen mit echtem Schlüssel:** Kommen Namen, Fahrzeuge und Verfügbarkeit an? Sonst Feldnamen in `divera-board.js` anpassen.

### Schritt 3 – Kacheln (`core/board.js`, `ui/tiles.js`, `styles/dashboard.css`)
- `core/board.js` sammelt alles in einem Schnappschuss (läuft nur im Hauptfenster): Alarm, Haushalt-Antworten, Bereitschaft, Systemstatus, Divera, Logbuch, Statistik, Protokoll, Geräte, Routinen, Wetter.
- Ein Einsatz gilt fürs Dashboard als laufend ab Alarm (eigener oder Person im Haushalt) bis „Einsatz beenden“ oder „Zurück nach“ (Minuten).
- Wetter: Bright Sky (`api.brightsky.dev`, DWD-Daten, ohne Schlüssel), Standort aus `shared.location` (Einstellungen → Zentrale → Standort). Abfrage nur, wenn eine Wetter-Kachel existiert und ein Dashboard läuft.
- Divera wird fürs Dashboard alle 60 s geholt, bei Alarm alle 15 s (Rückmeldungen) – nur solange Editor oder Dashboard-Fenster offen sind.
- Raster immer 1920 × 1080, per `transform: scale` aufs Fenster gebracht → Editor-Vorschau = Monitor-Bild.
- Kacheln passen ihren Inhalt an die Größe an (Zeilenzahl aus der Höhe, einzeilige Uhr/Wetter ohne Kopfzeile).
- Getestet mit Beispieldaten im Browser: keine Fehler, kein Überlauf (Ruhe, Alarm, hell, dunkel).

### Schritt 4 – Dashboard-Fenster (`tv.html`, `src/tv.js`, `core/tvlink.js`, `src-tauri/src/tv.rs`)
- Gleiches Muster wie „Fährst du?“ auf Zweitbildschirmen: Das Hauptfenster hält Verbindung und Logik, das Dashboard-Fenster zeichnet nur. Keine zweite App-Instanz, also keine doppelten Divera-Abfragen und kein Port-Konflikt.
- Rust-Befehle `tv_screens` (Bildschirme mit festem Schlüssel aus Position) und `tv_open(id, screen, on)` (randlos, Vollbild, nicht in der Taskleiste). Fehlt der gewählte Bildschirm, nimmt es den ersten, der nicht der Hauptbildschirm ist.
- Events: `tv-state` (Schnappschuss + Dashboards + Alarm-Ansicht ja/nein), `tv-action` (Bedienung), `tv-ready`.
- Mauszeiger bleibt sichtbar (Arbeitsmonitor, über den man mit der Maus fährt). Das Fenster holt sich nie den Fokus.
- Bekannt: Bei Alarm legt sich „Fährst du?“ (Countdown) auch über den Dashboard-Monitor. Danach erscheint die Alarm-Ansicht. Absichtlich so gelassen.
- `cargo check` grün (Linux; Windows-spezifischer Code unverändert).

### Schritt 5 – Editor (`views/dashboard.js`, Menüpunkt „Dashboard“, nur Windows-Programm)
- Links: Dashboards, darunter Anzeige (Name, Bildschirm, „Auf dem Bildschirm zeigen“, „Bei Alarm umschalten“, „Zurück nach“, Löschen).
- Mitte: Umschalter Ruhe/Alarm, Vorschau = echtes Monitor-Bild (Alarm-Ansicht mit Beispiel-Einsatz), darüber Bearbeitungsebene: freie Felder gestrichelt, Kachel ziehen = verschieben, Ecke = Größe, Palette per Klick oder Ziehen.
- Tastatur: Pfeile verschieben, Umschalt + Pfeile ändern die Größe, Entf entfernt.
- Rechts: gewählte Kachel – Größe, Inhalt (Notiz: Überschrift/Text, Bild: Datei, auf 600 px verkleinert), „Auch in Ruhe/Alarm“, Entfernen.
- „Alarm-Ansicht testen“ schaltet die Dashboard-Fenster 60 s auf einen Beispiel-Einsatz (ohne „Fährst du?“, ohne Zentrale-Aktionen).
- Beim Hinzufügen: Standardgröße, sonst die größte, die noch frei ist.
- Uhr und Notiz wachsen mit der Kachelgröße.

### Schritt 6 – Prüfung
- Getestet im Browser mit nachgebildetem Tauri: Editor (anlegen, wählen, Entf, hinzufügen, Größe per Tastatur und Ziehen), Dashboard-Fenster (Zustand empfangen, skalieren, hell/dunkel, Knopf schickt Aktion). Keine Fehler in der Konsole.
- `vite build`, `oxlint` (keine neuen Hinweise), `cargo check` grün.
- Design-Detektor: nur der blinkende ALARM-Punkt (gewollt, aus bei „Bewegung reduzieren“).

## Offen / beim ersten echten Einsatz prüfen
1. Am Windows-PC: Öffnet das Dashboard-Fenster auf dem richtigen Bildschirm im Vollbild? Startet es nach einem Neustart von Heimalarm wieder?
2. Mit echtem Divera-Schlüssel: Namen bei Rückmeldungen, Verfügbarkeit, Fahrzeuge, Termine, Mitteilungen (Feldnamen siehe Schritt 2).
3. Wetter: Standort unter Einstellungen → Zentrale → Standort muss stimmen.
4. Nicht gebaut (bewusst): Einsatzkarte, Fahrzeit zum Gerätehaus.

### Korrektur 27.10.
- „Fernseher“ war gemeint als **weiterer Monitor am PC**. Texte angepasst, Mauszeiger wird nicht mehr ausgeblendet. Technik unverändert (war schon ein Fenster auf einem weiteren Monitor). Interne Namen (`tv.html`, `tv-*`) bleiben.
