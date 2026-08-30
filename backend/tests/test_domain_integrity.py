"""Data integrity: constraints must hold at the database level.

Every test here writes raw SQL rather than going through the ORM. A constraint
that only the application enforces is not a constraint - it is a convention that
survives exactly until the first bug, migration or manual psql session.

Every test runs inside a transaction that is rolled back.
"""

import uuid

import pytest
from sqlalchemy import Connection, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models import P2_TABLES

pytestmark = pytest.mark.requires_db

GUWAHATI = "POINT(91.7362 26.1445)"
JORHAT = "POINT(94.2037 26.7509)"


# --- helpers --------------------------------------------------------------


def _mk_user(db: Connection, role: str = "MANAGER") -> uuid.UUID:
    return db.execute(
        text(
            "INSERT INTO users (email, password_hash, role, display_name) "
            "VALUES (:e, 'x', CAST(:r AS user_role), 'Test User') RETURNING id"
        ),
        {"e": f"{uuid.uuid4()}@test.invalid", "r": role},
    ).scalar_one()


def _mk_driver(db: Connection) -> uuid.UUID:
    user_id = _mk_user(db, "DRIVER")
    return db.execute(
        text(
            "INSERT INTO drivers (user_id, full_name, phone, licence_number, "
            "licence_expiry) VALUES (:u, 'Bipul Das', '9000000000', :lic, "
            "'2030-01-01') RETURNING id"
        ),
        {"u": user_id, "lic": f"AS{uuid.uuid4().hex[:10].upper()}"},
    ).scalar_one()


def _mk_truck(db: Connection, capacity: str = "16000.00") -> uuid.UUID:
    return db.execute(
        text(
            "INSERT INTO trucks (registration_number, max_capacity_kg) "
            "VALUES (:r, :c) RETURNING id"
        ),
        {"r": f"AS{uuid.uuid4().hex[:8].upper()}", "c": capacity},
    ).scalar_one()


def _mk_shipment(db: Connection) -> uuid.UUID:
    return db.execute(
        text(
            "INSERT INTO shipments (reference_code, client_name, pickup_address, "
            "pickup_location, destination_address, destination_location) "
            "VALUES (:ref, 'Assam Tea Co-op', 'Jorhat', "
            "ST_GeogFromText(:pk), 'Guwahati', ST_GeogFromText(:dt)) RETURNING id"
        ),
        {"ref": f"SHP-{uuid.uuid4().hex[:8]}", "pk": JORHAT, "dt": GUWAHATI},
    ).scalar_one()


def _mk_trip(db: Connection) -> uuid.UUID:
    return db.execute(
        text(
            "INSERT INTO trips (trip_code, shipment_id, truck_id, driver_id) "
            "VALUES (:code, :s, :t, :d) RETURNING id"
        ),
        {
            "code": f"TRP-{uuid.uuid4().hex[:8]}",
            "s": _mk_shipment(db),
            "t": _mk_truck(db),
            "d": _mk_driver(db),
        },
    ).scalar_one()


# --- Foreign keys ---------------------------------------------------------


class TestForeignKeys:
    def test_driver_requires_existing_user(self, db: Connection) -> None:
        with pytest.raises(IntegrityError):
            db.execute(
                text(
                    "INSERT INTO drivers (user_id, full_name, phone, "
                    "licence_number, licence_expiry) VALUES "
                    "(:u, 'Ghost', '9000000000', 'X1', '2030-01-01')"
                ),
                {"u": uuid.uuid4()},
            )

    def test_trip_requires_existing_truck(self, db: Connection) -> None:
        with pytest.raises(IntegrityError):
            db.execute(
                text(
                    "INSERT INTO trips (trip_code, shipment_id, truck_id, driver_id) "
                    "VALUES ('TRP-X', :s, :t, :d)"
                ),
                {"s": _mk_shipment(db), "t": uuid.uuid4(), "d": _mk_driver(db)},
            )

    def test_cargo_items_cascade_on_shipment_delete(self, db: Connection) -> None:
        shipment_id = _mk_shipment(db)
        db.execute(
            text(
                "INSERT INTO cargo_items (shipment_id, cargo_type, cargo_name, "
                "weight_kg) VALUES (:s, 'TEA', 'CTC chests', 450)"
            ),
            {"s": shipment_id},
        )
        db.execute(text("DELETE FROM shipments WHERE id = :s"), {"s": shipment_id})
        remaining = db.execute(
            text("SELECT count(*) FROM cargo_items WHERE shipment_id = :s"),
            {"s": shipment_id},
        ).scalar_one()
        assert remaining == 0

    def test_driver_delete_restricted_while_referenced(self, db: Connection) -> None:
        """History must not be destroyed by deleting master data."""
        trip_id = _mk_trip(db)
        driver_id = db.execute(
            text("SELECT driver_id FROM trips WHERE id = :t"), {"t": trip_id}
        ).scalar_one()
        with pytest.raises(IntegrityError):
            db.execute(text("DELETE FROM drivers WHERE id = :d"), {"d": driver_id})


