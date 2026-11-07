import test from 'node:test';import assert from 'node:assert/strict';
import {houseHeatView} from '../custom_components/heizungsmanager/frontend/house-heat-view.js';
test('initial view offers a reading without prefilled values',()=>{
 const h=houseHeatView();assert.match(h,/Erste Ablesung erfassen/);assert.doesNotMatch(h,/<form|<input|Startwert speichern|34[.,]759/);
});
test('house meter clearly labels estimate, start and increment',()=>{
 const h=houseHeatView({configured:true,total_kwh:34761,base_kwh:34759,start:1793962800,added_kwh:2,comparison_percent:-3});
 assert.match(h,/34\.761,00 kWh/);assert.match(h,/\+2 kWh/);assert.match(h,/seit Ablesung/);assert.match(h,/Schätzung lag 3 % zu niedrig/);assert.doesNotMatch(h,/<form|<input/);
});
test('incomplete history remains visible',()=>{
 const h=houseHeatView({configured:true,total_kwh:101,base_kwh:100,start:1793962800,added_kwh:1,incomplete:true,note:'Historie teilweise unvollständig'});
 assert.match(h,/Historie teilweise unvollständig/);
});
