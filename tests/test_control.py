"""Service-level checks using HA boundary doubles; no real devices are called."""
import asyncio
import importlib.util
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock

ROOT = Path(__file__).resolve().parents[1] / 'custom_components/heizungsmanager'
NOW = datetime(2026,11,4,12,0,tzinfo=timezone.utc)
def module(name, **values):
    obj = types.ModuleType(name)
    obj.__dict__.update(values)
    sys.modules[name] = obj
    return obj
class Coordinator:
    def __init__(self,*args,**kwargs): self.hass=args[0]; self.data={}
    def async_set_updated_data(self,data): self.data=data
class Store:
    def __init__(self,*args): pass
    async_load=AsyncMock(return_value={})
    async_save=AsyncMock()
module('homeassistant')
module('homeassistant.core',callback=lambda x:x)
module('homeassistant.helpers')
module('homeassistant.helpers.storage',Store=Store)
module('homeassistant.helpers.event',async_track_time_interval=lambda *a:lambda:None,async_track_state_change_event=lambda *a:lambda:None)
module('homeassistant.helpers.update_coordinator',DataUpdateCoordinator=Coordinator)
dt=module('homeassistant.util.dt',now=lambda:NOW,parse_datetime=datetime.fromisoformat)
module('homeassistant.util',dt=dt)
pkg=module('test_heating');pkg.__path__=[str(ROOT)]
for file in ('const','model','coordinator'):
    spec=importlib.util.spec_from_file_location('test_heating.'+file,ROOT/(file+'.py'))
    obj=importlib.util.module_from_spec(spec);sys.modules[spec.name]=obj;spec.loader.exec_module(obj)
HeatingCoordinator=sys.modules['test_heating.coordinator'].HeatingCoordinator
DEFAULTS=sys.modules['test_heating.const'].DEFAULTS

def state(entity,value,**attrs):
    return types.SimpleNamespace(entity_id=entity,state=value,attributes=attrs,last_changed=NOW-timedelta(minutes=5),last_updated=NOW,last_reported=NOW)

class ControlTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        dt.now=lambda:NOW
        self.states={
            'sensor.wz_temp':state('sensor.wz_temp','19',unit_of_measurement='°C'),
            'binary_sensor.wz_terasse':state('binary_sensor.wz_terasse','off'),
            'climate.wz_midea_ac':state('climate.wz_midea_ac','off',hvac_modes=['off','heat'],temperature=18,min_temp=16,max_temp=30,target_temp_step=.5,hvac_action='off'),
            'climate.wz_vtherm':state('climate.wz_vtherm','off',hvac_modes=['off','heat'],temperature=18,min_temp=7,max_temp=24,target_temp_step=.1,valve_open_percent=0,hvac_action='off')}
        self.service=AsyncMock()
        hass=types.SimpleNamespace(states=types.SimpleNamespace(get=self.states.get),services=types.SimpleNamespace(async_call=self.service))
        entry=types.SimpleNamespace(entry_id='test',data={},options={})
        self.c=HeatingCoordinator(hass,entry)
        self.c.last_weather_request=NOW.timestamp()

    async def test_observation_never_controls(self):
        await self.c.async_tick()
        self.service.assert_not_awaited()
        self.assertEqual(len(self.c.data['plan']),145)

    async def test_auto_keeps_pump_in_heat_and_radiators_off_after_morning(self):
        self.c.mode='Automatik'
        await self.c.async_tick()
        calls=[call.args for call in self.service.await_args_list]
        self.assertTrue(any(args[1]=='set_hvac_mode' and args[2]['entity_id']=='climate.wz_midea_ac' and args[2]['hvac_mode']=='heat' for args in calls))
        self.assertFalse(any(args[1]=='set_hvac_mode' and args[2]['entity_id']=='climate.wz_vtherm' and args[2]['hvac_mode']=='heat' for args in calls))

    async def test_open_door_stops_both(self):
        for key in ('climate.wz_midea_ac','climate.wz_vtherm'): self.states[key].state='heat'
        self.states['binary_sensor.wz_terasse'].state='on'
        self.c.mode='Automatik'
        await self.c.async_tick()
        calls=[call.args for call in self.service.await_args_list]
        self.assertEqual(sum(args[1]=='set_hvac_mode' and args[2]['hvac_mode']=='off' for args in calls),2)
        self.assertEqual(self.c.data['status'],'Terrassentür offen')

    async def test_invalid_room_sensor_stops_both_and_has_no_plan(self):
        for key in ('climate.wz_midea_ac','climate.wz_vtherm'): self.states[key].state='heat'
        self.states['sensor.wz_temp'].state='nan'
        self.c.mode='Automatik'
        await self.c.async_tick()
        self.assertEqual(self.c.data['plan'],[])
        self.assertEqual(self.service.await_count,2)

    async def test_manual_change_pauses_without_overwriting(self):
        self.c.mode='Automatik'
        self.states['climate.wz_midea_ac'].state='heat'
        self.c.commands={'heat_pump':('heat',21,NOW.timestamp()-60)}
        await self.c.async_tick()
        self.service.assert_not_awaited()
        self.assertEqual(self.c.data['status'],'Manuelle Pause')

    async def test_weighted_temperature_is_used_for_plan_and_room_value(self):
        self.states['sensor.0x881a14fffe0e9a1e_temperature']=state('sensor.0x881a14fffe0e9a1e_temperature','22',unit_of_measurement='°C')
        await self.c.async_tick()
        self.assertEqual(self.c.data['temperature'],19.75)
        self.assertEqual(self.c.data['plan'][0]['temperature'],19.75)
        self.assertEqual(self.c.data['temperature_info']['sources'][1]['effective_weight'],25)

    async def test_stale_secondary_is_excluded_and_does_not_stop_primary(self):
        ikea=state('sensor.0x881a14fffe0e9a1e_temperature','22',unit_of_measurement='°C')
        ikea.last_reported=NOW-timedelta(hours=3)
        self.states[ikea.entity_id]=ikea
        await self.c.async_tick()
        self.assertEqual(self.c.data['temperature'],19)
        self.assertEqual(self.c.data['temperature_info']['sources'][0]['effective_weight'],100)
        self.assertEqual(self.c.data['temperature_info']['sources'][1]['reason'],'Messwert veraltet')

    def tearDown(self):
        dt.now=lambda:NOW

    async def test_night_midea_off_above_floor(self):
        night=NOW.replace(hour=23)
        dt.now=lambda:night
        for item in self.states.values():item.last_reported=night
        self.states['climate.wz_midea_ac'].state='heat'
        self.states['sensor.wz_temp'].state='20'
        self.c.mode='Automatik'
        await self.c.async_tick()
        self.assertFalse(self.c.data['plan'][0]['heat_pump'])
        self.assertTrue(any(c.args[1]=='set_hvac_mode' and c.args[2].get('entity_id')=='climate.wz_midea_ac' and c.args[2]['hvac_mode']=='off' for c in self.service.await_args_list))

    async def test_automatic_does_not_start_midea_at_21_1_with_target_20_5(self):
        self.states['sensor.wz_temp'].state='21.1'
        self.c.config['comfort_temperature']=20.5
        await self.c.async_set_mode('Automatik')
        self.assertFalse(self.c.data['plan'][0]['heat_pump'])
        self.assertFalse(any(c.args[1]=='set_hvac_mode' and c.args[2]['hvac_mode']=='heat' for c in self.service.await_args_list))

    async def test_running_midea_stops_when_daytime_target_is_reached(self):
        self.states['sensor.wz_temp'].state='21.1'
        self.states['climate.wz_midea_ac'].state='heat'
        self.c.config['comfort_temperature']=20.5
        await self.c.async_set_mode('Automatik')
        self.assertTrue(any(c.args[1]=='set_hvac_mode' and c.args[2].get('entity_id')=='climate.wz_midea_ac' and c.args[2]['hvac_mode']=='off' for c in self.service.await_args_list))

    async def test_quick_override_preserves_config_and_observation(self):
        config=dict(self.c.config)
        await self.c.async_set_override(20,'2h')
        self.assertEqual(self.c.data['target'],20)
        self.assertEqual(self.c.config,config)
        self.assertEqual(self.c.mode,'Beobachten')
        self.service.assert_not_awaited()
        self.assertEqual(self.c.override['until'],NOW.timestamp()+7200)
        await self.c.async_set_override()
        self.assertIsNone(self.c.override)
        self.assertEqual(self.c.data['target'],21)

    async def test_lower_quick_override_does_not_request_heat_above_target(self):
        self.states['sensor.wz_temp'].state='21.1'
        self.c.mode='Automatik'
        await self.c.async_set_override(20,'1h')
        self.assertFalse(self.c.data['plan'][0]['heat_pump'])
        self.assertFalse(any(c.args[1]=='set_hvac_mode' and c.args[2]['hvac_mode']=='heat' for c in self.service.await_args_list))

    async def test_invalid_quick_override_does_not_change_state(self):
        for temperature in (float('nan'),25,20.1):
            with self.assertRaises(ValueError):await self.c.async_set_override(temperature,'2h')
        with self.assertRaises(ValueError):await self.c.async_set_override(20,'invalid')
        self.assertIsNone(self.c.override)

    async def test_night_reheats_only_until_upper_boundary(self):
        night=NOW.replace(hour=23)
        dt.now=lambda:night
        for item in self.states.values():item.last_reported=night
        self.states['sensor.wz_temp'].state='17.9'
        self.c.config['temperature_smoothing_minutes']=0
        self.c.mode='Automatik'
        await self.c.async_tick()
        self.assertTrue(self.c.data['plan'][0]['heat_pump'])
        self.states['climate.wz_midea_ac'].state='heat'
        self.states['climate.wz_midea_ac'].attributes['temperature']=19
        self.service.reset_mock()
        self.states['sensor.wz_temp'].state='18.3'
        await self.c.async_tick()
        self.assertFalse(self.c.data['plan'][0]['heat_pump'])
        self.assertTrue(any(c.args[1]=='set_hvac_mode' and c.args[2].get('entity_id')=='climate.wz_midea_ac' and c.args[2]['hvac_mode']=='off' for c in self.service.await_args_list))

    async def test_failed_first_stop_still_attempts_other_device(self):
        for key in ('climate.wz_midea_ac','climate.wz_vtherm'): self.states[key].state='heat'
        self.c.mode='Aus'
        self.service.side_effect=[RuntimeError('Heizkörper nicht erreichbar'),None]
        await self.c.async_tick()
        self.assertEqual(self.service.await_count,2)
        self.assertIn('Heizkörper nicht erreichbar',self.c.data['error'])

if __name__=='__main__':unittest.main()
