const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(v,d)=>v.toLocaleString('de-DE',{maximumFractionDigits:d});

export function houseHeatView(status={},zone='Europe/Berlin'){
 const date=status.start?new Date(status.start*1000).toLocaleDateString('de-DE',{timeZone:zone,day:'numeric',month:'numeric'}):'';
 const difference=status.comparison_percent;
 const rounded=Number.isFinite(difference)?Math.round(Math.abs(difference)*10)/10:null;
 const comparison=rounded===null?'':rounded===0?'Schätzung und Ablesung stimmen überein':`Schätzung lag ${number(rounded,1)} % zu ${difference<0?'niedrig':'hoch'}`;
 return `<section class="house-heat-meter" aria-label="Geschätzter Haus-Wärmezähler"><div><small>Wärmezähler Haus · geschätzt</small>
 ${status.configured?`<strong>${number(status.total_kwh,0)} kWh</strong> <small>· +${number(status.added_kwh,1)} kWh seit Ablesung ${esc(date)}</small>`:'<small>Erste Ablesung erfassen</small>'}
 ${comparison?`<small class="meter-message">${comparison}</small>`:''}
 ${status.incomplete?`<small class="meter-message meter-warning">${esc(status.note||'Fortschreibung unvollständig · Messdaten fehlen')}</small>`:''}</div>
 <button type="button" class="meter-read">Ablesen</button></section>`;
}

export const houseHeatCSS=`
.house-heat-meter{display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid var(--divider-color);margin-top:14px;padding-top:10px;font-size:13px}
.house-heat-meter small{color:var(--secondary-text-color);font-size:12px}
.house-heat-meter div>small:first-child,.meter-message{display:block}
.house-heat-meter strong{font-family:ui-monospace,monospace;white-space:nowrap}
.house-heat-meter .meter-warning{color:#d8aa65}
.meter-read,.meter-dialog button{color:inherit;background:transparent;border:1px solid var(--divider-color);border-radius:8px;padding:6px 10px;cursor:pointer}
.meter-dialog{color:var(--primary-text-color);background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:12px;padding:20px;max-width:calc(100% - 32px);box-sizing:border-box}
.meter-dialog form,.meter-dialog label{display:grid;gap:8px}
.meter-dialog input{font:inherit;padding:6px;max-width:100%;box-sizing:border-box}
`;
