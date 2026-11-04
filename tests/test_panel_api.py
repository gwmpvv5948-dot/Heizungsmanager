"""Exercise API handlers with minimal HA connection/registry boundaries."""
import ast
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import Mock, AsyncMock

path=Path(__file__).resolve().parents[1]/'custom_components/heizungsmanager/websocket.py'
tree=ast.parse(path.read_text())
functions=[]
for node in tree.body:
    if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name!='async_register_api':
        node.decorator_list=[]
        functions.append(node)
registry=SimpleNamespace(async_get_entity_id=lambda domain,platform,uid:domain+'.'+uid)
ns={'ROOMS':{'wohnzimmer':'Wohnzimmer','alwin':'Alwin'},'DOMAIN':'heizungsmanager','er':SimpleNamespace(async_get=lambda hass:registry),
    'schema':lambda config:lambda data:data,'validate':lambda config:None,
    'vol':SimpleNamespace(Invalid=ValueError)}
exec(compile(ast.Module(body=functions,type_ignores=[]),str(path),'exec'),ns)

class PanelApiTests(IsolatedAsyncioTestCase):
    def make(self,admin=True):
        connection=SimpleNamespace(user=SimpleNamespace(is_admin=admin),send_error=Mock(),send_result=Mock())
        coordinator=SimpleNamespace(entry=SimpleNamespace(entry_id='wz'),config={},mode='Beobachten')
        hass=SimpleNamespace(data={'heizungsmanager':{'wz':coordinator}},states=SimpleNamespace(get=lambda entity:SimpleNamespace(attributes={'unit_of_measurement':'°C'})),config_entries=SimpleNamespace(async_update_entry=Mock()))
        return hass,connection

    async def test_non_admin_cannot_read_config(self):
        hass,c=self.make(False)
        await ns['get_config'](hass,c,{'id':1,'entry_id':'wz'})
        self.assertEqual(c.send_error.call_args.args[1],'unauthorized')
        c.send_result.assert_not_called()

    async def test_non_admin_cannot_write_config(self):
        hass,c=self.make(False)
        await ns['save_config'](hass,c,{'id':1,'entry_id':'wz','config':{}})
        self.assertEqual(c.send_error.call_args.args[1],'unauthorized')
        hass.config_entries.async_update_entry.assert_not_called()

    async def test_admin_gets_current_entity_ids(self):
        hass,c=self.make()
        await ns['get_config'](hass,c,{'id':1,'entry_id':'wz'})
        c.send_error.assert_not_called()
        result=c.send_result.call_args.args[1]
        self.assertEqual(result['plan_entity'],'sensor.wz_plan')
        self.assertEqual(result['mode_entity'],'select.wz_mode')

    async def test_save_optional_empty_sensor_and_persist(self):
        hass,c=self.make()
        config={'temperature_sensor':'sensor.temp','power_sensor':''}
        await ns['save_config'](hass,c,{'id':1,'entry_id':'wz','config':config})
        c.send_error.assert_not_called()
        hass.config_entries.async_update_entry.assert_called_once()
        self.assertEqual(hass.config_entries.async_update_entry.call_args.kwargs['options']['power_sensor'],'')
        self.assertTrue(c.send_result.call_args.args[1]['saved'])

    async def test_override_denies_non_admin(self):
        hass,c=self.make(False)
        await ns['set_override'](hass,c,{'id':1,'entry_id':'wz','action':'set','temperature':20})
        self.assertEqual(c.send_error.call_args.args[1],'unauthorized')

    async def test_override_requires_temperature(self):
        hass,c=self.make()
        await ns['set_override'](hass,c,{'id':1,'entry_id':'wz','action':'set'})
        self.assertEqual(c.send_error.call_args.args[1],'invalid_override')

    async def test_clear_override_calls_coordinator(self):
        hass,c=self.make()
        coordinator=hass.data['heizungsmanager']['wz']
        coordinator.async_set_override=AsyncMock()
        coordinator.override=None
        await ns['set_override'](hass,c,{'id':1,'entry_id':'wz','action':'clear'})
        coordinator.async_set_override.assert_awaited_once_with(None,'2h')
        self.assertIsNone(c.send_result.call_args.args[1]['override'])

    async def test_save_reports_preserved_automatic_mode(self):
        hass,c=self.make()
        hass.data['heizungsmanager']['wz'].mode='Automatik'
        await ns['save_config'](hass,c,{'id':1,'entry_id':'wz','config':{'temperature_sensor':'sensor.temp'}})
        c.send_error.assert_not_called()
        self.assertEqual(c.send_result.call_args.args[1]['mode'],'Automatik')
