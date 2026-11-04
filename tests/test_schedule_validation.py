"""Validate schedules with the same pure validator used by both HA forms/API."""
import ast
from datetime import time
from pathlib import Path
import unittest
from test_model import m, c

path=Path(__file__).resolve().parents[1]/'custom_components/heizungsmanager/config_flow.py'
function=next(n for n in ast.parse(path.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='validate')
namespace={'time':time,'PHASES':m.PHASES,'ROOMS':m.ROOMS}
exec(compile(ast.Module(body=[function],type_ignores=[]),str(path),'exec'),namespace)
validate=namespace['validate']

class ScheduleValidationTests(unittest.TestCase):
    def setUp(self):self.cfg=m.normalize_config(c.DEFAULTS)
    def test_migrated_plan_valid(self):self.assertIsNone(validate(self.cfg))
    def test_duplicate_and_reversed_times_rejected(self):
        for value in ('06:20:00','06:00:00'):
            self.cfg['weekday_day_start']=value
            self.assertEqual(validate(self.cfg),'schedule_order')
    def test_night_can_be_warmer_than_other_phases(self):
        self.cfg['weekend_night_temperature']=22
        self.cfg['weekend_day_temperature']=18
        self.assertIsNone(validate(self.cfg))
    def test_unassigned_source_rejected(self):
        self.cfg['heat_pump']=''
        self.assertEqual(validate(self.cfg),'missing_source')
    def test_radiator_only_room_valid(self):
        self.cfg['heat_pump']=''
        for kind in ('weekday','weekend'):
            for phase,_ in m.PHASES:self.cfg[f'{kind}_{phase}_sources']='radiators'
        self.assertIsNone(validate(self.cfg))
    def test_room_without_heater_rejected(self):
        self.cfg.update(heat_pump='',radiators='')
        self.assertEqual(validate(self.cfg),'missing_heater')
    def test_computed_sensor_of_any_room_rejected(self):
        self.cfg['temperature_sensor']='sensor.heizungsmanager_alwin_raumtemperatur'
        self.assertEqual(validate(self.cfg),'recursive_sensor')

class RoomOptionsTests(unittest.IsolatedAsyncioTestCase):
    async def test_options_cannot_reuse_another_rooms_heater(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        node=next(n for n in ast.parse(path.read_text()).body if isinstance(n,ast.ClassDef) and n.name=='HeizungsmanagerOptions')
        node.bases=[]
        ns={'validate':validate,'schema':lambda data:data,'DEFAULTS':c.DEFAULTS,'DOMAIN':'heizungsmanager'}
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(path),'exec'),ns)
        flow=ns['HeizungsmanagerOptions']()
        flow.config_entry=SimpleNamespace(entry_id='wz',data={'room_id':'wohnzimmer'},options={})
        other=SimpleNamespace(entry_id='az',data={'heat_pump':'climate.wz_midea_ac'},options={})
        flow.hass=SimpleNamespace(config_entries=SimpleNamespace(async_entries=lambda domain:[flow.config_entry,other]))
        flow.async_show_form=Mock(return_value={'type':'form'})
        flow.async_create_entry=Mock()
        await flow.async_step_init(m.normalize_config(c.DEFAULTS))
        self.assertEqual(flow.async_show_form.call_args.kwargs['errors']['base'],'shared_device')
        flow.async_create_entry.assert_not_called()
