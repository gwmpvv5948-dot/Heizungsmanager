import {consumptionRows,dayStart} from './consumption.js?v=0.2.9';
import {equipmentStatus,modeLabel,swingLabel} from './equipment.js?v=0.2.9';
/* Local Lovelace card. No CDN, remote fonts or remote scripts. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clock = value => new Date(value).toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'});
const degree = (value, digits=1) => Number.isFinite(value) ? `${value.toLocaleString('de-DE', {maximumFractionDigits:digits})} °C` : '—';

class HeizungsmanagerCard extends HTMLElement {
  constructor() { super(); this.attachShadow({mode:'open'}); }
  setConfig(config) {
    if (!config.entity) throw new Error('Bitte die Fahrplan-Sensorentität unter entity angeben.');
    this.config = config;
    this.render();
  }
  set hass(hass) {
    const old = this._hass?.states[this.config?.entity];
    this._hass = hass;
    const config=hass.states[this.config?.entity]?.attributes?.config || {};
    this.refreshEnergyHistory(config);
    const signature=JSON.stringify([equipmentStatus(hass.states,config),consumptionRows(hass.states,config,this._energyHistory,new Date(),hass.config?.time_zone || 'Europe/Berlin')]);
    if (!this.shadowRoot.activeElement?.matches('select[data-fan-mode],select[data-swing-mode]') && (hass.states[this.config?.entity] !== old || signature!==this._equipmentSignature || !this.shadowRoot.firstChild)) {
      this._equipmentSignature=signature;
      this.render();
    }
  }
  async refreshEnergyHistory(config) {
    if(!config.radiators || !config.radiator_energy_sensor || config.radiator_energy_period==='daily')return;
    const start=dayStart(new Date(),this._hass.config?.time_zone || 'Europe/Berlin').toISOString();
    const key=config.radiator_energy_sensor+start;
    if(this._energyLoading || (key===this._energyKey && Date.now()-(this._energyFetchedAt||0)<60000))return;
    if(key!==this._energyKey)this._energyHistory=null;
    this._energyKey=key;this._energyFetchedAt=Date.now();this._energyLoading=true;this._energyError=null;
    try {
      const result=await this._hass.callWS({type:'history/history_during_period',start_time:start,entity_ids:[config.radiator_energy_sensor],include_start_time_state:true,significant_changes_only:true,minimal_response:false,no_attributes:false});
      this._energyHistory=result[config.radiator_energy_sensor] || [];
    } catch(error) {this._energyHistory=null;this._energyError='HA-Historie für den Tagesverbrauch nicht verfügbar';}
    finally {this._energyLoading=false;if(this.isConnected)this.render();}
  }
  getCardSize() { return 10; }
  static getStubConfig() { return {entity:'sensor.heizungsmanager_wz_fahrplan'}; }
  render() {
    if (!this.config || !this._hass) return;
    const state = this._hass.states[this.config.entity];
    if (!state) { this.shadowRoot.innerHTML = '<ha-card><p style="padding:24px">Fahrplan-Sensor nicht gefunden. Entitäts-ID in der Kartenkonfiguration prüfen.</p></ha-card>'; return; }
    const a = state.attributes, plan = a.plan || [], model = a.model || {}, cfg = a.config || {};
    const energy=consumptionRows(this._hass.states,cfg,this._energyHistory,new Date(),this._hass.config?.time_zone || 'Europe/Berlin');
    const maxEnergy=Math.max(0.001,...energy.map(row=>row.value??0));
    const energyCard=row=>row?`<div class="equipment-energy"><div class="label">Verbrauch heute · seit 00:00</div><article class="energy-tile"><strong>${esc(row.label)}</strong><div class="label">${esc(row.quality)}</div><div class="energy-value">${row.value===null?'—':row.value.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:3})+' kWh'}</div><div class="energy-bar"><span style="width:${row.value===null?0:row.value/maxEnergy*100}%;background:${row.key==='pump'?'#42bfa7':'#f4aa58'}"></span></div><small>${esc(row.key==='radiators' && cfg.radiator_energy_period==='total'?(this._energyLoading?'Tageshistorie wird geladen …':this._energyError || row.note):row.note)}</small></article></div>`:'';
    const equipment=equipmentStatus(this._hass.states,cfg);
    const equipmentCard=device=>`<article class="equipment-tile ${device.available?'':'unavailable'}"><div class="equipment-title">${esc(device.name)}</div><div class="label">${device.kind==='radiator'?'Ventil-Schließgrad · Reglerwert':'Lüftermodus'}</div><div class="equipment-value">${device.kind==='radiator'?(device.valveClosing===null?'—':`${device.valveClosing.toLocaleString('de-DE',{maximumFractionDigits:1})} %`) :`<select class="fan-mode" aria-label="Midea · Lüftermodus" data-fan-mode="${esc(device.fanEntity)}" ${!device.available || !device.fanModes.length || this._equipmentPending?'disabled':''}>${device.fanModes.includes(device.fanValue)?'':`<option value="" disabled selected>${esc(device.fan)}</option>`}${device.fanModes.map(mode=>`<option value="${esc(mode)}" ${mode===device.fanValue?'selected':''}>${esc(modeLabel(mode))}</option>`).join('')}</select>`}</div>${device.kind==='heat_pump'?`<label class="label swing-label" for="midea-swing-mode">Oszillationsart</label><select id="midea-swing-mode" class="fan-mode" aria-label="Midea · Oszillationsart" data-swing-mode="${esc(device.id)}" ${!device.available || !device.swingModes.length || this._equipmentPending?'disabled':''}>${device.swingModes.includes(device.swingValue)?'':`<option value="" disabled selected>${esc(device.swing)}</option>`}${device.swingModes.map(mode=>`<option value="${esc(mode)}" ${mode===device.swingValue?'selected':''}>${esc(swingLabel(mode))}</option>`).join('')}</select><div class="equipment-power"><span>Stromverbrauch aktuell</span><strong>${device.watts===null?'—':device.watts.toLocaleString('de-DE',{maximumFractionDigits:0})+' W'}</strong></div><div class="fan-feedback" role="status">${esc(this._equipmentMessages?.[device.id] || '')}</div>`:''}${device.kind==='radiator'?`<div class="valve-track" role="meter" aria-label="${esc(device.name)} · Ventil-Schließgrad" aria-valuemin="0" aria-valuemax="100" ${device.valveClosing===null?'':`aria-valuenow="${device.valveClosing}"`}><span style="width:${device.valveClosing??0}%"></span></div>`:''}<div class="equipment-mode"><span>Heizmodus</span><strong>${esc(device.mode)}</strong></div><div class="equipment-mode"><span>Aktivität</span><strong>${esc(device.action)}</strong></div><div class="equipment-mode"><span>Regler</span><strong>${esc(device.controllerMode)}</strong></div>${device.target===null?'':`<div class="equipment-mode"><span>Geräte-Soll</span><strong>${degree(device.target)}</strong></div>`}${device.kind==='heat_pump'?`<div class="equipment-mode"><span>Raumziel</span><strong>${degree(a.target)}</strong></div><div class="equipment-mode"><span>Midea-Offset</span><strong>+${degree(cfg.pump_temperature_offset??0.5)}</strong></div>`:''}<small>${device.kind==='radiator'?(device.valveClosing===null?'Ventilwert nicht verfügbar':'Gemeldete Schließvorgabe · keine Positionsmessung'):'Gemeldete Geräte-Modi · Automatikstart: Lüfter Mittel'}</small>${device.kind==='heat_pump'?energyCard(energy.find(row=>row.key==='pump')):''}</article>`;
    const radiators=equipment.filter(device=>device.kind==='radiator'),pumps=equipment.filter(device=>device.kind==='heat_pump');
    const radiatorGroup=radiators.length?`<article class="equipment-tile radiator-group" aria-label="Heizkörper · ${esc(cfg.room_name || 'Raum')}"><div class="equipment-title">Heizkörper · ${esc(cfg.room_name || 'Raum')}</div><div class="radiator-devices">${radiators.map(equipmentCard).join('')}</div>${energyCard(energy.find(row=>row.key==='radiators'))}</article>`:'';
    const equipmentTiles=equipment.length?`<section class="equipment" aria-label="Aktueller Gerätestatus"><h3>Heizungen · aktueller Status</h3><div class="equipment-grid ${radiators.length && pumps.length?'mixed':''}">${radiatorGroup}${pumps.map(equipmentCard).join('')}</div>${energy.length?'<p class="label">Heutige kWh seit 00:00: Midea-Strom gemessen, Heizkörperenergie geschätzt. Nicht addieren; kein direkter Wirkungsgradvergleich.</p>':''}</section>`:'';
    const width = 960, height = 230, left = 40, top = 22, bottom = 185;
    const values = plan.flatMap(p => [p.temperature, p.target]).filter(Number.isFinite);
    const min = Math.floor(Math.min(16, ...values) - 1), max = Math.ceil(Math.max(22, ...values) + 1);
    const x = i => left + (plan.length>1?(new Date(plan[i].time)-new Date(plan[0].time))/(new Date(plan.at(-1).time)-new Date(plan[0].time)):0) * (width - left - 16);
    const y = value => bottom - (value - min) / (max-min) * (bottom-top);
    const path = key => plan.map((p,i) => `${i?'L':'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
    const groups = [];
    plan.slice(0,-1).forEach((p,i) => {
      const selected = ({both:'Midea + Heizkörper',heat_pump:'Midea',radiators:'Heizkörper',off:'Keine Wärmequelle'})[p.sources] || '—';
      const label = `${p.phase} · ${degree(p.target)} · ${selected}`;
      const previous = groups.at(-1);
      if (previous?.label === label) { previous.end = plan[i+1].time; previous.last = i+1; }
      else groups.push({label, start:p.time, end:plan[i+1].time, first:i, last:i+1, reason:`${selected}: Heizen nur bei Temperaturbedarf; Midea-Taktschutz bleibt aktiv.`, radiators:p.sources==='both' || p.sources==='radiators'});
    });
    const ticks = Array.from({length:5},(_,i) => min+(max-min)*i/4);
    const grid = ticks.map(v => `<line x1="${left}" x2="${width-16}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" opacity=".09"/><text x="4" y="${y(v)+4}" fill="currentColor" font-size="11">${v.toFixed(0)}°</text>`).join('');
    const times = plan.filter((_,i)=>i%24===0).map((p,i)=>`<text x="${x(i*24)}" y="220" text-anchor="middle" fill="currentColor" font-size="11">${clock(p.time)}</text>`).join('');
    const bars = groups.map(g=>`<rect x="${x(g.first)}" y="193" width="${Math.max(1,x(g.last)-x(g.first)-1)}" height="9" rx="3" fill="${g.radiators?'#f4aa58':g.label.includes('Wärmequellen aus')?'#65788b':'#42bfa7'}"><title>${esc(g.label)} ${clock(g.start)}–${clock(g.end)}</title></rect>`).join('');
    const banner = a.error ? `<div class="notice error">Steuerungsfehler: ${esc(a.error)}</div>` : '';
    const pause = a.window_open || a.window_unknown || a.manual_until || a.mode === 'Aus';
    const room = a.temperature_info;
    const temperatureDetailsOpen = this.shadowRoot.querySelector('details.temperature-info')?.open ?? false;
    const temperatureDetails = room ? `<details class="temperature-info" ${temperatureDetailsOpen?'open':''}><summary>Temperatursensoren und Berechnung</summary><strong>${esc(room.status)}</strong><div class="sensor-values">${(room.sources||[]).filter(s=>s.entity_id).map((s,i)=>`<div><span class="label">${i===0?'KNX / Primär':'Ikea / Zweiter Sensor'}</span><br><strong>${degree(s.raw)}</strong> ${s.used?`· ${esc(s.effective_weight)} %`:`· ${esc(s.reason || 'Nicht verwendet')}`}<small>${esc(s.entity_id)}${s.offset?` · Korrektur ${degree(s.offset)}`:''}</small></div>`).join('')}</div><div class="label">Gewichtet ${degree(room.weighted,2)} · ${room.smoothing_minutes?`Glättung ${esc(room.smoothing_minutes)} min`:'Ohne Glättung'} · Dieser Raumwert gilt für Planung und Lernen.${room.learning_paused?' Lernen nach Start oder Quellenwechsel kurz pausiert.':''}</div></details>` : '';
    const quickTemperature = this.quickDraft ?? a.override?.temperature ?? a.target ?? cfg.comfort_temperature ?? 21;
    const quickDuration = this.quickDuration ?? '2h';
    const quickControl = a.entry_id ? `<section class="quick"><h3>Wunschtemperatur vorübergehend ändern</h3><p class="label">${a.override?`Temporär <strong>${degree(a.override.temperature)}</strong> bis <strong>${clock(a.override.until_iso)}</strong> · Zeitplan jetzt: ${degree(plan[0]?.scheduled_target)}`:'Der Zeitplan bleibt unverändert. Danach geht es automatisch zurück zum Plan.'}</p><div class="quick-controls"><button data-quick-step="-0.5" aria-label="Wunschtemperatur senken">−</button><label class="sr-only" for="quick-temperature">Temporäre Wunschtemperatur</label><input id="quick-temperature" type="number" min="16" max="24" step="0.5" value="${esc(quickTemperature)}"><span>°C</span><button data-quick-step="0.5" aria-label="Wunschtemperatur erhöhen">+</button><label class="sr-only" for="quick-duration">Dauer der Abweichung</label><select id="quick-duration">${[['1h','1 Stunde'],['2h','2 Stunden'],['schedule','Bis zur nächsten Planzeit']].map(([value,label])=>`<option value="${value}" ${value===quickDuration?'selected':''}>${label}</option>`).join('')}</select><button data-quick-action="set">Übernehmen</button>${a.override?'<button data-quick-action="clear">Zum Zeitplan zurück</button>':''}</div><p class="label">${a.mode==='Beobachten'?'Beobachten: nur Vorschau, keine Heizbefehle.':a.mode==='Aus'?'Betriebsart Aus: keine Temperaturregelung aktiv.':'Die Automatik verwendet diese Wunschtemperatur bis zum Ablauf.'} Bis zur nächsten Planzeit bedeutet Beginn der nächsten der vier Phasen. Die gewählten Wärmequellen der jeweiligen Phase bleiben gültig.</p><div class="quick-message" role="status">${esc(this.quickMessage || '')}</div></section>` : '';
    this.shadowRoot.innerHTML = `
      <style>
      :host{display:block}*{box-sizing:border-box}ha-card{display:block;overflow:hidden;background:var(--ha-card-background,var(--card-background-color,#152330));color:var(--primary-text-color,#e7eef5);border-radius:20px;padding:24px;font-family:var(--paper-font-body1_-_font-family,system-ui)}
      header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}h2{margin:0;font-size:22px;font-weight:650}.eyebrow{font-size:11px;letter-spacing:1.6px;color:var(--secondary-text-color,#a9b8c6);margin-bottom:7px}.badge{font-size:12px;background:#42bfa722;color:#42bfa7;padding:7px 11px;border-radius:20px;white-space:nowrap}
      .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.stat{padding:14px;border:1px solid #8293a326;border-radius:12px}.label{color:var(--secondary-text-color,#a9b8c6);font-size:12px}.value{font-size:25px;margin-top:6px;font-variant-numeric:tabular-nums}
      .consumption{margin:0 0 24px}.consumption h3{margin:0 0 12px}.energy-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.energy-tile{border:1px solid #8293a333;border-radius:12px;padding:15px}.energy-tile strong{font-size:13px}.energy-value{font-size:24px;margin:10px 0}.energy-tile small{display:block;font-size:10px;line-height:1.5;color:var(--secondary-text-color,#a9b8c6);margin-top:8px}.energy-bar{height:7px;border-radius:4px;background:#8293a326;margin-bottom:10px;overflow:hidden}.energy-bar span{display:block;height:100%;border-radius:4px}.equipment{margin:0 0 24px}.equipment h3{margin:0 0 12px}.equipment-grid{display:grid;grid-template-columns:minmax(0,640px);gap:12px}.equipment-grid.mixed{grid-template-columns:minmax(0,2fr) minmax(260px,1fr)}.equipment-tile.radiator-group{max-width:none;display:flex;flex-direction:column}.radiator-devices{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}.radiator-devices .equipment-tile{max-width:none;padding:12px}.equipment-energy{margin-top:16px;border-top:1px solid #8293a326;padding-top:14px}.equipment-energy .energy-tile{border:0;padding:6px 0 0}.radiator-group>.equipment-energy{margin-top:auto}.equipment-tile{max-width:320px;border:1px solid #8293a333;border-radius:12px;padding:15px;min-width:0}.equipment-title{font-size:13px;font-weight:650;margin-bottom:12px;overflow-wrap:anywhere}.equipment-value{font-size:23px;margin:5px 0 10px;font-variant-numeric:tabular-nums}.fan-mode{width:100%;min-height:38px;padding:7px;border:1px solid #8293a344;border-radius:8px;background:var(--primary-background-color,#152330);color:inherit;font:inherit;font-size:15px}.fan-mode:disabled{opacity:.6}.swing-label{display:block;margin:2px 0 7px}.equipment-power{display:flex;justify-content:space-between;gap:10px;align-items:center;border-top:1px solid #8293a326;padding:10px 0;margin:5px 0;font-size:12px}.equipment-power span{color:var(--secondary-text-color,#a9b8c6)}.equipment-power strong{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}.fan-feedback{font-size:11px;line-height:1.5;overflow-wrap:anywhere}.equipment-mode{display:flex;justify-content:space-between;gap:10px;font-size:12px;margin:6px 0}.equipment-mode span,.equipment-tile small{color:var(--secondary-text-color,#a9b8c6)}.equipment-mode strong{font-weight:550;text-align:right}.equipment-tile small{display:block;font-size:10px;line-height:1.5;margin-top:10px}.equipment-tile.unavailable{opacity:.65}.valve-track{height:5px;border-radius:3px;background:#8293a326;margin:0 0 12px;overflow:hidden}.valve-track span{display:block;height:100%;background:#f4aa58;border-radius:3px}.temperature-info{padding:14px 16px;background:#42bfa70c;border:1px solid #42bfa72b;border-radius:12px;margin:-10px 0 20px;font-size:13px;line-height:1.6}.sensor-values{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:9px 0}.sensor-values small{display:block;overflow-wrap:anywhere;color:var(--secondary-text-color,#a9b8c6);font-size:11px}
      .quick{padding:16px;border:1px solid #8293a333;border-radius:12px;margin:0 0 20px}.quick h3{margin:0 0 8px}.quick-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.quick input,.quick select{background:var(--primary-background-color,#152330);color:inherit;border:1px solid #8293a344;border-radius:8px;padding:9px;font:inherit;min-height:38px}.quick input{width:84px}.quick select{max-width:100%}.quick-message{font-size:12px;line-height:1.5}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
      .reason{font-size:14px;line-height:1.5;margin-bottom:18px}.notice{padding:12px;border-radius:10px;background:#f4aa5819;font-size:13px;line-height:1.5;margin:12px 0}.error{background:#e86f6f20}.chart{width:100%;overflow:auto}svg{display:block;width:100%;min-width:520px}.legend{display:flex;gap:18px;font-size:12px;flex-wrap:wrap;color:var(--secondary-text-color,#a9b8c6)}.legend span:before{content:'';display:inline-block;width:16px;height:3px;background:#42bfa7;margin-right:6px;vertical-align:middle}.legend span:nth-child(2):before{background:#f4aa58}.legend span:nth-child(3):before{background:#8999aa}
      h3{font-size:15px;margin:24px 0 12px}.phase{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:13px 0;border-bottom:1px solid #8293a322}.time{font-size:13px;font-variant-numeric:tabular-nums}.phase strong{font-size:13px;font-weight:600}.phase p{font-size:12px;color:var(--secondary-text-color,#a9b8c6);margin:5px 0;line-height:1.5}.dot{display:inline-block;background:#42bfa7;width:7px;height:7px;border-radius:50%;margin-right:7px}.dot.rad{background:#f4aa58}
      details{border-top:1px solid #8293a326;padding-top:14px;margin-top:20px;font-size:13px}summary{cursor:pointer}dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;line-height:1.5}dt{color:var(--secondary-text-color,#a9b8c6)}dd{margin:0}footer{margin-top:16px;color:var(--secondary-text-color,#a9b8c6);font-size:11px;line-height:1.6}.controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}button{background:transparent;color:inherit;border:1px solid #8293a344;border-radius:9px;padding:9px 13px;cursor:pointer}button.active{background:#42bfa722;border-color:#42bfa7}button:disabled{opacity:.5;cursor:wait}
      @media(max-width:720px){.equipment-grid.mixed{grid-template-columns:minmax(0,1fr)}}
      @media(max-width:520px){ha-card{padding:16px}h2{font-size:19px}.stats{gap:6px}.stat{padding:10px}.value{font-size:20px}.phase{grid-template-columns:90px 1fr}.badge{font-size:11px}}
      </style>
      <ha-card><header><div><div class="eyebrow">${esc(cfg.room_name || 'Wohnzimmer')} · LOKALE REGELUNG</div><h2>Heiz-Fahrplan <span style="font-weight:400;opacity:.55">24 h</span></h2></div><span class="badge">${esc(a.mode)}</span></header>
      <div class="stats"><div class="stat"><div class="label">Raumtemperatur</div><div class="value">${degree(a.temperature,2)}</div></div><div class="stat"><div class="label">Ziel jetzt</div><div class="value">${degree(a.target)}</div></div><div class="stat"><div class="label">Draußen</div><div class="value">${degree(a.outdoor)}</div></div></div>
      ${equipmentTiles}
      ${temperatureDetails}
      ${quickControl}
      <div class="reason"><strong>${esc(a.status)}</strong><br>${esc(a.reason)}</div>${banner}
      ${a.mode==='Beobachten'?'<div class="notice">Beobachtungsmodus: Dieser Fahrplan ist ein Vorschlag. Der Manager sendet keine Heizbefehle; bestehende Regelungen laufen weiter.</div>':''}
      ${pause?'<div class="notice">Der Fahrplan zeigt den erwarteten Normalbetrieb nach Ende der aktuellen Pause. Zeitpunkt und Auswirkungen der Pause sind nicht vorhersehbar.</div>':''}
      ${plan.length?`<div class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Prognose für Raum- und Solltemperatur der nächsten 24 Stunden">${grid}<path d="${path('target')}" fill="none" stroke="#8999aa" stroke-width="2" stroke-dasharray="6 5"/><path d="${path('temperature')}" fill="none" stroke="#42bfa7" stroke-width="3"/>${bars}${times}</svg></div><div class="legend"><span>Temperaturprognose</span><span>Heizkörper + Midea</span><span>Solltemperatur</span></div>`:'<div class="notice">Ohne gültige Raumtemperatur kann kein Fahrplan berechnet werden.</div>'}
      <h3>Geplante Heizphasen</h3>${groups.map(g=>`<div class="phase"><div class="time">${clock(g.start)}–${clock(g.end)}</div><div><strong><i class="dot ${g.radiators?'rad':''}"></i>${esc(g.label)}</strong><p>${esc(g.reason)}</p></div></div>`).join('')}
      <details><summary>Lernen, Wetter und Einstellungen</summary><dl>
      <dt>Lernstand</dt><dd>${esc(a.learning_quality)}</dd><dt>Verwendete Lernintervalle</dt><dd>${esc(model.samples || 0)} · Passiv ${esc(model.passive_samples || 0)} / WP ${esc(model.pump_samples || 0)} / Heizkörper ${esc(model.radiator_samples || 0)}</dd>
      <dt>Aktuelle Planphase</dt><dd>${esc(plan[0]?.phase)} · ${degree(plan[0]?.scheduled_target)}</dd><dt>Erlaubte Wärmequellen</dt><dd>${esc(({both:'Midea + Heizkörper',heat_pump:'Midea',radiators:'Heizkörper',off:'Keine Wärmequelle'})[plan[0]?.sources] || '—')}</dd>
      <dt>Wetter</dt><dd>${esc(a.weather_note)}</dd><dt>Wetter im Fahrplan</dt><dd>${esc([...new Set(plan.map(p=>p.weather_source))].join('; '))}</dd><dt>Modell</dt><dd>Wärmeverlust ${Number(model.loss||0).toFixed(3)}/h · WP ${Number(model.pump_gain||0).toFixed(2)} °C/h · Heizkörper ${Number(model.radiator_gain||0).toFixed(2)} °C/h; effektive Schätzwerte</dd></dl>
      <p>Einstellungen unter Geräte & Dienste → Heizungsmanager → Konfigurieren.</p></details>
      ${this.config.mode_entity?`<div class="controls">${['Beobachten','Automatik','Aus'].map(mode=>`<button data-mode="${mode}" class="${a.mode===mode?'active':''}">${mode}</button>`).join('')}</div>`:''}
      <footer>${esc(a.plan_note)}<br>Stand ${a.updated?clock(a.updated):'—'} · Wetterabruf ggf. online; Planung und Lernen lokal. „Aus“ bietet keinen Frostschutz durch diesen Manager.</footer></ha-card>`;
    this.shadowRoot.querySelectorAll('select[data-fan-mode],select[data-swing-mode]').forEach(select=>{
      select.addEventListener('blur',()=>{if(!this._equipmentPending)this.render();});
      select.addEventListener('change',async()=>{
        if(this._equipmentPending) {this.render();return;}
        const kind=select.hasAttribute('data-swing-mode')?'swing':'fan';
        const id=kind==='swing'?select.dataset.swingMode:select.dataset.fanMode,mode=select.value;
        const device=equipmentStatus(this._hass.states,this._hass.states[this.config.entity]?.attributes.config || {}).find(item=>item.id===id && item.kind==='heat_pump');
        if(!device?.available || !device[kind+'Modes'].includes(mode)) {this.render();return;}
        const label=kind==='swing'?'Oszillationsart':'Lüftermodus';
        this._equipmentPending=id;this.shadowRoot.querySelectorAll('select[data-fan-mode],select[data-swing-mode]').forEach(control=>{control.disabled=true;});this._equipmentMessages??={};this._equipmentMessages[id]=label+' wird angefordert …';
        try {
          await this._hass.callService('climate',kind==='swing'?'set_swing_mode':'set_fan_mode',{entity_id:device.id,[kind+'_mode']:mode});
          this._equipmentMessages[id]=label+' angefordert.';
        } catch(error) {this._equipmentMessages[id]=label+' konnte nicht gesetzt werden: '+(error.message || String(error));}
        finally {this._equipmentPending=null;this.render();}
      });
    });
    this.shadowRoot.querySelectorAll('button[data-mode]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try { await this._hass.callService('select','select_option',{entity_id:this.config.mode_entity,option:button.dataset.mode}); }
      catch(error) { button.textContent='Fehler – erneut versuchen'; button.title=String(error); }
      finally { button.disabled=false; }
    }));
    const temperatureInput=this.shadowRoot.querySelector('#quick-temperature');
    if(temperatureInput) {
      temperatureInput.addEventListener('input',()=>{this.quickDraft=Number(temperatureInput.value);});
      this.shadowRoot.querySelector('#quick-duration').addEventListener('change',event=>{this.quickDuration=event.target.value;});
      this.shadowRoot.querySelectorAll('[data-quick-step]').forEach(button=>button.addEventListener('click',()=>{
        this.quickDraft=Math.max(16,Math.min(24,Number(temperatureInput.value)+Number(button.dataset.quickStep)));
        temperatureInput.value=this.quickDraft;
      }));
      this.shadowRoot.querySelectorAll('[data-quick-action]').forEach(button=>button.addEventListener('click',async()=>{
        if(button.dataset.quickAction==='set' && !temperatureInput.reportValidity())return;
        button.disabled=true;
        try {
          await this._hass.callWS({type:'heizungsmanager/override',entry_id:a.entry_id,action:button.dataset.quickAction,temperature:Number(temperatureInput.value),duration:this.shadowRoot.querySelector('#quick-duration').value});
          this.quickMessage=button.dataset.quickAction==='clear'?'Temporäre Abweichung beendet.':'Temporäre Wunschtemperatur gespeichert.';
          this.quickDraft=null;
        } catch(error) {this.quickMessage=error.message || String(error);}
        finally {this.render();}
      }));
    }
  }
}
if (!customElements.get('heizungsmanager-card')) customElements.define('heizungsmanager-card', HeizungsmanagerCard);
window.customCards = window.customCards || [];
window.customCards.push({type:'heizungsmanager-card',name:'Heizungsmanager · 24h',description:'Lokaler Heiz-Fahrplan mit vier Phasen je Raum und Lernstand'});
