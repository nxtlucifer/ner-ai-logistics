-- PREPARED. NOT APPLIED. REQUIRES EXPLICIT APPROVAL BEFORE RUNNING.
--
-- SCHEMA_APPLICATION_REQUIRES_APPROVAL = YES
--
-- LS-9 G6. Deliberately NOT an alembic revision and deliberately NOT in
-- backend/alembic/versions/, following the convention set by
-- PENDING_reroute_decision_events.sql: anything placed there is applied by the
-- next `alembic upgrade head`, INCLUDING the one the test suite runs, against
-- whatever DATABASE_URL is configured. Moving this file into a revision IS the
-- approval step.
--
--
-- ============================================================================
-- 1. WHY THE EXISTING AUDIT FACILITY CANNOT DO THIS
-- ============================================================================
--
-- The obvious cheap answer is "write an audit_logs row and let the selection
-- look for it". That was checked against the actual table (app/models/audit.py,
-- migration 0002) and it does not hold. Four reasons, in order of severity:
--
--   a. audit_logs RECORDS, it does not AUTHORIZE. Every row in it is a
--      statement that something already happened. An authorization is consulted
--      BEFORE a mutation and must be able to refuse one. Making the audit trail
--      load-bearing for permission means an INSERT into it grants power, which
--      inverts what the append-only trigger is protecting.
--
--   b. NO ONE-TIME CONSUMPTION. audit_logs is append-only, enforced by
--      trg_audit_logs_append_only (migration 0002), which rejects UPDATE and
--      DELETE. A single-use token MUST be markable as spent. There is no way to
--      spend an audit row, so one authorization row would authorize an
--      unlimited number of selections for as long as it satisfied the query.
--      That is the whole failure mode this feature exists to prevent.
--
--   c. NO UNIQUENESS TO RACE AGAINST. `id` is a bigint sequence; nothing in the
--      table is unique per (trip, route, evidence). Two concurrent selections
--      would both read the same row, both find it valid, and both proceed. A
--      dedicated table can carry a partial unique index that makes the database
--      refuse the second one, which is where that guarantee belongs.
--
--   d. NO TYPED BINDING. `before`/`after` are free JSONB. Binding an
--      authorization to a route version and an evidence digest through untyped
--      JSON means the binding is enforced by whichever query remembers to check
--      it, i.e. not enforced.
--
-- audit_logs is still written, additionally, exactly as every other mutation
-- writes it. It remains the compliance record. It is not the gate.
--
--
-- ============================================================================
-- 2. WHAT IS BEING AUTHORIZED, AND WHAT CAN NEVER BE
-- ============================================================================
--
-- ONLY `REQUIRES_REVIEW` (app/domain/route_eligibility.py). Reached two ways,
-- and they stay distinguishable in the record:
--
--   ROUTE_HAZARD_DATA_UNKNOWN    landslide evidence is UNKNOWN - nobody looked,
--                                or the source could not answer
--   ROUTE_REVIEW_HIGH_HAZARD     an authority reported an incident on this
--                                corridor that does not close it
--
-- NEVER authorizable, and this is a hard constraint in the schema below rather
-- than a rule in a service somebody can forget:
--
--   REJECTED       a verified active closure. CRITICAL is the only band in
--                  REJECTING_BANDS. No reviewer, role or rationale may override
--                  a road an authority has shut.
--   NOT_ASSESSED   no assessment was produced AT ALL. This is an integration
--                  failure in this application, not uncertainty about a road.
--                  Authorizing it would mean a human vouching for a check that
--                  never ran. It must be fixed, not approved.
--
-- AND: an authorization does NOT relabel the evidence. After consumption the
-- route still assesses UNKNOWN or HIGH and every screen still says so. What is
-- recorded is "a named person accepted this risk at this time", never "this
-- road was checked and is clear". Those are different facts and the second one
-- would be a lie this table must not be able to tell.
--
--
-- ============================================================================
-- 3. SCHEMA
-- ============================================================================

BEGIN;

-- Which of the two review reasons was authorized. Stored, not inferred, so the
-- record says what the reviewer was actually looking at.
CREATE TYPE route_review_basis AS ENUM (
    'HAZARD_DATA_UNKNOWN',
    'HIGH_HAZARD_REPORTED'
);

