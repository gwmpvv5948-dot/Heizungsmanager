const phases=[['morning','Morgens'],['day','Tag'],['evening','Abend'],['night','Nacht']];
const keys=['start','temperature','sources'];
const key=(group,phase,field)=>[group,phase,field].join('_');
const time=value=>/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)?value.slice(0,5):'';
const minutes=value=>value?Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;
const degree=value=>value.toLocaleString('de-DE',{minimumFractionDigits:1})+'°';
const read=(draft,group)=>phases.map(([id,label])=>{
  const start=time(draft[key(group,id,'start')]);
  return {id,label,start,m:minutes(start),t:Number(draft[key(group,id,'temperature')]),source:draft[key(group,id,'sources')]};
});
const invalid=(rows,i)=>!rows[i].start?'Bitte eine Startzeit eingeben.':i&&rows[i].m<=rows[i-1].m?`${rows[i].label} muss nach „${rows[i-1].label}“ beginnen.`:'';
export function phaseError(draft){
  for(const [group,label] of [['weekday','Mo–Fr'],['weekend','Sa–So']]){
    const rows=read(draft,group);
    for(let i=0;i<rows.length;i++){const error=invalid(rows,i);if(error)return label+': '+error;}
  }
  return '';
}
function chart(draft,group){
  const rows=read(draft,group);
  if(rows.some((r,i)=>invalid(rows,i)||!Number.isFinite(r.t)))return '<p>Vorschau nach Korrektur der Phasen.</p>';
  const night=rows[3], segments=[{...night,m:0},...rows];
  const lo=Math.floor(Math.min(...segments.map(r=>r.t)))-1, hi=Math.ceil(Math.max(...segments.map(r=>r.t)))+1;
  const x=m=>52+m/1440*628, y=t=>105-(t-lo)/(hi-lo)*82;
  const labels=segments.map((r,i)=>{
    const end=segments[i+1]?.m??1440;
    if(end-r.m<100)return '';
    return `<text x="${x((r.m+end)/2)}" y="${y(r.t)-7}" text-anchor="middle">${r.label} ${degree(r.t)}</text>`;
  }).join('');
  const pump=Boolean(draft.heat_pump), lanes=pump?[['Midea',135,'heat_pump','#209d76'],['HK',154,'radiators','#da6138']]:[['HK',154,'radiators','#da6138']];
  return `<svg viewBox="0 0 700 190" role="img" aria-label="Zieltemperatur und geplante Wärmequellen über 24 Stunden">
  ${[lo,(lo+hi)/2,hi].map(t=>`<path d="M52 ${y(t)}H680" stroke="currentColor" opacity=".16"/><text x="44" y="${y(t)+4}" text-anchor="end">${t}°</text>`).join('')}
  <path d="M52 ${y(segments[0].t)}${segments.slice(1).map(r=>`H${x(r.m)}V${y(r.t)}`).join('')}H680" fill="none" stroke="currentColor" stroke-width="2"/>
  ${labels}
  ${lanes.map(([label,top,source,color])=>`<text x="44" y="${top+10}" text-anchor="end">${label}</text><rect x="52" y="${top}" width="628" height="12" rx="4" fill="currentColor" opacity=".1"/>${segments.map((r,i)=>r.source===source||r.source==='both'?`<rect x="${x(r.m)}" y="${top}" width="${Math.max(0,x(segments[i+1]?.m??1440)-x(r.m)-1)}" height="12" rx="4" fill="${color}"/>`:'').join('')}`).join('')}
  ${[0,6,12,18,24].map(h=>`<text x="${x(h*60)}" y="183" text-anchor="${h===0?'start':h===24?'end':'middle'}">${h}:00</text>`).join('')}</svg>`;
}
export const phaseCSS=`
.phase-editor header,.phase-editor footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.phase-editor svg{display:block;width:100%;max-height:290px}.phase-editor svg text{fill:currentColor;font-size:13px}
.phase-grid{display:grid;grid-template-columns:minmax(65px,1fr) minmax(105px,1fr) minmax(122px,1fr) minmax(0,3fr);gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--divider-color)}
.phase-editor button[aria-pressed=true]{background:var(--primary-color);color:var(--text-primary-color,#fff)}
.phase-editor button[data-source="heat_pump"][aria-pressed=true]{background:#19795c}.phase-editor button[data-source="radiators"][aria-pressed=true]{background:#a94324}
.phase-editor input[aria-invalid=true]{border:1px solid var(--error-color,#f55)}.phase-editor .phase-error{color:var(--error-color,#f55)}
.phase-editor .phase-controls{display:flex;align-items:center;gap:4px;flex-wrap:wrap}.phase-editor input{min-width:0;width:100%;box-sizing:border-box}
@media(max-width:700px){.phase-grid{grid-template-columns:1fr 1fr auto}.phase-grid .phase-sources{grid-column:1/-1}.phase-grid.phase-head{display:none}.phase-editor button{min-height:38px}}
`;
export function mountPhases(host,draft,saved,notify,initial='weekday'){
  let group=initial;
  const dirty=()=>['weekday','weekend'].some(g=>phases.some(([id])=>keys.some(f=>draft[key(g,id,f)]!==saved[key(g,id,f)])));
  const refresh=()=>{
    const rows=read(draft,group);
    host.querySelector('.phase-preview').innerHTML=chart(draft,group);
    host.querySelectorAll('input').forEach((input,i)=>input.setAttribute('aria-invalid',Boolean(invalid(rows,i))));
    const error=phaseError(draft);
    host.querySelector('.phase-error').textContent=error;
    host.querySelector('[type=submit]').disabled=Boolean(error);
    host.querySelector('.phase-dirty').textContent=dirty()?'Ungespeicherte Phasen':'Keine Änderungen';
  };
  const render=()=>{
    const options=[['heat_pump','Midea',draft.heat_pump],['both','Beide',draft.heat_pump&&draft.radiators],['radiators','Heizkörper',draft.radiators],['off','Aus',true]];
    host.innerHTML=`<style>${phaseCSS}</style><header><div><h2>Heizphasen</h2><p class="intro">Jede Phase gilt bis zur nächsten. Die Nacht läuft über Mitternacht.</p></div><div class="phase-controls">${[['weekday','Mo–Fr'],['weekend','Sa–So']].map(([id,label])=>`<button type="button" data-group="${id}" aria-pressed="${group===id}">${label}</button>`).join('')}${group==='weekend'?'<button type="button" data-copy>Wie Mo–Fr</button>':''}</div></header>
    <div class="phase-preview"></div><div class="phase-grid phase-head"><span>Phase</span><span>Beginn</span><span>Ziel</span><span>Wer heizt?</span></div>
    ${read(draft,group).map(r=>`<div class="phase-grid" data-phase="${r.id}"><strong>${r.label}</strong><input type="time" aria-label="${r.label} · Beginn" value="${r.start}"><div class="phase-controls"><button type="button" data-step="-0.5" aria-label="${r.label} · Ziel senken">−</button><strong>${degree(r.t)}</strong><button type="button" data-step="0.5" aria-label="${r.label} · Ziel erhöhen">+</button></div><div class="phase-controls phase-sources" role="group" aria-label="${r.label} · Wärmequelle">${options.filter(([id,,available])=>available||id===r.source).map(([id,label,available])=>`<button type="button" data-source="${id}" aria-pressed="${id===r.source}" ${available?'':'disabled'}>${label}</button>`).join('')}</div></div>`).join('')}
    <p class="phase-error" role="status"></p><footer><span class="phase-dirty"></span><div class="phase-controls"><button type="button" data-revert>Verwerfen</button><button type="submit">Speichern</button></div></footer><p class="intro">Die Startzeit ist der tatsächliche Beginn. Es wird nicht automatisch vorgeheizt. Die Vorschau zeigt einen typischen Tag der gewählten Gruppe. Beim Wechsel der Tagesgruppe gilt bis morgens noch die Nachtphase des Vortags.</p>`;
    refresh();
  };
  host.oninput=event=>{
    if(event.target.type!=='time')return;
    draft[key(group,event.target.closest('[data-phase]').dataset.phase,'start')]=event.target.value;
    refresh();notify(group);
  };
  host.onclick=event=>{
    const button=event.target.closest('button[type=button]');if(!button)return;
    const d=button.dataset;
    if(d.group){group=d.group;render();notify(group,false);return;}
    if(d.copy!==undefined||d.revert!==undefined){
      for(const g of d.copy!==undefined?['weekend']:['weekday','weekend'])for(const [id] of phases)for(const f of keys)draft[key(g,id,f)]=(d.copy!==undefined?draft:saved)[key(d.copy!==undefined?'weekday':g,id,f)];
    }else{
      const phase=button.closest('[data-phase]').dataset.phase;
      if(d.step){const k=key(group,phase,'temperature');draft[k]=Math.min(24,Math.max(7,Number(draft[k])+Number(d.step)));}
      if(d.source)draft[key(group,phase,'sources')]=d.source;
    }
    notify(group);render();
  };
  render();
}
