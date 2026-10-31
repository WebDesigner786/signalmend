import { z } from "zod";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { env } from "../../../../../config/env";
import { withTenantContext } from "../../../../../lib/server/tenantRls";
import { verifySlackOAuthState } from "../../../../../lib/server/slackOAuthState";
import {
  markSlackHandshakeFailed,
  verifySlackHandshake,
} from "../../../../../lib/server/slack-handshake";
import { decryptSecret } from "../../../../../utils/crypto";
import { VaultService } from "../../../../../utils/vaultService";

export const runtime = "nodejs";
export const maxDuration = 60;

const SlackOAuthResponseSchema = z.object({
  ok: z.literal(true),
  access_token: z.string().min(1).max(4_096),
  token_type: z.literal("bot"),
  scope: z.string().min(1),
  team: z.object({
    id: z.string().regex(/^[A-Z0-9]{2,32}$/),
    name: z.string().min(1).max(255),
  }),
});

const REQUIRED_SLACK_SCOPES = [
  "chat:write",
  "team:read",
  "channels:read",
  "groups:read",
] as const;
const consumeNonceScript = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function getSingleParameter(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length === 1 && values[0].length > 0 ? values[0] : null;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!env.slackClientId || !env.slackClientSecret || !env.slackRedirectUri) {
    return jsonError("Slack OAuth is not configured", 503);
  }

  const callbackUrl = new URL(request.url);
  if (callbackUrl.searchParams.has("error")) {
    const onboardingUrl = new URL("/onboarding?slack=declined", callbackUrl.origin);
    return NextResponse.redirect(onboardingUrl, {
      status: 303,
      headers: { "cache-control": "no-store" },
    });
  }

  const code = getSingleParameter(callbackUrl, "code");
  const stateToken = getSingleParameter(callbackUrl, "state");
  if (!code || code.length > 4_096 || !stateToken || stateToken.length > 2_048) {
    return jsonError("Slack callback parameters are invalid", 400);
  }

  let state: ReturnType<typeof verifySlackOAuthState>;
  try {
    state = verifySlackOAuthState(stateToken, env.dashboardJwtSecret);
  } catch {
    return jsonError("Slack authorization state is invalid or expired", 400);
  }

  try {
    const { getRedisClient } = await import("../../../../../utils/redis");
    const consumed = await getRedisClient().eval(
      consumeNonceScript,
      1,
      `oauth:slack:state:${state.nonce}`,
      `${state.tenantId}:${state.userId}`,
    );
    if (Number(consumed) !== 1) {
      return jsonError("Slack authorization state has already been used", 400);
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "slack_oauth_state_store_unavailable",
        tenantId: state.tenantId,
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return jsonError("Unable to verify Slack authorization state", 503);
  }

  try {
    const membership = await withTenantContext(state.tenantId, (transaction) =>
      transaction.tenantMember.findUnique({
        where: {
          tenantId_userId: {
            tenantId: state.tenantId,
            userId: state.userId,
          },
        },
        select: { role: true },
      }),
    );
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      return jsonError("Tenant administrator access is required", 403);
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "slack_oauth_membership_check_failed",
        tenantId: state.tenantId,
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return jsonError("Unable to verify tenant access", 503);
  }

  let slackResponse: Response;
  try {
    const form = new URLSearchParams({
      client_id: env.slackClientId,
      client_secret: env.slackClientSecret,
      code,
      redirect_uri: env.slackRedirectUri,
    });
    slackResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(Math.min(env.axiosTimeout, 15_000)),
      cache: "no-store",
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "slack_oauth_exchange_failed",
        tenantId: state.tenantId,
        message: error instanceof Error ? error.message : "network error",
      }),
    );
    return jsonError("Slack token exchange is temporarily unavailable", 502);
  }

  let slackBody: unknown;
  try {
    slackBody = await slackResponse.json();
  } catch {
    return jsonError("Slack returned an invalid token response", 502);
  }
  const parsedSlackResponse = SlackOAuthResponseSchema.safeParse(slackBody);
  if (!slackResponse.ok || !parsedSlackResponse.success) {
    return jsonError("Slack token exchange was rejected", 502);
  }

  const slack = parsedSlackResponse.data;
  const grantedScopes = [...new Set(slack.scope.split(",").map((scope) => scope.trim()))]
    .filter(Boolean)
    .sort();
  if (REQUIRED_SLACK_SCOPES.some((scope) => !grantedScopes.includes(scope))) {
    return jsonError("Slack did not grant the required integration permissions", 403);
  }

  const vault = new VaultService();
  let credentialId: string;
  try {
    credentialId = await withTenantContext(state.tenantId, async (transaction) => {
      const membership = await transaction.tenantMember.findUnique({
        where: {
          tenantId_userId: {
            tenantId: state.tenantId,
            userId: state.userId,
          },
        },
        select: { role: true },
      });
      if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
        throw new Error("Tenant administrator access was revoked");
      }

      const keyRecord = await transaction.tenantEncryptionKey.findFirst({
        where: { tenantId: state.tenantId, isActive: true },
        orderBy: { keyVersion: "desc" },
        select: { id: true, encryptedDataKey: true },
      });
      if (!keyRecord) {
        throw new Error("Tenant has no active encryption key");
      }

      const tenantKey = decryptSecret(keyRecord.encryptedDataKey);
      const encryptedPayload = vault.encryptToken(slack.access_token, tenantKey);
      const name = `slack:${slack.team.id}`;
      const metadata = {
        teamId: slack.team.id,
        teamName: slack.team.name,
        scopes: grantedScopes,
        verificationStatus: "pending",
      } satisfies Prisma.InputJsonObject;

      const credential = await transaction.encryptedCredential.upsert({
        where: {
          tenantId_serviceName_name: {
            tenantId: state.tenantId,
            serviceName: "SLACK",
            name,
          },
        },
        create: {
          tenantId: state.tenantId,
          tenantEncryptionKeyId: keyRecord.id,
          serviceName: "SLACK",
          name,
          encryptedPayload,
          encryptionIv: encryptedPayload.split(".")[1],
          authenticationTag: encryptedPayload.split(".")[2],
          metadata,
        },
        update: {
          tenantEncryptionKeyId: keyRecord.id,
          encryptedPayload,
          encryptionIv: encryptedPayload.split(".")[1],
          authenticationTag: encryptedPayload.split(".")[2],
          metadata,
        },
        select: { id: true, encryptedPayload: true },
      });

      const persisted = await transaction.encryptedCredential.findUnique({
        where: { id: credential.id },
        select: { id: true, tenantId: true, encryptedPayload: true },
      });
      if (
        !persisted ||
        persisted.tenantId !== state.tenantId ||
        persisted.encryptedPayload !== encryptedPayload
      ) {
        throw new Error("Persisted Slack credential verification failed");
      }
      return persisted.id;
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "slack_credential_persistence_failed",
        tenantId: state.tenantId,
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return jsonError("Unable to securely save the Slack integration", 500);
  }

  const handshake = { tenantId: state.tenantId, credentialId };
  try {
    await verifySlackHandshake(handshake);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "slack_handshake_verification_failed",
        tenantId: state.tenantId,
        credentialId,
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    try {
      await markSlackHandshakeFailed(handshake);
    } catch (statusError) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "slack_handshake_failure_status_update_failed",
          tenantId: state.tenantId,
          credentialId,
          message:
            statusError instanceof Error ? statusError.message : "unknown error",
        }),
      );
      return jsonError("Slack verification failed and its status could not be saved", 503);
    }

    const failedUrl = new URL("/onboarding", callbackUrl.origin);
    failedUrl.searchParams.set("tenantId", state.tenantId);
    failedUrl.searchParams.set("slack", "failed");
    return NextResponse.redirect(failedUrl, {
      status: 303,
      headers: { "cache-control": "no-store" },
    });
  }

  const onboardingUrl = new URL("/onboarding", callbackUrl.origin);
  onboardingUrl.searchParams.set("tenantId", state.tenantId);
  onboardingUrl.searchParams.set("slack", "connected");
  return NextResponse.redirect(onboardingUrl, {
    status: 303,
    headers: { "cache-control": "no-store" },
  });
}
