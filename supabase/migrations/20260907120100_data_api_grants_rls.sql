-- Data API grants and RLS policies.
--
-- A missing GRANT and a missing POLICY are different defects and this file
-- keeps them visibly separate: the grant decides whether PostgREST can see the
-- relation at all, the policy decides which rows. Both are required; neither
-- substitutes for the other.
--
-- SHAPE OF THE RULES
--
-- Reads are policy-controlled. Writes are NOT granted on operational tables at
-- all: every state change goes through a guarded function in the next
-- migration, which re-checks ownership, state and closure inside one
-- transaction. That is what makes "a driver cannot edit assignment ownership,
-- fleet role, closure state, or arbitrary status columns through direct table
-- access" true by construction rather than by a column whitelist someone has
-- to remember to update.
--
-- Nothing here is granted to `anon`. Anonymous callers get no trips, no contact
-- details and no locations; the deny-all that RLS-without-policies already
-- produced stays in force for them.

-- ---------------------------------------------------------------------------
-- Baseline: revoke anything a default privilege may have handed out.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'users','drivers','trucks','driver_truck_assignments','shipments',
    'cargo_items','trips','trip_stops','trip_routes','trip_events',
    'gps_points','audit_logs','refresh_tokens','driver_documents',
    'truck_documents','truck_maintenance','system_info','alembic_version'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
  -- Present only from migration 0007 onward; the hosted project is at 0006.
  if to_regclass('public.route_review_authorizations') is not null then
    execute 'revoke all on public.route_review_authorizations from anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- users - column-level grant, because password_hash must never leave the row.
--
-- Column-level SELECT is the reason this is a GRANT list and not `select *`:
-- an RLS policy filters ROWS, it cannot hide a COLUMN, so a row-level rule
-- alone would publish every argon2 hash to any authenticated caller who can
-- see the row.
-- ---------------------------------------------------------------------------
grant select (id, email, phone, role, display_name, is_active, created_at, updated_at, last_login_at)
  on public.users to authenticated;

drop policy if exists users_read_self_or_staff on public.users;
create policy users_read_self_or_staff on public.users
  for select to authenticated
  using (
    id = app.current_user_id()
    or app.is_fleet_staff()
  );

-- ---------------------------------------------------------------------------
-- drivers - salary is manager-invisible by design (ADMIN holds
-- driver:read_sensitive, MANAGER deliberately does not), so base_salary_monthly
-- is excluded from the grant entirely rather than filtered per caller.
-- ---------------------------------------------------------------------------
grant select (id, user_id, full_name, photo_url, phone, emergency_contact_name,
              emergency_contact_phone, licence_number, licence_class,
              licence_expiry, date_of_joining, status, created_at, updated_at, deleted_at)
  on public.drivers to authenticated;

drop policy if exists drivers_read_self_or_staff on public.drivers;
create policy drivers_read_self_or_staff on public.drivers
  for select to authenticated
  using (
    deleted_at is null
    and (
      user_id = app.current_user_id()
      or app.is_fleet_staff()
    )
  );

-- ---------------------------------------------------------------------------
-- trucks / maintenance
-- ---------------------------------------------------------------------------
grant select on public.trucks to authenticated;
drop policy if exists trucks_read on public.trucks;
create policy trucks_read on public.trucks
  for select to authenticated
  using (app.has_perm('truck:read'));

grant select on public.truck_maintenance to authenticated;
drop policy if exists truck_maintenance_read on public.truck_maintenance;
create policy truck_maintenance_read on public.truck_maintenance
  for select to authenticated
  using (app.has_perm('truck:read'));

-- ---------------------------------------------------------------------------
-- assignments - a driver sees only their own pairing.
-- ---------------------------------------------------------------------------
grant select on public.driver_truck_assignments to authenticated;
drop policy if exists assignments_read on public.driver_truck_assignments;
create policy assignments_read on public.driver_truck_assignments
  for select to authenticated
  using (
    driver_id = app.current_driver_id()
    or app.has_perm('assignment:read')
  );

