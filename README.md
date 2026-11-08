# Soila Pay - Collections & Disbursements

Soila Pay is a payment aggregator. Businesses ("integrators") use it to:

- **Collect** money from their customers - **cards first** (Visa, Mastercard,
  other cards via a hosted Pesapal page, so Soila Pay never sees card numbers)
  plus **MTN Mobile Money**.
- **Disburse** (pay out) money to any MTN MoMo number from their balance.

Both run through the **LMBTech** gateway (`app/services/lmbtech_client.py`).
There is no mock or simulator in the money path - in LMBTech *Test Mode*
LMBTech itself simulates outcomes.

The console has two faces, built from the same components:

| Admin console (`/login` as admin) | Integrator portal (`/login` as integrator) |
|---|---|
| Dashboard, Collections, Disbursements, Transactions | Same four, scoped to the integrator |
| Integrators & Pricing | Webhooks, Go Live, Account |
| API Docs | API Docs (with their own key filled in) |

## API (for integrators)

Every call sends `Integrator-Key: <sandbox or production key>`. Full,
copy-paste examples are on the **API Docs** page of the console.

| Call | What it does |
|---|---|
| `POST /api/v1/payments` | Collect. `channel` = `VISA` / `MASTERCARD` / `OTHER_CARD` (send the customer to `redirect_url`) or `MTN_MOMO` (+ `customer_phone`; customer approves on their phone). |
| `GET /api/v1/payments/{reference_id}` | Latest status (re-checks LMBTech while pending). Works for payouts too. |
| `GET /api/v1/payments` | Ledger, filter by `direction`, `status`, `method`. |
| `POST /api/v1/disbursements` | Pay out to an MTN number. `402` if it exceeds the available balance. |
| `GET /api/v1/disbursements/balance` | Available balance = collected − collection fees − payouts − payout fees. |

Webhooks (`payment.success|failed`, `disbursement.success|failed`) are signed
with `X-Soila-Signature: sha256=<HMAC-SHA256(raw body, subscription secret)>`.

## Money: fees, LMBTech's cost, margin

LMBTech takes a percentage of every transaction (**5%** on collections,
confirmed; payouts assumed 5% until LMBTech confirms). Each integrator pays
Soila Pay a fee on top (default **6%** for both, overridable per integrator).
Margin = fee − LMBTech cost. All of this is set on **Integrators & Pricing**,
and the API refuses any fee below LMBTech's cost.

Every row freezes its fee %, fee amount, LMBTech cost and margin at creation,
so changing a rate never rewrites history. Integrators only ever see their
fee; LMBTech's cost and the margin are admin-only.

## Trust model

LMBTech's callbacks are **not signed**, so a callback is only used to find
which transaction to re-check - the status always comes from an
authenticated call to LMBTech's status API. A background loop polls pending
transactions every 20s (callbacks can't reach `localhost`, and can be lost in
production too). A finished transaction can never move back to pending.

Payouts check the integrator's balance under a per-integrator lock so two
simultaneous payouts can't spend the same money (single API worker - see
`deploy/soila-pay-api.service`; revisit before running several workers).

## Running locally

No Docker needed. You need **Python 3.12** (pinned pydantic has no 3.14 build
yet), **Node.js 20+** and **MySQL 8** (local install or a hosted MySQL).

```bash
# 1. Backend
py -3.12 -m venv .venv          # Linux/macOS: python3.12 -m venv .venv
.venv\Scripts\activate          # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # LMBTECH_*, MYSQL_*, ADMIN_*, secrets
python scripts/init_db.py       # creates DB + user, applies db_init/*.sql (safe to re-run)
uvicorn app.main:app --reload   # http://localhost:8000

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev                     # http://localhost:3000
```

Check health: `curl http://localhost:8000/healthz`

The frontend always talks to the real API. Mock data only appears if you set
`NEXT_PUBLIC_USE_MOCKS=true` on purpose (design demos without a backend).

## Deploying to a server

Any small Linux VPS works (Ubuntu shown). One-time setup:

```bash
apt install -y python3.12-venv nodejs npm mysql-server nginx git
git clone https://github.com/Kagabo183/Soila-Pay.git /var/www/soila-pay
cd /var/www/soila-pay
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # real values, APP_ENV=prod, LMBTECH_TEST_MODE=false,
                                # PUBLIC_API_BASE_URL / FRONTEND_BASE_URL = your https domain
.venv/bin/python scripts/init_db.py
echo "NEXT_PUBLIC_API_BASE_URL=https://your.domain" > frontend/.env.production
(cd frontend && npm ci && npm run build)
cp deploy/*.service /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now soila-pay-api soila-pay-web
cp nginx/soila-pay.conf /etc/nginx/sites-available/soila-pay   # edit server_name
ln -s /etc/nginx/sites-available/soila-pay /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d your.domain  # HTTPS
```

Later updates: `python deploy.py` from your machine, with `DEPLOY_HOST` and
`DEPLOY_KEY_FILE` (or `DEPLOY_PASSWORD`) set in your environment - it pulls,
installs dependencies, runs migrations, rebuilds the frontend and restarts the
services.

## Testing

- **In the console:** Collections → **Test Lab** runs every method plus the
  safety checks in one click and shows each request and response.
- **Bruno:** import `bruno/`, pick the `local` environment, run *Admin - Login*,
  *Admin - Create Integrator* (stores `integratorKey`), *Payment - Visa*, then
  *Payment - Status*.
- **Unit tests:** `pytest` (LMBTech is faked with respx - no network).

## Integrator self-service portal

An integrator signs up with an email and starts testing immediately with a
**sandbox key**, then uploads KYC documents and submits for review to get a
**production key**. Portal endpoints live under `/api/v1/integrator-portal/`
and use session tokens (`Authorization: Bearer <token>`, signed with
`INTEGRATOR_SESSION_SECRET`) - separate from the `Integrator-Key` used for API
calls and from the admin login.

- `POST /signup` / `POST /login` - session token.
- `POST /production/documents` (multipart: `document_type` + `file`) - tax
  clearance and RDB certificate, PDF/JPEG/PNG up to 5MB; re-upload replaces.
- `POST /production/submit` - requires both documents; sets
  `PENDING_REVIEW`. An admin approves or rejects on Integrators & Pricing.

Known simplifications: documents are stored as DB blobs (no virus scanning or
object storage), there is no phone/email verification at signup, and password
hashing / session tokens use the standard library rather than an auth library.

## Fineract (kept for later)

`app/services/fineract_client.py`, its settings and the
`/api/v1/admin/fineract/*` endpoints are kept for a planned future flow.
Nothing in collections or disbursements uses Fineract today.
