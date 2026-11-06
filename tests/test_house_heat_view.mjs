import test from 'node:test';import assert from 'node:assert/strict';
import {houseHeatView} from '../custom_components/heizungsmanager/frontend/house-heat-view.js';
test('no photographed reading is silently assumed before configuration',()=>{
 const h=houseHeatView();assert.match(h,/Ablesewert und Zeitpunkt einrichten/);assert.match(h,/name="base"[^>]*value=""/);assert.doesNotMatch(h,/34[.,]759/);
});
test('house meter clearly labels estimate, start and increment',()=>{
 const h=houseHeatView({configured:true,total_kwh:34761,base_kwh:34759,start:1793962800,added_kwh:2});
 assert.match(h,/≈ 34\.761 kWh/);assert.match(h,/\+2 kWh/);assert.match(h,/Fortgeschrieben seit/);assert.match(h,/ohne Midea oder Warmwasser/);assert.match(h,/Startwert speichern/);
});
test('incomplete history is visible and edits survive refresh',()=>{
 const h=houseHeatView({configured:true,total_kwh:101,base_kwh:100,start:1793962800,added_kwh:1,incomplete:true,note:'Historie teilweise unvollständig'},{base:'200',start:'2026-11-06T21:00'});
 assert.match(h,/Historie teilweise unvollständig/);assert.match(h,/value="200"/);assert.match(h,/value="2026-11-06T21:00"/);
});
