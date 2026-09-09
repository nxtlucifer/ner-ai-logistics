-- Guarded state transitions.
--
-- These are the only way a client may change trip state. No UPDATE is granted
-- on public.trips to `authenticated` (see the grants migration), so a driver
-- cannot set status, driver_id, selected_route_id or driver_accepted_by
-- directly through PostgREST no matter what payload they send. The rules that
-- used to live in app/services/driver_trips.py live here instead, inside one
-- transaction that holds the row lock.
--
-- WHY SECURITY DEFINER
--
-- The function must UPDATE a table the caller has no UPDATE grant on - that is
-- the entire point. Definer rights are therefore necessary, and each of the
-- mitigations the mission asks for is applied: search_path is pinned to '',
-- every object is schema-qualified, EXECUTE is revoked from PUBLIC and granted
-- only to `authenticated`, and the caller's identity is resolved INSIDE the
-- function from auth.uid() rather than accepted as an argument.
--
-- RLS does not constrain a definer function, so the ownership check here is
-- load-bearing security, not a convenience.

-- ---------------------------------------------------------------------------
-- app.accept_trip(trip_id)
--
-- Ports app/services/driver_trips.py::accept, preserving its documented
-- semantics exactly:
--
--   * Acceptance is an ACKNOWLEDGEMENT, not a transition. status is untouched.
--     It is not a gate: it grants no authority over the route, and does not
--     make an unstartable trip startable.
--   * Idempotent under the row lock. A double tap or a retry after a lost
--     response returns the FIRST acceptance unchanged and writes no second
--     event.
--   * The driver_accepted_by half stops an acknowledgement being INHERITED: a
--     trip reassigned to a new driver still carries the previous driver's id,
--     the comparison fails, and the new driver is asked to accept it
--     themselves rather than finding it already accepted on their behalf.
--   * Terminal trips are refused with TRIP_NOT_ACCEPTABLE - a stale screen must
--     show the real state, not record an acknowledgement of something over.
--   * A trip already in progress counts as accepted: starting is a stronger act
--     than acknowledging, so an ACTIVE trip predating the column is stamped
--     rather than refused, and the driver sees "Resume navigation".
--
-- Returns the trip row as the caller would read it.
create or replace function app.accept_trip(p_trip_id uuid default null)
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
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '28000', detail = '{"code":"NOT_AUTHENTICATED"}';
  end if;

  -- Object-level binding: the trip is resolved FROM the authenticated driver.
  -- p_trip_id may narrow the selection but can never widen it to someone
  -- else's trip, which is what makes a forged trip id useless here.
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
    raise exception 'no trip to accept'
      using errcode = 'P0002', detail = '{"code":"NO_ACTIVE_TRIP"}';
  end if;

  if v_trip.status in ('DELIVERED','CLOSED','CANCELLED') then
    raise exception 'This trip is no longer running.'
      using errcode = '55000',
            detail = json_build_object('code','TRIP_NOT_ACCEPTABLE',
                                       'status', v_trip.status)::text;
  end if;

  -- Retry by the same driver: first acceptance wins, unchanged, no new event.
  if v_trip.driver_accepted_at is not null
     and v_trip.driver_accepted_by = v_driver_id then
    return v_trip;
  end if;

  update public.trips t
     set driver_accepted_at = now(),
         driver_accepted_by = v_driver_id,
         updated_at         = now()
   where t.id = v_trip.id
  returning t.* into v_trip;

  insert into public.trip_events (trip_id, kind, description, actor_user_id)
  values (v_trip.id, 'ACCEPTED', 'Driver acknowledged the dispatched trip.', v_user_id);

  return v_trip;
end $$;

comment on function app.accept_trip(uuid) is
  'Idempotent driver acknowledgement. Ports driver_trips.accept: status untouched, terminal refused, acceptance never inherited.';

