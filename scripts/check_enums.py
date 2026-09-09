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
        cur.execute("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE typname = 'user_role';")
        print("user_role enum values:", [r[0] for r in cur.fetchall()])
        
        cur.execute("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE typname = 'trip_event_kind';")
        event_kinds = [r[0] for r in cur.fetchall()]
        print("trip_event_kind enum values:", event_kinds)
        print("Contains ACCEPTED:", "ACCEPTED" in event_kinds)
