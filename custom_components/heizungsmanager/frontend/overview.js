import {energyOverview,energyOverviewCSS} from './energy-overview.js?v=0.3.18';
import {equipmentStatus} from './equipment.js?v=0.3.18';
import {powerWatts,energyKwh,counterToday,dayStart} from './consumption.js?v=0.3.18';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('de-DE',{maximumFractionDigits:d}):'—';
const ok=s=>s&&!['unknown','unavailable'].includes(s.state)&&!s.attributes?.restored;
const roomIcons={wohnzimmer:'sofa-outline',arbeitszimmer:'desktop-classic',alwin:'human-child',carla:'human-child',schlafzimmer:'bed-outline',flur:'door'};
const roomIcon=r=>roomIcons[String(r.roomId||'').toLowerCase()]||roomIcons[String(r.name||'').toLowerCase()]||'home-outline';
export function roomOverview(states,now=Date.now()){
 return Object.values(states).filter(s=>s.attributes?.entry_id&&s.attributes?.config&&Array.isArray(s.attributes?.plan)).map(s=>{
  const a=s.attributes,c=a.config,devices=equipmentStatus(states,c),age=(now-Date.parse(a.updated))/60000;
  const offline=!ok(s)||Boolean(a.error)||!Number.isFinite(age)||age>2||!Number.isFinite(a.temperature)||devices.some(d=>!d.available)||[c.radiators,c.heat_pump].filter(Boolean).some(id=>!ok(states[id]));
  const roomRadiators=devices.filter(d=>d.kind==='radiator');
  const valve=states[c.radiators]?.attributes?.valve_open_percent;
  const openings=roomRadiators.flatMap(d=>{
    const opening=d.valveClosing===null
      ? (roomRadiators.length===1&&ok(states[c.radiators])?valve:null)
      : 100-d.valveClosing;
    return d.available&&Number.isFinite(opening)&&opening>=0&&opening<=100
      ? [{name:d.name,value:opening}] : [];
  });
  const pumpHeating=devices.some(d=>d.kind==='heat_pump'&&states[d.id]?.attributes?.hvac_action==='heating');
  const heating=devices.some(d=>states[d.id]?.attributes?.hvac_action==='heating')||(ok(states[c.radiators])&&states[c.radiators].state!=='off'&&Number.isFinite(valve)&&valve>0);
  const near=Number.isFinite(a.target)&&Math.abs(a.temperature-a.target)<=.3;
  const eco=[c.radiators,c.heat_pump].some(id=>['eco','away','frost'].includes(states[id]?.attributes?.preset_mode));
  const status=offline?'Offline':a.mode==='Temperaturanzeige'?'Nur Temperatur':a.window_unknown?'Kontakt unklar':a.window_open?'Fenster/Tür offen':heating&&(pumpHeating||!near||!Number.isFinite(valve)||valve>25)?'Heizt':heating&&near?'Hält':eco||a.plan[0]?.phase==='night'?'Absenkung':'Ruht';
  const rank=offline?0:a.window_unknown||a.window_open?1:status==='Heizt'?2:3;
  const next=a.plan.find(p=>Number.isFinite(p.target)&&p.target!==a.target);
  const context=offline?'Gerät oder Raumdaten fehlen / sind veraltet':a.window_open?(a.status?.includes('Tür')||a.status?.includes('Fenster')?a.reason:'Tür/Fenster offen · Schutzregel aktiv'):next?`ab ${new Date(next.time).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} → ${num(next.target)}°`:`${a.mode} · ${a.status||'Kein nächster Zielwechsel'}`;
  return {updated:a.updated,config:c,id:a.entry_id,roomId:c.room_id,name:c.room_name||c.room_id,status,rank,heating:!offline&&heating,temp:offline?null:a.temperature,target:a.target,outdoor:a.outdoor,context,history:a.history||[],hasClimate:devices.some(d=>d.kind==='heat_pump'),radiatorCount:roomRadiators.length,openings,powerId:c.power_sensor,energyId:c.pump_daily_energy_sensor,watts:powerWatts(states[c.power_sensor]),energy:energyKwh(states[c.pump_daily_energy_sensor])};
 }).sort((a,b)=>Math.min(a.rank,2)-Math.min(b.rank,2)||(a.roomId==='wohnzimmer'?0:1)-(b.roomId==='wohnzimmer'?0:1)||a.rank-b.rank||a.name.localeCompare(b.name,'de'));
}
function spark(r,now){
 const start=now-6*3600000,points=r.history.map(p=>({t:p.timestamp*1000,v:p.temperature})).filter(p=>p.t>=start&&p.t<=now),valid=points.filter(p=>Number.isFinite(p.v));
 if(valid.length<2)return '<div class="spark-empty">Noch kein Temperaturverlauf</div>';
 const vals=[...valid.map(p=>p.v),r.target].filter(Number.isFinite),low=Math.min(...vals)-.3,high=Math.max(...vals)+.3,y=v=>65-(v-low)/(high-low)*55;
 let path='',last=null;for(const p of points){if(!Number.isFinite(p.v)){last=null;continue;}path+=`${last&&p.t-last.t<1200000?'L':'M'}${((p.t-start)/(now-start)*320).toFixed(1)},${y(p.v).toFixed(1)} `;last=p;}
 return `<svg viewBox="0 0 320 78" role="img" aria-label="Temperaturverlauf der letzten sechs Stunden; gestrichelt aktuelles Ziel">${Number.isFinite(r.target)?`<path d="M0 ${y(r.target)}H320" class="goal"/>`:''}<path d="${path}" class="trace"/></svg>`;
}
export function radiatorTotals(states,rooms,history={},now=Date.now(),zone='Europe/Berlin'){
 const powers=new Set(),energies=new Set();let watts=0,kwh=0,powerCount=0,energyCount=0;
 const start=dayStart(new Date(now),zone);
 for(const room of rooms){
  const c=room.config||{};if(!c.radiators||!c.radiator_energy_sensor)continue;
  const id=c.radiator_energy_sensor,state=states[id],source=state?.attributes?.source;
  // Integration-helper source is the actual configured VTherm power sensor.
  const powerId=typeof source==='string'?source:null;
  if(!powers.has(powerId||id)){
   powers.add(powerId||id);const value=ok(states[powerId])?powerWatts(states[powerId]):null;
   if(value!==null){watts+=value;powerCount++;}
  }
  if(!energies.has(id)){
   energies.add(id);const value=!ok(state)?null:c.radiator_energy_period==='daily'?energyKwh(state):counterToday(history[id],state,start,new Date(now)).value;
   if(value!==null){kwh+=value;energyCount++;}
  }
 }
 return {watts:powerCount?watts:null,kwh:energyCount?kwh:null,powerCount,energyCount,powerSources:powers.size,energySources:energies.size};
}
function climateGauge(watts){
 if(!Number.isFinite(watts))return '';
 const angle=Math.min(1500,Math.max(0,watts))/1500*180;
 return `<svg class="room-climate-gauge" viewBox="0 0 16 12" aria-hidden="true"><path d="M2 9a6 6 0 0 1 12 0" fill="none" stroke="currentColor" stroke-opacity=".45"/><path d="M8 9H3" transform="rotate(${angle} 8 9)" stroke="currentColor" stroke-linecap="round"/></svg>${num(watts,0)} W`;
}
function valveIndicators(openings){
 return openings.map(({name,value})=>`<span class="valve-opening" title="${esc(name)} · Öffnung laut Regler"><i class="${value>0?"valve-open":""}" aria-hidden="true" style="--opening:${value}%"></i>${num(value)} %</span>`).join('');
}
export function overviewHTML(states,filter='all',now=Date.now(),history={},zone='Europe/Berlin',meter=''){
 const rooms=roomOverview(states,now),shown=rooms.filter(r=>filter==='all'||filter==='heating'&&r.heating||filter==='attention'&&r.rank<2);
 const radiators=radiatorTotals(states,rooms,history,now,zone);
 return `${energyOverview(states,rooms,radiators,history,now,zone,meter)}<nav class="home-filters" aria-label="Räume filtern">${[['all','Alle'],['heating','Heizt'],['attention','Auffällig']].map(([id,label])=>`<button data-home-filter="${id}" aria-pressed="${id===filter}">${label}</button>`).join('')}<small>Sortiert nach Handlungsbedarf</small></nav><div class="home-grid">${shown.map(r=>`<button class="room-tile ${r.rank===0?'offline':r.rank===1?'warning':r.status==='Heizt'?'heating':r.status==='Absenkung'?'eco':''}" data-open-room="${esc(r.id)}"><header><h2><ha-icon class="room-name-icon" icon="mdi:${roomIcon(r)}" aria-hidden="true"></ha-icon>${esc(r.name)}</h2><span class="room-chip"><ha-icon icon="mdi:${r.rank===0?'alert-circle-outline':r.rank===1?'window-open-variant':r.status==='Heizt'?'radiator':'thermometer'}"></ha-icon>${r.status}</span></header><div class="room-temp"><strong>${num(r.temp)}°</strong>${Number.isFinite(r.target)?`<span>Ziel ${num(r.target)}°</span>`:''}<small>${Number.isFinite(r.temp)&&Number.isFinite(r.target)?`${r.temp-r.target>=0?'+':''}${num(r.temp-r.target)}°`:''}</small></div>${spark(r,now)}<p>${esc(r.context)}</p><small class="room-equipment">${r.hasClimate?`<span class="room-climate">Klima${climateGauge(r.watts)}</span>`:''}${r.hasClimate&&r.radiatorCount?' · ':''}${r.radiatorCount?`<span>${r.radiatorCount} Heizkörper</span>`:''}${valveIndicators(r.openings)}</small></button>`).join('')||'<p>Keine Räume für diesen Filter.</p>'}</div>`;
}
export const overviewCSS=energyOverviewCSS+`.home-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;padding:30px 12px}.home-metrics small,.room-tile>small,.home-filters>small{display:block;color:var(--secondary-text-color);font-size:13px}.room-tile>.room-equipment{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.room-climate{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.room-tile .room-climate-gauge{width:16px;height:12px;flex:none}
.valve-opening{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.valve-opening .valve-open{color:#ef8d45}
.valve-opening i{width:1em;height:1em;border:1px solid currentColor;border-radius:50%;box-sizing:border-box;background:conic-gradient(currentColor var(--opening),transparent 0)}
.home-metrics strong{display:block;font-size:25px;margin:4px 0}.home-filters{display:flex;gap:10px;align-items:center;margin:20px 0}.home-filters button,.back-home{border:1px solid var(--divider-color);border-radius:12px;padding:11px 22px;color:inherit;background:transparent;font:inherit;cursor:pointer}.home-filters button[aria-pressed=true]{background:var(--secondary-background-color);border-color:var(--primary-text-color)}.home-filters>small{margin-left:auto}.home-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.room-tile{--tone:var(--secondary-text-color);text-align:left;color:var(--primary-text-color);background:var(--ha-card-background,var(--card-background-color));border:1px solid var(--divider-color);border-radius:20px;padding:20px;cursor:pointer;min-width:0;font:inherit}.room-tile:hover{border-color:var(--primary-color)}.room-tile header{display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}.room-tile h2{margin:0;font-size:18px;display:flex;align-items:center;gap:8px}.room-name-icon{--mdc-icon-size:22px;color:var(--secondary-text-color);flex:none}.room-chip{display:flex;align-items:center;gap:5px;color:var(--tone);background:color-mix(in srgb,var(--tone) 12%,transparent);padding:4px 9px;border-radius:20px;font-size:12px}.room-chip ha-icon{--mdc-icon-size:15px}.room-temp{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:18px 0 10px}.room-temp strong{font-size:38px}.room-temp span{font-size:14px}.room-temp small{color:var(--secondary-text-color)}.room-tile svg{width:100%;height:85px;display:block}.goal{fill:none;stroke:var(--secondary-text-color);stroke-dasharray:4 4;stroke-width:1.5}.trace{fill:none;stroke:var(--tone);stroke-width:3}.room-tile p{font-size:14px;line-height:1.5;margin:12px 0 4px}.room-tile.heating{--tone:#ef8d45}.room-tile.warning{--tone:#e4ac38}.room-tile.offline{--tone:#e67474}.room-tile.offline .room-temp strong{color:var(--secondary-text-color)}.room-tile.eco{--tone:#7eabdc}.spark-empty{height:85px;display:flex;align-items:center;font-size:12px;color:var(--secondary-text-color)}.back-home{margin:16px 0 4px;padding:8px 14px}@media(max-width:1000px){.home-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.home-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.home-grid{grid-template-columns:1fr}.home-metrics{padding:20px 0;gap:16px}.home-metrics strong{font-size:21px}.home-filters{flex-wrap:wrap}.home-filters>small{width:100%;margin:4px 0}.home-filters button{padding:9px 16px}}`;
