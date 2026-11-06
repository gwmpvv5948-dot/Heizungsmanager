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
from .model import ThermalModel, finite, make_plan, next_schedule_time, next_night_time, normalize_config
from .temperature import RoomTemperature
from .temperature_history import temperature_history
from .pv import PVPreference, strommanager_surplus

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
        self.history_attempted = None
        self.history_source = "Eigener Verlauf"
        self.unsubs = []
        self.lock = asyncio.Lock()
        self.error = None
        self.last_save = 0
        self.room_temperature = RoomTemperature()
        self.pump_heat_active = False
        self._pump_heat_commanded = False
        self.override = None
        self.pv_preference = PVPreference()
        self._startup_pending = False
        self._startup_ready_since = None
        self._stopping = False
        self._pending_manual_target = None
        self._sending_targets = {}
        self._recent_radiator_targets = []

    async def async_initialize(self):
        self._startup_pending = True
        self._startup_ready_since = None
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
        self.listen_for_stop()
        self.unsubs.append(async_track_time_interval(self.hass, self.async_tick, timedelta(seconds=30)))
        watched = self.watched_entities()
        self.listen_for_states()
        await self.async_tick()

    @callback
    def async_stopping(self, _event=None):
        self._stopping = True

    def listen_for_stop(self):
        bus = getattr(self.hass, "bus", None)
        if bus is not None:
            self.unsubs.append(bus.async_listen_once("homeassistant_stop", self.async_stopping))

    async def async_shutdown(self):
        self._stopping = True
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
            if duration not in ("1h", "2h", "4h", "night", "schedule"):
                raise ValueError("Ungültige Dauer")
        async with self.lock:
            self._startup_pending = False
            now = dt_util.now()
            until = next_schedule_time(now, self.config) if duration == "schedule" else next_night_time(now,self.config) if duration == "night" else now.timestamp() + {"1h":3600,"2h":7200,"4h":14400}[duration]
            self.override = {"temperature": temperature, "until": until, "duration": duration} if temperature is not None else None
            self.manual_until = None
            self.commands = {}
            self.previous = None
            self.pump_heat_active = False
            await self._tick()
            await self.async_save()

    def radiator_entities(self):
        controller = self.state("radiators")
        details = controller.attributes.get("vtherm_over_climate", {}) if controller else {}
        ids = details.get("underlying_entities", []) if isinstance(details, dict) else []
        ids = ids or (controller.attributes.get("underlying_entities", []) if controller else [])
        return {self.config.get("radiators"), *[i for i in ids if isinstance(i, str) and i.startswith("climate.")]} - {None, ""}

    def listen_for_states(self):
        bus = getattr(self.hass, "bus", None)
        if bus is not None:
            # Underlying devices can appear after setup; resolve room membership
            # dynamically instead of permanently missing their later events.
            self.unsubs.append(bus.async_listen("state_changed", self.async_changed))
        else:
            self.unsubs.append(async_track_state_change_event(self.hass, self.watched_entities(), self.async_changed))

    def manual_temperature(self, event):
        if self._startup_pending or self._stopping or self.mode != "Automatik":
            return None
        data = getattr(event, "data", {})
        entity_id, old, new = data.get("entity_id"), data.get("old_state"), data.get("new_state")
        if entity_id not in self.radiator_entities() or not old or not new:
            return None
        if old.state in ("unknown", "unavailable") or new.state in ("unknown", "unavailable") or old.attributes.get("restored") or new.attributes.get("restored"):
            return None
        before = finite(old.attributes.get("temperature"), 0, 40)
        target = finite(new.attributes.get("temperature"), 16, 24)
        if before is None or target is None or abs(target-before)<0.15 or abs(target*2-round(target*2))>0.001:
            return None
        now = dt_util.now().timestamp()
        self._recent_radiator_targets = [(value,stamp) for value,stamp in self._recent_radiator_targets if 0 <= now-stamp < 120]
        if any(abs(target-value)<0.15 for value,stamp in self._recent_radiator_targets):
            return None
        own = self._sending_targets.get(self.config.get("radiators"))
        previous = self.commands.get("radiators")
        controller = self.state("radiators")
        wrapper_target = finite(controller.attributes.get("temperature"), 0, 40) if controller else None
        if (own is not None and abs(target-own)<0.15) or (previous and previous[0] != "off" and abs(target-previous[1])<0.15):
            return None
        if entity_id != self.config.get("radiators") and wrapper_target is not None and abs(target-wrapper_target)<0.15:
            return None
        return {"temperature": target, "source": entity_id}

    @callback
    def async_changed(self, event):
        if self._stopping:
            return
        entity_id = getattr(event, "data", {}).get("entity_id")
        if entity_id and entity_id not in set(self.watched_entities()) | self.radiator_entities():
            return
        target = self.manual_temperature(event)
        if target:
            self._pending_manual_target = target
        self.hass.async_create_task(self.async_tick())

    async def async_set_mode(self, mode):
        if mode not in ("Beobachten", "Automatik", "Aus"):
            raise ValueError("Ungültige Betriebsart")
        async with self.lock:
            self._startup_pending = False
            if mode != self.mode:
                self._pump_heat_commanded = False
            self.mode = mode
            self.manual_until = None
            self.commands = {}
            self.previous = None
            self.pump_heat_active = False
            await self._tick()
            await self.async_save()

    async def async_apply_options(self):
        async with self.lock:
            self._startup_pending = False
            previous_pump = self.config.get("heat_pump")
            self.config = normalize_config({**DEFAULTS, **self.entry.data, **self.entry.options})
            self.history_attempted = None
            if self.config.get("heat_pump") != previous_pump:
                self._pump_heat_commanded = False
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
            self.unsubs = [async_track_time_interval(self.hass, self.async_tick, timedelta(seconds=30))]
            self.listen_for_states()
            self.listen_for_stop()
            await self.async_load_temperature_history()
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
        if state is None or state.state in ("unknown", "unavailable") or state.attributes.get("restored"):
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

    async def set_start_fan_medium(self, controller):
        if self._stopping or not getattr(self.hass, "is_running", True):
            return
        """Apply the start default after HVAC activation, using the actual device."""
        details = controller.attributes.get("vtherm_over_climate") or {}
        devices = details.get("underlying_entities") if isinstance(details, dict) else None
        devices = devices or controller.attributes.get("underlying_entities")
        if not isinstance(devices, list) or not devices:
            devices = [controller.entity_id]
        for entity_id in devices:
            device = self.hass.states.get(entity_id)
            if device is None or device.state in ("unknown", "unavailable"):
                raise ValueError(f"Midea-Lüfter: {entity_id} nicht verfügbar")
            modes = device.attributes.get("fan_modes", [])
            if "medium" not in modes:
                raise ValueError(f"{entity_id} unterstützt Lüftermodus Mittel nicht")
            if device.attributes.get("fan_mode") != "medium":
                await self.hass.services.async_call("climate", "set_fan_mode",
                    {"entity_id": entity_id, "fan_mode": "medium"}, blocking=True)

    async def command(self, key, mode, target):
        if self._stopping or not getattr(self.hass, "is_running", True):
            return
        if not self.config.get(key):
            return
        state = self.state(key)
        if state is None or state.state in ("unknown", "unavailable"):
            raise ValueError(f"{self.config[key]} nicht verfügbar")
        if mode not in state.attributes.get("hvac_modes", []):
            raise ValueError(f"{self.config[key]} unterstützt {mode} nicht")
        previous = self.commands.get(key)
        current_target = finite(state.attributes.get("temperature"), 0, 40)
        mismatch = state.state != mode or (mode != "off" and (current_target is None or abs(current_target-target) > 0.15))
        if (previous and previous[0] == mode and abs(previous[1]-target) < 0.05
                and dt_util.now().timestamp()-previous[2] < 15 and mismatch):
            # Allow the previous command to settle. Resetting its timestamp and
            # resending here would fight VTherm's underlying-mode feedback forever.
            return
        starting_pump = key == "heat_pump" and mode == "heat" and (state.state != "heat" or not self._pump_heat_commanded)
        changed = False
        if mode != "off":
            low, high = state.attributes.get("min_temp", 7), state.attributes.get("max_temp", 30)
            target = max(low, min(high, target))
            step = state.attributes.get("target_temp_step", 0.5) or 0.5
            target = round(round(target / step) * step, 2)
            current = finite(state.attributes.get("temperature"), 0, 40)
            if current is None or abs(current - target) > 0.05:
                if key == "radiators":
                    now = dt_util.now().timestamp()
                    # Both TRVs can report the old or new target long after the
                    # wrapper command. Neither is a fresh physical knob choice.
                    values = [target,current]
                    for entity_id in self.radiator_entities():
                        device = self.hass.states.get(entity_id)
                        if device:
                            values.append(finite(device.attributes.get("temperature"),0,40))
                    self._recent_radiator_targets = [(value,stamp) for value,stamp in self._recent_radiator_targets if 0 <= now-stamp < 120]
                    self._recent_radiator_targets.extend((value,now) for value in values if value is not None)
                self._sending_targets[state.entity_id] = target
                try:
                    await self.hass.services.async_call("climate", "set_temperature",
                        {"entity_id": state.entity_id, "temperature": target}, blocking=True)
                finally:
                    self._sending_targets.pop(state.entity_id, None)
                changed = True
        if self._stopping or not getattr(self.hass, "is_running", True):
            return
        if state.state != mode:
            await self.hass.services.async_call("climate", "set_hvac_mode",
                {"entity_id": state.entity_id, "hvac_mode": mode}, blocking=True)
            changed = True
        previous = self.commands.get(key)
        stamp = dt_util.now().timestamp() if changed or previous is None else previous[2]
        self.commands[key] = (mode, target, stamp)
        if key == "heat_pump":
            if mode != "heat":
                self._pump_heat_commanded = False
            elif starting_pump:
                # Failed fan requests are retried; a running manual fan choice is retained.
                self._pump_heat_commanded = False
                await self.set_start_fan_medium(self.hass.states.get(state.entity_id) or state)
                self._pump_heat_commanded = True

    async def stop_both(self):
        errors = []
        for key in ("radiators", "heat_pump"):
            try:
                await self.command(key, "off", 7)
            except Exception as err:
                errors.append(str(err))
        if errors:
            raise ValueError("; ".join(errors))

    async def async_load_temperature_history(self):
        now=dt_util.now()
        if self.history_attempted is not None and now.timestamp()-self.history_attempted<600:
            return
        self.history_attempted=now.timestamp()
        if not hasattr(self.hass,'async_add_executor_job'):
            return
        config=dict(self.config)
        ids=list(dict.fromkeys(config.get(key) for key in ('temperature_sensor','secondary_temperature_sensor') if config.get(key)))
        if not ids:
            return
        try:
            from homeassistant.components.recorder import get_instance, history
            start=(now-timedelta(hours=24)).replace(second=0,microsecond=0)
            def read():
                records=history.get_significant_states(self.hass,start-timedelta(hours=1),now,ids,
                    include_start_time_state=True,significant_changes_only=False,minimal_response=False,no_attributes=False)
                return temperature_history(records,start.timestamp(),now.timestamp(),config)
            points=await get_instance(self.hass).async_add_executor_job(read)
            # Discard a response from an old mapping or a stopped integration.
            if self._stopping or config!=self.config:
                return
            if points:
                self.history=points
                self.history_source='Home Assistant Recorder'
            else:
                self.history_source='Eigener Verlauf · keine HA-Historie vorhanden'
        except Exception as err:
            self.history_source='Eigener Verlauf · HA-Historie derzeit nicht verfügbar'
            _LOGGER.debug('Temperaturhistorie nicht verfügbar: %s',err)

    async def async_tick(self, _now=None):
        if self._stopping or (self.lock.locked() and self._pending_manual_target is None):
            return
        await self.async_load_temperature_history()
        async with self.lock:
            await self._tick()

    def startup_blocked(self, now, temperature, window_unknown):
        """Read-only startup: wait for HA and stable inputs, then adopt devices."""
        if not self._startup_pending:
            return False
        ready = getattr(self.hass, "is_running", True) and temperature is not None and not window_unknown
        window = self.state("window_sensor")
        if window is not None and window.attributes.get("restored"):
            ready = False
        devices = {}
        for key in ("heat_pump", "radiators"):
            if not self.config.get(key):
                continue
            state = self.state(key)
            target = finite(state.attributes.get("temperature"), 0, 40) if state else None
            if (not state or state.state in ("unknown", "unavailable") or state.attributes.get("restored")
                    or (state.state != "off" and target is None)):
                ready = False
            else:
                devices[key] = (state.state, target if target is not None else 7, now.timestamp())
        if not ready:
            self._startup_ready_since = None
            return True
        self._startup_ready_since = self._startup_ready_since or now.timestamp()
        if now.timestamp() - self._startup_ready_since < 30:
            return True
        self.commands = devices
        pump = self.state("heat_pump")
        self._pump_heat_commanded = bool(pump and pump.state == "heat")
        self.previous = None
        self._startup_pending = False
        # Adoption itself must not set temperature, mode, fan or swing.
        return True

    async def _tick(self):
        if self._stopping:
            return
        now = dt_util.now()
        if self.config.get("room_id") == "schlafzimmer" and not any(self.config.get(key) for key in ("radiators","heat_pump")):
            info = self.read_room_temperature(now)
            temperature = info.get("value")
            # Reuse the normal combined/smoothed reading without any planner or actuator calls.
            if not self.history or now.timestamp()-self.history[-1]["timestamp"] >= 600:
                self.history.append({"timestamp":now.timestamp(),"time":now.isoformat(),"temperature":temperature})
                self.history = self.history[-144:]
            self.async_set_updated_data({"entry_id":self.entry.entry_id,"config":self.config,"temperature":temperature,
                "temperature_info":info,"target":None,"outdoor":None,"plan":[],"history":self.history,
                "mode":"Temperaturanzeige","status":"Nur Temperatur","updated":now.isoformat(),"error":None,"history_source":self.history_source})
            if now.timestamp()-self.last_save>=900:
                await self.async_save()
                self.last_save=now.timestamp()
            return
        manual_applied = False
        if self._pending_manual_target:
            pending, self._pending_manual_target = self._pending_manual_target, None
            if self.mode == "Automatik" and not self._startup_pending:
                manual_applied = True
                self.override = {**pending, "until": next_schedule_time(now, self.config), "duration": "schedule"}
                self.manual_until = None
                self.commands = {}
                self.previous = None
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
        startup_blocked = self.startup_blocked(now, temp, window_unknown)
        p, r = self.activity()
        healthy_devices = all(self.state(k) and self.state(k).state not in ("unknown", "unavailable") for k in ("heat_pump", "radiators") if self.config.get(k))
        if self.mode == "Automatik" and not window_open and not window_unknown:
            self.detect_manual(now)
        if self.manual_until and self.manual_until <= now:
            self.manual_until = None
        learn_ok = not startup_blocked and temp is not None and not temperature_info["learning_paused"] and outside is not None and not window_open and not window_unknown and healthy_devices and self.manual_until is None and p is not None and r is not None
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
        power_state=self.state("power_sensor")
        pump_w=finite(power_state.state,0,30000) if power_state and self.fresh(power_state,now,5) and power_state.attributes.get("unit_of_measurement") in ("W","kW") else None
        if pump_w is not None and power_state.attributes.get("unit_of_measurement")=="kW":pump_w*=1000
        pv_status=self.pv_preference.update(now.timestamp(),strommanager_surplus(self.hass,now.timestamp(),pump_w),self.config)
        pump_state = self.state("heat_pump")
        pump_on = bool(pump_state and pump_state.state == "heat")
        # last_changed tracks the HVAC mode, not changing temperature/power attributes.
        # Restarting HA conservatively starts a fresh protection interval.
        pump_since = pump_state.last_changed.timestamp() if pump_state else now.timestamp()
        plan = make_plan(now, temp, outside, forecast, self.config, self.model,
                         pump_on, self.override, pump_on, pump_since,
                         bool(self.state("radiators") and self.state("radiators").state == "heat"),pv_status) if temp is not None else []
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
            status, reason = "Manuelle Pause", f"Externe Geräteänderung oder Gegenregelung erkannt; Automatik pausiert bis {self.manual_until.strftime('%H:%M')}"
        elif self.mode == "Aus":
            status, reason = "Aus", "Beide Wärmequellen ausgeschaltet; kein Frostschutz durch diesen Manager"
        if startup_blocked:
            status, reason = "Startphase · Geräte bleiben unverändert", "Warte auf HA und 30 Sekunden gültige Eingangsdaten; vorhandene Heizmodi, Sollwerte und Lüfter werden übernommen. Danach normale Regelung."
        if not startup_blocked and (self.mode == "Automatik" or self.mode == "Aus"):
            try:
                if self.mode == "Aus" or temp is None or window_pause or window_unknown:
                    await self.stop_both()
                elif not window_open and self.manual_until is None and row:
                    # Remove radiator demand before handing over to the heat pump.
                    manual_radiator = bool(self.override and self.override.get("source") and row["sources"] in ("both", "radiators"))
                    await self.command("radiators", "heat" if row["radiators"] or manual_radiator else "off", row["target"])
                    await self.command("heat_pump", "heat" if row["heat_pump"] else "off", row["control_target"])
            except Exception as err:
                self.error = str(err)
                _LOGGER.warning("Heizungsmanager: %s", err)
        if not self.history or now.timestamp() - self.history[-1]["timestamp"] >= 600:
            self.history.append({"timestamp": now.timestamp(), "time": now.isoformat(), "temperature": temp,
                "pump_active": p, "radiator_demand": r, "mode": self.mode, "phase": status})
            self.history = self.history[-144:]
        data = {"startup_waiting": startup_blocked, "status": status, "reason": reason, "mode": self.mode, "temperature": temp,
                "override": {**self.override, "until_iso": datetime.fromtimestamp(self.override["until"], now.tzinfo).isoformat()} if self.override else None,
                "entry_id": self.entry.entry_id,
                "temperature_info": temperature_info, "outdoor": outside, "target": row["target"] if row else None,
                "window_open": window_open, "window_unknown": window_unknown,
                "manual_until": self.manual_until.isoformat() if self.manual_until else None,
                "pv_preference":pv_status,"plan": plan, "history": self.history, "model": self.model.dump(),
                "learning_quality": self.model.quality, "weather_note": self.weather_note,
                "error": self.error, "updated": now.isoformat(), "config": self.config,
                "history_source": self.history_source,
                "plan_note": "Normalbetrieb bei geschlossener Tür; manuelle Eingriffe und Störungen nicht vorhersehbar. Keine Verbrauchsprognose."}
        self.async_set_updated_data(data)
        if manual_applied or now.timestamp() - self.last_save >= 900:
            await self.async_save()
            self.last_save = now.timestamp()
