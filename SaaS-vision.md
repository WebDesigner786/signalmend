# PRODUCT REQUIREMENT DOCUMENT (PRD) & TECHNICAL ARCHITECTURE BLUEPRINT
# Project: Automated Incident Response & Webhook Engine (SignalMend)
# Author: Principal Product Manager & Enterprise Software Architect
# Version: 1.0.0 (Production Blueprint)

================================================================================
1. EXECUTIVE SUMMARY & CONTEXT
================================================================================

1.1 PROBLEM STATEMENT
Modern engineering teams and growing startups depend on dozens of cloud services (Sentry, Datadog, Vercel, GitHub, Stripe, AWS CloudWatch). When system failures, spike errors, or payment webhook drops occur, critical alert notifications are often lost in noisy email threads or buried in unmonitored dashboards. 

Enterprise incident management tools like PagerDuty, Opsgenie, or Splunk On-Call cost $21 to $49+ per user/month, enforcing steep minimum seat limits and complex setup flows. Early-stage startups, bootstrapped SaaS founders, and small dev teams require a lightweight, zero-maintenance war-room automation platform that ingests webhooks from any provider, filters noise, dispatches instant actionable Slack alerts, and maintains automated audit logs in Google Sheets without enterprise overhead.

1.2 VALUE PROPOSITION & CORE MISSION
The Automated Incident Response & Webhook Engine ("ResiliOps") bridges the gap between raw infrastructure webhooks and real-time team collaboration. 

Core Mission: Provide an ultra-fast, developer-first incident triage and alerting platform that can be set up in under 3 minutes.
Key Value Drivers:
- Zero-Code Webhook Ingestion: Instant, cryptographically secure dynamic endpoints accepting arbitrary JSON payloads.
- Intelligent War-Room Automation: Automated creation of dedicated Slack channels/threads with interactive response buttons (Acknowledge, Resolve, Silence).
- Automated Compliance & Audit Trails: Real-time sync of all incident telemetry directly into Google Sheets and Supabase PostgreSQL.
- Developer-Friendly Pricing: High-volume processing starting at a fraction of legacy enterprise cost.

1.3 TARGET AUDIENCE & USER PERSONAS

Primary Persona: Alex, Lead Full-Stack Engineer / CTO at a Series A Startup (5–20 Engineers)
- Background: Manages core infrastructure, on-call rotations, and product delivery.
- Pain Points: Frustrated by $500/month PagerDuty bills; missing critical Stripe and Sentry webhooks during outages; lacks time to build custom alerting scripts.
- Goal: Wants a robust system to ingest webhooks, trigger Slack alerts instantly, and maintain clean audit records automatically.

Secondary Persona: DevSecOps Engineer / Site Reliability Engineer (SRE)
- Background: Focuses on system uptime, zero-trust security compliance, and incident post-mortems.
- Pain Points: Needs signature verification on incoming webhooks to prevent spoofing; requires immutable log data for SOC2 compliance.
- Goal: Secure, deterministic webhook processing with strict HMAC verification and zero data loss.

1.4 MONETIZATION STRATEGY & TIERED PRICING ARCHITECTURE
Model: Multi-tenant SaaS with tiered monthly/annual recurring billing and usage-based overage meters, powered by Lemon Squeezy / Stripe Merchant of Record.

