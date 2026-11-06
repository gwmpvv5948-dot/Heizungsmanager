import './heizungsmanager-card.js?v=0.3.3';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SETTINGS = [
  {title:'Geräte und Messwerte', description:'Mindestens eine Wärmequelle je Raum zuordnen. In den Phasen dürfen nur zugeordnete Quellen ausgewählt werden. Vorhandene VTherm-Regler übernehmen weiterhin die Geräteansteuerung.', fields:[
    {key:'window_sensor',label:'Tür-/Fensterkontakt (optional)',domain:'binary_sensor',optional:true,hint:'on = Tür offen, off = Tür geschlossen.'},
    {key:'heat_pump',label:'Midea / Wärmepumpen-Regler (optional)',domain:'climate',optional:true,hint:'Der vorhandene WZ-Midea-Regler, nicht zusätzlich das darunterliegende Gerät.'},
    {key:'radiators',label:'Heizkörper-Regler (optional)',domain:'climate',optional:true,hint:'WZ VTherm steuert weiterhin WZ1 und WZ2.'},
    {key:'weather',label:'Wetterentität für Dresden',domain:'weather',hint:'Der Standort wird in der Wetterintegration festgelegt. Stündliche Vorhersage bevorzugt.'},
    {key:'power_sensor',label:'Midea-Leistung (optional)',domain:'sensor',deviceClass:'power',optional:true,hint:'Gemessene elektrische Leistung in W oder kW. Kein geschätzter VTherm-Energiezähler.'}
  ]},
  {title:'Verbrauchsanzeige',description:'Vergleich für heute seit 00:00. Midea-Strommessung und VTherm-Heizenergie-Schätzung werden getrennt gekennzeichnet und nicht addiert. Keine Wirkungsgrad- oder Kostenberechnung.',fields:[
    {key:'pump_daily_energy_sensor',label:'Midea · Energie heute (optional)',domain:'sensor',deviceClass:'energy',optional:true,hint:'Tageszähler in kWh, z. B. tasmota_energy_today_2. Der Leistungssensor in W bleibt für die aktuelle Leistung zuständig.'},
    {key:'radiator_energy_sensor',label:'Heizkörper · Energiezähler (optional)',domain:'sensor',deviceClass:'energy',optional:true},
    {key:'radiator_energy_period',label:'Art des Heizkörper-Zählers',options:[['daily','Tageszähler · Rücksetzung um Mitternacht'],['total','Fortlaufender Zähler · Tagesverbrauch aus HA-Historie']]}
  ]},
  {title:'Gemeinsame Raumtemperatur',description:'KNX und Ikea liefern gemeinsam die angezeigte und intern verwendete Raumtemperatur. Ausgefallene oder veraltete Quellen werden ausgeschlossen; der andere Sensor übernimmt dann zu 100 %.',fields:[
    {key:'temperature_sensor',label:'Primärer Temperatursensor · KNX',domain:'sensor',deviceClass:'temperature',hint:'Standard: wz_temp. Nicht den berechneten Raumtemperatursensor als Eingabe wählen.'},
    {key:'secondary_temperature_sensor',label:'Zweiter Temperatursensor · Ikea',domain:'sensor',deviceClass:'temperature',optional:true,hint:'Lokale zweite Quelle. Ganze Grad werden durch Gewichtung und zeitliche Glättung abgemildert.'},
    {key:'primary_temperature_weight',label:'Gewicht KNX / primärer Sensor (%)',type:'number',min:1,max:99,step:1,hint:'Standard 75 %. Ikea erhält den Rest, also 25 %.'},
    {key:'primary_temperature_offset',label:'Korrektur KNX (°C)',type:'number',min:-3,max:3,step:0.1,hint:'Wird vor der Gewichtung addiert. Zunächst 0 °C; kein automatischer Ausgleich des Außenwandeinflusses.'},
    {key:'secondary_temperature_offset',label:'Korrektur Ikea (°C)',type:'number',min:-3,max:3,step:0.1},
    {key:'temperature_smoothing_minutes',label:'Glättung · Zeitkonstante (Minuten)',type:'number',min:0,max:15,step:1,hint:'Standard 3 Minuten. 0 deaktiviert die Glättung. Nach Quellenwechsel mindestens 10 Minuten Lernpause.'}
  ]},
  ...['weekday','weekend'].flatMap(kind => [{phaseLayout:true,title:kind==='weekday'?'Vier Phasen · Montag bis Freitag':'Vier Phasen · Samstag und Sonntag',description:'Die Startzeit ist der tatsächliche Phasenbeginn. Jede Phase gilt bis zur nächsten; Nacht läuft über Mitternacht. Kein zusätzlicher automatischer Vorheizbeginn.',fields:
    [['morning','Morgens'],['day','Tag'],['evening','Abend'],['night','Nacht']].flatMap(([phase,label])=>[
      {key:`${kind}_${phase}_start`,label:`${label} · Startzeit`,type:'time'},
      {key:`${kind}_${phase}_temperature`,label:`${label} · Zieltemperatur (°C)`,type:'number',min:7,max:24,step:0.5},
      {key:`${kind}_${phase}_sources`,label:`${label} · Wer soll heizen?`,options:[['both','Midea + Heizkörper'],['heat_pump','Midea'],['radiators','Heizkörper'],['off','Keine Wärmequelle']]}
    ])
  }]),
  {title:'Wärmepumpe · Haltebetrieb und PV-Vorrang',description:'Temperaturhalten lässt die Wärmepumpe beim erreichten Raumziel im Heizmodus. PV priorisiert sie gegenüber Heizkörpern; fehlende PV schaltet sie nicht aus. Tür, Aus, ungültige Sensoren und Übertemperatur haben Vorrang. PV-Werte kommen optional lokal vom Strommanager, ohne zusätzliche Cloud-Verbindung.',fields:[
    {key:'pump_regulation',label:'Wärmepumpen-Regelung',options:[['hold','Temperatur halten · empfohlen'],['hysteresis','Ein/Aus nach Raumtemperatur']]},
    {key:'pv_preference_mode',label:'PV-Vorrang',options:[['auto','Automatisch über Strommanager'],['off','Aus']]},
    {key:'pv_on_w',label:'PV-Vorrang ab Überschuss (W)',type:'number',min:100,max:10000,step:100},
    {key:'pv_off_w',label:'PV-Vorrang unter Überschuss (W)',type:'number',min:0,max:9900,step:100},
    {key:'pv_confirm_minutes',label:'Überschuss/Mangel bestätigen (Minuten)',type:'number',min:1,max:30,step:1,hint:'PV wird über drei Minuten geglättet. Änderungen gelten erst nach dieser Bestätigungszeit.'},
    {key:'pv_hold_minutes',label:'PV-Vorrang mindestens halten (Minuten)',type:'number',min:5,max:120,step:5},
    {key:'pv_aux_gap',label:'Heizkörper ergänzen ab Temperaturdefizit (°C)',type:'number',min:.5,max:3,step:.5,hint:'Bei größerem Defizit helfen die Heizkörper trotz PV-Vorrang. Gilt nur für Phasen mit beiden Wärmequellen.'}
  ]},
  {title:'Temperaturregelung · alle Heizungen',description:'Gilt für Heizkörper und die ältere Ein/Aus-Regelung der Midea. Beim Temperaturhalten bleibt die Midea bis zur Übertemperaturgrenze freigegeben.',fields:[
    {key:'heating_hysteresis',label:'Gemeinsame Heiz-Hysterese (°C)',type:'number',min:0.1,max:1,step:0.1,hint:'Bei Soll 21 °C und Hysterese 0,3 °C: aus → ein erst unter 20,7 °C; ein → aus ab 21 °C. Nachts bei Soll 18 °C entsprechend unter 17,7 °C / aus ab 18 °C. Der Midea-Taktschutz bleibt zusätzlich aktiv.'}
  ]},
  {title:'Midea · Sollwertkorrektur',description:'Nur bei Ein/Aus-Regelung aktiv; beim Temperaturhalten ist der Geräte-Sollwert gleich dem Raumziel. Nur der an die Midea gesendete Geräte-Sollwert wird erhöht. Raumziel, Heizkörper-Sollwert, Hysterese und Übertemperaturgrenze bleiben auf die gewünschte Raumtemperatur bezogen.',fields:[
    {key:'pump_temperature_offset',label:'Midea · Temperatur-Offset (°C)',type:'number',min:0,max:3,step:0.5,hint:'Standard +0,5 °C. Bei 21 °C Raumziel erhält die Midea 21,5 °C. Gilt in allen Phasen und bei Schnelländerungen; 0 deaktiviert den Ausgleich. Gerätegrenzen und Temperaturschritte werden weiterhin berücksichtigt.'}
  ]},
  {title:'Midea · Taktschutz',description:'Gilt tagsüber, nachts und bei Schnelländerungen. Schützt die Heizfreigabe des Managers; interne Verdichterzyklen regelt die Midea selbst. Tür-Heizpause, ungültige Sensoren und Aus haben Vorrang.',fields:[
    {key:'pump_min_on_minutes',label:'Mindestlaufzeit (Minuten)',type:'number',min:5,max:60,step:1,hint:'Standard 15 Minuten. Die Heizfreigabe bleibt kurz bestehen, auch wenn die Solltemperatur bereits erreicht ist. Der Geräte-Sollwert begrenzt die Wärmeabgabe.'},
    {key:'pump_min_off_minutes',label:'Mindestpause vor Neustart (Minuten)',type:'number',min:5,max:60,step:1,hint:'Standard 15 Minuten. Gilt auch nach Tür-Heizpause oder Wechsel der Betriebsart. Die Raumtemperatur kann währenddessen unter die Wunschtemperatur fallen.'},
    {key:'pump_overheat_margin',label:'Mindestlaufzeit abbrechen ab Soll + (°C)',type:'number',min:0.3,max:2,step:0.1,hint:'Standard 0,5 °C. Verhindert Weiterheizen bei deutlicher Überschreitung; anschließend gilt die Mindestpause.'}
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
  get entryId() { return this.selectedEntry || this._panel?.config?.entry_id; }
  async maybeLoad() {
    if(!this.isConnected || !this._hass || !this.entryId || this._loaded || this._loading || this._failed) return;
    this._loading=true;
    try {
      let settings=await this._hass.callWS({type:'heizungsmanager/config',entry_id:this.entryId});
      if(!this._roomRestored) {
        let remembered;
        try {remembered=window.localStorage.getItem('heizungsmanager.selectedRoom');} catch {}
        // Validate against currently configured rooms before loading a saved choice.
        if(remembered && remembered!==this.entryId && settings.rooms?.some(room=>room.entry_id===remembered)) {
          settings=await this._hass.callWS({type:'heizungsmanager/config',entry_id:remembered});
          this.selectedEntry=remembered;
        }
        this._roomRestored=true;
      }
      this.settings=settings;
      try {window.localStorage.setItem('heizungsmanager.selectedRoom',this.entryId);} catch {}
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
    } else if(field.options) {
      input=`<select id="${field.key}" name="${field.key}" required>${field.options.map(([id,label])=>`<option value="${id}" ${id===value?'selected':''}>${escapeHTML(label)}</option>`).join('')}</select>`;
    } else {
      input=`<input id="${field.key}" name="${field.key}" type="${field.type}" value="${escapeHTML(field.type==='time'?String(value).slice(0,5):value)}" ${field.type==='number'?`min="${field.min}" max="${field.max}" step="${field.step}"`:'step="60"'} required>`;
    }
    return `<div class="field"><label for="${field.key}">${escapeHTML(field.label)}</label>${input}${field.hint?`<small>${escapeHTML(field.hint)}</small>`:''}</div>`;
  }
  render() {
    if(!this._loaded) return;
    this.shadowRoot.innerHTML=`<style>
      :host{display:block;height:100%;color:var(--primary-text-color);background:var(--primary-background-color);font-family:var(--paper-font-body1_-_font-family,system-ui)}*{box-sizing:border-box}.shell{height:100%;overflow:auto}.toolbar{display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:2;min-height:64px;padding:10px 24px;background:var(--app-header-background-color,var(--card-background-color));border-bottom:1px solid var(--divider-color);color:var(--app-header-text-color,var(--primary-text-color))}.toolbar h1{font-size:20px;margin:0;font-weight:600}.version{font-size:12px;opacity:.6;margin-left:auto}.menu{padding:8px;border:0;font-size:24px;background:transparent;color:inherit;cursor:pointer}.tabs{display:flex;gap:8px;padding:18px 0}.tabs button{background:transparent;color:var(--secondary-text-color);border:0;border-bottom:3px solid transparent;padding:12px 16px;cursor:pointer;font-size:15px}.tabs button.active{color:var(--primary-color,#42bfa7);border-color:var(--primary-color,#42bfa7)}main{max-width:1140px;margin:auto;padding:0 24px 40px}.intro{font-size:13px;color:var(--secondary-text-color);line-height:1.6;margin:0 0 18px}.section{background:var(--ha-card-background,var(--card-background-color));border:1px solid var(--divider-color);border-radius:16px;padding:22px;margin-bottom:18px}h2{font-size:18px;margin:0 0 8px}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin-top:20px}.phase-row{border:1px solid var(--divider-color);border-radius:12px;margin:18px 0 0;padding:14px;min-width:0}.phase-row legend{font-weight:650;padding:0 8px}.phase-fields{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:4px;gap:14px}.field{display:flex;flex-direction:column;gap:8px;min-width:0}label{font-size:14px;font-weight:550}input,select{width:100%;min-height:44px;border:1px solid var(--divider-color);border-radius:8px;padding:10px;background:var(--primary-background-color);color:var(--primary-text-color);font:inherit}small{font-size:12px;color:var(--secondary-text-color);line-height:1.5}.actions{position:sticky;bottom:0;padding:16px;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}button.save{background:var(--primary-color,#42bfa7);color:var(--text-primary-color,#fff);border:0;border-radius:9px;padding:12px 22px;cursor:pointer;font-weight:600}button.reset{background:transparent;color:var(--primary-text-color);border:1px solid var(--divider-color);border-radius:9px;padding:11px 18px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}.feedback{font-size:13px;line-height:1.5;flex:1;min-width:180px}.feedback.error{color:var(--error-color,#e86f6f)}.notice{background:#f4aa5819;border-left:3px solid #f4aa58;padding:14px;font-size:13px;line-height:1.6;border-radius:8px;margin-bottom:18px}.readonly{font-size:13px;line-height:1.8}.readonly strong{font-weight:550}.operation{margin-bottom:18px}.operation select{max-width:250px;margin-top:8px}.operation label{display:block}#mode-message{font-size:12px;margin-top:8px} @media(max-width:650px){.phase-fields{grid-template-columns:1fr}main{padding:0 12px 24px}.toolbar{padding:10px 12px}.fields{grid-template-columns:1fr}.section{padding:17px}.tabs button{padding:10px 12px}.version{font-size:11px}}
      </style><div class="shell"><header class="toolbar"><button class="menu" aria-label="Seitenleiste umschalten">☰</button><img src="/heizungsmanager-static/heizungsmanager-icon.png" alt="" width="32" height="32"><h1>Heizungsmanager</h1><span class="version">${escapeHTML(this.settings.config.room_name)} · v${escapeHTML(this.settings.version)}</span></header><main><div class="operation"><label for="room-select">Raum</label><select id="room-select">${(this.settings.rooms||[]).map(room=>`<option value="${escapeHTML(room.entry_id||'')}" ${room.entry_id===this.entryId?'selected':''} ${room.entry_id?'':'disabled'}>${escapeHTML(room.name)}${room.entry_id?'':' · noch nicht eingerichtet'}</option>`).join('')}</select></div><nav class="tabs" role="tablist"><button role="tab" aria-selected="${this.tab==='plan'}" data-tab="plan" class="${this.tab==='plan'?'active':''}">Heiz-Fahrplan</button><button role="tab" aria-selected="${this.tab==='settings'}" data-tab="settings" class="${this.tab==='settings'?'active':''}">Einstellungen</button></nav><div id="content"></div></main></div>`;
    this.shadowRoot.querySelector('#room-select').addEventListener('change',async event=>{
      if(this._dirty && !window.confirm('Ungespeicherte Änderungen verwerfen und Raum wechseln?')) {event.target.value=this.entryId;return;}
      this.selectedEntry=event.target.value;this._loaded=false;this._dirty=false;await this.maybeLoad();
    });
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
      content.innerHTML=`<p class="intro">Alle Einstellungen werden lokal in Home Assistant gespeichert.</p><section class="section operation"><label for="operation-mode">Betriebsart</label><select id="operation-mode">${['Beobachten','Automatik','Aus'].map(v=>`<option ${mode===v?'selected':''}>${v}</option>`).join('')}</select><div id="mode-message">Beobachten sendet keine Heizbefehle. Automatik übernimmt die Regler. Aus schaltet beide aus.</div></section><form><div class="notice">Die gewählte Betriebsart bleibt beim Speichern und nach HA-Neustarts erhalten. In Automatik werden gespeicherte Änderungen direkt für die Regelung verwendet.</div>${SETTINGS.map(group=>`<section class="section"><h2>${escapeHTML(group.title)}</h2><p class="intro">${escapeHTML(group.description)}</p>${group.phaseLayout?Array.from({length:4},(_,i)=>`<fieldset class="phase-row"><legend>${['Morgens','Tag','Abend','Nacht'][i]}</legend><div class="fields phase-fields">${group.fields.slice(i*3,i*3+3).map(field=>this.field(field)).join('')}</div></fieldset>`).join(''):`<div class="fields">${group.fields.map(field=>this.field(field)).join('')}</div>`}</section>`).join('')}<section class="section"><h2>Lokales Lernen und Planung</h2><div class="readonly">Berechnung alle <strong>30 Sekunden</strong>, Fahrplan über <strong>24 Stunden</strong> mit <strong>10-Minuten-Schritten</strong>.<br>Wärmeverlust sowie Heizbeiträge von Midea und Heizkörpern werden aus geeigneten getrennten Betriebsphasen gelernt. Gemeinsame Phasen werden nicht zur Trennung der Heizbeiträge verwendet.<br>Nach einem HA-Neustart wird die zuletzt gewählte Betriebsart wiederhergestellt. Wetterabruf ggf. online; Planung und Lernen lokal.<br>Kein zusätzlicher Frostschutz im Modus Aus. Bestehende VTherm-Schutzfunktionen bleiben geräteseitig bestehen.</div></section><div class="actions"><button class="save" type="submit">Einstellungen speichern</button><button class="reset" type="button">Änderungen verwerfen</button><span class="feedback" role="status">${this._dirty?'Ungespeicherte Änderungen':''}</span></div></form>`;
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
    for(const key of Object.keys(config)) if(key.endsWith('_start') && typeof config[key]==='string' && config[key].length===5) config[key]+=':00';
    try {
      const result=await this._hass.callWS({type:'heizungsmanager/save_config',entry_id:this.entryId,config});
      this.settings.config={...config};this.settings.mode=result.mode;this.draft={...config};this._dirty=false;
      this.shadowRoot.querySelector('#operation-mode').value=result.mode;
      feedback.textContent=`Gespeichert. Betriebsart ${result.mode} bleibt aktiv.`;
    } catch(err) {feedback.classList.add('error');feedback.textContent=err.message || String(err);}
    finally {button.disabled=false;}
  }
}
if(!customElements.get('heizungsmanager-panel')) customElements.define('heizungsmanager-panel',HeizungsmanagerPanel);
