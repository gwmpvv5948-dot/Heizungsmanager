"""Import and execute the daily central heating schedule."""
import asyncio
from datetime import time
import logging
import math

from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN

ACTUATOR = "number.wz_stellantrieb"
_LOGGER = logging.getLogger(__name__)
DEFAULT_SLOTS = [
    {"start": "00:00", "stop": "06:00", "value": 0},
    {"start": "06:00", "stop": "09:00", "value": 15},
    {"start": "09:00", "stop": "22:00", "value": 12},
    {"start": "22:00", "stop": "24:00", "value": 4},
]


def read_plan(schedule, actuator):
    if (schedule["weekdays"] != ["daily"] or schedule["repeat_type"] != "repeat"
            or schedule.get("start_date") or schedule.get("end_date")):
        raise ValueError("Der Scheduler-Plan muss täglich und ohne Datumsgrenzen laufen.")
    slots = []
    for slot in schedule["timeslots"]:
        if not slot["actions"]:
            continue
        if slot.get("conditions") or len(slot["actions"]) != 1:
            raise ValueError("Der Zeitplan enthält zusätzliche Aktionen oder Bedingungen.")
        action = slot["actions"][0]
        if action["entity_id"] != ACTUATOR or action["service"] != "number.set_value":
            raise ValueError("Der Zeitplan enthält eine andere Aktion als die Ventilstellung.")
        start, stop = slot["start"], slot["stop"]
        if start == "24:00:00":
            raise ValueError("Ungültige Startzeit.")
        time.fromisoformat(start)
        if stop not in ("24:00", "24:00:00"):
            time.fromisoformat(stop)
        value = float(action["service_data"]["value"])
        if not math.isfinite(value) or not actuator.attributes["min"] <= value <= actuator.attributes["max"]:
            raise ValueError("Eine Ventilstellung liegt außerhalb des Gerätebereichs.")
        slots.append({"start": start, "stop": stop, "value": value})
    if not slots:
        raise ValueError("Der Zeitplan enthält keine Ventilstellungen.")
    return slots


class CentralValve:
    def __init__(self, hass):
        self.hass = hass
        self.store = Store(hass, 1, f"{DOMAIN}.central_valve")
        self.lock = asyncio.Lock()
        self.plan = None

    async def async_load(self):
        self.plan = await self.store.async_load()

    async def async_take_over(self, use_defaults=False):
        async with self.lock:
            if self.plan and self.plan.get("source"):
                return
            actuator = self.hass.states.get(ACTUATOR)
            if not actuator or actuator.state in ("unavailable", "unknown"):
                raise ValueError("Der KNX-Stellantrieb ist nicht verfügbar.")
            from custom_components.scheduler.store import async_get_registry

            registry = await async_get_registry(self.hass)
            schedules = registry.async_get_schedules()
            candidates = [s for s in schedules.values() if s["name"] == "Nachtabsenkung Haus"]
            if len(candidates) != 1:
                raise ValueError("Der Scheduler-Plan „Nachtabsenkung Haus“ muss eindeutig vorhanden sein.")
            schedule = candidates[0]
            entity_id = er.async_get(self.hass).async_get_entity_id("switch", "scheduler", schedule["schedule_id"])
            if not entity_id or not self.hass.states.get(entity_id) or not schedule["enabled"]:
                raise ValueError("Der Scheduler-Plan muss für die Übernahme verfügbar und aktiv sein.")
            slots = DEFAULT_SLOTS if use_defaults else read_plan(schedule, actuator)
            if any(not actuator.attributes["min"] <= slot["value"] <= actuator.attributes["max"] for slot in slots):
                raise ValueError("Eine Ventilstellung liegt außerhalb des Gerätebereichs.")
            plan = {"source": entity_id, "slots": slots}
            # Save before disabling the old switch. The execution guard below
            # prevents concurrent control even if the handover is interrupted.
            await self.store.async_save(plan)
            try:
                await self.hass.services.async_call(
                    "switch", "turn_off", {"entity_id": entity_id}, blocking=True,
                )
            except Exception:
                await self.store.async_remove()
                raise
            self.plan = plan

    def is_active(self):
        if not self.plan or not self.plan.get("enabled", True):
            return False
        source = self.hass.states.get(self.plan.get("source", ""))
        return source is None or source.state == "off"

    async def async_set_enabled(self, enabled):
        async with self.lock:
            if self.plan is None:
                raise ValueError("Kein HM-Zeitplan vorhanden.")
            plan = {**self.plan, "enabled": enabled}
            await self.store.async_save(plan)
            self.plan = plan

    async def async_configure(self, phases, enabled):
        async with self.lock:
            actuator = self.hass.states.get(ACTUATOR)
            if actuator is None:
                raise ValueError("Der KNX-Stellantrieb fehlt.")
            if len(phases) != 4 or phases[0]["start"] != "00:00":
                raise ValueError("Vier Phasen mit Beginn um 00:00 sind erforderlich.")
            starts = [phase["start"] for phase in phases]
            if any(time.fromisoformat(start).isoformat(timespec="minutes") != start for start in starts):
                raise ValueError("Ungültige Startzeit.")
            if starts != sorted(set(starts)):
                raise ValueError("Die Startzeiten müssen aufsteigend und eindeutig sein.")
            slots = []
            for phase, stop in zip(phases, starts[1:] + ["24:00"]):
                value = float(phase["value"])
                if not actuator.attributes["min"] <= value <= actuator.attributes["max"]:
                    raise ValueError("Ventilstellung außerhalb des Gerätebereichs.")
                slots.append({"start": phase["start"], "stop": stop, "value": value})
            if self.plan is None:
                raise ValueError("Bitte zuerst den vorhandenen Scheduler übernehmen oder die Standardphasen aktivieren.")
            plan = {**(self.plan or {}), "enabled": enabled, "slots": slots}
            await self.store.async_save(plan)
            self.plan = plan

    async def async_tick(self, _now=None):
        async with self.lock:
            if not self.is_active() or not self.hass.is_running:
                return
            actuator = self.hass.states.get(ACTUATOR)
            if not actuator:
                return
            try:
                actual = float(actuator.state)
            except ValueError:
                return
            now = dt_util.now().time()
            for slot in self.plan["slots"]:
                start = time.fromisoformat(slot["start"])
                stop = time.fromisoformat(slot["stop"].replace("24:00", "00:00", 1))
                active = start <= now < stop if start < stop else now >= start or now < stop
                if active:
                    if abs(actual - slot["value"]) > 0.001:
                        try:
                            await self.hass.services.async_call("number", "set_value", {
                                "entity_id": ACTUATOR, "value": slot["value"],
                            }, blocking=True)
                        except Exception as err:
                            _LOGGER.warning("KNX-Stellantrieb konnte nicht gesetzt werden: %s", err)
                    return
