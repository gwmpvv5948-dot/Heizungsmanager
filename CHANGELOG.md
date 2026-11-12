## 0.3.39

- Globale Einstellungen mit Tagesdiagramm, frei editierbaren KNX-Phasen, Sommermodus-Schalter und Wärmezählerwerten.

## 0.3.38

- Vier editierbare KNX-Phasen, Ein-/Ausschalter für den HM-Zeitplan und Live-Anzeige des Sommermodus.

## 0.3.37

- Globale Einstellungen mit zentralem KNX-Stellantrieb. Der Heizungsmanager kann den vorhandenen Scheduler-Plan oder vier Standardphasen übernehmen.

## 0.3.36

- Heizkörper behalten beim Ruhen den Sollwert, wenn der Fahrplan sie freigibt. Der Vorrang der Midea und die Fensterpause bleiben aktiv.

## 0.3.35

- Strom heute weist den Midea-Tagesverbrauch aus und berücksichtigt den Tageswechsel bei den Stundenbalken.
- Die Panel-Version stammt aus dem Integrationsmanifest.

## 0.3.34

- Midea im Wohnzimmer erhält die gemessene Raumtemperatur zwischen 19 und 24 °C per Follow Me über den Moes-IR-Sender.

## 0.3.33

- Das Midea-Gerätesoll gleicht die gemessene Differenz zur Wohnzimmertemperatur aus.

## 0.3.32

- Wunschtemperatur direkt auf Raumkacheln vorübergehend ändern und aktive Vorgaben über den Filter Manuell finden.

## 0.3.31

- Die Raumübersicht zeigt bei hoher Klimaleistung oder weit geöffneten Heizkörperventilen „Heizt“.

## 0.3.30

- Große Fahrplanattribute korrekt vom Recorder ausschließen. Die Live-Anzeige behält alle Details.

## 0.3.29

- Haus-Wärmeverbrauch je Kalendertag speichern und am Wärmezähler als aufklappbares Balkendiagramm anzeigen.

## 0.3.28

- Angaben zu Tagesaufschlag, Jahreswärmemenge und Ablesevergleich stehen unter dem Zählerstand in einem aufklappbaren Bereich.

## 0.3.27

- Jahreswärmemenge am Haus-Wärmezähler. Der Ablesewert vom 1. Januar ist in den globalen Einstellungen hinterlegbar.

## 0.3.26

- Der Haus-Wärmezähler lernt aus Ablesungen einen zusätzlichen Tagesbedarf, etwa für Warmwasser.

## 0.3.25

- Die Raumübersicht berücksichtigt die gemessene Midea-Leistung beim Status „Hält“.

## 0.3.24

- Raumübersicht zeigt den Status „Hält“ in einem sanften Orangeton.

## 0.3.23

- Manuelle Heizpause zeigt die betroffene Entität und die Abweichung beim Modus oder Sollwert. Der Auslöser erscheint auch im Home-Assistant-Protokoll.

## 0.3.22

- Im Haltemodus heizt Midea zuerst. Heizkörper ergänzen bei größerem Defizit oder nach 20 Minuten mit weniger als 0,2 °C Erwärmung. Bei PV-Vorrang gilt unterhalb des Raumziels der Midea-Offset.

## 0.3.21

- PV-Vorrang für Midea anhand der PV-Erzeugung. Standardmäßig aktiv über 300 W, auch in Heizkörperphasen mit Wärmebedarf.

## 0.3.20

- Haus-Wärmezähler mit zwei Nachkommastellen. Lüftermodus und Oszillation direkt im Wohnzimmer-Heizplan einstellbar.

## 0.3.19

- Wandheizung mit Schaltzustand und gemessener Leistung in der Wohnzimmer-Kachel und unter Geräte.

## 0.3.18

- Wohnzimmer-Wandheizung bei bestätigtem PV-Überschuss mit 30 Minuten Mindestlaufzeit. Stromübersicht nutzt sensor.wandheizung_power und dessen Verlauf, optional einen separaten Tageszähler.

## 0.3.17

- Wärmezähler als Fußzeile unter Heizwärme, mit neuer Ablesung und Abgleich der Schätzung. Stromdiagramm mit Grundlinie und gleichmäßiger Achsenbeschriftung.

## 0.3.16

- Raumkacheln zeigen neben Klima ein kleines Tacho-Symbol mit beweglicher Nadel von 0 bis 1.500 W und den aktuellen Wattwert.

## 0.3.15

- Ventilsymbol bei 0 % grau, bei geöffnetem Ventil orange. Der Prozentwert bleibt grau.

## 0.3.14

