import test from 'node:test';
import assert from 'node:assert/strict';
test('monochrome brand registers both HA icon APIs without embedding colour or a remote image',async()=>{
 globalThis.window={};await import('../custom_components/heizungsmanager/frontend/sidebar-icon.js');
 const icon=await window.customIcons.heizungsmanager.getIcon('heating');
 assert.equal(icon.viewBox,'0 0 32 32');assert.ok(icon.path.length>100);
 assert.equal(await window.customIconsets.heizungsmanager('other'),undefined);
 assert.doesNotMatch(icon.path,/#|https:/);
});