# --- CHECK constraints ----------------------------------------------------


class TestCheckConstraints:
    def test_truck_load_cannot_exceed_capacity(self, db: Connection) -> None:
        """The capacity invariant, enforced by the database itself."""
        truck_id = _mk_truck(db, "16000.00")
        with pytest.raises(IntegrityError) as exc:
            db.execute(
                text("UPDATE trucks SET current_load_kg = 18500 WHERE id = :t"),
                {"t": truck_id},
            )
        assert "ck_trucks_load_within_capacity" in str(exc.value)

    def test_truck_capacity_must_be_positive(self, db: Connection) -> None:
        with pytest.raises(IntegrityError):
            db.execute(
                text(
                    "INSERT INTO trucks (registration_number, max_capacity_kg) "
                    "VALUES ('AS01ZZ0001', 0)"
                )
            )

    def test_cargo_weight_must_be_positive(self, db: Connection) -> None:
        with pytest.raises(IntegrityError):
            db.execute(
                text(
                    "INSERT INTO cargo_items (shipment_id, cargo_type, cargo_name, "
                    "weight_kg) VALUES (:s, 'TEA', 'bad', 0)"
                ),
                {"s": _mk_shipment(db)},
            )

    def test_user_requires_email_or_phone(self, db: Connection) -> None:
        with pytest.raises(IntegrityError) as exc:
            db.execute(
                text(
                    "INSERT INTO users (password_hash, role, display_name) "
                    "VALUES ('x', 'MANAGER', 'No Identifier')"
                )
            )
        assert "ck_users_has_identifier" in str(exc.value)

    def test_gps_heading_must_be_within_a_circle(self, db: Connection) -> None:
        trip_id = _mk_trip(db)
        row = db.execute(
            text("SELECT truck_id, driver_id FROM trips WHERE id = :t"), {"t": trip_id}
        ).one()
        with pytest.raises(IntegrityError):
            db.execute(
                text(
                    "INSERT INTO gps_points (trip_id, driver_id, truck_id, location, "
                    "heading_deg, device_fix_id, recorded_at) VALUES "
                    "(:t, :d, :tr, ST_GeogFromText(:p), 361, :f, now())"
                ),
                {
                    "t": trip_id, "d": row.driver_id, "tr": row.truck_id,
                    "p": GUWAHATI, "f": uuid.uuid4(),
                },
            )

    def test_trip_timestamps_must_be_ordered(self, db: Connection) -> None:
        trip_id = _mk_trip(db)
        with pytest.raises(IntegrityError) as exc:
            db.execute(
                text(
                    "UPDATE trips SET dispatched_at = now(), "
                    "started_at = now() - interval '1 hour' WHERE id = :t"
                ),
                {"t": trip_id},
            )
        assert "ck_trips_started_after_dispatched" in str(exc.value)


# --- Unique constraints ---------------------------------------------------


