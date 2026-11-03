"""Weighted local temperature measurement, independent of Home Assistant."""
from __future__ import annotations

import math


class RoomTemperature:
    def __init__(self):
        self.value = None
        self.timestamp = None
        self.signature = None
        self.learning_resume = 0

    def update(self, timestamp, readings, config):
        """Readings contain validated values or an explicit rejection reason."""
        primary_weight = float(config["primary_temperature_weight"])
        weights = [primary_weight, 100 - primary_weight]
        offsets = [config["primary_temperature_offset"], config["secondary_temperature_offset"]]
        sources = []
        for index, reading in enumerate(readings):
            item = dict(reading)
            item["configured_weight"] = weights[index]
            item["offset"] = offsets[index]
            item["corrected"] = reading["raw"] + offsets[index] if reading["raw"] is not None else None
            item["used"] = item["corrected"] is not None and weights[index] > 0
            item["effective_weight"] = 0.0
            sources.append(item)
        active = [s for s in sources if s["used"]]
        signature = tuple((s["entity_id"], s["offset"], s["configured_weight"]) for s in active)
        changed = signature != self.signature
        if changed:
            self.learning_resume = timestamp + max(600, config["temperature_smoothing_minutes"] * 120)
        self.signature = signature
        if not active:
            self.value = None
            self.timestamp = None
            return {"value": None, "weighted": None, "sources": sources, "source_changed": changed,
                "learning_paused": True, "status": "Keine gültige Raumtemperatur"}
        total = sum(s["configured_weight"] for s in active)
        for source in active:
            source["effective_weight"] = round(100 * source["configured_weight"] / total, 2)
        weighted = sum(s["corrected"] * s["configured_weight"] for s in active) / total
        seconds = config["temperature_smoothing_minutes"] * 60
        if changed or self.value is None or self.timestamp is None or timestamp - self.timestamp > 600 or seconds <= 0:
            self.value = weighted
        else:
            elapsed = max(0, timestamp - self.timestamp)
            alpha = -math.expm1(-elapsed / seconds)
            self.value += alpha * (weighted - self.value)
        self.timestamp = timestamp
        configured_count = sum(bool(s["entity_id"]) and s["configured_weight"] > 0 for s in sources)
        fallback = len(active) < configured_count
        return {"value": round(self.value, 3), "weighted": round(weighted, 3), "sources": sources,
            "source_changed": changed, "learning_paused": timestamp < self.learning_resume,
            "status": "Ersatzbetrieb – nur ein Sensor gültig" if fallback else "Gewichtete Raumtemperatur" if len(active) > 1 else "Einzelsensor",
            "smoothing_minutes": config["temperature_smoothing_minutes"],
            "learning_resume_timestamp": self.learning_resume}
