"""UI setup and editable room settings."""
from __future__ import annotations

from datetime import time
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector
from .const import DOMAIN, DEFAULTS
from .model import normalize_config, PHASES, SOURCES, ROOMS


def schema(values):
    values = normalize_config(values)
    fields = {}
    fields[vol.Required("pump_regulation",default=values["pump_regulation"])]=vol.In({"hold":"Temperatur halten","hysteresis":"Ein/Aus nach Raumtemperatur"})
    fields[vol.Required("pv_preference_mode",default=values["pv_preference_mode"])]=vol.In({"auto":"Automatisch über Strommanager","off":"Aus"})
    fields[vol.Required("room_id", default=values["room_id"])] = vol.In(ROOMS)
    for key, domain in (("temperature_sensor", "sensor"), ("weather", "weather")):
        default = values.get(key) or vol.UNDEFINED
        fields[vol.Required(key, default=default)] = selector.EntitySelector(
            selector.EntitySelectorConfig(domain=domain))
    for key, domain in (("window_sensor", "binary_sensor"), ("heat_pump", "climate"), ("radiators", "climate")):
        fields[vol.Optional(key, description={"suggested_value": values.get(key, "")})] = selector.EntitySelector(
            selector.EntitySelectorConfig(domain=domain))
    fields[vol.Optional("power_sensor", description={"suggested_value": values.get("power_sensor", "")})] = selector.EntitySelector(
        selector.EntitySelectorConfig(domain="sensor", device_class="power"))
    fields[vol.Optional("secondary_temperature_sensor", description={"suggested_value": values.get("secondary_temperature_sensor", "")})] = selector.EntitySelector(
        selector.EntitySelectorConfig(domain="sensor", device_class="temperature"))
    for key in ("pump_daily_energy_sensor", "radiator_energy_sensor"):
        fields[vol.Optional(key, description={"suggested_value": values.get(key, "")})] = selector.EntitySelector(
            selector.EntitySelectorConfig(domain="sensor", device_class="energy"))
    fields[vol.Required("radiator_energy_period", default=values["radiator_energy_period"])] = vol.In({"daily": "Tageszähler", "total": "Fortlaufender Zähler"})
    for kind in ("weekday", "weekend"):
        for phase, _ in PHASES:
            prefix = f"{kind}_{phase}_"
            fields[vol.Required(prefix + "start", default=values[prefix + "start"])] = selector.TimeSelector()
            fields[vol.Required(prefix + "temperature", default=values[prefix + "temperature"])] = selector.NumberSelector(
                selector.NumberSelectorConfig(min=7, max=24, step=0.5, mode="box"))
            fields[vol.Required(prefix + "sources", default=values[prefix + "sources"])] = vol.In(SOURCES)
    for key, low, high, step in (("pv_on_w",100,10000,100),("pv_off_w",0,9900,100),("pv_confirm_minutes",1,30,1),("pv_hold_minutes",5,120,5),("pv_aux_gap",.5,3,.5),("primary_temperature_weight", 1, 99, 1),
                                ("heating_hysteresis", 0.1, 1.0, 0.1),
                                ("pump_min_on_minutes", 5, 60, 1),
                                ("pump_min_off_minutes", 5, 60, 1),
                                ("pump_overheat_margin", 0.3, 2.0, 0.1),
                                ("pump_temperature_offset", 0, 3.0, 0.5),
                                ("primary_temperature_offset", -3, 3, 0.1),
                                ("secondary_temperature_offset", -3, 3, 0.1),
                                ("temperature_smoothing_minutes", 0, 15, 1),

                                ("window_delay_seconds", 0, 120, 5), ("sensor_timeout_minutes", 10, 360, 10),
                                ("manual_pause_minutes", 15, 480, 15)):
        fields[vol.Required(key, default=values[key])] = selector.NumberSelector(
            selector.NumberSelectorConfig(min=low, max=high, step=step, mode="box"))
    return vol.Schema(fields, extra=vol.REMOVE_EXTRA)


def validate(data):
    if data.get("pv_off_w",500)>=data.get("pv_on_w",1000):return "pv_thresholds"
    if data.get("temperature_sensor") == data.get("secondary_temperature_sensor"):
        return "same_sensor"
    if any((data.get(key, "").startswith("sensor.heizungsmanager_") and data.get(key, "").endswith("_raumtemperatur")) for key in ("temperature_sensor", "secondary_temperature_sensor")):
        return "recursive_sensor"
    if data.get("heat_pump") and data.get("heat_pump") == data.get("radiators"):
        return "same_device"
    if not data.get("heat_pump") and not data.get("radiators"):
        if data.get("room_id") == "schlafzimmer":
            return None
        return "missing_heater"
    for kind in ("weekday", "weekend"):
        for key, _ in PHASES:
            sources = data[f"{kind}_{key}_sources"]
            if (sources in ("both", "heat_pump") and not data.get("heat_pump")) or (sources in ("both", "radiators") and not data.get("radiators")):
                return "missing_source"
        starts = [time.fromisoformat(data[f"{kind}_{key}_start"]) for key, _ in PHASES]
        if starts != sorted(starts) or len(set(starts)) != 4:
            return "schedule_order"
    if data.get("room_id", "wohnzimmer") not in ROOMS:
        return "invalid_room"
    return None


class HeizungsmanagerFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if not hasattr(self, "_room_id"):
            return await self.async_step_room(user_input)
        errors = {}
        if user_input is not None:
            user_input["room_id"] = self._room_id
            for key in ("heat_pump", "radiators", "window_sensor", "power_sensor", "secondary_temperature_sensor", "pump_daily_energy_sensor", "radiator_energy_sensor"):
                user_input.setdefault(key, "")
            error = validate(user_input)
            if error is None:
                # A heat source must never be controlled by two rooms.
                devices = {user_input.get("heat_pump"), user_input.get("radiators")} - {None, ""}
                for entry in self.hass.config_entries.async_entries(DOMAIN):
                    other = {**entry.data, **entry.options}
                    if devices.intersection({other.get("heat_pump"), other.get("radiators")}):
                        error = "shared_device"
                        break
            if error is None:
                return self.async_create_entry(title="Heizungsmanager " + ROOMS[self._room_id], data=user_input)
            errors["base"] = error
        values = {**DEFAULTS, "room_id": self._room_id}
        if self._room_id != "wohnzimmer":
            for key in ("temperature_sensor", "secondary_temperature_sensor", "window_sensor", "heat_pump", "radiators", "power_sensor", "pump_daily_energy_sensor", "radiator_energy_sensor"):
                values[key] = ""
            values = normalize_config(values)
            for kind in ("weekday", "weekend"):
                for phase, _ in PHASES:
                    values[f"{kind}_{phase}_sources"] = "radiators"
        values.update(user_input or {})
        return self.async_show_form(step_id="user", data_schema=schema(values), errors=errors)

    async def async_step_room(self, user_input=None):
        if user_input is not None:
            self._room_id = user_input["room_id"]
            await self.async_set_unique_id(self._room_id)
            self._abort_if_unique_id_configured()
            return await self.async_step_temperature() if self._room_id == "schlafzimmer" else await self.async_step_user()
        return self.async_show_form(step_id="room", data_schema=vol.Schema({
            vol.Required("room_id", default="wohnzimmer"): vol.In(ROOMS)}))

    async def async_step_temperature(self, user_input=None):
        if user_input is not None:
            values = normalize_config({**DEFAULTS,"room_id":"schlafzimmer","temperature_sensor":user_input["temperature_sensor"]})
            for key in ("heat_pump","radiators","window_sensor","secondary_temperature_sensor","weather","power_sensor","pump_daily_energy_sensor","radiator_energy_sensor"):
                values[key] = ""
            for kind in ("weekday","weekend"):
                for phase,_ in PHASES:
                    values[f"{kind}_{phase}_sources"] = "off"
            return self.async_create_entry(title="Heizungsmanager Schlafzimmer",data=values)
        return self.async_show_form(step_id="temperature",data_schema=vol.Schema({
            vol.Required("temperature_sensor",default="sensor.sz_temp"):selector.EntitySelector(selector.EntitySelectorConfig(domain="sensor",device_class="temperature"))}))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return HeizungsmanagerOptions()


class HeizungsmanagerOptions(config_entries.OptionsFlow):
    async def async_step_init(self, user_input=None):
        errors = {}
        if user_input is not None:
            for key in ("heat_pump", "radiators", "window_sensor", "power_sensor", "secondary_temperature_sensor", "pump_daily_energy_sensor", "radiator_energy_sensor"):
                user_input.setdefault(key, "")
            error = validate(user_input)
            if error is None:
                devices = {user_input.get("heat_pump"), user_input.get("radiators")} - {None, ""}
                for entry in self.hass.config_entries.async_entries(DOMAIN):
                    if entry.entry_id == self.config_entry.entry_id:
                        continue
                    other = {**entry.data, **entry.options}
                    if devices.intersection({other.get("heat_pump"), other.get("radiators")}):
                        errors["base"] = "shared_device"
                        return self.async_show_form(step_id="init", data_schema=schema(user_input), errors=errors)
                if user_input["room_id"] != self.config_entry.data.get("room_id", "wohnzimmer"):
                    errors["base"] = "room_immutable"
                    return self.async_show_form(step_id="init", data_schema=schema(user_input), errors=errors)
                # Explicit empty value allows removing the optional power sensor.
                user_input.setdefault("power_sensor", "")
                user_input.setdefault("secondary_temperature_sensor", "")
                return self.async_create_entry(title="", data=user_input)
            errors["base"] = error
        values = {**DEFAULTS, **self.config_entry.data, **self.config_entry.options, **(user_input or {})}
        return self.async_show_form(step_id="init", data_schema=schema(values), errors=errors)
