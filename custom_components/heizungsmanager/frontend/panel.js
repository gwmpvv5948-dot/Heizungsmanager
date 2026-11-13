import {mountPhases,phaseError} from './phase-editor.js?v=0.3.44';
import {wallHeaterSwitch,wallHeaterPowerId} from './energy-overview.js?v=0.3.35';
import {houseHeatView,houseHeatCSS} from './house-heat-view.js?v=0.3.29';
import {overviewHTML,overviewCSS,quickOverviewCSS,roomOverview} from './overview.js?v=0.3.35';
import {dayStart} from './consumption.js?v=0.3.29';
import './heizungsmanager-card.js?v=0.3.29';

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
    {key:'wall_heater_power_sensor',label:'Wandheizung · Leistung',domain:'sensor',deviceClass:'power',optional:true,hint:'Ohne Sensor wird mit 400 W während der Einschaltzeit gerechnet.'},
    {key:'wall_heater_daily_energy_sensor',label:'Wandheizung · Energie heute',domain:'sensor',deviceClass:'energy',optional:true,hint:'Optionaler Tageszähler für den gemessenen Stromverbrauch.'},
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
  {phaseLayout:true},
  {title:'Wärmepumpe · Haltebetrieb und PV-Vorrang',description:'Temperaturhalten lässt die Wärmepumpe beim erreichten Raumziel im Heizmodus. PV priorisiert sie gegenüber Heizkörpern; fehlende PV schaltet sie nicht aus. Tür, Aus, ungültige Sensoren und Übertemperatur haben Vorrang. PV-Werte kommen optional lokal vom Strommanager, ohne zusätzliche Cloud-Verbindung.',fields:[
    {key:'midea_follow_me',label:'Midea · Follow Me',options:[['on','Ein'],['off','Aus · VTherm regelt']],hint:'Bei Aus erhält der konfigurierte VTherm-Regler das Raum-Soll plus den eingestellten Sollwertoffset.'},
    {key:'pump_regulation',label:'Wärmepumpen-Regelung',options:[['hold','Temperatur halten · empfohlen'],['hysteresis','Ein/Aus nach Raumtemperatur']]},
    {key:'pv_preference_mode',label:'PV-Vorrang',options:[['auto','Automatisch über Strommanager'],['off','Aus']]},
    {key:'pv_on_w',label:'PV-Vorrang über PV-Erzeugung (W)',type:'number',min:100,max:10000,step:100},
    {key:'pv_off_w',label:'PV-Vorrang unter PV-Erzeugung (W)',type:'number',min:0,max:9900,step:100},
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
  constructor() { super(); this.attachShadow({mode:'open'}); this.tab='home'; this._dirty=false; }
  set panel(value) { this._panel=value; this.maybeLoad(); }
  set hass(value) {
    this._hass=value;
    const card=this.shadowRoot.querySelector('heizungsmanager-card');
    if(card) card.hass=value;
    this.maybeLoad();
    if(this._loaded&&this.tab==='home')this.updateOverview();
    if(this.tab==='global')this.updateValveReadings();
    else if(this._loaded&&this.tab==='plan'&&this.settings.config.room_id==='schlafzimmer'&&!this.settings.config.radiators&&!this.settings.config.heat_pump)this.render();
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
  async refreshRadiatorHistory(){
    const rooms=roomOverview(this._hass.states),zone=this._hass.config?.time_zone||'Europe/Berlin';
    const ids=[...new Set([...rooms.flatMap(r=>[r.config.radiators?r.config.radiator_energy_sensor:null,r.config.pump_daily_energy_sensor,r.config.wall_heater_daily_energy_sensor,r.roomId==="wohnzimmer"&&this._hass.states[wallHeaterPowerId(r.config)]?wallHeaterPowerId(r.config):null]),this._hass.states[wallHeaterSwitch]?wallHeaterSwitch:null].filter(Boolean))].sort();
    if(!ids.length)return;
    const start=dayStart(new Date(),zone).toISOString(),key=JSON.stringify([start,ids]);
    if(this._radiatorLoading||(key===this._radiatorHistoryKey&&Date.now()-(this._radiatorFetched||0)<60000))return;
    if(key!==this._radiatorHistoryKey)this._radiatorHistory={};
    this._radiatorHistoryKey=key;this._radiatorFetched=Date.now();this._radiatorLoading=true;
    try{
      const data=await this._hass.callWS({type:'history/history_during_period',start_time:start,entity_ids:ids,include_start_time_state:true,significant_changes_only:true,minimal_response:false,no_attributes:false});
      if(key===this._radiatorHistoryKey)this._radiatorHistory=data;
    }catch{this._radiatorHistory={};}
    finally{this._radiatorLoading=false;if(this.isConnected&&this.tab==='home')this.updateOverview();}
  }
  async refreshHouseHeat(){
    if(this._houseHeatLoading||Date.now()-(this._houseHeatFetched||0)<60000)return;
    this._houseHeatLoading=true;this._houseHeatFetched=Date.now();
    try{this._houseHeat=await this._hass.callWS({type:'heizungsmanager/house_heat'});}
    catch{if(this._houseHeat)this._houseHeat={...this._houseHeat,incomplete:true,note:'Haus-Zähler derzeit nicht aktualisiert'};}
    finally{this._houseHeatLoading=false;if(this.isConnected&&this.tab==='home')this.updateOverview();}
  }
  updateOverview({interactive=false}={}) {
    const content=this.shadowRoot.querySelector('#content');
    if(!content||this.tab!=='home')return;
    this.refreshRadiatorHistory();
    this.refreshHouseHeat();
    // Keep the focused controls and blue frame mounted during live updates.
    if(!interactive&&content.querySelector(".room-tile.quick-editing"))return;
    const zone=this._hass.config?.time_zone||'Europe/Berlin';
    const meter=houseHeatView(this._houseHeat||{},zone,content.querySelector('.meter-details')?.open,content.querySelector('.meter-usage')?.open);
    this._quickDrafts??=new Map();
    this._quickBusy??=new Set();
    this._quickErrors??=new Map();
    const html=overviewHTML(this._hass.states,this.homeFilter||'all',Date.now(),this._radiatorHistory||{},zone,meter,{enabled:this._hass.user?.is_admin,drafts:this._quickDrafts,busy:this._quickBusy,errors:this._quickErrors});
    if(this._overviewContent===content&&this._overviewHTML===html)return;
    this._overviewContent=content;
    this._overviewHTML=html;
    const chartScroll=content.querySelector('.meter-bars')?.scrollLeft;
    content.innerHTML=html;
    if(chartScroll)content.querySelector('.meter-bars').scrollLeft=chartScroll;
    content.querySelector('.meter-read').onclick=()=>this.openMeterReading();
    content.querySelectorAll('[data-home-filter]').forEach(button=>button.onclick=()=>{this.homeFilter=button.dataset.homeFilter;this.updateOverview({interactive:true});});
    content.querySelectorAll('[data-quick],[data-duration]').forEach(button=>{
      button.onclick=()=>this.changeRoomTarget(button);
    });
    content.querySelectorAll('[data-open-room]').forEach(button=>button.onclick=async()=>{
      this.selectedEntry=button.dataset.openRoom;this.tab='plan';this._loaded=false;this._dirty=false;await this.maybeLoad();
    });
  }
  async changeRoomTarget(button) {
    const tile=button.closest('[data-quick-room]');
    const entry=tile.dataset.quickRoom, action=button.dataset.quick;
    if(this._quickBusy.has(entry))return;
    const draft=this._quickDrafts.get(entry);
    this._quickErrors.delete(entry);
    if(action==='plus'||action==='minus'){
      const target=draft?.temperature??Number(tile.dataset.quickTarget);
      const temperature=Math.max(16,Math.min(24,Math.round(target*2+(action==='plus'?1:-1))/2));
      this._quickDrafts.set(entry,{temperature,duration:draft?.duration??'schedule'});
    }else if(button.dataset.duration&&draft){
      draft.duration=button.dataset.duration;
    }else if(action==='cancel'){
      this._quickDrafts.delete(entry);
    }else if((action==='set'&&draft)||action==='clear'){
      this._quickBusy.add(entry);
      this.updateOverview({interactive:true});
      try{
        const args=action==='set'?draft:{};
        await this._hass.callWS({type:'heizungsmanager/override',entry_id:entry,action,...args});
        this._quickDrafts.delete(entry);
      }catch(error){
        this._quickErrors.set(entry,error?.message||'Änderung fehlgeschlagen');
      }finally{
        this._quickBusy.delete(entry);
      }
    }
    this.updateOverview({interactive:true});
  }
  openGlobalHeatSettings() {
    if(this._dirty&&!window.confirm('Ungespeicherte Änderungen verwerfen?'))return;
    this._dirty=false;
    this.tab='global';
    this.render();
  }
  renderGlobalSettings(content) {
    content.innerHTML=`<style>
      .global-layout{display:grid;grid-template-columns:160px minmax(0,1fr);gap:18px}
      .global-nav{display:flex;flex-direction:column;gap:8px;align-self:start}
      .global-heading,.valve-head,.valve-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .valve-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}
      .valve-stats>div{padding:12px;background:var(--primary-background-color);border-radius:10px}
      .valve-stats strong{display:block;margin:4px 0}
      .valve-chart{width:100%;display:block;margin:12px 0}
      .valve-row{display:grid;grid-template-columns:12px minmax(92px,110px) minmax(45px,1fr) 56px 38px;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--divider-color)}
      .valve-row i{height:10px;border-radius:3px}
      .valve-row input{width:100%;min-width:0;margin:0}
      .valve-row input[type=range]{padding:0;accent-color:var(--phase)}
      .valve-row button{padding:8px}
      .valve-row small{grid-column:2/-1;color:var(--error-color)}
      .valve-actions{margin-top:16px}
      .valve-toggle{appearance:none;width:42px;min-height:24px;padding:0;border-radius:20px;vertical-align:middle;cursor:pointer;background:var(--divider-color)}
      .valve-toggle:before{content:'';display:block;width:18px;height:18px;margin:2px;background:white;border-radius:50%}
      .valve-toggle:checked{background:var(--primary-color)}.valve-toggle:checked:before{margin-left:20px}
      [data-valve-status]:empty{display:none}
      @media(max-width:650px){.global-layout{grid-template-columns:1fr}.global-nav{flex-direction:row}.valve-stats>div{padding:7px}}
      @media(max-width:460px){
        .valve-row{grid-template-columns:10px minmax(0,1fr) auto 44px;gap:8px 10px}
        .valve-row input[type=time]{grid-area:1 / 2 / 2 / 4;max-width:140px}
        .valve-row input[type=range]{grid-area:2 / 2}
        .valve-row output{grid-area:2 / 3;white-space:nowrap}
        .valve-row button,.valve-placeholder{grid-area:1 / 4 / 3 / 5;min-height:44px}
        .valve-row small:empty{display:none}
        .valve-stats>div{min-width:0;overflow-wrap:anywhere}
      }
    </style>
    <div class="global-heading"><div><small>Gilt für alle Räume</small><h2>Globale Einstellungen</h2></div></div>
    <div class="global-layout"><nav class="global-nav" aria-label="Globale Einstellungen">
      <button class="reset" data-global-nav="valve">Stellantrieb</button>
      <button class="reset" data-global-nav="meter">Wärmezähler</button>
    </nav><div>
      <section class="section" data-global-section="valve">
        <div class="valve-head"><div><h2>Zentraler KNX-Stellantrieb</h2><small>Ventilstellung über den Tag</small></div>
          <label>HM-Zeitplan <input form="valve-plan" class="valve-toggle" role="switch" type="checkbox" name="enabled" disabled></label>
        </div>
        <div class="valve-stats">
          <div><small>Stellung jetzt</small><strong data-valve-position></strong><progress data-valve-progress max="100" style="width:100%"></progress></div>
          <div><small>Aktive Phase</small><strong data-valve-phase>—</strong></div>
          <div><small>Sommermodus</small><strong data-valve-summer></strong><input data-summer-toggle class="valve-toggle" role="switch" type="checkbox" aria-label="Sommermodus"></div>
        </div>
        <p data-valve-status class="notice" role="status">Zeitplan wird geladen …</p>
        <form id="valve-plan" data-valve-form hidden>
          <div class="valve-head"><h2>Tagesverlauf</h2><small>┄ Aktuell · ▪ Entwurf</small></div>
          <div data-valve-chart></div>
          <h2>Phasen im Entwurf</h2>
          <div data-valve-rows></div>
          <button type="button" class="reset" data-valve-add>＋ Phase hinzufügen</button>
          <div class="valve-actions"><small data-valve-dirty></small><div>
            <button type="button" class="reset" data-valve-reset>Verwerfen</button>
            <button type="submit" class="save">Als Plan speichern</button>
          </div></div>
        </form>
        <button type="button" class="save" data-valve-import hidden>„Nachtabsenkung Haus“ übernehmen</button>
        <button type="button" class="reset" data-valve-defaults hidden>Vier Standardphasen übernehmen</button>
      </section>
      <section class="section" data-global-section="meter">
        <div class="valve-head"><h2>Wärmezähler Haus</h2><button type="button" class="reset" data-january-reading>✎ Startwert ändern</button></div>
        <div class="valve-stats">
          <div><small>Stand 1. Januar</small><strong data-meter-january>—</strong></div>
          <div><small>Stand jetzt · geschätzt</small><strong data-meter-current>—</strong></div>
          <div><small>Verbrauch dieses Jahr · geschätzt</small><strong data-meter-year>—</strong></div>
        </div>
        <p data-meter-feedback role="status"></p>
      </section></div></div>`;
    const button=content.querySelector('[data-valve-import]');
    const defaults=content.querySelector('[data-valve-defaults]');
    const status=content.querySelector('[data-valve-status]');
    const form=content.querySelector('[data-valve-form]');
    const save=form.querySelector('[type=submit]');
    const toggle=content.querySelector('[name=enabled]');
    const rows=content.querySelector('[data-valve-rows]');
    const chart=content.querySelector('[data-valve-chart]');
    const dirty=content.querySelector('[data-valve-dirty]');
    const reset=content.querySelector('[data-valve-reset]');
    const add=content.querySelector('[data-valve-add]');
    const colors=['#9b9a93','#f6a62b','#df6238','#388edc','#71b9a0','#ac8bd4'];
    const minute=value=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
    const clock=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
    let plan=null, draft=[], baseline=[], active=false, busy=false, normalized=false;
    const currentMinute=()=>{
      const zone=this._hass.config?.time_zone||'Europe/Berlin';
      return minute(new Date().toLocaleTimeString('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit'}));
    };
    const feedback=()=>{
      status.textContent=!plan?'Der Scheduler steuert nach „Nachtabsenkung Haus“.'
        :plan.enabled===false?'HM-Zeitplan ausgeschaltet'
        :active?'':'Alter Scheduler steuert noch. Der HM-Zeitplan ist pausiert.';
      toggle.checked=Boolean(plan&&plan.enabled!==false);
    };
    const preview=()=>{
      const now=currentMinute();
      const saved=plan?.slots||[];
      const phase=active?saved.find(slot=>{
        const start=minute(slot.start), stop=minute(slot.stop);
        return start<stop?start<=now&&now<stop:now>=start||now<stop;
      }):null;
      content.querySelector('[data-valve-phase]').textContent=phase
        ? `${phase.value} % · seit ${phase.start.slice(0,5)}`:'—';
      const changed=normalized||JSON.stringify(draft)!==JSON.stringify(baseline);
      const valid=draft.map((phase,i)=>/^\d{2}:\d{2}$/.test(phase.start)
        &&(i===0?phase.start==='00:00':minute(phase.start)>minute(draft[i-1].start))
        &&Number.isFinite(phase.value)&&phase.value>=0&&phase.value<=100);
      rows.querySelectorAll('.valve-row').forEach((row,i)=>{
        row.querySelector('small').textContent=valid[i]?'':'Startzeiten müssen eindeutig und aufsteigend sein. Stellung 0–100 %.';
        row.querySelector('input[type=time]').setAttribute('aria-invalid',String(!valid[i]));
      });
      save.disabled=busy||!changed||valid.includes(false);
      reset.disabled=busy||!changed;
      add.disabled=busy||draft.length>=96;
      dirty.textContent=changed?'Entwurf weicht vom aktuellen Plan ab':'Entwurf entspricht dem aktuellen Plan';
      const max=Math.max(10,Math.ceil(Math.max(0,...saved.map(p=>p.value),...draft.map(p=>p.value))/10)*10);
      const x=t=>36+t/1440*664, y=v=>146-v/max*120;
      const line=(start,stop,value,color,dashed=false)=>{
        const end=stop<start?1440:stop;
        const left=x(start),right=x(end),height=y(value);
        return `${dashed?'':`<rect x="${left}" y="${height}" width="${Math.max(0,right-left)}" height="${146-height}" fill="${color}" opacity=".2"/>`}
          <path d="M${left} ${height}H${right}" stroke="${color}" stroke-width="2" ${dashed?'stroke-dasharray="5 4"':''}/>
          ${dashed?'':`<text x="${(left+right)/2}" y="${height-5}" text-anchor="middle">${value} %</text>`}`;
      };
      chart.innerHTML=`<svg class="valve-chart" viewBox="0 0 720 174" role="img" aria-label="Ventilstellung über 24 Stunden" fill="currentColor" font-size="12">
        ${[0,max/2,max].map(v=>`<path d="M36 ${y(v)}H700" stroke="var(--divider-color)"/><text x="4" y="${y(v)+4}">${v}</text>`).join('')}
        ${[0,360,720,1080,1440].map(t=>`<text x="${x(t)}" y="165" text-anchor="middle">${clock(t)}</text>`).join('')}
        ${draft.map((p,i)=>valid[i]&&(!draft[i+1]||valid[i+1])?line(minute(p.start),draft[i+1]?minute(draft[i+1].start):1440,p.value,colors[i%colors.length]):'').join('')}
        ${saved.map(p=>line(minute(p.start),minute(p.stop),p.value,'currentColor',true)).join('')}
        <path d="M${x(now)} 19V146" stroke="currentColor"/><text x="${x(now)}" y="14" text-anchor="middle">jetzt</text>
      </svg>`;
    };
    const renderRows=()=>{
      rows.innerHTML=draft.map((phase,i)=>{
        const color=colors[i%colors.length];
        return `<div class="valve-row" style="--phase:${color}">
          <i style="background:${color}"></i>
          <input type="time" value="${escapeHTML(phase.start)}" aria-label="Start Phase ${i+1}" ${i===0?'readonly':''}>
          <input type="range" min="0" max="100" step="0.1" value="${phase.value}" aria-label="Ventilstellung Phase ${i+1}">
          <output>${phase.value} %</output>
          ${i===0?'<span class="valve-placeholder"></span>':`<button type="button" class="reset" aria-label="Phase ${i+1} löschen"><ha-icon icon="mdi:delete-outline"></ha-icon></button>`}
          <small></small></div>`;
      }).join('');
      rows.querySelectorAll('.valve-row').forEach((row,i)=>{
        const start=row.querySelector('[type=time]'), slider=row.querySelector('[type=range]');
        start.oninput=()=>{draft[i].start=start.value;preview();};
        slider.oninput=()=>{
          draft[i].value=slider.valueAsNumber;
          row.querySelector('output').textContent=`${slider.value} %`;
          preview();
        };
        const remove=row.querySelector('button');
        if(remove)remove.onclick=()=>{draft.splice(i,1);renderRows();};
      });
      preview();
    };
    const loadValve=async (configuration={},reloadDraft=true)=>{
      busy=true;
      button.disabled=defaults.disabled=toggle.disabled=save.disabled=true;
      try {
        ({plan,active}=await this._hass.callWS({type:'heizungsmanager/central_valve',...configuration}));
        feedback();
        form.hidden=!plan;
        button.hidden=defaults.hidden=Boolean(plan);
        if(plan&&reloadDraft){
          baseline=plan.slots.map(slot=>({start:slot.start.slice(0,5),value:slot.value}));
          draft=baseline.map(phase=>({...phase})).sort((a,b)=>a.start.localeCompare(b.start));
          if(draft[0]?.start!=='00:00')draft.unshift({start:'00:00',value:draft.at(-1)?.value??0});
          normalized=draft.length!==plan.slots.length||draft.some((phase,i)=>
            (draft[i+1]?.start??'24:00')!==plan.slots[i]?.stop.slice(0,5));
          baseline=draft.map(phase=>({...phase}));
          renderRows();
        }
      } catch(error) {
        feedback();
        status.textContent=error?.message||'Der Zeitplan konnte nicht geladen werden.';
      } finally {
        busy=false;
        button.disabled=defaults.disabled=false;
        toggle.disabled=!plan;
        if(plan)preview();
      }
    };
    button.onclick=()=>loadValve({take_over:true});
    defaults.onclick=()=>loadValve({take_over:true,use_defaults:true});
    toggle.onchange=()=>loadValve({enabled:toggle.checked},false);
    form.onsubmit=event=>{event.preventDefault();void loadValve({enabled:toggle.checked,phases:draft});};
    reset.onclick=()=>{draft=baseline.map(phase=>({...phase}));renderRows();};
    add.onclick=()=>{
      const latest=minute(draft.at(-1).start);
      const next=Math.min(1439,Math.floor(latest/15)*15+15);
      if(Number.isFinite(next)&&next>latest)draft.push({start:clock(next),value:draft.at(-1).value});
      else {
        const index=draft.findIndex((p,i)=>i>0&&minute(p.start)-minute(draft[i-1].start)>1);
        if(index>0)draft.splice(index,0,{start:clock(minute(draft[index-1].start)+1),value:draft[index-1].value});
      }
      renderRows();
    };
    content.querySelectorAll('[data-global-nav]').forEach(nav=>{
      nav.onclick=()=>content.querySelector(`[data-global-section="${nav.dataset.globalNav}"]`).scrollIntoView({block:'start'});
    });
    const summer=content.querySelector('[data-summer-toggle]');
    summer.onchange=async()=>{
      summer.disabled=true;
      try {
        await this._hass.callService('switch',summer.checked?'turn_on':'turn_off',{entity_id:'switch.stellantrieb_sommermodus'});
      }catch(error){
        status.textContent=error?.message||'Sommermodus konnte nicht umgeschaltet werden.';
      }finally{this.updateValveReadings();}
    };
    this.updateValveReadings();
    void loadValve();
    const loadMeter=async()=>{
      const meter=await this._hass.callWS({type:'heizungsmanager/house_heat'});
      this._houseHeat=meter;
      for(const [field,value] of Object.entries({january:meter.january_kwh,current:meter.total_kwh,year:meter.year_kwh})){
        content.querySelector(`[data-meter-${field}]`).textContent=Number.isFinite(value)
          ? value.toLocaleString('de-DE',{maximumFractionDigits:2})+' kWh':'—';
      }
    };
    this._loadGlobalMeter=loadMeter;
    const meterError=error=>{
      content.querySelector('[data-meter-feedback]').textContent=error?.message||'Wärmezähler konnte nicht geladen werden';
    };
    void loadMeter().catch(meterError);
    content.querySelector('[data-january-reading]').onclick=async()=>{
      try {
        await loadMeter();
        if(this.tab==='global')this.openMeterReading(true);
      }catch(error){meterError(error);}
    };
  }
  updateValveReadings() {
    const position=this.shadowRoot.querySelector('[data-valve-position]');
    if(!position)return;
    const actuator=this._hass.states['number.wz_stellantrieb'];
    position.textContent=actuator&&!['unknown','unavailable'].includes(actuator.state)
      ? `${actuator.state} ${actuator.attributes.unit_of_measurement||''}`.trim()
      : 'Nicht verfügbar';
    const summer=this._hass.states['switch.stellantrieb_sommermodus']?.state;
    const progress=this.shadowRoot.querySelector('[data-valve-progress]');
    progress.value=Number(actuator?.state)||0;
    const toggle=this.shadowRoot.querySelector('[data-summer-toggle]');
    toggle.disabled=!['on','off'].includes(summer);
    toggle.checked=summer==='on';
    this.shadowRoot.querySelector('[data-valve-summer]').textContent=
      summer==='on'?'Ein':summer==='off'?'Aus':'Nicht verfügbar';
  }
  openMeterReading(global=false) {
    const dialog=document.createElement('dialog');
    dialog.className='meter-dialog';
    const meter=this._houseHeat||{};
    const label=global?`Zählerstand am 1. Januar ${meter.year} in kWh`:'Aktueller Wärmezählerstand in kWh';
    dialog.innerHTML=`<form><label>${label}<input name="reading" type="number" min="0" max="1000000000" step="0.001" value="${global?meter.january_kwh??'':''}" required></label><small role="alert"></small><div><button type="button">Abbrechen</button> <button type="submit">${global?'Speichern':'Ablesung speichern'}</button></div></form>`;
    const form=dialog.querySelector('form'), save=form.querySelector('[type=submit]');
    form.querySelector('[type=button]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    form.onsubmit=async event=>{
      event.preventDefault();
      save.disabled=true;
      try{
        const value=form.elements.reading.valueAsNumber;
        this._houseHeat=await this._hass.callWS({type:'heizungsmanager/house_heat',...(global?{january_kwh:value,year:meter.year}:{reading_kwh:value})});
        this._houseHeatFetched=Date.now();
        dialog.close();
        if(global&&this.tab==='global')await this._loadGlobalMeter?.();
        else this.updateOverview();
      }catch(error){
        form.querySelector('[role=alert]').textContent=error?.message||'Ablesung konnte nicht gespeichert werden';
        save.disabled=false;
      }
    };
    this.shadowRoot.append(dialog);
    dialog.showModal();
  }
  field(field) {
    if((field.key.startsWith("wall_heater_")||field.key==="midea_follow_me")&&this.draft.room_id!=="wohnzimmer")return "";
    const value=this.draft[field.key] ?? (field.key==="wall_heater_power_sensor"&&this._hass.states[wallHeaterPowerId(this.draft)]?wallHeaterPowerId(this.draft):"");
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
      :host{display:block;height:100%;color:var(--primary-text-color);background:var(--primary-background-color);font-family:var(--paper-font-body1_-_font-family,system-ui)}*{box-sizing:border-box}.shell{height:100%;overflow:auto}.toolbar{display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:2;min-height:64px;padding:10px 24px;background:var(--app-header-background-color,var(--card-background-color));border-bottom:1px solid var(--divider-color);color:var(--app-header-text-color,var(--primary-text-color))}.toolbar h1{font-size:20px;margin:0;font-weight:600}.version{font-size:12px;opacity:.6;margin-left:auto}.menu{padding:8px;border:0;font-size:24px;background:transparent;color:inherit;cursor:pointer}.tabs{display:flex;gap:8px;padding:18px 0}.tabs button{background:transparent;color:var(--secondary-text-color);border:0;border-bottom:3px solid transparent;padding:12px 16px;cursor:pointer;font-size:15px}.tabs button.active{color:var(--primary-color,#42bfa7);border-color:var(--primary-color,#42bfa7)}main{max-width:1140px;margin:auto;padding:0 24px 40px}.intro{font-size:13px;color:var(--secondary-text-color);line-height:1.6;margin:0 0 18px}.section{background:var(--ha-card-background,var(--card-background-color));border:1px solid var(--divider-color);border-radius:16px;padding:22px;margin-bottom:18px}h2{font-size:18px;margin:0 0 8px}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin-top:20px}.phase-row{border:1px solid var(--divider-color);border-radius:12px;margin:18px 0 0;padding:14px;min-width:0}.phase-row legend{font-weight:650;padding:0 8px}.phase-fields{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:4px;gap:14px}.field{display:flex;flex-direction:column;gap:8px;min-width:0}label{font-size:14px;font-weight:550}input,select{width:100%;min-height:44px;border:1px solid var(--divider-color);border-radius:8px;padding:10px;background:var(--primary-background-color);color:var(--primary-text-color);font:inherit}small{font-size:12px;color:var(--secondary-text-color);line-height:1.5}.actions{position:sticky;bottom:0;padding:16px;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}button.save{background:var(--primary-color,#42bfa7);color:var(--text-primary-color,#fff);border:0;border-radius:9px;padding:12px 22px;cursor:pointer;font-weight:600}button.reset{background:transparent;color:var(--primary-text-color);border:1px solid var(--divider-color);border-radius:9px;padding:11px 18px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}.feedback{font-size:13px;line-height:1.5;flex:1;min-width:180px}.feedback.error{color:var(--error-color,#e86f6f)}.notice{background:#f4aa5819;border-left:3px solid #f4aa58;padding:14px;font-size:13px;line-height:1.6;border-radius:8px;margin-bottom:18px}.readonly{font-size:13px;line-height:1.8}.readonly strong{font-weight:550}.operation{margin-bottom:18px}.operation select{max-width:250px;margin-top:8px}.operation label{display:block}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.operation:has(#room-select){display:inline-block;margin:10px 0 0 12px}.back-home[hidden],.operation[hidden]{display:none}#mode-message{font-size:12px;margin-top:8px} @media(max-width:650px){.phase-fields{grid-template-columns:1fr}main{padding:0 12px 24px}.toolbar{padding:10px 12px}.fields{grid-template-columns:1fr}.section{padding:17px}.tabs button{padding:10px 12px}.version{font-size:11px}}
      ${overviewCSS}${quickOverviewCSS}${houseHeatCSS}</style><div class="shell"><header class="toolbar"><button class="menu" aria-label="Seitenleiste umschalten">☰</button><img src="/heizungsmanager-static/heizungsmanager-icon.png" alt="" width="32" height="32"><h1>Heizungsmanager</h1><button type="button" class="reset global-heat-settings">Globale Einstellungen</button><span class="global-heat-feedback" role="status"></span><span class="version">${escapeHTML(this.settings.config.room_name)} · v${escapeHTML(this.settings.version)}</span></header><main><button class="back-home" ${this.tab==='home'?'hidden':''}>‹ Übersicht</button>${['plan','settings'].includes(this.tab)?`<div class="operation"><label class="sr-only" for="room-select">Raum wechseln</label><select id="room-select">${(this.settings.rooms||[]).map(room=>`<option value="${escapeHTML(room.entry_id||'')}" ${room.entry_id===this.entryId?'selected':''} ${room.entry_id?'':'disabled'}>${escapeHTML(room.name)}${room.entry_id?'':' · noch nicht eingerichtet'}</option>`).join('')}</select></div>` : ''}<nav class="tabs" role="tablist" ${['home','global'].includes(this.tab)?'style="display:none"':''}><button role="tab" aria-selected="${this.tab==='plan'}" data-tab="plan" class="${this.tab==='plan'?'active':''}">Heiz-Fahrplan</button><button role="tab" aria-selected="${this.tab==='settings'}" data-tab="settings" class="${this.tab==='settings'?'active':''}">Einstellungen</button></nav><div id="content"></div></main></div>`;
    this.shadowRoot.querySelector('.global-heat-settings').onclick=()=>this.openGlobalHeatSettings();
    this.shadowRoot.querySelector('.back-home').onclick=()=>{if(this._dirty&&!window.confirm('Ungespeicherte Änderungen verwerfen?'))return;this.tab='home';this.render();};
    this.shadowRoot.querySelector('#room-select')?.addEventListener('change',async event=>{
      if(this._dirty && !window.confirm('Ungespeicherte Änderungen verwerfen und Raum wechseln?')) {event.target.value=this.entryId;return;}
      this.selectedEntry=event.target.value;this._loaded=false;this._dirty=false;await this.maybeLoad();
    });
    this.shadowRoot.querySelector('.menu').addEventListener('click',()=>this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true})));
    this.shadowRoot.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
      this.tab=button.dataset.tab;this.render();
    }));
    const content=this.shadowRoot.querySelector('#content');
    if(this.settings.config.room_id==='schlafzimmer'&&!this.settings.config.radiators&&!this.settings.config.heat_pump)this.shadowRoot.querySelector('[data-tab="settings"]').hidden=true;
    if(this.tab==='home') {this.updateOverview();}
    else if(this.tab==='global') this.renderGlobalSettings(content);
    else if(this.tab==='plan') {
      const temperatureOnly=this.settings.config.room_id==='schlafzimmer'&&!this.settings.config.radiators&&!this.settings.config.heat_pump;
      if(temperatureOnly){
        const state=this._hass.states[this.settings.plan_entity],value=state?.attributes?.temperature;
        content.innerHTML=`<section class="section"><h2>Schlafzimmer</h2><p style="font-size:44px;margin:20px 0">${Number.isFinite(value)?value.toLocaleString('de-DE',{maximumFractionDigits:1})+' °C':'—'}</p><p>Nur Temperaturanzeige · kein Heizplan und keine Heizungssteuerung.</p><small>${escapeHTML(this.settings.config.temperature_sensor)}</small></section>`;
        return;
      }
      const card=document.createElement('heizungsmanager-card');
      card.setConfig({entity:this.settings.plan_entity || 'sensor.heizungsmanager_wz_fahrplan',mode_entity:this.settings.mode_entity});
      card.hass=this._hass; content.append(card);
    } else {
      const mode=this._hass.states[this.settings.mode_entity]?.state || this.settings.mode;
      content.innerHTML=`<p class="intro">Alle Einstellungen werden lokal in Home Assistant gespeichert.</p><section class="section operation"><label for="operation-mode">Betriebsart</label><select id="operation-mode">${['Beobachten','Automatik','Aus'].map(v=>`<option ${mode===v?'selected':''}>${v}</option>`).join('')}</select><div id="mode-message">Beobachten sendet keine Heizbefehle. Automatik übernimmt die Regler. Aus schaltet beide aus.</div></section><form><div class="notice">Die gewählte Betriebsart bleibt beim Speichern und nach HA-Neustarts erhalten. In Automatik werden gespeicherte Änderungen direkt für die Regelung verwendet.</div>${SETTINGS.map(group=>group.phaseLayout?'<section class="section phase-editor"></section>':`<section class="section"><h2>${escapeHTML(group.title)}</h2><p class="intro">${escapeHTML(group.description)}</p><div class="fields">${group.fields.map(field=>this.field(field)).join('')}</div></section>`).join('')}<section class="section"><h2>Lokales Lernen und Planung</h2><div class="readonly">Berechnung alle <strong>30 Sekunden</strong>, Fahrplan über <strong>24 Stunden</strong> mit <strong>10-Minuten-Schritten</strong>.<br>Wärmeverlust sowie Heizbeiträge von Midea und Heizkörpern werden aus geeigneten getrennten Betriebsphasen gelernt. Gemeinsame Phasen werden nicht zur Trennung der Heizbeiträge verwendet.<br>Nach einem HA-Neustart wird die zuletzt gewählte Betriebsart wiederhergestellt. Wetterabruf ggf. online; Planung und Lernen lokal.<br>Kein zusätzlicher Frostschutz im Modus Aus. Bestehende VTherm-Schutzfunktionen bleiben geräteseitig bestehen.</div></section><div class="actions"><button class="save" type="submit">Einstellungen speichern</button><button class="reset" type="button">Änderungen verwerfen</button><span class="feedback" role="status">${this._dirty?'Ungespeicherte Änderungen':''}</span></div></form>`;
      const form=content.querySelector('form');
      const bindPhases=()=>mountPhases(form.querySelector('.phase-editor'),this.draft,this.settings.config,(group,edited=true)=>{
        this._phaseGroup=group;
        if(edited){
          this._dirty=Object.keys(this.draft).some(key=>this.draft[key]!==this.settings.config[key]);
          form.querySelector('.feedback').textContent=this._dirty?'Ungespeicherte Änderungen':'';
        }
      },this._phaseGroup);
      bindPhases();
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
      form.addEventListener('change',event=>{if(['heat_pump','radiators'].includes(event.target.name))bindPhases();});
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        if(await this.save(form))bindPhases();
      });
      content.querySelector('.reset').addEventListener('click',()=>{this.draft={...this.settings.config};this._dirty=false;this.render();});
      const devices=document.createElement('heizungsmanager-card');devices.setConfig({entity:this.settings.plan_entity,controlsOnly:true});devices.hass=this._hass;content.append(devices);
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
    if(button.disabled)return;
    const error=phaseError(this.draft);
    if(error){feedback.classList.add('error');feedback.textContent=error;return;}
    button.disabled=true;feedback.classList.remove('error');feedback.textContent='Wird gespeichert …';
    const config={...this.draft};
    for(const key of Object.keys(config)) if(key.endsWith('_start') && typeof config[key]==='string' && config[key].length===5) config[key]+=':00';
    try {
      const result=await this._hass.callWS({type:'heizungsmanager/save_config',entry_id:this.entryId,config});
      this.settings.config={...config};this.settings.mode=result.mode;this.draft={...config};this._dirty=false;
      this.shadowRoot.querySelector('#operation-mode').value=result.mode;
      feedback.textContent=`Gespeichert. Betriebsart ${result.mode} bleibt aktiv.`;
      return true;
    } catch(err) {feedback.classList.add('error');feedback.textContent=err.message || String(err);}
    finally {button.disabled=false;}
  }
}
if(!customElements.get('heizungsmanager-panel')) customElements.define('heizungsmanager-panel',HeizungsmanagerPanel);