class TestUniqueConstraints:
    def test_one_active_assignment_per_driver(self, db: Connection) -> None:
        driver_id = _mk_driver(db)
        for _ in range(2):
            stmt = text(
                "INSERT INTO driver_truck_assignments (driver_id, truck_id, status) "
                "VALUES (:d, :t, 'ACTIVE')"
            )
            params = {"d": driver_id, "t": _mk_truck(db)}
            if _ == 0:
                db.execute(stmt, params)
            else:
                with pytest.raises(IntegrityError) as exc:
                    db.execute(stmt, params)
                assert "uq_current_assignment_driver" in str(exc.value)

    def test_one_active_assignment_per_truck(self, db: Connection) -> None:
        truck_id = _mk_truck(db)
        db.execute(
            text(
                "INSERT INTO driver_truck_assignments (driver_id, truck_id, status) "
                "VALUES (:d, :t, 'ACTIVE')"
            ),
            {"d": _mk_driver(db), "t": truck_id},
        )
        with pytest.raises(IntegrityError) as exc:
            db.execute(
                text(
                    "INSERT INTO driver_truck_assignments (driver_id, truck_id, status) "
                    "VALUES (:d, :t, 'ACTIVE')"
                ),
                {"d": _mk_driver(db), "t": truck_id},
            )
        assert "uq_current_assignment_truck" in str(exc.value)

    def test_ended_assignments_do_not_block_a_new_one(self, db: Connection) -> None:
        """The partial index must permit full history."""
        driver_id = _mk_driver(db)
        db.execute(
            text(
                "INSERT INTO driver_truck_assignments (driver_id, truck_id, status) "
                "VALUES (:d, :t, 'ENDED')"
            ),
            {"d": driver_id, "t": _mk_truck(db)},
        )
        db.execute(
            text(
                "INSERT INTO driver_truck_assignments (driver_id, truck_id, status) "
                "VALUES (:d, :t, 'ACTIVE')"
            ),
            {"d": driver_id, "t": _mk_truck(db)},
        )

    def test_gps_fix_is_idempotent_per_trip(self, db: Connection) -> None:
        """Re-posting an unacknowledged batch must not duplicate rows."""
        trip_id = _mk_trip(db)
        row = db.execute(
            text("SELECT truck_id, driver_id FROM trips WHERE id = :t"), {"t": trip_id}
        ).one()
        fix_id = uuid.uuid4()
        params = {
            "t": trip_id, "d": row.driver_id, "tr": row.truck_id,
            "p": GUWAHATI, "f": fix_id,
        }
        stmt = text(
            "INSERT INTO gps_points (trip_id, driver_id, truck_id, location, "
            "device_fix_id, recorded_at) VALUES "
            "(:t, :d, :tr, ST_GeogFromText(:p), :f, now())"
        )
        db.execute(stmt, params)
        with pytest.raises(IntegrityError) as exc:
            db.execute(stmt, params)
        assert "uq_gps_trip_device_fix" in str(exc.value)

    def test_email_uniqueness_is_case_insensitive(self, db: Connection) -> None:
        addr = f"Manager.{uuid.uuid4().hex[:6]}@Fleet.example"
        db.execute(
            text(
                "INSERT INTO users (email, password_hash, role, display_name) "
                "VALUES (:e, 'x', 'MANAGER', 'A')"
            ),
            {"e": addr},
        )
        with pytest.raises(IntegrityError):
            db.execute(
                text(
                    "INSERT INTO users (email, password_hash, role, display_name) "
                    "VALUES (:e, 'x', 'MANAGER', 'B')"
                ),
                {"e": addr.upper()},
            )

    def test_trip_stop_sequence_unique_within_trip(self, db: Connection) -> None:
        trip_id = _mk_trip(db)
        stmt = text(
            "INSERT INTO trip_stops (trip_id, sequence, kind, location) "
            "VALUES (:t, 1, 'PICKUP', ST_GeogFromText(:p))"
        )
        db.execute(stmt, {"t": trip_id, "p": JORHAT})
        with pytest.raises(IntegrityError) as exc:
            db.execute(stmt, {"t": trip_id, "p": GUWAHATI})
        assert "uq_trip_stops_sequence" in str(exc.value)


# --- Enum values ----------------------------------------------------------


class TestEnumEnforcement:
    def test_invalid_trip_status_is_rejected(self, db: Connection) -> None:
        """An arbitrary status string must be impossible, not merely discouraged."""
        with pytest.raises(DBAPIError):
            db.execute(
                text("UPDATE trips SET status = CAST('NOT_A_STATUS' AS trip_status)")
            )


# --- Triggers -------------------------------------------------------------


