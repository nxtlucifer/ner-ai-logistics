-- Driver start: the gate, and the transition it guards.
--
-- Ports app/services/driver_trips.py::evaluate_start and ::start.
--
-- ONE IMPLEMENTATION SERVES THE READ AND THE WRITE
--
-- The Python docstring is emphatic about this and the reason is worth keeping:
-- `GET /api/driver/me/trip` uses the gate to say WHY the Start button is
-- disabled, and `POST .../start` uses it to refuse. A second copy for the UI is
-- how a screen comes to show an enabled button the server then rejects - or a
-- disabled one when the driver could in fact go. So `app.start_gate()` is the
-- only place the rules exist, and `app.start_trip()` calls it.
--
-- RE-CHECKED AT START TIME, NOT TRUSTED FROM DISPATCH. A truck can break down
-- and an assignment can be ended between a manager dispatching a trip and a
-- driver tapping Start, so every prerequisite is evaluated against current
-- state inside the transaction that performs the transition.

-- Returns the blocking code and message, or nulls when the trip may start.
-- Read-only: safe for the UI to call on every render.
create or replace function app.start_gate(p_trip_id uuid default null)
returns table (trip_id uuid, blocked_code text, blocked_reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_driver_id  uuid;
  v_trip       public.trips;
  v_truck      public.trucks;
  v_assignment public.driver_truck_assignments;
begin
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
  limit 1;

  if not found then
    raise exception 'no trip'
      using errcode = 'P0002', detail = '{"code":"NO_ACTIVE_TRIP"}';
  end if;

  trip_id := v_trip.id;

  if v_trip.status <> 'ASSIGNED' then
    blocked_code := 'TRIP_NOT_STARTABLE';
    blocked_reason := 'This trip is ' || replace(lower(v_trip.status::text), '_', ' ') || '.';
    return next; return;
  end if;

  select tr.* into v_truck from public.trucks tr where tr.id = v_trip.truck_id;
  if not found then
    blocked_code := 'TRUCK_MISSING';
    blocked_reason := 'This trip''s truck no longer exists.';
    return next; return;
  end if;

  if v_truck.status in ('RETIRED','BREAKDOWN','MAINTENANCE') then
    blocked_code := 'TRUCK_NOT_OPERATIONAL';
    blocked_reason := 'Truck is ' || replace(lower(v_truck.status::text), '_', ' ')
                      || ' and cannot start a trip.';
    return next; return;
  end if;

  -- The driver's current assignment, only if it is for THIS truck. Holding one
  -- for a different truck means the same thing as holding none: this driver is
  -- not responsible for this vehicle.
  select a.* into v_assignment
  from public.driver_truck_assignments a
  where a.driver_id = v_driver_id
    and a.truck_id = v_trip.truck_id
    and a.status in ('ACTIVE','PENDING_VERIFICATION')
  order by a.assigned_at desc
  limit 1;

  if not found then
    blocked_code := 'NO_ACTIVE_ASSIGNMENT';
    blocked_reason := 'You are no longer assigned to this truck. Speak to your manager.';
    return next; return;
  end if;

  if v_assignment.verified_at is null then
    -- P4's verification exists so a driver confirms the physical vehicle before
    -- driving it. Starting unverified would make that check optional in practice.
    blocked_code := 'ASSIGNMENT_NOT_VERIFIED';
    blocked_reason := 'Check the truck before starting the trip.';
    return next; return;
  end if;

  blocked_code := null;
  blocked_reason := null;
  return next;
end $$;

comment on function app.start_gate(uuid) is
  'Every prerequisite for driving away, without mutating. Serves both the UI reason and the server refusal, so they cannot disagree.';

-- ASSIGNED -> ACTIVE. The truck is on the road from here.
create or replace function app.start_trip(p_trip_id uuid default null)
returns public.trips
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_driver_id uuid;
  v_user_id   uuid;
  v_trip      public.trips;
  v_gate      record;
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

  -- Already started: almost always a retry after a lost response rather than a
  -- second driver. Idempotent, for the same reason acceptance is.
  if v_trip.status in ('ACTIVE','DELAYED') then
    return v_trip;
  end if;

  select * into v_gate from app.start_gate(v_trip.id);
  if v_gate.blocked_code is not null then
    raise exception '%', v_gate.blocked_reason
      using errcode = '55000',
            detail = json_build_object('code', v_gate.blocked_code)::text;
  end if;

  update public.trips t
     set status = 'ACTIVE', started_at = now(), updated_at = now()
   where t.id = v_trip.id
  returning t.* into v_trip;

  -- Both become unavailable to the planner. CONDITIONAL, so a manager who has
  -- deliberately marked the driver OFF_DUTY is not silently overwritten.
  update public.drivers d set status = 'ON_TRIP', updated_at = now()
   where d.id = v_driver_id and d.status = 'AVAILABLE';
  update public.trucks tr set status = 'ON_TRIP', updated_at = now()
   where tr.id = v_trip.truck_id and tr.status = 'AVAILABLE';

  insert into public.trip_events (trip_id, kind, description, actor_user_id)
  values (v_trip.id, 'STARTED', 'Driver started the trip.', v_user_id);

  return v_trip;
end $$;

comment on function app.start_trip(uuid) is
  'ASSIGNED -> ACTIVE behind app.start_gate. Idempotent on an already-running trip; driver/truck status updated only from AVAILABLE.';

-- Client-reachable entrypoints. See the rpc surface migration for why `app`
-- itself is not exposed.
create or replace function public.start_trip(p_trip_id uuid default null)
returns public.trips
language sql volatile security invoker set search_path = ''
as $$ select app.start_trip(p_trip_id) $$;

create or replace function public.start_gate(p_trip_id uuid default null)
returns table (trip_id uuid, blocked_code text, blocked_reason text)
language sql stable security invoker set search_path = ''
as $$ select * from app.start_gate(p_trip_id) $$;

revoke all on function
  app.start_gate(uuid), app.start_trip(uuid),
  public.start_gate(uuid), public.start_trip(uuid)
from public;

grant execute on function
  app.start_gate(uuid), app.start_trip(uuid),
  public.start_gate(uuid), public.start_trip(uuid)
to authenticated;
