"""UI setup and editable room settings."""
from __future__ import annotations

from datetime import time
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector
from .const import DOMAIN, DEFAULTS


def schema(values):
    fields = {}
    for key, domain in (("temperature_sensor", "sensor"), ("window_sensor", "binary_sensor"),
                        ("heat_pump", "climate"), ("radiators", "climate"), ("weather", "weather")):
        default = values.get(key) or vol.UNDEFINED
        fields[vol.Required(key, default=default)] = selector.EntitySelector(
            selector.EntitySelectorConfig(domain=domain))
    fields[vol.Optional("power_sensor", description={"suggested_value": values.get("power_sensor", "")})] = selector.EntitySelector(
        selector.EntitySelectorConfig(domain="sensor", device_class="power"))
    fields[vol.Optional("secondary_temperature_sensor", description={"suggested_value": values.get("secondary_temperature_sensor", "")})] = selector.EntitySelector(
        selector.EntitySelectorConfig(domain="sensor", device_class="temperature"))
    for key in ("weekday_start", "weekend_start", "night_start"):
        fields[vol.Required(key, default=values[key])] = selector.TimeSelector()
    for key, low, high, step in (("primary_temperature_weight", 1, 99, 1),
                                ("primary_temperature_offset", -3, 3, 0.1),
                                ("secondary_temperature_offset", -3, 3, 0.1),
                                ("temperature_smoothing_minutes", 0, 15, 1),
                                ("comfort_temperature", 16, 24, 0.5), ("night_temperature", 7, 22, 0.5),
                                ("max_preheat_minutes", 15, 240, 5), ("morning_support_minutes", 0, 180, 5),
                                ("window_delay_seconds", 0, 120, 5), ("sensor_timeout_minutes", 10, 360, 10),
                                ("manual_pause_minutes", 15, 480, 15)):
        fields[vol.Required(key, default=values[key])] = selector.NumberSelector(
            selector.NumberSelectorConfig(min=low, max=high, step=step, mode="box"))
    return vol.Schema(fields)


def validate(data):
    if data.get("temperature_sensor") == data.get("secondary_temperature_sensor"):
        return "same_sensor"
    if any(data.get(key, "").startswith("sensor.heizungsmanager_wz_raumtemperatur") for key in ("temperature_sensor", "secondary_temperature_sensor")):
        return "recursive_sensor"
    if data["heat_pump"] == data["radiators"]:
        return "same_device"
    if data["night_temperature"] > data["comfort_temperature"]:
        return "temperature_order"
    end = time.fromisoformat(data["night_start"])
    if any(time.fromisoformat(data[k]) >= end for k in ("weekday_start", "weekend_start")):
        return "schedule_order"
    return None


class HeizungsmanagerFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            error = validate(user_input)
            if error is None:
                await self.async_set_unique_id("wohnzimmer")
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title="Heizungsmanager Wohnzimmer", data=user_input)
            errors["base"] = error
        return self.async_show_form(step_id="user", data_schema=schema({**DEFAULTS, **(user_input or {})}), errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return HeizungsmanagerOptions()


class HeizungsmanagerOptions(config_entries.OptionsFlow):
    async def async_step_init(self, user_input=None):
        errors = {}
        if user_input is not None:
            error = validate(user_input)
            if error is None:
                # Explicit empty value allows removing the optional power sensor.
                user_input.setdefault("power_sensor", "")
                user_input.setdefault("secondary_temperature_sensor", "")
                return self.async_create_entry(title="", data=user_input)
            errors["base"] = error
        values = {**DEFAULTS, **self.config_entry.data, **self.config_entry.options, **(user_input or {})}
        return self.async_show_form(step_id="init", data_schema=schema(values), errors=errors)
