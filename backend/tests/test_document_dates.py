"""Every rule about a document's two dates, on both document endpoints.

The rules are shared (`_dates_ok`) because driver documents and truck
documents are the same question asked twice, and the failure worth guarding
against is one of them drifting: insurance accepting a date the licence
would refuse.

The far-future rule is the one that reads like pedantry and is not. An
expiry typed as 2205 instead of 2025 leaves a row that looks correct, passes
every other check, and silently switches off the expiry warning the document
exists to produce - for the life of the fleet.
"""

from datetime import date, timedelta

import pytest

from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

TOMORROW = (date.today() + timedelta(days=1)).isoformat()
LAST_YEAR = (date.today() - timedelta(days=365)).isoformat()
NEXT_YEAR = (date.today() + timedelta(days=365)).isoformat()
FAR = date.today().replace(year=date.today().year + 31).isoformat()
JUST_INSIDE = date.today().replace(year=date.today().year + 29).isoformat()


async def _driver_headers(api, session):
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    await factories.make_assignment(session, driver, truck, verified=True)
    return await auth_headers(api, user.phone, factories.TEST_PASSWORD)


@pytest.mark.parametrize(
    "path,doc_type",
    [
        ("/api/driver/me/documents", "DRIVING_LICENCE"),
        ("/api/driver/me/truck-documents", "INSURANCE"),
    ],
)
class TestBothEndpointsAgree:
    async def test_an_issue_date_in_the_future_is_refused(
        self, api, session, path, doc_type
    ):
        headers = await _driver_headers(api, session)
        r = await api.post(
            path,
            headers=headers,
            json={"doc_type": doc_type, "doc_number": "ABC123", "issued_on": TOMORROW},
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "DOCUMENT_DATES_INVALID"
        assert "future" in r.json()["error"]["message"].lower()

    async def test_an_expiry_before_the_issue_date_is_refused(
        self, api, session, path, doc_type
    ):
        headers = await _driver_headers(api, session)
        r = await api.post(
            path,
            headers=headers,
            json={
                "doc_type": doc_type,
                "doc_number": "ABC123",
                "issued_on": LAST_YEAR,
                "expires_on": "2000-01-01",
            },
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "DOCUMENT_DATES_INVALID"

    async def test_a_mistyped_year_is_caught(self, api, session, path, doc_type):
        headers = await _driver_headers(api, session)
        r = await api.post(
            path,
            headers=headers,
            json={"doc_type": doc_type, "doc_number": "ABC123", "expires_on": FAR},
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "DOCUMENT_DATES_INVALID"
        assert "year" in r.json()["error"]["message"].lower()

    async def test_a_long_but_plausible_validity_is_accepted(
        self, api, session, path, doc_type
    ):
        """The rule must not refuse a genuine long-dated document."""
        headers = await _driver_headers(api, session)
        r = await api.post(
            path,
            headers=headers,
            json={
                "doc_type": doc_type,
                "doc_number": "ABC123",
                "issued_on": LAST_YEAR,
                "expires_on": JUST_INSIDE,
            },
        )
        assert r.status_code == 201, r.text

    async def test_only_iso_dates_are_accepted(self, api, session, path, doc_type):
        """`13-01-2026` and `01-13-2026` are one string to a human and two
        different dates to a parser. Refusing both is the only safe reading."""
        headers = await _driver_headers(api, session)
        for ambiguous in ("13-01-2026", "01/13/2026", "12 Jan 2026"):
            r = await api.post(
                path,
                headers=headers,
                json={
                    "doc_type": doc_type,
                    "doc_number": "ABC123",
                    "expires_on": ambiguous,
                },
            )
            assert r.status_code == 422, f"{ambiguous} was accepted"

    async def test_a_valid_document_is_stored_with_its_dates(
        self, api, session, path, doc_type
    ):
        headers = await _driver_headers(api, session)
        r = await api.post(
            path,
            headers=headers,
            json={
                "doc_type": doc_type,
                "doc_number": "POL-99887766",
                "issued_on": LAST_YEAR,
                "expires_on": NEXT_YEAR,
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["issued_on"] == LAST_YEAR
        assert body["expires_on"] == NEXT_YEAR
        # The number never comes back whole, on either endpoint.
        assert "POL-99887766" not in r.text