- Raumkacheln zeigen den Öffnungsgrad der Heizkörper als orangefarbene Kreise mit Prozentwert.

## 0.3.13

- Haus-Wärmezähler ausschließlich über zwei Konfigurationsentitäten in der Heizungsmanager-Integration einrichten: Startwert (kWh) und Ablesezeitpunkt. Dashboard zeigt nur den fortgeschriebenen Schätzwert.
- Beide Werte getrennt einstellbar; Fortschreibung beginnt erst, wenn beide vorhanden sind.

## 0.3.12

- Gemeinsamer konfigurierbarer Haus-Wärmezähler: physischer Ablesewert in kWh und Ablesezeitpunkt, fortgeschrieben um die berechneten Heizkörperzuwächse seit diesem Zeitpunkt.
- Persistente Fortschreibung im Hintergrund, Zählerrücksetzungen berücksichtigen, gemeinsame Energiequellen nur einmal zählen. Fehlende Historie kennzeichnen. Keine Midea oder Warmwasser-Schätzung.
- Startwert direkt im Start-Dashboard konfigurierbar; Foto-Wert wird nicht automatisch übernommen.

## 0.3.11

- Startseite nach neuem Entwurf: schmale Statuszeile und gemeinsame Energiekarte mit Strom und Heizwärme. Tageswerte groß, aktuelle Leistung klein.
- Echter Stromverlauf als Stundenbalken aus HA-Historie und Heizwärme nach Räumen gestapelt. Schätzung im Tooltip; fehlende Daten dezent markieren. Neue konfigurierte Energiehelfer bleiben die Quelle, keine Beispielwerte.

## 0.3.10

- Startseite: Heizkörper jetzt (geschätzte Wärmeleistung in kW) und heute (geschätzte Heizenergie in kWh) als Summe aller Räume. Stromverbrauch bleibt getrennt.
- Leistung aus der Quelle der konfigurierten berechneten Energiezähler; Tageszuwachs aus HA-Historie. Gemeinsame Quellen nur einmal zählen, fehlende Quellen als unvollständig kennzeichnen.

## 0.3.9

- Temperaturverlauf für alle Räume einschließlich Schlafzimmer aus der HA-Recorder-Historie der konfigurierten Sensoren rekonstruieren. Letzte 24 Stunden, Aktualisierung alle zehn Minuten; Gewichtung, Korrekturen und Glättung wie bei der Raumtemperatur.
- Unveränderte HA-Zustände bleiben bis zur nächsten aufgezeichneten Änderung gültig. Nicht verfügbare Messwerte bleiben unbekannt. Keine Verwendung des nachgeladenen Verlaufs für Gerätebefehle oder Lernen.
- Schlafzimmer-Verlauf ebenfalls regelmäßig dauerhaft speichern. Eigener Verlauf bleibt Ersatz bei fehlender Recorder-Historie.

## 0.3.8

- Passende graue Raum-Icons vor den Namen auf dem Start-Dashboard: Sofa, Computer, Kind, Bett und Tür.

## 0.3.2

- Heiz-Fahrplan: Midea grün, Heizkörper orange, gemeinsame Phasen orange/grün schraffiert.
- Dieselben Farben und Schraffuren für die Punkte unter Geplante Heizphasen und die Legende.

## 0.3.1

- Manuellen Heizkörper-Sollwert als Raumziel bis zur nächsten Planphase übernehmen; automatische Echos und Absenkwerte ausfiltern.

- Identische Gegenbefehle während der 15-Sekunden-Rückmeldefrist nicht erneut senden; dauerhafte externe Gegenregelung führt zur bestehenden sichtbaren Pause.
- Gerätebefehle ab dem HA-Stop-Ereignis unterbinden, auch bei dann ausfallenden Sensoren.
- Befehlsfreie Startphase bis HA und benötigte Eingänge stabil verfügbar sind.
- Geräte beim Start übernehmen statt durch fehlende Startwerte ausschalten.
- Laufende Midea ohne erneuten Startlüfter-Befehl übernehmen.
- Monochromes Heizungsmanager-Markenicon in der Seitenleiste.

## 0.3.0
- Temperaturhalten statt Abschalten beim erreichten Raumziel, mit weiterhin verbindlichem Tür-, Sensor-, Mindestpausen- und Übertemperaturschutz.
- Optionaler lokaler PV-Vorrang aus Strommanager-Messwerten, geglättet und mit Bestätigungs-/Haltezeiten; keine PV-bedingte Wärmepumpen-Abschaltung.
- Konfigurierbare Rückkehr zur bisherigen Ein/Aus-Regelung; alter Midea-Offset nur dort aktiv.
- HACS-Konfiguration und eigenes Heizungsmanager-Icon im Stil des Strommanagers.

