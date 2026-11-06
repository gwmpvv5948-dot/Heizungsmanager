import test from 'node:test';import assert from 'node:assert/strict';
import {roomOverview,overviewHTML} from '../custom_components/heizungsmanager/frontend/overview.js';
const now=Date.parse('2026-11-06T08:00:00Z');
const room=(id,changes={})=>({state:'Tag',attributes:{entry_id:id,updated:new Date(now).toISOString(),temperature:20,target:21,config:{room_name:id,radiators:'climate.'+id},plan:[],history:[],...changes}});
test('actual activity wins across devices, open contacts and offline take attention priority',()=>{
 const states={a:room('a'),b:room('b',{window_open:true}),c:room('c'),'climate.a':{state:'heat',attributes:{valve_open_percent:50}},'climate.b':{state:'heat',attributes:{valve_open_percent:0}},'climate.c':{state:'unavailable'}};
 const rows=roomOverview(states,now);assert.deepEqual(rows.map(r=>r.status),['Offline','Fenster/Tür offen','Heizt']);
 const h=overviewHTML(states,'attention',now);assert.doesNotMatch(h,/data-open-room="a"/);assert.match(h,/data-open-room="b"/);
});
test('missing measurements stay unknown; shared electrical sensors are counted once',()=>{
 const c={room_name:'Raum',power_sensor:'sensor.w',pump_daily_energy_sensor:'sensor.e'};
 const states={a:room('a',{config:c}),b:room('b',{config:c}),'sensor.w':{state:'400',attributes:{unit_of_measurement:'W'}},'sensor.e':{state:'2',attributes:{unit_of_measurement:'kWh'}}};
 const h=overviewHTML(states,'all',now);assert.match(h,/0,4 kW/);assert.match(h,/2 <span>kWh/);assert.doesNotMatch(h,/Messquelle|ohne Heizwärme/);assert.match(h,/Strom heute/);assert.match(h,/Noch kein Temperaturverlauf/);
 assert.doesNotMatch(overviewHTML({},'all',now),/NaN|undefined/);
});

test('living room comes first without attention, warnings still precede it',()=>{
 const states={a:room('Arbeitszimmer'),w:room('Wohnzimmer',{config:{room_id:'wohnzimmer',room_name:'Wohnzimmer',radiators:'climate.w'}}),'climate.Arbeitszimmer':{state:'heat',attributes:{valve_open_percent:70}},'climate.w':{state:'off',attributes:{valve_open_percent:0}}};
 assert.equal(roomOverview(states,now)[0].name,'Wohnzimmer');
 states.a.attributes.window_open=true;
 assert.equal(roomOverview(states,now)[0].name,'Arbeitszimmer');
});

test('radiator sums use helper power source and today delta, counting shared meters once',async()=>{
 const {radiatorTotals}=await import('../custom_components/heizungsmanager/frontend/overview.js');
 const c={radiators:'climate.a',radiator_energy_sensor:'sensor.e',radiator_energy_period:'total'};
 const state={state:'12',attributes:{unit_of_measurement:'kWh',source:'sensor.w'}};
 const states={'sensor.e':state,'sensor.w':{state:'0.8',attributes:{unit_of_measurement:'kW'}}};
 const history={'sensor.e':[{state:'10',last_updated:'2026-11-05T23:00:00Z',attributes:state.attributes}]};
 const total=radiatorTotals(states,[{config:c},{config:c}],history,now);
 assert.deepEqual(total,{watts:800,kwh:2,powerCount:1,energyCount:1,powerSources:1,energySources:1});
});
test('missing radiator baseline or unavailable power stays unknown, not zero',async()=>{
 const {radiatorTotals}=await import('../custom_components/heizungsmanager/frontend/overview.js');
 const c={radiators:'climate.a',radiator_energy_sensor:'sensor.e',radiator_energy_period:'total'};
 const result=radiatorTotals({'sensor.e':{state:'12',attributes:{unit_of_measurement:'kWh',source:'sensor.w'}}},[{config:c}],{},now);
 assert.equal(result.kwh,null);assert.equal(result.watts,null);assert.equal(result.energySources,1);
});
test('overview keeps thermal totals separate from electrical totals and filters',()=>{
 const c={room_name:'Raum',radiators:'climate.a',radiator_energy_sensor:'sensor.e',radiator_energy_period:'daily'};
 const states={a:room('a',{config:c}),'sensor.e':{state:'1',attributes:{unit_of_measurement:'kWh',source:'sensor.w'}},'sensor.w':{state:'500',attributes:{unit_of_measurement:'W'}}};
 const h=overviewHTML(states,'attention',now);
 assert.match(h,/Heizwärme heute/);assert.match(h,/0,5 kW/);assert.match(h,/Geschätzte Heizwärme heute nach Räumen/);assert.match(h,/1 <span>kWh/);assert.match(h,/VTherm-Schätzung/);
});