-- ---------------------------------------------------------------------------
-- shipments and cargo
-- ---------------------------------------------------------------------------
grant select on public.shipments to authenticated;
drop policy if exists shipments_read on public.shipments;
create policy shipments_read on public.shipments
  for select to authenticated
  using (
    app.has_perm('shipment:read')
    or exists (
      select 1 from public.trips t
      where t.shipment_id = public.shipments.id
        and t.driver_id = app.current_driver_id()
    )
  );

grant select on public.cargo_items to authenticated;
drop policy if exists cargo_items_read on public.cargo_items;
create policy cargo_items_read on public.cargo_items
  for select to authenticated
  using (
    app.has_perm('shipment:read')
    or exists (
      select 1 from public.trips t
      where t.shipment_id = public.cargo_items.shipment_id
        and t.driver_id = app.current_driver_id()
    )
  );

-- ---------------------------------------------------------------------------
-- trips and their children. No write grants: see the guarded functions.
-- ---------------------------------------------------------------------------
grant select on public.trips to authenticated;
drop policy if exists trips_read on public.trips;
create policy trips_read on public.trips
  for select to authenticated
  using (
    app.has_perm('trip:read')
    or driver_id = app.current_driver_id()
  );

grant select on public.trip_stops to authenticated;
drop policy if exists trip_stops_read on public.trip_stops;
create policy trip_stops_read on public.trip_stops
  for select to authenticated
  using (app.can_read_trip(trip_id));

grant select on public.trip_routes to authenticated;
drop policy if exists trip_routes_read on public.trip_routes;
create policy trip_routes_read on public.trip_routes
  for select to authenticated
  using (app.can_read_trip(trip_id));

grant select on public.trip_events to authenticated;
drop policy if exists trip_events_read on public.trip_events;
create policy trip_events_read on public.trip_events
  for select to authenticated
  using (app.can_read_trip(trip_id));

-- ---------------------------------------------------------------------------
-- gps_points - the most sensitive data the system holds (docs/SECURITY.md §3).
--
-- fleet:location_read is deliberately its own permission rather than folded
-- into trip:read, and that split is preserved here: an AUTHORISED_REVIEWER
-- holds trip:read and can therefore see a trip, but NOT where its driver is.
-- ---------------------------------------------------------------------------
grant select on public.gps_points to authenticated;
drop policy if exists gps_points_read on public.gps_points;
create policy gps_points_read on public.gps_points
  for select to authenticated
  using (
    app.has_perm('fleet:location_read')
    or exists (
      select 1 from public.trips t
      where t.id = public.gps_points.trip_id
        and t.driver_id = app.current_driver_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Documents - sensitive. Drivers see their own; only driver:read_sensitive
-- (ADMIN) sees everyone's.
-- ---------------------------------------------------------------------------
grant select on public.driver_documents to authenticated;
drop policy if exists driver_documents_read on public.driver_documents;
create policy driver_documents_read on public.driver_documents
  for select to authenticated
  using (
    driver_id = app.current_driver_id()
    or app.has_perm('driver:read_sensitive')
  );

grant select on public.truck_documents to authenticated;
drop policy if exists truck_documents_read on public.truck_documents;
create policy truck_documents_read on public.truck_documents
  for select to authenticated
  using (app.has_perm('truck:read'));

-- ---------------------------------------------------------------------------
-- audit_logs - readable only with audit:read, never by a driver.
-- ---------------------------------------------------------------------------
grant select on public.audit_logs to authenticated;
drop policy if exists audit_logs_read on public.audit_logs;
create policy audit_logs_read on public.audit_logs
  for select to authenticated
  using (app.has_perm('audit:read'));

-- ---------------------------------------------------------------------------
-- Deliberately NOT exposed to the Data API at all, by having no grant:
--
--   refresh_tokens   - the local FastAPI session store. Supabase Auth replaces
--                      it; publishing it would hand out session material.
--   alembic_version  - leaks the exact schema revision to any caller.
--   system_info      - bootstrap marker, of no use to a client.
--
-- They keep RLS enabled and no policy, so even a future accidental grant still
-- returns nothing.
-- ---------------------------------------------------------------------------
