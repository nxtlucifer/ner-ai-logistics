-- Atomic route selection and reroute acceptance.
--
-- WHY THIS EXISTS
--
-- Both operations were performed as a sequence of independent PostgREST writes
-- from the browser, with no transaction around them. `selectRoute` did three:
-- demote every SELECTED row, promote the requested row, then point
-- `trips.selected_route_id` at it. `acceptReroute` did three more and checked
-- the error on none of them - it returned a hardcoded success object whatever
-- happened.
--
-- The failure modes were not theoretical. Each write can fail or be lost
-- independently, so the reachable states included:
--
--   * demote succeeds, promote fails            -> ZERO selected routes
--   * demote fails (error discarded), promote succeeds -> TWO selected routes
--   * both succeed, trips update fails          -> trip_routes says B while
--                                                  trips.selected_route_id
--                                                  still says A, so the manager
--                                                  is looking at B and the
--                                                  driver is authoritatively on A
--   * two managers act at once                  -> both demote, both promote,
--                                                  TWO selected routes
--
-- On a platform whose whole subject is weak connectivity and manager/driver
-- synchronisation across disrupted corridors, a half-applied route change is
-- the one outcome that must be impossible. It is now one transaction.
--
-- THE CONCURRENCY TOKEN IS THE CURRENTLY-SELECTED ROUTE, NOT A REVISION COUNTER
--
-- `route_revision` already exists in this system and means something else: it
-- is a CONTENT HASH of a route's geometry plus maneuvers, computed in
-- `backend/app/services/navigation.py`, deliberately derived so a package's
-- identity cannot disagree with the geometry it carries. Introducing a second,
-- stored, incrementing column also called a revision would leave two different
-- things under one name - one binding content, one binding order - which is a
-- trap for the next reader.
--
-- The identity of the route currently selected is already a perfectly good
-- optimistic-concurrency token: it changes on exactly the events we care about,
-- it needs no schema change, and it is already what the client passes to
-- `acceptReroute(tripId, fromRouteId, toRouteId)`. So `p_expected_route_id`
-- means "I am acting on the belief that THIS route is currently selected".
--
--   null  -> "I believe nothing is selected yet" (first selection)
--   uuid  -> "I believe this is selected" (reroute, or a re-select)
--
-- IDEMPOTENCY IS CHECKED BEFORE THE EXPECTATION
--
-- A transaction can commit and its response can still be lost. The client then
-- retries with an expectation that is now out of date, and a naive check would
-- answer CONFLICT for a request that in fact already succeeded. So if the
-- requested route is ALREADY the selected one, this returns canonical state
-- unchanged - no writes, no second audit row - whatever the expectation says.
-- Retry therefore converges instead of flapping.

