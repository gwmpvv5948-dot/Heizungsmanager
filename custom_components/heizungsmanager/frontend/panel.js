import './heizungsmanager-card.js?v=0.1.6';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SETTINGS = [
  {title:'Geräte und Messwerte', description:'Die vorhandenen VTherm-Regler übernehmen weiterhin die Geräteansteuerung.', fields:[
    {key:'window_sensor',label:'Terrassentürkontakt',domain:'binary_sensor',hint:'on = Tür offen, off = Tür geschlossen.'},
    {key:'heat_pump',label:'Midea / Wärmepumpen-Regler',domain:'climate',hint:'Der vorhandene WZ-Midea-Regler, nicht zusätzlich das darunterliegende Gerät.'},
    {key:'radiators',label:'Gemeinsamer Heizkörper-Regler',domain:'climate',hint:'WZ VTherm steuert weiterhin WZ1 und WZ2.'},
    {key:'weather',label:'Wetterentität für Dresden',domain:'weather',hint:'Der Standort wird in der Wetterintegration festgelegt. Stündliche Vorhersage bevorzugt.'},
    {key:'power_sensor',label:'Midea-Leistung (optional)',domain:'sensor',deviceClass:'power',optional:true,hint:'Gemessene elektrische Leistung in W oder kW. Kein geschätzter VTherm-Energiezähler.'}
  ]},
  {title:'Gemeinsame Raumtemperatur',description:'KNX und Ikea liefern gemeinsam die angezeigte und intern verwendete Raumtemperatur. Ausgefallene oder veraltete Quellen werden ausgeschlossen; der andere Sensor übernimmt dann zu 100 %.',fields:[
    {key:'temperature_sensor',label:'Primärer Temperatursensor · KNX',domain:'sensor',deviceClass:'temperature',hint:'Standard: wz_temp. Nicht den berechneten Raumtemperatursensor als Eingabe wählen.'},
    {key:'secondary_temperature_sensor',label:'Zweiter Temperatursensor · Ikea',domain:'sensor',deviceClass:'temperature',optional:true,hint:'Lokale zweite Quelle. Ganze Grad werden durch Gewichtung und zeitliche Glättung abgemildert.'},
    {key:'primary_temperature_weight',label:'Gewicht KNX / primärer Sensor (%)',type:'number',min:1,max:99,step:1,hint:'Standard 75 %. Ikea erhält den Rest, also 25 %.'},
    {key:'primary_temperature_offset',label:'Korrektur KNX (°C)',type:'number',min:-3,max:3,step:0.1,hint:'Wird vor der Gewichtung addiert. Zunächst 0 °C; kein automatischer Ausgleich des Außenwandeinflusses.'},
    {key:'secondary_temperature_offset',label:'Korrektur Ikea (°C)',type:'number',min:-3,max:3,step:0.1},
    {key:'temperature_smoothing_minutes',label:'Glättung · Zeitkonstante (Minuten)',type:'number',min:0,max:15,step:1,hint:'Standard 3 Minuten. 0 deaktiviert die Glättung. Nach Quellenwechsel mindestens 10 Minuten Lernpause.'}
  ]},
  {title:'Wochenplan',description:'Die Uhrzeit bedeutet: Bis dahin soll die Komforttemperatur erreicht sein. Den Heizbeginn berechnet der Manager.',fields:[
    {key:'weekday_start',label:'Montag bis Freitag',type:'time'},
    {key:'weekend_start',label:'Samstag und Sonntag',type:'time'},
    {key:'night_start',label:'Nachtabsenkung täglich ab',type:'time'}
  ]},
  {title:'Wunschtemperaturen',description:'Tagsüber hält die Midea die Komforttemperatur. Nachts bleibt sie aus und heizt nur bei Unterschreitung nach.',fields:[
    {key:'comfort_temperature',label:'Komforttemperatur (°C)',type:'number',min:16,max:24,step:0.5},
    {key:'night_temperature',label:'Nachttemperatur · Einschaltschwelle (°C)',type:'number',min:7,max:22,step:0.5,hint:'Nachts bleibt die Midea aus und startet erst unter diesem Raumwert.'},
    {key:'night_reheat_hysteresis',label:'Nacht-Nachheizen · Hysterese (°C)',type:'number',min:0.1,max:1,step:0.1,hint:'Bei 18 °C und 0,3 °C Hysterese: Start unter 18 °C, aus ab 18,3 °C. Geräte-Sollwert während des kurzen Nachheizens liegt etwas höher.'}
  ]},
  {title:'Gemeinsames Aufheizen am Morgen',description:'Heizkörper und Midea heizen morgens gemeinsam. Danach hält die Midea die Temperatur.',fields:[
    {key:'max_preheat_minutes',label:'Maximale Vorheizzeit (Minuten)',type:'number',min:15,max:240,step:5,hint:'Obergrenze für den berechneten Heizbeginn vor der Komfortzeit.'},
    {key:'morning_support_minutes',label:'Heizkörperunterstützung nach Komfortbeginn (Minuten)',type:'number',min:0,max:180,step:5,hint:'Endet früher, sobald die Zieltemperatur erreicht ist. Die gemeinsame Vorheizphase liegt zusätzlich davor.'}
  ]},
  {title:'Tür, Sensoren und manuelle Änderungen',description:'Diese Grenzen gelten für die Automatik. Im Beobachtungsmodus werden keine Heizbefehle gesendet.',fields:[
    {key:'window_delay_seconds',label:'Verzögerung bei offener Tür (Sekunden)',type:'number',min:0,max:120,step:5},
    {key:'sensor_timeout_minutes',label:'Maximales Alter der Raumtemperatur (Minuten)',type:'number',min:10,max:360,step:10,hint:'Ungültige oder zu alte Messwerte pausieren die Automatik und fordern beide Regler zum Ausschalten auf.'},
    {key:'manual_pause_minutes',label:'Pause nach manueller Geräteänderung (Minuten)',type:'number',min:15,max:480,step:15,hint:'Während dieser Zeit werden manuell gewählte Sollwerte nicht überschrieben.'}
  ]}
];

