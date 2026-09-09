import json
import re
from datetime import UTC, datetime
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parents[1]
BACKUP_DIR = ROOT / ".runtime" / "supabase-migration" / "backup"
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

# Parse DATABASE_URL
env_file = (ROOT / "backend" / ".env").read_text(encoding="utf-8")
env_vars = {}
for line in env_file.splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env_vars[k.strip()] = v.strip().strip("\"'")

db_url = env_vars.get("DATABASE_URL", "")
conn_str = re.sub(r"^\w+(?:\+\w+)?://", "postgresql://", db_url)

timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
backup_file = BACKUP_DIR / f"hosted_db_backup_{timestamp}.json"

print(f"Connecting to hosted Supabase DB...")
with psycopg.connect(conn_str) as conn:
    with conn.cursor() as cur:
        # 1. Version
        cur.execute("SELECT version_num FROM alembic_version LIMIT 1;")
        alembic_ver = cur.fetchone()[0]
        
        # 2. Tables list
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        """)
        tables = [r[0] for r in cur.fetchall()]
        
        # 3. Row counts
        counts = {}
        for t in tables:
            cur.execute(f"SELECT count(*) FROM public.{t};")
            counts[t] = cur.fetchone()[0]
            
        # 4. Foreign keys
        cur.execute("""
            SELECT
                tc.table_name, kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name,
                rc.update_rule, rc.delete_rule
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            JOIN information_schema.referential_constraints AS rc
              ON rc.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
        """)
        fks = [
            {
                "table": r[0], "column": r[1],
                "foreign_table": r[2], "foreign_column": r[3],
                "on_update": r[4], "on_delete": r[5]
            }
            for r in cur.fetchall()
        ]
        
        # 5. Backup small operational tables completely (< 50,000 rows)
        data_dumps = {}
        for t in tables:
            # Skip huge audit logs / users dumps in JSON, or dump real accounts
            if t in ["trips", "trip_stops", "trip_routes", "trip_events", "drivers", "trucks", 
                      "driver_truck_assignments", "shipments", "cargo_items", "gps_points"]:
                cur.execute(f"SELECT row_to_json(t) FROM public.{t} t;")
                data_dumps[t] = [r[0] for r in cur.fetchall()]
        
        # 6. Real users dump (active or with driver/trip/session evidence)
        cur.execute("""
            SELECT row_to_json(u) FROM public.users u
            WHERE u.is_active = true 
               OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.user_id = u.id)
               OR EXISTS (SELECT 1 FROM public.trips t WHERE t.created_by = u.id)
               OR EXISTS (SELECT 1 FROM public.refresh_tokens r WHERE r.user_id = u.id);
        """)
        data_dumps["users_real"] = [r[0] for r in cur.fetchall()]

backup_data = {
    "timestamp_utc": timestamp,
    "target_project": "znaveeefzgfxsblsobdb",
    "alembic_version": alembic_ver,
    "tables_count": len(tables),
    "tables": tables,
    "row_counts": counts,
    "foreign_keys_count": len(fks),
    "foreign_keys": fks,
    "data_snapshots": {t: len(rows) for t, rows in data_dumps.items()}
}

backup_file.write_text(json.dumps(backup_data, indent=2, default=str), encoding="utf-8")
print(f"Backup metadata written to: {backup_file}")
print(f"Alembic version: {alembic_ver}")
print(f"Tables count: {len(tables)}")
print(f"Row counts summary: {counts}")
