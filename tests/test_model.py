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

    def test_weekday_weekend_and_night(self):
        for date, clock in [('2026-11-04', '06:20'), ('2026-11-07', '08:00')]:
            now = datetime.fromisoformat(date+'T'+clock).replace(tzinfo=TZ)
            start, end = m.day_schedule(now, self.cfg)
            self.assertEqual(start, now)
            target, phase, support, reason = m.decision(now, 19, 5, self.cfg, self.model)
            self.assertTrue(support)
            self.assertEqual(target, 21)
            self.assertFalse(m.decision(now+timedelta(hours=1),19,5,self.cfg,self.model)[2])
            self.assertEqual(m.decision(end,21,5,self.cfg,self.model)[0],18)

    def test_preheats_before_arrival_and_handover(self):
        now = datetime(2026,11,4,6,0,tzinfo=TZ)
        self.assertTrue(m.decision(now,19,5,self.cfg,self.model)[2])
        now = now.replace(hour=6,minute=25)
        self.assertFalse(m.decision(now,21,5,self.cfg,self.model)[2])

    def test_plan_is_24_hours_across_dst(self):
        for day in [(2026,3,28),(2026,10,24),(2026,11,3)]:
            now = datetime(*day,12,tzinfo=TZ)
            plan = m.make_plan(now,20,5,[],self.cfg,self.model)
            self.assertEqual(len(plan),145)
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