CREATE TABLE route_review_authorizations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- WHAT IS AUTHORIZED -----------------------------------------------------
    -- Both, not just the route: a route id is unique, but scoping to the trip
    -- as well matches every other route path in this codebase
    -- (`ensure_belongs_to_trip`) and keeps an id from one trip from being used
    -- against another, which is the shape of every IDOR in this system.
    trip_id             uuid NOT NULL REFERENCES trips(id)       ON DELETE CASCADE,
    route_id            uuid NOT NULL REFERENCES trip_routes(id) ON DELETE CASCADE,

    -- BINDING TO THE EVIDENCE THAT WAS REVIEWED -------------------------------
    -- A review of yesterday's evidence must not authorize today's mutation.
    --
    -- evidence_digest is a server-computed hash over the normalised
    -- LandslideAssessment actually shown to the reviewer: risk band,
    -- data_status, provider, on_route_count, unlocatable_count and the sorted
    -- reason codes. NOT over the raw provider payload, which contains
    -- timestamps that change on every poll and would expire every
    -- authorization within seconds.
    evidence_digest     text NOT NULL,
    -- The assessment as shown, kept human-readable for the incident review that
    -- will one day ask what this person was actually looking at.
    evidence_snapshot   jsonb NOT NULL,
    -- app/domain/route_eligibility.VERSION at issue time. A policy change must
    -- invalidate authorizations decided under the old policy.
    policy_version      text NOT NULL,
    -- app/domain/landslide.VERSION, so a change in how evidence is normalised
    -- is equally visible.
    evidence_version    text NOT NULL,
    basis               route_review_basis NOT NULL,

    -- ROUTE VERSION -----------------------------------------------------------
    -- trip_routes rows are immutable in geometry (rerouting INSERTs a new row
    -- and supersedes the old, never UPDATEs - see app/services/routes.py), so
    -- route_id already pins the geometry. This column pins the LIFECYCLE state
    -- the reviewer saw, so an authorization issued against a PROPOSED route
    -- cannot be consumed after that route was superseded.
    route_state_at_issue text NOT NULL,

    -- WHO, AND WHY ------------------------------------------------------------
    -- RESTRICT for the same reason audit_logs.actor_user_id is RESTRICT
    -- (migration 0004): this row pins its reviewer. A safety authorization
    -- whose author can be deleted is not an authorization.
    reviewer_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    -- Free text, REQUIRED, minimum length enforced below. Not a boolean: "a
    -- manager clicked yes" is not a review, and a checkbox produces no evidence
    -- anybody can weigh afterwards.
    rationale           text NOT NULL,

    -- LIFETIME ----------------------------------------------------------------
    -- Both server-set. A client-supplied expiry is a client-chosen one.
    issued_at           timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,

    -- CONSUMPTION -------------------------------------------------------------
    -- Single use. Set in the SAME transaction as the selection it permits.
    consumed_at         timestamptz,
    consumed_by_event_id uuid,

    -- REVOCATION --------------------------------------------------------------
    revoked_at          timestamptz,
    revoked_by_user_id  uuid REFERENCES users(id) ON DELETE RESTRICT,
    revoked_reason      text,

    CONSTRAINT ck_rra_expiry_after_issue
        CHECK (expires_at > issued_at),
    -- A rationale that is a shrug is not a rationale. 20 characters is not a
    -- quality bar, it is a floor that stops "ok" and "asap".
    CONSTRAINT ck_rra_rationale_substantive
        CHECK (length(btrim(rationale)) >= 20),
    CONSTRAINT ck_rra_revocation_complete
        CHECK (num_nonnulls(revoked_at, revoked_by_user_id) IN (0, 2)),
    -- Consumed and revoked are mutually exclusive outcomes.
    CONSTRAINT ck_rra_not_both_consumed_and_revoked
        CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);

