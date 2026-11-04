# Heizungsmanager · 0.2.1

Lokale Home-Assistant-Custom-Integration mit vier Heizphasen je Raum. Quellcode: [gwmpvv5948-dot/Heizungsmanager](https://github.com/gwmpvv5948-dot/Heizungsmanager). [Versionsübersicht](CHANGELOG.md).

## Vier Phasen

Jeder Raum hat zwei vollständige Tagespläne: Montag–Freitag und Samstag–Sonntag. Jeder enthält genau **Morgens, Tag, Abend, Nacht**, jeweils mit:

- Startzeit: tatsächlicher Beginn der Phase, kein zusätzlich berechneter Vorheizbeginn.
- Zieltemperatur: 7–24 °C in 0,5-°C-Schritten.
- Wärmequellen: Midea, Heizkörper, beide oder keine.

Die Startzeiten müssen innerhalb einer Tagesgruppe aufsteigen. Jede Phase gilt bis zur nächsten. Die Freitagnacht bleibt am Samstag bis zur Morgenphase gültig; die Sonntagnacht entsprechend am Montag. Eine Quellenwahl ist eine Erlaubnis, kein permanenter Einschaltbefehl: Wärme wird nur bei Bedarf angefordert. Ausgeschlossene Quellen werden am Phasenwechsel abgeschaltet, auch während einer Midea-Mindestlaufzeit. Bei „keine“ heizt der Manager auch unterhalb der Zieltemperatur nicht.

Nachts startet die Midea bei Unterschreitung des Nachtziels und beendet regulär bei Ziel + Hysterese (Standard 0,3 °C). Der Taktschutz kann die Freigabe verlängern oder einen Neustart verzögern. Bei ausschließlich Heizkörpern erfolgt die Regelung ebenfalls nach Raumtemperatur.

Der 24-h-Fahrplan zeigt die vier Phasen mit Solltemperatur und erlaubten Quellen. Die Temperaturprognose hat ein 10-Minuten-Raster und zusätzliche Punkte an exakten Phasenwechseln und am Ende einer Schnelländerung. Geregelt wird alle 30 Sekunden sowie bei Zustandsänderungen. Temperaturen und Heizbedarf bleiben Modellschätzungen.

## Update von 0.1.x

Vorhandene Morgen- und Nachtzeiten sowie Komfort-/Nachttemperaturen werden übernommen. Tag startet zunächst nach dem bisherigen morgendlichen Unterstützungsfenster (meist 45 Minuten); Abend zunächst um 17 Uhr. Bei abweichenden alten Zeitplänen werden die Zwischenzeiten in das vorhandene Tagesfenster eingeordnet. Die alten Vorheiz- und Unterstützungsregeln entfallen: Stattdessen steuert jede der vier Phasen ihre Quellen selbst. Die neuen Zeiten sind unter **Einstellungen** veränderbar. Beim Speichern werden die vollständigen neuen Tagespläne in HA hinterlegt.

## Räume

Aktuell ist nur das Wohnzimmer eingerichtet. Arbeitszimmer, Alwin, Carla und Flur werden in der Raumauswahl als noch nicht eingerichtet angezeigt. Später lässt sich pro Raum eine weitere Instanz über Geräte & Dienste → Integration hinzufügen → Heizungsmanager anlegen. Jeder Raum erhält eigene Geräte, Wochenpläne, Betriebsart, Temperatursensoren, Lernwerte, Historie und temporäre Abweichung. Der gemeinsame Menüeintrag wechselt zwischen den eingerichteten Räumen.

Weitere Räume übernehmen keine Wohnzimmergeräte. Mindestens eine Wärmequelle muss zugeordnet werden; Midea und Fensterkontakt sind optional. In den Phasen dürfen nur vorhandene Wärmequellen freigegeben werden. Dieselbe Climate-Entität darf nicht von zwei Räumen gesteuert werden. Unterliegende Geräte hinter unterschiedlichen Regler-Entitäten müssen zusätzlich bei der Einrichtung auf doppelte Zuordnung geprüft werden.

Die bestehenden WZ-Sensor-IDs und Unique-IDs bleiben erhalten, insbesondere die als VTherm-Eingang genutzte berechnete Raumtemperatur.

## Raumtemperatur und Lernen

Im Wohnzimmer werden KNX und Ikea standardmäßig 75:25 gewichtet, mit einstellbaren Offsets und 3 Minuten zeitlicher Glättung. Ungültige/veraltete Quellen werden ausgeschlossen. Die resultierende Raumtemperatur wird angezeigt und intern für Planung und Lernen verwendet. Sensorinformationen sind standardmäßig eingeklappt.

Ein kleines thermisches Modell lernt Wärmeverlust und separate Heizbeiträge aus geeigneten, ungestörten Betriebsintervallen. Keine Cloud-KI und kein zusätzliches ML-Framework. Gemischtes Heizen identifiziert die Quellen nicht getrennt. Modell, letzte 144 Historienpunkte und temporäre Abweichung liegen je Raum in HAs lokalem `.storage/heizungsmanager.<entry_id>`. Konfiguration liegt in den HA-Konfigurationseinträgen. Keine eigene Datenbank, keine InfluxDB-Anbindung in dieser Version.

Stündliche Außentemperaturvorhersagen werden alle 30 Minuten aus der gewählten HA-Wetterentität abgerufen. Fehlen sie, gilt die aktuelle Außentemperatur; fehlt auch diese, ist die Annahme 5 °C ausdrücklich sichtbar. Sonne, Wind und Bewölkung werden nicht modelliert. Wetteranbieter und verwendete Geräteintegrationen können Internet benötigen; Planung, Lernen und Bedienung laufen lokal.

## Taktschutz und Bedienung

Midea-Mindestlaufzeit und Mindestpause sind standardmäßig jeweils 15 Minuten (5–60 einstellbar). Die Frist basiert auf dem tatsächlichen HVAC-Moduswechsel des konfigurierten Reglers. Messwertänderungen oder Änderungen der Betriebsart setzen sie nicht zurück. Nach HA-Neustart beginnt konservativ eine neue Frist. Soll + 0,5 °C beendet eine Mindestlaufzeit vorzeitig (einstellbar). Tür-Heizpause, Sensorfehler, Aus und eine neue Phase ohne Midea-Freigabe haben Vorrang. Eine Mindestpause kann Unterschreitungen der Wunschtemperatur verursachen; 18 °C sind keine garantierte Untergrenze.

Dies begrenzt Schaltbefehle des Managers. Verdichterzyklen innerhalb einer Freigabe und weitere Eingriffe von VTherm regeln Gerät und vorhandener Regler. Die 15 Minuten sind konfigurierbare Startwerte, keine Herstellervorgabe.

Schnelländerungen gelten eine oder zwei Stunden oder bis zum nächsten der vier Phasenwechsel. Sie ändern nur die Zieltemperatur, nicht die erlaubten Wärmequellen. Danach gilt automatisch wieder der Plan.

Beobachten plant und lernt, sendet aber keine Befehle. Automatik steuert die zugeordneten Quellen. Aus schaltet diese aus und bietet keinen zusätzlichen Frostschutz. Die ausdrücklich gewählte Betriebsart wird sofort je Raum gespeichert und nach Neustarts wiederhergestellt. Einstellungen speichern behält die Betriebsart bei; in Automatik wirken neue Einstellungen direkt. Nur eine neue Einrichtung ohne gespeicherte Betriebsart startet in Beobachten. Manuelle Geräteänderungen pausieren die Automatik für die konfigurierte Zeit.

## Installation und Prüfung

`custom_components/heizungsmanager` nach `/config/custom_components/heizungsmanager` kopieren, HA neu starten und über Geräte & Dienste hinzufügen. Vor Updates den vorhandenen Ordner sichern. Die Sidebar erscheint unter Heizungsmanager; Konfiguration ist dort im Reiter Einstellungen und über den HA-Optionsdialog möglich. Weitere Räume erst nach Zuordnung ihrer tatsächlichen Geräte einrichten.

```sh
python3 -m unittest discover -s tests
node --check custom_components/heizungsmanager/frontend/panel.js
node --check custom_components/heizungsmanager/frontend/heizungsmanager-card.js
```

Die Tests verwenden HA-Grenzstellen als Doubles und schalten keine echten Geräte. Sie prüfen unter anderem Phasengrenzen, Quellenwahl, Migration, Wochenwechsel, Sommerzeit, Taktschutz, Sensorfehler, Schnelländerungen und Raumtrennung. `preview.html` zeigt synthetische Beispieldaten ohne Geräteverbindung.
