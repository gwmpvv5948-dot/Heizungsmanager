"""Optional local Strommanager signal; never permission to switch the heat pump off."""
import math


def number(value):
    return type(value) in (int,float) and math.isfinite(value)


class PVPreference:
    def __init__(self):
        self.filtered=None
        self.last=None
        self.candidate_since=None
        self.preferred=False
        self.since=0

    def update(self, now, surplus, config):
        if config.get('pv_preference_mode','auto')=='off' or not number(surplus):
            self.filtered=self.last=self.candidate_since=None
            self.preferred=False
            return {'available':False,'preferred':False,'reason':'PV-Vorrang ausgeschaltet' if config.get('pv_preference_mode')=='off' else 'PV-Signal fehlt · Temperaturhalten bleibt freigegeben','valid_until':now}
        gap=None if self.last is None else now-self.last
        if gap is None or gap<0 or gap>300:
            self.filtered=max(0,surplus);self.preferred=False;self.candidate_since=None
        else:
            self.filtered+=(1-math.exp(-gap/180))*(max(0,surplus)-self.filtered)
        self.last=now
        want=self.filtered >= config.get('pv_off_w',500) if self.preferred else self.filtered >= config.get('pv_on_w',1000)
        if want==self.preferred:self.candidate_since=None
        else:
            self.candidate_since=now if self.candidate_since is None else self.candidate_since
            confirmed=now-self.candidate_since>=config.get('pv_confirm_minutes',5)*60
            held=not self.preferred or now-self.since>=config.get('pv_hold_minutes',20)*60
            if confirmed and held:
                self.preferred=want;self.since=now;self.candidate_since=None
        return {'available':True,'preferred':self.preferred,'surplus_w':round(surplus),'filtered_w':round(self.filtered),
                'valid_until':now+300,'reason':'PV-Vorrang · Wärmepumpe bevorzugt' if self.preferred else 'PV-Vorrang wartet auf bestätigten Überschuss'}


def strommanager_surplus(hass, now, pump_w):
    controllers=getattr(hass,'data',{}).get('solar_pilot',{}).get('controllers',{})
    sources=[c for c in controllers.values() if getattr(c,'snapshot',None) is not None]
    if len(sources)!=1:return None
    s=sources[0].snapshot;c=sources[0].settings
    if (not all(number(v) for v in (s.now,s.meter_age,s.grid_export_w,s.battery_charge_w,s.pv_w))
            or not 0<=now-s.now<=120 or not 0<=s.meter_age+now-s.now<=c.meter_max_age_s or s.pv_w<0):return None
    # Remove house-battery discharge from apparent PV surplus. Add the heat
    # pump's measured own load back, otherwise starting it removes its permission.
    return max(0,s.grid_export_w+min(0,s.battery_charge_w)+(pump_w if number(pump_w) else 0))
