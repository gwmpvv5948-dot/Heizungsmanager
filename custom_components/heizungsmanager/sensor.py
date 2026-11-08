"""Diagnostic and plan entities."""
from homeassistant.components.sensor import SensorEntity, SensorDeviceClass, SensorStateClass
from homeassistant.const import UnitOfTemperature
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([HeatingPlanSensor(coordinator, entry), RoomTemperatureSensor(coordinator, entry)])


class RoomTemperatureSensor(CoordinatorEntity, SensorEntity):
    _attr_has_entity_name = True
    _attr_name = "Heizungsmanager WZ Raumtemperatur"
    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 2

    def __init__(self, coordinator, entry):
        super().__init__(coordinator)
        if coordinator.config["room_id"] != "wohnzimmer":
            self._attr_name = f"Heizungsmanager {coordinator.config['room_name']} " + ("Raumtemperatur" if isinstance(self, RoomTemperatureSensor) else "Fahrplan")
        self._attr_unique_id = f"{entry.entry_id}_room_temperature"
        self._attr_suggested_object_id = f"heizungsmanager_{'wz' if coordinator.config['room_id']=='wohnzimmer' else coordinator.config['room_id']}_raumtemperatur"

    @property
    def available(self):
        return super().available and self.coordinator.data.get("temperature") is not None

    @property
    def native_value(self):
        return self.coordinator.data.get("temperature")

    @property
    def extra_state_attributes(self):
        return {**self.coordinator.data.get("temperature_info", {}), "heizungsmanager_room_temperature": True}


class HeatingPlanSensor(CoordinatorEntity, SensorEntity):
    _attr_has_entity_name = True
    _attr_name = "Heizungsmanager WZ Fahrplan"
    _attr_icon = "mdi:chart-timeline-variant"
    # Home Assistant reads these exclusions when it creates the entity class.
    _unrecorded_attributes = frozenset({"plan", "history", "config", "model", "updated"})

    def __init__(self, coordinator, entry):
        super().__init__(coordinator)
        if coordinator.config["room_id"] != "wohnzimmer":
            self._attr_name = f"Heizungsmanager {coordinator.config['room_name']} " + ("Raumtemperatur" if isinstance(self, RoomTemperatureSensor) else "Fahrplan")
        self._attr_unique_id = f"{entry.entry_id}_plan"
        self._attr_suggested_object_id = f"heizungsmanager_{'wz' if coordinator.config['room_id']=='wohnzimmer' else coordinator.config['room_id']}_fahrplan"

    @property
    def native_value(self):
        return self.coordinator.data.get("status")

    @property
    def extra_state_attributes(self):
        return self.coordinator.data
