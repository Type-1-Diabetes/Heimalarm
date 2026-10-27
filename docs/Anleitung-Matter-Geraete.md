# Matter-Geräte in Heimalarm – was du tun musst

Neu: Lampen und Steckdosen, die schon in **Alexa, Google Home, SmartThings oder Smart Life** sind, schaltet jetzt auch die Zentrale. Sie stehen unter **Licht & Geräte**, in Routinen und bei „Wieder da“. Alexa bzw. Google behalten die Geräte.

**Was gleich bleibt:** der Sensor „Heimalarm Einsatz“ für Alexa, sein QR-Code, deine Alexa-Routinen und die Matterbridge. Es kommt kein neuer Container dazu, kein neuer Port, kein neuer Eintrag in `.env`.

---

## 1. Zentrale aktualisieren (ca. 5 min)

**Raspberry Pi** (per SSH):

```sh
cd ~/Heimalarm && git pull && cd zentrale
docker compose up -d --build dienst
```

**UGREEN-NAS:** wie in `docs/anleitungen/Heimalarm-Update.pdf`, Schritt 2 (Dateien hochladen → alten Dienst-Container und das Image löschen → **Neu bereitstellen**).

> Nie löschen: `dienst/data`. Dort liegen die Alexa-Kopplungen (`data/matter`) und ab jetzt die Matter-Geräte (`data/matter-ctl`).

**Geklappt, wenn:** die App unter *Einstellungen → Zentrale* das Zentrale-Programm **0.2.8** zeigt.

## 2. App aktualisieren

Ab Version 0.1.24: auf **Installieren** tippen, auf PC und Handy.

Solange die App alt ist, siehst du die Matter-Geräte nicht. Die Zentrale läuft trotzdem normal weiter.

## 3. Erstes Gerät koppeln (ca. 2 min pro Gerät)

1. In der App: **Licht & Geräte → Matter-Gerät hinzufügen** (links unter „Mehr“).
2. In der App, in der das Gerät schon ist, einen Kopplungscode erzeugen:
   - **Alexa:** Geräte → Gerät öffnen → Zahnrad → „Andere Assistenten und Apps“ → „Neu hinzufügen“
   - **Google Home:** Gerät öffnen → Zahnrad → „Verknüpfte Matter-Apps und -Dienste“ → „App verknüpfen“
   - **SmartThings, Smart Life, Eve …:** beim Gerät „Mit anderer App teilen“ bzw. „Kopplungsmodus“
3. Den Code (11 Ziffern) in Heimalarm eintragen → **Koppeln**. Das dauert bis zu einer Minute.

**Geklappt, wenn:** das Gerät in der Liste steht und auf **An** bzw. **Aus** reagiert.

## Wenn etwas nicht klappt

| Meldung | Lösung |
|---|---|
| „Zentrale aktualisieren“ | Schritt 1 ist noch nicht gemacht oder der Dienst-Container ist noch der alte. |
| „Gerät nicht gefunden“ | Code neu erzeugen (er gilt etwa 15 Minuten). Zentrale und Gerät müssen im selben Heimnetz sein. |
| Thread-Gerät (z. B. Eve, Nanoleaf) wird nicht gefunden | Es braucht einen Thread-Router im Haus (Echo 4, Nest Hub, HomePod). Reine WLAN-Matter-Geräte gehen immer. |
| „Das ist eine Bridge dieser Zentrale“ | Das war der Heimalarm-Sensor oder die Matterbridge. Ihre Geräte sind schon in Heimalarm, nichts zu tun. |
| Gerät ist ganz neu, noch in keiner App | Erst in Alexa oder Google Home einrichten. Heimalarm koppelt nicht über Bluetooth. |
| Smart Life / ELESION ohne Matter-Logo | Geht so nicht. Nur Geräte mit Matter-Logo. |

**Optionaler Test am Pi**, ohne echtes Gerät (er koppelt eine simulierte Lampe):

```sh
docker compose exec dienst node tools/matter-selftest.mjs /tmp/mt
```

Er muss am Ende `lampe onOff true level 127` zeigen. Falls er mit einem Fehler zu Port 5353 abbricht: das ist nur der Test, der sich mit dem laufenden Dienst stößt. Dann direkt mit einem echten Gerät testen.