+-----------------------+-------------------+-------------------+-------------------+
| Tier Features         | Free Developer    | Pro Team ($29/mo) | Enterprise ($79/mo|
+-----------------------+-------------------+-------------------+-------------------+
| Monthly Webhooks      | 1,000 / month     | 50,000 / month    | 500,000 / month   |
| Webhook Endpoints     | 2 Endpoints       | 15 Endpoints      | Unlimited         |
| Active Workspaces     | 1 Workspace       | 3 Workspaces      | Unlimited         |
| Integrations          | Slack (1 Channel) | Slack, Sheets,    | Custom Webhooks,  |
|                       |                   | Discord, Email    | PagerDuty bridge  |
| Data Retention        | 7 Days            | 90 Days           | 365 Days          |
| Webhook Retries       | 1 Retry           | 5 Retries         | Exponential Backoff|
| Rate Limits           | 30 req/min        | 300 req/min       | 3,000 req/min     |
| SLA / Support         | Community         | 24h Email Support | 99.99% SLA + Chat |
+-----------------------+-------------------+-------------------+-------------------+


================================================================================
2. COMPREHENSIVE REQUIREMENTS ANALYSIS
================================================================================

2.1 FUNCTIONAL REQUIREMENTS

2.1.1 Ingestion & Webhook Processing (MUST-HAVE)
- Dynamic Endpoint Generation: System must generate unique UUID-v4 and custom slug endpoint URLs (`/api/v1/webhooks/[endpointKey]`).
- Payload Parsing & Normalization: Support arbitrary JSON payloads from standard sources (Sentry, GitHub, Vercel, Datadog, Custom HTTP POSTs).
- Cryptographic Signature Verification: Validate HMAC SHA-256 signatures using secret keys configured per endpoint.
- Asynchronous Processing Queue: Ingest requests within <50ms, return a 202 Accepted header, and offload processing to background workers.

2.1.2 Alert Triage & War-Room Engine (MUST-HAVE)
- Rule Engine: User-defined routing rules (e.g., IF `severity == 'CRITICAL'` OR `http_status >= 500` THEN Dispatch Alert).
- Interactive Slack Notifications: Construct Slack Block Kit messages containing:
  * Incident Header & Severity Badge (CRITICAL = Red, WARNING = Yellow, INFO = Blue)
  * System Details, Timestamp, and Stack Trace snippet
  * Interactive Action Buttons: [Acknowledge], [Resolve], [Silence 1h]
- Real-Time State Sync: Button clicks in Slack update incident state instantly across Slack, Dashboard, and Google Sheets.

2.1.3 Integration Ecosystem (SHOULD-HAVE)
- Google Sheets Auto-Sync: Append new incidents as structured rows in user-specified Google Spreadsheets via Google Sheets API v4.
- Multi-Channel Fan-Out: Simultaneous alert routing to Slack, Discord Webhooks, and Email (Resend API).

2.1.4 Analytics & Audit Dashboard (COULD-HAVE)
- Incident Analytics: Real-time UI displaying Mean Time to Acknowledge (MTTA), Mean Time to Resolve (MTTR), and incident frequency breakdown.
- Raw Payload Inspector: Full search and payload replay tool allowing developers to re-trigger failed webhooks.

2.2 NON-FUNCTIONAL REQUIREMENTS

2.2.1 Performance & Latency
- Webhook Ingestion Latency: <= 50ms (99th percentile) response time for incoming HTTP POST requests.
- Alert Dispatch Latency: End-to-end alert delivery to Slack within <= 2.5 seconds from initial webhook ingestion.

2.2.2 Security & Compliance
- Transport Security: Mandatory TLS 1.3 encryption in transit for all endpoints.
- Data Encryption at Rest: AES-256 encryption for stored API keys, OAuth tokens, and secret verification keys.
- Authorization: Row-Level Security (RLS) in PostgreSQL ensuring complete multi-tenant isolation.
- Compliance: Designed for SOC 2 Type II readiness and GDPR compliance (Data minimization, user data purge API).

2.2.3 Reliability & Scalability
- System Uptime Target: 99.95% availability.
- High Concurrency: Support bursts of up to 5,000 requests/second via Redis-backed queue buffering.

2.3 DETAILED USER STORIES & ACCEPTANCE CRITERIA

User Story 1: Webhook Ingestion & Signature Verification
As a DevOps Engineer,
I want to configure an HMAC SHA-256 secret key for my incoming Sentry webhooks,
So that unauthenticated or malicious requests are rejected before impacting downstream alerts.

Acceptance Criteria:
1. User can toggle "Signature Verification Required" on any endpoint detail page.
2. User provides a Secret Key string.
3. System validates the `x-signature` (or configured custom header) against `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')`.
4. If signature validation fails, system returns HTTP 401 Unauthorized instantly and logs a "Security Rejection" audit event.
5. If signature passes, system returns HTTP 202 Accepted and queues the job.

User Story 2: Instant Slack War-Room Alerting
As an On-Call Software Engineer,
I want to receive an interactive Slack message in our #war-room channel when a critical incident occurs,
So that I can acknowledge and resolve the incident directly inside Slack without logging into multiple dashboards.

Acceptance Criteria:
1. Alert arrives in Slack within 3 seconds of webhook dispatch.
2. Message contains formatted Block Kit UI with incident title, service name, environment, and error payload.
3. Clicking [Acknowledge] updates the message button state to "Acknowledged by @username at HH:MM:SS" and updates the database record.
4. Clicking [Resolve] marks the incident resolved across the dashboard and appends resolution timestamp.

User Story 3: Automated Google Sheets Logging
As a CTO / SRE Lead,
I want all resolved and critical incidents automatically logged to a team Google Sheet,
So that we maintain an immutable, free audit trail for weekly engineering post-mortems.

Acceptance Criteria:
1. User authenticates Google Account via OAuth2 and selects target Spreadsheet ID.
2. System automatically appends a new row upon incident creation containing: Timestamp, Endpoint Name, Severity, Title, Status, Acknowledged By.
3. If Google Sheets API returns rate limit or auth error, system retries automatically using exponential backoff (up to 5 attempts).


================================================================================
3. TECH STACK & SYSTEM ARCHITECTURE
================================================================================

3.1 TECH STACK SELECTION & JUSTIFICATIONS

- Frontend Framework: Next.js 15 (App Router, Server Actions, React 19)
  * Justification: High-performance hybrid SSR/SSG rendering, native API routing capabilities, and Server Actions eliminate redundant REST boilerplate.
- Programming Language: TypeScript (Strict Mode across full stack)
  * Justification: Ensures end-to-end type safety between database models, API payloads, and frontend UI components.
- Styling & Components: Tailwind CSS + Shadcn UI + Lucide Icons + Framer Motion
  * Justification: Modern, responsive visual hierarchy, glassmorphism aesthetics, accessibility compliant out-of-the-box.
- Database: Supabase (Managed PostgreSQL 16)
  * Justification: Enterprise-grade relational database with native Row Level Security (RLS), realtime subscriptions, and built-in JWT authentication.
- Caching & Message Queue: Upstash Redis + Upstash QStash
  * Justification: Serverless-native Redis and HTTP-based message queues designed for edge compute and Next.js serverless architecture with zero connection pool exhaustion.
- Payment & Merchant of Record: Lemon Squeezy / Stripe API
  * Justification: Seamless handling of global VAT/tax compliance, recurring subscription webhooks, and customer billing portals.
- Deployment & Edge Infrastructure: Vercel Edge Network
  * Justification: Global CDN deployment with sub-10ms cold start times for edge API route handling.

3.2 HIGH-LEVEL ARCHITECTURE DESIGN

3.3 API STRATEGY & SPECIFICATIONS

3.3.1 Authentication Strategy
- Public Ingestion APIs: Authenticated via unique URL tokens (`endpointKey`) + signature verification header (`X-Hub-Signature-256` / `X-Signature`).
- Management APIs: Authenticated via Supabase Auth JWT tokens (`Authorization: Bearer <token>`).

3.3.2 REST API Endpoints Specification

1. Ingest Webhook Payload
   - Route: `POST /api/v1/webhooks/{endpointKey}`
   - Headers: `Content-Type: application/json`, `X-Signature: <hmac-sha256-hash>`
   - Response:
     * 202 Accepted: `{ "success": true, "incident_id": "inc_987654321", "status": "queued" }`
     * 401 Unauthorized: `{ "error": "Invalid HMAC signature verification" }`
     * 429 Too Many Requests: `{ "error": "Rate limit exceeded. Upgrade tier." }`

2. Interactive Slack Action Endpoint
   - Route: `POST /api/v1/integrations/slack/actions`
   - Content-Type: `application/x-www-form-urlencoded` (Slack Payload)
   - Function: Processes `acknowledge`, `resolve`, or `silence` button clicks from Slack UI, updates Supabase DB, and returns updated Block Kit response.

3. Fetch Incidents (Dashboard)
   - Route: `GET /api/v1/incidents?workspace_id={id}&status=active`
   - Headers: `Authorization: Bearer <JWT>`
   - Response: `200 OK` with JSON array of incident objects.

3.4 DATA MODELS & ERD DATABASE SCHEMA (POSTGRESQL / SUPABASE)

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. WORKSPACES TABLE
CREATE TABLE public.workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subscription_tier VARCHAR(50) DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro', 'enterprise')),
    lemon_squeezy_customer_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 2. WEBHOOK ENDPOINTS TABLE
CREATE TABLE public.webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    endpoint_key VARCHAR(64) UNIQUE NOT NULL,
    secret_key VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    require_signature BOOLEAN DEFAULT FALSE NOT NULL,
    total_received BIGINT DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 3. INTEGRATIONS TABLE
CREATE TABLE public.integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('slack', 'google_sheets', 'discord', 'email')),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 4. INCIDENTS TABLE
CREATE TABLE public.incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    endpoint_id UUID REFERENCES public.webhook_endpoints(id) ON DELETE SET NULL,
    title VARCHAR(500) NOT NULL,
    severity VARCHAR(20) DEFAULT 'critical' CHECK (severity IN ('critical', 'warning', 'info')),
    status VARCHAR(20) DEFAULT 'triggered' CHECK (status IN ('triggered', 'acknowledged', 'resolved', 'silenced')),
    raw_payload JSONB NOT NULL,
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

