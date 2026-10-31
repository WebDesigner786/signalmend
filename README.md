# SignalMend

SignalMend is a developer-first incident response and webhook platform. It is
intended to accept events from application and infrastructure tools, verify and
route relevant signals, notify a team in Slack, and keep an incident history.

This repository contains an early, actively developed implementation of that
product. The marketing site, onboarding, dashboard surfaces, webhook processing,
and several security and data-model foundations exist; some integrations and
production operations described in the product blueprint are not yet connected
end to end. This README describes the code currently in the repository, not a
promise that every planned feature is live.

## What is implemented

### Public site

- Responsive SignalMend landing page at `/`, with product overview, a static
  incident-dashboard illustration, workflow, integrations overview, pricing,
  and calls to action.
- The dashboard illustration and the named integration marks on the page are
  presentation content; they are not populated from a live customer workspace.
- Calls to action lead to `/onboarding`.

### Authentication and onboarding

- NextAuth email/password sign-in using bcrypt password hashes and JWT-backed
  sessions.
- Email registration endpoint validates passwords (at least 12 characters)
  and prevents duplicate email accounts.
- Onboarding collects a business name and industry, associates setup with an
  accessible workspace/tenant, and exposes Slack connection status.
- Slack OAuth start/callback handlers validate one-time state, check tenant
  administrator membership and requested scopes, encrypt and save the Slack
  credential, and perform a Slack workspace verification handshake.
- The dashboard has a separate bearer-token gate. Its APIs validate signed
  HS256 dashboard JWTs and scope access to workspaces the user belongs to.
  The application does **not** currently issue these dashboard JWTs; a
  compatible identity/token-issuing integration is needed to make this a
  seamless in-app login.

### Dashboard and API

- Dashboard overview displays incident history, status/severity distributions,
  charts, MTTA/MTTR, estimated uptime, and monthly webhook usage.
- The uptime number is explicitly an estimate derived from recorded incident
  durations, not an external uptime monitor or an availability guarantee.
- Endpoint UI and APIs can create endpoints, show a newly generated signing
  secret once, rotate the secret, enable/disable an endpoint, and configure
  whether a signature is required.
- Incident-rule UI and APIs can list and create rules with conditions and
  severity, title, and notification destination settings.
- Dashboard APIs validate request data and workspace access, and return
  paginated/filterable incident data and workspace metrics.

### Webhook and incident processing

- `POST /api/v1/webhooks/{endpointKey}` accepts JSON webhook events up to 1 MB.
- Optional HMAC-SHA256 verification uses the exact raw request bytes and the
  endpoint's configured header (default `x-signature`). Hex signatures and
  `sha256=`-prefixed signatures are supported.
- Endpoint secrets are encrypted before storage. Invalid signatures can create
  an audit event and are rejected.
- Redis is used by the active webhook handler for rate limiting, idempotency,
  and incident-processing locks. Monthly usage is tracked against the current
  tier quotas (1,000 / 50,000 / 500,000 requests), with a limited critical-event
  grace allowance.
- Enabled rules are evaluated in priority order. Matching events create or
  deduplicate incidents, preserve the raw JSON payload, and create audit
  records.
- Slack message construction and dispatch are implemented for enabled Slack
  integration records. Messages include incident context and action buttons.

**Processing limitation:** the active Next.js webhook route calls the
processor inline before returning. It is not currently an enqueue-and-acknowledge
worker architecture, and Redis is not being used here as a durable processing
queue. Retry/backoff and the blueprint's ingestion/dispatch latency targets
are therefore not established.

## Routes

### Web pages

| Path | Purpose |
| --- | --- |
| `/` | Public landing page |
| `/onboarding` | Account, business/workspace, and Slack setup |
| `/dashboard` | Incident and metrics overview |
| `/dashboard/endpoints` | Webhook endpoint management |
| `/dashboard/rules` | Incident rule management |

### Active Next.js API routes

Dashboard API routes expect `Authorization: Bearer <dashboard-JWT>`. Where
applicable, `workspace_id` can be supplied as a query parameter; access is
validated against the authenticated user and any workspace scope in the token.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Register with email and password |
| `GET`, `POST` | `/api/auth/[...nextauth]` | NextAuth credentials session |
| `POST` | `/api/auth/slack/start` | Start Slack OAuth for an authorized tenant |
| `GET` | `/api/auth/slack/callback` | Complete Slack OAuth callback |
| `GET`, `POST` | `/api/onboarding` | List accessible workspaces and save business setup |
| `GET` | `/api/onboarding/slack-status` | Read Slack verification status |
| `GET`, `POST` | `/api/v1/webhook-endpoints` | List or create webhook endpoints |
| `PATCH` | `/api/v1/webhook-endpoints/{endpointId}` | Update endpoint active/signature settings |
| `POST` | `/api/v1/webhook-endpoints/{endpointId}/rotate-secret` | Rotate an endpoint signing secret |
| `POST` | `/api/v1/webhooks/{endpointKey}` | Receive and process a webhook |
| `GET` | `/api/v1/dashboard/incidents` | Query incidents with filters and pagination |
| `GET` | `/api/v1/dashboard/metrics` | Read workspace metrics and usage |
| `GET`, `POST` | `/api/v1/incident-rules` | List or create incident rules |

