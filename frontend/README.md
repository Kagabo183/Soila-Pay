# Soila Pay - Aggregator Console

A Next.js 16 (App Router) admin console for the Soila Pay mobile money aggregator
middleware: a Provider Dashboard, an interactive API Playground, a Developer
Portal, and API Integration Settings. Built mock-first so every screen is
fully usable today, and structured to switch to the real FastAPI middleware
(`../app`) with a one-line env var change.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v4** (CSS-native `@theme` tokens, no `tailwind.config.js`)
- **Zustand** (+ `persist`) for auth session, theme, toast, and API settings state
- **Axios** for all HTTP calls (`src/lib/axios.ts`)
- **Recharts** for dashboard charts
- **lucide-react** for icons

> This project targets **Next.js 16**, which has meaningful breaking changes
> from earlier versions (Turbopack-by-default, `middleware` renamed to
> `proxy`, fully-async `params`/`searchParams`, etc). See
> `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`
> before assuming Next 13/14/15 conventions apply.

## Getting started

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000` - you'll be redirected to `/login`.

### Superadmin login

| Field | Value |
|---|---|
| Username | `superadmin` |
| Password | `BDEa7aCQIfDklhan` |

This is a **mock-mode-only** credential, hardcoded in `src/services/auth.service.ts`
(`MOCK_SUPERADMIN_USERNAME` / `MOCK_SUPERADMIN_PASSWORD`) - there is no real user
database behind it yet. It's checked with a plain string comparison purely to
give this dev build a single, real login instead of accepting any password.
Change it there, or wire up real credential verification, before this ever
points at production. It's unrelated to Fineract's own admin account
(`mifos` / `password`, tenant `default`) - see the root `README.md` for that.

## Project structure

```
src/
├── app/
│   ├── layout.tsx                 # Root layout: fonts, theme script, toast/confirm providers
│   ├── page.tsx                   # Redirects to /dashboard
│   ├── login/page.tsx             # Auth flow (mock JWT login)
│   └── (dashboard)/               # Route group behind AuthGuard + AppShell
│       ├── layout.tsx
│       ├── dashboard/page.tsx     # Provider Dashboard
│       ├── playground/page.tsx    # API Playground (Swagger-style tester)
│       ├── developers/page.tsx    # Developer Portal
│       └── settings/api/page.tsx  # API Integration Settings
├── components/
│   ├── ui/                        # Reusable primitives (Button, Card, Modal, DataTable, Charts, JsonViewer, ...)
│   ├── layout/                    # Sidebar, TopNav, AppShell, AuthGuard
│   └── signature-verifier.tsx     # Browser-based HMAC signature verifier
├── services/                      # Axios API layer - one file per domain, mock-first
├── store/                         # Zustand stores: auth, theme, toast, API settings
├── lib/                           # axios instance, mock helpers, HMAC, curl builder, utils
├── types/api.ts                   # Shared TypeScript interfaces (Fineract- and middleware-shaped)
└── data/mock/                     # Deterministic mock data generators + Playground endpoint catalog
```

## Switching a service from mock to production

Every file in `src/services/` follows the same pattern:

```ts
async list(params) {
  if (MOCK_MODE) {
    await simulateLatency();
    return /* generated mock data */;
  }
  const { data } = await apiClient.get("/api/v1/...", { params });
  return data;
},
```

`MOCK_MODE` (in `src/lib/mock.ts`) reads `NEXT_PUBLIC_USE_MOCKS`. Set it to
`false` in `.env.local` (and point `NEXT_PUBLIC_API_BASE_URL` - or the
**Base URL** field on `/settings/api` - at a real deployment) and every
service starts hitting `apiClient` instead. No component code changes.

`collection.service.ts` and `auth.service.ts` are wired against real endpoints
that already exist in `../app` (`POST /api/v1/collection/collect`,
`GET /healthz`). The rest (`clients`, `loan`, `savings`, `accounting`,
`disbursement`, `webhook`) are shaped to match Fineract's own REST resources
and this project's Collection API idempotency contract, ready for the
corresponding endpoints to be added to the middleware.

## API Integration Settings

`/settings/api` lets an operator configure, per-browser (persisted to
`localStorage`, never sent anywhere until explicitly used):

- Base URL, Bearer token, timeout, retry count
- Webhook secret (also pre-fills the Developer Portal's Signature Verifier)
- Sandbox vs. Production environment
- A live connection/health check against `<base-url>/healthz`

## API Playground

`/playground` lists four sample endpoints (Login, Collection, Transaction
Status, Webhook Registration) grouped like a Swagger UI. Requests are routed
through the *same* `src/services/*.ts` layer the rest of the app uses (via
`src/lib/playground-executor.ts`), so what you see here is exactly what the
real UI would receive - not a separate mocked path. Each request/response
pair shows headers, body, status code, response time, and a dark-mode JSON
viewer, plus one-click **Copy Request** and **Copy cURL**.

## Developer Portal

`/developers` documents Authentication, the Collection API, the (placeholder)
Disbursement API, Webhook Registration, webhook payload examples, and
HMAC-SHA256 signature verification - including the four signature headers
(`Content-Type`, `X-Moola-Event`, `X-Moola-Timestamp`, `X-Moola-Signature`), a
syntax-highlighted Node.js `crypto.createHmac` example, and an interactive
**Signature Verifier** that computes/checks HMAC-SHA256 entirely client-side
via the Web Crypto API (`src/lib/hmac.ts`) - nothing pasted into that form
ever leaves the browser.

## Theming

Light/dark mode is driven by a `data-theme` attribute on `<html>`
(`src/store/theme-store.ts`), with a blocking inline script
(`src/components/theme-script.tsx`) that sets it before first paint to avoid a
flash of the wrong theme. All color tokens live in `src/app/globals.css` as
CSS custom properties consumed by Tailwind v4's `@theme inline` block - to
retheme the app, edit the token values there rather than hunting through
component classes.

## Known gaps / next steps

- **Auth token refresh** is stubbed in `src/lib/axios.ts`'s response
  interceptor (a comment marks exactly where to wire a 401 → refresh → retry
  flow) - not exercised because mock mode never returns a 401.
- **Disbursement, Clients, Loan, Savings, and Accounting services** are fully
  mocked and typed but have no dedicated page yet - only the Collection API
  (Provider Dashboard's "Recent Collections" table, and the Playground) is
  wired into a screen, matching what was explicitly scoped for this pass.
- **No E2E/unit tests yet.** Given the scope of this build, prioritize adding
  Playwright coverage for the login → dashboard → playground flow next.

## Build & lint

```bash
npm run build
npm run lint
```
