"""Create a uniquely named local-only browser QA fixture; never reset existing data.

Credentials are generated and written only to git-ignored .runtime, never stdout.
This script creates principals and a driver/truck assignment. The browser creates
the shipment and trip, reviews, selects, dispatches and accepts via real APIs.
"""
import asyncio
import json
import secrets
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.event_loop import configure_event_loop_policy
configure_event_loop_policy()
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import get_sessionmaker, dispose_engine
from app.models.identity import User
from app.models.enums import UserRole
from tests import db_target
from httpx import AsyncClient

async def main():
    db_target.install()
    db_target.enforce(get_settings().effective_database_url, context='Terrain browser QA')
    tag = uuid.uuid4().hex[:8].upper()
    fixture = {'tag': tag, 'created_at': datetime.now(UTC).isoformat()}
    async with get_sessionmaker()() as db:
        for name, role in [('manager', UserRole.MANAGER), ('reviewer', UserRole.AUTHORISED_REVIEWER)]:
            credential = {'id': f'terrain-{name}-{tag}@qa.invalid', 'password': secrets.token_urlsafe(32)}
            user = User(email=credential['id'], password_hash=hash_password(credential['password']), role=role, display_name=f'Terrain QA {name.title()}', is_active=True)
            db.add(user)
            fixture[name] = credential
        await db.commit()
    async with AsyncClient(base_url='http://127.0.0.1:8000', timeout=30) as client:
        response = await client.post('/api/auth/login', json={'identifier': fixture['manager']['id'], 'password': fixture['manager']['password']})
        response.raise_for_status()
        headers = {'Authorization': f"Bearer {response.json()['access_token']}"}
        password = secrets.token_urlsafe(32)
        phone = f'9{secrets.randbelow(10**9):09d}'
        response = await client.post('/api/drivers', headers=headers, json={'full_name': f'Terrain QA Driver {tag}', 'initial_password': password, 'phone': phone, 'email': f'terrain-driver-{tag}@qa.invalid', 'licence_number': f'TC-{tag}', 'licence_expiry': (datetime.now(UTC).date()+timedelta(days=400)).isoformat()})
        response.raise_for_status()
        driver = response.json()
        response = await client.post('/api/trucks', headers=headers, json={'registration_number': f'AS99TC{secrets.randbelow(10000):04d}', 'max_capacity_kg': '16000.00'})
        response.raise_for_status()
        truck = response.json()
        response = await client.post('/api/assignments', headers=headers, json={'driver_id': driver['id'], 'truck_id': truck['id']})
        response.raise_for_status()
        fixture['driver'] = {'id': phone, 'password': password, 'driver_id': driver['id'], 'name': driver['full_name']}
        fixture['truck'] = truck
        fixture['assignment_id'] = response.json()['id']
    output = Path(__file__).resolve().parents[2]/'.runtime/terrain-command/qa-fixture-private.json'
    output.write_text(json.dumps(fixture, indent=2), encoding='utf-8')
    print(f'Created local synthetic QA fixture {tag}; credentials kept in ignored runtime file.')
    await dispose_engine()

if __name__ == '__main__': asyncio.run(main())
