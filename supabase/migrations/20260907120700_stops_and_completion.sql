-- Stop arrival, stop completion, and trip completion.
--
-- Ports app/services/driver_trips.py::_mutate_stop and ::complete.
--
-- ORDERING IS CHECKED AFTER IDEMPOTENCY, NOT BEFORE
--
-- The Python module is explicit that this order was got wrong once and matters:
-- completing stop 1 settles it, the next actionable stop becomes stop 2, and a
-- RETRY of the same finish - resent because the response was lost - came back
-- as "stops are completed in order, stop 2 is next". A conflict for an action
-- that had already succeeded, at a depot, which is exactly where the signal is
-- worst and the retry most likely. So a stop already in the requested state
-- returns success before the ordering rule is consulted.
--
-- THE TRIP ROW IS LOCKED FIRST
--
-- Which serialises every stop mutation on that trip: two taps of "Arrived"
-- cannot both observe PENDING.
--
-- A stop id from another trip is NOT FOUND, not FORBIDDEN. Confirming the id
-- exists would tell a caller something about a trip that is not theirs.

create or replace function app.mutate_stop(
  p_stop_id  uuid,
  p_target   text,          -- 'ARRIVED' | 'COMPLETED'
  p_required text           -- the status the stop must currently hold
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_driver_id uuid;
  v_user_id   uuid;
  v_trip      public.trips;
  v_stop      public.trip_stops;
  v_next      public.trip_stops;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '28000', detail = '{"code":"NOT_AUTHENTICATED"}';
  end if;

  v_driver_id := app.current_driver_id();
  if v_driver_id is null or not app.has_perm('trip:execute_own') then
    raise exception 'not a driver'
      using errcode = '42501', detail = '{"code":"FORBIDDEN"}';
  end if;

  select t.* into v_trip
  from public.trips t
  where t.driver_id = v_driver_id
    and t.status not in ('CLOSED','CANCELLED')
  order by t.created_at desc
  limit 1
  for update of t;

  if not found then
    raise exception 'no trip'
      using errcode = 'P0002', detail = '{"code":"NO_ACTIVE_TRIP"}';
  end if;

  if v_trip.status not in ('ACTIVE','DELAYED') then
    raise exception 'Start the trip before updating stops.'
      using errcode = '55000',
            detail = json_build_object('code','TRIP_NOT_IN_PROGRESS',
                                       'current', v_trip.status)::text;
  end if;

  select s.* into v_stop
  from public.trip_stops s
  where s.id = p_stop_id and s.trip_id = v_trip.id;

  if not found then
    raise exception 'That stop is not part of your current trip.'
      using errcode = 'P0002', detail = '{"code":"STOP_NOT_FOUND"}';
  end if;

  -- Idempotent retry of a lost response. BEFORE the ordering rule: a stop that
  -- already reached the requested state is no longer the one due next, and
  -- refusing it would turn a successful action into a conflict.
  if v_stop.status::text = p_target then
    return jsonb_build_object('stop_id', v_stop.id, 'status', v_stop.status,
                              'trip_status', v_trip.status, 'idempotent', true);
  end if;

  select s.* into v_next
  from public.trip_stops s
  where s.trip_id = v_trip.id
    and s.status not in ('COMPLETED','SKIPPED')
  order by s.sequence
  limit 1;

  if v_next.id is null or v_next.id <> v_stop.id then
    raise exception 'Stops are completed in order.'
      using errcode = '55000',
            detail = json_build_object('code','STOP_OUT_OF_ORDER',
                                       'next_stop_id', v_next.id)::text;
  end if;

  if v_stop.status::text <> p_required then
    raise exception 'That stop is not ready for this action.'
      using errcode = '55000',
            detail = json_build_object('code','STOP_WRONG_STATE',
                                       'current', v_stop.status)::text;
  end if;

  update public.trip_stops s
     set status = p_target::public.trip_stop_status,
         actual_arrival_at   = case when p_target = 'ARRIVED'   then now() else s.actual_arrival_at end,
         actual_departure_at = case when p_target = 'COMPLETED' then now() else s.actual_departure_at end
   where s.id = v_stop.id
  returning s.* into v_stop;

  insert into public.trip_events (trip_id, kind, description, actor_user_id)
  values (v_trip.id,
          case when p_target = 'ARRIVED' then 'STOP_ARRIVED' else 'STOP_COMPLETED' end::public.trip_event_kind,
          'Stop ' || (v_stop.sequence + 1) || ' ' || lower(p_target) || '.',
          v_user_id);

  return jsonb_build_object('stop_id', v_stop.id, 'status', v_stop.status,
                            'trip_status', v_trip.status, 'idempotent', false);
end $$;

comment on function app.mutate_stop(uuid, text, text) is
  'Shared body of arrive and complete. Idempotency is checked before ordering, deliberately.';

create or replace function app.arrive_at_stop(p_stop_id uuid)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.mutate_stop(p_stop_id, 'ARRIVED', 'PENDING') $$;

create or replace function app.complete_stop(p_stop_id uuid)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.mutate_stop(p_stop_id, 'COMPLETED', 'ARRIVED') $$;

-- ---------------------------------------------------------------------------
-- app.complete_trip() : in progress -> DELIVERED
--
-- Every stop must be settled first. `delivered_at` uses the SERVER clock, never
-- the device's: a phone with a wrong or manipulated clock must not be able to
-- backdate a delivery.
--
-- Driver and truck are released CONDITIONALLY on being ON_TRIP - another trip,
-- or a manager, may have moved them, and overwriting that would report a
-- suspended driver as available.
-- ---------------------------------------------------------------------------
create or replace function app.complete_trip(p_trip_id uuid default null)
returns public.trips
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_driver_id   uuid;
  v_user_id     uuid;
  v_trip        public.trips;
  v_outstanding int;
  v_next        uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '28000', detail = '{"code":"NOT_AUTHENTICATED"}';
  end if;

  v_driver_id := app.current_driver_id();
  if v_driver_id is null or not app.has_perm('trip:execute_own') then
    raise exception 'not a driver'
      using errcode = '42501', detail = '{"code":"FORBIDDEN"}';
  end if;

  select t.* into v_trip
  from public.trips t
  where t.driver_id = v_driver_id
    and (p_trip_id is null or t.id = p_trip_id)
    and t.status not in ('CLOSED','CANCELLED')
  order by t.created_at desc
  limit 1
  for update of t;

  if not found then
    raise exception 'no trip'
      using errcode = 'P0002', detail = '{"code":"NO_ACTIVE_TRIP"}';
  end if;

  -- Already delivered: a retry after a lost response, not a second delivery.
  if v_trip.status = 'DELIVERED' then
    return v_trip;
  end if;

  if v_trip.status not in ('ACTIVE','DELAYED') then
    raise exception 'This trip is not in progress.'
      using errcode = '55000',
            detail = json_build_object('code','TRIP_NOT_IN_PROGRESS',
                                       'current', v_trip.status)::text;
  end if;

  select count(*) into v_outstanding
  from public.trip_stops s
  where s.trip_id = v_trip.id and s.status not in ('COMPLETED','SKIPPED');

  -- The FIRST outstanding stop by sequence, not min(id): there is no min()
  -- aggregate for uuid, and the driver needs the stop that is actually next.
  select s.id into v_next
  from public.trip_stops s
  where s.trip_id = v_trip.id and s.status not in ('COMPLETED','SKIPPED')
  order by s.sequence
  limit 1;

  if v_outstanding > 0 then
    raise exception '% stop(s) are not finished yet.', v_outstanding
      using errcode = '55000',
            detail = json_build_object('code','STOPS_INCOMPLETE',
                                       'next_stop_id', v_next)::text;
  end if;

  update public.trips t
     set status = 'DELIVERED', delivered_at = now(), updated_at = now()
   where t.id = v_trip.id
  returning t.* into v_trip;

  update public.drivers d set status = 'AVAILABLE', updated_at = now()
   where d.id = v_driver_id and d.status = 'ON_TRIP';
  update public.trucks tr set status = 'AVAILABLE', updated_at = now()
   where tr.id = v_trip.truck_id and tr.status = 'ON_TRIP';

  insert into public.trip_events (trip_id, kind, description, actor_user_id)
  values (v_trip.id, 'DELIVERED', 'Trip completed by the driver.', v_user_id);

  return v_trip;
end $$;

comment on function app.complete_trip(uuid) is
  'In progress -> DELIVERED once every stop is settled. Server clock only; releases driver/truck conditionally.';

-- ---------------------------------------------------------------------------
-- Driver truck verification. P4 exists so a driver confirms the physical
-- vehicle before driving it; the start gate refuses an unverified assignment.
-- ---------------------------------------------------------------------------
create or replace function app.verify_assignment(p_registration text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_driver_id  uuid;
  v_user_id    uuid;
  v_assignment public.driver_truck_assignments;
  v_truck      public.trucks;
  v_mismatch   boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '28000', detail = '{"code":"NOT_AUTHENTICATED"}';
  end if;

  v_driver_id := app.current_driver_id();
  if v_driver_id is null or not app.has_perm('assignment:verify_own') then
    raise exception 'not a driver'
      using errcode = '42501', detail = '{"code":"FORBIDDEN"}';
  end if;

  select a.* into v_assignment
  from public.driver_truck_assignments a
  where a.driver_id = v_driver_id
    and a.status in ('ACTIVE','PENDING_VERIFICATION')
  order by a.assigned_at desc
  limit 1
  for update of a;

  if not found then
    raise exception 'no assignment'
      using errcode = 'P0002', detail = '{"code":"NO_ACTIVE_ASSIGNMENT"}';
  end if;

  -- Idempotent: verifying twice is a retry, not a second check.
  if v_assignment.verified_at is not null then
    return jsonb_build_object('verified_at', v_assignment.verified_at,
                              'mismatch_flagged', v_assignment.mismatch_flagged,
                              'idempotent', true);
  end if;

  select t.* into v_truck from public.trucks t where t.id = v_assignment.truck_id;

  -- A mismatch is FLAGGED, never refused. A driver standing at the wrong truck
  -- still needs to tell someone, and blocking the report would leave the
  -- manager knowing nothing.
  v_mismatch := v_truck.registration_number is distinct from upper(trim(coalesce(p_registration, '')));

  update public.driver_truck_assignments a
     set verified_at = now(),
         mismatch_flagged = v_mismatch,
         reported_registration = upper(trim(coalesce(p_registration, ''))),
         status = 'ACTIVE'
   where a.id = v_assignment.id
  returning a.* into v_assignment;

  return jsonb_build_object('verified_at', v_assignment.verified_at,
                            'mismatch_flagged', v_assignment.mismatch_flagged,
                            'idempotent', false);
end $$;

comment on function app.verify_assignment(text) is
  'Driver confirms the physical truck. A registration mismatch is flagged, never refused.';

-- Client-reachable entrypoints.
create or replace function public.arrive_at_stop(p_stop_id uuid)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select app.arrive_at_stop(p_stop_id) $$;

create or replace function public.complete_stop(p_stop_id uuid)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select app.complete_stop(p_stop_id) $$;

create or replace function public.complete_trip(p_trip_id uuid default null)
returns public.trips language sql volatile security invoker set search_path = ''
as $$ select app.complete_trip(p_trip_id) $$;

create or replace function public.verify_assignment(p_registration text)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select app.verify_assignment(p_registration) $$;

revoke all on function
  app.mutate_stop(uuid, text, text), app.arrive_at_stop(uuid), app.complete_stop(uuid),
  app.complete_trip(uuid), app.verify_assignment(text),
  public.arrive_at_stop(uuid), public.complete_stop(uuid),
  public.complete_trip(uuid), public.verify_assignment(text)
from public;

grant execute on function
  app.arrive_at_stop(uuid), app.complete_stop(uuid),
  app.complete_trip(uuid), app.verify_assignment(text),
  public.arrive_at_stop(uuid), public.complete_stop(uuid),
  public.complete_trip(uuid), public.verify_assignment(text)
to authenticated;
