import test from 'node:test';import assert from 'node:assert/strict';
import {houseHeatView} from '../custom_components/heizungsmanager/frontend/house-heat-view.js';
test('no photographed reading or dashboard configuration is silently provided',()=>{
 const h=houseHeatView();assert.match(h,/über die Heizungsmanager-Entitäten/);assert.doesNotMatch(h,/<form|<input|Startwert speichern|34[.,]759/);
});
test('house meter clearly labels estimate, start and increment',()=>{
 const h=houseHeatView({configured:true,total_kwh:34761,base_kwh:34759,start:1793962800,added_kwh:2});
 assert.match(h,/≈ 34\.761 kWh/);assert.match(h,/\+2 kWh/);assert.match(h,/Fortgeschrieben seit/);assert.doesNotMatch(h,/<form|<input/);
});
test('incomplete history remains visible',()=>{
 const h=houseHeatView({configured:true,total_kwh:101,base_kwh:100,start:1793962800,added_kwh:1,incomplete:true,note:'Historie teilweise unvollständig'});
 assert.match(h,/Historie teilweise unvollständig/);
});
