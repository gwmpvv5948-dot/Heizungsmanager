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


PHASES = (("morning", "Morgens"), ("day", "Tag"), ("evening", "Abend"), ("night", "Nacht"))
SOURCES = {"both": "Midea + Heizkörper", "heat_pump": "Midea", "radiators": "Heizkörper", "off": "Keine Wärmequelle"}
ROOMS = {"wohnzimmer": "Wohnzimmer", "arbeitszimmer": "Arbeitszimmer", "alwin": "Alwin", "carla": "Carla", "flur": "Flur"}


def normalize_config(config):
    """Migrate the old two-temperature plan without changing its saved inputs."""
    result = dict(config)
    room = result.setdefault("room_id", "wohnzimmer")
    result["room_name"] = ROOMS.get(room, room)
    for kind, old in (("weekday", "weekday_start"), ("weekend", "weekend_start")):
        start = time.fromisoformat(config.get(old, "06:20:00" if kind == "weekday" else "08:00:00"))
        night = time.fromisoformat(config.get("night_start", "22:00:00"))
        morning_min = start.hour * 60 + start.minute
        night_min = night.hour * 60 + night.minute
        support = max(1, min(int(config.get("morning_support_minutes", 45)), max(1, (night_min - morning_min) // 3)))
        day_min = morning_min + support
        evening_min = 17 * 60 if day_min < 17 * 60 < night_min else (day_min + night_min) // 2
        clocks = [morning_min, day_min, evening_min, night_min]
        for (phase, _), minutes in zip(PHASES, clocks):
            prefix = f"{kind}_{phase}_"
            result.setdefault(prefix + "start", f"{minutes // 60:02}:{minutes % 60:02}:00")
            result.setdefault(prefix + "temperature", config.get("night_temperature", 18) if phase == "night" else config.get("comfort_temperature", 21))
            result.setdefault(prefix + "sources", "both" if phase == "morning" else "heat_pump")
    return result


def phase_at(now, config):
    config = normalize_config(config)
    # The night phase continues from the PREVIOUS day until today's morning.
    candidates = []
    for offset in (-1, 0):
        day = now + timedelta(days=offset)
        kind = "weekend" if day.weekday() >= 5 else "weekday"
        for key, label in PHASES:
            prefix = f"{kind}_{key}_"
            start = local_at(day.date(), config[prefix + "start"], now.tzinfo)
            if start.timestamp() <= now.timestamp():
                candidates.append((start.timestamp(), key, label, config[prefix + "temperature"], config[prefix + "sources"]))
    return max(candidates, key=lambda row: row[0])


def outdoor_at(when, current, forecast):
    candidates = [point for point in forecast if point[0] <= when.timestamp()]
    if candidates:
        point = max(candidates, key=lambda x: x[0])
        if when.timestamp() - point[0] <= 5400:
            return point[1], "Wettervorhersage"
    if current is not None:
        return current, "Aktuelle Außentemperatur fortgeschrieben"
    return 5.0, "Annahme 5 °C – Wetter fehlt"


def decision(now, temp, outside, config, model):
    _, key, label, target, sources = phase_at(now, config)
    return target, label, sources in ("both", "radiators"), f"{label}: {target:.1f} °C · {SOURCES[sources]}"


def night_reheat(temp, target, active, hysteresis):
    """Start strictly below the floor; finish at the upper hysteresis boundary."""
    return temp < target + hysteresis if active else temp < target


def next_schedule_time(now, config):
    config = normalize_config(config)
    boundaries = []
    for days in range(3):
        day = now + timedelta(days=days)
        kind = "weekend" if day.weekday() >= 5 else "weekday"
        for key, _ in PHASES:
            point = local_at(day.date(), config[f"{kind}_{key}_start"], now.tzinfo)
            if point.timestamp() > now.timestamp():
                boundaries.append(point.timestamp())
    return min(boundaries)


def cycle_guard(now, requested, active, since, config, temperature, target):
    """Protect manager HVAC mode changes, not the device's internal compressor."""
    if active and temperature >= target + config.get("pump_overheat_margin", 0.5):
        return False, "Übertemperatur: Mindestlaufzeit aufgehoben", 0
    if requested == active:
        return requested, "", 0
    minutes = config.get("pump_min_on_minutes" if active else "pump_min_off_minutes", 15)
    remaining = max(0, since + minutes * 60 - now)
    if remaining > 0:
        label = "Mindestlaufzeit" if active else "Mindestpause"
        return active, label, math.ceil(remaining)
    return requested, "", 0


def make_plan(now, temp, current_outside, forecast, config, model, pump_heat_active=False, override=None,
              pump_state=None, pump_state_since=None):
    config = normalize_config(config)
    rows = []
    predicted = temp
    active = pump_heat_active if pump_state is None else pump_state
    since = now.timestamp() - 86400 if pump_state_since is None else pump_state_since
    # Include exact phase/override boundaries in addition to the 10-minute grid.
    horizon = now.timestamp() + 86400
    stamps = {now.timestamp() + step * 600 for step in range(145)}
    cursor = now
    while True:
        boundary = next_schedule_time(cursor, config)
        if boundary > horizon:
            break
        stamps.add(boundary)
        cursor = datetime.fromtimestamp(boundary, now.tzinfo)
    if override and now.timestamp() < override["until"] < horizon:
        stamps.add(override["until"])
    ordered = sorted(stamps)
    for index, stamp in enumerate(ordered):
        when = datetime.fromtimestamp(stamp, now.tzinfo)
        outside, source = outdoor_at(when, current_outside, forecast)
        target, phase, support, reason = decision(when, predicted, outside, config, model)
        _, phase_key, _, _, sources = phase_at(when, config)
        scheduled_target = target
        override_active = bool(override and when.timestamp() < override["until"])
        if override_active:
            target = override["temperature"]
            phase = "Temporär"
            reason = f"Temporäre Wunschtemperatur {target:.1f} °C; anschließend automatisch zurück zum Zeitplan"
        enabled = True
        control_target = target
        if phase_key == "night" and not override_active:
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
        if sources not in ("both", "heat_pump"):
            reason = f"{phase}: {target:.1f} °C · {SOURCES[sources]}; Midea nicht freigegeben"
        requested = enabled and sources in ("both", "heat_pump")
        enabled, protection, remaining = cycle_guard(
            when.timestamp(), requested, active, since, config, predicted, target)
        if sources not in ("both", "heat_pump"):
            enabled, protection, remaining = False, "", 0
        if protection:
            reason += f" · Taktschutz: {protection}"
            if remaining:
                reason += f" noch {math.ceil(remaining / 60)} Minuten"
        if enabled != active:
            since = when.timestamp()
            active = enabled
        pump_heat_active = enabled
        # Radiators also stop when the target is reached, in every phase.
        rad = 1.0 if sources in ("both", "radiators") and predicted < target - 0.15 else 0.0
        required = (control_target - predicted) * 3 + model.loss * (predicted - outside) - model.radiator_gain * rad
        pump = max(0.0, min(1.0, required / model.pump_gain)) if enabled else 0.0
        rows.append({"time": when.isoformat(), "target": target, "temperature": round(predicted, 2),
                     "scheduled_target": scheduled_target, "override_active": override_active,
                     "outdoor": round(outside, 1), "weather_source": source,
                     "phase": phase, "phase_key": phase_key, "sources": sources,
                     "radiators": bool(rad), "heat_pump": enabled,
                     "control_target": round(control_target, 2),
                     "cycle_protection": protection, "cycle_remaining_seconds": remaining,
                     "requested_heat_pump": requested,
                     "pump_demand_estimate": round(pump, 2), "reason": reason})
        hours = (ordered[index + 1] - stamp) / 3600 if index + 1 < len(ordered) else 0
        predicted += model.rate(predicted, outside, pump, rad) * hours
    return rows
