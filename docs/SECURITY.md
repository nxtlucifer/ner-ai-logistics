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

- Login is rate limited and returns an identical response and timing for unknown-user and
  wrong-password, so the endpoint cannot enumerate valid phone numbers.
- Drivers stay signed in for long periods by design — re-authenticating on a hill road at night is
  a safety problem, not just a UX one. Refresh tokens are long-lived and device-bound; the mitigation
  for a lost phone is server-side revocation, not a short session.
- Tokens are stored in `expo-secure-store` on mobile (Keychain / Keystore), never `AsyncStorage`.
- Web uses in-memory access tokens with the refresh token in an `HttpOnly`, `Secure`, `SameSite=Strict`
  cookie. No token in `localStorage`. **Implemented** - the cookie is scoped to
  `/api/auth`, and the web client never sees its own refresh token.

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
> **Known gap:** two browser *tabs* are separate JS contexts and can still race.
> A `BroadcastChannel` lock is the fix; not implemented.

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
  server-side: `POST /api/gps/batch` for a non-active trip is rejected, so an app bug or a
  tampered client cannot cause off-duty tracking.
- The driver app shows a **persistent, non-dismissible indicator** while tracking, and the trip
  screen states plainly that location is shared with the fleet manager.
- Consent is captured at onboarding, recorded with timestamp and version, and is re-shown when the
  policy changes.
- **No third-party analytics or advertising SDKs in the driver app.** Location data goes to our
  backend and nowhere else.
- Location history is visible to managers and admins only, never to other drivers.
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

Per-principal, sliding window:

| Endpoint | Limit | Rationale |
| --- | --- | --- |
| `POST /api/auth/login` | 5/min per IP **and** per identifier | Both, so neither a single IP nor a distributed attack on one account gets through |
| `POST /api/gps/batch` | 60/min per driver, 500 fixes per batch | Generous — an offline truck reconnecting flushes a large backlog legitimately |
| File uploads | 20/hour per user | |
| Read endpoints | 300/min per user | |
| `POST /api/emergencies/{id}/respond` | **Effectively unlimited** | Never rate-limit a driver saying they need help |
| `POST /api/incidents` (driver) | 10/hour | Limits report spam; confirmation is a manager action anyway |

Limits are enforced on `429` with `Retry-After`. The driver app respects it with exponential
backoff rather than hammering.

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
