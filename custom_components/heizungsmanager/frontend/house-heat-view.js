const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>v.toLocaleString('de-DE',{maximumFractionDigits:3});
const localInput=t=>{if(!Number.isFinite(t))return '';const d=new Date(t*1000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export function houseHeatView(status={},draft=null,zone='Europe/Berlin'){
 const base=draft?.base??status.base_kwh??'',start=draft?.start??localInput(status.start);
 return `<section class="house-heat-meter" aria-label="Geschätzter Haus-Wärmezähler"><div><span>Haus-Wärmezähler <span title="Echter Ablesewert plus berechnete Heizkörperenergie seit diesem Zeitpunkt. Kein gemessener aktueller Zählerstand.">≈</span></span>${status.configured?`<strong>≈ ${number(status.total_kwh)} kWh</strong><small>Fortgeschrieben seit ${esc(new Date(status.start*1000).toLocaleString('de-DE',{timeZone:zone}))} · +${number(status.added_kwh)} kWh</small>`:'<small>Ablesewert und Zeitpunkt einrichten</small>'}${status.incomplete?`<small class="meter-warning">${esc(status.note||'Fortschreibung unvollständig · Messdaten fehlen')}</small>`:''}</div><details class="house-heat-settings"><summary>Startwert konfigurieren</summary><form id="house-heat-form"><label>Abgelesener Zählerstand · kWh<input name="base" type="number" min="0" max="1000000000" step="0.001" value="${esc(base)}" required></label><label>Abgelesen am<input name="start" type="datetime-local" value="${esc(start)}" max="${localInput(Date.now()/1000)}" required></label><small>Bei MWh den Wert × 1.000 eingeben. Eine Änderung berechnet die Fortschreibung ab dem neuen Ablesezeitpunkt neu. Nur erfasste Heizkörper, ohne Midea oder Warmwasser. Geschätzte Heizwärme; fehlende Historie bleibt gekennzeichnet.</small><button type="submit">Startwert speichern</button><span class="meter-feedback" role="status"></span></form></details></section>`;
}
export function bindHouseHeat(panel){
 const form=panel.shadowRoot.querySelector('#house-heat-form');if(!form)return;
 const read=()=>({base:form.elements.namedItem('base').value,start:form.elements.namedItem('start').value});
 form.oninput=()=>{panel._houseHeatDraft=read();};
 form.onsubmit=async event=>{
  event.preventDefault();if(!form.reportValidity()||panel._houseHeatSaving)return;
  panel._houseHeatSaving=true;const button=form.querySelector('button'),feedback=form.querySelector('.meter-feedback');button.disabled=true;
  const data=read();
  try{panel._houseHeat=await panel._hass.callWS({type:'heizungsmanager/configure_house_heat',base_kwh:Number(data.base),start:new Date(data.start).getTime()/1000});panel._houseHeatDraft=null;feedback.textContent='Startwert gespeichert.';}
  catch(error){feedback.textContent='Nicht gespeichert: '+(error.message||String(error));}
  finally{panel._houseHeatSaving=false;button.disabled=false;panel.updateOverview();}
 };
}
export const houseHeatCSS=`.house-heat-meter{border-top:1px solid var(--divider-color);padding:16px 8px;display:flex;align-items:start;gap:20px;justify-content:space-between}.house-heat-meter>div>span{color:var(--secondary-text-color);font-size:14px}.house-heat-meter strong{display:block;font-size:23px;margin:5px 0}.house-heat-meter small{display:block;color:var(--secondary-text-color);font-size:11px;line-height:1.5}.house-heat-settings{font-size:12px;max-width:440px}.house-heat-settings summary{cursor:pointer;color:var(--secondary-text-color)}.house-heat-settings form{display:grid;gap:10px;padding-top:12px}.house-heat-settings label{display:grid;gap:4px}.house-heat-settings input{padding:8px;min-width:0;border:1px solid var(--divider-color);border-radius:7px;background:var(--secondary-background-color);color:inherit;font:inherit}.house-heat-settings button{padding:8px;border:1px solid var(--divider-color);border-radius:7px;background:transparent;color:inherit;cursor:pointer}.house-heat-meter .meter-warning{color:#d8aa65}@media(max-width:650px){.house-heat-meter{flex-direction:column;gap:10px}.house-heat-settings{width:100%}}`;