-- THE CONCURRENCY GUARANTEE.
--
-- At most ONE live (unconsumed, unrevoked) authorization per route. Two
-- concurrent review submissions cannot both create one, and therefore two
-- concurrent selections cannot each consume their own. Enforced by the
-- database, because two application processes cannot agree on this between
-- themselves.
CREATE UNIQUE INDEX uq_rra_one_live_per_route
    ON route_review_authorizations (route_id)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX ix_rra_trip ON route_review_authorizations (trip_id, issued_at DESC);
CREATE INDEX ix_rra_reviewer ON route_review_authorizations (reviewer_user_id, issued_at DESC);

-- REQUIRED BY AGENTS.md: "Every migration that creates a table must enable it."
-- Supabase publishes `public` through its Data API, so a table created without
-- RLS is readable by anyone holding the anon key, bypassing FastAPI entirely.
-- No policy is added: authorization lives in FastAPI, and the backend connects
-- as a role with rolbypassrls. RLS here contains the Data API and nothing else.
ALTER TABLE route_review_authorizations ENABLE ROW LEVEL SECURITY;

-- Append-mostly, like audit_logs but not identical: consumption and revocation
-- are legitimate UPDATEs, and everything else is not. This trigger allows a row
-- to move forward through its lifecycle exactly once and forbids rewriting what
-- was authorized or why.
CREATE OR REPLACE FUNCTION trg_rra_immutable_core() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'route_review_authorizations rows may not be deleted';
    END IF;
    IF NEW.trip_id           IS DISTINCT FROM OLD.trip_id
    OR NEW.route_id          IS DISTINCT FROM OLD.route_id
    OR NEW.evidence_digest   IS DISTINCT FROM OLD.evidence_digest
    OR NEW.evidence_snapshot IS DISTINCT FROM OLD.evidence_snapshot
    OR NEW.policy_version    IS DISTINCT FROM OLD.policy_version
    OR NEW.evidence_version  IS DISTINCT FROM OLD.evidence_version
    OR NEW.basis             IS DISTINCT FROM OLD.basis
    OR NEW.reviewer_user_id  IS DISTINCT FROM OLD.reviewer_user_id
    OR NEW.rationale         IS DISTINCT FROM OLD.rationale
    OR NEW.issued_at         IS DISTINCT FROM OLD.issued_at
    OR NEW.expires_at        IS DISTINCT FROM OLD.expires_at THEN
        RAISE EXCEPTION 'the authorized facts of a review are immutable';
    END IF;
    IF OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
        RAISE EXCEPTION 'a review authorization may only be consumed once';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rra_immutable_core
    BEFORE UPDATE OR DELETE ON route_review_authorizations
    FOR EACH ROW EXECUTE FUNCTION trg_rra_immutable_core();

COMMIT;

