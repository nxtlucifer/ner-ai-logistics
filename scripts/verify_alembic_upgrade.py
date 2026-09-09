import psycopg, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
env_file = (ROOT / "backend" / ".env").read_text(encoding="utf-8")
env_vars = {}
for line in env_file.splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env_vars[k.strip()] = v.strip().strip("\"'")

db_url = re.sub(r"^\w+(?:\+\w+)?://", "postgresql://", env_vars["DATABASE_URL"])

with psycopg.connect(db_url) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT version_num FROM alembic_version;")
        print("Alembic version:", cur.fetchone()[0])
        
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;")
        tables = [r[0] for r in cur.fetchall()]
        print(f"Total tables: {len(tables)}")
        print("Tables:", tables)
        
        # Verify route_review_authorizations
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'route_review_authorizations';")
        print("route_review_authorizations columns count:", len(cur.fetchall()))
        
        # Verify trips driver_accepted_at and driver_accepted_by
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'trips' AND column_name LIKE 'driver_accepted%';")
        print("trips acceptance columns:", [r[0] for r in cur.fetchall()])
        
        # Verify trip_routes maneuvers column
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'trip_routes' AND column_name = 'maneuvers';")
        print("trip_routes maneuvers column:", [r[0] for r in cur.fetchall()])
        
        # Verify enum values
        cur.execute("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE typname = 'userrole';")
        print("UserRole enums:", [r[0] for r in cur.fetchall()])
        
        cur.execute("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE typname = 'eventkind';")
        print("EventKind enums contains ACCEPTED:", "ACCEPTED" in [r[0] for r in cur.fetchall()])
        
        # Check integrity / orphans
        cur.execute("""
            SELECT
              (SELECT count(*) FROM trips t LEFT JOIN drivers d ON d.id=t.driver_id WHERE t.driver_id IS NOT NULL AND d.id IS NULL) AS trip_without_driver,
              (SELECT count(*) FROM trips t LEFT JOIN shipments s ON s.id=t.shipment_id WHERE s.id IS NULL) AS trip_without_shipment,
              (SELECT count(*) FROM trip_stops s LEFT JOIN trips t ON t.id=s.trip_id WHERE t.id IS NULL) AS stop_without_trip,
              (SELECT count(*) FROM trip_routes r LEFT JOIN trips t ON t.id=r.trip_id WHERE t.id IS NULL) AS route_without_trip,
              (SELECT count(*) FROM gps_points g LEFT JOIN trips t ON t.id=g.trip_id WHERE t.id IS NULL) AS gps_without_trip,
              (SELECT count(*) FROM drivers d LEFT JOIN users u ON u.id=d.user_id WHERE u.id IS NULL) AS driver_without_user;
        """)
        integrity = cur.fetchone()
        print("Integrity checks (all should be 0):", integrity)
