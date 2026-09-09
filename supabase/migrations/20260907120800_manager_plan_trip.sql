-- Manager atomic trip planning RPC.
--
-- WHY THIS EXISTS
--
-- The UI requires that planning a shipment and its trip happen in ONE atomic
-- transaction: if capacity validation fails or truck/driver is invalid, neither
-- the shipment nor cargo items are created. In REST this was POST /api/trips/plan.
-- This migration exposes app.plan_trip and its public wrapper public.plan_trip.

create or replace function public.recalc_shipment_weight()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
declare
  target uuid;
begin
  target := coalesce(new.shipment_id, old.shipment_id);
  update public.shipments s
     set total_weight_kg = coalesce((
           select sum(c.weight_kg * c.quantity)
             from public.cargo_items c
            where c.shipment_id = target), 0)
   where s.id = target;
  return null;
end;
$$;

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
create or replace function app.plan_trip(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $body$
declare
  v_user_id       uuid;
  v_shipment      jsonb;
  v_trip_in       jsonb;
  v_shipment_id   uuid;
  v_trip_id       uuid;
  v_trip_code     text;
  v_truck_id      uuid;
  v_driver_id     uuid;
  v_truck         public.trucks;
  v_driver        public.drivers;
  v_assignment_id uuid;
  v_total_weight  numeric;
  v_pickup_lat    numeric;
  v_pickup_lon    numeric;
  v_dest_lat      numeric;
  v_dest_lon      numeric;
  v_cargo         jsonb;
  v_item          jsonb;
  v_item_weight   numeric;
  v_item_qty      integer;
  v_trip_row      public.trips;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '28000', detail = '{"code":"NOT_AUTHENTICATED"}';
  end if;

  if not app.has_perm('trip:create') or not app.has_perm('shipment:create') then
    raise exception 'forbidden'
      using errcode = '42501', detail = '{"code":"FORBIDDEN"}';
  end if;

  v_shipment := p_payload->'shipment';
  v_trip_in  := p_payload->'trip';

  if v_shipment is null or v_trip_in is null then
    raise exception 'malformed request payload'
      using errcode = '22023', detail = '{"code":"INVALID_PAYLOAD"}';
  end if;

  v_trip_code := v_trip_in->>'trip_code';
  v_truck_id  := (v_trip_in->>'truck_id')::uuid;
  v_driver_id := (v_trip_in->>'driver_id')::uuid;

  if v_trip_code is null or v_truck_id is null or v_driver_id is null then
    raise exception 'missing required trip fields'
      using errcode = '22023', detail = '{"code":"INVALID_TRIP_FIELDS"}';
  end if;

  -- Verify truck exists and is available
  select tr.* into v_truck from public.trucks tr where tr.id = v_truck_id;
  if not found then
    raise exception 'truck not found'
      using errcode = 'P0002', detail = '{"code":"TRUCK_NOT_FOUND"}';
  end if;

  -- Verify driver exists
  select d.* into v_driver from public.drivers d where d.id = v_driver_id;
  if not found then
    raise exception 'driver not found'
      using errcode = 'P0002', detail = '{"code":"DRIVER_NOT_FOUND"}';
  end if;

  -- Extract coordinates
  v_pickup_lat := (v_shipment->'pickup'->>'lat')::numeric;
  v_pickup_lon := (v_shipment->'pickup'->>'lon')::numeric;
  v_dest_lat   := (v_shipment->'destination'->>'lat')::numeric;
  v_dest_lon   := (v_shipment->'destination'->>'lon')::numeric;

  if v_pickup_lat is null or v_pickup_lon is null or v_dest_lat is null or v_dest_lon is null then
    raise exception 'pickup and destination coordinates are required'
      using errcode = '22023', detail = '{"code":"COORDINATES_REQUIRED"}';
  end if;

  v_shipment_id := gen_random_uuid();
  v_trip_id     := gen_random_uuid();

  -- 1. Insert shipment (weight initially 0; trigger recalculates)
  insert into public.shipments (
    id, reference_code, client_name, pickup_address, pickup_location,
    destination_address, destination_location, total_weight_kg, priority, status,
    created_by, created_at, updated_at
  ) values (
    v_shipment_id,
    coalesce(v_shipment->>'reference_code', 'SHP-' || substr(v_shipment_id::text, 1, 8)),
    coalesce(v_shipment->>'client_name', 'Default Client'),
    coalesce(v_shipment->>'pickup_address', 'Pickup Location'),
    %1$I.ST_SetSRID(%1$I.ST_MakePoint(v_pickup_lon, v_pickup_lat), 4326)::%1$I.geography,
    coalesce(v_shipment->>'destination_address', 'Destination Location'),
    %1$I.ST_SetSRID(%1$I.ST_MakePoint(v_dest_lon, v_dest_lat), 4326)::%1$I.geography,
    0,
    coalesce(nullif(v_shipment->>'priority', ''), 'NORMAL')::public.cargo_priority,
    'DRAFT',
    v_user_id,
    now(),
    now()
  );

  -- 2. Insert cargo items
  v_cargo := v_shipment->'cargo_items';
  if v_cargo is not null and jsonb_array_length(v_cargo) > 0 then
    for v_item in select * from jsonb_array_elements(v_cargo) loop
      v_item_weight := coalesce((v_item->>'weight_kg')::numeric, 0);
      v_item_qty    := coalesce((v_item->>'quantity')::integer, 1);
      insert into public.cargo_items (
        id, shipment_id, cargo_type, cargo_name, weight_kg, quantity,
        is_hazardous, is_perishable, handling_notes
      ) values (
        gen_random_uuid(),
        v_shipment_id,
        coalesce(v_item->>'cargo_type', 'GENERAL'),
        coalesce(v_item->>'cargo_name', 'Cargo Item'),
        v_item_weight,
        v_item_qty,
        coalesce((v_item->>'is_hazardous')::boolean, false),
        coalesce((v_item->>'is_perishable')::boolean, false),
        v_item->>'handling_notes'
      );
    end loop;
  end if;

  -- 3. Read recalculated total weight and validate capacity gate
  select s.total_weight_kg into v_total_weight
  from public.shipments s where s.id = v_shipment_id;

  if v_truck.max_capacity_kg is not null and v_total_weight > v_truck.max_capacity_kg then
    raise exception 'Cargo weight (%% kg) exceeds truck capacity (%% kg)' , v_total_weight, v_truck.max_capacity_kg
      using errcode = '55000', detail = json_build_object(
        'code', 'CAPACITY_EXCEEDED',
        'cargo_weight_kg', v_total_weight,
        'max_capacity_kg', v_truck.max_capacity_kg
      )::text;
  end if;

  -- 4. Check assignment if one exists
  select a.id into v_assignment_id
  from public.driver_truck_assignments a
  where a.driver_id = v_driver_id
    and a.truck_id = v_truck_id
    and a.status in ('ACTIVE', 'PENDING_VERIFICATION')
  order by a.assigned_at desc
  limit 1;

  -- 5. Insert trip
  insert into public.trips (
    id, trip_code, shipment_id, truck_id, driver_id, assignment_id,
    status, created_by, created_at, updated_at
  ) values (
    v_trip_id,
    v_trip_code,
    v_shipment_id,
    v_truck_id,
    v_driver_id,
    v_assignment_id,
    'DRAFT',
    v_user_id,
    now(),
    now()
  ) returning * into v_trip_row;

  -- 6. Insert default stops (Pickup 0, Dropoff 1)
  insert into public.trip_stops (
    id, trip_id, sequence, kind, status, name, address, location, geofence_radius_m
  ) values (
    gen_random_uuid(), v_trip_id, 0, 'PICKUP', 'PENDING',
    'Pickup', coalesce(v_shipment->>'pickup_address', 'Pickup'),
    %1$I.ST_SetSRID(%1$I.ST_MakePoint(v_pickup_lon, v_pickup_lat), 4326)::%1$I.geography,
    100
  ), (
    gen_random_uuid(), v_trip_id, 1, 'DROPOFF', 'PENDING',
    'Delivery', coalesce(v_shipment->>'destination_address', 'Destination'),
    %1$I.ST_SetSRID(%1$I.ST_MakePoint(v_dest_lon, v_dest_lat), 4326)::%1$I.geography,
    100
  );

  -- 7. Record CREATED event
  insert into public.trip_events (
    trip_id, kind, description, actor_user_id
  ) values (
    v_trip_id,
    'CREATED',
    'Trip ' || v_trip_code || ' planned atomically for shipment',
    v_user_id
  );

  return jsonb_build_object(
    'id', v_trip_row.id,
    'trip_code', v_trip_row.trip_code,
    'shipment_id', v_trip_row.shipment_id,
    'truck_id', v_trip_row.truck_id,
    'driver_id', v_trip_row.driver_id,
    'status', v_trip_row.status,
    'created_at', v_trip_row.created_at
  );
end;
$body$;
$fn$, v_gis);
end $mig$;

create or replace function public.plan_trip(p_payload jsonb)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app.plan_trip(p_payload)
$$;

revoke all on function public.plan_trip(jsonb) from public;
grant execute on function public.plan_trip(jsonb) to authenticated;
