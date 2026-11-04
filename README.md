# Heizungsmanager · 0.2.7

Lokale Home-Assistant-Custom-Integration mit vier Heizphasen je Raum. Quellcode: [gwmpvv5948-dot/Heizungsmanager](https://github.com/gwmpvv5948-dot/Heizungsmanager). [Versionsübersicht](CHANGELOG.md).

## Vier Phasen

Jeder Raum hat zwei vollständige Tagespläne: Montag–Freitag und Samstag–Sonntag. Jeder enthält genau **Morgens, Tag, Abend, Nacht**, jeweils mit:

- Startzeit: tatsächlicher Beginn der Phase, kein zusätzlich berechneter Vorheizbeginn.
- Zieltemperatur: 7–24 °C in 0,5-°C-Schritten.
- Wärmequellen: Midea, Heizkörper, beide oder keine.

Die Startzeiten müssen innerhalb einer Tagesgruppe aufsteigen. Jede Phase gilt bis zur nächsten. Die Freitagnacht bleibt am Samstag bis zur Morgenphase gültig; die Sonntagnacht entsprechend am Montag. Eine Quellenwahl ist eine Erlaubnis, kein permanenter Einschaltbefehl: Wärme wird nur bei Bedarf angefordert. Ausgeschlossene Quellen werden am Phasenwechsel abgeschaltet, auch während einer Midea-Mindestlaufzeit. Bei „keine“ heizt der Manager auch unterhalb der Zieltemperatur nicht.

Alle Wärmequellen nutzen in allen Phasen dieselbe einstellbare Hysterese je Raum: ausgeschaltet startet die Freigabe erst unter Soll minus Hysterese, eingeschaltet endet sie ab Soll. Beispiel 21 °C / 0,3 °C: Start unter 20,7 °C, aus ab 21 °C. Das gilt auch für temporäre Wünsche und nachts: bei 18 °C / 0,3 °C beginnt Nachheizen erst unter 17,7 °C und endet ab 18 °C. Im Hystereseband wird der tatsächliche Heizmodus der jeweiligen Quelle beibehalten, auch nach einem HA-Neustart. Der Midea-Taktschutz kann die Freigabe verlängern oder einen Neustart verzögern. Interne Verdichter-/VTherm-Ventilzyklen regeln Gerät und VTherm selbst.

Der 24-h-Fahrplan zeigt die vier Phasen mit Solltemperatur und erlaubten Quellen. Die Temperaturprognose hat ein 10-Minuten-Raster und zusätzliche Punkte an exakten Phasenwechseln und am Ende einer Schnelländerung. Geregelt wird alle 30 Sekunden sowie bei Zustandsänderungen. Temperaturen und Heizbedarf bleiben Modellschätzungen.

## Update von 0.1.x

Vorhandene Morgen- und Nachtzeiten sowie Komfort-/Nachttemperaturen werden übernommen. Tag startet zunächst nach dem bisherigen morgendlichen Unterstützungsfenster (meist 45 Minuten); Abend zunächst um 17 Uhr. Bei abweichenden alten Zeitplänen werden die Zwischenzeiten in das vorhandene Tagesfenster eingeordnet. Die alten Vorheiz- und Unterstützungsregeln entfallen: Stattdessen steuert jede der vier Phasen ihre Quellen selbst. Die neuen Zeiten sind unter **Einstellungen** veränderbar. Beim Speichern werden die vollständigen neuen Tagespläne in HA hinterlegt.

## Räume

Wohnzimmer und Arbeitszimmer sind eingerichtet und im gemeinsamen Panel auswählbar. Alwin, Carla und Flur werden als noch nicht eingerichtet angezeigt. Später lässt sich pro Raum eine weitere Instanz über Geräte & Dienste → Integration hinzufügen → Heizungsmanager anlegen. Jeder Raum erhält eigene Geräte, Wochenpläne, Betriebsart, Temperatursensoren, Lernwerte, Historie und temporäre Abweichung. Der gemeinsame Menüeintrag wechselt zwischen den eingerichteten Räumen.

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
node --test tests/test_*.mjs
node --check custom_components/heizungsmanager/frontend/panel.js
node --check custom_components/heizungsmanager/frontend/heizungsmanager-card.js
```

Die Tests verwenden HA-Grenzstellen als Doubles und schalten keine echten Geräte. Sie prüfen unter anderem Phasengrenzen, Quellenwahl, Migration, Wochenwechsel, Sommerzeit, Taktschutz, Sensorfehler, Schnelländerungen und Raumtrennung. `preview.html` zeigt synthetische Beispieldaten ohne Geräteverbindung.

## Eingerichtetes Arbeitszimmer

Seit 4. November 2026 ist das Arbeitszimmer als eigener HA-Eintrag eingerichtet, mit Automatik und eigenem Fahrplan/Einstellungen. Raumtemperatur: `sensor.nspanelaz_temperature`; Fensterkontakt: `binary_sensor.aqara_az_fenster`; Heizkörper-Regler: `climate.az_vtherm` (bestehender VTherm mit `climate.az_thermostat_mqtt` darunter); Wetter: `weather.dresden_stadt`. Keine Midea und kein zweiter Temperatursensor zugeordnet. Der primäre Sensor wird daher effektiv zu 100 % verwendet.

Startplan: Mo–Fr Morgens 06:20, Tag 07:05, Abend 17:00, Nacht 22:00; Sa–So Morgens 08:00, Tag 08:45, Abend 17:00, Nacht 22:00. Zunächst 21 °C in den ersten drei Phasen und 18 °C nachts, jeweils ausschließlich Heizkörper. Dies sind veränderbare Startwerte. Bei der Einrichtung wurde der 21-°C-Sollwert am AZ-VTherm und dessen Heizbetrieb geprüft; die Fenster-Heizpause bleibt aktiv.

[examples/arbeitszimmer.json](examples/arbeitszimmer.json) dokumentiert diesen Konfigurationsstand zur Einrichtung, ohne Zugangsdaten. Das ist eine Referenzdatei, kein automatischer Import und keine laufende Sicherung späterer HA-Änderungen. Die aktive Betriebsart wird separat im lokalen HA-Speicher gehalten. Der bestehende Wohnzimmerplan wird durch die Einrichtung nicht geändert.

## Gerätestatus-Kacheln (0.2.2)

Im Fahrplan zeigt jeder Raum kleine Gerätekacheln mit Live-Status. Die dem zugeordneten VTherm unterliegenden Climate-Entitäten bestimmen die Heizkörper/Midea automatisch; es werden keine fremden Räume durchsucht. Wohnzimmer: WZ1, WZ2 und Midea; Arbeitszimmer: AZ-Heizkörper. Je Kachel erscheinen Geräte-Heizmodus, gemeldete Aktivität, Regler-Modus und Geräte-Solltemperatur. Die Midea zeigt zusätzlich den aktuellen Lüftermodus des physischen Geräts.

Heizkörper zeigen den gemeldeten Wert von `number.<thermostat>_valve_closing_degree` als **Ventil-Schließgrad · Reglerwert**. Das ist eine Schließvorgabe, keine Messung der mechanischen Position. Öffnungs- und Schließvorgaben sind unterschiedliche Regelparameter; deshalb wird daraus keine vermeintlich gemessene Öffnung durch `100 − Schließgrad` berechnet. Siehe [Zigbee2MQTT TRVZB](https://www.zigbee2mqtt.io/devices/TRVZB.html#valve-closing-degree-numeric). Fehlende/unverfügbare Werte erscheinen als Strich, nicht als 0 %. Statusänderungen aktualisieren die Kacheln direkt über die HA-Zustände, unabhängig vom Planungsintervall.

Die zuletzt erfolgreich gewählte Raumauswahl wird lokal im jeweiligen Browser gespeichert und nach Seitenneuladen oder erneutem Öffnen wiederhergestellt. Entfernte Räume werden dabei übersprungen; wenn Browser-Speicherung nicht verfügbar ist, bleibt die Raumauswahl weiterhin bedienbar. Die Präferenz wird nicht zwischen Geräten synchronisiert.

## Verbrauch heute (0.2.4)

Jeder Raum zeigt unter den Gerätekacheln den Verbrauch seit Mitternacht in der HA-Zeitzone. Die Midea verwendet ihren vorhandenen kWh-Tageszähler `sensor.tasmota_energy_today_2` und zeigt daneben die aktuelle Leistung aus `sensor.tasmota_energy_power_2` in W. Leistung wird nicht mit Energie verwechselt oder als kWh behandelt. Eine eigene Integration der Leistung ist unnötig, weil Tasmota bereits einen Energiezähler liefert.

Wohnzimmer-Heizkörper: `sensor.wz_verbrauch_heizung` (Tageszähler). Arbeitszimmer: `sensor.az_vtherm_energy` (fortlaufender Zähler). Für fortlaufende Zähler liest das Panel über die lokale HA-History-API den Zustand zu Tagesbeginn und die Änderungen seitdem; beobachtete Rücksetzungen werden berücksichtigt. Die Historie wird höchstens einmal pro Minute angefragt, aktuelle Zählerstände aktualisieren die Anzeige direkt. Wh und MWh werden in kWh umgerechnet. Ohne gültigen Tagesbeginn-Zählerstand oder bei fehlender Historie wird kein Wert erfunden; Historielücken werden kenntlich gemacht. Es wird keine neue Datenbank angelegt und kein Utility Meter erstellt.

Die Quellen und die Art des Heizkörper-Zählers (Tageszähler/fortlaufend) lassen sich je Raum unter Einstellungen → Verbrauchsanzeige ändern. Leere optionale Quellen blenden die jeweilige Verbrauchskachel aus. Die verwendeten Heizkörperwerte sind VTherm-Schätzungen, keine Wärmemengenzähler. Midea-Strom und Heizkörper-Schätzenergie sind unterschiedliche Datengrundlagen: die gemeinsame kWh-Skala ist eine zeitlich einheitliche Übersicht, kein direkter Effizienz-, COP- oder Kostenvergleich; die Werte werden nicht addiert. Siehe [VTherm-Referenz](https://www.versatile-thermostat.org/en/docs/reference/).

## Hysterese ab 0.2.5

Unter Einstellungen → Temperaturregelung · alle Heizungen gilt `heating_hysteresis` je Raum für Midea und Heizkörper, in Morgens/Tag/Abend/Nacht und bei Schnelländerungen. Bestehende Werte von `night_reheat_hysteresis` werden bei der Migration übernommen. Es gibt keine separate Nacht-Hysterese mehr. Die Nacht-Zieltemperatur ist jetzt die Abschaltschwelle; der Start liegt um die konfigurierte Hysterese darunter. Ein Soll von 18 °C garantiert deshalb keine Untergrenze von 18 °C. Quellenwahl, Aus, Fenster-/Türpause, Sensorfehler und manuelle Pause haben weiterhin Vorrang; Mindestlaufzeit/-pause und Übertemperaturschutz der Midea bleiben bestehen.

## Midea-Kachel ab 0.2.6

Die Midea-Kachel zeigt die aktuelle gemessene elektrische Leistung aus dem je Raum konfigurierten Leistungssensor (W oder kW, in W angezeigt). Fehlende Werte erscheinen als Strich. Das Lüftermodus-Dropdown enthält ausschließlich die vom physischen Gerät in `fan_modes` gemeldeten Optionen und zeigt den gemeldeten aktuellen Modus. Die Auswahl sendet gezielt `climate.set_fan_mode` an dieses Gerät; HVAC-Modus und Solltemperatur werden dabei nicht geändert. Die Automatik bleibt aktiv. Interne Geräte-/VTherm-Regelungen können den Modus weiterhin beeinflussen. Bei nicht verfügbarem Gerät oder fehlenden unterstützten Modi ist die Auswahl deaktiviert. Die Auswahl bleibt während Live-Updates bedienbar; Fehler werden in der Kachel angezeigt.

## Midea-Sollwertkorrektur ab 0.2.7

Je Raum ist unter Einstellungen → Midea · Sollwertkorrektur ein positiver Geräte-Offset einstellbar (0–3 °C, 0,5-°C-Schritte; Standard +0,5 °C). Bei 21 °C Raumziel erhält der Midea-Regler 21,5 °C als Geräte-Soll. Das gilt für alle vier Phasen und Schnelländerungen. Heizkörper erhalten weiterhin das ursprüngliche Raumziel. Bei ausgeschlossener Midea bleibt sie ausgeschaltet.

Die Schaltentscheidung, Hysterese und Midea-Übertemperaturgrenze beziehen sich weiterhin auf das Raumziel. Der Offset verschiebt keine Schaltschwelle und ist kein höheres Raumziel. Die Prognose weist den Midea-Geräte-Sollwert aus, setzt die höhere Gerätevorgabe aber nicht mit einer entsprechend höheren gewünschten Raumtemperatur oder pauschal zusätzlicher Heizleistung gleich; Heizbeiträge werden weiter aus realen Daten gelernt. Die bisherige Temperaturbegrenzung und Rundung auf die Geräteschrittweite bleibt aktiv. Die Midea-Kachel zeigt tatsächliches Geräte-Soll, Raumziel und Offset getrennt. Wert 0 deaktiviert den Ausgleich.
