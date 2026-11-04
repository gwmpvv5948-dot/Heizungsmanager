/* Energy values use one common local day; power is never treated as energy. */
export function energyKwh(state) {
  if(!state || ['unknown','unavailable',''].includes(state.state) || String(state.state).trim()==='')return null;
  const scale={Wh:.001,kWh:1,MWh:1000}[state.attributes?.unit_of_measurement];
  const value=Number(state.state);
  return scale && Number.isFinite(value) && value>=0 ? value*scale : null;
}
export function dayStart(now=new Date(),zone='Europe/Berlin') {
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const parts=date=>Object.fromEntries(formatter.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  const d=parts(now);const wanted=Date.UTC(d.year,d.month-1,d.day);let stamp=wanted;
  for(let i=0;i<3;i++) {
    const p=parts(new Date(stamp));const wall=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    stamp+=wanted-wall;
  }
  return new Date(stamp);
}
const timestamp=point=>typeof point.lu==='number'?point.lu*1000:Date.parse(point.last_updated || point.last_changed);
export function counterToday(points,current,start,now=new Date()) {
  const live=energyKwh(current);
  if(live===null)return {value:null,note:'Energiezähler nicht verfügbar'};
  const readings=(points||[]).map(p=>({time:timestamp(p),value:energyKwh({state:p.s??p.state,attributes:p.a??p.attributes??current.attributes})})).filter(p=>Number.isFinite(p.time)).sort((a,b)=>a.time-b.time);
  const first=readings.filter(p=>p.time<=start.getTime()).at(-1);
  if(!first || first.value===null)return {value:null,note:'Kein gültiger Zählerstand zu Tagesbeginn in der HA-Historie'};
  let previous=first.value,total=0,gap=false;
  for(const point of [...readings.filter(p=>p.time>start.getTime() && p.time<=now.getTime()),{time:now.getTime(),value:live}]) {
    if(point.value===null) {gap=true;continue;}
    total+=point.value>=previous ? point.value-previous : point.value;
    previous=point.value;
  }
  return {value:Math.max(0,total),note:gap?'Historielücke: Verbrauch möglicherweise unvollständig':'Aus kumulativem Zähler seit 00:00; Zählerrücksetzungen berücksichtigt'};
}
export function powerWatts(state) {
  if(!state || ['unknown','unavailable',''].includes(state.state) || String(state.state).trim()==='')return null;
  const scale={W:1,kW:1000}[state.attributes?.unit_of_measurement];
  const value=Number(state.state);
  return scale && Number.isFinite(value) && value>=0 ? value*scale : null;
}
export function consumptionRows(states,config,history=null,now=new Date(),zone='Europe/Berlin') {
  const rows=[];
  if(config.heat_pump && config.pump_daily_energy_sensor) {
    const watts=powerWatts(states[config.power_sensor]);
    rows.push({key:'pump',label:'Midea · Strom',quality:'Gemessen · Stromzähler',entity:config.pump_daily_energy_sensor,value:energyKwh(states[config.pump_daily_energy_sensor]),watts,note:'Heutiger Tageszähler der Midea'});
  }
  if(config.radiators && config.radiator_energy_sensor) {
    const result=config.radiator_energy_period==='daily'?{value:energyKwh(states[config.radiator_energy_sensor]),note:'Heutiger Tageszähler der Heizkörper'}:counterToday(history,states[config.radiator_energy_sensor],dayStart(now,zone),now);
    rows.push({key:'radiators',label:'Heizkörper · Energie',quality:'VTherm-Schätzung',entity:config.radiator_energy_sensor,...result});
  }
  return rows;
}
