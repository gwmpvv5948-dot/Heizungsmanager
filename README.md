# Heizungsmanager Wohnzimmer · 0.1.5

Quellcode: [gwmpvv5948-dot/Heizungsmanager](https://github.com/gwmpvv5948-dot/Heizungsmanager). Versionsübersicht: [CHANGELOG.md](CHANGELOG.md).

Erste lokal laufende Home-Assistant-Custom-Integration für das Wohnzimmer. Planung, Lernwerte und Steuerung laufen im HA-Prozess, ohne KI-Server, Cloud-KI oder zusätzliche Python-Pakete. Die ausgewählte Wetterintegration kann Internet benötigen. Auch die verwendete Midea-Integration muss selbst lokal arbeiten, damit die gesamte Gerätesteuerung ohne Cloud funktioniert; das wurde hier nicht geprüft.

## Enthalten

- Getrennte Komfortzeiten für Mo–Fr (**06:20**) und Sa–So (**08:00**). Gemeint ist: Bis dahin soll es warm sein.
- Konfigurierbare Komforttemperatur **21 °C**, Nachttemperatur **18 °C**, Nachtbeginn **22:00**. Dies sind vorläufige Startwerte.
- Gemeinsames Vorheizen mit Midea und Heizkörpern, maximal 120 Minuten vorher. Die Heizkörper dürfen bei Bedarf noch bis 45 Minuten nach Komfortbeginn unterstützen. Bei erreichter Zieltemperatur werden sie zurückgenommen. Danach hält die Midea die Temperatur im Heizmodus. Ihr eigener Regler bestimmt Kompressorleistung und tatsächliche Laufzeit.
- Ein Fahrplan über die nächsten 24 verstrichenen Stunden, alle 10 Minuten: Temperaturprognose, Solltemperatur, Heizphasen, Begründungen und verwendete Wetterbasis.
- Ein kleines lernendes thermisches Modell je Wärmequelle; kein Sprachmodell. Lernwerte werden lokal dauerhaft gespeichert.
- Terrassentür mit 30 Sekunden Verzögerung, manuelle Geräteänderungen mit Automatikpause und sichtbare Fehlerzustände.
- Betriebsarten Beobachten / Automatik / Aus.

## Installation

1. Den Ordner `custom_components/heizungsmanager` aus dem ZIP in `/config/custom_components/` der HA-Installation kopieren. Danach muss `/config/custom_components/heizungsmanager/manifest.json` existieren. Nicht den gesamten Projektordner als Integration kopieren.
2. Home Assistant neu starten.
3. **Einstellungen → Geräte & Dienste → Integration hinzufügen → Heizungsmanager** öffnen.
4. Die vorgeschlagenen WZ-Entitäten prüfen und eine Wetterentität auswählen, die auf **Dresden** eingestellt ist und möglichst stündliche Vorhersagen anbietet. Die Integration legt keinen Wetteranbieter an und ändert dessen Standort nicht.
5. Optional einen gemessenen Midea-Leistungssensor in W oder kW zuordnen. Den im Dashboard vorhandenen tatsächlichen Stromzähler gegenüber einem geschätzten VTherm-Energiesensor bevorzugen.
6. Die Integration startet im **Beobachtungsmodus**. Sie berechnet den Fahrplan und lernt aus geeignetem vorhandenen Betrieb, verändert aber keine Geräte.

### Eigener Menübereich und Einstellungen

Nach dem Einrichten erscheint **Heizungsmanager** als eigener Menüpunkt. Er enthält **Heiz-Fahrplan** und **Einstellungen**. Im Einstellungsreiter sind sämtliche Gerätezuordnungen, Wochenzeiten, Temperaturen, Morgenunterstützung, Türverzögerung und Zeitgrenzen direkt bearbeitbar. Die Betriebsart ist dort ebenfalls auswählbar. Speichern wird serverseitig validiert und dauerhaft in HA gesichert; der Manager wechselt dabei in den Beobachtungsmodus. Ungespeicherte Änderungen bleiben beim Wechsel der beiden Reiter erhalten. Der Menübereich und seine Konfigurations-API sind nur für HA-Administratoren zugänglich.

### Optionale Fahrplan-Karte

Im Dashboard unter Ressourcen eine JavaScript-Modul-Ressource hinzufügen:

```text
/heizungsmanager-static/heizungsmanager-card.js?v=0.1.4
```

Dann eine manuelle Karte anlegen:

```yaml
type: custom:heizungsmanager-card
entity: sensor.heizungsmanager_wz_fahrplan
mode_entity: select.heizungsmanager_wz_betriebsart
```

Die tatsächlichen Entitäts-IDs unter Geräte & Dienste prüfen; HA kann bei Namenskollisionen einen Suffix vergeben. Ohne `mode_entity` bleibt die Karte eine reine Anzeige. Die Betriebsart lässt sich auch über eine normale Entitätenkarte ändern.

Zeitpläne, Temperaturen, Sensoren und Zeitgrenzen werden direkt unter **Heizungsmanager → Einstellungen** geändert; alternativ über **Geräte & Dienste → Heizungsmanager → Konfigurieren**.

## Zuordnung der vorhandenen Geräte

| Rolle | Vorbelegung |
|---|---|
| Raumtemperatur | `sensor.wz_temp` |
| Türkontakt | `binary_sensor.wz_terasse` |
| Midea-Regler | `climate.wz_midea_ac` |
| Heizkörper-Regler | `climate.wz_vtherm` |
| Heizkörper darunter | WZ1 und WZ2, weiterhin durch VTherm geregelt |
| Wetter | Bei Einrichtung für Dresden auswählen |

Der Manager steuert die beiden VTherm-Entitäten. Er schreibt nicht gleichzeitig direkt auf die darunterliegenden Ventile oder das Midea-Gerät. Bestehende Tür- und Gerätefunktionen von VTherm bleiben aktiv.

## Vor dem automatischen Betrieb

Bestehende WZ-Sollwertautomationen und Climate-Scheduler-Zeitpläne prüfen und konkurrierende Sollwertvorgaben deaktivieren. Das bestehende Heizungsdashboard darf weiter für manuelle Änderungen verwendet werden. Der Manager erkennt geänderte Betriebsarten oder Solltemperaturen seiner beiden VTherm-Entitäten nach einer kurzen Befehlswartezeit und pausiert dann standardmäßig 120 Minuten. Türzustandswechsel werden davon getrennt behandelt. Änderungen direkt am darunterliegenden Midea-Gerät werden nur erkannt, wenn VTherm sie weitergibt.

Mit **Automatik** übernimmt der Manager die Sollwerte. Tagsüber hält die Midea die Komforttemperatur. Nachts bleibt sie aus und startet erst unter der eingestellten Nachttemperatur. Bei 18 °C und der standardmäßigen Hysterese von 0,3 °C gilt: Start unter 18 °C, wieder aus ab 18,3 °C. Während des Nachheizens liegt der Geräte-Sollwert etwas höher, damit die am gemeinsamen Raumsensor überwachte Abschaltschwelle erreicht wird. Heizkörper werden außerhalb des Morgenfensters ausgeschaltet. Eine automatische Heizkörper-Zuschaltung tagsüber bei WP-Ausfall ist noch nicht enthalten; Gerätefehler werden angezeigt.

**Nach jedem HA-Neustart, Neuladen der Integration oder Speichern von Einstellungen startet Version 0.1.3 erneut im Beobachtungsmodus.** Es werden dann keine neuen Sollwerte gesendet. Bereits eingestellte Gerätezustände bleiben bestehen, bis ein anderer Regler oder der Benutzer sie verändert. Auch beim Entfernen der Integration werden keine Geräte abgeschaltet.

**Aus** sendet `off` an beide Regler. Der Manager selbst bietet in diesem Modus keinen Frostschutz. Bei ungültiger/veralteter Raumtemperatur oder unbekanntem Türstatus fordert die Automatik ebenfalls `off` für beide Geräte an; eine technisch nicht erreichbare Anlage kann sie nicht abschalten. Im Beobachtungsmodus gelten diese Eingriffe nicht, da dort niemals gesteuert wird.

## Gemeinsame Raumtemperatur seit 0.1.3

`wz_temp` und der lokale Ikea-Sensor bilden die gemeinsame Raumtemperatur: **75 % KNX + 25 % Ikea**. Im Einstellungsreiter sind beide Sensoren, die Gewichtung, Korrekturwerte und eine zeitabhängige exponentielle Glättung (Zeitkonstante standardmäßig 3 Minuten; 0 = aus) konfigurierbar. Korrekturen starten bei 0 °C. Der Außenwandeinfluss wird nicht automatisch kompensiert. Die berechneten Nachkommastellen erhöhen nicht die Messgenauigkeit.

Der Wert erscheint prominent als Raumtemperatur und wird für Fahrplan, Lernmodell und Entscheidungen des Managers verwendet. Zusätzlich steht er als `sensor.heizungsmanager_wz_raumtemperatur` bereit. Rohwerte, korrigierte Werte, konfigurierte und tatsächlich verwendete Gewichte sowie Ausschlussgründe sind über die Sensorattribute sichtbar; die wichtigsten Werte werden direkt im Fahrplan angezeigt.

Bei Ausfall, veraltetem oder ungültigem Messwert einer Quelle übernimmt die andere zu 100 %. Bei fehlenden Quellen wird der Raumwert unverfügbar; ein alter geglätteter Wert wird nicht als gültige Messung weiterverwendet. Nach Start oder Quellenwechsel wird die Glättung auf die gültige Basis gesetzt und das Lernen mindestens 10 Minuten pausiert. KU- und Netatmo-Sensoren werden nicht einbezogen.

Damit die darunterliegenden VTherm-Regler denselben Wert nutzen, wird bei ihnen ebenfalls dieser berechnete Sensor als Raumtemperatursensor ausgewählt; nicht den berechneten Sensor wieder als Eingabe des Managers wählen.

## Was das Modell wirklich lernt

Die Startgleichung ist:

```text
Temperaturänderung pro Stunde =
  - Wärmeverlustfaktor × (Raumtemperatur - Außentemperatur)
  + effektiver Midea-Heizbeitrag × Midea-Aktivität
  + effektiver Heizkörperbeitrag × Ventilanforderung
```

Nur plausible Intervalle von 5–20 Minuten ohne geöffnete Tür, Sensorfehler oder manuelle Pause werden verwendet. Passive Abkühlung verbessert den Verlustfaktor. Betrieb einer einzelnen Wärmequelle verbessert ihren effektiven Beitrag. Während beide Quellen gemeinsam laufen, werden ihre Beiträge nicht einzeln gelernt. Deshalb kann das Heizkörpermodell bei ausschließlich gemeinsamem Morgenbetrieb lange auf Startwerten bleiben. Das ist in der Karte sichtbar.

Midea-Aktivität wird aus `hvac_action` oder optional gemessener Leistung abgeleitet. Die Heizkörperaktivität ist eine Ventilanforderung und keine Messung zugeführter Wärme. Die Prognose berücksichtigt weder Sonneneinstrahlung noch alle internen Wärmequellen ausdrücklich. Ein Startzeitpunkt ist eine Schätzung; bei maximaler Vorheizzeit kann das Komfortziel unerreichbar bleiben. Es gibt keine Garantie einer bestimmten Temperatur oder Energieeinsparung.

Die Lernqualität zeigt die vorhandene Datenabdeckung, kein statistisches Konfidenzintervall. Bei fehlendem Wetter wird die aktuelle Außentemperatur fortgeschrieben. Fehlt auch diese, verwendet nur die Prognose eine ausdrücklich markierte Annahme von 5 °C; das Lernen pausiert. Ungültige Midea-Außenwerte wie 102,5 °C werden nicht verwendet.

## Transparenz und Grenzen der ersten Version

- Die Grafik ist eine Prognose. Gemessene Raumtemperatur und aktueller Sollwert stehen separat darüber.
- Türöffnungen, zukünftige manuelle Eingriffe und Geräteausfälle sind nicht vorhersagbar. Bei einer aktuellen Pause zeigt die Grafik ausdrücklich den angenommenen Normalbetrieb nach der Pause.
- Keine Kosten-, COP- oder kWh-Prognose. VTherm-Schätzwerte werden nicht als Verbrauchsmessung ausgegeben.
- Keine zentrale Kesselsteuerung, PV-Kopplung, Anwesenheitssteuerung oder Feiertagskalender in 0.1.3.
- Die Morgenphase wird alle 30 Sekunden anhand aktueller Temperatur neu bewertet. Die Darstellung löst in 10-Minuten-Schritten auf.
- Lernmodell und die letzten 144 Messpunkte werden in HA `.storage` gespeichert, spätestens alle 15 Minuten und beim regulären Entladen. Die großen Fahrplanattribute werden nicht in Recorder aufgezeichnet.

## Vorschau und Prüfung

`preview.html` zeigt die echte Karte mit klar gekennzeichneten **Beispieldaten**, ohne Verbindung zur Heizung. `vorschau.jpg` ist die geprüfte Desktopdarstellung.

```sh
python3 -m unittest discover -s tests -v
python3 -m compileall -q custom_components
node --check custom_components/heizungsmanager/frontend/heizungsmanager-card.js
```

Geprüft: 30 Modell-, Steuerungs-, Temperatur- und API-Tests sowie Python- und JavaScript-Syntax. Die Steuerungstests verwenden HA-Service-Doubles. Version 0.1.3 wurde am 03.11.2026 in der vorhandenen HA-Installation installiert und im Beobachtungsmodus eingerichtet. Live geprüft: eigene Menüseite, vollständiger Einstellungsreiter, Speichern und Wiederladen der Konfiguration, Wetterquelle Dresden-Stadt sowie Menüposition direkt unter Strommanager. Ein automatischer Heizversuch wurde noch nicht durchgeführt.

### Nachtregelung seit 0.1.4

Die Nachttemperatur ist eine Einschaltschwelle. Ohne Unterschreitung bleibt die Midea aus. Der Fahrplan zeigt Nachtpausen und Nachheizphasen getrennt. Die Hysterese ist unter Einstellungen → Wunschtemperaturen konfigurierbar. Nach einem Neustart startet ein Nachheizzyklus nur bei tatsächlicher Unterschreitung; es wird kein laufender Nachtzyklus wiederhergestellt. Der Beginn des gemeinsamen morgendlichen Vorheizens und die Regelung tagsüber bleiben erhalten.

### Live-Prüfung 0.1.3

In HA installiert und geprüft: 75/25-Gewichtung, beide Quellen mit aktuellen Messwerten, Anzeige des gemeinsamen Raumwerts, Speichern der neuen Konfiguration und Nutzung durch beide WZ-VTherm-Regler. Bei `WZ VTherm` und `WZ Midea AC` ist `sensor.heizungsmanager_wz_raumtemperatur` als Raumtemperatursensor gespeichert. Der Manager bleibt im Beobachtungsmodus. Die zwischenzeitlich vom Benutzer konfigurierte Komforttemperatur wurde beibehalten.

Seit 0.1.5 sind die Details zur gewichteten Raumtemperatur standardmaessig eingeklappt. Die Raumtemperatur selbst bleibt prominent sichtbar; Einzelwerte, Gewichte und Glaettung sind unter Temperatursensoren und Berechnung abrufbar.
