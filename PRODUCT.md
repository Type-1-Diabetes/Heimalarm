# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users
Einsatzkräfte (Feuerwehr, Rettungsdienst, Wasserwacht, Katastrophenschutz), die zuhause alarmiert werden, und ihr Haushalt. Sie nutzen Heimalarm am Windows-PC und am Android-Handy; die Zentrale läuft auf NAS, Mini-PC oder Raspberry Pi.

## Product Purpose
Heimalarm gibt Einsatz-Alarme zuhause weiter: „Fährst du?“-Vollbild am PC mit Ruhezustand danach, großer Alarm am Handy, Licht und Sprachassistenten. Erfolg heißt: Bei Alarm wird nichts verpasst und der PC ist in Sekunden aus.

## Positioning
Läuft lokal im Heimnetz und kostet nichts. Verbindet Melder in der Ladeschale (ESP32), SYBOS, aPager PRO und Divera in einer App. Cloud-Dienste nur, wenn man sie selbst einschaltet.

## Operating Context
Alarm kommt jederzeit, oft nachts. Der Nutzer reagiert in Sekunden. Einrichtung läuft einmalig Schritt für Schritt. Ein TV-Dashboard läuft auf einem Bildschirm am PC (Schreibtisch, ca. 1 m Abstand).

## Capabilities and Constraints
- Zwei Betriebsarten: mit Zentrale (MQTT) oder ohne (Handy ↔ PC direkt).
- Tauri-App (Windows) und Android-App aus derselben Web-Oberfläche (Vanilla JS, kein Framework).
- Heimalarm ist eine Komfortfunktion; Melder und Alarm-App bleiben die eigentliche Alarmierung.
- Sprache: Deutsch, du-Form.

## Brand Commitments
Name Heimalarm, Logo `docs/logo.svg`. Signalrot nur für Alarm und Hauptaktion. Schriften Archivo und JetBrains Mono.

## Evidence on Hand
Screenshots in `docs/screenshots/`. Keine Kundenstimmen oder Zahlen vorhanden; nichts erfinden.

## Product Principles
1. Bei Alarm zählt jede Sekunde: das Wichtigste groß, nichts im Weg.
2. Lokal zuerst, Cloud nur auf Wunsch.
3. Ehrlich über Grenzen (was ohne Zentrale nicht geht, was eine Quelle nicht liefert).
4. Einfache Sprache, kurze Texte.

## Accessibility & Inclusion
Mindestschriftgröße 14 px in der App. Lesbar aus der Entfernung und nachts.
