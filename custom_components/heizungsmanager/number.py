"""Shared physical house heat meter baseline, configurable in HA entities."""
from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.const import EntityCategory
from homeassistant.exceptions import ServiceValidationError
from .house_heat import get_house_heat


async def async_setup_entry(hass,entry,async_add_entities):
    meter=await get_house_heat(hass)
    if meter.owner_entry_id==entry.entry_id:
        async_add_entities([HouseHeatBase(meter)])


class HouseHeatBase(NumberEntity):
    _attr_name='Heizungsmanager Haus-Wärmezähler Startwert'
    _attr_unique_id='heizungsmanager_house_heat_base_kwh'
    _attr_suggested_object_id='heizungsmanager_haus_waermezaehler_startwert'
    _attr_native_unit_of_measurement='kWh'
    _attr_native_min_value=0
    _attr_native_max_value=1000000000
    _attr_native_step=.001
    _attr_mode=NumberMode.BOX
    _attr_icon='mdi:counter'
    _attr_entity_category=EntityCategory.CONFIG
    _attr_should_poll=False

    def __init__(self,meter):
        self.meter=meter

    @property
    def native_value(self):
        return self.meter.data.get('base_kwh')

    async def async_set_native_value(self,value):
        try:
            await self.meter.set_base(value)
        except ValueError as err:
            raise ServiceValidationError(str(err)) from err
        self.async_write_ha_state()
