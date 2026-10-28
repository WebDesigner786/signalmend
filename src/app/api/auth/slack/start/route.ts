import { z } from "zod";
import { NextResponse } from "next/server";

import { env } from "../../../../../config/env";
import { getAuthenticatedUserId } from "../../../../../lib/server/auth-session";
import {
  createSlackOAuthState,
} from "../../../../../lib/server/slackOAuthState";
import { withTenantContext } from "../../../../../lib/server/tenantRls";

export const runtime = "nodejs";

const RequestSchema = z.object({
  tenantId: z.string().uuid(),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!env.slackClientId || !env.slackClientSecret || !env.slackRedirectUri) {
    return NextResponse.json(
      { error: "Slack OAuth is not configured" },
      { status: 503, headers: { "cache-control": "no-store" } },
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
    authorizeUrl.searchParams.set("client_id", env.slackClientId);
    authorizeUrl.searchParams.set("scope", "chat:write,team:read");
    authorizeUrl.searchParams.set("redirect_uri", env.slackRedirectUri);
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