There are also Fastify plugins under `src/routes/` for dashboard APIs, webhook
handling, Slack interactive actions, and Lemon Squeezy billing webhooks. No
Fastify server or plugin registration is present in the application entry
points. Treat those plugins as standalone/unmounted code: the active Next.js
routes above are the routes currently exposed by this app. In particular, the
Fastify Slack-action and billing webhook handlers are not live merely because
their source files exist.

## Data model and security foundations

The Prisma/PostgreSQL schema includes users, tenants, workspaces and memberships,
webhook endpoints, incident rules, incidents, integrations, audit logs, monthly
usage, encrypted credentials, and tenant encryption keys. SQL migrations are
under `prisma/migrations/`.

Implemented security-related foundations include:

- Zod validation at API boundaries.
- Bcrypt password hashing.
- HMAC-SHA256 webhook signature verification with constant-time comparison.
- AES-256-GCM encryption for stored secrets and OAuth tokens.
- Tenant-scoped credential access and PostgreSQL row-level-security policies
  for tenant and credential tables.
- Workspace authorization for dashboard APIs, Redis-backed rate limiting and
  idempotency, and audit records for key incident and rejection events.

These are implementation details, not a claim of completed SOC 2, GDPR, uptime,
or other compliance certification. Production TLS, key management and rotation,
backups, retention enforcement, data deletion, and deployment-specific security
controls still need operational configuration and validation.

## Current gaps and planned work

The following blueprint goals are not yet implemented end to end:

- **Seamless dashboard authentication:** issue dashboard JWTs from the app or
  connect a supported identity provider; reconcile the dashboard bearer-token
  gate with the NextAuth sign-in session.
- **Slack delivery setup:** provide dashboard UI/API to select a channel and
  persist an enabled `Integration` record from the verified OAuth credential.
  The OAuth credential/verification flow and incident dispatch code exist, but
  they do not by themselves provide a complete channel-configuration flow.
- **Slack interactive actions:** wire the existing Fastify action handler into
  a running server or implement it as a Next.js route, configure Slack's
  request URL, and verify acknowledge/resolve/silence updates end to end.
- **Durable asynchronous processing:** enqueue webhook jobs, run workers, add
  retry/backoff and dead-letter handling, and measure latency/reliability
  against the product targets.
- **Rule completeness:** implement rule editing/deletion and connect all rule
  action fields to execution. The current processor primarily uses incident
  title/service/environment/severity and Slack integrations; UI choices such
  as Discord delivery are not dispatched by the active processor.
- **Other integrations:** Google Sheets, Discord and email delivery are
  represented in parts of the schema/blueprint but do not have complete
  end-to-end integrations. There is no raw-payload search/replay workflow.
- **Billing:** connect the pricing page to checkout and register the existing
  Lemon Squeezy Fastify webhook handler. The pricing amounts are currently
  static marketing content and must not be interpreted as active subscriptions.
- **Incident operations:** add dashboard incident detail and state-transition
  controls, an audit-log viewer, notification configuration, and any required
  retention or export tools.
- **Production readiness:** add deployment/CI documentation and configuration,
  integration/load testing, observability and alerting, backup/restore
  procedures, and verify TLS, quotas, and tenant isolation in the deployed
  environment.

The repository currently has no checked-in `public/` asset directory,
`Dockerfile`, or Compose file. The landing artwork is built from markup, CSS,
and `lucide-react` icons. `info.txt` contains a Docker build sketch, but it is
not a Dockerfile and uses Node 20, while `package.json` declares Node 22; the
sketch also assumes Next standalone output that is not configured in
`next.config.ts`.

## Technology and dependencies

### Runtime dependencies

| Package | Role in this project |
| --- | --- |
| `next`, `react`, `react-dom` | App Router, server routes, and UI |
| `next-auth` | Email/password authentication and session handling |
| `@prisma/client` | PostgreSQL data access |
| `prisma` | Schema generation and database migration tooling (also a dev dependency) |
| `ioredis` | Redis connections, rate limits, idempotency, and coordination |
| `bcryptjs` | Password hashing and verification |
| `zod` | Runtime validation for environment, API, and provider payloads |
| `fastify`, `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit` | Fastify plugin code under `src/routes/`; no Fastify server is currently registered |
| `lucide-react` | UI icons |
| `recharts` | Dashboard chart visualizations |
| `dotenv` | Environment loading |