class TestTriggers:
    def test_shipment_weight_is_derived_from_cargo(self, db: Connection) -> None:
        shipment_id = _mk_shipment(db)
        db.execute(
            text(
                "INSERT INTO cargo_items (shipment_id, cargo_type, cargo_name, "
                "weight_kg, quantity) VALUES (:s, 'TEA', 'CTC chests', 450, 30)"
            ),
            {"s": shipment_id},
        )
        total = db.execute(
            text("SELECT total_weight_kg FROM shipments WHERE id = :s"),
            {"s": shipment_id},
        ).scalar_one()
        assert float(total) == pytest.approx(13500.0)

    def test_shipment_weight_recomputes_on_delete(self, db: Connection) -> None:
        shipment_id = _mk_shipment(db)
        db.execute(
            text(
                "INSERT INTO cargo_items (shipment_id, cargo_type, cargo_name, "
                "weight_kg, quantity) VALUES (:s, 'TEA', 'chests', 100, 2)"
            ),
            {"s": shipment_id},
        )
        db.execute(
            text("DELETE FROM cargo_items WHERE shipment_id = :s"), {"s": shipment_id}
        )
        total = db.execute(
            text("SELECT total_weight_kg FROM shipments WHERE id = :s"),
            {"s": shipment_id},
        ).scalar_one()
        assert float(total) == 0.0

    def test_audit_logs_reject_update(self, db: Connection) -> None:
        db.execute(
            text(
                "INSERT INTO audit_logs (action, entity_type, entity_id) "
                "VALUES ('CREATE', 'trucks', :e)"
            ),
            {"e": uuid.uuid4()},
        )
        with pytest.raises(DBAPIError) as exc:
            db.execute(text("UPDATE audit_logs SET reason = 'tampered'"))
        assert "append-only" in str(exc.value)

    def test_audit_logs_reject_delete(self, db: Connection) -> None:
        db.execute(
            text(
                "INSERT INTO audit_logs (action, entity_type, entity_id) "
                "VALUES ('CREATE', 'trucks', :e)"
            ),
            {"e": uuid.uuid4()},
        )
        with pytest.raises(DBAPIError) as exc:
            db.execute(text("DELETE FROM audit_logs"))
        assert "append-only" in str(exc.value)

    def test_updated_at_trigger_overrides_client_supplied_value(
        self, db: Connection
    ) -> None:
        """The trigger fires on raw SQL, so updated_at cannot be forged.

        Note this cannot be tested by asserting the timestamp advances: the
        trigger uses now(), which in PostgreSQL is *transaction* start time and
        is therefore constant for the whole test transaction. That is the
        correct semantic - every row changed by one logical operation shares a
        timestamp - so the meaningful assertion is that a value the client tries
        to set is replaced, not that wall-clock time moved.
        """
        truck_id = _mk_truck(db)
        db.execute(
            text(
                "UPDATE trucks SET make = 'Tata', "
                "updated_at = TIMESTAMPTZ '2001-01-01 00:00:00+00' WHERE id = :t"
            ),
            {"t": truck_id},
        )
        after = db.execute(
            text("SELECT updated_at FROM trucks WHERE id = :t"), {"t": truck_id}
        ).scalar_one()
        assert after.year != 2001, (
            "trg_trucks_set_updated_at did not fire - a client was able to "
            "dictate updated_at"
        )

    def test_updated_at_matches_transaction_time(self, db: Connection) -> None:
        truck_id = _mk_truck(db)
        db.execute(
            text("UPDATE trucks SET make = 'Ashok Leyland' WHERE id = :t"),
            {"t": truck_id},
        )
        same = db.execute(
            text(
                "SELECT updated_at = transaction_timestamp() FROM trucks WHERE id = :t"
            ),
            {"t": truck_id},
        ).scalar_one()
        assert same is True


# --- Row Level Security ---------------------------------------------------


class TestRowLevelSecurity:
    def test_rls_enabled_on_every_p2_table(self, db: Connection) -> None:
        """Supabase publishes `public` via PostgREST.

        A table without RLS is readable by anyone holding the anon key,
        bypassing FastAPI entirely - which for this schema means driver
        documents and live GPS traces.
        """
        rows = db.execute(
            text(
                "SELECT c.relname, c.relrowsecurity FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND c.relname = ANY(:names)"
            ),
            {"names": list(P2_TABLES)},
        ).all()
        found = {r.relname: r.relrowsecurity for r in rows}

        missing = set(P2_TABLES) - set(found)
        assert not missing, f"tables not found: {sorted(missing)}"

        without_rls = sorted(name for name, on in found.items() if not on)
        assert not without_rls, f"RLS disabled on: {without_rls}"

    def test_no_table_in_public_lacks_rls(self, db: Connection) -> None:
        """Nothing in `public` may be readable through the Data API.

        Broader than the P2 list on purpose: it catches any table added later
        without RLS, including Alembic's own alembic_version, which would
        otherwise leak the exact schema revision to anyone with the anon key.
        """
        exposed = db.execute(
            text(
                "SELECT c.relname FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND c.relkind = 'r' "
                "AND NOT c.relrowsecurity ORDER BY 1"
            )
        ).scalars().all()
        assert exposed == [], f"tables in public without RLS: {exposed}"

    def test_no_permissive_policies_exist(self, db: Connection) -> None:
        """Deny-by-default until auth is designed deliberately.

        A policy added merely to make something pass would silently open the
        Data API to anonymous reads.
        """
        policies = db.execute(
            text(
                "SELECT tablename, policyname FROM pg_policies "
                "WHERE schemaname = 'public' AND tablename = ANY(:names)"
            ),
            {"names": list(P2_TABLES)},
        ).all()
        assert policies == [], (
            "Unexpected RLS policies found: "
            f"{[(p.tablename, p.policyname) for p in policies]}"
        )
