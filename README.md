# Soila Pay - Collection Middleware

A FastAPI microservice for pulling money into Fineract via mobile money: debit
a customer's mobile money account through a MoMo collection provider (DDIN),
deposit the result into a Fineract savings wallet's ledger, and automatically
refund the Fineract-side debit if the collection call fails. This is a
mobile money **collection** aggregator - it does not model utility vending
(electricity/water tokens) at all.

## Endpoint

`POST /api/v1/collection/collect`

Headers:
- `Idempotency-Key: <client-generated unique string per collection attempt>`
- `Integrator-Key: <api_key issued via POST /api/v1/admin/integrators>` - identifies
  which aggregator client is calling, and drives the fee snapshot recorded on
  success (see "Integrators & margin" below). Unknown key -> `401`; disabled
  integrator (`is_active=false`) -> `403`.

```json
{
  "fineract_savings_account_id": "12345",
  "provider": "MTN",
  "customer_account_number": "0788123456",
  "customer_name": "Jean Uwimana",
  "amount_rwf": 5000
}
```

Response:

```json
{
  "status": "SUCCESS | PENDING | FAILED_REFUNDED | FAILED_REFUND_ERROR",
  "idempotency_key": "...",
  "fineract_savings_account_id": "12345",
  "debit_transaction_id": "9001",
  "refund_transaction_id": null,
  "provider_transaction_reference": "CYC-559013",
  "amount_rwf": 5000.00,
  "message": "...",
  "refunded": false
}
```

