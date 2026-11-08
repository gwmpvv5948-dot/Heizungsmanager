import {energyKwh,powerWatts,counterToday,dayStart} from './consumption.js?v=0.3.28';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,d=2)=>v.toLocaleString('de-DE',{maximumFractionDigits:d});
const stamp=p=>typeof p.lu==='number'?p.lu*1000:Date.parse(p.last_updated||p.last_changed);
const stateOf=(p,current)=>p?{state:p.s??p.state,attributes:p.a??p.attributes??current?.attributes}:null;
export function radiatorRooms(states,rooms,history,now,zone){
 const used=new Set(),start=dayStart(new Date(now),zone);
 return rooms.filter(r=>r.config?.radiators&&r.config?.radiator_energy_sensor).flatMap(r=>{
  const c=r.config,id=c.radiator_energy_sensor;if(used.has(id))return [];used.add(id);
  const state=states[id],result=c.radiator_energy_period==='daily'?{value:energyKwh(state)}:counterToday(history[id],state,start,new Date(now));
  return [{name:r.name,id,value:state?.attributes?.restored?null:result.value}];
 });
}
export function hourlyElectricity(states,ids,history,now,zone){
 const start=dayStart(new Date(now),zone).getTime(),result=[];
 for(let begin=start;begin<now;begin+=3600000){
  const end=Math.min(now,begin+3600000);let total=0,count=0;
  for(const id of ids){
   const rows=(history[id]||[]).filter(p=>stamp(p)<=end).sort((a,b)=>stamp(a)-stamp(b));
   const current=end===now?states[id]:stateOf(rows.at(-1),states[id]);
   const result=counterToday(rows,current,new Date(begin),new Date(end));
   const value=result.note?.includes('Historielücke')?null:result.value;
   if(value!==null){total+=value;count++;}
  }
  result.push({start:begin,end,value:count===ids.length&&count>0?total:null});
 }
 return result;
}
export const wallHeaterSwitch='switch.wandheitung';
export const wallHeaterPowerId=config=>config.wall_heater_power_sensor??'sensor.wandheizung_power';
function wallHeaterEnergy(states,history,now,zone,config){
 const state=states[wallHeaterSwitch];
 if(!state||!config)return null;
 const start=dayStart(new Date(now),zone).getTime();
 const records=(history[wallHeaterSwitch]||[]).map(p=>({time:stamp(p),state:p.s??p.state}))
   .filter(p=>Number.isFinite(p.time)&&p.time<=now).sort((a,b)=>a.time-b.time);
 const current=state.attributes?.restored?null:state.state;
 const changed=Date.parse(state.last_changed);
 if(Number.isFinite(changed)&&changed<=now)records.push({time:changed,state:current});
 records.sort((a,b)=>a.time-b.time);
 let from=start, previous=null, onTime=0, covered=0;
 for(const record of [...records,{time:now,state:current}]){
  const time=Math.max(start,record.time);
  if(previous==='on')onTime+=time-from;
  if(previous==='on'||previous==='off')covered+=time-from;
  from=time;
  previous=record.state;
 }
 const powerId=wallHeaterPowerId(config);
 const power=states[powerId], energy=states[config.wall_heater_daily_energy_sensor];
 const measuredPower=power?.attributes?.restored?null:powerWatts(power);
 const measuredEnergy=energy?.attributes?.restored?null:energyKwh(energy);
 const powerRecords=(history[powerId]||[]).map(p=>({time:stamp(p),watts:powerWatts(stateOf(p,power))}))
   .filter(p=>Number.isFinite(p.time)&&p.time<=now).sort((a,b)=>a.time-b.time);
 let measuredWh=0, powerCovered=0, lastWatts=null;
 from=start;
 for(const record of [...powerRecords,{time:now,watts:measuredPower}]){
  const time=Math.max(start,record.time);
  if(lastWatts!==null){
   measuredWh+=lastWatts*(time-from)/3600000;
   powerCovered+=time-from;
  }
  from=time;
  lastWatts=record.watts;
 }
 const integrated=powerCovered>0?measuredWh/1000:null;
 return {watts:measuredPower??(current==='on'?400:current==='off'?0:null),
   kwh:measuredEnergy??integrated??(covered>0?onTime/3600000*.4:null),
   estimated:measuredPower===null||(measuredEnergy===null&&integrated===null),partial:measuredEnergy===null&&(integrated===null?covered:powerCovered)<now-start};
}

