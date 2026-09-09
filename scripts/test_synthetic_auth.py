import psycopg, re, uuid
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

synthetic_id = uuid.uuid4()
synthetic_email = f"synthetic_test_{synthetic_id.hex[:8]}@test.invalid"
# Standard argon2id hash test format
synthetic_hash = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$dGVzdGhhc2g"

print(f"Testing synthetic Auth migration on hosted Supabase DB...")
print(f"Synthetic user ID: {synthetic_id}")
print(f"Synthetic email: {synthetic_email}")

with psycopg.connect(db_url) as conn:
    with conn.cursor() as cur:
        # Check baseline identity status
        cur.execute("SELECT active_users, linked_active, unlinked_active FROM app.identity_status();")
        base_active, base_linked, base_unlinked = cur.fetchone()
        print(f"Baseline: active={base_active}, linked={base_linked}, unlinked={base_unlinked}")

        try:
            # 1. Create synthetic public user
            cur.execute("""
                INSERT INTO public.users (
                    id, email, password_hash, role, display_name, is_active, created_at, updated_at
                ) VALUES (
                    %s, %s, %s, 'DRIVER', 'Synthetic Driver', true, now(), now()
                );
            """, (synthetic_id, synthetic_email, synthetic_hash))
            
            # Check identity_status: unlinked_active should increase by 1
            cur.execute("SELECT active_users, linked_active, unlinked_active FROM app.identity_status();")
            act1, lnk1, unl1 = cur.fetchone()
            assert unl1 == base_unlinked + 1, f"Expected unlinked_active {base_unlinked + 1}, got {unl1}"
            print(f"Step 1 PASS: public.users created -> unlinked_active increased to {unl1}")

            # 2. Create matching auth.users identity (auth.users.id == public.users.id)
            cur.execute("""
                INSERT INTO auth.users (
                    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
                ) VALUES (
                    %s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                    %s, %s, now(), now(), now(),
                    '{"provider":"email","providers":["email"]}'::jsonb,
                    '{}'::jsonb, false
                );
            """, (synthetic_id, synthetic_email, synthetic_hash))

            # Check identity_status: linked_active should increase by 1, unlinked_active should decrease back
            cur.execute("SELECT active_users, linked_active, unlinked_active FROM app.identity_status();")
            act2, lnk2, unl2 = cur.fetchone()
            assert lnk2 == base_linked + 1, f"Expected linked_active {base_linked + 1}, got {lnk2}"
            assert unl2 == base_unlinked, f"Expected unlinked_active {base_unlinked}, got {unl2}"
            print(f"Step 2 PASS: auth.users created with id matching public.users.id -> linked_active={lnk2}, unlinked={unl2}")

            # 3. Test RLS & role resolution as synthetic user
            cur.execute("SET LOCAL ROLE authenticated;")
            cur.execute("select set_config('request.jwt.claim.sub', %s, true);", (str(synthetic_id),))
            
            # Calling app.current_user_id()
            cur.execute("SELECT app.current_user_id();")
            resolved_uid = cur.fetchone()[0]
            assert resolved_uid == synthetic_id, f"Expected {synthetic_id}, got {resolved_uid}"
            print(f"Step 3 PASS: app.current_user_id() resolved correctly to {resolved_uid}")

            # Calling app.current_role()
            cur.execute("SELECT app.current_role();")
            resolved_role = cur.fetchone()[0]
            assert resolved_role == 'DRIVER', f"Expected DRIVER, got {resolved_role}"
            print(f"Step 4 PASS: app.current_role() resolved correctly to {resolved_role}")

            # Calling app.has_perm()
            cur.execute("SELECT app.has_perm('trip:execute_own'), app.has_perm('truck:create');")
            can_exec, can_truck = cur.fetchone()
            assert can_exec is True and can_truck is False, f"Permission check failed: {can_exec}, {can_truck}"
            print(f"Step 5 PASS: app.has_perm() enforced driver permissions (can_exec={can_exec}, can_truck={can_truck})")

            # 4. Cleanup synthetic identity
            cur.execute("RESET ROLE;")
            cur.execute("DELETE FROM auth.users WHERE id = %s;", (synthetic_id,))
            cur.execute("DELETE FROM public.users WHERE id = %s;", (synthetic_id,))
            conn.commit()
            print("Step 6 PASS: Synthetic test accounts cleanly removed.")

            # Final verify back to baseline
            cur.execute("SELECT active_users, linked_active, unlinked_active FROM app.identity_status();")
            final_act, final_lnk, final_unl = cur.fetchone()
            assert (final_act, final_lnk, final_unl) == (base_active, base_linked, base_unlinked)
            print(f"Final verify: Baseline restored cleanly ({final_act}, {final_lnk}, {final_unl}).")
            print("\n*** SYNTHETIC AUTH MIGRATION TEST PASSED 100% ***")

        except Exception as e:
            conn.rollback()
            print(f"FAIL: {e}")
            raise