create or replace function app.select_route(
  p_trip_id uuid,
  p_route_id uuid,
  p_expected_route_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $body$
declare
  v_user_id  uuid;
  v_trip     public.trips;
  v_route    public.trip_routes;
  v_current  uuid;
  v_selected integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '28000', detail = '{"code":"NOT_AUTHENTICATED"}';
  end if;

  if not app.has_perm('route:select') then
    raise exception 'forbidden'
      using errcode = '42501', detail = '{"code":"FORBIDDEN"}';
  end if;

  -- Serialises concurrent selections on the SAME trip. Two managers acting at
  -- once are ordered here rather than racing between a demote and a promote;
  -- the second waits, then re-reads state and is judged against it.
  select t.* into v_trip
    from public.trips t
   where t.id = p_trip_id
     for update;

  if not found then
    raise exception 'trip not found'
      using errcode = 'P0002', detail = '{"code":"TRIP_NOT_FOUND"}';
  end if;

  -- The route must belong to THIS trip. Without this a caller could pass any
  -- route id and promote a corridor from somebody else's trip; the old client
  -- code matched on `id` alone.
  select r.* into v_route
    from public.trip_routes r
   where r.id = p_route_id
     and r.trip_id = p_trip_id;

  if not found then
    raise exception 'route does not belong to this trip'
      using errcode = 'P0002', detail = '{"code":"ROUTE_NOT_FOUND_FOR_TRIP"}';
  end if;

  select t2.selected_route_id into v_current
    from public.trips t2 where t2.id = p_trip_id;

  -- IDEMPOTENT RETRY. Checked before the expectation, on purpose - see header.
  if v_current is not null and v_current = p_route_id
     and v_route.state = 'SELECTED' then
    return app.selected_route_state(p_trip_id, 'IDEMPOTENT');
  end if;

  -- ORDER MATTERS, AND STALENESS COMES FIRST.
  --
  -- A caller can be both stale and pointing at a blocked route. Answering
  -- ROUTE_BLOCKED there tells them a fact about a screen that no longer
  -- reflects reality, and invites them to reason about it - "why is B blocked,
  -- it was fine a moment ago" - when the real answer is that the trip moved on
  -- and everything they are looking at needs re-reading. Staleness is a
  -- precondition on the whole request; blocked is a property of one route.
  --
  -- Idempotency is still checked before both, above: a retry of a request that
  -- already succeeded is not a conflict.
  --
  -- `p_expected_route_id` null means "no expectation stated".
  if p_expected_route_id is not null and v_current is distinct from p_expected_route_id then
    raise exception 'route changed elsewhere'
      using errcode = '40001', detail = json_build_object(
        'code', 'STALE_ROUTE_REVISION',
        'expected_route_id', p_expected_route_id,
        'actual_route_id', v_current
      )::text;
  end if;

  -- A blocked corridor is never selectable, whatever the caller believes.
  if v_route.state = 'REJECTED_BLOCKED' then
    raise exception 'route is blocked and cannot be selected'
      using errcode = '55000', detail = '{"code":"ROUTE_BLOCKED"}';
  end if;

  -- Demote every other selected corridor for this trip. SUPERSEDED, not
  -- PROPOSED: the route was chosen and then replaced, and the timeline should
  -- say so. `superseded_by` records what replaced it.
  update public.trip_routes r
     set state = 'SUPERSEDED',
         superseded_by = p_route_id
   where r.trip_id = p_trip_id
     and r.id <> p_route_id
     and r.state = 'SELECTED';

  update public.trip_routes r
     set state = 'SELECTED',
         superseded_by = null
   where r.id = p_route_id;

  update public.trips t
     set selected_route_id = p_route_id,
         updated_at = now()
   where t.id = p_trip_id;

  -- The invariant, asserted rather than assumed. If anything above ever leaves
  -- a second selected row - a trigger, a policy, a future edit - this raises
  -- and the whole transaction rolls back, so the corrupt state is never
  -- committed and never reaches a driver.
  select count(*) into v_selected
    from public.trip_routes r
   where r.trip_id = p_trip_id and r.state = 'SELECTED';

  if v_selected <> 1 then
    raise exception 'route selection invariant violated: % selected rows', v_selected
      using errcode = '55000', detail = '{"code":"SELECTION_INVARIANT_VIOLATED"}';
  end if;

  insert into public.trip_events (trip_id, kind, description, actor_user_id)
  values (
    p_trip_id,
    'ROUTE_CHANGED',
    coalesce(p_reason, 'Route selected by manager'),
    v_user_id
  );

  return app.selected_route_state(p_trip_id, 'APPLIED');
end;
$body$;

-- The canonical answer to "what is selected on this trip", used as the return
-- value of every mutation here so a client never has to assemble that picture
-- from separate reads. `route_revision` is deliberately ABSENT: it is a
-- property of a navigation package's content, served by the navigation plane,
-- and inventing one here would create a second source of truth for it.
create or replace function app.selected_route_state(p_trip_id uuid, p_outcome text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $body$
declare
  v_route public.trip_routes;
  v_trip  public.trips;
begin
  select t.* into v_trip from public.trips t where t.id = p_trip_id;

  select r.* into v_route
    from public.trip_routes r
   where r.trip_id = p_trip_id and r.state = 'SELECTED';

  return jsonb_build_object(
    'outcome', p_outcome,
    'trip_id', p_trip_id,
    'selected_route_id', v_trip.selected_route_id,
    'selected_route_kind', v_route.kind,
    'selected_route_state', v_route.state,
    'trip_status', v_trip.status
  );
end;
$body$;

-- Reroute acceptance.
--
-- Deliberately a thin wrapper rather than a second copy of the logic: accepting
-- a reroute IS selecting a route, with the additional requirement that the
-- caller names the corridor being left. Two implementations of one rule drift;
-- the previous client code proved that by checking authority in neither.
create or replace function app.accept_reroute(
  p_trip_id uuid,
  p_from_route_id uuid,
  p_to_route_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $body$
declare
  v_result jsonb;
begin
  -- The route being left is the expectation. If the trip has already moved on,
  -- this is a stale screen and the mutation is refused rather than applied over
  -- somebody else's decision.
  v_result := app.select_route(
    p_trip_id,
    p_to_route_id,
    p_from_route_id,
    'Reroute accepted by manager'
  );

  return v_result || jsonb_build_object('previous_route_id', p_from_route_id);
end;
$body$;

create or replace function public.select_route(
  p_trip_id uuid,
  p_route_id uuid,
  p_expected_route_id uuid default null,
  p_reason text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app.select_route(p_trip_id, p_route_id, p_expected_route_id, p_reason)
$$;

create or replace function public.accept_reroute(
  p_trip_id uuid,
  p_from_route_id uuid,
  p_to_route_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app.accept_reroute(p_trip_id, p_from_route_id, p_to_route_id)
$$;

revoke all on function public.select_route(uuid, uuid, uuid, text) from public;
revoke all on function public.accept_reroute(uuid, uuid, uuid) from public;
grant execute on function public.select_route(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.accept_reroute(uuid, uuid, uuid) to authenticated;