-- ============================================================================
-- 4. APPLICATION CHANGES THIS IMPLIES (none of them in this file)
-- ============================================================================
--
-- PERMISSION - app/core/permissions.py
--   NEW: ROUTE_REVIEW_AUTHORIZE = "route:review_authorize"
--   Deliberately NOT granted to _MANAGER_PERMISSIONS by default. "A manager"
--   is not the same as "a person authorised to accept a landslide risk on
--   behalf of the operator", and folding it into the manager role would make
--   every dispatcher a safety authority by accident. Who holds it is an
--   OPEN POLICY QUESTION for the owner - see section 6.
--   It must also be distinct from ROUTE_SELECT, or the person authorizing and
--   the person acting are guaranteed to be the same person.
--
-- ENDPOINTS - app/api/trips.py
--   POST /api/trips/{trip_id}/routes/{route_id}/review-authorization
--        require_permission(ROUTE_REVIEW_AUTHORIZE)
--        body: { rationale }        <- and NOTHING else
--        The eligibility, basis, evidence digest, snapshot, versions and
--        expiry are ALL computed server-side from the route's own geometry via
--        route_risk.eligibility_for_route. There is no field by which a client
--        can assert what it is authorizing. This is the same rule
--        `select_route` already follows and the reason it computes the
--        decision itself rather than accepting one.
--        422 if the current eligibility is ELIGIBLE (nothing to authorize),
--        REJECTED or NOT_ASSESSED (never authorizable).
--   DELETE .../review-authorization    revoke, same permission.
--   GET    .../review-authorization    read, ROUTE_READ.
--
-- SERVICE - app/services/routes.py
--   `refuse_if_ineligible(decision)` gains an optional authorization argument
--   and REQUIRES_REVIEW alone becomes passable. REJECTED and NOT_ASSESSED
--   remain unconditional raises with no parameter that can affect them - the
--   hard limit is expressed as "there is no code path", not as a check.
--
-- UI - manager-web/src/pages/FleetPage.tsx
--   The review-required banner gains an "Authorise this route" action, visible
--   ONLY when the user holds route:review_authorize (permissions already
--   arrive from /api/auth/me). It opens a form that shows the evidence and
--   REQUIRES the rationale. It is never a one-click confirm.
--
--
-- ============================================================================
-- 5. CONSUMPTION: THE ORDER THAT MAKES IT ATOMIC
-- ============================================================================
--
-- Inside `apply_selection`, under the EXISTING lock order (trips row first -
-- see app/services/routes.py), with no external call anywhere inside it:
--
--   1. eligibility is computed BEFORE the lock, as today (hazard lookup is
--      network I/O and must not be held across a row lock).
--   2. trips row locked (`trips.load_for_update`, which since LS-9 issues
--      `populate_existing=True` so the locked read is not served stale from
--      the identity map).
--   3. route re-read and re-validated under that lock, as today.
--   4. the authorization is claimed with a single conditional UPDATE:
--
--        UPDATE route_review_authorizations
--           SET consumed_at = now(), consumed_by_event_id = :event_id
--         WHERE id = :id
--           AND route_id = :route_id AND trip_id = :trip_id
--           AND consumed_at IS NULL
--           AND revoked_at IS NULL
--           AND expires_at > now()
--           AND policy_version = :current_policy_version
--           AND evidence_version = :current_evidence_version
--           AND evidence_digest = :digest_recomputed_at_step_1
--        RETURNING id;
--
--      Zero rows returned = refuse the whole mutation. The claim is the same
--      statement as the check, so there is no window between them: a
--      concurrent request either updated it first (and this one gets zero
--      rows) or has not yet run.
--   5. selection, demotion, trips.selected_route_id, the ROUTE_CHANGED event
--      and the audit row, all as today.
--   6. one commit for all of it. A failure at any point rolls the consumption
--      back with the selection, so an authorization is never spent on a
--      mutation that did not happen.
--
-- IDEMPOTENT RETRY: a client that retries after a timeout presents the same
-- authorization id. The second attempt matches zero rows because consumed_at
-- is set, and is refused with a distinct code (ROUTE_REVIEW_ALREADY_CONSUMED)
-- so the UI can say "this already went through, reload" rather than "denied".
--
-- INVALIDATION, all of it falling out of the WHERE clause above rather than
-- needing a sweeper:
--   route superseded          route_state re-read at step 3 refuses first
--   trip lifecycle moved on   existing state-machine checks refuse first
--   evidence changed          evidence_digest no longer matches
--   policy changed            policy_version no longer matches
--   normalisation changed     evidence_version no longer matches
--   expired                   expires_at
--   revoked                   revoked_at
--   already used              consumed_at
--
-- EXPIRY WINDOW: proposed 30 minutes, server-set. Chosen to be shorter than a
-- weather sampling cycle is meaningful for and long enough for a person to read
-- the evidence and decide. This is a POLICY CHOICE, not a derived number, and
-- it is flagged as one in section 6.
--
--
-- ============================================================================
-- 6. WHAT THE OWNER MUST DECIDE (not decidable from the code)
-- ============================================================================
--
--   1. WHO holds route:review_authorize. Options: a new AUTHORISED_REVIEWER
--      role; an attribute on existing managers; or admin-only. Recommendation:
--      a distinct role, and NOT granted to MANAGER by default.
--   2. Whether the authorizer may also be the selector, or whether two people
--      are required. Two-person control is stronger and slower. The schema
--      supports either; only the service check differs.
--   3. The expiry window. 30 minutes is proposed, not derived.
--   4. Whether HIGH_HAZARD_REPORTED and HAZARD_DATA_UNKNOWN need DIFFERENT
--      authority levels. They are different facts - "known dangerous" versus
--      "unmeasured" - and it is defensible that only the second is delegable.
--
--
-- ============================================================================
-- 7. ACCEPTANCE TESTS TO WRITE BEFORE THIS SHIPS
-- ============================================================================
--
--   1. REJECTED cannot be authorized - the endpoint refuses to issue.
--   2. NOT_ASSESSED cannot be authorized - refuses to issue.
--   3. A consumed authorization cannot be reused (second select refused).
--   4. Two CONCURRENT selects with one authorization: exactly one succeeds.
--      Same barrier shape as tests/test_stale_selection_interleaving.py.
--   5. Evidence changing between issue and consumption refuses (digest).
--   6. Route superseded between issue and consumption refuses - reuse the
--      LS-9 interleaving harness directly.
--   7. Expiry refuses.
--   8. Revocation refuses.
--   9. A user WITHOUT route:review_authorize cannot issue one (403).
--  10. After a successful authorized selection, the route STILL reports
--      UNKNOWN/HIGH to every reader. This is the test that stops the feature
--      from quietly becoming "mark as safe".
--  11. audit_logs receives the issue, the revoke and the consumption.
--
-- ESTIMATE: roughly 1 focused session for backend + tests, and a second for the
-- manager UI, ASSUMING section 6 is answered first. The schema is the small
-- part; the acceptance tests are most of it.
--
--
-- ============================================================================
-- 8. EXACT ACTION BEING REQUESTED (nothing has been done)
-- ============================================================================
--
-- NOT REQUESTED YET. This file is the priced design the LS-8 handoff asked for
-- in place of "it almost certainly needs a table".
--
-- When approval is given, the exact action is:
--   - move this DDL into backend/alembic/versions/0007_route_review_authorizations.py
--     with a matching downgrade, and
--   - run `alembic upgrade head` against the target the owner names.
--
-- AFFECTED DATABASE: whatever DATABASE_URL points at, which today is the
-- SHARED hosted Supabase project - which is precisely why this is not being
-- done unasked. It can be exercised first against the isolated cluster
-- (127.0.0.1:55432/ner_logistics_test) with no approval needed there.
--
-- No credential appears in this file and none is needed to review it.


