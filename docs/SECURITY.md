# Security

**Status: design specification.** Implemented today: environment-based secret loading, `.env`
excluded from version control, and no secrets in frontend or mobile source. Everything else is a
requirement to build against.

This document covers a system that tracks the **real-time location of named individuals** and holds
their identity documents. That is the highest-sensitivity data class in the project, and it is not
incidental to the product — it is the product. The controls below are proportionate to that.

---

## 1. Authentication

| Decision | Choice | Reason |
| --- | --- | --- |
| Password hashing | **Argon2id** (t=3, m=64 MiB, p=4) | Memory-hard; bcrypt's 72-byte truncation is a footgun |
| Session tokens | JWT access (15 min) + opaque refresh (30 d, rotating) | Short access window limits a stolen token; opaque refresh is revocable |
| Refresh rotation | Single-use, with reuse detection | A replayed refresh token revokes the whole family — this is how stolen-token theft is actually caught |
| Driver identifier | Phone + password | Drivers do not reliably have email |
| Algorithm | HS256 with a 256-bit secret, or RS256 if a second service appears | Must be pinned; `alg: none` and algorithm confusion rejected explicitly |

- Login returns an identical response and comparable timing for unknown-user and
  wrong-password, so the endpoint cannot enumerate valid phone numbers. **Implemented**
  (`app/services/auth.py` verifies against a dummy Argon2 hash when no user matches).
  Rate limiting is **specified but NOT implemented** — see section 6.
- Drivers stay signed in for long periods by design — re-authenticating on a hill road at night is
  a safety problem, not just a UX one. Refresh tokens are long-lived and device-bound; the mitigation
  for a lost phone is server-side revocation, not a short session.
- Tokens are stored in `expo-secure-store` on mobile (Keychain / Keystore), never `AsyncStorage`.
  **Implemented in P4.** Only the refresh token is stored; the access token stays
  in memory. On the Expo *web* target nothing is persisted and the driver signs
  in again - `localStorage` would be readable by any XSS payload.

> **The driver app never sends cookies** (`credentials: 'omit'`). During
> development both apps talk to the same API host, and a shared cookie jar let
> the driver app silently adopt the manager's session. The authorization
> boundary caught it - `GET /api/driver/me` returned 403 because a manager has no
> driver profile - but one application must not pick up another's session at
> all. The driver app therefore supplies its token explicitly.
- Web uses in-memory access tokens with the refresh token in an `HttpOnly`, `Secure`, `SameSite=Strict`
  cookie. No token in `localStorage`. **Implemented** - the cookie is scoped to
  `/api/auth`, and the web client never sees its own refresh token.

### The delivery contract is declared, not sniffed

`POST /api/auth/login` and `/refresh` take a `client` field: `"web"` (the
default) or `"mobile"`.

| `client` | Refresh token delivery | Cookie set |
| --- | --- | --- |
| `web` | **Omitted from the response body entirely** | yes, `HttpOnly` |
| `mobile` | Returned in the body, for `expo-secure-store` | no |

**This was wrong until P6 and the fix is not cosmetic.** Both endpoints set the
cookie correctly *and* returned the token in the body, to every caller. So the
`HttpOnly` cookie was protecting a credential that had already been handed to
page JavaScript: an XSS payload on the manager app could read a token good for
**30 days** out of the login response, rather than the 15 minutes an access
token is worth. The bullet above was true about the cookie and false about the
outcome.

Two design points:

- **Declared, never inferred.** Nothing inspects the `User-Agent`. If delivery
  were sniffed, any caller could ask for the token in the body simply by
  claiming to be a phone, and the confidentiality of a long-lived credential
  would rest on a header anyone can set.
- **Defaults to `web`,** the more restrictive treatment. A client that forgets
  to declare itself cannot read the token, rather than silently being handed
  one. An unrecognised value is a 422, not a guess.

Proven by `tests/test_auth.py`, which asserts against the **actual issued
token** - the value in the cookie - rather than the presence of a field name, so
the check cannot be satisfied by renaming something.

> **Development gotcha, now enforced by configuration.** `SameSite` compares
> registrable domains and ignores ports. `localhost:5173` -> `localhost:8000` is
> same-site and the cookie flows; `localhost:5173` -> `127.0.0.1:8000` is
> *cross-site* and the browser silently drops it, so sessions do not survive a
> reload. `manager-web/.env` therefore uses `localhost`.

