"""Persistent estimated house meter, based on one dated physical reading."""
import asyncio
import math
from datetime import datetime, timezone
from homeassistant.helpers.storage import Store
from .const import DOMAIN


def kwh(state):
    if state is None or state.attributes.get('restored'):
        return None
    try:
        value=float(state.state)
        scale={'Wh':.001,'kWh':1,'MWh':1000}.get(state.attributes.get('unit_of_measurement'))
        return value*scale if scale and math.isfinite(value) and value>=0 else None
    except (TypeError,ValueError):
        return None


def advance(previous, records, current, begin, end, source):
    """Checkpoint deltas, handling counter resets without adding lifetime totals."""
    result=dict(previous or {})
    total=result.get('added',0.)
    same=result.get('source')==source
    last=result.get('last') if same else None
    partial=result.get('partial',False)
    rows=sorted([(s.last_updated.timestamp(),kwh(s)) for s in records if s.last_updated.timestamp()<=end],key=lambda p:p[0])
    if last is None:
        seed=[v for t,v in rows if t<=begin]
        last=seed[-1] if seed else None
        if last is None:
            partial=True
    for stamp,value in [*(p for p in rows if p[0]>begin),(end,kwh(current))]:
        if value is None:
            partial=True
            continue
        if last is not None:
            total+=max(0,value-last) if value>=last else value
        last=value
    return {'source':source,'last':last,'added':total,'until':end,'partial':partial}


class HouseHeat:
    def __init__(self,hass):
        self.hass=hass
        self.store=Store(hass,1,f'{DOMAIN}.house_heat')
        self.lock=asyncio.Lock()
        self.loaded=False
        self.data={}
        self.attempted=None
        self.error=None

    async def initialize(self):
        async with self.lock:
            if not self.loaded:
                self.data=await self.store.async_load() or {}
                self.loaded=True

    async def configure(self,base,stamp):
        now=datetime.now(timezone.utc).timestamp()
        if type(base) not in (int,float) or not math.isfinite(base) or not 0<=base<=1e9:
            raise ValueError('Startwert in kWh muss zwischen 0 und 1.000.000.000 liegen')
        if type(stamp) not in (int,float) or not math.isfinite(stamp) or not 0<stamp<=now:
            raise ValueError('Gültigen Ablesezeitpunkt in der Vergangenheit wählen')
        async with self.lock:
            self.data={'base_kwh':base,'start':stamp,'rooms':{}}
            self.attempted=None
            await self.store.async_save(self.data)
        await self.async_refresh()

    async def async_refresh(self,_event=None):
        if self.lock.locked() or self.data.get('start') is None:
            return
        now=datetime.now(timezone.utc).timestamp()
        if self.attempted is not None and now-self.attempted<60:
            return
        async with self.lock:
            self.attempted=now
            sources={}
            for item in self.hass.data.get(DOMAIN,{}).values():
                c=getattr(item,'config',{})
                if c.get('radiators') and c.get('radiator_energy_sensor'):
                    sources[item.entry.entry_id]={'id':c['radiator_energy_sensor'],'name':c.get('room_name',c.get('room_id','Raum'))}
            if not sources:
                self.error='Keine Heizkörper-Energiequellen eingerichtet'
                return
            # Shared counters are included only once. Keep old contributions on
            # source/room changes; start the new source at the last checkpoint.
            unique={};used=set()
            for room,source in sources.items():
                if source['id'] not in used:
                    unique[room]=source;used.add(source['id'])
            begin=min(self.data.get('rooms',{}).get(room,{}).get('until',self.data['start']) for room in unique)
            try:
                from homeassistant.components.recorder import get_instance,history
                current={room:self.hass.states.get(source['id']) for room,source in unique.items()}
                def query():
                    return history.get_significant_states(self.hass,datetime.fromtimestamp(begin,timezone.utc),datetime.fromtimestamp(now,timezone.utc),list(used),include_start_time_state=True,significant_changes_only=False,minimal_response=False,no_attributes=False)
                records=await get_instance(self.hass).async_add_executor_job(query)
                progress=dict(self.data.get('rooms',{}))
                for room,source in unique.items():
                    old=progress.get(room,{})
                    progress[room]=advance(old,records.get(source['id'],[]),current[room],old.get('until',self.data['start']),now,source['id'])|{'name':source['name']}
                self.data['rooms']=progress
                self.data['updated']=now
                self.error=None
                await self.store.async_save(self.data)
            except Exception:
                self.error='Fortschreibung wartet auf HA-Messdaten'

    def status(self):
        configured=self.data.get('start') is not None
        rooms=self.data.get('rooms',{})
        added=sum(r.get('added',0) for r in rooms.values())
        return {'configured':configured,'base_kwh':self.data.get('base_kwh'),'start':self.data.get('start'),
            'added_kwh':added,'total_kwh':self.data['base_kwh']+added if configured else None,
            'updated':self.data.get('updated'),'incomplete':configured and (not rooms or any(r.get('partial') for r in rooms.values()) or self.error is not None),
            'note':self.error or ('Historie teilweise unvollständig' if any(r.get('partial') for r in rooms.values()) else None)}


async def get_house_heat(hass):
    data=hass.data.setdefault(DOMAIN,{})
    if 'house_heat' not in data:
        data['house_heat']=HouseHeat(hass)
    meter=data['house_heat']
    await meter.initialize()
    return meter
