import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { withTenantContext } from "../../../../../lib/server/tenantRls";
import {
  getWebhookCriticality,
  reserveMonthlyUsage,
} from "../../../../../middleware/quotaEnforcer";
import { processWebhookInline } from "../../../../../lib/server/webhook-processor";
import { decryptSecret, verifyHmacSignature } from "../../../../../utils/crypto";
import { getRedisClient, type JsonValue, type WebhookProcessingJob } from "../../../../../utils/redis";
import { prisma } from "../../../../../utils/prisma";

export const runtime = "nodejs";
export const maxDuration = 10;

const BODY_LIMIT_BYTES = 1_048_576;
const IDEMPOTENCY_TTL_SECONDS = 86_400;
const PROCESSING_LOCK_TTL_SECONDS = 180;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_SCRIPT = `
  local count = redis.call("INCR", KEYS[1])
  if count == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
  end
  return { count, redis.call("TTL", KEYS[1]) }
`;
const compareAndDeleteScript = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error, ...extra },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current === "string" || typeof current === "boolean") {
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (typeof current === "object") {
      pending.push(...Object.values(current));
      continue;
    }
    return false;
  }
  return true;
}

function rateLimitForTier(tier: "free" | "pro" | "enterprise"): number {
  switch (tier) {
    case "free":
      return 30;
    case "pro":
      return 300;
    case "enterprise":
      return 3_000;
  }
}

function requestIp(request: Request): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined
  );
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Webhook request body exceeds the 1 MB limit");
    this.name = "PayloadTooLargeError";
  }
}

