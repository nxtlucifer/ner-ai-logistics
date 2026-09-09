-- The RPC surface PostgREST is allowed to see.
--
-- WHY WRAPPERS RATHER THAN EXPOSING `app`
--
-- PostgREST can only call functions in an exposed schema, and `app` is
-- deliberately not one - it holds the authorization predicates the policies use
-- (`has_perm`, `current_role`, `is_fleet_staff`, `can_read_trip`). Exposing the
-- whole schema to reach two entrypoints would publish all of them as callable
-- RPC. They are individually safe, but a security surface should be the set of
-- things you meant to expose, not everything that happened to be next to them.
--
-- So `public` carries thin, SECURITY INVOKER wrappers for exactly the two
-- operations a client performs, and nothing else. The wrapper adds no logic and
-- makes no decision: the guarded `app.*` function it calls is still where
-- identity, permission, ownership, state and idempotency are checked, and it is
-- still SECURITY DEFINER. A caller who reaches the wrapper without a right is
-- refused one frame deeper, exactly as if they had called it directly.
--
-- SECURITY INVOKER here is deliberate. If these wrappers were DEFINER they
-- would run as the owner and `auth.uid()` inside the inner function would still
-- be the session's, but the wrapper itself would gain owner rights for no
-- reason. Invoker keeps the wrapper as powerless as the caller.

create or replace function public.accept_trip(p_trip_id uuid default null)
returns public.trips
language sql
volatile
security invoker
set search_path = ''
as $$
  select app.accept_trip(p_trip_id)
$$;

comment on function public.accept_trip(uuid) is
  'RPC entrypoint for the driver app Accept button. Delegates to app.accept_trip, which performs every check.';

create or replace function public.submit_location_batch(p_fixes jsonb)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app.submit_location_batch(p_fixes)
$$;

comment on function public.submit_location_batch(jsonb) is
  'RPC entrypoint for POST /api/driver/me/location parity. Delegates to app.submit_location_batch.';

-- EXECUTE is the whole access decision for an RPC, so it is stated explicitly
-- rather than inherited from PUBLIC's default.
revoke all on function
  public.accept_trip(uuid),
  public.submit_location_batch(jsonb)
from public;

grant execute on function
  public.accept_trip(uuid),
  public.submit_location_batch(jsonb)
to authenticated;

-- Deliberately NOT wrapped, and therefore not reachable by any client:
--   app.identity_status()   - an operations check, run by a human against the
--                             project, not something a device should enumerate.
--   app.has_perm(), app.current_role(), app.is_fleet_staff(),
--   app.current_driver_id(), app.can_read_trip()
--                           - policy internals. A client has no reason to ask
--                             the database what it is allowed to do; it finds
--                             out by being allowed to do it, or not.
