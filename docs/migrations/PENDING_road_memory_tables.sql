-- PREPARED. NOT APPLIED. REQUIRES EXPLICIT APPROVAL BEFORE RUNNING.
--
-- SCHEMA_APPLICATION_REQUIRES_APPROVAL = YES
--
-- Deliberately NOT an alembic revision and NOT in backend/alembic/versions/.
-- Anything there is applied by the next `alembic upgrade head`, including the
-- one the test suite runs, and this database is shared. Promoting this to a
-- revision IS the approval step.
--
-- Backs app/domain/road_memory.py, whose rules and rationale are documented in
-- docs/ROAD_MEMORY.md. Nothing in the application writes these tables yet; the
-- domain model is a pure fold and is fully tested without them.
--
--
-- SHAPE, AND WHY
--
-- Two tables, not one. The belief is NOT stored - it is folded from the
-- evidence on read (road_memory.apply). A stored status is a number that can
-- drift away from the observations that justify it, and the whole point of
-- this feature is that every belief traces to an observation. If the fold ever
-- becomes too slow to do on read, the answer is a materialised view that can be
-- rebuilt from the log, never a hand-maintained status column.
--
-- road_segments is deliberately thin. It is an identity for a stretch of road,
-- not a copy of the road network: geometry plus a name. Route matching happens
-- spatially via PostGIS, the same way trip routes already work.
--
-- road_evidence is append-only. There is no UPDATE path and no soft delete: a
-- report that turned out to be wrong is corrected by a NEW row, because "this
-- road is reported unreliably" is itself a fact worth keeping. Enforcing that
-- is a matter of not writing an update, plus a revoke if the deployment ever
-- gets per-role grants.
--
--
-- SAFETY
--
-- Purely additive. Two new tables, two new enum types, no existing table
-- touched, no column dropped, no data rewritten. Fully reversible by dropping
-- what it creates.

CREATE TYPE road_evidence_kind AS ENUM (
    'INCIDENT_REPORTED',
    'CLOSURE_DECLARED',
    'REPAIR_CLAIMED',
    'PASSAGE_OBSERVED',
    'REOPENING_DECLARED'
);

CREATE TYPE road_evidence_source AS ENUM (
    'OFFICIAL_AGENCY',
    'FLEET_TRAVERSAL',
    'OPERATOR_REPORT',
    'UNVERIFIED_REPORT'
);

CREATE TABLE road_segments (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          varchar(200) NOT NULL,
    -- e.g. 'NH-715'. Not unique: one highway is many segments, and the
    -- segment is the unit a landslide closes.
    highway_code  varchar(32),
    geometry      geography(LineString, 4326) NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Spatial index: every read of this table is "which segments does this route
-- cross", which is a spatial predicate and must never be a sequential scan.
CREATE INDEX ix_road_segments_geometry ON road_segments USING GIST (geometry);
CREATE INDEX ix_road_segments_highway ON road_segments (highway_code);

CREATE TABLE road_evidence (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    segment_id   uuid NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
    kind         road_evidence_kind NOT NULL,
    source       road_evidence_source NOT NULL,
    -- When the observation was MADE, which is not when the row was written.
    -- A bulletin read three days late is evidence about three days ago, and
    -- road_memory.apply orders on this column precisely so a late-arriving
    -- report cannot overwrite a newer observation.
    observed_at  timestamptz NOT NULL,
    recorded_at  timestamptz NOT NULL DEFAULT now(),
    detail       text,
    -- Bulletin URL, trip id, operator user id. Evidence that cannot be traced
    -- back is evidence that cannot be checked when it turns out to matter.
    reference    varchar(500),

    -- The application rule from road_memory.CAN_OPEN, restated where the
    -- database can enforce it. An application guard is bypassed by any script
    -- with a connection string, and the failure it prevents - a rumour
    -- reopening a closed road - is the one that puts a truck on a hillside.
    CONSTRAINT ck_road_evidence_only_observation_opens CHECK (
        kind NOT IN ('PASSAGE_OBSERVED', 'REOPENING_DECLARED')
        OR source IN ('OFFICIAL_AGENCY', 'FLEET_TRAVERSAL')
    ),
    -- An observation from the future is a clock bug or a bad import, and it
    -- would sort to the head of the fold and become the current belief.
    CONSTRAINT ck_road_evidence_not_future CHECK (
        observed_at <= recorded_at + interval '1 hour'
    )
);

-- The fold reads one segment's history in observed_at order. DESC so a
-- BOUNDED read - see the requirement below - is an index-ordered scan of the
-- newest rows rather than a sort of the whole segment.
CREATE INDEX ix_road_evidence_segment_time
    ON road_evidence (segment_id, observed_at DESC);
-- Recurrence counting. LEADING COLUMN IS segment_id, not kind: the query is
-- "how often has THIS stretch failed", so it is an equality on segment_id, an
-- equality on kind, and a range on observed_at - in that order. An index led by
-- `kind` would have to scan every INCIDENT_REPORTED row in the table, across
-- every segment in the region, and filter the segment out afterwards. On the
-- corridors with the most history - the ones this feature exists for - that is
-- the worst possible shape.
CREATE INDEX ix_road_evidence_segment_kind_time
    ON road_evidence (segment_id, kind, observed_at DESC);

-- =====================================================================
-- REQUIREMENT ON WHOEVER IMPLEMENTS THE READ PATH
-- =====================================================================
--
-- `road_memory.apply()` today takes a list and sorts it. That is correct for a
-- pure function over an in-memory log and it is NOT a safe shape to point at
-- this table, because `road_evidence` is append-only and therefore unbounded:
-- a segment on a monsoon corridor accumulates rows for as long as the system
-- runs, and a fold that loads the whole history does more work every year for
-- an answer that depends almost entirely on the newest rows.
--
-- So the read path MUST be bounded. Two rules, and they are not
-- interchangeable:
--
--   1. BOUND BY ROWS for the belief. `apply()` only ever consults the LATEST
--      observation, plus the count. Reading the newest N rows
--      (ORDER BY observed_at DESC LIMIT N) is index-ordered on the index above
--      and is sufficient for the status. N must be >= 2 so a correction that
--      arrived late is still visible behind the row it corrects.
--
--   2. DO NOT bound the RECURRENCE count the same way. `recurrence()` answers
--      "how often has this stretch failed", which is a statement about the
--      whole history and is exactly what a truncated read would understate -
--      and understating recurrence makes a bad road look safe, which is the
--      one direction this system must never fail in. Compute it as an
--      aggregate IN THE DATABASE:
--
--          SELECT count(*) FROM road_evidence
--           WHERE segment_id = $1 AND kind = 'INCIDENT_REPORTED'
--             AND ($2::timestamptz IS NULL OR observed_at >= $2)
--
--      which is served by ix_road_evidence_segment_kind_time and never
--      loads a row.
--
-- Stated here rather than left to be rediscovered, because the failure is
-- invisible in testing: a fold over a young table is fast, and the cost only
-- appears on the segments that have the most history - which are the ones that
-- matter most.
--
-- If the per-read fold ever becomes the bottleneck even when bounded, the
-- answer is a materialised view that can be REBUILT FROM THE LOG, never a
-- hand-maintained status column. A status that can drift from its evidence
-- defeats the entire design.

-- After applying, app/models/ needs matching ORM classes and
-- tests/test_schema_drift.py must be updated, or it will fail - which is that
-- test doing its job.
--
-- DOWN:
--   DROP TABLE road_evidence;
--   DROP TABLE road_segments;
--   DROP TYPE road_evidence_source;
--   DROP TYPE road_evidence_kind;
