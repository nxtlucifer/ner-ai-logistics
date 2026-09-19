"""warnings.py and geocoding.py share ONE Nominatim throttle - ship them together.

Nominatim allows one request per second per application
(operations.osmfoundation.org/policies/nominatim). The official-warnings
district lookup (`warnings.locate`) and the manager's address search
(`geocoding`) both call it, so they must pace against the same clock.
`warnings.py` imports `_nominatim_lock` and `_throttle` from `geocoding.py`,
and `_throttle`/`_last_request` exist only since the cycle-4 geocoding change.

INTEGRATION RULE: land the two files in the same commit, or geocoding.py
first. If warnings.py lands alone, this module fails at import and the app
does not start. This file makes that failure loud and names it.
"""
import asyncio
import json
import uuid

from app.services import geocoding
from app.services import warnings as warnings_service

ADDRESS = json.dumps({"address": {"state_district": "Kamrup", "state": "Assam"}}).encode()


def test_one_lock_and_one_throttle_for_every_nominatim_call() -> None:
    assert warnings_service._nominatim_lock is geocoding._nominatim_lock
    assert warnings_service._throttle is geocoding._throttle


async def test_a_warnings_lookup_makes_the_next_address_search_wait(monkeypatch) -> None:
    """Pacing crosses the module boundary: a reverse lookup made for warnings
    moves the shared clock, so an address search right after it is held back."""

    async def fake_get(client, url, **params):
        return ADDRESS

    monkeypatch.setattr(warnings_service, "_get", fake_get)
    monkeypatch.setattr(geocoding, "_last_request", 0.0)
    before = asyncio.get_running_loop().time()

    located = await warnings_service.locate(uuid.uuid4(), [(26.1445, 91.7362)])

    assert located == ({"Kamrup"}, {"Assam"})
    assert geocoding._last_request >= before  # the warnings call went through the shared throttle

    waits: list[float] = []
    real_sleep = asyncio.sleep

    async def record(delay, *args, **kwargs):
        waits.append(delay)
        await real_sleep(0)

    monkeypatch.setattr(geocoding.asyncio, "sleep", record)
    async with geocoding._nominatim_lock:
        await geocoding._throttle()

    assert waits and 0.9 < waits[0] <= 1.0  # the next caller waited out the rest of the second