-- Workspaces Policy: Users can only see workspaces they own
CREATE POLICY "Users access own workspaces" ON public.workspaces
    FOR ALL USING (auth.uid() = owner_id);

-- Incidents Policy: Access via workspace ownership
CREATE POLICY "Users access workspace incidents" ON public.incidents
    FOR ALL USING (
        workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
    );



================================================================================
5. STEP-BY-STEP IMPLEMENTATION PLAN
PHASE 1: FOUNDATION & CORE ENGINE (WEEKS 1–2)

Task 1.1: Initialize Next.js 15 App Router project with TypeScript, Tailwind CSS, and Shadcn UI.

Task 1.2: Set up Supabase project, execute initial PostgreSQL migration script (schema.sql), and configure RLS policies.

Task 1.3: Build public Webhook Ingestion API route (/api/v1/webhooks/[endpointKey]).

Task 1.4: Implement HMAC SHA-256 signature verification module (lib/crypto/hmac-verify.ts).

Task 1.5: Integrate Upstash Redis rate-limiting middleware to guard endpoints against traffic surges.

PHASE 2: TRIAGE ENGINE & SLACK INTEGRATION (WEEKS 3–4)

Task 2.1: Configure Upstash QStash async queue handler for background processing of ingested payloads.

Task 2.2: Implement Slack Block Kit builder (lib/integrations/slack-block-kit.ts) with interactive buttons.

