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
        for tbl in ['shipments', 'cargo_items', 'trips', 'trip_stops']:
            cur.execute(f"SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='{tbl}' ORDER BY ordinal_position;")
            print(f"\n--- {tbl} ---")
            for c in cur.fetchall():
                print(f"  {c[0]}: {c[1]} (nullable: {c[2]})")