### Development dependencies

| Package | Role |
| --- | --- |
| `prisma` | Prisma client generation and database migration CLI |
| `typescript` | Type checking and compilation |
| `tailwindcss`, `postcss`, `autoprefixer` | Utility CSS and CSS processing |
| `vitest` | Unit tests |
| `@types/node`, `@types/react`, `@types/react-dom` | TypeScript definitions |

`package-lock.json` is the lockfile; use `npm ci` for a reproducible install.

## Requirements

- Node.js **22.x** (see `package.json`).
- npm.
- PostgreSQL with the Prisma migrations applied.
- Redis for webhook rate limiting, idempotency, and Slack OAuth state.
- Slack app credentials for Slack OAuth and delivery.
- A dashboard JWT issuer compatible with this app if using the protected
  dashboard APIs.

## Local development

1. Install packages:

   ```sh
   npm ci
   ```

2. Copy `.env.example` to `.env`, then replace placeholders with local
   PostgreSQL, Redis, and secret values. Never commit `.env` or real credentials.
3. Generate the Prisma client and apply migrations to the configured database:

   ```sh
   npm run prisma:generate
   npm run prisma:deploy
   ```

   For development-only schema iteration, `npm run prisma:migrate` runs
   `prisma migrate dev`.
4. Start Next.js:

   ```sh
   npm run dev
   ```

   The site is served at `http://localhost:3000` by default.

Useful commands:

| Command | Description |
| --- | --- |
| `npm run typecheck` | TypeScript check without emitting files |
| `npm test` | Run Vitest tests |
| `npm run build` | Generate Prisma client and create a Next.js production build |
| `npm start` | Serve a previously built Next.js app |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run setup:github` | Run the repository's GitHub setup script; inspect the script before using it |

## Environment variables

The Zod-backed configuration is defined in `src/config/env.ts`. Values are
validated when first read; not every feature is usable with only placeholders.

| Variable | Required / default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL connection string |
| `REDIS_URL` | Required | `redis://` or `rediss://` connection |
| `ENCRYPTION_SECRET` | Required; minimum 32 UTF-8 bytes | Key material for AES-256-GCM secret encryption |
| `NEXTAUTH_SECRET` or `AUTH_SECRET` | Required; minimum 32 characters | NextAuth JWT/session signing |
| `DASHBOARD_JWT_SECRET` | Required; minimum 32 characters | Verify dashboard HS256 bearer tokens and sign Slack OAuth state |
| `SLACK_SIGNING_SECRET` | Required by configuration | Slack request signature validation in the standalone action plugin |
| `LEMON_SQUEEZY_WEBHOOK_SECRET` or `LEMONSQUEEZY_WEBHOOK_SECRET` | Required by configuration | Billing webhook signature validation in the standalone billing plugin |
| `SLACK_CLIENT_ID` | Optional; configure with the next two | Slack OAuth client ID |
| `SLACK_CLIENT_SECRET` | Optional; configure with the other OAuth values | Slack OAuth client secret |
| `SLACK_REDIRECT_URI` | Optional; configure with both OAuth values | Slack OAuth callback URL |
| `NEXTAUTH_URL` | Optional | Recommended canonical application URL in production |
| `NEXT_PUBLIC_API_BASE_URL` | Optional | Base URL for the dashboard API client when API is hosted separately |
| `NODE_ENV` | Defaults to `development` in the config | Runtime environment |
| `HOST` | Config default `0.0.0.0` | Declared host setting |
| `PORT` | Config default `3000` | Declared port setting |
| `AXIOS_TIMEOUT` | Config default `10000` ms | Outbound provider request timeout |
| `LOG_LEVEL` | Config default `info` | Declared log-level setting |

The `.env.example` file is the starter template. Slack OAuth requires all three
Slack OAuth values together. The example contains placeholders, not usable
credentials. The app's HTTP request signatures and credential encryption are
separate secrets and should be generated independently.

## Project layout

```text
src/
  app/                 Next.js pages, layouts, and active route handlers
    api/               Authentication, onboarding, dashboard, and webhook APIs
    dashboard/         Overview, endpoint, and incident-rule pages
    onboarding/        Account and integration setup
  components/          Landing page and reusable UI components
  config/              Validated environment configuration
  integrations/        Slack message construction and API calls
  lib/                 Auth, dashboard clients, tenant access, webhook processing
  middleware/          Quota enforcement
  routes/              Standalone Fastify route plugins (not registered by app)
  utils/               Prisma, Redis, crypto, metrics, and credential vault
prisma/
  migrations/          PostgreSQL schema migrations
  schema.prisma        Data model
scripts/               Repository setup scripts
```

Tests currently live beside source modules as `*.test.ts`, including tests for
environment validation, Slack OAuth state, and encrypted-token handling.
