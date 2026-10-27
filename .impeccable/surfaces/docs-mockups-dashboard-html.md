---
version: 1
slug: "docs-mockups-dashboard-html"
primary_target: "docs/mockups/dashboard.html"
related_targets: []
---

# Dashboard (TV-Alarmmonitor)

Scope: TV-Vollbild-Dashboard auf zweitem Bildschirm am Windows-PC (ca. 1 m) plus Editor in der App. Mode: Operate.

Aufgabe: auf einen Blick Lage, eigener Status, Wehr-Rückmeldungen. Bei Alarm wechselt der Bildschirm in eine eigene Alarm-Ansicht. Alles frei platzierbar im 12×6-Raster, mehrere Dashboards, je zwei Ansichten (Ruhe, Alarm) wie bei Feuerwehr-Alarmmonitoren (AMweb, Divera-Monitor). Theme folgt der App. Bearbeitet wird in der App am Hauptmonitor.

Offen: genaue Divera-Feldnamen.

## Direction contract

THESIS: Ein Alarmmonitor für zuhause mit zwei Perspektiven (Ruhe, Alarm) statt eines generischen Kachel-Dashboards; der Bildschirm ist das Werkzeug, nicht die Deko.
OWN-WORLD: Heimalarm „Leitstelle, lebendig“: dunkle Flächen #0e1013/#171a1f, Flächen statt Linien, Signalrot nur für Alarm, feste Bereichsfarbe je Quelle (Heimalarm, Divera, Wehr, Haus), Archivo schmal-fett für Zahlen und Stichworte, JetBrains Mono für Zeiten.
STORY: Ruhe: Uhr, eigener Status, Verfügbarkeit, Termine lesen, Status mit einem Klick setzen. Alarm: Stichwort, Adresse, Zeit seit Alarm, wer kommt.
FIRST VIEWPORT: TV 1920×1080 im 12×6-Raster, Kacheln mit Kopfzeile (Bereichsfarb-Symbol + Titel), keine Leiste. Alarm: Alarmkachel 8×4 links oben, Rückmeldungen 4×4 rechts.
FORM: Freies Raster mit Ruhe-/Alarm-Perspektive (Nutzerwunsch, ersetzt die drei gewürfelten Strukturen). seed:49167189e4307a61
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
