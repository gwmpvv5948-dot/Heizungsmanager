from datetime import datetime, timezone
from types import SimpleNamespace as N
import unittest
from test_control import DEFAULTS
from test_heating.house_heat import advance,HouseHeat


def row(t,v,unit='kWh'):
    return N(last_updated=datetime.fromtimestamp(t,timezone.utc),state=str(v),attributes={'unit_of_measurement':unit})

class HouseMeterTests(unittest.TestCase):
    def test_only_increments_after_physical_reading_are_added(self):
        r=advance({},[row(50,100),row(150,102)],row(200,103),100,200,'sensor.e')
        self.assertEqual(r['added'],3);self.assertFalse(r['partial'])
    def test_checkpoint_prevents_double_counting_across_refresh_and_restart(self):
        first=advance({},[row(50,100),row(150,102)],row(200,103),100,200,'sensor.e')
        second=advance(first,[row(150,102),row(220,104)],row(250,105),200,250,'sensor.e')
        self.assertEqual(second['added'],5)
    def test_counter_reset_and_units(self):
        r=advance({},[row(50,1000,'Wh'),row(150,1500,'Wh'),row(180,100,'Wh')],row(200,200,'Wh'),100,200,'sensor.e')
        self.assertAlmostEqual(r['added'],.7)
    def test_missing_baseline_never_adds_lifetime_counter(self):
        r=advance({},[row(150,999)],row(200,1000),100,200,'sensor.e')
        self.assertEqual(r['added'],1);self.assertTrue(r['partial'])
    def test_source_change_retains_old_contribution_without_adding_new_lifetime(self):
        old={'source':'old','last':100,'added':2,'until':200}
        r=advance(old,[row(190,800),row(250,801)],row(300,802),200,300,'new')
        self.assertEqual(r['added'],4)
    def test_unavailable_is_flagged_and_never_turns_into_zero(self):
        r=advance({},[row(50,100),row(150,'unavailable')],row(200,'unavailable'),100,200,'sensor.e')
        self.assertEqual(r['added'],0);self.assertTrue(r['partial'])

class HouseMeterConfigTests(unittest.IsolatedAsyncioTestCase):
    async def test_config_requires_confirmed_nonnegative_base_and_past_timestamp(self):
        meter=HouseHeat(N(data={},states=N(get=lambda _:None)))
        for base,stamp in ((-1,1),(float('nan'),1),(100,float('inf')),(100,9999999999)):
            with self.assertRaises(ValueError):await meter.configure(base,stamp)
    async def test_shared_base_is_saved_and_reconfiguring_starts_new_accounting(self):
        from unittest.mock import AsyncMock
        meter=HouseHeat(N(data={'heizungsmanager':{}},states=N(get=lambda _:None)))
        meter.store.async_save=AsyncMock()
        meter.data={'rooms':{'old':{'added':99}}}
        await meter.configure(34759,100)
        self.assertEqual(meter.data['rooms'],{})
        self.assertEqual(meter.status()['total_kwh'],34759)
        self.assertTrue(meter.status()['incomplete'])
        meter.store.async_save.assert_awaited()

class SeparateHouseSettingsTests(unittest.IsolatedAsyncioTestCase):
    async def test_number_then_datetime_and_reverse_both_preserve_other_setting(self):
        from unittest.mock import AsyncMock
        date=datetime(2020,1,1,tzinfo=timezone.utc)
        for first in ('base','time'):
            meter=HouseHeat(N(data={'heizungsmanager':{}},states=N(get=lambda _:None)))
            meter.store.async_save=AsyncMock()
            if first=='base':
                await meter.set_base(34759)
                self.assertFalse(meter.status()['configured'])
                await meter.set_start(date)
            else:
                await meter.set_start(date)
                self.assertFalse(meter.status()['configured'])
                await meter.set_base(34759)
            self.assertTrue(meter.status()['configured'])
            self.assertEqual(meter.data['base_kwh'],34759)
            self.assertEqual(meter.data['start'],date.timestamp())