class HeizungsmanagerPanel extends HTMLElement {
  constructor() { super(); this.attachShadow({mode:'open'}); this.tab='plan'; this._dirty=false; }
  set panel(value) { this._panel=value; this.maybeLoad(); }
  set hass(value) {
    this._hass=value;
    const card=this.shadowRoot.querySelector('heizungsmanager-card');
    if(card) card.hass=value;
    this.maybeLoad();
  }
  connectedCallback() { this.maybeLoad(); }
  get entryId() { return this._panel?.config?.entry_id; }
  async maybeLoad() {
    if(!this.isConnected || !this._hass || !this.entryId || this._loaded || this._loading || this._failed) return;
    this._loading=true;
    try {
      this.settings=await this._hass.callWS({type:'heizungsmanager/config',entry_id:this.entryId});
      this.draft={...this.settings.config}; this._loaded=true; this.render();
    } catch(err) { this._failed=true; this.shadowRoot.innerHTML=`<div style="padding:24px"><p>Heizungsmanager konnte nicht geladen werden: ${escapeHTML(err.message || err)}</p><button>Erneut laden</button></div>`; this.shadowRoot.querySelector('button').addEventListener('click',()=>{this._failed=false;this.maybeLoad();}); }
    finally { this._loading=false; }
  }
  field(field) {
    const value=this.draft[field.key] ?? '';
    let input;
    if(field.domain) {
      const entities=Object.entries(this._hass.states).filter(([id,s])=>id.startsWith(field.domain+'.') && (!field.deviceClass || s.attributes.device_class===field.deviceClass || id===value) && (!['temperature_sensor','secondary_temperature_sensor'].includes(field.key) || !s.attributes.heizungsmanager_room_temperature));
      entities.sort(([a],[b])=>a.localeCompare(b));
      const options=entities.map(([id,s])=>`<option value="${escapeHTML(id)}" ${id===value?'selected':''}>${escapeHTML(s.attributes.friendly_name || id)} · ${escapeHTML(id)}${['unavailable','unknown'].includes(s.state)?' (nicht verfügbar)':''}</option>`).join('');
      input=`<select id="${field.key}" name="${field.key}" ${field.optional?'':'required'}><option value="">${field.optional?'Nicht verwenden':'Bitte auswählen'}</option>${options}</select>`;
    } else {
      input=`<input id="${field.key}" name="${field.key}" type="${field.type}" value="${escapeHTML(field.type==='time'?String(value).slice(0,5):value)}" ${field.type==='number'?`min="${field.min}" max="${field.max}" step="${field.step}"`:'step="60"'} required>`;
    }
    return `<div class="field"><label for="${field.key}">${escapeHTML(field.label)}</label>${input}${field.hint?`<small>${escapeHTML(field.hint)}</small>`:''}</div>`;
  }
  render() {
    if(!this._loaded) return;
    this.shadowRoot.innerHTML=`<style>
      :host{display:block;height:100%;color:var(--primary-text-color);background:var(--primary-background-color);font-family:var(--paper-font-body1_-_font-family,system-ui)}*{box-sizing:border-box}.shell{height:100%;overflow:auto}.toolbar{display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:2;min-height:64px;padding:10px 24px;background:var(--app-header-background-color,var(--card-background-color));border-bottom:1px solid var(--divider-color);color:var(--app-header-text-color,var(--primary-text-color))}.toolbar h1{font-size:20px;margin:0;font-weight:600}.version{font-size:12px;opacity:.6;margin-left:auto}.menu{padding:8px;border:0;font-size:24px;background:transparent;color:inherit;cursor:pointer}.tabs{display:flex;gap:8px;padding:18px 0}.tabs button{background:transparent;color:var(--secondary-text-color);border:0;border-bottom:3px solid transparent;padding:12px 16px;cursor:pointer;font-size:15px}.tabs button.active{color:var(--primary-color,#42bfa7);border-color:var(--primary-color,#42bfa7)}main{max-width:1140px;margin:auto;padding:0 24px 40px}.intro{font-size:13px;color:var(--secondary-text-color);line-height:1.6;margin:0 0 18px}.section{background:var(--ha-card-background,var(--card-background-color));border:1px solid var(--divider-color);border-radius:16px;padding:22px;margin-bottom:18px}h2{font-size:18px;margin:0 0 8px}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin-top:20px}.field{display:flex;flex-direction:column;gap:8px;min-width:0}label{font-size:14px;font-weight:550}input,select{width:100%;min-height:44px;border:1px solid var(--divider-color);border-radius:8px;padding:10px;background:var(--primary-background-color);color:var(--primary-text-color);font:inherit}small{font-size:12px;color:var(--secondary-text-color);line-height:1.5}.actions{position:sticky;bottom:0;padding:16px;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}button.save{background:var(--primary-color,#42bfa7);color:var(--text-primary-color,#fff);border:0;border-radius:9px;padding:12px 22px;cursor:pointer;font-weight:600}button.reset{background:transparent;color:var(--primary-text-color);border:1px solid var(--divider-color);border-radius:9px;padding:11px 18px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}.feedback{font-size:13px;line-height:1.5;flex:1;min-width:180px}.feedback.error{color:var(--error-color,#e86f6f)}.notice{background:#f4aa5819;border-left:3px solid #f4aa58;padding:14px;font-size:13px;line-height:1.6;border-radius:8px;margin-bottom:18px}.readonly{font-size:13px;line-height:1.8}.readonly strong{font-weight:550}.operation{margin-bottom:18px}.operation select{max-width:250px;margin-top:8px}.operation label{display:block}#mode-message{font-size:12px;margin-top:8px} @media(max-width:650px){main{padding:0 12px 24px}.toolbar{padding:10px 12px}.fields{grid-template-columns:1fr}.section{padding:17px}.tabs button{padding:10px 12px}.version{font-size:11px}}
      </style><div class="shell"><header class="toolbar"><button class="menu" aria-label="Seitenleiste umschalten">☰</button><h1>Heizungsmanager</h1><span class="version">Wohnzimmer · v${escapeHTML(this.settings.version)}</span></header><main><nav class="tabs" role="tablist"><button role="tab" aria-selected="${this.tab==='plan'}" data-tab="plan" class="${this.tab==='plan'?'active':''}">Heiz-Fahrplan</button><button role="tab" aria-selected="${this.tab==='settings'}" data-tab="settings" class="${this.tab==='settings'?'active':''}">Einstellungen</button></nav><div id="content"></div></main></div>`;
    this.shadowRoot.querySelector('.menu').addEventListener('click',()=>this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true})));
    this.shadowRoot.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
      this.tab=button.dataset.tab;this.render();
    }));
    const content=this.shadowRoot.querySelector('#content');
    if(this.tab==='plan') {
      const card=document.createElement('heizungsmanager-card');
      card.setConfig({entity:this.settings.plan_entity || 'sensor.heizungsmanager_wz_fahrplan',mode_entity:this.settings.mode_entity});
      card.hass=this._hass; content.append(card);
    } else {
      const mode=this._hass.states[this.settings.mode_entity]?.state || this.settings.mode;
      content.innerHTML=`<p class="intro">Alle Einstellungen werden lokal in Home Assistant gespeichert.</p><section class="section operation"><label for="operation-mode">Betriebsart</label><select id="operation-mode">${['Beobachten','Automatik','Aus'].map(v=>`<option ${mode===v?'selected':''}>${v}</option>`).join('')}</select><div id="mode-message">Beobachten sendet keine Heizbefehle. Automatik übernimmt die Regler. Aus schaltet beide aus.</div></section><form><div class="notice">Beim Speichern wechselt der Manager in den Beobachtungsmodus. Bereits gesetzte Gerätezustände bleiben bestehen. Anschließend kann die Automatik wieder aktiviert werden.</div>${SETTINGS.map(group=>`<section class="section"><h2>${escapeHTML(group.title)}</h2><p class="intro">${escapeHTML(group.description)}</p><div class="fields">${group.fields.map(field=>this.field(field)).join('')}</div></section>`).join('')}<section class="section"><h2>Lokales Lernen und Planung</h2><div class="readonly">Berechnung alle <strong>30 Sekunden</strong>, Fahrplan über <strong>24 Stunden</strong> mit <strong>10-Minuten-Schritten</strong>.<br>Wärmeverlust sowie Heizbeiträge von Midea und Heizkörpern werden aus geeigneten getrennten Betriebsphasen gelernt. Gemeinsame Phasen werden nicht zur Trennung der Heizbeiträge verwendet.<br>Beim HA-Neustart startet diese Version im Beobachtungsmodus. Wetterabruf ggf. online; Planung und Lernen lokal.<br>Kein zusätzlicher Frostschutz im Modus Aus. Bestehende VTherm-Schutzfunktionen bleiben geräteseitig bestehen.</div></section><div class="actions"><button class="save" type="submit">Einstellungen speichern</button><button class="reset" type="button">Änderungen verwerfen</button><span class="feedback" role="status">${this._dirty?'Ungespeicherte Änderungen':''}</span></div></form>`;
      const form=content.querySelector('form');
      form.addEventListener('input',event=>{
        const field=event.target;
        if(!field.name) return;
        this.draft[field.name]=field.type==='number'?Number(field.value):field.value;
        this._dirty=true;
        const feedback=content.querySelector('.feedback'); feedback.classList.remove('error');feedback.textContent='Ungespeicherte Änderungen';
      });
      form.addEventListener('change',event=>{
        if(event.target.tagName==='SELECT') {this.draft[event.target.name]=event.target.value;this._dirty=true;content.querySelector('.feedback').textContent='Ungespeicherte Änderungen';}
      });
      form.addEventListener('submit',event=>{event.preventDefault();this.save(form);});
      content.querySelector('.reset').addEventListener('click',()=>{this.draft={...this.settings.config};this._dirty=false;this.render();});
      content.querySelector('#operation-mode').addEventListener('change',async event=>{
        const select=event.target;select.disabled=true;
        try{await this._hass.callService('select','select_option',{entity_id:this.settings.mode_entity,option:select.value});content.querySelector('#mode-message').textContent=`Betriebsart ${select.value} gesetzt.`;}
        catch(err){content.querySelector('#mode-message').textContent=err.message || String(err);select.value=mode;}
        finally{select.disabled=false;}
      });
    }
  }
  async save(form) {
    if(!form.reportValidity()) return;
    const feedback=this.shadowRoot.querySelector('.feedback'),button=form.querySelector('.save');
    button.disabled=true;feedback.classList.remove('error');feedback.textContent='Wird gespeichert …';
    const config={...this.draft};
    for(const key of ['weekday_start','weekend_start','night_start']) if(config[key].length===5) config[key]+=':00';
    try {
      await this._hass.callWS({type:'heizungsmanager/save_config',entry_id:this.entryId,config});
      this.settings.config={...config};this.settings.mode='Beobachten';this.draft={...config};this._dirty=false;
      this.shadowRoot.querySelector('#operation-mode').value='Beobachten';
      feedback.textContent='Gespeichert. Der Manager ist im Beobachtungsmodus.';
    } catch(err) {feedback.classList.add('error');feedback.textContent=err.message || String(err);}
    finally {button.disabled=false;}
  }
}
if(!customElements.get('heizungsmanager-panel')) customElements.define('heizungsmanager-panel',HeizungsmanagerPanel);