> **Concurrent refreshes are a logout.** Rotation with reuse detection makes two
> simultaneous refreshes indistinguishable from a replay, so the family is
> revoked. The web client single-flights refresh (`refreshSession` in
> `manager-web/src/api/client.ts`). Without it, two API calls expiring together -
> or React StrictMode's double-invoked effects - log the user out.
> **Fixed in P4** using the Web Locks API (`navigator.locks`), which is
> same-origin, cross-tab, and releases automatically if the holding tab dies.
> Waiting tabs refresh afterwards using the cookie the leader already rotated -
> a legitimate new rotation, not a replay.
>
> **Reuse detection is not weakened.** The lock is scoped to one browser profile
> and one origin. An attacker replaying a stolen token from another browser,
> profile or machine never acquires it, reaches the server with a spent token,
> and still revokes the family. Only our own false positives are suppressed.
> No token crosses the lock; waiting tabs re-refresh rather than receiving a
> broadcast token. Covered by `manager-web/src/api/client.test.ts`.

---

## 2. Authorization

Role-based, enforced **server-side on every request**. Client-side role checks are cosmetic and are
never the control.

| Resource | ADMIN | MANAGER | DRIVER |
| --- | --- | --- | --- |
| Drivers / trucks CRUD | full | full except salary fields | read own profile |
| Assignments | full | create, review | verify own |
| Shipments / trips | full | full | read own, start/complete own |
| GPS ingestion | — | — | **own active trip only** |
| GPS history | full | full | own trips only |
| Routes / incidents | full | full | read; report incidents |
| Payments / payroll | full | trip payments only | own payroll read-only |
| Emergencies | full | view, resolve | **respond to own only** |
| Audit logs | read | read scoped | none |

Two rules that carry most of the weight:

1. **Object-level authorization on every endpoint, not just route-level.** A driver holding a valid
   token must not read another driver's trip by changing the ID. This is the most commonly missed
   control (OWASP API #1) and every list query is scoped by principal at the query layer, not
   filtered after fetching.
2. **Non-existence and forbidden are indistinguishable to drivers.** Requesting another driver's
   trip returns `404`, not `403`, so the API does not confirm what exists.

---

## 3. Location Privacy

The most sensitive data we hold. Specific commitments:

- **Collected only during an ACTIVE trip.** Trip ends → collection stops. This is enforced
  server-side: `POST /api/driver/me/location` resolves the trip from the authenticated driver and
  refuses unless it is in progress, so an app bug, a tampered client or a background task the app
  failed to stop cannot cause off-duty tracking. *(Implemented P5; the endpoint was planned as
  `POST /api/gps/batch` — see [API_CONTRACTS.md](API_CONTRACTS.md) §8 for why the path changed.)*
- **The client never names its own subject.** `driver_id`, `truck_id`, `trip_id`-as-owner and
  `user_id` are absent from the ingestion contract entirely, and `extra="forbid"` makes an attempt
  to send one a 422 rather than a silently ignored field. Trip and driver come from the token.
- The driver app shows a **persistent, non-dismissible indicator** while tracking, and the trip
  screen states plainly that location is shared with the fleet manager. *(Implemented P5.)* The
  indicator distinguishes capturing from delivering: it reads "Location active" only when the
  server is accepting fixes, and switches to a failure state showing the queue depth when it is
  not. A driver who believes they are being tracked while the queue is stalled is worse off than
  one who knows they are not.
- **Foreground only.** No background location permission is requested and no background task is
  registered (`isAndroidBackgroundLocationEnabled` and `isIosBackgroundLocationEnabled` are both
  false). Asking for access the product has no use for is both a worse consent conversation and a
  larger thing to get wrong.
- **Denial is a supported state.** Refusing the permission does not crash the app, does not retry
  in a loop, and never causes fabricated coordinates. Every trip control keeps working; only the
  position sharing stops, and the screen says so.
- Consent is captured at onboarding, recorded with timestamp and version, and is re-shown when the
  policy changes.
- **No third-party analytics or advertising SDKs in the driver app.** Location data goes to our
  backend and nowhere else.
- Location history is visible to managers and admins only, never to other drivers. Enforced by a
  dedicated permission, `fleet:location_read`, which the DRIVER role does not hold — deliberately
  separate from `trip:read` so a future read-only role can see trip progress without seeing a
  person's position. *(Implemented P5.)*
- **No unbounded history endpoint.** `GET /api/trips/{id}/track` is capped and has no all-time
  mode. An unrestricted GPS dump turns an authorised "where is this truck" read into a complete
  movement profile of a person. *(Implemented P5.)*
- **Position never enters the audit log or ordinary request logs.** GPS is written to `gps_points`
  and nowhere else: one `audit_logs` row per fix would both bury the compliance trail and copy a
  driver's movements into a table that is append-only and retained for two years. *(Implemented P5;
  pinned by a test that asserts the audit table does not grow during ingestion.)*
