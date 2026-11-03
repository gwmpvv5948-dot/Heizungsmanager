"""Admin-only API for the local sidebar panel."""
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import callback
from homeassistant.helpers import entity_registry as er
from .const import DOMAIN
from .config_flow import schema, validate


def find_coordinator(hass, msg):
    return hass.data.get(DOMAIN, {}).get(msg["entry_id"])


def payload(hass, coordinator):
    registry = er.async_get(hass)
    entry_id = coordinator.entry.entry_id
    return {"config": coordinator.config, "mode": coordinator.mode, "version": "0.1.7",
        "plan_entity": registry.async_get_entity_id("sensor", DOMAIN, f"{entry_id}_plan"),
        "mode_entity": registry.async_get_entity_id("select", DOMAIN, f"{entry_id}_mode")}


@callback
def async_register_api(hass):
    websocket_api.async_register_command(hass, get_config)
    websocket_api.async_register_command(hass, save_config)
    websocket_api.async_register_command(hass, set_override)


@websocket_api.websocket_command({vol.Required("type"): "heizungsmanager/override",
    vol.Required("entry_id"): str, vol.Required("action"): vol.In(["set", "clear"]),
    vol.Optional("temperature"): vol.Coerce(float), vol.Optional("duration", default="2h"): str})
@websocket_api.async_response
async def set_override(hass, connection, msg):
    if connection.user is None or not connection.user.is_admin:
        connection.send_error(msg["id"], "unauthorized", "Administratorrechte erforderlich")
        return
    coordinator = find_coordinator(hass, msg)
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "Heizungsmanager nicht eingerichtet")
        return
    if msg["action"] == "set" and "temperature" not in msg:
        connection.send_error(msg["id"], "invalid_override", "Wunschtemperatur fehlt")
        return
    try:
        await coordinator.async_set_override(msg.get("temperature") if msg["action"] == "set" else None, msg.get("duration", "2h"))
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_override", str(err))
        return
    connection.send_result(msg["id"], {"override": coordinator.override, "mode": coordinator.mode})


@websocket_api.websocket_command({vol.Required("type"): "heizungsmanager/config", vol.Required("entry_id"): str})
@websocket_api.async_response
async def get_config(hass, connection, msg):
    if connection.user is None or not connection.user.is_admin:
        connection.send_error(msg["id"], "unauthorized", "Administratorrechte erforderlich")
        return
    coordinator = find_coordinator(hass, msg)
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "Heizungsmanager nicht eingerichtet")
        return
    connection.send_result(msg["id"], payload(hass, coordinator))


@websocket_api.websocket_command({vol.Required("type"): "heizungsmanager/save_config",
    vol.Required("entry_id"): str, vol.Required("config"): dict})
@websocket_api.async_response
async def save_config(hass, connection, msg):
    if connection.user is None or not connection.user.is_admin:
        connection.send_error(msg["id"], "unauthorized", "Administratorrechte erforderlich")
        return
    coordinator = find_coordinator(hass, msg)
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "Heizungsmanager nicht eingerichtet")
        return
    try:
        submitted = dict(msg["config"])
        for key in ("power_sensor", "secondary_temperature_sensor"):
            if not submitted.get(key):
                submitted.pop(key, None)
        config = schema(coordinator.config)(submitted)
        config.setdefault("power_sensor", "")
        config.setdefault("secondary_temperature_sensor", "")
        error = validate(config)
        if error:
            messages = {"same_sensor": "Bitte zwei unterschiedliche Temperatursensoren wählen.",
                "recursive_sensor": "Die berechnete Raumtemperatur darf nicht als eigene Quelle verwendet werden.",
                "same_device": "Midea und Heizkörper müssen unterschiedlich sein.",
                "temperature_order": "Nachttemperatur darf nicht über Komforttemperatur liegen.",
                "schedule_order": "Komfortzeiten müssen vor der Nachtabsenkung liegen."}
            raise ValueError(messages[error])
        for key in ("temperature_sensor", "secondary_temperature_sensor", "window_sensor", "heat_pump", "radiators", "weather", "power_sensor"):
            if config.get(key) and hass.states.get(config[key]) is None:
                raise ValueError(f"Entität nicht gefunden: {config[key]}")
        for key in ("temperature_sensor", "secondary_temperature_sensor"):
            sensor = hass.states.get(config[key]) if config.get(key) else None
            if sensor and sensor.attributes.get("unit_of_measurement") != "°C":
                raise ValueError("Die Raumtemperatursensoren müssen Werte in °C liefern.")
            if sensor and sensor.attributes.get("heizungsmanager_room_temperature"):
                raise ValueError("Die berechnete Raumtemperatur darf nicht als eigene Quelle verwendet werden.")
    except (vol.Invalid, ValueError) as err:
        connection.send_error(msg["id"], "invalid_config", str(err))
        return
    hass.config_entries.async_update_entry(coordinator.entry, options=config)
    # The entry listener applies settings and returns to observation mode.
    connection.send_result(msg["id"], {"saved": True, "mode": "Beobachten"})
