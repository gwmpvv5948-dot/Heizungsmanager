"""Local heating manager entry point."""
from pathlib import Path
from homeassistant.components.http import StaticPathConfig
from homeassistant.components import frontend
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.const import Platform
from .const import DOMAIN
from .coordinator import HeatingCoordinator
from .websocket import async_register_api

PLATFORMS = [Platform.SENSOR, Platform.SELECT]


async def async_setup_entry(hass, entry):
    domain_data = hass.data.setdefault(DOMAIN, {})
    if not domain_data.get("static_registered"):
        await hass.http.async_register_static_paths([StaticPathConfig(
            "/heizungsmanager-static",
            str(Path(__file__).parent / "frontend"), False)])
        domain_data["static_registered"] = True
        async_register_api(hass)
    coordinator = HeatingCoordinator(hass, entry)
    await coordinator.async_initialize()
    domain_data[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    if not domain_data.get("panel_registered"):
        await async_register_panel(hass, frontend_url_path="heizungsmanager",
            webcomponent_name="heizungsmanager-panel", sidebar_title="Heizungsmanager",
            sidebar_icon="mdi:heat-pump", module_url="/heizungsmanager-static/panel.js?v=0.2.2",
            config={"entry_id": entry.entry_id}, require_admin=True)
        domain_data["panel_registered"] = True
    entry.async_on_unload(entry.add_update_listener(async_options_updated))
    return True


async def async_options_updated(hass, entry):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    await coordinator.async_apply_options()


async def async_unload_entry(hass, entry):
    if await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        coordinator = hass.data[DOMAIN].pop(entry.entry_id)
        await coordinator.async_shutdown()
        remaining = [value for value in hass.data[DOMAIN].values() if isinstance(value, HeatingCoordinator)]
        frontend.async_remove_panel(hass, "heizungsmanager")
        hass.data[DOMAIN]["panel_registered"] = False
        if remaining:
            await async_register_panel(hass, frontend_url_path="heizungsmanager",
                webcomponent_name="heizungsmanager-panel", sidebar_title="Heizungsmanager",
                sidebar_icon="mdi:heat-pump", module_url="/heizungsmanager-static/panel.js?v=0.2.2",
                config={"entry_id": remaining[0].entry.entry_id}, require_admin=True)
            hass.data[DOMAIN]["panel_registered"] = True
        return True
    return False
