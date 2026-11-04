import test from 'node:test';
import assert from 'node:assert/strict';
import {energyKwh,dayStart,counterToday,consumptionRows} from '../custom_components/heizungsmanager/frontend/consumption.js';
const state=(value,unit='kWh')=>({state:String(value),attributes:{unit_of_measurement:unit}});
const point=(stamp,value,unit='kWh')=>({lu:new Date(stamp).getTime()/1000,s:String(value),a:{unit_of_measurement:unit}});
const now=new Date('2026-11-04T09:00:00Z'),start=new Date('2026-11-03T23:00:00Z');
test('power is not energy; finite Wh/kWh/MWh convert consistently',()=>{
 assert.equal(energyKwh(state(750,'Wh')),.75);assert.equal(energyKwh(state(.75)),.75);assert.equal(energyKwh(state(.001,'MWh')),1);
 for(const value of ['',' ','NaN','unknown','unavailable','-1'])assert.equal(energyKwh(state(value)),null);
 assert.equal(energyKwh(state(924,'W')),null);
});
test('HA timezone midnight is independent of browser timezone and follows DST',()=>{
 assert.equal(dayStart(now,'Europe/Berlin').toISOString(),start.toISOString());
 assert.equal(dayStart(new Date('2026-03-29T12:00Z'),'Europe/Berlin').toISOString(),'2026-03-28T23:00:00.000Z');
 assert.equal(dayStart(new Date('2026-10-25T12:00Z'),'Europe/Berlin').toISOString(),'2026-10-24T22:00:00.000Z');
});
test('AZ cumulative total becomes today delta, not lifetime counter',()=>{
 const rows=[point(start,1.8),point('2026-11-04T06:00Z',1.9)];
 assert.ok(Math.abs(counterToday(rows,state(1.983),start,now).value-.183)<1e-9);
});
test('missing or invalid midnight baseline never becomes zero consumption',()=>{
 assert.equal(counterToday([],state(1.983),start,now).value,null);
 assert.equal(counterToday([point('2026-11-04T06:00Z',1.9)],state(1.983),start,now).value,null);
 assert.equal(counterToday([point(start,'unavailable')],state(1.983),start,now).value,null);
});
test('counter reset adds post-reset usage and normalizes historic units',()=>{
 const rows=[point(start,1800,'Wh'),point('2026-11-04T02:00Z',1.9),point('2026-11-04T03:00Z',.05)];
 assert.ok(Math.abs(counterToday(rows,state(.1),start,now).value-.2)<1e-9);
});
test('history gaps are flagged and unavailable live state remains missing',()=>{
 const rows=[point(start,1.8),point('2026-11-04T06:00Z','unavailable')];
 assert.match(counterToday(rows,state(1.9),start,now).note,/unvollständig/);
 assert.equal(counterToday(rows,state('unavailable'),start,now).value,null);
});
test('living room shows separate measured electricity and estimated radiator energy',()=>{
 const cfg={heat_pump:'climate.ac',radiators:'climate.trv',pump_daily_energy_sensor:'sensor.ac_today',power_sensor:'sensor.ac_power',radiator_energy_sensor:'sensor.trv_today',radiator_energy_period:'daily'};
 const rows=consumptionRows({'sensor.ac_today':state(.631),'sensor.ac_power':state(924,'W'),'sensor.trv_today':state(.109)},cfg,null,now);
 assert.equal(rows.length,2);assert.equal(rows[0].value,.631);assert.equal(rows[0].watts,924);assert.match(rows[0].quality,/Gemessen/);assert.equal(rows[1].value,.109);assert.match(rows[1].quality,/Schätzung/);
});
test('office does not inherit Midea electricity and uses its own historical baseline',()=>{
 const rows=consumptionRows({'sensor.az':state(1.983)},{radiators:'climate.az',radiator_energy_sensor:'sensor.az',radiator_energy_period:'total'},[point(start,1.8)],now,'Europe/Berlin');
 assert.equal(rows.length,1);assert.equal(rows[0].key,'radiators');assert.ok(Math.abs(rows[0].value-.183)<1e-9);
});
