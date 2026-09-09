-- Identity mapping: public.users <-> auth.users.
--
-- THE INVARIANT
--
--   auth.users.id  ==  public.users.id
--
-- Chosen over a join column because every foreign key in the schema already
-- points at public.users.id (drivers.user_id, trips.created_by,
-- trip_events.actor_user_id, audit_logs.actor_user_id, ...). Making the Auth id
-- equal to it preserves all of them with zero remapping and zero backfill, and
-- it is what lets `auth.uid() = public.users.id` be written directly in every
-- policy in this migration set. GoTrue accepts an explicit id on admin user
-- creation, so this is a property we can establish rather than hope for.
--
-- WHY THERE IS NO FOREIGN KEY
--
-- 19,827 of the 19,870 rows in public.users are `%@p3test.invalid` fixtures
-- left by the 2026-09-06 incident, none of them active. They must NOT become
-- Auth identities. A FK from public.users.id to auth.users.id would therefore
-- fail, and adding one after a partial import would make the fixtures
-- undeletable. Linkage is asserted by app.identity_status() instead, which is
-- checkable at any time and blocks nothing.
--
-- PASSWORDS DO NOT COME ACROSS, AND THIS IS NOT OPTIONAL
--
-- Every stored hash is argon2id (app/core/security.py chose it deliberately
-- over bcrypt's 72-byte truncation). GoTrue's `encrypted_password` is bcrypt.
-- There is no supported way to import an argon2id hash into Supabase Auth, so
-- the existing passwords cannot be carried over by any migration, including
-- this one. Five accounts are active; they need new credentials or a reset
-- link. See docs/SUPABASE_MIGRATION_MISSION.md for the account-transition plan.
-- Nothing here silently drops an account: public.users is left intact, and
-- app.identity_status() reports exactly which active users still have no Auth
-- identity.

-- Reports linkage health without exposing a single personal record.
--
-- `unlinked_active` is the number that matters: an active user with no Auth
-- identity cannot sign in after cutover. It must reach 0 before the clients are
-- pointed at Supabase, and this function is how that is checked - on the real
-- project, at any time, by anyone with EXECUTE.
create or replace function app.identity_status()
returns table (
  active_users        bigint,
  linked_active       bigint,
  unlinked_active     bigint,
  inactive_users      bigint,
  fixture_users       bigint,
  auth_users_total    bigint,
  auth_without_app_row bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (where u.is_active),
    count(*) filter (where u.is_active and a.id is not null),
    count(*) filter (where u.is_active and a.id is null),
    count(*) filter (where not u.is_active),
    count(*) filter (where u.email like '%.invalid'),
    (select count(*) from auth.users),
    (select count(*) from auth.users x
      where not exists (select 1 from public.users y where y.id = x.id))
  from public.users u
  left join auth.users a on a.id = u.id
$$;

comment on function app.identity_status() is
  'Linkage health between public.users and auth.users. unlinked_active must be 0 before client cutover.';

revoke all on function app.identity_status() from public;
grant execute on function app.identity_status() to authenticated;

-- A user row must never be created by a client. Roles are server-controlled
-- data (PART 5: "Roles and organization membership must come from protected
-- server-controlled data"), so there is deliberately no INSERT/UPDATE grant on
-- public.users anywhere in this migration set, and no trigger here that
-- auto-provisions a public.users row from an Auth signup.
--
-- That is a decision, not an omission: auto-provisioning on signup is the
-- common Supabase pattern, and it would let anyone who can reach the signup
-- endpoint mint themselves an application identity. Accounts are created by
-- the fleet operator through an authorized path.
