"""Private files, masked documents, manual truck verification - trust boundaries."""

import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import AssignmentStatus, UserRole
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PDF = b"%PDF-1.4\n" + b"\x00" * 64
MASK = "•••• "


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


async def _driver(api, session, *, assigned=True, verified=False):
    driver, user = await factories.make_driver(session)
    headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
    truck = await factories.make_truck(session)
    assignment = None
    if assigned:
        assignment = await factories.make_assignment(
            session, driver, truck, status=AssignmentStatus.PENDING_VERIFICATION, verified=verified
        )
    return driver, headers, truck, assignment


class TestFiles:
    async def test_type_is_sniffed_not_trusted(self, api, session):
        _, headers, _, _ = await _driver(api, session)
        exe = await api.post("/api/files?kind=DRIVER_DOCUMENT", headers={**headers, "Content-Type": "image/jpeg"}, content=b"MZ\x90\x00" + b"\x00" * 40)
        assert exe.status_code == 415 and exe.json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE"
        pdf_as_photo = await api.post("/api/files?kind=PROFILE_PHOTO", headers=headers, content=PDF)
        assert pdf_as_photo.status_code == 415
        ok = await api.post("/api/files?kind=DRIVER_DOCUMENT", headers=headers, content=PDF)
        assert ok.status_code == 201 and ok.json()["content_type"] == "application/pdf"

    async def test_too_large_is_413(self, api, session):
        _, headers, _, _ = await _driver(api, session)
        r = await api.post("/api/files?kind=PROFILE_PHOTO", headers=headers, content=JPEG + b"\x00" * (5 * 1024 * 1024))
        assert r.status_code == 413

    async def test_profile_photo_sets_the_driver_and_only_the_owner_or_a_manager_reads_it(self, api, session, manager_headers):
        driver, headers, _, _ = await _driver(api, session)
        _, other_headers, _, _ = await _driver(api, session, assigned=False)
        up = await api.post("/api/files?kind=PROFILE_PHOTO", headers=headers, content=JPEG)
        assert up.status_code == 201, up.text
        url = up.json()["url"]
        profile = await api.get("/api/driver/me/profile", headers=headers)
        assert profile.json()["photo_url"] == url
        assert (await api.get(url, headers=headers)).status_code == 200
        assert (await api.get(url, headers=manager_headers)).status_code == 200
        assert (await api.get(url, headers=other_headers)).status_code == 404  # not an oracle
        assert (await api.get(url)).status_code == 401
        assert (await api.get(f"/api/files/{uuid.uuid4()}", headers=headers)).status_code == 404

    async def test_truck_verification_photo_attaches_to_the_assignment_and_names_the_source(self, api, session):
        driver, headers, truck, assignment = await _driver(api, session)
        up = await api.post("/api/files?kind=TRUCK_VERIFICATION", headers=headers, content=JPEG)
        assert up.status_code == 201, up.text
        v = await api.post("/api/driver/me/assignment/verify", headers=headers, json={"reported_registration": truck.registration_number})
        assert v.status_code == 200, v.text
        await session.refresh(assignment)
        assert assignment.verification_photo_url == up.json()["url"]
        assert assignment.verification_source == "DRIVER_APP_PHOTO"

    async def test_a_driver_cannot_set_a_truck_photo(self, api, session):
        _, headers, truck, _ = await _driver(api, session)
        r = await api.post(f"/api/files?kind=TRUCK_PHOTO&truck_id={truck.id}", headers=headers, content=PNG)
        assert r.status_code == 403


class TestDocuments:
    async def test_numbers_are_masked_dates_validated_and_status_derived(self, api, session, manager_headers):
        driver, headers, _, _ = await _driver(api, session)
        f = await api.post("/api/files?kind=DRIVER_DOCUMENT", headers=headers, content=PDF)
        soon = (date.today() + timedelta(days=10)).isoformat()
        r = await api.post("/api/driver/me/documents", headers=headers, json={"doc_type": "DRIVING_LICENCE", "doc_number": "AS0120190004821", "issued_on": "2019-08-12", "expires_on": soon, "file_id": f.json()["id"]})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["number_masked"] == MASK + "4821" and "AS0120190004821" not in r.text
        assert body["status"] == "EXPIRING_SOON"
        bad = await api.post("/api/driver/me/documents", headers=headers, json={"doc_type": "GOVERNMENT_ID", "doc_number": "X123456", "issued_on": "2030-01-01", "expires_on": "2020-01-01"})
        assert bad.status_code == 422 and bad.json()["error"]["code"] == "DOCUMENT_DATES_INVALID"
        aadhaar = await api.post("/api/driver/me/documents", headers=headers, json={"doc_type": "AADHAAR", "doc_number": "123456789012"})
        assert aadhaar.status_code == 422
        # Manager: status and masked metadata, never the number.
        m = await api.get(f"/api/drivers/{driver.id}/documents", headers=manager_headers)
        assert m.status_code == 200 and m.json()[0]["number_masked"] == MASK + "4821"
        # Another driver's file id cannot be attached to my document.
        _, other_headers, _, _ = await _driver(api, session, assigned=False)
        steal = await api.post("/api/driver/me/documents", headers=other_headers, json={"doc_type": "OTHER", "doc_number": "ABCDEF", "file_id": f.json()["id"]})
        assert steal.status_code == 404

    async def test_insurance_lives_on_the_assigned_truck(self, api, session):
        _, headers, truck, _ = await _driver(api, session)
        r = await api.post("/api/driver/me/truck-documents", headers=headers, json={"doc_type": "INSURANCE", "doc_number": "POL-99887766", "expires_on": (date.today() + timedelta(days=200)).isoformat()})
        assert r.status_code == 201 and r.json()["number_masked"] == MASK + "7766" and r.json()["status"] == "MISSING"
        profile = await api.get("/api/driver/me/profile", headers=headers)
        assert profile.json()["truck_registration"] == truck.registration_number
        assert profile.json()["insurance"][0]["doc_type"] == "INSURANCE"


class TestManualVerify:
    async def test_manager_verifies_by_plate_and_the_source_says_so(self, api, session, manager_headers):
        _, headers, truck, assignment = await _driver(api, session)
        wrong = await api.post(f"/api/assignments/{assignment.id}/verify-manual", headers=manager_headers, json={"reported_registration": "XX00XX0000"})
        assert wrong.status_code == 422 and wrong.json()["error"]["code"] == "REGISTRATION_MISMATCH"
        ok = await api.post(f"/api/assignments/{assignment.id}/verify-manual", headers=manager_headers, json={"reported_registration": truck.registration_number.lower(), "note": "phoned the depot"})
        assert ok.status_code == 200, ok.text
        assert ok.json()["verification_source"] == "MANAGER_MANUAL" and ok.json()["status"] == "ACTIVE"
        assert ok.json()["verification_photo_url"] is None  # no photo is pretended
        # A driver cannot use the manager path.
        assert (await api.post(f"/api/assignments/{assignment.id}/verify-manual", headers=headers, json={"reported_registration": truck.registration_number})).status_code == 403
