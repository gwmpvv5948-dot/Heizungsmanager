"""Service-level checks using HA boundary doubles; no real devices are called."""
import asyncio
import importlib.util
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

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
    return types.SimpleNamespace(entity_id=entity,state=value,attributes=attrs,last_changed=NOW-timedelta(minutes=30),last_updated=NOW,last_reported=NOW)

class ControlTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        dt.now=lambda:NOW
        self.states={
            'sensor.wz_temp':state('sensor.wz_temp','19',unit_of_measurement='°C'),
            'binary_sensor.wz_terasse':state('binary_sensor.wz_terasse','off'),
            'climate.wz_midea_ac':state('climate.wz_midea_ac','off',hvac_modes=['off','heat'],temperature=18,min_temp=16,max_temp=30,target_temp_step=.5,hvac_action='off',fan_modes=['auto','low','medium','high','silent','turbo'],fan_mode='turbo'),
            'climate.wz_vtherm':state('climate.wz_vtherm','off',hvac_modes=['off','heat'],temperature=18,min_temp=7,max_temp=24,target_temp_step=.1,valve_open_percent=0,hvac_action='off')}
        self.service=AsyncMock()
        hass=types.SimpleNamespace(states=types.SimpleNamespace(get=self.states.get),services=types.SimpleNamespace(async_call=self.service))
        entry=types.SimpleNamespace(entry_id='test',data={"pump_regulation":"hysteresis"},options={})
        self.c=HeatingCoordinator(hass,entry)
        self.c.last_weather_request=NOW.timestamp()

    async def test_observation_never_controls(self):
        await self.c.async_tick()
        self.service.assert_not_awaited()
        self.assertGreaterEqual(len(self.c.data['plan']),145)

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
        self.states['sensor.wz_temp'].state='17.6'
        self.c.config['temperature_smoothing_minutes']=0
        self.c.mode='Automatik'
        await self.c.async_tick()
        self.assertTrue(self.c.data['plan'][0]['heat_pump'])
        self.states['climate.wz_midea_ac'].state='heat'
        self.states['climate.wz_midea_ac'].attributes['temperature']=19
        self.service.reset_mock()
        self.states['sensor.wz_temp'].state='18.0'
        await self.c.async_tick()
        self.assertFalse(self.c.data['plan'][0]['heat_pump'])
        self.assertTrue(any(c.args[1]=='set_hvac_mode' and c.args[2].get('entity_id')=='climate.wz_midea_ac' and c.args[2]['hvac_mode']=='off' for c in self.service.await_args_list))

    async def test_recently_stopped_pump_waits_even_after_mode_change(self):
        self.states['climate.wz_midea_ac'].last_changed=NOW-timedelta(minutes=2)
        await self.c.async_set_mode('Automatik')
        row=self.c.data['plan'][0]
        self.assertFalse(row['heat_pump'])
        self.assertTrue(row['requested_heat_pump'])
        self.assertEqual(row['cycle_protection'],'Mindestpause')
        self.assertEqual(row['cycle_remaining_seconds'],13*60)
        self.assertFalse(any(c.args[1]=='set_hvac_mode' and c.args[2]['hvac_mode']=='heat' for c in self.service.await_args_list))
        dt.now=lambda:NOW+timedelta(minutes=13)
        await self.c.async_tick()
        self.assertTrue(self.c.data['plan'][0]['heat_pump'])

    async def test_minimum_runtime_holds_mode_but_not_higher_target(self):
        pump=self.states['climate.wz_midea_ac'];pump.state='heat';pump.last_changed=NOW-timedelta(minutes=2)
        self.states['sensor.wz_temp'].state='21.1'
        self.c.mode='Automatik'
        await self.c.async_tick()
        row=self.c.data['plan'][0]
        self.assertTrue(row['heat_pump'])
        self.assertFalse(row['requested_heat_pump'])
        self.assertEqual(row['control_target'],21.5)
        self.assertEqual(row['cycle_protection'],'Mindestlaufzeit')
        self.assertFalse(any(c.args[1]=='set_hvac_mode' and c.args[2]['hvac_mode']=='off' and c.args[2]['entity_id']==pump.entity_id for c in self.service.await_args_list))

    async def test_overtemperature_overrides_minimum_runtime(self):
        pump=self.states['climate.wz_midea_ac'];pump.state='heat';pump.last_changed=NOW
        self.states['sensor.wz_temp'].state='21.5'
        await self.c.async_set_mode('Automatik')
        self.assertFalse(self.c.data['plan'][0]['heat_pump'])
        self.assertIn('Übertemperatur',self.c.data['reason'])

    async def test_explicit_off_overrides_minimum_runtime(self):
        pump=self.states['climate.wz_midea_ac'];pump.state='heat';pump.last_changed=NOW
        await self.c.async_set_mode('Aus')
        self.assertTrue(any(c.args[1]=='set_hvac_mode' and c.args[2].get('entity_id')==pump.entity_id and c.args[2]['hvac_mode']=='off' for c in self.service.await_args_list))

    async def test_door_pause_overrides_minimum_runtime(self):
        pump=self.states['climate.wz_midea_ac'];pump.state='heat';pump.last_changed=NOW
        self.states['binary_sensor.wz_terasse'].state='on'
        await self.c.async_set_mode('Automatik')
        self.assertTrue(any(c.args[1]=='set_hvac_mode' and c.args[2].get('entity_id')==pump.entity_id and c.args[2]['hvac_mode']=='off' for c in self.service.await_args_list))

    async def test_quick_override_cannot_bypass_minimum_pause(self):
        self.states['climate.wz_midea_ac'].last_changed=NOW-timedelta(minutes=1)
        self.c.mode='Automatik'
        await self.c.async_set_override(22,'1h')
        self.assertFalse(self.c.data['plan'][0]['heat_pump'])
        self.assertEqual(self.c.data['plan'][0]['cycle_protection'],'Mindestpause')

    async def test_night_minimum_pause_and_plan_transition(self):
        night=NOW.replace(hour=23)
        dt.now=lambda:night
        for item in self.states.values():item.last_reported=night
        pump=self.states['climate.wz_midea_ac'];pump.last_changed=night-timedelta(minutes=1)
        self.states['sensor.wz_temp'].state='17.6'
        await self.c.async_set_mode('Automatik')
        plan=self.c.data['plan']
        self.assertFalse(plan[0]['heat_pump'])
        self.assertEqual(plan[0]['cycle_remaining_seconds'],14*60)
        self.assertFalse(plan[1]['heat_pump'])
        self.assertTrue(plan[2]['heat_pump'])

    async def test_radiator_only_phase_stops_pump_despite_minimum_runtime(self):
        self.c.config['weekday_day_sources']='radiators'
        pump=self.states['climate.wz_midea_ac'];pump.state='heat';pump.last_changed=NOW
        await self.c.async_set_mode('Automatik')
        row=self.c.data['plan'][0]
        self.assertFalse(row['heat_pump']);self.assertTrue(row['radiators'])
        calls=[c.args for c in self.service.await_args_list]
        self.assertTrue(any(c[1]=='set_hvac_mode' and c[2].get('entity_id')==pump.entity_id and c[2]['hvac_mode']=='off' for c in calls))

    async def test_no_heat_phase_turns_off_both_even_when_cold(self):
        self.c.config['weekday_day_sources']='off'
        self.states['sensor.wz_temp'].state='17'
        for entity in ('climate.wz_midea_ac','climate.wz_vtherm'):self.states[entity].state='heat'
        await self.c.async_set_mode('Automatik')
        self.assertFalse(self.c.data['plan'][0]['heat_pump'])
        self.assertFalse(self.c.data['plan'][0]['radiators'])
        self.assertEqual(sum(c.args[1]=='set_hvac_mode' and c.args[2]['hvac_mode']=='off' for c in self.service.await_args_list),2)

    async def test_room_state_and_overrides_are_independent(self):
        entry=types.SimpleNamespace(entry_id='alwin',data={'room_id':'alwin'},options={})
        other=HeatingCoordinator(self.c.hass,entry)
        other.last_weather_request=NOW.timestamp()
        await self.c.async_set_override(20,'1h')
        self.assertIsNone(other.override)
        self.assertEqual(other.config['room_id'],'alwin')
        self.assertNotEqual(self.c.entry.entry_id,other.entry.entry_id)
        self.assertIsNot(self.c.model,other.model)

    async def test_radiator_only_room_without_window_contact(self):
        self.c.config.update(heat_pump='',window_sensor='')
        for kind in ('weekday','weekend'):
            for phase in ('morning','day','evening','night'):
                self.c.config[f'{kind}_{phase}_sources']='radiators'
        await self.c.async_set_mode('Automatik')
        self.assertFalse(self.c.data['window_unknown'])
        self.assertIsNone(self.c.data['error'])
        self.assertTrue(self.c.data['plan'][0]['radiators'])
        self.assertFalse(any(call.args[2]['entity_id']=='climate.wz_midea_ac' for call in self.service.await_args_list))

    async def test_selected_mode_is_saved_immediately(self):
        with patch.object(Store, 'async_save', new_callable=AsyncMock) as saved:
            await self.c.async_set_mode('Automatik')
            self.assertEqual(saved.call_args.args[0]['mode'],'Automatik')
            await self.c.async_set_mode('Aus')
            self.assertEqual(saved.call_args.args[0]['mode'],'Aus')

    async def test_saved_modes_restore_after_restart(self):
        for mode in ('Automatik','Aus','Beobachten'):
            with self.subTest(mode=mode), patch.object(Store,'async_load',new=AsyncMock(return_value={'mode':mode})):
                await self.c.async_initialize()
                self.assertEqual(self.c.mode,mode)
                self.assertEqual(self.c.data['mode'],mode)

    async def test_missing_or_invalid_saved_mode_starts_observing(self):
        for mode in (None,'invalid',{},1):
            with self.subTest(mode=mode), patch.object(Store,'async_load',new=AsyncMock(return_value={'mode':mode})):
                await self.c.async_initialize()
                self.assertEqual(self.c.mode,'Beobachten')

    async def test_saving_options_preserves_selected_mode(self):
        for mode in ('Automatik','Aus','Beobachten'):
            self.c.mode=mode
            await self.c.async_apply_options()
            self.assertEqual(self.c.mode,mode)
            self.assertEqual(self.c.data['mode'],mode)

    async def test_invalid_mode_cannot_change_state(self):
        with self.assertRaises(ValueError):await self.c.async_set_mode('invalid')
        self.assertEqual(self.c.mode,'Beobachten')

    async def test_all_four_phases_hold_each_heater_inside_hysteresis_band(self):
        for hour in (6,12,18,23):
            with self.subTest(hour=hour):
                self.setUp()
                when=NOW.replace(hour=hour,minute=30)
                dt.now=lambda:when
                self.c.config.update(heating_hysteresis=.3,temperature_smoothing_minutes=0)
                for kind in ('weekday','weekend'):
                    for phase in ('morning','day','evening','night'):
                        self.c.config[f'{kind}_{phase}_sources']='both'
                        self.c.config[f'{kind}_{phase}_temperature']=21
                for item in self.states.values():
                    item.last_reported=when;item.last_changed=when-timedelta(minutes=30)
                self.states['sensor.wz_temp'].state='20.8'
                await self.c.async_set_mode('Automatik')
                row=self.c.data['plan'][0]
                self.assertFalse(row['heat_pump']);self.assertFalse(row['radiators'])
                for key in ('climate.wz_midea_ac','climate.wz_vtherm'):self.states[key].state='heat'
                await self.c.async_tick()
                row=self.c.data['plan'][0]
                self.assertTrue(row['heat_pump']);self.assertTrue(row['radiators'])
                self.states['sensor.wz_temp'].state='21'
                await self.c.async_tick()
                row=self.c.data['plan'][0]
                self.assertFalse(row['heat_pump']);self.assertFalse(row['radiators'])

    async def test_hysteresis_starts_both_below_lower_threshold(self):
        self.c.config.update(heating_hysteresis=.3,temperature_smoothing_minutes=0,weekday_day_sources='both')
        self.states['sensor.wz_temp'].state='20.69'
        await self.c.async_set_mode('Automatik')
        row=self.c.data['plan'][0]
        self.assertTrue(row['heat_pump']);self.assertTrue(row['radiators'])
        self.assertEqual(row['switch_on_below'],20.7)
        self.assertEqual(row['switch_off_at'],21)

    async def test_each_source_has_independent_hysteresis_state(self):
        self.c.config.update(heating_hysteresis=.3,weekday_day_sources='both')
        self.states['sensor.wz_temp'].state='20.8'
        self.states['climate.wz_vtherm'].state='heat'
        await self.c.async_set_mode('Automatik')
        row=self.c.data['plan'][0]
        self.assertFalse(row['heat_pump']);self.assertTrue(row['radiators'])

    async def test_quick_override_uses_common_hysteresis_for_radiators(self):
        self.c.config.update(heating_hysteresis=.3,weekday_day_sources='radiators')
        self.states['sensor.wz_temp'].state='19.8'
        self.c.mode='Automatik'
        await self.c.async_set_override(20,'1h')
        self.assertFalse(self.c.data['plan'][0]['radiators'])
        self.states['climate.wz_vtherm'].state='heat'
        await self.c.async_tick()
        self.assertTrue(self.c.data['plan'][0]['radiators'])

    async def test_midea_offset_is_commanded_without_changing_radiator_target(self):
        self.c.config.update(weekday_day_sources='both',pump_temperature_offset=.5)
        await self.c.async_set_mode('Automatik')
        targets={call.args[2]['entity_id']:call.args[2]['temperature'] for call in self.service.await_args_list if call.args[1]=='set_temperature'}
        self.assertEqual(targets['climate.wz_midea_ac'],21.5)
        self.assertEqual(targets['climate.wz_vtherm'],21)
        self.assertEqual(self.c.data['target'],21)

    async def test_quick_override_applies_midea_offset(self):
        self.c.mode='Automatik';self.c.config['pump_temperature_offset']=1
        await self.c.async_set_override(20,'1h')
        self.assertEqual(self.c.data['target'],20)
        self.assertEqual(self.c.data['plan'][0]['control_target'],21)

    async def test_midea_offset_does_not_raise_switch_off_threshold(self):
        self.c.config['pump_temperature_offset']=2
        self.states['sensor.wz_temp'].state='21'
        self.states['climate.wz_midea_ac'].state='heat'
        await self.c.async_set_mode('Automatik')
        self.assertFalse(self.c.data['plan'][0]['heat_pump'])
        self.assertEqual(self.c.data['plan'][0]['switch_off_at'],21)

    async def test_automatic_start_sets_medium_after_heat_mode(self):
        await self.c.async_set_mode('Automatik')
        calls=[call.args for call in self.service.await_args_list]
        heat=next(i for i,args in enumerate(calls) if args[1]=='set_hvac_mode' and args[2].get('entity_id')=='climate.wz_midea_ac' and args[2]['hvac_mode']=='heat')
        fan=next(i for i,args in enumerate(calls) if args[1]=='set_fan_mode')
        self.assertGreater(fan,heat)
        self.assertEqual(calls[fan][2],{'entity_id':'climate.wz_midea_ac','fan_mode':'medium'})

    async def test_running_manual_fan_is_retained_until_next_start(self):
        pump=self.states['climate.wz_midea_ac']
        await self.c.command('heat_pump','heat',21.5)
        pump.state='heat';pump.attributes.update(temperature=21.5,fan_mode='low')
        self.service.reset_mock()
        await self.c.command('heat_pump','heat',22)
        self.assertFalse(any(c.args[1]=='set_fan_mode' for c in self.service.await_args_list))
        await self.c.command('heat_pump','off',7)
        pump.state='off';self.service.reset_mock()
        await self.c.command('heat_pump','heat',21.5)
        self.assertTrue(any(c.args[1]=='set_fan_mode' and c.args[2]['fan_mode']=='medium' for c in self.service.await_args_list))

    async def test_start_fan_uses_physical_device(self):
        pump=self.states['climate.wz_midea_ac']
        pump.attributes['vtherm_over_climate']={'underlying_entities':['climate.midea']}
        self.states['climate.midea']=state('climate.midea','heat',fan_modes=['low','medium','turbo'],fan_mode='turbo')
        await self.c.async_set_mode('Automatik')
        fans=[c.args[2] for c in self.service.await_args_list if c.args[1]=='set_fan_mode']
        self.assertEqual(fans,[{'entity_id':'climate.midea','fan_mode':'medium'}])

    async def test_no_fan_command_when_there_is_no_heat_demand(self):
        self.states['sensor.wz_temp'].state='22'
        await self.c.async_set_mode('Automatik')
        self.assertFalse(any(c.args[1]=='set_fan_mode' for c in self.service.await_args_list))

    async def test_start_fan_error_is_reported_and_retried(self):
        async def services(domain,service,data,**kwargs):
            if service=='set_fan_mode':raise RuntimeError('Lüfter nicht erreichbar')
        self.service.side_effect=services
        await self.c.async_set_mode('Automatik')
        self.assertIn('Lüfter nicht erreichbar',self.c.data['error'])
        self.assertFalse(self.c._pump_heat_commanded)
        self.service.side_effect=None;self.service.reset_mock()
        self.states["climate.wz_midea_ac"].state="heat"
        self.states["climate.wz_midea_ac"].attributes["temperature"]=self.c.commands["heat_pump"][1]
        await self.c.async_tick()
        self.assertTrue(self.c._pump_heat_commanded)
        self.assertTrue(any(c.args[1]=='set_fan_mode' for c in self.service.await_args_list))

    async def test_medium_is_not_sent_during_minimum_pause(self):
        self.states['climate.wz_midea_ac'].last_changed=NOW-timedelta(minutes=1)
        await self.c.async_set_mode('Automatik')
        self.assertFalse(any(c.args[1]=='set_fan_mode' for c in self.service.await_args_list))

    async def test_running_midea_is_adopted_once_without_repeated_fan_commands(self):
        pump=self.states['climate.wz_midea_ac'];pump.state='heat';pump.attributes['temperature']=21.5
        await self.c.async_set_mode('Automatik')
        self.assertTrue(any(c.args[1]=='set_fan_mode' for c in self.service.await_args_list))
        pump.attributes['fan_mode']='low';self.service.reset_mock()
        await self.c.async_tick()
        self.assertFalse(any(c.args[1]=='set_fan_mode' for c in self.service.await_args_list))

    async def test_failed_first_stop_still_attempts_other_device(self):
        for key in ('climate.wz_midea_ac','climate.wz_vtherm'): self.states[key].state='heat'
        self.c.mode='Aus'
        self.service.side_effect=[RuntimeError('Heizkörper nicht erreichbar'),None]
        await self.c.async_tick()
        self.assertEqual(self.service.await_count,2)
        self.assertIn('Heizkörper nicht erreichbar',self.c.data['error'])

