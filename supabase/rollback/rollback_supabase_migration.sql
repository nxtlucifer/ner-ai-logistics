-- Tested rollback for the eight Supabase SQL migrations.
--
-- WHAT THIS RESTORES
--
-- The exact pre-migration posture: every application table RLS-enabled with
-- ZERO policies and no Data API grants (deny-all), no `app` schema, and no
-- public RPC surface. That was a safe state precisely because only FastAPI, as
-- `postgres`, ever connected - so rolling back returns the project to a
-- configuration the existing backend still works against.
--
-- WHAT IT DELIBERATELY DOES NOT TOUCH
--
--   * No application table is altered, truncated or dropped. Not one row of
--     trip, driver, truck, shipment, GPS or audit data is affected: the
--     migrations only ADDED a schema, grants, policies and functions.
--   * `auth.users` is left alone. Identity rows created by an Auth import are
--     NOT deleted here - removing them would sign real people out and is a
--     separate, deliberate decision. `public.users` is untouched either way,
--     and because the mapping is `auth.users.id = public.users.id` with no
--     foreign key, leaving Auth rows in place breaks nothing.
--   * The 33 unresolved accounts, and every fixture row, are left exactly as
--     they are. Nothing in this file classifies or removes accounts.
--
-- WHY NOT `drop schema app cascade` ALONE
--
-- CASCADE would silently drop anything that came to depend on `app` - including
-- policies on application tables, which would leave those tables RLS-enabled
-- but with their policies gone in an unrecorded way. Dropping the dependents
-- explicitly, in order, is what makes the end state knowable rather than
-- whatever CASCADE happened to reach.

begin;

-- 1. Policies first, by name, so the set removed is the set this migration
--    added and nothing else. IF EXISTS so a partial apply still rolls back.
drop policy if exists users_read_self_or_staff        on public.users;
drop policy if exists drivers_read_self_or_staff      on public.drivers;
drop policy if exists trucks_read                     on public.trucks;
drop policy if exists truck_maintenance_read          on public.truck_maintenance;
drop policy if exists assignments_read                on public.driver_truck_assignments;
drop policy if exists shipments_read                  on public.shipments;
drop policy if exists cargo_items_read                on public.cargo_items;
drop policy if exists trips_read                      on public.trips;
drop policy if exists trip_stops_read                 on public.trip_stops;
drop policy if exists trip_routes_read                on public.trip_routes;
drop policy if exists trip_events_read                on public.trip_events;
drop policy if exists gps_points_read                 on public.gps_points;
drop policy if exists driver_documents_read           on public.driver_documents;
drop policy if exists truck_documents_read            on public.truck_documents;
drop policy if exists audit_logs_read                 on public.audit_logs;

-- 2. The public RPC surface.
drop function if exists public.accept_trip(uuid);
drop function if exists public.submit_location_batch(jsonb);
drop function if exists public.start_trip(uuid);
drop function if exists public.start_gate(uuid);
drop function if exists public.driver_trip_payload(uuid);
drop function if exists public.arrive_at_stop(uuid);
drop function if exists public.complete_stop(uuid);
drop function if exists public.complete_trip(uuid);
drop function if exists public.verify_assignment(text);

-- 3. Every Data API grant, returning the tables to invisible.
do $$
declare t text;
begin
  foreach t in array array[
    'users','drivers','trucks','driver_truck_assignments','shipments',
    'cargo_items','trips','trip_stops','trip_routes','trip_events',
    'gps_points','audit_logs','refresh_tokens','driver_documents',
    'truck_documents','truck_maintenance','system_info','alembic_version',
    'route_review_authorizations'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- 4. The internal schema last, once nothing references it. Explicit, not
--    CASCADE: if something unexpected still depends on `app`, this fails loudly
--    and tells you what, instead of quietly dropping it.
drop function if exists app.verify_assignment(text);
drop function if exists app.complete_trip(uuid);
drop function if exists app.complete_stop(uuid);
drop function if exists app.arrive_at_stop(uuid);
drop function if exists app.mutate_stop(uuid, text, text);
drop function if exists app.driver_trip_payload(uuid);
drop function if exists app.start_trip(uuid);
drop function if exists app.start_gate(uuid);
drop function if exists app.submit_location_batch(jsonb);
drop function if exists app.submit_location(double precision, double precision, uuid, timestamptz, numeric, numeric, numeric, boolean);
drop function if exists app.accept_trip(uuid);
drop function if exists app.identity_status();
drop function if exists app.can_read_trip(uuid);
drop function if exists app.is_fleet_staff();
drop function if exists app.current_driver_id();
drop function if exists app.has_perm(text);
drop function if exists app.current_role();
drop function if exists app.current_user_id();
drop schema if exists app restrict;

commit;

-- Verify: every application table must be back to RLS-on / zero-policies, and
-- `app` must be gone. Run this after the rollback and expect zero rows.
--
--   select c.relname, c.relrowsecurity,
--          (select count(*) from pg_policies p
--             where p.schemaname='public' and p.tablename=c.relname) as policies
--   from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='public' and c.relkind='r'
--     and (not c.relrowsecurity or exists (
--       select 1 from pg_policies p
--        where p.schemaname='public' and p.tablename=c.relname));
