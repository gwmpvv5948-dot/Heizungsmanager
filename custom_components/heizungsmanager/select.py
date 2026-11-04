"""Explicit operating-mode control."""
from homeassistant.components.select import SelectEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([HeatingMode(hass.data[DOMAIN][entry.entry_id], entry)])


class HeatingMode(CoordinatorEntity, SelectEntity):
    _attr_has_entity_name = True
    _attr_name = "Heizungsmanager WZ Betriebsart"
    _attr_icon = "mdi:heat-pump"
    _attr_options = ["Beobachten", "Automatik", "Aus"]

    def __init__(self, coordinator, entry):
        super().__init__(coordinator)
        if coordinator.config["room_id"] != "wohnzimmer":
            self._attr_name = f"Heizungsmanager {coordinator.config['room_name']} Betriebsart"
        self._attr_unique_id = f"{entry.entry_id}_mode"
        self._attr_suggested_object_id = f"heizungsmanager_{'wz' if coordinator.config['room_id']=='wohnzimmer' else coordinator.config['room_id']}_betriebsart"

    @property
    def current_option(self):
        return self.coordinator.mode

    async def async_select_option(self, option):
        if option in self.options:
            await self.coordinator.async_set_mode(option)
