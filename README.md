# Soila Pay - Utility Purchase Middleware

A FastAPI microservice that bridges a client app to Apache Fineract for utility
(electricity/water) purchases: debit a Fineract savings wallet, call a utility
provider, and automatically refund the debit if the utility call fails.

## Endpoint

`POST /api/v1/utility/purchase`

Headers: `Idempotency-Key: <client-generated unique string per purchase attempt>`

```json
{
  "fineract_savings_account_id": "12345",
  "utility_provider": "REG",
  "meter_number": "04212345678",
  "amount_rwf": 5000
}
```

Response:

```json
{
  "status": "SUCCESS | FAILED_REFUNDED | FAILED_REFUND_ERROR",
  "idempotency_key": "...",
  "fineract_savings_account_id": "12345",
  "debit_transaction_id": "9001",
  "refund_transaction_id": null,
  "utility_token": "REG-AB12CD34EF56",
  "amount_rwf": 5000.00,
  "message": "...",
  "refunded": false
}
```

HTTP status codes:
- `200` - `SUCCESS` or `FAILED_REFUNDED` (business-level failure, handled gracefully - funds were refunded)
- `500` - `FAILED_REFUND_ERROR` - the refund itself failed after retries. This is a true alert-worthy state; see "Known limitations" below.
- `409` - the same `Idempotency-Key` is already in progress, or previously ended in `FAILED_REFUND_ERROR` and needs manual reconciliation before it can be retried.
- `502` - the initial Fineract debit failed (no funds were moved, nothing to roll back).

To deliberately exercise the rollback path, use meter number `00000000000` - the
bundled dummy utility provider always rejects it.

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
  started before sending purchase requests.
- `soila-pay-middleware` - this FastAPI service, on `http://localhost:8000`.

Check health: `curl http://localhost:8000/healthz`

If you'd rather run Fineract on your host machine instead of in this compose
stack, see the alternate `FINERACT_BASE_URL` value commented in `.env.example`
(`host.docker.internal` - "localhost" inside the middleware container refers to
the container itself, not your host).

## Testing with Bruno

Import the `bruno/` folder as a collection in Bruno, select the `local`
environment, and run:
1. **Purchase - Success** - normal purchase, expect `status: SUCCESS`.
2. **Purchase - Forced Utility Failure (Rollback)** - uses the magic fail meter
   number, expect `status: FAILED_REFUNDED` and `refunded: true`. Confirm in
   Fineract that the account balance returned to its pre-purchase value.

Re-running **Purchase - Success** with the same `Idempotency-Key` should return
the cached result instantly without a second debit in Fineract.

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

## Operational risk: distributed split-state reconciliation gap

This system moves money across two independently-failing systems (Fineract and
the utility provider) with **no distributed transaction coordinator** - only
best-effort compensation (the rollback/refund step) and an idempotency ledger in
MySQL. This is inherent to the architecture, not a bug, but it means two states
are reachable where money and records can disagree, and both require an explicit
operational runbook rather than being "handled" by the code:

- **Crashed mid-flight requests are not self-healing.** If the middleware process
  dies between the Fineract debit and the utility call/refund (container OOM-kill,
  deploy, host crash), the corresponding `transaction_logs` row is stuck in
  `DEBITED` forever. A client retry with the same `Idempotency-Key` gets
  `409 Conflict`, not resolution - the debited funds sit in limbo until a human or
  a job intervenes. **This build ships with no reconciliation job.** Before
  production use, add a periodic job that scans:
  `SELECT * FROM transaction_logs WHERE status IN ('PENDING','DEBITED') AND updated_at < NOW() - INTERVAL 15 MINUTE;`
  and either confirms the Fineract transaction's true state or force-issues a
  refund.
- **`FAILED_REFUND_ERROR` means Fineract and the client's expectation have
  diverged and stayed diverged.** The debit succeeded, the utility call failed,
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