-- ============================================================================
-- 9. LS-11 G0 INSPECTION — WHAT WAS ACTUALLY CHECKED IN THE CODE
-- ============================================================================
--
-- Added after tracing the real role storage, evidence shapes and lock order.
-- Nothing here changes the design above; it prices it and closes three
-- questions the design had left implicit. STILL NOT APPLIED.
--
--
-- 9.1 THE ROLE CHOICE IS A SCHEMA DECISION, NOT JUST A POLICY ONE
--
-- `users.role` is a NATIVE POSTGRES ENUM (`pg_enum(UserRole)`,
-- app/models/base.py, create_type=False so migrations own it), and permissions
-- are a static role -> frozenset map in app/core/permissions.py. There is NO
-- per-user permission table anywhere in the schema - checked.
--
-- That makes the three options for section 6 question 1 cost very different
-- things, which was not visible when the question was written:
--
--   (a) distinct AUTHORISED_REVIEWER role
--       Needs `ALTER TYPE user_role ADD VALUE 'AUTHORISED_REVIEWER'` IN
--       ADDITION to the new table. PostgreSQL is 18.2 here, so ADD VALUE
--       inside a transaction is allowed - but the new value must not be
--       depended on by the same migration that adds it. So this is TWO
--       revisions, or one revision plus a separate seeding step, and the
--       enum value can never be removed later (Postgres has no DROP VALUE).
--       Also requires a ROLE_PERMISSIONS entry, or `permissions_for` returns
--       an empty set and the role is silently powerless.
--
--   (b) an attribute on existing managers
--       MOST expensive, not least. It requires inventing a per-user
--       permission mechanism that does not exist today, plus every read path
--       that currently derives permissions from the role alone. Not
--       recommended for a first implementation.
--
--   (c) admin-only
--       CHEAPEST BY FAR. `ROLE_PERMISSIONS[UserRole.ADMIN] = ALL_PERMISSIONS`,
--       so adding ROUTE_REVIEW_AUTHORIZE to ALL_PERMISSIONS grants it to ADMIN
--       automatically with NO enum change and NO role migration. Only the
--       authorization table itself is a schema change.
--       Note the implication: it is an IMPLICIT grant. Every existing admin
--       becomes a hazard reviewer the moment the constant is added.
--
--
-- 9.2 QUESTIONS 1 AND 2 INTERACT — THEY CANNOT BE ANSWERED SEPARATELY
--
-- Whether "reviewer must not be the selector" is structural or merely checked
-- depends entirely on the answer to question 1:
--
--   distinct role  -> STRUCTURAL. An AUTHORISED_REVIEWER that is not granted
--                     `route:select` physically cannot perform the selection.
--                     Two-person control follows from the permission sets.
--
--   admin-only     -> A CODE CHECK ONLY. ADMIN holds ALL_PERMISSIONS, so the
--                     same admin has both `route:review_authorize` and
--                     `route:select`. Separation then rests on an explicit
--                     `reviewer_user_id != actor.id` comparison at
--                     consumption, and on nothing else. That check must exist
--                     and be tested, because deleting one line would silently
--                     collapse two-person control to one person.
--
--
-- 9.3 THE EVIDENCE DIGEST IS STABLE — VERIFIED AGAINST THE REAL TYPES
--
-- The stated risk was that a digest which moves on every read would expire
-- every authorization within seconds. Checked against the actual dataclasses:
--
--   `LandslideAssessment` (app/domain/landslide.py) has NO timestamp field.
--   Its members are risk, data_status, reason_codes, considered_count,
--   on_route_count, unlocatable_count, provider.
--
--   `RouteRisk` DOES carry `assessed_at` (app/domain/route_risk.py) - and the
--   digest above deliberately does not cover RouteRisk. That is the whole
--   reason it is specified over the LandslideAssessment instead.
--
--   `considered_count` is deliberately EXCLUDED from the digest as well. It
--   counts incidents the provider returned before route filtering, so a new
--   landslide elsewhere in the bounding box would change it while nothing on
--   this corridor changed. Including it would invalidate authorizations on
--   irrelevant news.
--
-- So: equivalent evidence produces an identical digest, and a substantive
-- on-route change produces a different one. That is the property section 5
-- relies on, and it now rests on inspection rather than assumption.
--
--
-- 9.4 ATOMICITY COMES FROM THREE MECHANISMS, NOT THE INDEX ALONE
--
-- Stated explicitly because the partial unique index is easy to over-read:
--
--   uq_rra_one_live_per_route  prevents TWO LIVE authorizations existing for
--                              one route. It says nothing about consumption.
--
--   the trips row lock         `trips.load_for_update` already serializes
--                              concurrent selections of the same trip, and an
--                              authorization is bound to one trip. This is
--                              what actually orders two racing consumers.
--                              Since LS-9 it re-reads with populate_existing,
--                              so the locked read is not served stale from the
--                              identity map - which this feature depends on.
--
--   the conditional UPDATE     makes the CLAIM atomic with the selection: the
--                              check and the write are one statement, in the
--                              same transaction as the route change, so there
--                              is no window between validating and spending.
--
-- None of the three is sufficient alone. The acceptance test for concurrency
-- must exercise the real service path, not just assert the index exists.
--
--
-- 9.5 IF THE POLICY NARROWS TO UNKNOWN-ONLY
--
-- A narrowed first implementation (authorize assessed HAZARD_DATA_UNKNOWN
-- only; HIGH not authorizable) does NOT need a schema change. KEEP the
-- `route_review_basis` enum with both values and refuse HIGH in the service,
-- with a test proving the refusal. Removing the value now would mean another
-- `ALTER TYPE ... ADD VALUE` to reinstate it later, and Postgres cannot drop
-- an enum value at all.
--
--
-- 9.6 WHAT IS STILL BLOCKED
--
-- Section 6 question 1 remains the gate. Until it is answered there is no
-- migration to write, because the answer decides whether the migration is
-- one revision (admin-only) or two plus a seeding step (distinct role).