- Precise history is retained 90 days, then reduced to a simplified polyline plus aggregates
  (see §10).
- Off-duty location is never collected, so there is no "personal movement" dataset to leak.

---

## 4. Document and File Security

Driver licences and truck registrations are identity documents.

- Stored in **private** object storage. No public bucket, no guessable URL.
- Access via **short-lived signed URLs** (5 min), issued per-request after an authorization check.
- Encrypted at rest; TLS in transit.
- Filenames are server-generated UUIDs — the client-supplied filename is never used on disk
  (path traversal, and it often contains personal information).
- Document access is audit-logged with actor and timestamp.

### Upload validation (all of these, in order)

1. Size cap: 10 MB images, 25 MB documents — enforced by the server, and by the reverse proxy
   before the body is read.
2. Extension allowlist: `.jpg .jpeg .png .webp .pdf`. Allowlist, never blocklist.
3. **Content-type verified from magic bytes**, not the `Content-Type` header or the extension.
4. Images re-encoded server-side (Pillow) — this strips embedded payloads and **strips EXIF,
   including GPS coordinates**, which would otherwise leak a driver's home location from a photo
   taken off-duty.
5. PDFs checked for embedded JavaScript.
6. Stored outside the web root; never served from the application origin.
7. Response headers `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.

---

## 5. Secret Management

**Currently enforced.**

### Supabase key hierarchy - the most dangerous thing in this project

| Credential | Sensitivity | Where it may live |
| --- | --- | --- |
| `SUPABASE_URL` | Public identifier | Anywhere |
| Publishable / `anon` key | Public by design; RLS is what protects data behind it | A client, *if ever needed* - currently unused |
| **`SUPABASE_SERVICE_ROLE_KEY`** | **Total bypass of row-level security** | `backend/.env` only, and only once actually required. **Never** in a client, a bundle, a log, a doc, or git |
| Database password | Full database access | `backend/.env` only, inside `DATABASE_URL` |

The service-role key is not needed for this phase and is deliberately absent from
`.env.example`. It is not required to prove connectivity or to run migrations -
the database password already grants what Alembic needs.

**Clients never hold any Supabase credential.** The manager web app and driver app
talk only to FastAPI. This is not merely convention: it is what keeps capacity
rules, document enforcement and the Fleet Sentinel safety path unbypassable. A
client holding a database key could write `trips` directly and route a truck onto
a closed road.

### RLS is NOT the backend authorization boundary

Measured, not assumed: the backend connects to Supabase as the `postgres` role,
which has **`rolbypassrls = true`**. Every RLS policy is therefore invisible to
the application's own queries.

```
Manager web / Driver app
        |  authenticated HTTP
        v
     FastAPI          <- app/core/permissions.py enforces authorization HERE
        |  privileged connection (bypasses RLS)
        v
   PostgreSQL         <- RLS contains the Supabase Data API, nothing else
```

| Layer | Protects against |
| --- | --- |
| `app/core/permissions.py` | Every request that reaches FastAPI |
| Row Level Security | Direct Data API access with the anon key |

Conflating the two would produce policies that look like security while
enforcing nothing on the path clients actually use. Pinned by
`tests/test_rls_boundary.py`, which fails loudly if the backend role ever stops
bypassing RLS — that would be a significant architecture change, not a detail.

### Row Level Security is mandatory on every table

Supabase publishes the `public` schema through the PostgREST Data API. **A table
created without RLS is readable by anyone holding the anon key**, entirely
bypassing FastAPI. For this project that would mean exposing driver identity
documents and live GPS traces.

Therefore every table, from the bootstrap `system_info` onward, runs:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
```

with **no policies**, which denies all Data API access. The backend connects as
the `postgres` role, which bypasses RLS and is unaffected. This is asserted by a
test, not left to reviewer memory.

If Supabase Auth is adopted later (see [ARCHITECTURE.md](ARCHITECTURE.md) section 11),
policies may be added deliberately - but the default stays deny.

### Connection URL handling

`DATABASE_URL` contains the database password in its userinfo. It is therefore:

- never logged - `Settings.safe_dump()` reduces it to `scheme://***@host:port/db`
- never returned by an endpoint - `/ready` reports only the provider name
- never included in an exception surfaced to a client - the readiness check
  reports the exception *class*, not its message, because psycopg embeds the full
  connection string in connection errors


