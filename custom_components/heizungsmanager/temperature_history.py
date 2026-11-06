"""Reconstruct display history from recorder states, without changing control or learning."""
from datetime import datetime, timezone
import math
from .temperature import RoomTemperature


def temperature_history(records, start, end, config):
    keys=('temperature_sensor','secondary_temperature_sensor')
    series=[]
    for key in keys:
        rows=[]
        for state in records.get(config.get(key,''),[]):
            stamp=state.last_updated.timestamp()
            if not math.isfinite(stamp) or stamp>end:
                continue
            try:
                value=float(state.state)
                if not math.isfinite(value) or not 0<=value<=40:
                    value=None
            except (ValueError,TypeError):
                value=None
            if state.attributes.get('unit_of_measurement')!='°C' or state.attributes.get('restored'):
                value=None
            rows.append((stamp,value))
        series.append(sorted(rows,key=lambda r:r[0]))
    if not any(series):
        return []
    # Recorder stores changes, not repeated identical reports. A valid state remains
    # valid until its next recorded change, including explicit unavailable states.
    index=[-1,-1]
    model=RoomTemperature()
    result=[]
    warmup=start-3600
    for tick in range(int(warmup),int(end)+1,30):
        readings=[]
        for i,key in enumerate(keys):
            rows=series[i]
            while index[i]+1<len(rows) and rows[index[i]+1][0]<=tick:
                index[i]+=1
            value=rows[index[i]][1] if index[i]>=0 else None
            readings.append({'entity_id':config.get(key,''),'raw':value,'reason':None if value is not None else 'Keine HA-Messdaten'})
        info=model.update(tick,readings,config)
        if tick>=start and (tick-int(start))%600==0:
            result.append({'timestamp':tick,'time':datetime.fromtimestamp(tick,timezone.utc).isoformat(),'temperature':info['value']})
    return result[-144:]
