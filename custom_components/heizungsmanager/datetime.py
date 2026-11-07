"""Timestamp of the shared physical meter reading."""
from datetime import datetime,timezone
from homeassistant.components.datetime import DateTimeEntity
from homeassistant.const import EntityCategory
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from .const import DOMAIN
from .house_heat import get_house_heat


async def async_setup_entry(hass,entry,async_add_entities):
    meter=await get_house_heat(hass)
    if meter.owner_entry_id==entry.entry_id:
        async_add_entities([HouseHeatReadingTime(meter)])


class HouseHeatReadingTime(DateTimeEntity):
    _attr_name='Heizungsmanager Haus-Wärmezähler Ablesezeitpunkt'
    _attr_unique_id='heizungsmanager_house_heat_reading_time'
    _attr_suggested_object_id='heizungsmanager_haus_waermezaehler_ablesezeitpunkt'
    _attr_icon='mdi:calendar-clock'
    _attr_entity_category=EntityCategory.CONFIG
    _attr_should_poll=False

    def __init__(self,meter):
        self.meter=meter

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self.async_on_remove(async_dispatcher_connect(
            self.hass, f"{DOMAIN}_house_heat_reading", self.async_write_ha_state))

    @property
    def native_value(self):
        stamp=self.meter.data.get('start')
        return datetime.fromtimestamp(stamp,timezone.utc) if stamp is not None else None

    async def async_set_value(self,value):
        try:
            await self.meter.set_start(value)
        except ValueError as err:
            raise ServiceValidationError(str(err)) from err
        self.async_write_ha_state()
