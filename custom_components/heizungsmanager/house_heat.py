"""Persistent estimated house meter, based on one dated physical reading."""
import asyncio
import math
from collections import defaultdict
from statistics import mean
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from homeassistant.helpers.storage import Store
from .const import DOMAIN
from .heat_forecast import validated_model


def kwh(state):
    if state is None or state.attributes.get('restored'):
        return None
    try:
        value=float(state.state)
        scale={'Wh':.001,'kWh':1,'MWh':1000}.get(state.attributes.get('unit_of_measurement'))
        return value*scale if scale and math.isfinite(value) and value>=0 else None
    except (TypeError,ValueError):
        return None


def advance(previous, records, current, begin, end, source, on_delta=None):
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
            delta = value - last if value >= last else value
            total += delta
            if on_delta is not None:
                on_delta(stamp, delta)
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
        self.owner_entry_id=None

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
            self.data={'outdoor_hours':self.data.get('outdoor_hours',{}),'daily_usage':self.data.get('daily_usage',{}),'year_baseline':self.data.get('year_baseline'),'daily_extra_kwh':self.data.get('daily_extra_kwh'),'base_kwh':base,'start':stamp,'rooms':{}}
            self.attempted=None
            await self.store.async_save(self.data)
        await self.async_refresh()

    async def record_reading(self, value):
        if not math.isfinite(value) or not 0 <= value <= 1e9:
            raise ValueError('Zählerstand muss zwischen 0 und 1.000.000.000 kWh liegen')
        await self.async_refresh(force=True)
        async with self.lock:
            previous = self.status()
            base = previous['base_kwh']
            if base is not None and value < base:
                raise ValueError('Die Ablesung liegt unter dem bisherigen Startwert')
            measured = value - base if base is not None else 0
            stamp = datetime.now(timezone.utc).timestamp()
            daily_extra = self.data.get('daily_extra_kwh')
            if previous['configured'] and not previous['incomplete']:
                days = (stamp - previous['start']) / 86400
                if days >= 1:
                    observed_extra = max(0, measured - previous['radiator_kwh']) / days
                    daily_extra = observed_extra if daily_extra is None else .7 * daily_extra + .3 * observed_extra
            comparison = None
            if measured > 0 and previous['configured'] and not previous['incomplete']:
                comparison = 100 * (previous['added_kwh'] / measured - 1)
            reading = {
                'base_kwh': value, 'start': stamp, 'daily_extra_kwh': daily_extra,
                'rooms': {}, 'comparison_percent': comparison,
                'year_baseline': self.data.get('year_baseline'),
                'outdoor_hours': self.data.get('outdoor_hours', {}),
                'daily_usage': self.data.get('daily_usage', {}),
            }
            await self.store.async_save(reading)
            self.data = reading
            self.attempted = None
            self.error = None
        await self.async_refresh()
        return self.status()

    async def set_base(self,value):
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=1e9:
            raise ValueError('Startwert in kWh muss zwischen 0 und 1.000.000.000 liegen')
        async with self.lock:
            self.data={'outdoor_hours':self.data.get('outdoor_hours',{}),'daily_usage':self.data.get('daily_usage',{}),'year_baseline':self.data.get('year_baseline'),'daily_extra_kwh':self.data.get('daily_extra_kwh'),'base_kwh':value,'start':self.data.get('start'),'rooms':{}}
            self.attempted=None
            await self.store.async_save(self.data)
        await self.async_refresh()

    async def set_start(self,value):
        if value.tzinfo is None:
            raise ValueError('Ablesezeitpunkt muss eine Zeitzone enthalten')
        stamp=value.timestamp()
        if not 0<stamp<=datetime.now(timezone.utc).timestamp():
            raise ValueError('Ablesezeitpunkt muss in der Vergangenheit liegen')
        async with self.lock:
            self.data={'outdoor_hours':self.data.get('outdoor_hours',{}),'daily_usage':self.data.get('daily_usage',{}),'year_baseline':self.data.get('year_baseline'),'daily_extra_kwh':self.data.get('daily_extra_kwh'),'base_kwh':self.data.get('base_kwh'),'start':stamp,'rooms':{}}
            self.attempted=None
            await self.store.async_save(self.data)
        await self.async_refresh()

    async def async_refresh(self,_event=None,*,force=False):
        if self.lock.locked() or (self.data.get('start') is None or self.data.get('base_kwh') is None):
            return
        now=datetime.now(timezone.utc).timestamp()
        if not force and self.attempted is not None and now-self.attempted<60:
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
                progress = dict(self.data.get('rooms', {}))
                daily = {day: dict(row) for day, row in self.data.get('daily_usage', {}).items()}
                zone = self.local_zone()
                interval_start = max(self.data['start'], self.data.get('updated', self.data['start']))
                partial = any(room.get('partial') for room in progress.values())

                def day_row(stamp):
                    day = datetime.fromtimestamp(stamp, zone).date().isoformat()
                    return daily.setdefault(day, {'kwh': 0.0, 'seconds': 0, 'partial': False})

                def add_radiator(stamp, delta):
                    if stamp >= interval_start:
                        day_row(stamp)['kwh'] += delta

                for room,source in unique.items():
                    old=progress.get(room,{})
                    progress[room]=advance(old,records.get(source['id'],[]),current[room],old.get('until',self.data['start']),now,source['id'],add_radiator)|{'name':source['name']}
                partial = partial or any(room.get('partial') for room in progress.values())
                cursor = interval_start
                while cursor < now:
                    date = datetime.fromtimestamp(cursor, zone).date()
                    midnight = datetime.combine(date + timedelta(days=1), time.min, zone).timestamp()
                    duration = min(midnight, now) - cursor
                    row = day_row(cursor)
                    row['kwh'] += (self.data.get('daily_extra_kwh') or 0) * duration / 86400
                    row['seconds'] += duration
                    row['partial'] |= partial
                    cursor += duration
                temperatures = self.record_temperature(now)
                data = {**self.data, 'rooms': progress, 'updated': now, 'daily_usage': daily, 'outdoor_hours': temperatures}
                await self.store.async_save(data)
                self.data = data
                self.error = None
            except Exception:
                self.error='Fortschreibung wartet auf HA-Messdaten'

    def local_zone(self):
        zone = getattr(getattr(self.hass, 'config', None), 'time_zone', 'UTC')
        return ZoneInfo(zone)

    def calendar_year(self):
        return datetime.now(self.local_zone()).year

    async def set_year_baseline(self, value, year):
        if not math.isfinite(value) or not 0 <= value <= 1e9:
            raise ValueError('Ungültiger Zählerstand für den 1. Januar')
        async with self.lock:
            if year != self.calendar_year():
                raise ValueError('Das Kalenderjahr hat gewechselt. Einstellungen erneut öffnen.')
            data = {**self.data, 'year_baseline': {'year': year, 'kwh': value}}
            await self.store.async_save(data)
            self.data = data
        return self.status()

    def weather_controller(self):
        return next((item for item in self.hass.data.get(DOMAIN, {}).values()
                     if getattr(item, 'config', {}).get('weather')), None)

    def record_temperature(self, now):
        controller = self.weather_controller()
        previous = self.data.get('outdoor_hours', {})
        hour = int(now // 3600)
        samples = {key: value for key, value in previous.items()
                   if int(key) >= hour - 2 * 366 * 24}
        weather = self.hass.states.get(controller.config['weather']) if controller else None
        if weather is None or weather.state in ('unknown', 'unavailable'):
            return samples
        try:
            value = float(weather.attributes.get('temperature'))
        except (TypeError, ValueError):
            return samples
        if weather.attributes.get('temperature_unit') == '°F':
            value = (value - 32) * 5 / 9
        if -30 <= value <= 45 and now - weather.last_updated.timestamp() <= 10800:
            samples[str(hour)] = value
        return samples

    def temperature_forecast(self, daily_usage, as_of, next_year, fallback):
        zone = as_of.tzinfo
        hourly = defaultdict(list)
        for hour, temperature in self.data.get('outdoor_hours', {}).items():
            day = datetime.fromtimestamp(int(hour) * 3600, zone).date()
            hourly[day].append(temperature)
        temperatures = {day: mean(values) for day, values in hourly.items() if len(values) >= 20}
        samples = []
        for row in daily_usage:
            day = datetime.fromisoformat(row['date']).date()
            if day < as_of.date() and not row['partial'] and day in temperatures:
                samples.append((day, temperatures[day], row['kwh']))
        model = validated_model(samples)
        if model is None:
            return None, 0

        controller = self.weather_controller()
        forecast_hours = defaultdict(list)
        updated = getattr(controller, 'forecast_updated', None)
        if updated and 0 <= datetime.now(timezone.utc).timestamp() - updated < 7200:
            for stamp, temperature in controller.forecast:
                if stamp >= as_of.timestamp():
                    forecast_hours[datetime.fromtimestamp(stamp, zone).date()].append(temperature)

        remainder = 0
        model_days = 0
        cursor = as_of
        while cursor < next_year:
            day = cursor.date()
            end = datetime.combine(day + timedelta(days=1), time.min, zone)
            hours = (end.timestamp() - cursor.timestamp()) / 3600
            forecast = forecast_hours[day]
            seasonal = [value for date, value in temperatures.items()
                        if date < as_of.date() and date.year < day.year
                        and abs((date.replace(year=2000) - day.replace(year=2000)).days) <= 14]
            if forecast and len(forecast) >= max(1, hours - 2):
                rate = model(mean(forecast))
                model_days += 1
            elif len(seasonal) >= 7:
                rate = mean(model(value) for value in seasonal)
                model_days += 1
            else:
                rate = fallback
            remainder += hours / 24 * rate
            cursor = end
        return remainder, model_days

    def status(self):
        configured=self.data.get('start') is not None and self.data.get('base_kwh') is not None
        rooms=self.data.get('rooms',{})
        radiator_kwh = sum(r.get('added', 0) for r in rooms.values())
        daily_extra = self.data.get('daily_extra_kwh')
        elapsed_days = max(0, datetime.now(timezone.utc).timestamp() - self.data['start']) / 86400 if configured else 0
        added = radiator_kwh + (daily_extra or 0) * elapsed_days
        total = self.data['base_kwh'] + added if configured else None
        year = self.calendar_year()
        baseline = self.data.get('year_baseline') or {}
        january = baseline.get('kwh') if baseline.get('year') == year else None
        year_kwh = total - january if total is not None and january is not None and total >= january else None
        zone = self.local_zone()
        today = datetime.now(zone).date()
        daily_usage = []
        for key, row in sorted(self.data.get('daily_usage', {}).items()):
            date = datetime.fromisoformat(key).date()
            start = datetime.combine(date, time.min, zone).timestamp()
            end = datetime.combine(date + timedelta(days=1), time.min, zone).timestamp()
            daily_usage.append({'date': key, 'kwh': row['kwh'],
                                'partial': row['partial'] or row['seconds'] < min(end, datetime.now(zone).timestamp()) - start - 60,
                                'today': date == today})
        by_date = {row['date']: row for row in daily_usage}
        coverage = []
        for offset in range(14, 0, -1):
            day = (today - timedelta(days=offset)).isoformat()
            row = by_date.get(day)
            coverage.append({'date': day, 'state': 'missing' if row is None else 'partial' if row['partial'] else 'full'})
        recent = [row['kwh'] for row in daily_usage
                  if not row['partial'] and today - timedelta(days=14) <= datetime.fromisoformat(row['date']).date() < today]
        incomplete = configured and (not rooms or any(r.get('partial') for r in rooms.values()) or self.error is not None)
        forecast = None
        model_days = 0
        updated = self.data.get('updated')
        average = mean(recent) if recent else None
        days_left = december_days = None
        if year_kwh is not None and recent and updated is not None and not incomplete:
            as_of = datetime.fromtimestamp(updated, zone)
            if as_of.date() == today:
                next_year = datetime(year + 1, 1, 1, tzinfo=zone)
                days_left = max(0, next_year.timestamp() - updated) / 86400
                december = datetime(year, 12, 1, tzinfo=zone)
                december_days = (next_year.timestamp() - max(updated, december.timestamp())) / 86400 if today.month < 12 else 0
                remainder, model_days = self.temperature_forecast(daily_usage, as_of, next_year, average) if len(recent) >= 7 else (None, 0)
                forecast = year_kwh + (remainder if model_days else average * (days_left + .10 * december_days))
        strong = bool(model_days and model_days >= math.ceil(days_left))
        spread = .20 if strong else .40
        remaining = forecast - year_kwh if forecast is not None else None
        return {'forecast_coverage': coverage, 'forecast_average': average, 'forecast_days_left': days_left,
                'forecast_december_days': december_days, 'forecast_strong': strong,
                'forecast_low': forecast - spread * remaining if remaining is not None else None,
                'forecast_high': forecast + spread * remaining if remaining is not None else None,
                'year_forecast_model_days': model_days, 'year_forecast_kwh': forecast, 'daily_usage':daily_usage, 'year':year, 'january_kwh':january, 'year_kwh':year_kwh, 'configured':configured,'base_kwh':self.data.get('base_kwh'),'start':self.data.get('start'),
            'daily_extra_kwh':daily_extra, 'radiator_kwh':radiator_kwh, 'comparison_percent':self.data.get('comparison_percent'), 'added_kwh':added,'total_kwh':total,
            'updated':self.data.get('updated'),'incomplete':incomplete,
            'note':self.error or ('Historie teilweise unvollständig' if any(r.get('partial') for r in rooms.values()) else None)}


async def get_house_heat(hass):
    data=hass.data.setdefault(DOMAIN,{})
    if 'house_heat' not in data:
        data['house_heat']=HouseHeat(hass)
    meter=data['house_heat']
    await meter.initialize()
    return meter
