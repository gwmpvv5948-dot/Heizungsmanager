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
