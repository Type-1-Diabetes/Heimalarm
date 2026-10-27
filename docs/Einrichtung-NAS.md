# Einrichtung mit NAS als Zentrale

Am Beispiel einer UGREEN NASync DXP2800 (UGOS Pro). Andere NAS mit Docker-Oberfläche, etwa Synology mit dem Container Manager, funktionieren genauso. Nur die Menüs heißen anders.

```
Ladeschale (TPG2200) ──► ESP32 ──WLAN──► NAS (Zentrale) ──► Heimalarm auf allen PCs + Handy, Licht, Alexa
```

---

## 1 · Feste IP für die NAS

Im WLAN-Router (Weboberfläche oder App) die NAS in der Geräteliste suchen und ihr eine feste IP-Adresse geben. Je nach Router heißt das „immer die gleiche IP“, „IP reservieren“ oder „DHCP-Reservierung“. Ohne feste Adresse kann sie sich ändern, und ESP32 und App finden die Zentrale nicht mehr.
Die IP (z. B. `192.168.178.43`) notieren. Du brauchst sie gleich mehrmals.

## 2 · Dateien auf die NAS

1. Am PC auf GitHub *Code → Download ZIP* wählen und entpacken.
2. Auf der NAS die App *Docker* aus dem App Center installieren.
3. In der App *Dateien* unter *Freigegebener Ordner → docker* einen neuen Ordner `heimalarm` anlegen.
4. Den Inhalt des Ordners `zentrale` hineinladen: `docker-compose.yml`, `.env.example` und die Ordner `dienst` und `mosquitto`.
   - Es darf nur eine Compose-Datei dort liegen. Gibt es `docker-compose.yml` und `docker-compose.yaml`, nimmt Docker nur eine davon. Die überzählige löschen.
5. `.env.example` mit dem Editor öffnen (Windows: Rechtsklick → *Öffnen mit → Editor*), bei `MQTT_PASSWORD=` ein langes eigenes Passwort eintragen und als `.env` speichern. **Ohne Passwort startet die Zentrale nicht.**
   - Windows: Beim Speichern *Dateityp → Alle Dateien* wählen, sonst entsteht `.env.txt` und die Zentrale findet die Datei nicht. Prüfen kannst du das im Explorer mit *Ansicht → Dateinamenerweiterungen*.
   - Dieses Passwort brauchst du noch zweimal: in der App (*Einstellungen → Betrieb & Verbindung*, Benutzer `heimalarm`) und im ESP32 (`mqtt_pw` in `secrets.yaml`).
   - `.env` beginnt mit einem Punkt und ist darum versteckt. Im Dateimanager „versteckte Dateien anzeigen“ einschalten, um sie zu sehen.

## 3 · Projekt starten

1. *Docker → Projekt → Erstellen*.
2. Name `heimalarm`, Speicherpfad `docker/heimalarm`. Docker erkennt die vorhandene `docker-compose.yml`.
3. Haken bei „Nach der Erstellung sofort ausführen“ setzen, dann *Bereitstellen*. Der erste Start dauert 3 bis 5 Minuten.
4. Unter *Container* laufen jetzt `mosquitto` und `dienst`.

**Später Dateien geändert?** *Projekt → heimalarm → Compose-Konfiguration → Neu bereitstellen*. Wenn Docker dabei nichts neu baut (leeres Protokoll), unter *Container* den betroffenen Container löschen, danach unter *Image* sein Image, und dann erneut bereitstellen.

**Weitere Profile** sind aus, bis du sie einschaltest: `zigbee` für den Zigbee-Stick, `matter` für Licht in Alexa und Google, `esphome` für die ESPHome-Oberfläche auf Port 6052. Damit baust du den ESP32 im Browser statt über web.esphome.io.

**Port belegt?** In `docker-compose.yml` links vom Doppelpunkt eine andere Zahl eintragen (statt 1883 bzw. 9001) und diese dann in App bzw. ESP32 verwenden.

## 4 · Melder: ESP32

Einkaufsliste: ESP32-S3 DevKitC-1 N16R8 mit verlöteten Stiftleisten, ein USB-C-Kabel, das Daten überträgt (nicht nur Strom), Jumper-Kabel (Buchse–Buchse), ein 2-adriges Kabel (z. B. Klingeldraht), 2 WAGO-Klemmen 221 und ein altes USB-Netzteil.

