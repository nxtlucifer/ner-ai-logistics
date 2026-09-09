-- Authorization core for the Supabase Data API.
--
-- WHY THIS EXISTS
--
-- Today authorization lives entirely in Python (app/core/permissions.py), and
-- that module says so explicitly: the backend connects as `postgres`, which has
-- rolbypassrls, so RLS never participated in a single authorization decision.
-- Every application table is RLS-enabled with ZERO policies - deny-all - which
-- is safe precisely because nothing but the FastAPI process ever connected.
--
-- Moving the backend to Supabase inverts that. Clients now reach Postgres
-- through PostgREST as `authenticated`, so the deny-all becomes the thing that
-- makes the product not work, and every rule permissions.py enforces has to be
-- restated here as policy. This file is that restatement's foundation: the
-- identity and permission predicates the policies in the next migration use.
--
-- WHY A SEPARATE `app` SCHEMA
--
-- These helpers must never be callable through the Data API as data. `app` is
-- deliberately NOT added to the exposed schema list, so PostgREST cannot see
-- it; only the policies (running inside the database) call these functions.
--
-- SECURITY DEFINER, AND THE RECURSION IT AVOIDS
--
-- A policy on public.users that reads public.users to find the caller's role
-- recurses until Postgres gives up. The role lookup therefore runs as the
-- definer, which bypasses RLS for that one narrow read. Each such function:
--   * pins search_path to '' and schema-qualifies every object, so a caller
--     cannot shadow `users` with a temp table and impersonate a manager;
--   * is STABLE, so the planner caches it per statement rather than per row;
--   * has EXECUTE revoked from PUBLIC and granted only where needed.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated;

-- app.current_user_id() is SECURITY INVOKER and calls auth.uid(), so the caller
-- needs USAGE on `auth`. Hosted Supabase already grants this; declaring it here
-- makes the dependency explicit rather than inherited, and keeps a local target
-- behaving identically. Guarded so the file also applies to a plain cluster.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    execute 'grant usage on schema auth to anon, authenticated';
  end if;
end $$;

-- The single indirection point for "who is calling".
--
-- Everything else in this file and the policy file goes through this, so the
-- identity source can be swapped (or stubbed, for the local RLS test harness)
-- in exactly one place.
create or replace function app.current_user_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.uid()
$$;

comment on function app.current_user_id() is
  'Authenticated caller''s id, equal to public.users.id by construction (see the identity migration). NULL for anonymous callers.';

-- Role of the caller, read as definer to break policy recursion on users.
--
-- Returns NULL for anonymous callers and for authenticated callers with no
-- row in public.users, so every downstream predicate fails closed.
create or replace function app.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
  from public.users u
  where u.id = auth.uid()
    and u.is_active
$$;

comment on function app.current_role() is
  'Server-controlled role from public.users. Never read from JWT user_metadata, which the user can edit.';

-- The permission catalogue, mirroring app/core/permissions.py ROLE_PERMISSIONS.
--
-- Kept as data in one function rather than scattered through policies for the
-- same reason the Python module exists: changing who may do something is a
-- change here, not a sweep through every policy. An unrecognised role gets the
-- empty set - failing closed, exactly as permissions_for() does.
create or replace function app.has_perm(permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case app.current_role()
    when 'ADMIN' then true
    when 'MANAGER' then permission in (
      'driver:read','driver:create','driver:update','driver:deactivate',
      'truck:read','truck:create','truck:update','truck:retire',
      'assignment:read','assignment:create','assignment:end','assignment:review',
      'shipment:read','shipment:create',
      'trip:read','trip:create','trip:dispatch','trip:cancel','trip:close',
      'route:read','route:plan','route:select',
      'fleet:location_read','audit:read')
    when 'DRIVER' then permission in (
      'driver:read','truck:read','assignment:read',
      'assignment:verify_own','trip:execute_own','location:submit_own')
    when 'AUTHORISED_REVIEWER' then permission in (
      'trip:read','route:read','route:review_authorize')
    else false
  end
$$;

comment on function app.has_perm(text) is
  'Mirrors ROLE_PERMISSIONS in app/core/permissions.py. ADMIN holds ALL_PERMISSIONS; unknown roles hold nothing.';

-- The caller's driver row, when they are one.
--
-- `own` is an object-level qualifier no permission string can express. In the
-- Python service layer the binding to *which* trip comes from the authenticated
-- driver and never from a request parameter; this is that same binding, and the
-- trip policies use it instead of trusting a client-supplied driver_id.
create or replace function app.current_driver_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
  from public.drivers d
  where d.user_id = auth.uid()
    and d.deleted_at is null
$$;

comment on function app.current_driver_id() is
  'drivers.id for the caller, or NULL. Object-level "own" binding; never accepts a client-supplied driver_id.';

-- Roster-wide reads of OTHER people's personal data.
--
-- NOT expressible as has_perm('driver:read'): the DRIVER role holds that
-- permission (see _DRIVER_PERMISSIONS), because it also gates a driver reading
-- their OWN profile. Reusing it for the roster would let any driver enumerate
-- every colleague's phone, licence number and emergency contact.
--
-- That weakness exists TODAY in GET /api/drivers, which is gated on
-- driver:read alone. It is not reproduced here. Neither client is affected:
-- manager-web lists the roster (MANAGER), the driver app never calls it.
create or replace function app.is_fleet_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.current_role() in ('MANAGER','ADMIN')
$$;

comment on function app.is_fleet_staff() is
  'True for MANAGER/ADMIN. Gates roster-wide reads of other people''s personal data, which driver:read must not, since DRIVER holds it.';

-- Can the caller see this trip at all? One predicate, so the trip policy and
-- every child-table policy (stops, routes, events, gps) agree by construction
-- rather than by four copies of the same disjunction drifting apart.
create or replace function app.can_read_trip(trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = trip
      and (
        app.has_perm('trip:read')
        or t.driver_id = app.current_driver_id()
      )
  )
$$;

comment on function app.can_read_trip(uuid) is
  'Managers/admins/reviewers hold trip:read; a driver sees only trips assigned to their own driver row.';

revoke all on function
  app.current_user_id(),
  app.current_role(),
  app.has_perm(text),
  app.current_driver_id(),
  app.is_fleet_staff(),
  app.can_read_trip(uuid)
from public;

grant execute on function
  app.current_user_id(),
  app.current_role(),
  app.has_perm(text),
  app.current_driver_id(),
  app.is_fleet_staff(),
  app.can_read_trip(uuid)
to authenticated;
