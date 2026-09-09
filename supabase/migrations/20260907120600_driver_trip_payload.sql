-- The composed driver trip payload.
--
-- Everything GET /api/driver/me/trip returns, except `progress`, which is pure
-- arithmetic over the geometry and is computed by the Edge Function using the
-- TypeScript port of app/domain/route_progress.py.
--
-- WHY THE COMPOSITION IS HERE AND NOT IN THE EDGE FUNCTION
--
--   * Ownership and visibility stay in the database, where RLS already decides
--     them. The function is SECURITY DEFINER but resolves the trip FROM
--     app.current_driver_id(), never from an argument, so it cannot be pointed
--     at somebody else's trip.
--   * COORDINATE ORDER IS DECIDED ONCE, HERE. The project speaks (lat, lon);
--     PostGIS and GeoJSON speak (lon, lat). Converting in the Edge Function
--     would put that swap in a place no database test can see. Emitting
--     [lat, lon] from SQL means the harness asserts the order that the map,
--     the progress calculation and the API all depend on.
--   * It is testable without Deno, which this machine does not have.
--
-- The Edge Function is therefore a thin shell: authenticate, call this, compute
-- progress, shape the response.

do $mig$
declare v_gis text;
begin
  select n.nspname into v_gis
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';
  if v_gis is null then
    raise exception 'postgis extension not found';
  end if;

  execute format($fn$
create or replace function app.driver_trip_payload(p_trip_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $body$
declare
  v_driver_id uuid;
  v_trip      public.trips;
  v_truck     public.trucks;
  v_gate      record;
  v_stops     jsonb;
  v_next_stop uuid;
  v_geometry  jsonb;
  v_route     public.trip_routes;
  v_fix       record;
  v_in_progress boolean;
begin
  if auth.uid() is null then
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
  limit 1;

  -- No current trip is an ordinary state, not an error: the app renders "no
  -- assignment yet". null, not an exception.
  if not found then
    return null;
  end if;

  v_in_progress := v_trip.status in ('ACTIVE','DELAYED');

  select tr.* into v_truck from public.trucks tr where tr.id = v_trip.truck_id;

  select * into v_gate from app.start_gate(v_trip.id);

  -- Stops in sequence. The next actionable one is the FIRST not settled:
  -- returning a single stop rather than a set is deliberate - a driver looking
  -- at several buttons, any of which might work, eventually presses the wrong
  -- one at 3am.
  select jsonb_agg(s order by s.sequence) into v_stops
  from (
    select st.id, st.sequence, st.kind, st.status, st.name, st.address,
           st.geofence_radius_m, st.planned_arrival_at, st.actual_arrival_at,
           st.actual_departure_at,
           jsonb_build_array(%1$I.ST_Y(st.location::%1$I.geometry),
                             %1$I.ST_X(st.location::%1$I.geometry)) as location
    from public.trip_stops st
    where st.trip_id = v_trip.id
  ) s;

  select st.id into v_next_stop
  from public.trip_stops st
  where st.trip_id = v_trip.id
    and st.status not in ('COMPLETED','SKIPPED')
  order by st.sequence
  limit 1;

  -- The selected route only. An unselected corridor is a proposal, and progress
  -- along a proposal would be a number about a road the driver is not on.
  if v_trip.selected_route_id is not null then
    select r.* into v_route from public.trip_routes r where r.id = v_trip.selected_route_id;
    if found then
      -- [lat, lon] per vertex. ST_DumpPoints keeps vertex order, which is what
      -- makes the polyline a path rather than a set of points.
      select jsonb_agg(jsonb_build_array(%1$I.ST_Y(d.geom), %1$I.ST_X(d.geom)) order by d.path)
        into v_geometry
      from %1$I.ST_DumpPoints(v_route.geometry::%1$I.geometry) d;
    end if;
  end if;

  select g.recorded_at, g.received_at,
         %1$I.ST_Y(g.location::%1$I.geometry) as lat,
         %1$I.ST_X(g.location::%1$I.geometry) as lon,
         greatest(0, extract(epoch from (now() - g.received_at))) as age_seconds
    into v_fix
  from public.gps_points g
  where g.trip_id = v_trip.id
  order by g.recorded_at desc
  limit 1;

  return jsonb_build_object(
    'id', v_trip.id,
    'trip_code', v_trip.trip_code,
    'status', v_trip.status,
    'dispatched_at', v_trip.dispatched_at,
    'started_at', v_trip.started_at,
    'delivered_at', v_trip.delivered_at,
    'truck', case when v_truck.id is null then null else jsonb_build_object(
        'id', v_truck.id,
        'registration_number', v_truck.registration_number,
        'truck_type', v_truck.truck_type,
        'make', v_truck.make,
        'model', v_truck.model,
        'max_capacity_kg', v_truck.max_capacity_kg,
        'status', v_truck.status) end,
    'stops', coalesce(v_stops, '[]'::jsonb),
    'next_stop_id', v_next_stop,
    'can_start', v_gate.blocked_code is null,
    -- An in-progress trip has nothing to block: the driver is already driving.
    'start_blocked_code',   case when v_in_progress then null else v_gate.blocked_code end,
    'start_blocked_reason', case when v_in_progress then null else v_gate.blocked_reason end,
    'selected_route_id', v_trip.selected_route_id,
    -- Reported ONLY when THIS driver is the one who accepted. A reassigned trip
    -- still carries the previous driver's timestamp in the row, and returning
    -- it here would open the new driver's app on a job it claimed they had
    -- already accepted. Comparing rather than clearing means no reassignment
    -- path has to remember to do anything.
    'driver_accepted_at', case when v_trip.driver_accepted_by = v_driver_id
                               then v_trip.driver_accepted_at else null end,
    'tracking_expected', v_in_progress,
    'last_fix', case when v_fix.received_at is null then null else jsonb_build_object(
        'recorded_at', v_fix.recorded_at,
        'received_at', v_fix.received_at,
        'age_seconds', v_fix.age_seconds,
        -- Same thresholds as app/domain/telemetry_policy.freshness_label.
        'freshness', case when v_fix.age_seconds <= 90 then 'LIVE'
                          when v_fix.age_seconds <= 600 then 'STALE'
                          else 'NO_CONTACT' end) end,
    -- Inputs the Edge Function needs for progress. Not part of the API
    -- contract; stripped from the response after the calculation.
    '_progress_input', jsonb_build_object(
        'geometry', v_geometry,
        'position', case when v_fix.lat is null then null
                         else jsonb_build_array(v_fix.lat, v_fix.lon) end,
        'plannedDistanceKm', v_route.distance_km,
        'plannedDurationMin', v_route.estimated_duration_min),
    'tracking', jsonb_build_object(
        'moving_interval_seconds', 10,
        'stationary_interval_seconds', 60,
        'stationary_distance_m', 30,
        'batch_size', 6,
        'queue_limit', 500,
        'fresh_seconds', 90)
  );
end $body$;
$fn$, v_gis);
end $mig$;

comment on function app.driver_trip_payload(uuid) is
  'Composed CurrentTrip minus progress. Emits [lat,lon] so coordinate order is decided once, in a place tests can see.';

create or replace function public.driver_trip_payload(p_trip_id uuid default null)
returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app.driver_trip_payload(p_trip_id) $$;

revoke all on function app.driver_trip_payload(uuid), public.driver_trip_payload(uuid) from public;
grant execute on function app.driver_trip_payload(uuid), public.driver_trip_payload(uuid) to authenticated;
