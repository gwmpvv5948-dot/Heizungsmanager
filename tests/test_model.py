import importlib.util
import math
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import sys

ROOT = Path(__file__).resolve().parents[1] / 'custom_components' / 'heizungsmanager'
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
m = load('heating_model', 'model.py')
c = load('heating_const', 'const.py')
TZ = ZoneInfo('Europe/Berlin')

class ModelTests(unittest.TestCase):
    def setUp(self):
        self.cfg = dict(c.DEFAULTS)
        self.model = m.ThermalModel()

    def test_weekday_weekend_and_all_four_phases(self):
        cfg=m.normalize_config(self.cfg)
        for day,kind in [('2026-11-04','weekday'),('2026-11-07','weekend')]:
            for key,label in m.PHASES:
                now=datetime.fromisoformat(day+'T'+cfg[f'{kind}_{key}_start']).replace(tzinfo=TZ)
                _,phase_key,phase,target,sources=m.phase_at(now,cfg)
                self.assertEqual(phase_key,key);self.assertEqual(phase,label)
                self.assertEqual(target,cfg[f'{kind}_{key}_temperature'])

    def test_no_hidden_preheating_before_morning(self):
        now=datetime(2026,11,4,6,19,tzinfo=TZ)
        self.assertEqual(m.phase_at(now,self.cfg)[1],'night')
        self.assertEqual(m.phase_at(now+timedelta(minutes=1),self.cfg)[1],'morning')

    def test_friday_night_target_continues_into_saturday(self):
        cfg=m.normalize_config(self.cfg)
        cfg['weekday_night_temperature']=17
        cfg['weekend_night_temperature']=19
        self.assertEqual(m.phase_at(datetime(2026,11,7,2,tzinfo=TZ),cfg)[3],17)
        self.assertEqual(m.phase_at(datetime(2026,11,7,23,tzinfo=TZ),cfg)[3],19)
        self.assertEqual(m.phase_at(datetime(2026,11,9,2,tzinfo=TZ),cfg)[3],19)

    def test_phase_targets_and_sources_are_independent(self):
        cfg=m.normalize_config(self.cfg)
        now=datetime(2026,11,4,12,tzinfo=TZ)
        cfg['weekday_day_temperature']=22
        for sources,pump,rad in [('both',True,True),('heat_pump',True,False),('radiators',False,True),('off',False,False)]:
            cfg['weekday_day_sources']=sources
            row=m.make_plan(now,19,5,[],cfg,self.model)[0]
            self.assertEqual((row['target'],row['heat_pump'],row['radiators']),(22,pump,rad))

    def test_exact_phase_and_override_boundaries_in_forecast(self):
        now=datetime(2026,11,4,6,13,tzinfo=TZ)
        plan=m.make_plan(now,19,5,[],self.cfg,self.model,override={'temperature':20,'until':now.timestamp()+123})
        stamps={datetime.fromisoformat(p['time']).timestamp() for p in plan}
        self.assertIn(now.timestamp()+123,stamps)
        self.assertIn(now.replace(minute=20).timestamp(),stamps)

    def test_migration_keeps_existing_times_and_temperatures(self):
        raw={**self.cfg,'weekday_start':'06:35:00','weekend_start':'09:00:00','night_start':'21:00:00','comfort_temperature':20.5,'night_temperature':18}
        cfg=m.normalize_config(raw)
        self.assertEqual(cfg['weekday_morning_start'],'06:35:00')
        self.assertEqual(cfg['weekend_morning_start'],'09:00:00')
        self.assertEqual(cfg['weekday_night_start'],'21:00:00')
        self.assertEqual(cfg['weekday_day_temperature'],20.5)
        self.assertEqual(cfg['weekday_evening_start'],'17:00:00')
        cfg['weekday_day_temperature']=19
        self.assertEqual(m.normalize_config(cfg)['weekday_day_temperature'],19)
        self.assertNotIn('weekday_day_temperature',raw)

    def test_plan_is_24_hours_across_dst(self):
        for day in [(2026,3,28),(2026,10,24),(2026,11,3)]:
            now = datetime(*day,12,tzinfo=TZ)
            plan = m.make_plan(now,20,5,[],self.cfg,self.model)
            self.assertGreaterEqual(len(plan),145)
            self.assertEqual(datetime.fromisoformat(plan[-1]['time']).timestamp()-now.timestamp(),86400)
            self.assertTrue(all(math.isfinite(p['temperature']) for p in plan))

    def test_missing_weather_is_explicit(self):
        now = datetime(2026,11,4,12,tzinfo=TZ)
        plan = m.make_plan(now,20,None,[],self.cfg,self.model)
        self.assertIn('Annahme',plan[0]['weather_source'])
        plan = m.make_plan(now,20,7,[(now.timestamp(),3)],self.cfg,self.model)
        self.assertEqual(plan[0]['outdoor'],3)
        self.assertEqual(plan[-1]['outdoor'],7)

    def test_learning_rejects_disturbance_and_mixed_heat(self):
        self.assertFalse(self.model.learn(20,24,5,1/12,1,0))
        self.assertFalse(self.model.learn(20,20.1,102,1/12,1,0))
        self.assertFalse(self.model.learn(20,20.1,5,1/12,1,1))
        self.assertEqual(self.model.samples,0)

    def test_passive_and_separate_source_learning(self):
        self.assertTrue(self.model.learn(20,19.95,5,1/12,0,0))
        self.assertTrue(self.model.learn(20,20.15,5,1/12,1,0))
        self.assertTrue(self.model.learn(20,20.12,5,1/12,0,1))
        self.assertEqual(self.model.samples,3)
        self.assertEqual(self.model.passive_samples,1)
        self.assertEqual(self.model.pump_samples,1)
        self.assertEqual(self.model.radiator_samples,1)

    def test_night_threshold_hysteresis(self):
        self.assertFalse(m.night_reheat(18,18,False,.3))
        self.assertTrue(m.night_reheat(17.9,18,False,.3))
        self.assertTrue(m.night_reheat(18.1,18,True,.3))
        self.assertFalse(m.night_reheat(18.3,18,True,.3))

    def test_override_expires_in_plan_without_changing_schedule(self):
        now=datetime(2026,11,4,12,tzinfo=TZ)
        override={'temperature':20,'until':now.timestamp()+7200}
        plan=m.make_plan(now,21,5,[],self.cfg,self.model,override=override)
        self.assertEqual(plan[0]['target'],20)
        self.assertEqual(plan[0]['scheduled_target'],21)
        self.assertFalse(plan[0]['heat_pump'])
        self.assertEqual(plan[12]['target'],21)
        self.assertFalse(plan[12]['override_active'])

    def test_next_schedule_boundary(self):
        now=datetime(2026,11,4,21,tzinfo=TZ)
        end=datetime.fromtimestamp(m.next_schedule_time(now,self.cfg),TZ)
        self.assertEqual((end.hour,end.minute),(22,0))
        now=datetime(2026,11,6,23,tzinfo=TZ)
        end=datetime.fromtimestamp(m.next_schedule_time(now,self.cfg),TZ)
        self.assertEqual((end.weekday(),end.hour,end.minute),(5,8,0))

    def test_night_plan_shows_passive_cooling_then_reheat(self):
        now = datetime(2026,11,4,23,tzinfo=TZ)
        plan=m.make_plan(now,18.1,5,[],self.cfg,self.model)
        self.assertFalse(plan[0]['heat_pump'])
        self.assertEqual(plan[0]['pump_demand_estimate'],0)
        self.assertLess(plan[1]['temperature'],18.1)
        active=[p for p in plan if p['phase']=='Nacht' and p['heat_pump']]
        self.assertTrue(active)
        self.assertIn('Nachheizen',active[0]['reason'])

    def test_untrusted_numbers_and_saved_model(self):
        for value in ['nan','inf',None,{},102.5]:
            self.assertIsNone(m.finite(value,-30,45))
        restored = m.ThermalModel.restore({'loss':float('nan'),'pump_gain':-10,'samples':-1})
        self.assertEqual(restored.loss,0.025)
        self.assertEqual(restored.pump_gain,1.4)
        self.assertEqual(restored.samples,0)

if __name__ == '__main__':
    unittest.main()
