import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import type {
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";

import { decryptSecret, verifyHmacSignature } from "../utils/crypto";
import { prisma } from "../utils/prisma";
import { redisClient } from "../utils/redis";
import type { WebhookContext } from "../routes/webhooks";

const MONTHLY_QUOTAS = {
  free: 1_000,
  pro: 50_000,
  enterprise: 500_000,
} as const;

const IDEMPOTENCY_TTL_SECONDS = 86_400;

interface QuotaResult {
  allowed: boolean;
  receivedRequests: number;
  criticalGraceRequests: number;
  monthlyQuota: number;
  denial?: "monthly_quota" | "token_credits";
  remainingCredits?: number;
}

class InsufficientTenantCredits extends Error {
  constructor(readonly remainingCredits: number) {
    super("Free tenant has no automation credits remaining");
    this.name = "InsufficientTenantCredits";
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getCriticality(rawBody: Buffer): boolean | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  const severity = record.severity ?? record.level;
  return (
    typeof severity === "string" &&
    ["critical", "fatal", "error", "CRITICAL", "FATAL", "ERROR"].includes(severity)
  );
}

async function validateWebhookSignature(
  request: FastifyRequest,
  reply: FastifyReply,
  context: WebhookContext,
  rawBody: Buffer,
): Promise<boolean> {
  if (!context.requireSignature) {
    return true;
  }
  if (!context.encryptedSecret) {
    request.log.error(
      { endpointId: context.endpointId },
      "Required webhook signature secret is not configured",
    );
    reply.code(503).send({ error: "Webhook signature configuration is unavailable" });
    return false;
  }

  let secret: string;
  try {
    secret = decryptSecret(context.encryptedSecret);
  } catch (error) {
    request.log.error(
      { err: error, endpointId: context.endpointId },
      "Could not decrypt webhook signature secret during quota check",
    );
    reply.code(503).send({ error: "Webhook signature configuration is unavailable" });
    return false;
  }

  const signature = firstHeader(
    request.headers[context.signatureHeader.toLowerCase()],
  );
  if (verifyHmacSignature(rawBody, secret, signature)) {
    return true;
  }

  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: context.workspaceId,
        inboundWebhookId: context.endpointId,
        action: "security_rejection",
        resourceType: "inbound_webhook",
        resourceId: context.endpointId,
        ipAddress: request.ip,
        userAgent: firstHeader(request.headers["user-agent"]),
        metadata: { reason: "invalid_signature" },
      },
    });
  } catch (error) {
    request.log.error(
      { err: error, endpointId: context.endpointId },
      "Failed to write webhook rejection audit record",
    );
  }

  request.log.warn(
    { endpointId: context.endpointId },
    "Rejected webhook before monthly usage reservation due to invalid signature",
  );
  reply.code(401).send({ error: "Invalid HMAC signature verification" });
  return false;
}

async function reserveMonthlyUsage(
  workspaceId: string,
  tenantId: string,
  tier: WebhookContext["workspaceTier"],
  critical: boolean,
): Promise<QuotaResult> {
  const monthlyQuota = MONTHLY_QUOTAS[tier];
  const criticalGraceLimit = Math.floor(monthlyQuota * 0.2);
  const monthStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  );
  const monthStartDate = monthStart.toISOString().slice(0, 10);

  try {
    return await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ set_config: string }>>`
        SELECT set_config('app.tenant_id', ${tenantId}, true)
      `;
      const tenant = await transaction.tenant.findUnique({
        where: { id: tenantId },
        select: { tier: true, activeTokenAllowances: true },
      });
      if (!tenant) {
        throw new Error("Workspace tenant billing account was not found");
      }
      if (tenant.tier === "free" && tenant.activeTokenAllowances <= 0) {
        throw new InsufficientTenantCredits(tenant.activeTokenAllowances);
      }

      await transaction.workspaceUsage.upsert({
        where: { workspaceId_monthStart: { workspaceId, monthStart } },
        create: { workspaceId, monthStart },
        update: {},
        select: { id: true },
      });

      const updated = await transaction.$queryRaw<
        Array<{ received_requests: number; critical_grace_requests: number }>
      >(Prisma.sql`
        UPDATE workspace_usage
        SET received_requests = received_requests + 1,
            critical_grace_requests = critical_grace_requests +
              CASE
                WHEN received_requests >= ${monthlyQuota} AND ${critical}
                THEN 1
                ELSE 0
              END,
            updated_at = NOW()
        WHERE workspace_id = ${workspaceId}::uuid
          AND month_start = ${monthStartDate}::date
          AND (
            received_requests < ${monthlyQuota}
            OR (
              ${critical}
              AND critical_grace_requests < ${criticalGraceLimit}
            )
          )
        RETURNING received_requests, critical_grace_requests
      `);

      if (updated.length === 0) {
        const alertClaim = await transaction.workspaceUsage.updateMany({
          where: { workspaceId, monthStart, quotaAlerted: false },
          data: { quotaAlerted: true },
        });
        if (alertClaim.count > 0) {
          await transaction.auditLog.create({
            data: {
              workspaceId,
              action: "monthly_quota_exceeded",
              resourceType: "workspace",
              resourceId: workspaceId,
              metadata: {
                tier,
                monthlyQuota,
                criticalGraceLimit,
                criticalRequest: critical,
                monthStart: monthStart.toISOString(),
              },
            },
          });
        }

        const usage = await transaction.workspaceUsage.findUniqueOrThrow({
          where: { workspaceId_monthStart: { workspaceId, monthStart } },
          select: { receivedRequests: true, criticalGraceRequests: true },
        });
        return {
          allowed: false,
          receivedRequests: usage.receivedRequests,
          criticalGraceRequests: usage.criticalGraceRequests,
          monthlyQuota,
          denial: "monthly_quota",
        };
      }

      let remainingCredits = tenant.activeTokenAllowances;
      if (remainingCredits > 0) {
        const debit = await transaction.tenant.updateMany({
          where: { id: tenantId, activeTokenAllowances: { gt: 0 } },
          data: { activeTokenAllowances: { decrement: 1 } },
        });
        if (debit.count === 1) {
          const updatedTenant = await transaction.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: { activeTokenAllowances: true },
          });
          remainingCredits = updatedTenant.activeTokenAllowances;
        } else {
          const currentTenant = await transaction.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: { tier: true, activeTokenAllowances: true },
          });
          remainingCredits = currentTenant.activeTokenAllowances;
          if (currentTenant.tier === "free" && remainingCredits <= 0) {
            throw new InsufficientTenantCredits(remainingCredits);
          }
          if (remainingCredits > 0) {
            throw new Error("Tenant credit reservation did not complete");
          }
        }
      }

      return {
        allowed: true,
        receivedRequests: updated[0].received_requests,
        criticalGraceRequests: updated[0].critical_grace_requests,
        monthlyQuota,
        remainingCredits,
      };
    });
  } catch (error) {
    if (error instanceof InsufficientTenantCredits) {
      return {
        allowed: false,
        receivedRequests: 0,
        criticalGraceRequests: 0,
        monthlyQuota,
        denial: "token_credits",
        remainingCredits: error.remainingCredits,
      };
    }
    throw error;
  }
}

