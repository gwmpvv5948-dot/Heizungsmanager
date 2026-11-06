"""Recorder reconstruction uses held HA states, corrections and genuine gaps."""
from datetime import datetime, timezone
from types import SimpleNamespace as N
import unittest
from test_control import DEFAULTS
from test_heating.temperature_history import temperature_history

def row(t,value,**attrs):
    return N(last_updated=datetime.fromtimestamp(t,timezone.utc),state=str(value),attributes={'unit_of_measurement':'°C',**attrs})

class HistoryTests(unittest.TestCase):
    def config(self,**kw):
        return {**DEFAULTS,'temperature_sensor':'sensor.a','secondary_temperature_sensor':'sensor.b','temperature_smoothing_minutes':0,**kw}
    def test_unchanged_sensor_stays_valid_through_six_hours(self):
        rows=temperature_history({'sensor.a':[row(0,21)]},3600,25200,self.config())
        self.assertEqual(len(rows),37)
        self.assertTrue(all(p['temperature']==21 for p in rows))
    def test_weight_and_offsets_match_current_room_computation(self):
        rows=temperature_history({'sensor.a':[row(0,20)],'sensor.b':[row(0,22)]},3600,4200,self.config(primary_temperature_weight=75,primary_temperature_offset=.4,secondary_temperature_offset=-.2))
        self.assertAlmostEqual(rows[0]['temperature'],20.75)
    def test_explicit_unavailable_is_not_interpolated(self):
        rows=temperature_history({'sensor.a':[row(0,20),row(4200,'unavailable'),row(5400,21)]},3600,6000,self.config())
        self.assertEqual([p['temperature'] for p in rows],[20,None,None,21,21])
    def test_secondary_sensor_is_used_when_primary_fails(self):
        rows=temperature_history({'sensor.a':[row(0,'unavailable')],'sensor.b':[row(0,22)]},3600,4200,self.config())
        self.assertTrue(all(p['temperature']==22 for p in rows))
    def test_missing_or_wrong_units_and_restored_values_never_become_measurements(self):
        self.assertEqual(temperature_history({},3600,4200,self.config()),[])
        for attrs in ({'unit_of_measurement':'°F'},{'restored':True}):
            rows=temperature_history({'sensor.a':[row(0,20,**attrs)]},3600,4200,self.config())
            self.assertTrue(all(p['temperature'] is None for p in rows))
    def test_bedroom_has_history_without_any_heating_device(self):
        c=self.config(room_id='schlafzimmer',temperature_sensor='sensor.sz_temp',heat_pump='',radiators='')
        rows=temperature_history({'sensor.sz_temp':[row(0,19)]},3600,4200,c)
        self.assertTrue(all(p['temperature']==19 for p in rows))

class RecorderAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_recorder_query_populates_history_without_device_commands(self):
        from test_control import ControlTests, NOW
        from unittest.mock import Mock, patch
        fixture=ControlTests();fixture.setUp();c=fixture.c
        c.hass.async_add_executor_job=object()
        async def execute(fn):return fn()
        recorder=N(async_add_executor_job=execute)
        query=Mock(return_value={c.config['temperature_sensor']:[row((NOW.timestamp()-25*3600),20)]})
        fake=N(get_instance=lambda hass:recorder,history=N(get_significant_states=query))
        import sys,types
        components=types.ModuleType('homeassistant.components');components.recorder=fake
        with patch.dict(sys.modules,{'homeassistant.components':components,'homeassistant.components.recorder':fake}):
            await c.async_load_temperature_history()
            await c.async_load_temperature_history()
        self.assertEqual(query.call_count,1)
        self.assertEqual(c.history_source,'Home Assistant Recorder')
        self.assertTrue(c.history)
        self.assertTrue(all(p['temperature']==20 for p in c.history))
        fixture.service.assert_not_awaited()