if __name__=='__main__':unittest.main()

class HoldServiceTests(unittest.IsolatedAsyncioTestCase):
    setUp=ControlTests.setUp
    async def test_hold_avoids_hvac_off_at_room_target_and_does_not_use_offset(self):
        self.c.config['pump_regulation']='hold'
        for key in ('sensor.wz_temp',):self.states[key].state='21'
        pump=self.states['climate.wz_midea_ac'];pump.state='heat';pump.attributes['temperature']=21;pump.attributes['hvac_action']='idle';pump.attributes['fan_mode']='medium'
        self.c.mode='Automatik'
        await self.c.async_tick()
        self.assertTrue(self.c.data['plan'][0]['heat_pump'])
        self.assertEqual(self.c.data['plan'][0]['control_target'],21)
        calls=[x.args for x in self.service.await_args_list]
        self.assertFalse(any(x[1]=='set_hvac_mode' and x[2].get('entity_id')==pump.entity_id and x[2].get('hvac_mode')=='off' for x in calls))

class RestartTests(unittest.IsolatedAsyncioTestCase):
    setUp = ControlTests.setUp

    async def test_start_does_not_send_commands_even_when_sensors_missing(self):
        self.c.mode = 'Automatik'
        self.c._startup_pending = True
        self.states['climate.wz_midea_ac'].state = 'heat'
        self.states['sensor.wz_temp'].state = 'unavailable'
        await self.c.async_tick()
        self.service.assert_not_awaited()
        dt.now=lambda:NOW+timedelta(minutes=10)
        await self.c.async_tick()
        self.service.assert_not_awaited()
        self.assertTrue(self.c.data['startup_waiting'])

    async def test_ready_start_adopts_running_pump_without_resetting_fan_or_target(self):
        self.c.mode='Automatik'
        self.c.config['pump_regulation']='hold'
        self.c._startup_pending=True
        pump=self.states['climate.wz_midea_ac'];pump.state='heat';pump.attributes['temperature']=21;pump.attributes['fan_mode']='turbo'
        self.states['sensor.wz_temp'].state='21'
        await self.c.async_tick()
        dt.now=lambda:NOW+timedelta(seconds=31)
        await self.c.async_tick()
        self.service.assert_not_awaited()
        self.assertTrue(self.c._pump_heat_commanded)
        self.assertFalse(self.c._startup_pending)
        self.assertEqual(pump.attributes['fan_mode'],'turbo')
        dt.now=lambda:NOW+timedelta(seconds=62)
        await self.c.async_tick()
        self.service.assert_not_awaited()

    async def test_ha_not_running_and_restored_states_do_not_control(self):
        self.c.mode='Aus';self.c._startup_pending=True;self.c.hass.is_running=False
        await self.c.async_tick();self.service.assert_not_awaited()
        self.c.hass.is_running=True;self.states['climate.wz_midea_ac'].attributes['restored']=True
        dt.now=lambda:NOW+timedelta(minutes=1)
        await self.c.async_tick();self.service.assert_not_awaited()
        self.assertTrue(self.c._startup_pending)

    async def test_shutdown_only_saves_and_never_switches_devices(self):
        await self.c.async_shutdown()
        self.service.assert_not_awaited()

    async def test_stop_event_blocks_sensor_loss_fail_safe_and_queued_commands(self):
        self.c.mode='Automatik'
        self.states['climate.wz_midea_ac'].state='heat'
        self.c.async_stopping()
        self.states['sensor.wz_temp'].state='unavailable'
        await self.c.async_tick()
        await self.c.stop_both()
        await self.c.command('heat_pump','off',7)
        self.service.assert_not_awaited()

    async def test_stop_during_awaited_temperature_does_not_send_followup_hvac_or_fan(self):
        self.c.mode='Automatik'
        async def stopping_service(domain,service,data,**kw):
            self.c.async_stopping()
        self.service.side_effect=stopping_service
        await self.c.command('heat_pump','heat',21)
        self.assertEqual(self.service.await_count,1)
        self.assertEqual(self.service.await_args.args[1],'set_temperature')

    async def test_opposing_regulator_does_not_trigger_subsecond_off_command_storm(self):
        self.c.mode='Automatik'
        device=self.states['climate.wz_vtherm'];device.state='heat'
        await self.c.command('radiators','off',21)
        self.assertEqual(self.service.await_count,1)
        for seconds in (1,2,3,5,10,14):
            dt.now=lambda seconds=seconds:NOW+timedelta(seconds=seconds)
            # A second regulator keeps changing back to HEAT before confirmation.
            device.state='heat'
            await self.c.command('radiators','off',21)
        self.assertEqual(self.service.await_count,1)
        dt.now=lambda:NOW+timedelta(seconds=16)
        self.c.detect_manual(dt.now())
        self.assertIsNotNone(self.c.manual_until)
        self.service.reset_mock()
        await self.c.async_tick()
        self.service.assert_not_awaited()

