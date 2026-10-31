# Vercel deployment and launch checklist

## What this deployment supports

SignalMend is a Next.js App Router application. Deploy it as a single Vercel
project with the Node.js runtime. The webhook handler, Slack callbacks, Prisma,
and Redis all require Node-compatible server functions; do not move these API
routes to the Edge runtime.

The current webhook processor handles the request inline. A successful webhook
is processed before the route responds; this is not a durable queue and does
not meet the product blueprint's sub-50 ms acknowledgement or high-volume
burst guarantees. Load-test the intended traffic and add a managed queue plus
worker before promising those service levels.

## 1. Provision services

- Create PostgreSQL and Redis instances reachable from Vercel. Use TLS Redis
  (`rediss://`) when supported.
- Create a Vercel project from this repository. Use Node.js **22.x**, the
  detected Next.js framework, `npm ci` for installation, and `npm run build`
  for the build command.
- Use separate database, Redis, Slack and billing credentials for preview and
  production environments.

## 2. Configure Vercel environment variables

Set these for the environments where the related features are enabled:

| Variable | Required for |
|---|---|
| `DATABASE_URL` | All database-backed features |
| `REDIS_URL` | Webhook limits/idempotency, Slack OAuth state and billing event idempotency |
| `ENCRYPTION_SECRET` | Encrypting webhook secrets and Slack tokens; at least 32 bytes |
| `NEXTAUTH_SECRET` | Account sessions; use a unique random secret |
| `DASHBOARD_JWT_SECRET` | Legacy dashboard bearer-token validation and signed Slack OAuth state; use a separate random secret |
| `NEXTAUTH_URL` | Canonical deployed application URL |
| `NEXT_PUBLIC_SITE_URL` | Public canonical/SEO URL, usually the production domain |
| `SLACK_SIGNING_SECRET` | Slack interaction signature verification |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI` | Slack OAuth; configure all three together |
| `LEMON_SQUEEZY_WEBHOOK_SECRET` | Billing webhook verification |
| `LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_STORE_ID`, `LEMON_SQUEEZY_PRO_VARIANT_ID`, `LEMON_SQUEEZY_ENTERPRISE_VARIANT_ID` | Self-serve paid checkout |

Generate independent secrets; do not reuse the encryption, session, JWT,
provider or webhook secrets. Never put secret values in `NEXT_PUBLIC_*`
variables. `.env.example` contains placeholders only.

## 3. Apply database migrations

Before directing traffic to a new deployment, apply checked-in Prisma
migrations from a trusted release environment configured for the target
database:

```sh
npm ci
npx prisma migrate deploy
npm run build
```

Do not run development migrations as part of the production Vercel build.
Confirm the migration completed and take a database backup before applying
schema changes to an existing production database.

## 4. Configure Slack

In the Slack app settings:

1. Under **OAuth & Permissions → Redirect URLs**, add the exact URL shown in
   onboarding. For the current Vercel deployment, this is
   `https://signalmend-mu.vercel.app/api/auth/slack/callback`. Slack requires an
   exact match, including scheme, hostname, path, and trailing slash. If using a
   custom domain or Vercel preview, configure that environment's canonical URL
   and register its corresponding callback separately.
2. Enable bot scopes `chat:write`, `team:read`, `channels:read`, and
   `groups:read`.
3. Set the Interactivity request URL to
   `https://<production-domain>/api/v1/integrations/slack/actions`.
4. Configure the app's signing secret in `SLACK_SIGNING_SECRET`.
5. Connect Slack in onboarding, invite the bot to the alert channel, and select
   that channel under **Dashboard → Integrations**.
6. Send a test webhook and confirm the incident message and buttons work in the
   target workspace.

## 5. Configure paid plans

Create monthly Pro Team and Enterprise products/variants in Lemon Squeezy.
Use variant names containing `Pro Team` and `Enterprise`, respectively, and
copy the store ID, variant IDs and API key into Vercel environment variables.
Configure a signed webhook at
`https://<production-domain>/api/v1/billing/webhook` for
`subscription_created`, `subscription_updated`, and
`subscription_cancelled`. Add the webhook signing secret to
`LEMON_SQUEEZY_WEBHOOK_SECRET`.

Run a test purchase and verify that the signed event updates the intended
workspace and tenant plan. Checkout is disabled until those provider settings
are present. The payment provider charges transaction fees; there is no
guaranteed revenue, and a $300/month target depends on customers and retention.
At listed prices, 11 Pro subscriptions or 4 Enterprise subscriptions produce
at least $300 in gross monthly sales before fees, refunds and taxes.

## 6. Verify before launch

- `npm test`
- `npm run typecheck`
- `npm run build`
- Smoke-test account registration/sign-in, onboarding, workspace authorization,
  endpoint creation and signature rejection, incident creation, Slack channel
  configuration/actions, paid checkout and the billing webhook in a staging
  environment.
- Confirm each Vercel preview deployment is excluded from search indexing and
  verify the production canonical URL points to the chosen public domain.
- Confirm `https://<production-domain>/robots.txt` and
  `https://<production-domain>/sitemap.xml` after deployment.
- Configure database backup/restore, error monitoring, alerting, privacy
  notices, retention/deletion procedures and an incident response owner before
  accepting production customer data.