## 0.2.9

- Heizkörper je Raum zu einer Kachel mit getrennten Gerätewerten zusammenfassen; Heizkörper-Energie dort und Midea-Strom in der Midea-Kachel anzeigen.

- Midea bei jeder automatischen Aktivierung auf Lüftermodus Mittel setzen, auch bei Übernahme einer laufenden Midea nach HA-Neustart/Wechsel in Automatik.
- Startwert nach HVAC-Aktivierung am tatsächlichen Gerät anwenden; keine laufenden manuellen Lüfteränderungen bei jedem Tick überschreiben.
- Lüfterfehler anzeigen und fehlgeschlagene Startvorgaben erneut versuchen; Oszillation und Temperaturregelung beibehalten.

## 0.2.8

- Oszillationsart direkt in der Midea-Kachel auswählbar, mit den vom physischen Gerät unterstützten Modi.
- Gezielt `set_swing_mode` senden und aktuellen gemeldeten Modus anzeigen; übrige Heizungs- und Lüftereinstellungen beibehalten.
- Gemeinsame Behandlung von Verfügbarkeit, Fokus, Anfragen und Fehlern für beide Geräte-Dropdowns.

## 0.2.7

- Einstellbarer Midea-Geräte-Sollwert-Offset je Raum (Standard +0,5 °C, 0–3 °C).
- Offset bei allen Phasen und Schnelländerungen an die Midea weitergeben; Heizkörper und raumbezogene Hysterese-/Abschaltgrenzen unverändert verwenden.
- Geräte-Soll, Raumziel und Offset in der Midea-Kachel getrennt darstellen; Geräte-Soll auch im Fahrplan erklären.

## 0.2.6

- Aktuelle gemessene Leistung direkt in der Midea-Kachel anzeigen, W/kW korrekt umrechnen.
- Geräte-Lüftermodus per Dropdown mit den tatsächlich unterstützten Optionen setzen, ohne HVAC-Modus oder Zieltemperatur zu ändern.
- Fehlende Messwerte, nicht steuerbare Geräte und Servicefehler kenntlich machen; Dropdown-Fokus bei Live-Updates erhalten.

## 0.2.5

- Gemeinsame Hysterese je Raum für alle Wärmequellen, Phasen und temporären Sollwerte: Start unter Soll minus Hysterese, Abschalten ab Soll.
- Heizkörper behalten ihren Freigabezustand im Hystereseband; aktuelle reale Reglerzustände dienen als Startzustand für Steuerung und Prognose.
- Alte Nacht-Hysterese als allgemeinen Wert übernehmen. Nacht verwendet nun dieselben Schaltschwellen wie Tag (bei 18 / 0,3 °C: Start unter 17,7, aus ab 18 °C).
- Bestehende Midea-Mindestlaufzeit/-pause und Sicherheitsabschaltungen bleiben wirksam.

## 0.2.4

- Verbrauch-heute-Kacheln je Raum mit gemeinsamer kWh-Skala: Midea-Stromzähler und separat gekennzeichnete VTherm-Heizkörper-Schätzung.
- Midea-Leistung weiterhin separat in W; vorhandener Tasmota-kWh-Tageszähler statt unnötiger eigener Leistungsintegration.
- Tagesverbrauch des kumulativen AZ-Energiezählers über lokale HA-Historie seit Mitternacht, mit Rücksetzungsbehandlung und Hinweisen bei fehlender Historie.
- Energiequellen und Tages-/Gesamtzählerart je Raum in Einstellungen konfigurierbar.

## 0.2.3

- Zuletzt gewählten Raum pro Browser merken und nach Seitenneuladen wiederherstellen.
- Gespeicherte Auswahl gegen vorhandene Räume prüfen; fehlende Browser-Speicherung blockiert das Panel nicht.

## 0.2.2

- Kleine Live-Statuskacheln je zugeordnetem Heizkörper und Midea: Ventil-Schließgrad, Heizmodus, Aktivität, Regler-Modus, Geräte-Soll und Midea-Lüftermodus.
- Automatische Raumzuordnung über die unterliegenden VTherm-Geräte; reine Anzeige ohne zusätzliche Gerätebefehle.
- Ventilwerte ausdrücklich als Regler-Schließvorgaben beschriftet; fehlende Werte werden nicht als 0 % ausgegeben.

## 0.2.1

- Gewählte Betriebsart sofort je Raum speichern und nach HA-Neustart wiederherstellen.
- Einstellungen speichern behält die Betriebsart bei; Anzeige und API melden den erhaltenen Modus.
- Neue Einrichtungen ohne gespeicherte Betriebsart starten weiterhin in Beobachten.