HTTP status codes:
- `200` - `SUCCESS` or `FAILED_REFUNDED` (business-level failure, handled gracefully - funds were refunded)
- `202` - `PENDING` - DDIN's collection API is asynchronous: it acknowledged the
  request but hasn't confirmed the outcome yet. The transaction stays debited
  (money already left the customer's account) and resolves later via DDIN's
  `collection.success`/`collection.failed` webhook - see "Webhooks" below.
  `provider_transaction_reference` is `null` until then.
- `500` - `FAILED_REFUND_ERROR` - the refund itself failed after retries. This is a true alert-worthy state; see "Known limitations" below.
- `409` - the same `Idempotency-Key` is already in progress (including while `PENDING`), or previously ended in `FAILED_REFUND_ERROR` and needs manual reconciliation before it can be retried.
- `502` - the initial Fineract debit failed (no funds were moved, nothing to roll back).

To deliberately exercise the rollback path, use customer account number
`00000000000` - the bundled dummy collection provider always rejects it.

## DDIN connection diagnostics

`POST /api/v1/admin/ddin/diagnostics` `{"run_test_collection": false}` - a
live, real connectivity check against DDIN's actual sandbox, independent of
Fineract and our own transaction_logs. Runs the exact sequence in DDIN's own
"Getting Started" guide:

1. **config** - are `DDIN_USERNAME`/`DDIN_PASSWORD` set at all (no network call).
2. **login** - real `POST` to `DDIN_LOGIN_PATH`.
3. **refresh_token** - real `POST` to `DDIN_REFRESH_PATH` using the token from step 2.
4. **balance** - real `GET` to `DDIN_BALANCE_PATH` (float account balances) using the refreshed token.
5. **test_collection** - *opt-in only* (`run_test_collection: true`) - initiates
   a real MoMo collection request against DDIN's sandbox to prove the
   collection endpoint itself is reachable and authenticated. A `pending`
   acknowledgment counts as success here - this step only proves
   connectivity, not a completed collection (see the async-collection note in
   `DDINCollectionProvider`'s docstring).

Each step reports `PASS`/`FAIL`/`SKIPPED` with latency and a message; a step
failing skips everything after it rather than continuing with a stale/absent
token. See `app/services/ddin_diagnostics.py`. The console surfaces this at
**Configuration → DDIN Diagnostics** (`/settings/ddin-diagnostics`) with a
live "Try this endpoint live" button - no mock mode, it always calls the real
middleware, since faking this result would defeat the point.

Additional operational hardening on top of the base diagnostics flow:

- **Admin authentication** - every route under `/api/v1/admin/*` (including
  the diagnostics endpoints) requires `Authorization: Bearer <token>`, enforced
  by the `require_admin` dependency in `app/api/v1/deps.py`. Get a token via
  `POST /api/v1/admin/auth/login` (`{"username": ..., "password": ...}`,
  checked against `ADMIN_USERNAME`/`ADMIN_PASSWORD`) - see
  `app/services/admin_auth.py`. Auth fails closed: if either env var is unset,
  login always rejects rather than falling back to a default credential.
- **Retry/backoff on transient DDIN failures** - `DDINCollectionProvider`
  retries connection errors, timeouts, and 5xx responses (never 4xx) up to
  `DDIN_RETRY_MAX_ATTEMPTS` times with exponential backoff
  (`DDIN_RETRY_BACKOFF_BASE_SECONDS`), transparently to every existing call
  site - see `_request_with_retry` in `app/services/collection_provider.py`.
- **Rate limiting** - the diagnostics endpoints are capped at
  `DDIN_DIAGNOSTICS_RATE_LIMIT_PER_MINUTE` requests/minute per process (an
  in-memory sliding window in `app/api/v1/deps.py`), returning `429` past the
  limit.
- `GET /api/v1/admin/ddin/diagnostics/history` - the last 20 diagnostics runs,
  persisted server-side (`ddin_diagnostics_runs` table) so the console's run
  history survives a page reload instead of living only in browser state.
- `GET /api/v1/admin/ddin/ping` - a lightweight, login-only reachability check
  (no refresh/balance/collection calls) suitable for an external uptime
  monitor to poll frequently without tripping the rate limit.

## Webhooks

`POST /api/v1/webhooks/ddin` receives DDIN's `collection.success` /
`collection.failed` events and resolves any transaction left `PENDING` by the
collect endpoint above (see `CollectionOrchestrator.resolve_provider_success` /
`resolve_provider_failure` in `app/services/collection_orchestrator.py`).

- **Correlation**: DDIN's `data.referenceId` is matched against our own
  `idempotency_key` - we send that value as `referenceId` on every collection
  request (`DDINCollectionProvider.collect`), so it round-trips back to the
  right `transaction_logs` row.
- **Signature verification**: every request must carry a valid
  `X-Moola-Signature` header - HMAC-SHA256 of the raw request body, keyed by
  `DDIN_WEBHOOK_SECRET` (set in `.env`, distinct from `DDIN_USERNAME`/
  `DDIN_PASSWORD`). An invalid or missing signature is rejected with `401`
  before the body is even parsed. See `verify_ddin_signature` in
  `app/api/v1/webhooks.py`.
- **Idempotent**: webhooks aren't guaranteed exactly-once. A redelivered
  event for a transaction that's already `SUCCESS`/`FAILED_REFUNDED`/
  `FAILED_REFUND_ERROR` is a no-op (logged, not reprocessed) - see
  `resolve_provider_success`/`resolve_provider_failure`'s status guard.
- **On success**: the transaction is marked `SUCCESS` with the fee/margin
  snapshot computed exactly as the synchronous success path does.
- **On failure**: the same Fineract refund rollback the synchronous failure
  path uses runs here too.
- **`disbursement.*` events**: acknowledged with `200` but otherwise ignored -
  no disbursement flow exists yet in this codebase.
- **Known gap**: this only covers *receiving* webhooks. The endpoint to
  *register* our callback URL with DDIN (to get a real webhook secret and
  tell them where to POST) hasn't been documented to us yet - only signature
  verification was. Get that endpoint's docs from DDIN before this can
  receive real traffic.

## Running locally with Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

This is a 4-node stack:
- `soila-pay-db` - **MySQL 8**, holding only our own `soila_pay.transaction_logs`
  audit table. This is unrelated to Fineract's own storage - see below.
- `fineract-db` - a dedicated **PostgreSQL 16** instance used only by
  `fineract-core`. This is *not* a design preference: the published
  `apache/fineract` Docker image bundles only the PostgreSQL JDBC driver - MySQL
  and MariaDB drivers are both excluded because their licenses (GPL and LGPL
  respectively) are incompatible with ASF binary redistribution, and Fineract's
  own README confirms MySQL/MariaDB support is now deprecated project-wide
  (FSIP-9: Standardize on PostgreSQL). This was verified empirically while
  building this stack: pointing `fineract-core` at MySQL 8, then at MariaDB
  11.4, both failed at startup with `Failed to load driver class` for the
  respective driver - see the `fineract-db` comment in `docker-compose.yml` for
  the full trail. If you need Fineract on real MySQL/MariaDB regardless, the
  project's documented path is to build a custom image on top of
  `apache/fineract` with the vendor driver jar added - not attempted here.
- `fineract-core` - a native Apache Fineract core banking container
  (`apache/fineract:latest`), listening on `https://localhost:8443`. **First boot
  runs Fineract's own database migrations and can take 1-3 minutes** - watch
  `docker compose logs -f fineract-core` and wait for it to report the server has
  started before sending collection requests.
- `soila-pay-middleware` - this FastAPI service, on `http://localhost:8000`.

Check health: `curl http://localhost:8000/healthz`

If you'd rather run Fineract on your host machine instead of in this compose
stack, see the alternate `FINERACT_BASE_URL` value commented in `.env.example`
(`host.docker.internal` - "localhost" inside the middleware container refers to
the container itself, not your host).

## Testing with Bruno

Import the `bruno/` folder as a collection in Bruno, select the `local`
environment, and run:
1. **Admin - Create Integrator** - creates an integrator and stores its
   `api_key` in the `integratorKey` environment variable for the requests below.
2. **Collection - Success** - normal collection, expect `status: SUCCESS`.
3. **Collection - Forced Failure (Rollback)** - uses the magic fail account
   number, expect `status: FAILED_REFUNDED` and `refunded: true`. Confirm in
   Fineract that the account balance returned to its pre-collection value.

Re-running **Collection - Success** with the same `Idempotency-Key` should
return the cached result instantly without a second debit in Fineract.

## Integrators & margin

Soila Pay is an aggregator sitting between its own clients ("integrators" -
businesses that call `/api/v1/collection/collect` to collect money from their
customers) and DDIN, the upstream MoMo collection provider. DDIN charges
Soila Pay a cost percentage; Soila Pay charges each integrator its own fee
percentage; the difference is Soila Pay's margin. Integrator fees are plain
mutable data, editable via the admin API and the console's Integrators page
with no deploy required. DDIN's cost percentage is DDIN's own call, not
ours - it's exposed read-only in the console and only editable via the admin
API, for the rare case DDIN changes their published rate.

Admin endpoints (no auth yet - see "Known limitations" below):

- `GET /api/v1/admin/integrators` - list integrators.
- `POST /api/v1/admin/integrators` `{"name": "...", "fee_percentage": 2.20}` -
  create one; response includes the `api_key` the integrator must send as
  `Integrator-Key` - **shown once, not recoverable, store it immediately**.
- `PATCH /api/v1/admin/integrators/{id}` `{"fee_percentage": 2.5}` - change an
  integrator's rate (or `is_active`, or `name`) at any time; takes effect on
  the next collection, past transactions keep their original snapshot.
- `GET /api/v1/admin/integrators/summary` - per-integrator totals: amount
  collected, fee charged, DDIN's cost, and the resulting margin - answers
  "where is my margin actually coming from".
- `GET` / `PATCH /api/v1/admin/settings/ddin-cost-percentage` - DDIN's current
  cost to Soila Pay (defaults to `2.00`); update it if DDIN's own pricing
  changes.

On every **successful** collection, `transaction_logs` snapshots
`integrator_fee_percentage`, `ddin_cost_percentage`, `fee_amount_rwf`,
`ddin_cost_amount_rwf`, and `margin_amount_rwf` (fee minus cost) as they stood
*at that moment* - editing a rate later never rewrites historical rows. None
of this is returned in the collect response itself (an integrator is not
told Soila Pay's cost or margin on their own transaction); it's only visible
via the admin summary endpoint above.

## Integrator self-service portal

Mirrors how DDIN itself onboarded Soila Pay: an integrator signs up with just
a phone number and can start testing immediately, then submits business
details for review to unlock a production key. Endpoints live under
`/api/v1/integrator-portal/` and use **session tokens** (`Authorization:
Bearer <token>`, signed via `INTEGRATOR_SESSION_SECRET`) - a different
mechanism from the `Integrator-Key` header used to call `/collection/collect`
itself, and from the console's own separate superadmin login.

- `POST /signup` `{"name", "phone_number", "password"}` - creates the account
  and an active `sandbox_api_key` immediately. No documents required.
- `POST /login` `{"phone_number", "password"}` - returns a session token.
- `POST /production/submit` `{"business_location", "tax_clearance_reference",
  "rdb_certificate_reference", "ip_whitelist"?}` (Bearer session token) - sets
  `production_status = PENDING_REVIEW`. `ip_whitelist` is the only optional
  field; everything else is required.
- An operator then calls `POST /api/v1/admin/integrators/{id}/approve-production`
  or `.../reject-production` (see "Integrators & margin" above) - approval
  generates `production_api_key`.

**Sandbox is a real safety boundary, not just a label.** A request
authenticated with a `sandbox_api_key` always runs against the dummy
collection provider (`app.state.sandbox_orchestrator` in `main.py`),
*regardless* of `COLLECTION_PROVIDER_NAME` - only a `production_api_key`
(present only once `production_status = APPROVED`) reaches DDIN for real.
This means an integrator can safely exercise the entire debit → collect →
refund flow - including the rollback path (customer account number
`00000000000`) - before ever touching real money. See the `key_mode` routing
in `IntegratorRepo.get_by_api_key` and `app/api/v1/collection.py`.

### Document uploads

The tax clearance certificate and RDB certificate are **real file uploads**
(PDF/JPEG/PNG, max 5MB), not text references:

- `POST /production/documents` (multipart/form-data: `document_type` +
  `file`, Bearer session token) - re-uploading the same `document_type`
  replaces the previous file.
- `GET /production/documents` - the integrator's own upload status.
- `GET /production/documents/{document_type}` - the integrator viewing their
  own upload.
- `POST /production/submit` now rejects with `400` unless both
  `TAX_CLEARANCE` and `RDB_CERTIFICATE` are already uploaded.
- Operators review via `GET /api/v1/admin/integrators/{id}/documents`
  (metadata) and `GET /api/v1/admin/integrators/{id}/documents/{document_type}`
  (the actual file) - also surfaced as "Tax clearance" / "RDB certificate"
  links on `/settings/integrators` for any integrator that has submitted.

Files are stored as a `LONGBLOB` in a dedicated `integrator_documents` table
(`db_init/005_integrator_documents.sql`) - deliberately **not** columns on
`integrators` itself, since that row is read on every single collection
request (`IntegratorRepo.get_by_api_key`) and must never drag multi-megabyte
document bytes along for the ride.

**Known simplifications** (fine for this MVP, revisit before real integrators
onboard):
- Documents are stored as a DB blob, not in object storage (S3 etc.) - no
  virus/malware scanning, no CDN, and every replica of this DB now carries
  the file bytes. Fine at KYC-document volume, not a long-term choice.
- No SMS OTP / phone verification on signup - anyone can claim any phone
  number. Add verification before this handles real businesses.
- Password hashing (PBKDF2-HMAC-SHA256) and session tokens (HMAC-signed JSON,
  `app/services/integrator_auth.py`) are stdlib-only, not a maintained
  auth library - adequate for this MVP, not a long-term choice.

## Fineract API assumptions - validate before production use

This was built against the documented Fineract savings-account-transaction API
without a live instance to introspect. Before going to production, confirm against
your actual Fineract deployment:

1. `POST /savingsaccounts/{accountId}/transactions?command=withdrawal|deposit` is
   the correct endpoint/command, and the response's new transaction id is under
   `resourceId` (see `app/services/fineract_client.py`).
2. `FINERACT_PAYMENT_TYPE_ID` (default `1`) matches a real payment type configured
   on your tenant.
3. `FINERACT_DATE_FORMAT` / `FINERACT_LOCALE` produce a `transactionDate` string
   your Fineract instance accepts.
4. Basic Auth + `Fineract-Platform-TenantId` header is sufficient for your
   deployment (no OAuth2/Keycloak layer).
5. Business-rule rejections (e.g. insufficient balance) come back as non-2xx with
   an `errors` array, not a 200 with an embedded error flag.
6. `fineract-core` uses the `apache/fineract:latest` image. As of writing, Docker
   Hub does not publish a pinned semver tag like `1.9.0` for this image - only
   `latest`, `develop`, and per-commit-hash tags - so this tracks the project's
   mainline branch rather than a fixed release. Pin to a specific commit-hash tag
   if you need reproducible builds, and confirm the running version's API surface
   matches what this client expects.

## Known gap: admin endpoints have no authentication

`/api/v1/admin/*` (integrator CRUD, DDIN cost-percentage setting) currently
has zero auth, matching `/api/v1/collection/collect`'s existing dev-stage
posture - anyone who can reach the middleware can mint integrator API keys or
change fee/cost percentages. This is fine for local development only. Before
any shared/production deployment, put these routes behind real
operator authentication (the frontend's existing superadmin login is
currently mock-only and not wired to a backend auth check - see
`frontend/README.md`).

## Operational risk: distributed split-state reconciliation gap

This system moves money across two independently-failing systems (Fineract and
the collection provider) with **no distributed transaction coordinator** - only
best-effort compensation (the rollback/refund step) and an idempotency ledger in
MySQL. This is inherent to the architecture, not a bug, but it means two states
are reachable where money and records can disagree, and both require an explicit
operational runbook rather than being "handled" by the code:

- **Crashed mid-flight requests are not self-healing.** If the middleware process
  dies between the Fineract debit and the collection call/refund (container OOM-kill,
  deploy, host crash), the corresponding `transaction_logs` row is stuck in
  `DEBITED` forever. A client retry with the same `Idempotency-Key` gets
  `409 Conflict`, not resolution - the debited funds sit in limbo until a human or
  a job intervenes. **This build ships with no reconciliation job.** Before
  production use, add a periodic job that scans:
  `SELECT * FROM transaction_logs WHERE status IN ('PENDING','DEBITED') AND updated_at < NOW() - INTERVAL 15 MINUTE;`
  and either confirms the Fineract transaction's true state or force-issues a
  refund.
- **`FAILED_REFUND_ERROR` means Fineract and the client's expectation have
  diverged and stayed diverged.** The debit succeeded, the collection call failed,
  and the compensating refund also failed after `REFUND_MAX_ATTEMPTS` retries.
  The account has less money than it should, with no code path that fixes this
  automatically. Query `SELECT * FROM transaction_logs WHERE status =
  'FAILED_REFUND_ERROR';` to find these rows; each requires a human to verify the
  Fineract account state and issue the refund manually. Route this query into
  your alerting/paging pipeline - a `FAILED_REFUND_ERROR` row is a real customer
  owed real money, not a log line to review later.

## Local development (without Docker)

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # then edit MYSQL_HOST=localhost, MYSQL_PORT=3307 if MySQL is only reachable via the compose port mapping
uvicorn app.main:app --reload
```

## Tests

```bash
pytest
```
