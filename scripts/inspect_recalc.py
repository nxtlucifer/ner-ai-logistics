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
        cur.execute("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'recalc_shipment_weight';")
        print(cur.fetchone()[0])