export function energyOverview(states,rooms,thermal,history={},now=Date.now(),zone='Europe/Berlin',meter=''){
 const sum=(key,read)=>{const ids=[...new Set(rooms.map(r=>r.config?.[key]).filter(Boolean))];const values=ids.map(id=>states[id]?.attributes?.restored?null:read(states[id]));return {ids,total:values.some(v=>v!==null)?values.reduce((s,v)=>s+(v??0),0):null,missing:values.filter(v=>v===null).length};};
 const power=sum('power_sensor',powerWatts),electric=sum('pump_daily_energy_sensor',energyKwh);
 const wall=wallHeaterEnergy(states,history,now,zone,rooms.find(r=>r.roomId==="wohnzimmer")?.config);
 const rows=radiatorRooms(states,rooms,history,now,zone),valid=rows.filter(r=>r.value!==null),missing=rows.length-valid.length;
 const heat=valid.length?valid.reduce((s,r)=>s+r.value,0):null;
 const hours=hourlyElectricity(states,electric.ids,history,now,zone),peak=Math.max(.01,...hours.map(h=>h.value??0));
 const start=dayStart(new Date(now),zone).getTime();
 // Keep the hourly axis on the local calendar day, including DST days.
 let next=start+24*3600000;for(let t=start+20*3600000;t<=start+28*3600000;t+=3600000)if(dayStart(new Date(t),zone).getTime()>start){next=t;break;}
 const bars=hours.filter(h=>h.value!==0).map(h=>`<rect x="${(h.start-start)/(next-start)*320}" y="${54-(h.value??0)/peak*48}" width="${Math.max(1,320*3600000/(next-start)-3)}" height="${h.value===null?2:Math.max(1,h.value/peak*48)}" rx="2" class="${h.value===null?'missing':''}"><title>${esc(new Date(h.start).toLocaleTimeString('de-DE',{timeZone:zone,hour:'2-digit',minute:'2-digit'}))}: ${h.value===null?'keine vollständigen Daten':num(h.value)+' kWh'}</title></rect>`).join('');
 const ranked=valid.filter(r=>r.value>0).sort((a,b)=>b.value-a.value),parts=ranked.length>4?[...ranked.slice(0,3),{name:'Rest',value:ranked.slice(3).reduce((s,r)=>s+r.value,0)}]:ranked;
 const colors=['#d65b31','#ed977b','#f3c2b1','#656565'];
 const outside=rooms.find(r=>Number.isFinite(r.outdoor))?.outdoor,updated=Math.max(0,...rooms.map(r=>Date.parse(r.updated)||0));
 const warning=n=>n?`<small class="energy-missing">${n} ${n===1?'Raum ohne Daten':'Räume ohne Daten'}</small>`:'';
 const combined=(a,b)=>a==null&&b==null?null:(a??0)+(b??0);
 const electricalToday=combined(electric.total,wall?.kwh),electricalNow=combined(power.total,wall?.watts);
 const big=v=>v===null?'<span class="energy-no-data">Tagesdaten fehlen</span>':`<strong>${num(v)} <span>kWh</span></strong>`;
 return `<div class="home-status"><span><ha-icon icon="mdi:thermometer"></ha-icon>Draußen <b>${outside==null?'unbekannt':num(outside,1)+' °C'}</b></span><span><ha-icon icon="mdi:radiator"></ha-icon>Heizt <b>${rooms.filter(r=>r.heating).length} von ${rooms.length} Räumen</b></span>${updated?`<small>Stand ${esc(new Date(updated).toLocaleTimeString('de-DE',{timeZone:zone,hour:'2-digit',minute:'2-digit'}))}</small>`:''}</div><section class="home-energy" aria-label="Energie heute"><div class="energy-column"><h2><ha-icon icon="mdi:flash-outline"></ha-icon>Strom heute</h2><div class="energy-value">${big(electricalToday)}<small>jetzt ${electricalNow===null?'unbekannt':num(electricalNow/1000)+' kW'}</small></div>${warning(electric.missing)}<svg class="energy-hours" viewBox="0 0 320 72" role="img" aria-label="Stromverbrauch pro Stunde heute. Fehlende Stunden werden als fehlend gekennzeichnet."><path d="M0 54H320" stroke="var(--divider-color)"/>${bars}<text x="0" y="71">0</text><text x="80" y="71" text-anchor="middle">6</text><text x="160" y="71" text-anchor="middle">12</text><text x="240" y="71" text-anchor="middle">18</text><text x="320" y="71" text-anchor="end">24</text></svg>${wall?`<small class="energy-missing">Wandheizung · ${wall.watts===null?'unbekannt':num(wall.watts,0)+' W'} jetzt · ${wall.kwh===null?'Tageswert fehlt':num(wall.kwh)+' kWh heute'}${wall.estimated?' · teilweise geschätzt':''}${wall.partial?' · Verlauf unvollständig':''}</small>`: ''}</div><div class="energy-column"><h2><ha-icon icon="mdi:radiator"></ha-icon>Heizwärme heute <span class="estimated" title="VTherm-Schätzung aus konfigurierter Heizleistung und Regelanteil. Keine gemessene Wärmemenge; getrennt vom Stromverbrauch.">≈</span></h2><div class="energy-value">${big(heat)}<small>jetzt ${thermal.watts===null?'unbekannt':num(thermal.watts/1000)+' kW'}</small></div>${warning(missing)}<div class="heat-room-bar" role="img" aria-label="Geschätzte Heizwärme heute nach Räumen">${heat>0?parts.map((r,i)=>`<i style="width:${r.value/heat*100}%;background:${colors[i]}" title="${esc(r.name)}: ${num(r.value)} kWh"></i>`).join(''):''}</div><div class="heat-room-legend">${parts.map((r,i)=>`<span><i style="background:${colors[i]}"></i>${esc(r.name)} ${num(r.value,1)}</span>`).join('')}${heat===0?'<small>Heute noch keine Heizwärme</small>':''}</div>${thermal.powerCount<thermal.powerSources?'<small class="energy-missing">Aktuelle Wärmeleistung unvollständig</small>':''}${meter}</div></section>`;
}
export const energyOverviewCSS=`.home-status{display:flex;align-items:center;gap:24px;flex-wrap:wrap;padding:20px 4px;color:var(--secondary-text-color)}.home-status>span{display:flex;align-items:center;gap:6px}.home-status b{color:var(--primary-text-color);font-weight:550}.home-status>small{margin-left:auto}.home-status ha-icon,.home-energy h2 ha-icon{--mdc-icon-size:20px}.home-energy{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));padding:20px 4px 24px;gap:28px}.energy-column{min-width:0;padding:0 20px}.energy-column+ .energy-column{border-left:1px solid var(--divider-color)}.home-energy h2{display:flex;align-items:center;gap:7px;font-size:17px;font-weight:500;color:var(--secondary-text-color);margin:0 0 12px}.energy-value{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}.energy-value strong{font-size:38px;font-weight:650;letter-spacing:-1px;line-height:1.25}.energy-value strong span{font-size:.75em}.energy-value>small,.energy-no-data,.energy-missing,.heat-room-legend{color:var(--secondary-text-color)}.energy-no-data{font-size:19px}.estimated{font-size:16px;cursor:help}.energy-missing{display:block;font-size:11px;margin:5px 0}.energy-hours{display:block;width:100%;height:85px;margin-top:18px;fill:#777}.energy-hours .missing{opacity:.35}.energy-hours text{font:12px system-ui;fill:var(--secondary-text-color)}.heat-room-bar{display:flex;gap:3px;height:15px;border-radius:7px;overflow:hidden;background:var(--secondary-background-color);margin-top:27px}.heat-room-bar i{height:100%;display:block}.heat-room-legend{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:14px;font-size:13px}.heat-room-legend>span{display:flex;align-items:center;gap:7px}.heat-room-legend i{width:10px;height:10px;border-radius:3px}@media(max-width:650px){.home-status{gap:8px 18px;font-size:13px}.home-energy{grid-template-columns:1fr;gap:24px}.energy-column{padding:0 4px}.energy-column+ .energy-column{border-left:0;border-top:1px solid var(--divider-color);padding-top:20px}.energy-value strong{font-size:32px}.energy-hours{height:70px}.home-status>small{font-size:11px}}`;