Task 2.3: Build Slack Actions API route (/api/v1/integrations/slack/actions) to handle real-time button clicks ([Acknowledge], [Resolve]).

Task 2.4: Build frontend Dashboard layout with live incident streaming tables and status badges.

PHASE 3: GOOGLE SHEETS & EXTENDED INTEGRATIONS (WEEKS 5–6)

Task 3.1: Implement Google OAuth2 authentication flow for Google Workspace users.

Task 3.2: Build Google Sheets API sync client (lib/integrations/google-sheets.ts) to log incidents dynamically.

Task 3.3: Implement auto-retry logic with exponential backoff for third-party integration dispatches.

Task 3.4: Build raw payload inspector modal allowing developers to replay failed webhooks.

PHASE 4: MONETIZATION & MULTI-TENANCY (WEEKS 7–8)

Task 4.1: Integrate Lemon Squeezy / Stripe billing SDK and create subscription checkout links.

Task 4.2: Implement Lemon Squeezy webhook handler (/api/webhooks/lemon-squeezy) to automate plan upgrades/downgrades.

Task 4.3: Implement strict usage quota enforcement (e.g., blocking ingestion if free user exceeds 1,000 monthly events).

Task 4.4: Conduct end-to-end security penetration testing, RLS audits, and API rate limit verification.

PHASE 5: LAUNCH, MONITORING, & SCALE (WEEKS 9+)

Task 5.1: Deploy production application stack to Vercel and attach custom SSL domain.

Task 5.2: Configure Sentry error monitoring and Axiom logging.

Task 5.3: Public Launch on Product Hunt, Hacker News, Reddit (r/SaaS, r/devops), and LinkedIn.

================================================================================
6. RISKS, MITIGATIONS, & EDGE CASES
6.1 TECHNICAL RISKS & MITIGATION STRATEGIES

Risk: High-Volume Webhook Spikes (DDoS or Error Loops) causing API server crashes.

Impact: System outage, database pool exhaustion, high server bill.

Mitigation: Edge-level rate limiting via Upstash Redis. Immediate HTTP 202 acknowledgment without database connection holding. Asynchronous queue buffering via QStash.

Risk: Third-Party API Rate Limits (Slack / Google Sheets throttling).

Impact: Alerts fail to deliver; audit logs become out of sync.

Mitigation: Implement QStash retry queue with dead-letter queue (DLQ) support. If Google Sheets API returns HTTP 429, retry after backoff delay without dropping the alert.

Risk: Malicious Signature Spoofing / Replay Attacks.

Impact: Fake incidents created in customer dashboards.

Mitigation: Enforce strict HMAC verification. Validate timestamp headers (X-Slack-Request-Timestamp or X-Signature-Time) to reject payloads older than 5 minutes.

6.2 BUSINESS & OPERATIONAL EDGE CASES

Edge Case: User exceeds monthly plan quota during an active incident outage.

Resolution: Implement a 20% grace overage allowance for critical incidents. Send an automated high-priority email to the workspace owner inviting a 1-click tier upgrade rather than dropping alerts immediately during a crisis.

Edge Case: Slack Bot token revoked by customer workplace admin.

Resolution: Catch Slack API authentication errors gracefully. Flag integration as is_enabled = FALSE in Supabase, update UI with an alert badge ("Slack Authentication Lost"), and fall back to Email/SMS notifications.