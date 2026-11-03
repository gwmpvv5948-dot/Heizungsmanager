"""Small deterministic thermal model. No Home Assistant or third-party dependency."""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, time


def finite(value, low=-50, high=60):
    try:
        result = float(value)
        return result if math.isfinite(result) and low <= result <= high else None
    except (TypeError, ValueError):
        return None


@dataclass
class ThermalModel:
    loss: float = 0.025
    pump_gain: float = 1.4
    radiator_gain: float = 1.0
    samples: int = 0
    passive_samples: int = 0
    pump_samples: int = 0
    radiator_samples: int = 0
    error: float = 0.0

    @classmethod
    def restore(cls, data):
        model = cls()
        limits = {"loss": (0.005, 0.2), "pump_gain": (0.2, 8),
                  "radiator_gain": (0.2, 8), "error": (0, 20)}
        for key, bounds in limits.items():
            value = finite(data.get(key), *bounds)
            if value is not None:
                setattr(model, key, value)
        for key in ("samples", "passive_samples", "pump_samples", "radiator_samples"):
            value = finite(data.get(key), 0, 10000000)
            if value is not None:
                setattr(model, key, int(value))
        return model

    def dump(self):
        return asdict(self)

    @property
    def quality(self):
        # Coverage, not a statistical confidence interval.
        if min(self.passive_samples, self.pump_samples, self.radiator_samples) < 6:
            return "Startwerte / noch unvollständig gelernt"
        return "An Raumdaten angepasst – weiterhin Schätzung"

    def rate(self, indoor, outdoor, pump, radiators):
        return -self.loss * (indoor - outdoor) + self.pump_gain * pump + self.radiator_gain * radiators

    def learn(self, before, after, outdoor, hours, pump, radiators):
        if not 4 / 60 <= hours <= 20 / 60 or abs(after - before) > 1.5:
            return False
        observed = (after - before) / hours
        if abs(observed) > 6 or not -30 <= outdoor <= 45:
            return False
        error = max(-3, min(3, observed - self.rate(before, outdoor, pump, radiators)))
        # Only isolated phases identify gains; mixed heat cannot separate sources.
        if pump < 0.05 and radiators < 0.05 and before - outdoor > 3:
            self.loss = max(0.005, min(0.2, self.loss - 0.015 * error / (before - outdoor)))
            self.passive_samples += 1
        elif pump > 0.1 and radiators < 0.05:
            self.pump_gain = max(0.2, min(8, self.pump_gain + 0.025 * error * pump))
            self.pump_samples += 1
        elif radiators > 0.1 and pump < 0.05:
            self.radiator_gain = max(0.2, min(8, self.radiator_gain + 0.025 * error * radiators))
            self.radiator_samples += 1
        else:
            return False
        self.samples += 1
        self.error = 0.95 * self.error + 0.05 * abs(error)
        return True


def local_at(day, clock, tz):
    return datetime.combine(day, time.fromisoformat(clock), tzinfo=tz)


def day_schedule(now, config):
    clock = config["weekend_start"] if now.weekday() >= 5 else config["weekday_start"]
    return local_at(now.date(), clock, now.tzinfo), local_at(now.date(), config["night_start"], now.tzinfo)


def outdoor_at(when, current, forecast):
    candidates = [point for point in forecast if point[0] <= when.timestamp()]
    if candidates:
        point = max(candidates, key=lambda x: x[0])
        if when.timestamp() - point[0] <= 5400:
            return point[1], "Wettervorhersage"
    if current is not None:
        return current, "Aktuelle Außentemperatur fortgeschrieben"
    return 5.0, "Annahme 5 °C – Wetter fehlt"


def preheat_minutes(model, temp, outside, config):
    rate = max(0.25, model.rate(temp, outside, 1, 1))
    required = max(0, config["comfort_temperature"] - temp) / rate * 60
    return min(config["max_preheat_minutes"], max(15, math.ceil(required / 5) * 5))


