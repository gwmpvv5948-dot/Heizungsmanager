"""Local planning, conservative online learning and supervised device commands."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
import logging

from homeassistant.core import callback
from homeassistant.helpers.storage import Store
from homeassistant.helpers.event import async_track_time_interval, async_track_state_change_event
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.util import dt as dt_util
from .const import DEFAULTS, DOMAIN
from .model import ThermalModel, finite, make_plan, next_schedule_time, normalize_config
from .temperature import RoomTemperature

_LOGGER = logging.getLogger(__name__)


class HeatingCoordinator(DataUpdateCoordinator):
    def __init__(self, hass, entry):
        super().__init__(hass, _LOGGER, name=DOMAIN)
        self.entry = entry
        self.config = normalize_config({**DEFAULTS, **entry.data, **entry.options})
        self.model = ThermalModel()
        self.mode = "Beobachten"
        self.store = Store(hass, 1, f"{DOMAIN}.{entry.entry_id}")
        self.forecast = []
        self.forecast_updated = None
        self.last_weather_request = 0
        self.weather_note = "Noch keine Wettervorhersage"
        self.previous = None
        self.commands = {}
        self.manual_until = None
        self.open_since = None
        self.history = []
        self.unsubs = []
        self.lock = asyncio.Lock()
        self.error = None
        self.last_save = 0
        self.room_temperature = RoomTemperature()
        self.pump_heat_active = False
        self.override = None

    async def async_initialize(self):
        saved = await self.store.async_load() or {}
        self.model = ThermalModel.restore(saved.get("model", {}))
        # New installations start in observation; an explicit selection survives restart.
        mode = saved.get("mode")
        self.mode = mode if mode in ("Beobachten", "Automatik", "Aus") else "Beobachten"
        self.history = saved.get("history", [])[-144:]
        restored = saved.get("override")
        if isinstance(restored, dict) and finite(restored.get("temperature"), 16, 24) is not None and finite(restored.get("until"), 0, 9999999999) is not None:
            if restored["until"] > dt_util.now().timestamp():
                self.override = restored
        self.unsubs.append(async_track_time_interval(self.hass, self.async_tick, timedelta(seconds=30)))
        watched = self.watched_entities()
        self.unsubs.append(async_track_state_change_event(self.hass, watched, self.async_changed))
        await self.async_tick()

    async def async_shutdown(self):
        for unsub in self.unsubs:
            unsub()
        await self.async_save()

    async def async_save(self):
        await self.store.async_save({"model": self.model.dump(), "history": self.history[-144:], "override": self.override, "mode": self.mode})

    async def async_set_override(self, temperature=None, duration="2h"):
        if temperature is not None:
            temperature = finite(temperature, 16, 24)
            if temperature is None or abs(temperature * 2 - round(temperature * 2)) > 0.001:
                raise ValueError("Bitte 16 bis 24 °C in Schritten von 0,5 °C wählen.")
            if duration not in ("1h", "2h", "schedule"):
                raise ValueError("Ungültige Dauer")
        async with self.lock:
            now = dt_util.now()
            until = next_schedule_time(now, self.config) if duration == "schedule" else now.timestamp() + (3600 if duration == "1h" else 7200)
            self.override = {"temperature": temperature, "until": until, "duration": duration} if temperature is not None else None
            self.manual_until = None
            self.commands = {}
            self.previous = None
            self.pump_heat_active = False
            await self._tick()
            await self.async_save()

    @callback
    def async_changed(self, event):
        self.hass.async_create_task(self.async_tick())

    async def async_set_mode(self, mode):
        if mode not in ("Beobachten", "Automatik", "Aus"):
            raise ValueError("Ungültige Betriebsart")
        async with self.lock:
            self.mode = mode
            self.manual_until = None
            self.commands = {}
            self.previous = None
            self.pump_heat_active = False
            await self._tick()
            await self.async_save()

    async def async_apply_options(self):
        async with self.lock:
            self.config = normalize_config({**DEFAULTS, **self.entry.data, **self.entry.options})
            self.manual_until = None
            self.commands = {}
            self.previous = None
            self.room_temperature = RoomTemperature()
            self.pump_heat_active = False
            self.open_since = None
            self.forecast = []
            self.last_weather_request = 0
            # Entity changes must update the event subscription too.
            for unsubscribe in self.unsubs:
                unsubscribe()
            self.unsubs = [async_track_time_interval(self.hass, self.async_tick, timedelta(seconds=30)),
                async_track_state_change_event(self.hass,
                    self.watched_entities(), self.async_changed)]
            await self._tick()

    def watched_entities(self):
        return [self.config[k] for k in ("window_sensor", "heat_pump", "radiators",
            "temperature_sensor", "secondary_temperature_sensor") if self.config.get(k)]

    def read_room_temperature(self, now):
        readings = []
        for key in ("temperature_sensor", "secondary_temperature_sensor"):
            state = self.state(key)
            raw = finite(state.state, 0, 40) if state else None
            reason = None
            if not self.config.get(key):
                reason = "Nicht konfiguriert"
            elif state is None or state.state in ("unknown", "unavailable"):
                reason = "Nicht verfügbar"
            elif not self.fresh(state, now):
                reason = "Messwert veraltet"
            elif state.attributes.get("unit_of_measurement") != "°C":
                reason = "Einheit nicht °C"
            elif raw is None:
                reason = "Ungültiger Messwert"
            readings.append({"entity_id": self.config.get(key, ""), "name": state.attributes.get("friendly_name", self.config.get(key)) if state else self.config.get(key),
                "raw": raw if reason is None else None, "reported_value": raw,
                "reason": reason, "last_reported": getattr(state, "last_reported", state.last_updated).isoformat() if state else None})
        return self.room_temperature.update(now.timestamp(), readings, self.config)

    def state(self, key):
        return self.hass.states.get(self.config[key]) if self.config.get(key) else None

    def fresh(self, state, now, minutes=None):
        if state is None or state.state in ("unknown", "unavailable"):
            return False
        reported = getattr(state, "last_reported", state.last_updated)
        return (now - reported).total_seconds() < 60 * (minutes or self.config["sensor_timeout_minutes"])

    async def async_weather(self, now):
        if now.timestamp() - self.last_weather_request < 1800:
            return
        self.last_weather_request = now.timestamp()
        weather = self.state("weather")
        if weather is None:
            self.weather_note = "Wetterentität fehlt"
            return
        try:
            result = await self.hass.services.async_call("weather", "get_forecasts",
                {"entity_id": weather.entity_id, "type": "hourly"}, blocking=True, return_response=True)
            points = []
            unit = weather.attributes.get("temperature_unit", "°C")
            for item in (result or {}).get(weather.entity_id, {}).get("forecast", []):
                when = dt_util.parse_datetime(item.get("datetime", ""))
                value = finite(item.get("temperature"), -100, 150)
                if value is not None and unit == "°F":
                    value = (value - 32) * 5 / 9
                if when and when.tzinfo and value is not None and -30 <= value <= 45:
                    points.append((when.timestamp(), value))
            if not points:
                raise ValueError("Keine verwendbaren stündlichen Temperaturwerte")
            self.forecast = sorted(points)
            self.forecast_updated = now.timestamp()
            self.weather_note = "Stündliche Wettervorhersage"
        except Exception as err:
            self.weather_note = "Vorhersage fehlt – aktuelle Außentemperatur wird fortgeschrieben"
            _LOGGER.debug("Weather forecast unavailable: %s", err)

    def activity(self):
        pump = self.state("heat_pump")
        rad = self.state("radiators")
        p = None
        if pump and pump.state not in ("unknown", "unavailable"):
            action = pump.attributes.get("hvac_action")
            p = 1.0 if action == "heating" else (0.0 if pump.state == "off" or action in ("idle", "off") else None)
        power = self.state("power_sensor")
        watts = finite(power.state, 0, 30000) if power else None
        if power and power.attributes.get("unit_of_measurement") == "kW" and watts is not None:
            watts *= 1000
        if watts is not None and self.fresh(power, dt_util.now(), 10):
            p = 1.0 if watts > 80 else 0.0
        r = None
        if rad and rad.state not in ("unknown", "unavailable"):
            percent = finite(rad.attributes.get("valve_open_percent"), 0, 100)
            r = percent / 100 if percent is not None else (1.0 if rad.attributes.get("hvac_action") == "heating" else 0.0 if rad.state == "off" or rad.attributes.get("hvac_action") in ("idle", "off") else None)
        return (p if self.config.get("heat_pump") else 0.0), (r if self.config.get("radiators") else 0.0)

    def detect_manual(self, now):
        for key, expected in self.commands.items():
            state = self.state(key)
            if not state or now.timestamp() - expected[2] < 15:
                continue
            target = finite(state.attributes.get("temperature"), 0, 40)
            mismatch = state.state != expected[0]
            if expected[0] != "off" and target is not None:
                mismatch |= abs(target - expected[1]) > 0.15
            if mismatch and state.state not in ("unavailable", "unknown"):
                self.manual_until = now + timedelta(minutes=self.config["manual_pause_minutes"])
                self.commands = {}
                self.previous = None
                return

    async def command(self, key, mode, target):
        if not self.config.get(key):
            return
        state = self.state(key)
        if state is None or state.state in ("unknown", "unavailable"):
            raise ValueError(f"{self.config[key]} nicht verfügbar")
        if mode not in state.attributes.get("hvac_modes", []):
            raise ValueError(f"{self.config[key]} unterstützt {mode} nicht")
        changed = False
        if mode != "off":
            low, high = state.attributes.get("min_temp", 7), state.attributes.get("max_temp", 30)
            target = max(low, min(high, target))
            step = state.attributes.get("target_temp_step", 0.5) or 0.5
            target = round(round(target / step) * step, 2)
            current = finite(state.attributes.get("temperature"), 0, 40)
            if current is None or abs(current - target) > 0.05:
                await self.hass.services.async_call("climate", "set_temperature",
                    {"entity_id": state.entity_id, "temperature": target}, blocking=True)
                changed = True
        if state.state != mode:
            await self.hass.services.async_call("climate", "set_hvac_mode",
                {"entity_id": state.entity_id, "hvac_mode": mode}, blocking=True)
            changed = True
        previous = self.commands.get(key)
        stamp = dt_util.now().timestamp() if changed or previous is None else previous[2]
        self.commands[key] = (mode, target, stamp)

    async def stop_both(self):
        errors = []
        for key in ("radiators", "heat_pump"):
            try:
                await self.command(key, "off", 7)
            except Exception as err:
                errors.append(str(err))
        if errors:
            raise ValueError("; ".join(errors))

    async def async_tick(self, _now=None):
        if self.lock.locked():
            return
        async with self.lock:
            await self._tick()

    async def _tick(self):
        now = dt_util.now()
        if self.override and self.override["until"] <= now.timestamp():
            self.override = None
            self.previous = None
        await self.async_weather(now)
        self.error = None
        temperature_info = self.read_room_temperature(now)
        temp = temperature_info["value"]
        if temperature_info["source_changed"]:
            self.previous = None
        weather = self.state("weather")
        outside = finite(weather.attributes.get("temperature"), -100, 150) if self.fresh(weather, now, 180) else None
        if outside is not None and weather.attributes.get("temperature_unit") == "°F":
            outside = (outside - 32) * 5 / 9
        outside = finite(outside, -30, 45)
        window = self.state("window_sensor")
        window_unknown = bool(self.config.get("window_sensor")) and (not window or window.state not in ("on", "off"))
        if window and window.state == "on":
            self.open_since = self.open_since or window.last_changed
        else:
            self.open_since = None
        window_open = self.open_since is not None
        window_pause = window_open and (now - self.open_since).total_seconds() >= self.config["window_delay_seconds"]
        p, r = self.activity()
        healthy_devices = all(self.state(k) and self.state(k).state not in ("unknown", "unavailable") for k in ("heat_pump", "radiators") if self.config.get(k))
        if self.mode == "Automatik" and not window_open and not window_unknown:
            self.detect_manual(now)
        if self.manual_until and self.manual_until <= now:
            self.manual_until = None
        learn_ok = temp is not None and not temperature_info["learning_paused"] and outside is not None and not window_open and not window_unknown and healthy_devices and self.manual_until is None and p is not None and r is not None
        if learn_ok:
            if self.previous:
                before = self.previous
                hours = (now.timestamp() - before[0]) / 3600
                if p != before[3] or abs(r - before[4]) > 0.1:
                    self.previous = None
                elif hours >= 5 / 60:
                    self.model.learn(before[1], temp, (outside + before[2]) / 2, hours, p, r)
                    self.previous = None
            if self.previous is None:
                self.previous = (now.timestamp(), temp, outside, p, r)
        else:
            self.previous = None
        forecast = self.forecast if self.forecast_updated and now.timestamp() - self.forecast_updated < 7200 else []
        pump_state = self.state("heat_pump")
        pump_on = bool(pump_state and pump_state.state == "heat")
        # last_changed tracks the HVAC mode, not changing temperature/power attributes.
        # Restarting HA conservatively starts a fresh protection interval.
        pump_since = pump_state.last_changed.timestamp() if pump_state else now.timestamp()
        plan = make_plan(now, temp, outside, forecast, self.config, self.model,
                         pump_on, self.override, pump_on, pump_since,
                         bool(self.state("radiators") and self.state("radiators").state == "heat")) if temp is not None else []
        row = plan[0] if plan else None
        self.pump_heat_active = bool(row and row["heat_pump"])
        status = row["phase"] if row else "Raumsensor fehlt oder ist veraltet"
        reason = row["reason"] if row else "Keine belastbare Raumtemperatur; automatische Steuerung pausiert"
        if window_unknown:
            status, reason = "Türstatus unbekannt", "Automatische Steuerung pausiert; Türkontakt prüfen"
        elif window_open:
            status = "Terrassentür offen" if window_pause else "Tür offen – Verzögerung"
            reason = "Heizpause; Neustart nach Schließen der Tür" if window_pause else "Warte auf konfigurierte Türverzögerung"
        elif self.manual_until:
            status, reason = "Manuelle Pause", f"Geräteänderung erkannt; Automatik pausiert bis {self.manual_until.strftime('%H:%M')}"
        elif self.mode == "Aus":
            status, reason = "Aus", "Beide Wärmequellen ausgeschaltet; kein Frostschutz durch diesen Manager"
        if self.mode == "Automatik" or self.mode == "Aus":
            try:
                if self.mode == "Aus" or temp is None or window_pause or window_unknown:
                    await self.stop_both()
                elif not window_open and self.manual_until is None and row:
                    # Remove radiator demand before handing over to the heat pump.
                    await self.command("radiators", "heat" if row["radiators"] else "off", row["target"])
                    await self.command("heat_pump", "heat" if row["heat_pump"] else "off", row["control_target"])
            except Exception as err:
                self.error = str(err)
                _LOGGER.warning("Heizungsmanager: %s", err)
        if not self.history or now.timestamp() - self.history[-1]["timestamp"] >= 600:
            self.history.append({"timestamp": now.timestamp(), "time": now.isoformat(), "temperature": temp,
                "pump_active": p, "radiator_demand": r, "mode": self.mode, "phase": status})
            self.history = self.history[-144:]
        data = {"status": status, "reason": reason, "mode": self.mode, "temperature": temp,
                "override": {**self.override, "until_iso": datetime.fromtimestamp(self.override["until"], now.tzinfo).isoformat()} if self.override else None,
                "entry_id": self.entry.entry_id,
                "temperature_info": temperature_info, "outdoor": outside, "target": row["target"] if row else None,
                "window_open": window_open, "window_unknown": window_unknown,
                "manual_until": self.manual_until.isoformat() if self.manual_until else None,
                "plan": plan, "history": self.history, "model": self.model.dump(),
                "learning_quality": self.model.quality, "weather_note": self.weather_note,
                "error": self.error, "updated": now.isoformat(), "config": self.config,
                "plan_note": "Normalbetrieb bei geschlossener Tür; manuelle Eingriffe und Störungen nicht vorhersehbar. Keine Verbrauchsprognose."}
        self.async_set_updated_data(data)
        if now.timestamp() - self.last_save >= 900:
            await self.async_save()
            self.last_save = now.timestamp()
