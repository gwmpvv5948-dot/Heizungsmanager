import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]/'custom_components/heizungsmanager'
def load(name):
    spec=importlib.util.spec_from_file_location('room_'+name,ROOT/(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
RoomTemperature=load('temperature').RoomTemperature
DEFAULTS=load('const').DEFAULTS

def readings(primary=20,secondary=22):
    return [{'entity_id':'sensor.knx','raw':primary,'reason':None},
            {'entity_id':'sensor.ikea','raw':secondary,'reason':None}]

class TemperatureTests(unittest.TestCase):
    def setUp(self):self.room=RoomTemperature();self.cfg=dict(DEFAULTS)

    def test_weighted_value_and_corrections(self):
        value=self.room.update(1000,readings(),self.cfg)
        self.assertEqual(value['value'],20.5)
        self.cfg['primary_temperature_offset']=.4
        self.cfg['secondary_temperature_offset']=-.2
        value=self.room.update(1030,readings(),self.cfg)
        self.assertAlmostEqual(value['weighted'],20.75)
        self.assertTrue(value['source_changed'])

    def test_both_fallback_directions(self):
        for primary,secondary,expected,index in [(None,22,22,1),(20,None,20,0)]:
            value=self.room.update(1000,readings(primary,secondary),self.cfg)
            self.assertEqual(value['value'],expected)
            self.assertEqual(value['sources'][index]['effective_weight'],100)
            self.assertIn('Ersatzbetrieb',value['status'])

    def test_no_sources_does_not_reuse_old_temperature(self):
        self.room.update(1000,readings(),self.cfg)
        result=self.room.update(1030,readings(None,None),self.cfg)
        self.assertIsNone(result['value'])
        self.assertIsNone(self.room.value)

    def test_one_degree_step_is_weighted_and_smoothed(self):
        first=self.room.update(1000,readings(20,21),self.cfg)
        next_value=self.room.update(1030,readings(20,22),self.cfg)
        self.assertEqual(next_value['weighted']-first['weighted'],.25)
        self.assertGreater(next_value['value'],20.25)
        self.assertLess(next_value['value'],20.5)

    def test_smoothing_independent_of_tick_frequency(self):
        a,b=RoomTemperature(),RoomTemperature()
        for room in (a,b):room.update(1000,readings(20,21),self.cfg)
        for tick in range(1030,1181,30):x=a.update(tick,readings(20,22),self.cfg)
        y=b.update(1180,readings(20,22),self.cfg)
        self.assertEqual(x['value'],y['value'])

    def test_source_change_resets_filter_and_pauses_learning(self):
        self.room.update(1000,readings(),self.cfg)
        self.assertFalse(self.room.update(1700,readings(),self.cfg)['learning_paused'])
        changed=self.room.update(1730,readings(20,None),self.cfg)
        self.assertEqual(changed['value'],20)
        self.assertTrue(changed['source_changed'])
        self.assertTrue(changed['learning_paused'])
        self.assertTrue(self.room.update(2300,readings(20,None),self.cfg)['learning_paused'])
        self.assertFalse(self.room.update(2331,readings(20,None),self.cfg)['learning_paused'])

    def test_filter_can_be_disabled(self):
        self.cfg['temperature_smoothing_minutes']=0
        self.room.update(1000,readings(20,21),self.cfg)
        self.assertEqual(self.room.update(1030,readings(20,22),self.cfg)['value'],20.5)
