"""A corridor wider than the landslide page limit degrades to UNAVAILABLE, never to a 500.

Found on the physical phone: a driver 2,400 km off the planned road asked for
a reroute, the proposal was a 2,450 km route, and scoring it raised
LandslideQueryError out of `corridor_box` - which took the whole route-risk
endpoint down with it. Provider failure must stay local to the provider.
"""

import pytest

from app.services import route_risk as risk_service
from app.services.landslide.base import SourceState

WIDE = [(24.0, 73.0), (25.0, 80.0), (25.5, 88.0), (25.6, 91.9)]  # Gujarat -> Shillong


def test_corridor_box_is_none_when_wider_than_the_page() -> None:
    assert risk_service.corridor_box(WIDE) is None
    assert risk_service.corridor_box(WIDE[-2:]) is not None


@pytest.mark.usefixtures("clear_hazard_evidence")
async def test_landslide_and_history_report_unavailable_for_a_wide_corridor() -> None:
    landslide = await risk_service.landslide_for(WIDE)
    history = await risk_service.history_for(WIDE)
    assert not landslide.is_known
    assert not history.is_known
    assert history.data_status.value == "SOURCE_FAILED"  # the inventory could not be asked, not "no inventory"