-- ---------------------------------------------------------------------------
-- app.submit_location(...)
--
-- location:submit_own, bound to the caller's own in-progress trip.
--
-- IDEMPOTENT BY THE SCHEMA'S OWN KEY. gps_points already carries
-- uq_gps_trip_device_fix on (trip_id, device_fix_id): the device mints one id
-- per fix, so replaying a bounded offline queue after reconnect inserts each
-- fix at most once. ON CONFLICT DO NOTHING makes the replay safe rather than
-- relying on the client to remember what it already sent.
--
-- recorded_at (when the device saw it) and received_at (when the server got
-- it) are stored SEPARATELY, so a queued fix is never read as current. There
-- is no mutable "current location" column to clobber: latest position is a
-- read-time ordering, which is why an old queued coordinate arriving late
-- cannot overwrite a newer one.
--
-- truck_id is taken from the trip, not from the caller, so a driver cannot
-- attribute their position to another truck.
--
-- PostGIS lives in `extensions` on the hosted project and in `public` on a
-- plain local cluster. search_path is pinned to '', so the schema cannot be
-- left to resolution - it is interpolated from pg_extension when this
-- migration runs, which keeps one file correct on both targets.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_gis text;
begin
  select n.nspname into v_gis
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';
  if v_gis is null then
    raise exception 'postgis extension not found; cannot build app.submit_location';
  end if;

  execute format($fn$
create or replace function app.submit_location(
  p_lat           double precision,
  p_lon           double precision,
  p_device_fix_id uuid,
  p_recorded_at   timestamptz default null,
  p_accuracy_m    numeric default null,
  p_speed_kmph    numeric default null,
  p_heading_deg   numeric default null,
  p_is_mock       boolean default false
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $body$
declare
  v_driver_id uuid;
  v_trip      record;
  v_id        bigint;
  v_recorded  timestamptz;
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '28000', detail = '{"code":"NOT_AUTHENTICATED"}';
  end if;

  v_driver_id := app.current_driver_id();
  if v_driver_id is null or not app.has_perm('location:submit_own') then
    raise exception 'not a driver'
      using errcode = '42501', detail = '{"code":"FORBIDDEN"}';
  end if;

  if p_device_fix_id is null then
    raise exception 'device_fix_id required'
      using errcode = '22004', detail = '{"code":"MISSING_FIX_ID"}';
  end if;

  if p_lat is null or p_lon is null
     or p_lat < -90 or p_lat > 90 or p_lon < -180 or p_lon > 180 then
    raise exception 'coordinate out of range'
      using errcode = '22003', detail = '{"code":"INVALID_COORDINATE"}';
  end if;

  v_recorded := coalesce(p_recorded_at, now());
  -- A skewed or hostile clock must not be able to park a fix in the future and
  -- pin itself as the latest position forever.
  if v_recorded > now() + interval '2 minutes' then
    raise exception 'recorded_at is in the future'
      using errcode = '22007', detail = '{"code":"INVALID_TIMESTAMP"}';
  end if;

  select t.id, t.truck_id into v_trip
  from public.trips t
  where t.driver_id = v_driver_id
    and t.status in ('ACTIVE','DELAYED','INCIDENT')
  order by t.started_at desc nulls last
  limit 1;

  if v_trip.id is null then
    raise exception 'no trip in progress'
      using errcode = 'P0002', detail = '{"code":"NO_ACTIVE_TRIP"}';
  end if;

  insert into public.gps_points
    (trip_id, driver_id, truck_id, location, accuracy_m, speed_kmph,
     heading_deg, device_fix_id, recorded_at, received_at, is_mock_location)
  values
    (v_trip.id, v_driver_id, v_trip.truck_id,
     %1$I.ST_SetSRID(%1$I.ST_MakePoint(p_lon, p_lat), 4326)::%1$I.geography,
     p_accuracy_m, p_speed_kmph, p_heading_deg, p_device_fix_id,
     v_recorded, now(), coalesce(p_is_mock, false))
  on conflict (trip_id, device_fix_id) do nothing
  returning id into v_id;

  -- Conflict means this exact fix was already stored: a replay, not an error.
  if v_id is null then
    select g.id into v_id
    from public.gps_points g
    where g.trip_id = v_trip.id and g.device_fix_id = p_device_fix_id;
  end if;

  return v_id;
end $body$;
$fn$, v_gis);
end $mig$;

comment on function app.submit_location(double precision, double precision, uuid, timestamptz, numeric, numeric, numeric, boolean) is
  'Appends one GPS fix for the caller''s own in-progress trip. Idempotent on (trip_id, device_fix_id) so an offline replay cannot duplicate. recorded_at and received_at kept separate.';

revoke all on function
  app.accept_trip(uuid),
  app.submit_location(double precision, double precision, uuid, timestamptz, numeric, numeric, numeric, boolean)
from public;

grant execute on function
  app.accept_trip(uuid),
  app.submit_location(double precision, double precision, uuid, timestamptz, numeric, numeric, numeric, boolean)
to authenticated;

-- ---------------------------------------------------------------------------
-- app.submit_location_batch(fixes jsonb)
--
-- Contract parity with POST /api/driver/me/location, which the driver app calls
-- with a BATCH: `{trip_id, fixes:[GpsFix...]}` expecting
-- `{trip_id, accepted, duplicates_ignored, rejected, rejected_reasons}` back.
-- Returning the same counters is what lets the bounded offline queue tell
-- "already had it" apart from "refused it".
--
-- AUTHORIZES ITSELF. An earlier version delegated entirely to the per-fix
-- function and therefore had no check of its own: an EMPTY array never entered
-- the loop, so a manager - or an anonymous caller - got a cheerful 200 back. An
-- entrypoint that is only safe for non-empty input is not safe. The caller is
-- verified here, before anything is parsed.
--
-- The trip is resolved ONCE, UP FRONT, for the same reason: resolving it after
-- the loop meant a trip that ended mid-batch returned trip_id null alongside
-- accepted fixes, which is a contradiction the device cannot act on.
--
-- A malformed or refused fix does NOT abort the batch. A queue flushed after an
-- hour offline will contain fixes that are now unacceptable (clock skew, ended
-- trip); dropping the whole batch for one of them loses the good ones and
-- retries forever.
--
-- trip_id from the request body is deliberately not a parameter: the trip comes
-- from the authenticated driver, so a client cannot post another driver's
-- positions by naming their trip.
-- ---------------------------------------------------------------------------
create or replace function app.submit_location_batch(p_fixes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_fix      jsonb;
  v_accepted int := 0;
  v_dupes    int := 0;
  v_rejected int := 0;
  v_reasons  jsonb := '{}'::jsonb;
  v_before   bigint;
  v_after    bigint;
  v_trip_id  uuid;
  v_code     text;
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '28000', detail = '{"code":"NOT_AUTHENTICATED"}';
  end if;

  if app.current_driver_id() is null or not app.has_perm('location:submit_own') then
    raise exception 'not a driver'
      using errcode = '42501', detail = '{"code":"FORBIDDEN"}';
  end if;

  if jsonb_typeof(p_fixes) <> 'array' then
    raise exception 'fixes must be a JSON array'
      using errcode = '22023', detail = '{"code":"INVALID_BODY"}';
  end if;

  -- Bounded: an unbounded array is a memory and lock-duration risk, and the
  -- device queue is bounded anyway.
  if jsonb_array_length(p_fixes) > 500 then
    raise exception 'batch too large'
      using errcode = '54000', detail = '{"code":"BATCH_TOO_LARGE"}';
  end if;

  select t.id into v_trip_id
  from public.trips t
  where t.driver_id = app.current_driver_id()
    and t.status in ('ACTIVE','DELAYED','INCIDENT')
  order by t.started_at desc nulls last
  limit 1;

  if v_trip_id is null then
    raise exception 'no trip in progress'
      using errcode = 'P0002', detail = '{"code":"NO_ACTIVE_TRIP"}';
  end if;

  for v_fix in select * from jsonb_array_elements(p_fixes) loop
    begin
      select count(*) into v_before from public.gps_points g
        where g.trip_id = v_trip_id
          and g.device_fix_id = (v_fix->>'device_fix_id')::uuid;

      perform app.submit_location(
        (v_fix->'location'->>'lat')::double precision,
        (v_fix->'location'->>'lon')::double precision,
        (v_fix->>'device_fix_id')::uuid,
        (v_fix->>'recorded_at')::timestamptz,
        (v_fix->>'accuracy_m')::numeric,
        (v_fix->>'speed_kmph')::numeric,
        (v_fix->>'heading_deg')::numeric,
        coalesce((v_fix->>'is_mock_location')::boolean, false)
      );

      select count(*) into v_after from public.gps_points g
        where g.trip_id = v_trip_id
          and g.device_fix_id = (v_fix->>'device_fix_id')::uuid;

      if v_after > v_before then
        v_accepted := v_accepted + 1;
      else
        v_dupes := v_dupes + 1;
      end if;
    exception when others then
      v_rejected := v_rejected + 1;
      -- The structured code the inner function raised, never the raw message:
      -- these reasons go back to the device and must not carry server internals.
      begin
        v_code := coalesce(
          (nullif(PG_EXCEPTION_DETAIL, '')::jsonb) ->> 'code', 'REJECTED');
      exception when others then
        v_code := 'REJECTED';
      end;
      v_reasons := jsonb_set(v_reasons, array[v_code],
                             to_jsonb(coalesce((v_reasons->>v_code)::int, 0) + 1));
    end;
  end loop;

  return jsonb_build_object(
    'trip_id', v_trip_id,
    'accepted', v_accepted,
    'duplicates_ignored', v_dupes,
    'rejected', v_rejected,
    'rejected_reasons', v_reasons
  );
end $$;

comment on function app.submit_location_batch(jsonb) is
  'Batch parity with POST /api/driver/me/location. Authorizes itself; resolves the trip once up front; one bad fix does not abort the batch.';

revoke all on function app.submit_location_batch(jsonb) from public;
grant execute on function app.submit_location_batch(jsonb) to authenticated;
