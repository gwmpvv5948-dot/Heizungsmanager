import test from 'node:test';import assert from 'node:assert/strict';
import {hourlyElectricity,radiatorRooms} from '../custom_components/heizungsmanager/frontend/energy-overview.js';
const row=(t,v)=>({last_updated:`2026-11-06T${t}:00:00Z`,state:v,attributes:{unit_of_measurement:'kWh'}});
test('hourly bars use increments of the actual energy meter, not example power data',()=>{
 const states={e:{state:'3',attributes:{unit_of_measurement:'kWh'}}},history={e:[row('00',0),row('01',1),row('02',3)]};
 assert.deepEqual(hourlyElectricity(states,['e'],history,Date.parse('2026-11-06T02:00:00Z'),'UTC').map(p=>p.value),[1,2]);
});
test('missing baseline and explicitly unavailable readings remain gaps',()=>{
 const states={e:{state:'3',attributes:{unit_of_measurement:'kWh'}}};
 assert.equal(hourlyElectricity(states,['e'],{},Date.parse('2026-11-06T01:00:00Z'),'UTC')[0].value,null);
 const history={e:[row('00',0),{...row('00',0),last_updated:'2026-11-06T00:30:00Z',state:'unavailable'},row('01',3)]};
 assert.equal(hourlyElectricity(states,['e'],history,Date.parse('2026-11-06T01:00:00Z'),'UTC')[0].value,null);
});
test('room breakdown uses configured new helper IDs and deduplicates shared counters',()=>{
 const room={name:'Wohnzimmer',config:{radiators:'climate.wz',radiator_energy_sensor:'sensor.wz_vtherm_energie_berechnet',radiator_energy_period:'total'}};
 const id=room.config.radiator_energy_sensor,states={[id]:{state:'12',attributes:{unit_of_measurement:'kWh'}}},history={[id]:[row('00',10)]};
 const rows=radiatorRooms(states,[room,room],history,Date.parse('2026-11-06T02:00:00Z'),'UTC');
 assert.equal(rows.length,1);assert.equal(rows[0].value,2);
});