def decision(now, temp, outside, config, model):
    start, end = day_schedule(now, config)
    lead = preheat_minutes(model, temp, outside, config)
    # Also consider tomorrow's preheating crossing midnight.
    tomorrow = now + timedelta(days=1)
    next_start, _ = day_schedule(tomorrow, config)
    next_lead = preheat_minutes(model, temp, outside, config)
    if start - timedelta(minutes=lead) <= now < start:
        return config["comfort_temperature"], "Aufheizen", True, "Morgens gemeinsam auf Komforttemperatur vorheizen"
    if start <= now < end:
        support = now < start + timedelta(minutes=config["morning_support_minutes"]) and temp < config["comfort_temperature"] - 0.2
        return config["comfort_temperature"], "Aufheizen" if support else "Temperatur halten", support, (
            "Heizkörper unterstützen bis Komfort erreicht ist oder das Morgenfenster endet" if support else
            "Midea hält die Komforttemperatur; Heizkörper aus")
    if next_start - timedelta(minutes=next_lead) <= now < next_start:
        return config["comfort_temperature"], "Aufheizen", True, "Vorheizen für den folgenden Morgen"
    return config["night_temperature"], "Nacht", False, "Nachts nur bei Unterschreitung nachheizen; Heizkörper aus"


def night_reheat(temp, target, active, hysteresis):
    """Start strictly below the floor; finish at the upper hysteresis boundary."""
    return temp < target + hysteresis if active else temp < target


def next_schedule_time(now, config):
    boundaries = []
    for days in range(3):
        start, end = day_schedule(now + timedelta(days=days), config)
        boundaries.extend(point.timestamp() for point in (start, end) if point.timestamp() > now.timestamp())
    return min(boundaries)


def make_plan(now, temp, current_outside, forecast, config, model, pump_heat_active=False, override=None):
    rows = []
    predicted = temp
    # Timestamp arithmetic preserves exactly 24 elapsed hours through DST changes.
    for step in range(145):
        when = datetime.fromtimestamp(now.timestamp() + step * 600, now.tzinfo)
        outside, source = outdoor_at(when, current_outside, forecast)
        target, phase, support, reason = decision(when, predicted, outside, config, model)
        scheduled_target = target
        override_active = bool(override and when.timestamp() < override["until"])
        if override_active:
            target = override["temperature"]
            phase = "Temporär"
            reason = f"Temporäre Wunschtemperatur {target:.1f} °C; anschließend automatisch zurück zum Zeitplan"
        enabled = True
        control_target = target
        if phase == "Nacht":
            hysteresis = config.get("night_reheat_hysteresis", 0.3)
            pump_heat_active = night_reheat(predicted, target, pump_heat_active, hysteresis)
            enabled = pump_heat_active
            # A little device headroom lets the external room-based cutoff be reached.
            control_target = target + hysteresis + 0.5 if enabled else target
            reason = (f"Nacht-Nachheizen bis {target + hysteresis:.1f} °C, danach Midea aus" if enabled else
                f"Midea aus; Nachheizen erst unter {target:.1f} °C")
        else:
            # Daytime and quick overrides: no heat command above the room target.
            pump_heat_active = predicted < target if pump_heat_active else predicted < target - 0.2
            enabled = pump_heat_active
            if not enabled:
                reason += f" · Kein Heizbedarf: Midea aus; Start erst unter {target - 0.2:.1f} °C"
        rad = 1.0 if support and predicted < target - 0.15 else 0.0
        required = (control_target - predicted) * 3 + model.loss * (predicted - outside) - model.radiator_gain * rad
        pump = max(0.0, min(1.0, required / model.pump_gain)) if enabled else 0.0
        rows.append({"time": when.isoformat(), "target": target, "temperature": round(predicted, 2),
                     "scheduled_target": scheduled_target, "override_active": override_active,
                     "outdoor": round(outside, 1), "weather_source": source,
                     "phase": phase, "radiators": bool(rad), "heat_pump": enabled,
                     "control_target": round(control_target, 2),
                     "pump_demand_estimate": round(pump, 2), "reason": reason})
        predicted += model.rate(predicted, outside, pump, rad) / 6
    return rows
