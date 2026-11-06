import {powerWatts} from './consumption.js?v=0.3.11';
/* Equipment snapshots; controls are handled by the card. No inferred valve positions. */
export const modeLabel = value => ({heat:'Heizen',cool:'Kühlen',heat_cool:'Heizen/Kühlen',auto:'Automatik',off:'Aus',fan_only:'Nur Lüfter',dry:'Entfeuchten',sleep:'Schlafen',heating:'Heizt',cooling:'Kühlt',idle:'Bereit',fan:'Lüfter läuft',drying:'Entfeuchtet',defrosting:'Abtauen',auto_fan_low:'Automatisch · niedrig',auto_fan_medium:'Automatisch · mittel',auto_fan_high:'Automatisch · hoch',low:'Niedrig',medium:'Mittel',high:'Hoch',silent:'Leise',turbo:'Turbo'})[value] || (value == null || value === '' ? 'Nicht gemeldet' : String(value));
export const swingLabel = value => ({off:'Aus',vertical:'Vertikal',horizontal:'Horizontal',both:'Vertikal + horizontal',on:'Ein'})[value] || (value == null || value === '' ? 'Nicht gemeldet' : String(value));
const available = state => Boolean(state && !['unknown','unavailable'].includes(state.state));
const attribute = (state,key) => available(state) ? state.attributes?.[key] : null;
const percent = state => {
  if(!available(state) || String(state.state).trim()==='')return null;
  const value=Number(state.state);
  return Number.isFinite(value) && value>=0 && value<=100 ? value : null;
};
function underlying(state) {
  const list=state?.attributes?.vtherm_over_climate?.underlying_entities || state?.attributes?.underlying_entities;
  return Array.isArray(list) ? [...new Set(list.filter(id=>typeof id==='string' && id.startsWith('climate.')))] : [];
}
function status(state) {
  return {available:available(state),mode:available(state)?modeLabel(state.state):'Nicht verfügbar',action:modeLabel(attribute(state,'hvac_action')),target:available(state) && Number.isFinite(state.attributes?.temperature)?state.attributes.temperature:null};
}
export function equipmentStatus(states, config) {
  const tiles=[];
  if(config.radiators) {
    const controller=states[config.radiators];
    const devices=underlying(controller);
    for(const id of devices.length?devices:[config.radiators]) {
      const device=states[id];
      const base=id.slice('climate.'.length);
      const valveEntity=`number.${base}_valve_closing_degree`;
      tiles.push({kind:'radiator',id,name:device?.attributes?.friendly_name || (devices.length?'Heizkörper':'Heizkörper-Regler'),...status(device),controllerMode:available(controller)?modeLabel(controller.state):'Nicht verfügbar',valveEntity,valveClosing:percent(states[valveEntity]),valveAvailable:available(states[valveEntity])});
    }
  }
  if(config.heat_pump) {
    const controller=states[config.heat_pump];
    const id=underlying(controller)[0] || config.heat_pump;
    const device=states[id];
    // Never replace an unavailable physical device with apparently healthy wrapper data.
    const fan=attribute(device,'fan_mode') ?? (available(device)?attribute(controller,'fan_mode'):null);
    const fanModes=available(device) && Array.isArray(device.attributes?.fan_modes)?[...new Set(device.attributes.fan_modes.filter(value=>typeof value==='string' && value))]:[];
    const swing=attribute(device,'swing_mode') ?? (available(device)?attribute(controller,'swing_mode'):null);
    const swingModes=available(device) && Array.isArray(device.attributes?.swing_modes)?[...new Set(device.attributes.swing_modes.filter(value=>typeof value==='string' && value))]:[];
    tiles.push({kind:'heat_pump',id,swingModes,swingValue:swing,swing:swingLabel(swing),fanEntity:id,fanModes,fanValue:fan,watts:powerWatts(states[config.power_sensor]),name:'Midea · Klimaanlage',...status(device),controllerMode:available(controller)?modeLabel(controller.state):'Nicht verfügbar',fan:modeLabel(fan)});
  }
  return tiles;
}
