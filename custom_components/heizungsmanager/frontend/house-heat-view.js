const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(v,d)=>v.toLocaleString('de-DE',{maximumFractionDigits:d});

function dailyChart(days, open){
 const peak=Math.max(1,...days.map(day=>day.kwh));
 const bars=[...days].reverse().map(day=>{
  const [,month,date]=day.date.split('-');
  const label=day.today?'Heute':`${Number(date)}.${Number(month)}.`;
  const amount=`${number(day.kwh,2)} kWh`;
  const coverage=day.partial?' · teilweise erfasst':'';
  return `<li class="${day.partial?'partial':''}" title="${esc(day.date)} · ${amount}${coverage}">
    <span>${number(day.kwh,2)}</span><i style="height:${day.kwh/peak*100}%"></i>
    <small>${label}${day.partial?'*':''}</small></li>`;
 }).join('');
 return `<details class="meter-usage"${open?' open=""':''}><summary>Wärmeverbrauch pro Tag</summary>
 ${days.length?`<ul class="meter-bars" aria-label="Geschätzter Wärmeverbrauch in kWh pro Tag">${bars}</ul>
 <small>Geschätzt in kWh · * teilweise erfasst</small>`:'<small>Die Tageswerte erscheinen nach der nächsten Fortschreibung.</small>'}</details>`;
}

export function houseHeatView(status={},zone='Europe/Berlin',detailsOpen=false,usageOpen=false){
 const date=status.start?new Date(status.start*1000).toLocaleDateString('de-DE',{timeZone:zone,day:'numeric',month:'numeric'}):'';
 const difference=status.comparison_percent;
 const rounded=Number.isFinite(difference)?Math.round(Math.abs(difference)*10)/10:null;
 const comparison=rounded===null?'':rounded===0?'Schätzung und Ablesung stimmen überein':`Schätzung lag ${number(rounded,1)} % zu ${difference<0?'niedrig':'hoch'}`;
 return `<section class="house-heat-meter" aria-label="Geschätzter Haus-Wärmezähler"><div><small>Wärmezähler Haus · geschätzt</small>
 ${status.configured?`<strong>${status.total_kwh.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})} kWh</strong> <small>· +${number(status.added_kwh,1)} kWh seit Ablesung ${esc(date)}</small>`:'<small>Erste Ablesung erfassen</small>'}
 <details class="meter-details"${detailsOpen?' open=""':''}><summary>Details zum Wärmezähler</summary>
 ${Number.isFinite(status.daily_extra_kwh)?`<small class="meter-message">Gelernter Aufschlag · ${number(status.daily_extra_kwh,2)} kWh/Tag</small>`:'<small class="meter-message">Tagesaufschlag lernt aus Ablesungen mit mindestens 24 h Abstand</small>'}
 ${Number.isFinite(status.year_kwh)?`<small class="meter-message">Wärmemenge ${status.year} · <strong>${number(status.year_kwh,2)} kWh</strong> geschätzt</small>`:status.january_kwh!=null&&status.configured?`<small class="meter-message meter-warning">Januarwert liegt über dem aktuellen Zählerstand</small>`:''}
 ${comparison?`<small class="meter-message">${comparison}</small>`:''}
 </details>
 ${status.incomplete?`<small class="meter-message meter-warning">${esc(status.note||'Fortschreibung unvollständig · Messdaten fehlen')}</small>`:''}</div>
 <button type="button" class="meter-read">Ablesen</button>
 ${dailyChart(status.daily_usage||[],usageOpen)}</section>`;
}

export const houseHeatCSS=`
.house-heat-meter{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;border-top:1px solid var(--divider-color);margin-top:14px;padding-top:10px;font-size:13px}
.house-heat-meter small{color:var(--secondary-text-color);font-size:12px}
.house-heat-meter div>small:first-child,.meter-message{display:block}
.house-heat-meter strong{font-family:ui-monospace,monospace;white-space:nowrap}
.meter-details{margin-top:4px}.meter-details summary{cursor:pointer;color:var(--secondary-text-color);font-size:12px}
.house-heat-meter .meter-warning{color:#d8aa65}
.meter-usage{grid-column:1/-1}
.meter-usage summary{cursor:pointer;color:var(--secondary-text-color);font-size:12px}
.meter-bars{display:flex;gap:8px;overflow-x:auto;list-style:none;padding:6px 0;margin:8px 0;direction:rtl}
.meter-bars li{direction:ltr;flex:0 0 48px;height:110px;display:grid;grid-template-rows:16px minmax(0,1fr) 16px;justify-items:center;align-items:end;font-size:11px}
.meter-bars i{width:70%;background:var(--primary-color);border-radius:3px 3px 0 0}
.meter-bars .partial i{opacity:.5}
.meter-read,.meter-dialog button{color:inherit;background:transparent;border:1px solid var(--divider-color);border-radius:8px;padding:6px 10px;cursor:pointer}
.meter-dialog{color:var(--primary-text-color);background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:12px;padding:20px;max-width:calc(100% - 32px);box-sizing:border-box}
.meter-dialog form,.meter-dialog label{display:grid;gap:8px}
.meter-dialog input{font:inherit;padding:6px;max-width:100%;box-sizing:border-box}
`;