class ManualRadiatorTests(unittest.IsolatedAsyncioTestCase):
    setUp = ControlTests.setUp

    def manual_event(self, target=21):
        wrapper=self.states['climate.wz_vtherm']
        wrapper.attributes['temperature']=7
        wrapper.attributes['vtherm_over_climate']={'underlying_entities':['climate.wz1']}
        old=state('climate.wz1','heat',temperature=7)
        new=state('climate.wz1','heat',temperature=target)
        return types.SimpleNamespace(data={'entity_id':'climate.wz1','old_state':old,'new_state':new})

    async def test_local_knob_becomes_room_target_until_next_phase_even_if_vtherm_resets_it(self):
        self.c.mode='Automatik'
        self.c.config['weekday_day_sources']='both'
        self.c.commands['radiators']=('off',21,NOW.timestamp()-60)
        event=self.manual_event(21)
        tasks=[]
        self.c.hass.async_create_task=lambda coro:tasks.append(asyncio.create_task(coro))
        self.c.async_changed(event)
        # VTherm has already reverted the physical target before the queued tick.
        self.states['climate.wz1']=state('climate.wz1','off',temperature=7)
        await asyncio.gather(*tasks)
        self.assertEqual(self.c.override['temperature'],21)
        self.assertEqual(self.c.override['duration'],'schedule')
        self.assertEqual(self.c.data['target'],21)
        calls=[call.args for call in self.service.await_args_list]
        self.assertTrue(any(a[1]=='set_temperature' and a[2]=={'entity_id':'climate.wz_vtherm','temperature':21} for a in calls))
        self.assertTrue(any(a[1]=='set_hvac_mode' and a[2]=={'entity_id':'climate.wz_vtherm','hvac_mode':'heat'} for a in calls))
        self.assertFalse(any(a[1]=='set_hvac_mode' and a[2]=={'entity_id':'climate.wz_vtherm','hvac_mode':'off'} for a in calls))
        until=self.c.override['until']
        dt.now=lambda:datetime.fromtimestamp(until+1,tz=timezone.utc)
        await self.c.async_tick()
        self.assertIsNone(self.c.override)

    async def test_echoes_low_setbacks_and_startup_restoration_are_not_manual_targets(self):
        self.c.mode='Automatik'
        event=self.manual_event(21)
        self.c._sending_targets['climate.wz_vtherm']=21
        self.assertIsNone(self.c.manual_temperature(event))
        self.c._sending_targets.clear()
        self.states['climate.wz_vtherm'].attributes['temperature']=21
        self.assertIsNone(self.c.manual_temperature(event))
        self.states['climate.wz_vtherm'].attributes['temperature']=7
        self.assertIsNone(self.c.manual_temperature(self.manual_event(7)))
        self.c._startup_pending=True
        self.assertIsNone(self.c.manual_temperature(self.manual_event(21)))

    async def test_window_protection_still_has_priority_over_manual_room_target(self):
        self.c.mode='Automatik'
        self.c._pending_manual_target={'temperature':21,'source':'climate.wz1'}
        self.states['binary_sensor.wz_terasse'].state='on'
        self.states['binary_sensor.wz_terasse'].last_changed=NOW-timedelta(minutes=5)
        self.states['climate.wz_vtherm'].state='heat'
        await self.c.async_tick()
        self.assertEqual(self.c.data['target'],21)
        self.assertTrue(any(c.args[1]=='set_hvac_mode' and c.args[2].get('entity_id')=='climate.wz_vtherm' and c.args[2].get('hvac_mode')=='off' for c in self.service.await_args_list))

    async def test_wz2_is_supported_and_last_manual_target_wins_for_whole_room(self):
        self.c.mode='Automatik'
        self.c.config['weekday_day_sources']='both'
        event1=self.manual_event(21)
        self.states['climate.wz_vtherm'].attributes['vtherm_over_climate']['underlying_entities'].append('climate.wz2')
        event2=types.SimpleNamespace(data={'entity_id':'climate.wz2','old_state':state('climate.wz2','heat',temperature=7),'new_state':state('climate.wz2','heat',temperature=22)})
        tasks=[]
        self.c.hass.async_create_task=lambda coro:tasks.append(asyncio.create_task(coro))
        self.c.async_changed(event1)
        self.c.async_changed(event2)
        await asyncio.gather(*tasks)
        self.assertEqual(self.c.override['temperature'],22)
        self.assertEqual(self.c.override['source'],'climate.wz2')
        self.assertEqual(self.c.data['target'],22)