- All configuration via environment variables, loaded with `pydantic-settings`.
- `.env` is git-ignored; `.env.example` contains placeholders only and no real value.
- No secret in `manager-web/` or `driver-app/` source. **Anything reaching a client is public** —
  Vite inlines `VITE_*` into the bundle and Expo inlines `EXPO_PUBLIC_*`, so only non-sensitive
  values (the API base URL) use those prefixes. This is a build-time property, not a convention.
- `SECRET_KEY` has no default and the application **refuses to start** without it when
  `APP_ENV != development` — a development default that silently reaches production is a
  well-worn way to ship a forgeable token signer.
- No secret is logged. Config values are redacted in startup logs.
- Pre-commit secret scanning before any secret-bearing work begins.

---

## 6. Rate Limiting

> **STATUS: SPECIFIED, NOT IMPLEMENTED.** No rate limiting exists in the codebase as of
> P5. The only occurrence of `429` in the backend is the status-code→name entry in
> `app/core/errors.py`; there is no limiter, no middleware, no counter store, and no
> rate-limiting dependency in `backend/requirements.txt`. Nothing in the system emits a
> `429` today.
>
> This section is the **design** to be built, not a description of current behaviour.
> The table below is a target. Until it ships, the login endpoint is protected only by
> Argon2id's cost (~100 ms per attempt) and by timing equalisation — which defeats
> *enumeration* but does not bound *guessing*.
>
> Accepted for the hackathon because the application is not publicly deployed: it runs on
> a laptop against a development Supabase project, reachable only from the local network.
> It **must** be implemented before any public deployment. Listed in section 12.

Per-principal, sliding window — **target design**:

| Endpoint | Limit | Rationale |
| --- | --- | --- |
| `POST /api/auth/login` | 5/min per IP **and** per identifier | Both, so neither a single IP nor a distributed attack on one account gets through |
| `POST /api/gps/batch` | 60/min per driver, 500 fixes per batch | Generous — an offline truck reconnecting flushes a large backlog legitimately |
| File uploads | 20/hour per user | |
| Read endpoints | 300/min per user | |
| `POST /api/emergencies/{id}/respond` | **Effectively unlimited** | Never rate-limit a driver saying they need help |
| `POST /api/incidents` (driver) | 10/hour | Limits report spam; confirmation is a manager action anyway |

Once built, limits will be enforced with `429` and `Retry-After`. The driver app is already
ready for that half of the contract: `classifyUploadError` in
`driver-app/src/tracking/useLocationTracking.ts` treats `429` as retryable and the tracker
backs off exponentially rather than hammering — so the client behaviour is implemented and
tested, and only the server side is outstanding.

---

## 7. Audit Logging

Every consequential action writes to `audit_logs`: actor, action, entity, before/after, reason, IP,
timestamp.

Mandatory coverage: authentication events; driver/truck/assignment changes; trip lifecycle
transitions; **every emergency state change**; payment and payroll changes; document access and
upload; permission changes; manager overrides of any flag.

The table is **append-only** — `UPDATE` and `DELETE` are revoked from the application role, so
application-level compromise cannot rewrite history. Retained 2 years.

---

## 8. GPS Spoofing

A driver can fake location with a rooted device or a mock-location app. Perfect prevention is not
achievable on consumer hardware and we do not claim it. The posture is **detect, record, surface —
never auto-punish.**

| Signal | Handling |
| --- | --- |
| Android `isFromMockProvider` | Stored in `gps_points.is_mock_location`, surfaced to the manager |
| Physically implausible speed between fixes | Flagged; point retained |
| Teleportation (large jump, short interval) | Flagged |
| Perfectly regular timing/positions | Flagged as a heuristic |
| Device attestation (Play Integrity) | Future; not MVP |

Flags are advisory. **They never trigger disciplinary action automatically and never suppress a
safety check.** A spoofing flag on a truck that is genuinely stuck must not stop Fleet Sentinel from
escalating — the failure mode of treating a false GPS as "not really stopped" is someone not being
found.

Server timestamps (`received_at`) govern all safety timers, so a manipulated device clock cannot
extend a 30-minute response window.

---

## 9. SOS Abuse and Reliability

The threat here is under-response and alert fatigue more than malicious abuse.

- The 60-minute stationary check is **automatic**; drivers cannot self-trigger the automated
  escalation, which removes the main abuse vector.