## 0.2.0

- Vier feste Phasen je Raum und Tagesgruppe: Morgens, Tag, Abend, Nacht; jeweils Startzeit, Zieltemperatur und Wärmequellen einstellbar.
- Getrennte vollständige Pläne für Mo–Fr und Sa–So; korrekte Fortsetzung der vorherigen Nacht über den Wochenwechsel.
- Phasen beginnen zur eingestellten Zeit; automatische Vorheiz-/Unterstützungsfenster aus 0.1.x entfallen.
- Bestehende Morgen-/Nachtzeiten und Temperaturen werden übernommen; Tag/Abend als veränderbare Zwischenphasen ergänzt.
- Raumwahl für Wohnzimmer, Arbeitszimmer, Alwin, Carla, Flur; zusätzliche Räume bleiben zunächst unkonfiguriert. Eigene Geräte, Pläne, Lernwerte und Abweichungen je HA-Eintrag.
- Optionale Midea, Heizkörper und Türkontakte für spätere Räume; mindestens eine Wärmequelle, keine doppelte Zuordnung derselben Climate-Entität.
- Exakte Phasen-/Override-Grenzen in der 24-h-Prognose, Quellenfreigabe vor Taktschutz, Schnelländerung bis zur nächsten Phase.

## 0.1.7

- Allgemeiner Midea-Taktschutz: konfigurierbare Mindestlaufzeit/Mindestpause (je 15 Minuten) und Übertemperaturgrenze (+0,5 °C).
- Tatsächliche HVAC-Moduswechsel bestimmen die Fristen; Tür-Heizpause, Sensorfehler und Aus schalten weiterhin sofort ab.
- Taktschutz wird in der 24-h-Prognose und den Phasenerklärungen sichtbar berücksichtigt.

# Änderungen

## 0.1.6 - 03.11.2026

- Schnellbedienung mit temporaerer Wunschtemperatur, Ablaufzeit und Rueckkehr zum Zeitplan.
- Tagesregelung prueft echten Raum-Heizbedarf: bei 21,1 Grad und Ziel 20,5 Grad bleibt Midea aus.
- Tageshysterese: Start unter Ziel minus 0,2 Grad, Ende bei Zieltemperatur.
- 40 Tests, inklusive des gemeldeten Automatik-Fehlers.

## 0.1.5 – 03.11.2026

- Einzelwerte und Berechnung der Raumtemperatur standardmäßig eingeklappt.
- Beim Aktualisieren der Karte bleibt ein geöffneter Temperaturbereich geöffnet.
- Enthält die bedarfsgesteuerte Nachtregelung aus 0.1.4.

## 0.1.4 – 03.11.2026

- Midea nachts aus; Nachheizen erst unter der Nachttemperatur.
- Einstellbare Hysterese: standardmäßig unter 18 °C an, ab 18,3 °C wieder aus.
- Nachtpausen und Nachheizphasen im 24-Stunden-Fahrplan getrennt sichtbar.
- Gemeinsames morgendliches Vorheizen und Haltebetrieb tagsüber bleiben erhalten.
- 30 Tests einschließlich Nacht-Ein-/Ausschaltung und Hysterese.

## 0.1.3 – 03.11.2026

- Gemeinsame Raumtemperatur aus KNX und Ikea mit konfigurierbarer 75/25-Gewichtung.
- Korrekturwerte, zeitliche Glättung und Ersatzbetrieb bei ausgefallenen oder veralteten Sensoren.
- Eigene Raumtemperatur-Entität sowie Anzeige der Quellen und tatsächlichen Gewichte.
- Verwendung des Raumwerts für Planung und Lernen; beide WZ-VTherm-Regler entsprechend eingerichtet.
- 26 Tests für Modell, Steuerung, Temperaturberechnung und Konfigurations-API.

## 0.1.2 – 03.11.2026

- Konfigurations-API an die installierte HA-Version angepasst.
- Einstellungsreiter mit dauerhaft gespeicherten Geräte-, Zeit- und Temperaturvorgaben.
- Eigener Menüeintrag unter Strommanager; in HA installiert und im Beobachtungsmodus geprüft.

## 0.1.0 / 0.1.1 – 03.11.2026

- Erste lokale Integration mit Morgenunterstützung durch Heizkörper und anschließendem Midea-Betrieb.
- Getrennte Komfortzeiten für Werktage und Wochenende.
- Erklärbarer 24-Stunden-Fahrplan, Wetteranbindung, Lernmodell und Türpause.

## Noch nicht umgesetzt

- Keine weiteren Funktionen in dieser Liste geplant.
