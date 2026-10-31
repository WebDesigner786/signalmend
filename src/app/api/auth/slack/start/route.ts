import { z } from "zod";
import { NextResponse } from "next/server";

import { env } from "../../../../../config/env";
import { getAuthenticatedUserId } from "../../../../../lib/server/auth-session";
import {
  getSlackOAuthConfiguration,
  REQUIRED_SLACK_SCOPES,
} from "../../../../../lib/server/slackOAuthConfig";
import {
  createSlackOAuthState,
} from "../../../../../lib/server/slackOAuthState";
import { withTenantContext } from "../../../../../lib/server/tenantRls";

export const runtime = "nodejs";

const RequestSchema = z.object({
  tenantId: z.string().uuid(),
});

export async function GET(): Promise<NextResponse> {
  const configuration = getSlackOAuthConfiguration();
  const appOrigin = configuration.redirectUri
    ? new URL(configuration.redirectUri).origin
    : null;

  return NextResponse.json(
    {
      configured: configuration.ok,
      redirectUri: configuration.redirectUri,
      interactivityUrl: appOrigin
        ? new URL("/api/v1/integrations/slack/actions", appOrigin).toString()
        : null,
      scopes: REQUIRED_SLACK_SCOPES,
      error: configuration.ok ? null : configuration.error,
    },
    {
      status: configuration.ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const configuration = getSlackOAuthConfiguration();
  if (!configuration.ok) {
    return NextResponse.json(
      { error: configuration.error, redirectUri: configuration.redirectUri },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const redirectUri = new URL(configuration.redirectUri);
  if (new URL(request.url).origin !== redirectUri.origin) {
    return NextResponse.json(
      {
        error: `Open SignalMend at ${redirectUri.origin} before connecting Slack.`,
        canonicalUrl: redirectUri.origin,
      },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Sign in to connect a Slack workspace." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const parsedBody = RequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "A valid tenantId is required" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const { tenantId } = parsedBody.data;
  try {
    const membership = await withTenantContext(tenantId, (transaction) =>
      transaction.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        select: { role: true },
      }),
    );
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      return NextResponse.json(
        { error: "Tenant administrator access is required" },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }

    const state = createSlackOAuthState(
      tenantId,
      userId,
      env.dashboardJwtSecret,
    );
    const { getRedisClient } = await import("../../../../../utils/redis");
    const stored = await getRedisClient().set(
      `oauth:slack:state:${state.nonce}`,
      `${tenantId}:${userId}`,
      "EX",
      600,
      "NX",
    );
    if (stored !== "OK") {
      throw new Error("Unable to allocate a unique OAuth state");
    }

    const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
    authorizeUrl.searchParams.set("client_id", configuration.clientId);
    authorizeUrl.searchParams.set(
      "scope",
      REQUIRED_SLACK_SCOPES.join(","),
    );
    authorizeUrl.searchParams.set("redirect_uri", configuration.redirectUri);
    authorizeUrl.searchParams.set("state", state.token);

    return NextResponse.json(
      { authorizationUrl: authorizeUrl.toString() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "slack_oauth_start_failed",
        tenantId,
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return NextResponse.json(
      { error: "Unable to start Slack authorization" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