async function readRawBody(request: Request): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new Error("Request body is required");
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > BODY_LIMIT_BYTES) {
      void reader.cancel().catch((error: unknown) => {
        console.error("Failed to cancel oversized webhook body stream", error);
      });
      throw new PayloadTooLargeError();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ endpointKey: string }> },
): Promise<NextResponse> {
  const { endpointKey } = await context.params;
  if (endpointKey.length < 1 || endpointKey.length > 64) {
    return jsonError("Webhook endpoint not found", 404);
  }

  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return jsonError("A JSON request body is required", 400);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > BODY_LIMIT_BYTES) {
    return jsonError("Webhook request body exceeds the 1 MB limit", 413);
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(request);
  } catch (error) {
    return error instanceof PayloadTooLargeError
      ? jsonError(error.message, 413)
      : jsonError("Request body could not be read", 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    return jsonError("Request body must contain valid JSON", 400);
  }
  if (!isJsonValue(payload)) {
    return jsonError("Request body must be valid JSON", 400);
  }

  let endpoint;
  try {
    endpoint = await prisma.inboundWebhook.findUnique({
      where: { endpointKey },
      select: {
        id: true,
        endpointKey: true,
        name: true,
        isActive: true,
        requireSignature: true,
        signatureHeader: true,
        secretKeyEncrypted: true,
        workspaceId: true,
        workspace: {
          select: { subscriptionTier: true, tenantId: true },
        },
      },
    });
  } catch (error) {
    console.error("Failed to look up webhook endpoint", error);
    return jsonError("Webhook service temporarily unavailable", 503);
  }
  if (!endpoint || !endpoint.isActive) {
    return jsonError("Webhook endpoint not found", 404);
  }

  const tenantId = endpoint.workspace.tenantId;
  if (!tenantId) {
    console.error("Webhook workspace is missing a tenant billing account", {
      endpointId: endpoint.id,
      workspaceId: endpoint.workspaceId,
    });
    return jsonError("Workspace usage limits are unavailable", 503);
  }
  try {
    const tenantExists = await withTenantContext(tenantId, (transaction) =>
      transaction.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      }),
    );
    if (!tenantExists) {
      return jsonError("Workspace usage limits are unavailable", 503);
    }
  } catch (error) {
    console.error("Failed to resolve webhook tenant", error);
    return jsonError("Workspace usage limits are unavailable", 503);
  }

  if (endpoint.requireSignature) {
    if (!endpoint.secretKeyEncrypted) {
      return jsonError("Webhook signature configuration is unavailable", 503);
    }
    const signatureHeader = request.headers.get(endpoint.signatureHeader);
    let secret: string;
    try {
      secret = decryptSecret(endpoint.secretKeyEncrypted);
    } catch (error) {
      console.error("Could not decrypt webhook signature secret", error);
      return jsonError("Webhook signature configuration is unavailable", 503);
    }
    if (!verifyHmacSignature(rawBody, secret, signatureHeader ?? undefined)) {
      try {
        await prisma.auditLog.create({
          data: {
            workspaceId: endpoint.workspaceId,
            inboundWebhookId: endpoint.id,
            action: "security_rejection",
            resourceType: "inbound_webhook",
            resourceId: endpoint.id,
            ipAddress: requestIp(request),
            userAgent: request.headers.get("user-agent") ?? undefined,
            metadata: { reason: "invalid_signature" },
          },
        });
      } catch (error) {
        console.error("Failed to persist webhook signature rejection audit event", error);
      }
      return jsonError("Invalid HMAC signature verification", 401);
    }
  }

  const digest = createHash("sha256")
    .update(endpointKey, "utf8")
    .update("\0")
    .update(rawBody)
    .digest("hex");
  const idempotencyKey = `webhook:idempotency:${endpoint.workspaceId}:${digest}`;
  const idempotencyToken = randomUUID();
  const quotaReservationKey = `webhook:quota-reservation:${endpoint.workspaceId}:${digest}`;
  const quotaReservationToken = randomUUID();

  try {
    const rateLimit = await getRedisClient().eval(
      RATE_LIMIT_SCRIPT,
      1,
      `webhook:rate:${endpoint.workspaceId}`,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    if (
      !Array.isArray(rateLimit) ||
      Number(rateLimit[0]) > rateLimitForTier(endpoint.workspace.subscriptionTier)
    ) {
      const retryAfter = Array.isArray(rateLimit) ? Number(rateLimit[1]) : 60;
      return jsonError("Rate limit exceeded", 429, {
        limit: rateLimitForTier(endpoint.workspace.subscriptionTier),
        retryAfter: Math.max(1, retryAfter),
      });
    }

    const lock = await getRedisClient().set(
      idempotencyKey,
      idempotencyToken,
      "EX",
      PROCESSING_LOCK_TTL_SECONDS,
      "NX",
    );
    if (lock !== "OK") {
      return NextResponse.json(
        { success: true, status: "duplicate", event_id: digest },
        { status: 202, headers: { "cache-control": "no-store" } },
      );
    }

    const quotaLock = await getRedisClient().set(
      quotaReservationKey,
      quotaReservationToken,
      "EX",
      IDEMPOTENCY_TTL_SECONDS,
      "NX",
    );
    if (quotaLock === "OK") {
      const critical = getWebhookCriticality(rawBody);
      if (critical === null) {
        await getRedisClient().eval(
          compareAndDeleteScript,
          1,
          quotaReservationKey,
          quotaReservationToken,
        );
        await getRedisClient().eval(
          compareAndDeleteScript,
          1,
          idempotencyKey,
          idempotencyToken,
        );
        return jsonError("Request body must contain valid JSON", 400);
      }

      const quota = await reserveMonthlyUsage(
        endpoint.workspaceId,
        tenantId,
        endpoint.workspace.subscriptionTier,
        critical,
      );
      if (!quota.allowed) {
        await getRedisClient().eval(
          compareAndDeleteScript,
          1,
          quotaReservationKey,
          quotaReservationToken,
        );
        await getRedisClient().eval(
          compareAndDeleteScript,
          1,
          idempotencyKey,
          idempotencyToken,
        );
        if (quota.denial === "token_credits") {
          return jsonError("Automation credit limit reached", 402, {
            message:
              "This free account has used all available automation credits. Upgrade your plan or add credits to continue.",
            code: "AUTOMATION_CREDITS_EXHAUSTED",
            remainingCredits: quota.remainingCredits,
          });
        }
        return jsonError("Monthly webhook quota exceeded", 429, {
          monthlyQuota: quota.monthlyQuota,
          receivedRequests: quota.receivedRequests,
          criticalGraceRequests: quota.criticalGraceRequests,
        });
      }
    }

    const job: WebhookProcessingJob = {
      eventId: digest,
      endpointId: endpoint.id,
      endpointKey: endpoint.endpointKey,
      endpointName: endpoint.name,
      workspaceId: endpoint.workspaceId,
      receivedAt: new Date().toISOString(),
      rawBody: rawBody.toString("base64"),
      payload,
    };

    try {
      await processWebhookInline(job);
      await prisma.inboundWebhook.update({
        where: { id: endpoint.id },
        data: { totalReceived: { increment: 1 } },
        select: { id: true },
      });
      const completed = await getRedisClient().set(
        idempotencyKey,
        "processed",
        "EX",
        IDEMPOTENCY_TTL_SECONDS,
        "XX",
      );
      if (completed !== "OK") {
        throw new Error("Webhook idempotency lock expired before completion");
      }
    } catch (error) {
      await getRedisClient().eval(
        compareAndDeleteScript,
        1,
        idempotencyKey,
        idempotencyToken,
      );
      console.error("Inline webhook processing failed", {
        endpointId: endpoint.id,
        eventId: digest,
        error,
      });
      return jsonError("Webhook processing failed", 500);
    }

    return NextResponse.json(
      { success: true, event_id: digest, status: "processed" },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    try {
      await getRedisClient().eval(
        compareAndDeleteScript,
        1,
        idempotencyKey,
        idempotencyToken,
      );
    } catch (releaseError) {
      console.error("Failed to release webhook idempotency lock", releaseError);
    }
    console.error("Webhook processing request failed", error);
    return jsonError("Webhook could not be processed", 503);
  }
}
