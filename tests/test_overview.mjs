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
 const h=overviewHTML(states,'all',now);assert.match(h,/0,4 kW/);assert.match(h,/2 kWh/);assert.match(h,/1 Messquelle/);assert.match(h,/ohne Heizwärme/);assert.match(h,/Noch kein Temperaturverlauf/);
 assert.doesNotMatch(overviewHTML({},'all',now),/NaN|undefined/);
});
