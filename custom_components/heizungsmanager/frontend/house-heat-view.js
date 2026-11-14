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

function yearForecast(status, readingDate){
 const {year,year_kwh:used,year_forecast_kwh:forecast,forecast_low:low,forecast_high:high}=status;
 if(!Number.isInteger(year))return '';
 const available=Number.isFinite(forecast);
 const coverage=status.forecast_coverage||[];
 const full=coverage.filter(day=>day.state==='full').length;
 const scale=Math.max(1,high??used??0)*1.05;
 const percent=value=>100*value/scale;
 const remaining=available?forecast-used:0;
 const basis=status.year_forecast_model_days
  ? `Temperaturmodell für ${status.year_forecast_model_days} Tage · übrige Tage mit Tagesdurchschnitt`
  : available?`Ø ${number(status.forecast_average,1)} kWh/Tag aus ${full} vollen Tagen × ${number(status.forecast_days_left,1)} Resttage${status.forecast_december_days?' · Dezember +10 %':''}`
  : status.january_kwh==null?'Zählerstand vom 1. Januar fehlt':used==null?'Januarstand und aktuellen Zählerstand prüfen':full?'Warte auf aktuelle, vollständige Zählerdaten':'Mindestens ein vollständig erfasster Tag nötig';
 const chip=available?`<span class="heat-chip ${status.forecast_strong?'strong':''}">${status.forecast_strong?'belastbar':'vorläufig'}</span>`:'';
 return `<section class="heat-year" aria-label="Jahresprognose Wärmemenge">
 <header><strong>Wärmemenge ${year}</strong><small>geschätzt</small></header>
 <div class="heat-year-values"><div><small>${Number.isFinite(used)?'Bisher · 1.1. bis heute':readingDate?'Seit Ablesung '+esc(readingDate):'Bisher'}</small><strong>${Number.isFinite(used)?number(used,0)+' kWh':Number.isFinite(status.added_kwh)&&status.configured?number(status.added_kwh,0)+' kWh':'—'}</strong></div>
 <div><small>Prognose 31.12.</small> ${chip}<strong>${available?'≈ '+number(forecast,0)+' kWh':'—'}</strong>${available?`<small>${number(low,0)}–${number(high,0)} kWh · noch ${number(remaining,0)} kWh</small>`:''}</div></div>
 ${Number.isFinite(used)?`<div class="heat-track" aria-hidden="true">
 <i class="heat-used" style="width:${percent(used)}%"></i>
 ${!available||percent(remaining)>=15?`<i class="heat-today" style="left:${percent(used)}%"><span>heute</span></i>`: ''}
 ${available?`<i class="heat-rest" style="left:${percent(used)}%;width:${percent(remaining)}%"></i><i class="heat-range ${status.forecast_strong?'strong':''}" style="left:${percent(low)}%;width:${percent(high-low)}%"></i><i class="heat-end" style="left:${percent(forecast)}%"><span>31.12.</span></i>`:''}</div>
 <div class="heat-axis" aria-hidden="true">${[0,1,2,3].map(tick=>`<span>${number(scale*tick/3,0)}</span>`).join('')}</div>`:''}
 <p>${basis}</p>
 ${available?`<small>Grobe Spanne · ±${status.forecast_strong?20:40} % auf den Restverbrauch</small>`:''}
 <div class="heat-coverage-label"><small>Datenbasis der letzten 14 Tage</small><small>${full} von 14 vollständig${status.forecast_strong?'':' · Modell nach erfolgreichem Rücktest'}</small></div>
 <div class="heat-coverage">${coverage.map(day=>`<i class="${esc(day.state)}" title="${esc(day.date)} · ${{full:'vollständig',partial:'teilweise',missing:'fehlt'}[day.state]}"></i>`).join('')}</div>
 </section>`;
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
 ${comparison?`<small class="meter-message">${comparison}</small>`:''}
 </details>
 ${status.incomplete?`<small class="meter-message meter-warning">${esc(status.note||'Fortschreibung unvollständig · Messdaten fehlen')}</small>`:''}</div>
 <button type="button" class="meter-read">Ablesen</button>
 ${yearForecast(status,date)}
 ${dailyChart(status.daily_usage||[],usageOpen)}</section>`;
}

export const houseHeatCSS=`
.heat-year{grid-column:1/-1;border:1px solid var(--divider-color);border-radius:14px;padding:14px;color:var(--primary-text-color);--heat-orange:#df6439}
.heat-year header,.heat-coverage-label,.heat-axis{display:flex;justify-content:space-between;gap:6px}
.heat-year-values{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}
.heat-year-values strong{display:block;font-size:clamp(18px,3vw,28px)}
.heat-chip{display:inline-block;color:#ffc36e;background:#503215;border-radius:12px;padding:2px 7px}
.heat-chip.strong{color:#8de0ae;background:#204631}
.heat-track{height:14px;margin-top:24px;position:relative;background:var(--divider-color);border-radius:6px}
.heat-track i{display:block;position:absolute;inset-block:0}
.heat-used{background:var(--heat-orange);border-radius:6px 0 0 6px}
.heat-rest{background:repeating-linear-gradient(135deg,#ad5939 0 3px,#5a3829 3px 7px)}
.heat-range{border:1px dashed #bd816d;border-radius:4px;opacity:.65}
.heat-range.strong{opacity:1}
.heat-end{border-inline-start:2px dotted var(--primary-text-color)}
.heat-today span,.heat-end span{position:absolute;bottom:100%;right:0;white-space:nowrap;font-style:normal}
.heat-axis,.heat-year small{color:var(--secondary-text-color)}
.heat-coverage-label{margin-top:10px}
.heat-coverage{display:grid;grid-template-columns:repeat(14,minmax(0,1fr));gap:3px;margin-top:4px}
.heat-coverage i{height:6px;border-radius:2px;background:var(--divider-color)}
.heat-coverage .full,.heat-coverage .partial{background:var(--heat-orange)}
.heat-coverage .partial{opacity:.4}

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
