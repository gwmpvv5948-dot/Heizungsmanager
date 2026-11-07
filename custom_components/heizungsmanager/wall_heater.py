"""Living-room supplementary heat using confirmed PV surplus."""

ENTITY_ID = "switch.wandheitung"
RATED_WATTS = 400


class WallHeater:
    def __init__(self):
        self.surplus_since = None
        self.deficit_since = None

    async def update(self, hass, now, surplus, demand, safety_stop, enabled):
        state = hass.states.get(ENTITY_ID)
        if not state or state.state not in ("on", "off") or state.attributes.get("restored"):
            self.surplus_since = self.deficit_since = None
            return
        on = state.state == "on"
        available = surplus is not None and surplus >= (100 if on else 500)
        if not enabled or safety_stop or not demand or not available:
            self.surplus_since = None
        elif self.surplus_since is None:
            self.surplus_since = now
        if not on or available or not enabled:
            self.deficit_since = None
        elif self.deficit_since is None:
            self.deficit_since = now
        deficit_confirmed = self.deficit_since is not None and now - self.deficit_since >= 300
        if not enabled and not safety_stop:
            return
        elapsed = now - state.last_changed.timestamp()
        if on and (safety_stop or (elapsed >= 1800 and (not demand or deficit_confirmed))):
            action = "turn_off"
        elif not on and not safety_stop and self.surplus_since is not None and now-self.surplus_since >= 300 and elapsed >= 1800:
            action = "turn_on"
        else:
            return
        await hass.services.async_call("switch", action, {"entity_id": ENTITY_ID}, blocking=True)
        self.surplus_since = None
