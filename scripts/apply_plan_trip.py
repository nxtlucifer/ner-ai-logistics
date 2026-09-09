import psycopg, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sql_file = ROOT / "supabase" / "migrations" / "20260907120800_manager_plan_trip.sql"
env_file = (ROOT / "backend" / ".env").read_text(encoding="utf-8")
env_vars = {}
for line in env_file.splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env_vars[k.strip()] = v.strip().strip("\"'")

db_url = re.sub(r"^\w+(?:\+\w+)?://", "postgresql://", env_vars["DATABASE_URL"])

print("Applying 20260907120800_manager_plan_trip.sql...")
with psycopg.connect(db_url) as conn:
    with conn.cursor() as cur:
        cur.execute(sql_file.read_text(encoding="utf-8"))
        conn.commit()
        print("SUCCESS! Checking routine public.plan_trip...")
        cur.execute("SELECT proname, prosecdef FROM pg_proc WHERE proname = 'plan_trip';")
        print("Found:", cur.fetchall())