export const enforceWorkspaceQuota: preHandlerHookHandler = async (
  request,
  reply,
): Promise<void> => {
  const context = (request as FastifyRequest & {
    webhookContext?: WebhookContext | null;
  }).webhookContext;

  if (!context) {
    request.log.error("Workspace quota hook ran without a webhook workspace context");
    reply.code(500).send({ error: "Workspace could not be identified" });
    return;
  }
  if (!context.isActive) {
    reply.code(404).send({ error: "Webhook endpoint not found" });
    return;
  }
  if (!Buffer.isBuffer(request.body)) {
    return;
  }

  const rawBody = request.body;
  if (!(await validateWebhookSignature(request, reply, context, rawBody))) {
    return;
  }
  const criticality = getCriticality(rawBody);
  if (criticality === null) {
    return;
  }

  const eventFingerprint = createHash("sha256")
    .update(context.endpointKey, "utf8")
    .update("\0")
    .update(rawBody)
    .digest("hex");
  const idempotencyKey = `webhook:quota-reservation:${context.workspaceId}:${eventFingerprint}`;
  const reservationToken = createHash("sha256")
    .update(`${Date.now()}:${request.id}:${eventFingerprint}`)
    .digest("hex");

  try {
    const lock = await redisClient.set(
      idempotencyKey,
      reservationToken,
      "EX",
      IDEMPOTENCY_TTL_SECONDS,
      "NX",
    );
    if (lock !== "OK") {
      return;
    }

    const result = await reserveMonthlyUsage(
      context.workspaceId,
      context.tenantId,
      context.workspaceTier,
      criticality,
    );
    if (!result.allowed) {
      if (result.denial === "token_credits") {
        request.log.warn(
          {
            workspaceId: context.workspaceId,
            tenantId: context.tenantId,
            remainingCredits: result.remainingCredits,
          },
          "Free tenant automation credit allowance exhausted",
        );
        reply.code(402).send({
          error: "Automation credit limit reached",
          message:
            "This free account has used all available automation credits. Upgrade your plan or add credits to continue.",
          code: "AUTOMATION_CREDITS_EXHAUSTED",
          remainingCredits: result.remainingCredits,
        });
        await redisClient.eval(
          `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`,
          1,
          idempotencyKey,
          reservationToken,
        );
        return;
      }

      request.log.warn(
        {
          workspaceId: context.workspaceId,
          tier: context.workspaceTier,
          monthlyQuota: result.monthlyQuota,
          receivedRequests: result.receivedRequests,
          criticalGraceRequests: result.criticalGraceRequests,
          critical: criticality,
        },
        "Workspace monthly webhook quota exceeded",
      );
      reply.code(429).send({
        error: "Monthly webhook quota exceeded",
        monthlyQuota: result.monthlyQuota,
        receivedRequests: result.receivedRequests,
        criticalGraceRequests: result.criticalGraceRequests,
      });
      await redisClient.eval(
        `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`,
        1,
        idempotencyKey,
        reservationToken,
      );
      return;
    }
  } catch (error) {
    try {
      await redisClient.eval(
        `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`,
        1,
        idempotencyKey,
        reservationToken,
      );
    } catch (releaseError) {
      request.log.error(
        { err: releaseError, workspaceId: context.workspaceId },
        "Failed to release webhook quota reservation lock",
      );
    }
    request.log.error(
      { err: error, workspaceId: context.workspaceId },
      "Failed to enforce workspace webhook quota",
    );
    reply.code(503).send({ error: "Usage limits are temporarily unavailable" });
  }
};
