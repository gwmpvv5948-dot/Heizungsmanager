import unittest
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from types import SimpleNamespace as N
from test_model import m,c
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('heating_pv',Path(__file__).resolve().parents[1]/'custom_components/heizungsmanager/pv.py');pv=importlib.util.module_from_spec(spec);spec.loader.exec_module(pv)

class HoldTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime(2026,11,5,12,tzinfo=ZoneInfo('Europe/Berlin'))
        self.c=m.normalize_config(c.DEFAULTS);self.model=m.ThermalModel()
    def plan(self,temp,active=True,**kw):
        return m.make_plan(self.now,temp,5,[],self.c,self.model,pump_state=active,pump_state_since=self.now.timestamp()-3600,**kw)
    def test_hold_does_not_switch_off_at_or_just_above_target(self):
        target=m.phase_at(self.now,self.c)[3]
        for temp in (target,target+.2):
            p=self.plan(temp)[0];self.assertTrue(p['heat_pump']);self.assertEqual(p['control_target'],target)
    def test_no_offset_and_no_forced_heat_when_already_too_warm(self):
        target=m.phase_at(self.now,self.c)[3]
        self.assertFalse(self.plan(target+.6)[0]['heat_pump'])
        self.assertFalse(self.plan(target+.2,active=False)[0]['heat_pump'])
        self.assertTrue(self.plan(target,active=False)[0]['heat_pump'])
    def test_no_pv_or_cloud_cannot_remove_pump_hold_permission(self):
        for signal in (None,{'preferred':False,'valid_until':self.now.timestamp()+300}):
            self.assertTrue(self.plan(21,pv_status=signal)[0]['heat_pump'])
    def test_explicit_source_off_still_stops(self):
        for kind in ('weekday','weekend'):
            for phase,_ in m.PHASES:self.c[f'{kind}_{phase}_sources']='off'
        self.assertFalse(self.plan(18)[0]['heat_pump'])
    def test_pv_prefers_pump_but_allows_radiators_for_larger_deficit(self):
        self.c['weekday_day_sources']='both'
        signal={'preferred':True,'valid_until':self.now.timestamp()+300}
        self.assertFalse(self.plan(20.5,pv_status=signal)[0]['radiators'])
        self.assertTrue(self.plan(19,pv_status=signal)[0]['radiators'])
        self.assertTrue(self.plan(20.5,pv_status=None)[0]['radiators'])
        self.assertFalse(self.plan(20.5,pv_status=signal)[1]['pv_preferred'])
    def test_hold_respects_restart_delay_and_overheat_overrides_minimum_run(self):
        p=m.make_plan(self.now,20,5,[],self.c,self.model,pump_state=False,pump_state_since=self.now.timestamp())[0]
        self.assertFalse(p['heat_pump']);self.assertEqual(p['cycle_protection'],'Mindestpause')
        p=m.make_plan(self.now,22,5,[],self.c,self.model,pump_state=True,pump_state_since=self.now.timestamp())[0]
        self.assertFalse(p['heat_pump']);self.assertIn('Übertemperatur',p['cycle_protection'])

class PVTests(unittest.TestCase):
    def test_confirmation_hysteresis_and_drop_hold(self):
        c={'pv_confirm_minutes':2,'pv_hold_minutes':5,'pv_on_w':1000,'pv_off_w':500}
        t=pv.PVPreference()
        for n in range(0,121,30):r=t.update(n,1500,c)
        self.assertTrue(r['preferred'])
        for n in range(150,331,30):r=t.update(n,0,c)
        self.assertTrue(r['preferred'])
        for n in range(360,631,30):r=t.update(n,0,c)
        self.assertFalse(r['preferred'])
        self.assertFalse(t.update(660,None,c)['preferred'])
    def test_battery_discharge_never_masquerades_as_pv_and_pump_load_added_back(self):
        s=N(now=1000,meter_age=1,grid_export_w=0,battery_charge_w=-700,pv_w=0)
        controller=N(snapshot=s,settings=N(meter_max_age_s=300))
        hass=N(data={'solar_pilot':{'controllers':{'one':controller}}})
        self.assertEqual(pv.strommanager_surplus(hass,1000,700),0)
        s.pv_w=2000;s.battery_charge_w=0;s.grid_export_w=500
        self.assertEqual(pv.strommanager_surplus(hass,1000,700),1200)
        self.assertIsNone(pv.strommanager_surplus(hass,1400,700))
