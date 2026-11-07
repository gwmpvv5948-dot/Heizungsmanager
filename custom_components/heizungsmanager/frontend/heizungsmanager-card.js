import {roomView,deviceControls,roomCSS} from './room-view.js?v=0.3.15';
import {consumptionRows,dayStart} from './consumption.js?v=0.3.15';
import {equipmentStatus,modeLabel,swingLabel} from './equipment.js?v=0.3.15';
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
    if (!this.shadowRoot.activeElement?.matches('input,select') && (hass.states[this.config?.entity] !== old || signature!==this._equipmentSignature || !this.shadowRoot.firstChild)) {
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
    const a=state.attributes,cfg=a.config||{},equipment=equipmentStatus(this._hass.states,cfg),zone=this._hass.config?.time_zone||'Europe/Berlin';
    const energy=consumptionRows(this._hass.states,cfg,this._energyHistory,new Date(),zone);
    const temperature=this.quickDraft??a.override?.temperature??a.target??21,duration=this.quickDuration??'2h';
    const opened=[...this.shadowRoot.querySelectorAll('details[open]')].map(d=>d.querySelector('summary')?.textContent);
    this.shadowRoot.innerHTML=this.config.controlsOnly?`<style>${roomCSS}</style>${deviceControls(equipment,this._equipmentPending,this._equipmentMessages)}`:roomView({a,cfg,equipment,energy,temperature,duration,message:this.quickMessage,zone,modeEntity:this.config.mode_entity,narrow:window.matchMedia('(max-width:650px)').matches});
    this.shadowRoot.querySelectorAll('details').forEach(d=>{d.open=opened.includes(d.querySelector('summary')?.textContent);});
    this.shadowRoot.querySelectorAll('[data-duration]').forEach(button=>button.onclick=()=>{
      this.quickDuration=button.dataset.duration;
      this.shadowRoot.querySelector('#quick-duration').value=this.quickDuration;
      this.shadowRoot.querySelectorAll('[data-duration]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    });
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
          this.quickDraft=button.dataset.quickAction==='clear'?null:Number(temperatureInput.value);
        } catch(error) {this.quickMessage=error.message || String(error);}
        finally {this.render();}
      }));
    }
  }
}
if (!customElements.get('heizungsmanager-card')) customElements.define('heizungsmanager-card', HeizungsmanagerCard);
window.customCards = window.customCards || [];
window.customCards.push({type:'heizungsmanager-card',name:'Heizungsmanager · 24h',description:'Lokaler Heiz-Fahrplan mit vier Phasen je Raum und Lernstand'});
