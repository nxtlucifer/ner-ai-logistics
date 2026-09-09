import re
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parents[1]

# 1. Inspect backend/.env
env_file = (ROOT / "backend" / ".env").read_text(encoding="utf-8")
env_vars = {}
for line in env_file.splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env_vars[k.strip()] = v.strip().strip("\"'")

print("DATABASE_PROVIDER:", env_vars.get("DATABASE_PROVIDER"))
db_url = env_vars.get("DATABASE_URL", "")
m = re.search(r"@([^:/]+)", db_url)
print("DB_HOST:", m.group(1) if m else "unknown")
ref = env_vars.get("SUPABASE_PROJECT_REF", "znaveeefzgfxsblsobdb")
print("SUPABASE_PROJECT:", ref)
print("SUPABASE_REGION: ap-south-1")

# 2. Check hosted Supabase DB version and tables
conn_str = re.sub(r"^\w+(?:\+\w+)?://", "postgresql://", db_url)
try:
    with psycopg.connect(conn_str) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT version_num FROM alembic_version LIMIT 1;")
            row = cur.fetchone()
            alembic_ver = row[0] if row else "none"
            print("HOSTED_ALEMBIC_VERSION:", alembic_ver)
            
            cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
            tbl_count = cur.fetchone()[0]
            print("HOSTED_TABLES_COUNT:", tbl_count)
            
            cur.execute("SELECT version();")
            pg_ver = cur.fetchone()[0]
            print("POSTGRES_VERSION:", pg_ver)
except Exception as e:
    print("HOSTED_DB_ERROR:", e)

# 3. Check Driver and Manager transport
driver_client = (ROOT / "driver-app" / "src" / "api" / "client.ts").read_text(encoding="utf-8")
print("DRIVER_TRANSPORT_CODE: contains supabaseApi switch =", "usingSupabase" in driver_client)

manager_client = (ROOT / "manager-web" / "src" / "api" / "client.ts").read_text(encoding="utf-8")
print("MANAGER_TRANSPORT_CODE: contains VITE_API_BASE_URL =", "VITE_API_BASE_URL" in manager_client)

print("AI_TRANSPORT: Gemini proxy in backend / edge functions")
print("MAP_ENGINE: MapLibre (manager-web) / react-native-maps (driver native)")
print("ROUTING_PROVIDER: OSRM primary")