- A driver-initiated panic action (planned) is deliberately **not** rate-limited. Suppressing a
  genuine emergency to prevent nuisance is the wrong trade.
- Repeated false alarms are handled by manager resolution codes and human follow-up, not by
  automatic suppression.
- `uq_open_emergency_per_trip` (see [DATA_MODEL.md](DATA_MODEL.md) §11) prevents duplicate
  escalation storms from a monitor bug.
- **Alert fatigue is a security failure.** `COMMS_LOST` is kept distinct from `SOS_ESCALATED`
  precisely so managers do not learn to dismiss the critical alert.
- Sentinel scheduler health is itself monitored; a silent scheduler is a Sev-1.

---

## 10. Data Retention

| Data | Retention | Then |
| --- | --- | --- |
| GPS points (precise) | 90 days | Simplified route polyline + aggregates; raw points deleted |
| Trip records | 3 years | Anonymised |
| Driver documents | Employment + 1 year | Deleted |
| Audit logs | 2 years | Archived |
| Emergency records | 5 years | Retained — safety evidence |
| Weather/incident raw payloads | 1 year | Aggregated |
| Deactivated driver account | 30-day grace | PII **anonymised in place**, trip history retained |

> **Users are never hard-deleted.** `audit_logs.actor_user_id` is `ON DELETE
> RESTRICT` (migration 0004): an audit row pins its actor, so nobody can erase
> who did something by deleting the user. Retention therefore anonymises the
> `users` row with an UPDATE — which touches no audit record — rather than
> issuing a DELETE that the constraint would refuse.

Retention is enforced by a scheduled job, not by intention. Drivers can request their own data
export and deletion, subject to legal retention on emergency and financial records.

---

## 11. Transport, Headers, and Dependencies

- TLS 1.2+ everywhere; HSTS in any deployed environment. Certificate pinning in the driver app is a
  future consideration.
- CORS: explicit origin allowlist. **Never `*` together with credentials.**
- Security headers: CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY`.
- SQLAlchemy parameterised queries only; **no f-string SQL**, especially in PostGIS expressions
  where coordinates arrive from clients.
- Pydantic validates and constrains every inbound payload (lat/lon ranges, weight bounds, enum
  membership).
- `pip-audit` and `npm audit` in CI.

---

## 12. Known Gaps

Stated because pretending otherwise is worse than admitting it:

- No penetration test will be performed before 19 September.
- No device attestation; a determined driver can spoof GPS.
- No end-to-end encryption of documents — the server can read them (it must, to render them).
- Single-tenant; no data isolation between transport companies.
- No formal DPIA. If deployed commercially, one is required before onboarding real drivers.
- MFA is not implemented for manager accounts. It should be before any production use.
- **No rate limiting is implemented** (section 6 is a target design, not current behaviour).
  Login resists enumeration but not sustained guessing; GPS ingest, reads and future uploads
  are unbounded per principal. Required before any public deployment.
- **Automated test accounts accumulate in the shared development database.** They cannot be
  deleted — `audit_logs.actor_user_id` is RESTRICT, so an auditable actor is pinned by its own
  trail — so cleanup deactivates them and deletes their refresh tokens instead. Retained rows
  are inert by construction, not by assumption: verified 0 active and 0 usable tokens across
  4,284 test-owned accounts. Ownership is the two repository-generated `.invalid` domains and
  nothing else.

> **Resolved P1 (2026-08-30): a shared test credential was live in the development project.**
> `tests/factories.py` declared a fixed `TEST_PASSWORD` literal — which section 1's own rule and
> AGENTS.md both forbid — and cleanup retained the accounts it created while leaving them
> `is_active = true`. The result was **3,670 authenticating accounts, 13 with ADMIN and its full
> permission set**, opened by a password published in a public repository, against a backend with
> no rate limiting.
>
> It was contained only by the backend binding to localhost, which P7 ends: reaching a physical
> Android handset means exposing the API on a LAN.
>
> Fixed by generating the suite password per process (`secrets.token_urlsafe(32)`) and by
> deactivating retained accounts at cleanup. Proven dead: a previously valid ADMIN credential now
> returns `401 UNAUTHENTICATED` with no access or refresh token issued, without the account being
> reactivated to test it. The existing accounts were deactivated in bulk; the operation touched
> only repository-owned `.invalid` identities, deleted nothing, and left every audit row intact.
>
> The literal remains in git history at and before `6b9e4ac`. It is dead — nothing creates
> accounts with it and every account it opened is deactivated — but it cannot be removed without
> rewriting history, which this project does not do.
