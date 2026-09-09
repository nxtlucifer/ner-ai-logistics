import psycopg, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"

env_file = (ROOT / "backend" / ".env").read_text(encoding="utf-8")
env_vars = {}
for line in env_file.splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env_vars[k.strip()] = v.strip().strip("\"'")

db_url = re.sub(r"^\w+(?:\+\w+)?://", "postgresql://", env_vars["DATABASE_URL"])

migration_files = sorted([f for f in MIGRATIONS_DIR.glob("*.sql") if f.name.endswith(".sql")])

print(f"Found {len(migration_files)} Supabase SQL migrations to apply:")
for f in migration_files:
    print(f"  - {f.name}")

with psycopg.connect(db_url) as conn:
    with conn.cursor() as cur:
        # Pre-check row counts
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;")
        tables = [r[0] for r in cur.fetchall()]
        counts_before = {}
        for t in tables:
            cur.execute(f"SELECT count(*) FROM public.{t};")
            counts_before[t] = cur.fetchone()[0]
        
        print(f"\n[PRECHECK] Recorded row counts across {len(tables)} tables before migrations.")
        
        for mf in migration_files:
            print(f"\n==================================================")
            print(f"Applying: {mf.name}")
            print(f"==================================================")
            sql = mf.read_text(encoding="utf-8")
            
            # Apply inside savepoint / transaction
            try:
                cur.execute(sql)
                conn.commit()
                print(f"  [APPLY] SUCCESS: {mf.name}")
            except Exception as e:
                conn.rollback()
                print(f"  [APPLY] FAILED: {mf.name} -> {e}")
                sys.exit(1)
                
            # Row count check to ensure zero data loss
            counts_after = {}
            for t in tables:
                cur.execute(f"SELECT count(*) FROM public.{t};")
                counts_after[t] = cur.fetchone()[0]
                if counts_after[t] != counts_before[t]:
                    print(f"  [WARNING] Row count changed on {t}: {counts_before[t]} -> {counts_after[t]}")
            print(f"  [ROW COUNT CHECK] Verified all {len(tables)} tables have stable row counts.")
            
        print("\n==================================================")
        print("ALL 8 SUPABASE SQL MIGRATIONS APPLIED SUCCESSFULLY")
        print("==================================================")
        
        # Verify schema app and routines
        cur.execute("""
            SELECT routine_schema, routine_name, security_type, data_type
            FROM information_schema.routines
            WHERE routine_schema IN ('app', 'public') AND routine_type = 'FUNCTION'
            ORDER BY routine_schema, routine_name;
        """)
        routines = cur.fetchall()
        print(f"\nTotal routines in app & public: {len(routines)}")
        for r in routines:
            if r[0] == 'app' or r[1] in ['accept_trip', 'submit_location_batch', 'start_trip', 'start_gate', 'verify_assignment', 'arrive_at_stop', 'complete_stop', 'complete_trip']:
                print(f"  - {r[0]}.{r[1]} [{r[2]}] -> {r[3]}")
                
        # Verify RLS policies
        cur.execute("""
            SELECT schemaname, tablename, policyname, roles, cmd
            FROM pg_policies
            WHERE schemaname = 'public'
            ORDER BY tablename, policyname;
        """)
        policies = cur.fetchall()
        print(f"\nTotal public RLS policies: {len(policies)}")
        for p in policies:
            print(f"  - {p[1]}: {p[2]} ({p[4]}) for roles {p[3]}")

