-- Manager trip dispatch RPC.
--
-- DRAFT -> ASSIGNED. Transitions a draft trip so the driver can see and accept it.
-- Re-verifies that driver has an active assignment for the truck.

create or replace function app.dispatch_trip(p_trip_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $body$
declare
  v_user_id     uuid;
  v_trip        public.trips;
  v_assignment  public.driver_truck_assignments;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '28000', detail = '{"code":"NOT_AUTHENTICATED"}';
  end if;

  if not app.has_perm('trip:dispatch') then
    raise exception 'forbidden'
      using errcode = '42501', detail = '{"code":"FORBIDDEN"}';
  end if;

  select * into v_trip
  from public.trips
  where id = p_trip_id
  for update;

  if v_trip.id is null then
    raise exception 'trip not found'
      using errcode = 'P0002', detail = '{"code":"TRIP_NOT_FOUND"}';
  end if;

  if v_trip.status <> 'DRAFT' then
    raise exception 'trip cannot be dispatched from status %', v_trip.status
      using errcode = '55000', detail = jsonb_build_object('code', 'ILLEGAL_TRANSITION', 'status', v_trip.status);
  end if;

  select * into v_assignment
  from public.driver_truck_assignments
  where driver_id = v_trip.driver_id
    and truck_id = v_trip.truck_id
    and status in ('ACTIVE', 'PENDING_VERIFICATION')
  order by assigned_at desc
  limit 1;

  if v_assignment.id is null then
    raise exception 'no active assignment for driver and truck'
      using errcode = '55000', detail = '{"code":"NO_ACTIVE_ASSIGNMENT"}';
  end if;

  update public.trips
  set status = 'ASSIGNED',
      assignment_id = v_assignment.id,
      dispatched_at = now(),
      updated_at = now()
  where id = p_trip_id
  returning * into v_trip;

  insert into public.trip_events (
    trip_id, kind, description, actor_user_id
  ) values (
    p_trip_id,
    'ASSIGNED',
    'dispatched by manager',
    v_user_id
  );

  return jsonb_build_object(
    'id', v_trip.id,
    'trip_code', v_trip.trip_code,
    'shipment_id', v_trip.shipment_id,
    'truck_id', v_trip.truck_id,
    'driver_id', v_trip.driver_id,
    'status', v_trip.status,
    'dispatched_at', v_trip.dispatched_at
  );
end;
$body$;

create or replace function public.dispatch_trip(p_trip_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app.dispatch_trip(p_trip_id);
$$;

revoke all on function public.dispatch_trip(uuid) from public;
grant execute on function public.dispatch_trip(uuid) to authenticated;
