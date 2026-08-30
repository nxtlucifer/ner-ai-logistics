"""Pins the trust boundary: RLS is not backend authorization.

This is the single most misunderstandable thing about the security model, so it
is asserted rather than left in prose. If someone later adds RLS policies
believing they secure the API, these tests state plainly what RLS does and does
not cover.

    RLS protects            : the Supabase Data API (anon key, PostgREST)
    app/core/permissions.py : every request that reaches FastAPI
"""

import pytest
from sqlalchemy import Connection, text

from app.models import ALL_APP_TABLES

pytestmark = pytest.mark.requires_db


class TestDatabaseRole:
    def test_backend_role_bypasses_rls(self, db: Connection) -> None:
        """Measured, not assumed.

        The backend connects as `postgres`, which carries rolbypassrls. Every
        RLS policy is therefore invisible to the application's own queries -
        which is why authorization lives in FastAPI.
        """
        bypasses = db.execute(
            text("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user")
        ).scalar_one()
        assert bypasses is True, (
            "The backend role no longer bypasses RLS. That is a significant "
            "architecture change: RLS could now participate in backend "
            "authorization, and app/core/permissions.py plus docs/SECURITY.md "
            "must be revisited before relying on it."
        )

    def test_backend_can_read_a_table_with_rls_and_no_policies(
        self, db: Connection
    ) -> None:
        """Demonstrates the bypass concretely rather than by flag inspection."""
        rls_on = db.execute(
            text(
                "SELECT relrowsecurity FROM pg_class WHERE oid='public.trucks'::regclass"
            )
        ).scalar_one()
        policies = db.execute(
            text("SELECT count(*) FROM pg_policies WHERE tablename='trucks'")
        ).scalar_one()
        assert rls_on is True and policies == 0

        # Deny-all for anyone subject to RLS; succeeds here because we are not.
        db.execute(text("SELECT count(*) FROM trucks")).scalar_one()

    def test_force_rls_is_off(self, db: Connection) -> None:
        """FORCE would subject the owner to RLS too.

        With zero policies that would lock the backend out of its own database,
        so it must stay off until policies exist.
        """
        forced = db.execute(
            text(
                "SELECT bool_or(relforcerowsecurity) FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname='public' AND c.relkind='r'"
            )
        ).scalar_one()
        assert forced is False


class TestDataApiContainment:
    def test_rls_enabled_on_every_application_table(self, db: Connection) -> None:
        """What RLS actually buys us: the Data API is closed by default."""
        rows = db.execute(
            text(
                "SELECT c.relname, c.relrowsecurity FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname='public' AND c.relname = ANY(:names)"
            ),
            {"names": list(ALL_APP_TABLES)},
        ).all()
        found = {r.relname: r.relrowsecurity for r in rows}

        missing = set(ALL_APP_TABLES) - set(found)
        assert not missing, f"tables absent from the database: {sorted(missing)}"

        without = sorted(n for n, on in found.items() if not on)
        assert not without, f"RLS disabled on: {without}"

    def test_no_permissive_policies_were_added(self, db: Connection) -> None:
        """Deny-by-default must not be quietly relaxed to make something pass."""
        policies = db.execute(
            text(
                "SELECT tablename, policyname FROM pg_policies "
                "WHERE schemaname='public'"
            )
        ).all()
        assert policies == [], (
            "RLS policies exist. Adding one opens the Data API to anon-key "
            f"access: {[(p.tablename, p.policyname) for p in policies]}"
        )

    def test_refresh_tokens_are_not_exposed(self, db: Connection) -> None:
        """Session material is the worst thing to leak through the Data API."""
        enabled = db.execute(
            text(
                "SELECT relrowsecurity FROM pg_class "
                "WHERE oid='public.refresh_tokens'::regclass"
            )
        ).scalar_one()
        assert enabled is True
