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
        cur.execute("""
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_schema = 'public' 
              AND routine_name IN ('accept_trip', 'start_trip', 'start_gate', 'verify_assignment', 
                                   'arrive_at_stop', 'complete_stop', 'complete_trip', 'plan_trip', 
                                   'submit_location_batch')
            ORDER BY routine_name;
        """)
        rpcs = [r[0] for r in cur.fetchall()]
        print(f"Present public RPCs ({len(rpcs)}):", rpcs)