1. `esp32/secrets.example.yaml` nach `secrets.yaml` kopieren und ausfüllen: WLAN (2,4 GHz), als `mqtt_host` die IP der NAS und ein eigenes `ota_pw`, das du unbedingt änderst. `mqtt_user` bleibt `heimalarm`. Bei `mqtt_pw` kommt dasselbe Passwort hin wie `MQTT_PASSWORD` in `.env`, sonst verbindet sich der ESP32 nie. Sicherer ist ein eigenes Konto nur für die Melder: In `.env` `MQTT_ESP_PASSWORD` setzen und im ESP32 `mqtt_user: "heimalarm-esp"` mit diesem Passwort eintragen. Dieses Konto darf nur Alarme melden und keine Firmware-Updates auslösen.
2. In `alarm-ich-s3.yaml` die `kennung` setzen, z. B. `daniel`, nur aus Kleinbuchstaben, Ziffern und `-`. Dieselbe Kennung kommt später in jede App (siehe Kasten „Kennung“ unten).
3. Am Windows-PC flashen (Schritt 4B der [ESP32-Anleitung](anleitungen/Heimalarm-Einrichtung-ESP32.pdf)): `winget install Python.Python.3.12`, ein neues Fenster öffnen, `pip install esphome`, dann im Ordner `esp32` `esphome run alarm-ich-s3.yaml` starten und den `COM`-Anschluss wählen. Am Board die Buchse COM/UART nehmen.
4. Die Ladeschale hat eine kleine Steckklemme mit runden Löchern für die Drähte und eckigen Schlitzen zum Lösen. Erst mit dem Multimeter prüfen: keine Spannung, bei Probealarm Durchgang. Dann das 2-adrige Kabel einstecken und am anderen Ende per WAGO-Klemme mit zwei Jumper-Kabeln verbinden. Die Litze nicht direkt in die Jumper-Buchse stecken. Ein Jumper kommt an 4 (GPIO4), der andere an GND. Pin 4 liegt direkt neben RST, also genau abzählen.
5. Den ESP32 dauerhaft ans USB-Netzteil hängen.
6. *Test & Diagnose → Kontakt-Test* starten und die Kabelenden verbinden. Die Anzeige muss auf „geschlossen“ springen. Falls der Alarm erst beim Öffnen auslöst: *Einstellungen → ESP32 → „Alarm, wenn der Kontakt“ → öffnet*.

## 5 · Heimalarm auf jedem PC und Handy

Auf jedem Gerät, das reagieren soll, egal wie viele PCs und Laptops:

1. *Einstellungen → Betrieb & Verbindung* → „Mit Zentrale“.
2. Darunter als Adresse die IP der NAS, Port `9001`, Benutzer `heimalarm` und als Passwort `MQTT_PASSWORD` aus `.env` eintragen, dann „Speichern & verbinden“.
3. Unter *Alarm & Quellen* den Melder einschalten. Am Handy nach Wunsch SYBOS, aPager oder Divera dazunehmen.
4. Unter *Alarm* bei „Meine Kennung“ die Kennung des Melders eintragen (z. B. `daniel`).
5. Nur am Handy: unter *Einstellungen → Android* das Mitlesen der Benachrichtigungen erlauben und die Akku-Optimierung ausschalten.

Danach gilt:
- Löst der Melder aus, zeigen alle PCs mit dieser Kennung „Fährst du?“.
- Kommt der Alarm über SYBOS, aPager oder Divera am Handy, meldet das Handy an die Zentrale. Auch dann fragen alle PCs.
- Soll ein gemeinsamer PC bei mehreren Personen ausgehen, unter *Einstellungen → Dieser PC → „Abfrage auch bei Alarm von“* die weiteren Kennungen eintragen.

*Start* zeigt deinen Aufbau als Schaubild und hakt erledigte Schritte ab. Läuft alles, steht oben „Aktiv“ mit der grünen Pille „Verbunden“.

> **Kennung, was ist das?** Ein kurzer Name für eine Person, z. B. `daniel`. Erlaubt sind Kleinbuchstaben, Ziffern und `-`, keine Leerzeichen oder Umlaute. Jede Person bekommt ihre eigene Kennung. Lässt du überall den Standard `ich` stehen, lösen sich mehrere Personen gegenseitig aus.
>
> Dieselbe Kennung muss an all diesen Stellen stehen:
>
> | Wo | Feld |
> |---|---|
> | App auf jedem eigenen PC und Handy | *Alarm & Quellen → Alarm → Meine Kennung* |
> | ESP32 | `kennung:` oben in der YAML-Datei |
> | Weitere Personen | *Einstellungen → Personen* |

## 6 · Testen

1. *Test & Diagnose → Testalarm*: zeigt nur die Abfrage, sonst passiert nichts.
2. *Test & Diagnose → Verbindungstest*: Zentrale und Zentrale-Programm müssen grün sein. Der Melder erscheint als „Melder (ESP32)“.
3. *Kontakt-Test*: zeigt live offen oder geschlossen, ohne Alarm.
4. *Melder-Alarm nachspielen*: läuft wie ein echter Melder-Alarm und geht an alle Geräte. Licht und PC-Aktion bleiben aus, weil es ein Test ist.
5. Ein echter Probealarm in der Ladeschale: Alle PCs fragen „Fährst du?“, das Handy meldet sich.

## Später (optional)

- Licht: unter *Geräte → WLAN-Geräte* oder über Zigbee (USB-Stick bzw. SLZB-06, Profil `zigbee`).
- Alexa: Voice-Monkey-Token unter *Einstellungen → Alexa, Google & HA* eintragen, in Routinen „+ Alexa“ nutzen. Der lokale Weg über Matter (Profil `matter`) ist auf der NAS noch nicht getestet.
- Kollege oder Kollegin: eigener Melder mit eigener Kennung, die Person unter *Einstellungen → Personen* anlegen.
