import test from 'node:test';
import assert from 'node:assert/strict';
import {equipmentStatus} from '../custom_components/heizungsmanager/frontend/equipment.js';
const state=(value,attributes={})=>({state:value,attributes});
const fixtures=()=>({
  'climate.wz_vtherm':state('heat',{vtherm_over_climate:{underlying_entities:['climate.wz1_thermostat_mqtt','climate.wz2_thermostat_mqtt']}}),
  'climate.wz1_thermostat_mqtt':state('heat',{friendly_name:'WZ1',hvac_action:'heating',temperature:21}),
  'climate.wz2_thermostat_mqtt':state('off',{friendly_name:'WZ2',hvac_action:'off',temperature:18}),
  'number.wz1_thermostat_mqtt_valve_closing_degree':state('82'),
  'number.wz2_thermostat_mqtt_valve_closing_degree':state('100'),
  'climate.az_vtherm':state('heat',{vtherm_over_climate:{underlying_entities:['climate.az_thermostat_mqtt']}}),
  'climate.az_thermostat_mqtt':state('heat',{friendly_name:'AZ',hvac_action:'heating',temperature:21}),
  'number.az_thermostat_mqtt_valve_closing_degree':state('51'),
  'climate.wz_midea_ac':state('heat',{fan_mode:'high',vtherm_over_climate:{underlying_entities:['climate.midea']}}),
  'climate.midea':state('heat',{fan_mode:'low',hvac_action:'idle',temperature:21.5})
});
test('living room shows only its two radiators and actual Midea fan',()=>{
  const tiles=equipmentStatus(fixtures(),{radiators:'climate.wz_vtherm',heat_pump:'climate.wz_midea_ac'});
  assert.equal(tiles.length,3);
  assert.deepEqual(tiles.filter(x=>x.kind==='radiator').map(x=>x.valveClosing),[82,100]);
  assert.equal(tiles[2].fan,'Niedrig');
  assert.equal(tiles[2].action,'Bereit');
  assert.equal(tiles[0].action,'Heizt');
  assert.equal(tiles[1].mode,'Aus');
  assert.equal(tiles[1].controllerMode,'Heizen');
});
test('office has its own valve and no Midea or living-room devices',()=>{
  const tiles=equipmentStatus(fixtures(),{radiators:'climate.az_vtherm',heat_pump:''});
  assert.equal(tiles.length,1);
  assert.equal(tiles[0].valveClosing,51);
  assert.equal(tiles[0].valveEntity,'number.az_thermostat_mqtt_valve_closing_degree');
});
test('unavailable/invalid valve values cannot look like zero or full closure',()=>{
  const states=fixtures();
  for(const value of ['unavailable','unknown','nan','',' ', '-1','101']) {
    states['number.az_thermostat_mqtt_valve_closing_degree']=state(value);
    assert.equal(equipmentStatus(states,{radiators:'climate.az_vtherm'})[0].valveClosing,null);
  }
  delete states['number.az_thermostat_mqtt_valve_closing_degree'];
  assert.equal(equipmentStatus(states,{radiators:'climate.az_vtherm'})[0].valveClosing,null);
});
test('unavailable physical Midea does not inherit healthy wrapper mode or fan',()=>{
  const states=fixtures();states['climate.midea']=state('unavailable',{fan_mode:'low'});
  const tile=equipmentStatus(states,{heat_pump:'climate.wz_midea_ac'})[0];
  assert.equal(tile.available,false);assert.equal(tile.mode,'Nicht verfügbar');assert.equal(tile.fan,'Nicht gemeldet');
});
test('missing fan is not presented as auto; updates change the displayed signature',()=>{
  const states=fixtures();delete states['climate.midea'].attributes.fan_mode;delete states['climate.wz_midea_ac'].attributes.fan_mode;
  assert.equal(equipmentStatus(states,{heat_pump:'climate.wz_midea_ac'})[0].fan,'Nicht gemeldet');
  const config={radiators:'climate.az_vtherm'};const before=JSON.stringify(equipmentStatus(states,config));
  states['number.az_thermostat_mqtt_valve_closing_degree']=state('60');
  assert.notEqual(JSON.stringify(equipmentStatus(states,config)),before);
});
test('plain climate entities and duplicate underlying IDs are supported',()=>{
  const states=fixtures();states['climate.az_vtherm'].attributes.vtherm_over_climate.underlying_entities.push('climate.az_thermostat_mqtt');
  assert.equal(equipmentStatus(states,{radiators:'climate.az_vtherm'}).length,1);
  assert.equal(equipmentStatus(states,{radiators:'climate.az_thermostat_mqtt'})[0].valveClosing,51);
  assert.deepEqual(equipmentStatus(states,{}),[]);
});
