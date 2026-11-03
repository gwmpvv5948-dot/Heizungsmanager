# Änderungen

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

- Temporäre Wunschtemperatur direkt im Fahrplan, mit Ablaufzeit und Rückkehr zum Zeitplan.
