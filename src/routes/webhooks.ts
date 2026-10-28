import { createHash, randomUUID } from "node:crypto";

import rateLimit from "@fastify/rate-limit";
import type { SubscriptionTier } from "@prisma/client";
import type {
  FastifyPluginAsync,
  FastifyRequest,
  FastifySchema,
} from "fastify";

import { decryptSecret, verifyHmacSignature } from "../utils/crypto";
import {
  closeRedisConnections,
  redisClient,
  type JsonValue,
  type WebhookProcessingJob,
} from "../utils/redis";
import { prisma } from "../utils/prisma";
import { enforceWorkspaceQuota } from "../middleware/quotaEnforcer";
import { withTenantContext } from "../lib/server/tenantRls";
import { processWebhookInline } from "../lib/server/webhook-processor";

const JSON_BODY_LIMIT_BYTES = 1_048_576;
const IDEMPOTENCY_TTL_SECONDS = 86_400;
const PROCESSING_LOCK_TTL_SECONDS = 180;
const RATE_LIMIT_WINDOW_MS = 60_000;

interface WebhookRouteParams {
  endpointKey: string;
}

export interface WebhookContext {
  endpointId: string;
  endpointKey: string;
  endpointName: string;
  workspaceId: string;
  tenantId: string;
  workspaceTier: SubscriptionTier;
  isActive: boolean;
  requireSignature: boolean;
  signatureHeader: string;
  encryptedSecret: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    webhookContext: WebhookContext | null;
  }
}

const routeSchema: FastifySchema = {
  params: {
    type: "object",
    required: ["endpointKey"],
    properties: {
      endpointKey: { type: "string", minLength: 1, maxLength: 64 },
    },
    additionalProperties: false,
  },
  headers: {
    type: "object",
    properties: {
      "content-type": { type: "string" },
    },
  },
};

function isJsonValue(value: unknown): value is JsonValue {
  const pending: unknown[] = [value];

  while (pending.length > 0) {
    const current = pending.pop();
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        return false;
      }
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        pending.push(item);
      }
      continue;
    }
    if (typeof current === "object") {
      for (const item of Object.values(current)) {
        pending.push(item);
      }
      continue;
    }
    return false;
  }

  return true;
}

function workspaceRateLimit(tier: SubscriptionTier): number {
  switch (tier) {
    case "free":
      return 30;
    case "pro":
      return 300;
    case "enterprise":
      return 3_000;
  }
}

function getIdempotencyKey(endpointKey: string, rawBody: Buffer): string {
  return createHash("sha256")
    .update(endpointKey, "utf8")
    .update("\0")
    .update(rawBody)
    .digest("hex");
}

async function releaseIdempotencyLock(key: string, token: string): Promise<void> {
  const compareAndDelete = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;
  await redisClient.eval(compareAndDelete, 1, key, token);
}

const webhooksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest("webhookContext", null);

  fastify.addHook("onClose", async () => {
    try {
      await prisma.$disconnect();
    } finally {
      await closeRedisConnections();
    }
  });

  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: JSON_BODY_LIMIT_BYTES },
    async (_request: FastifyRequest, body: Buffer) => body,
  );

  fastify.addHook("onRequest", async (request, reply) => {
    const params = request.params as WebhookRouteParams;

    try {
      const endpoint = await prisma.inboundWebhook.findUnique({
        where: { endpointKey: params.endpointKey },
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

      if (!endpoint) {
        return reply.code(404).send({ error: "Webhook endpoint not found" });
      }

      const tenantId = endpoint.workspace.tenantId;
      if (!tenantId) {
        request.log.error(
          { endpointId: endpoint.id, workspaceId: endpoint.workspaceId },
          "Workspace is missing its tenant billing account",
        );
        return reply.code(503).send({ error: "Workspace usage limits are unavailable" });
      }

      const tenantExists = await withTenantContext(tenantId, (transaction) =>
        transaction.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true },
        }),
      );
      if (!tenantExists) {
        request.log.error(
          { endpointId: endpoint.id, workspaceId: endpoint.workspaceId, tenantId },
          "Workspace tenant billing account could not be found",
        );
        return reply.code(503).send({ error: "Workspace usage limits are unavailable" });
      }

      request.webhookContext = {
        endpointId: endpoint.id,
        endpointKey: endpoint.endpointKey,
        endpointName: endpoint.name,
        workspaceId: endpoint.workspaceId,
        tenantId,
        workspaceTier: endpoint.workspace.subscriptionTier,
        isActive: endpoint.isActive,
        requireSignature: endpoint.requireSignature,
        signatureHeader: endpoint.signatureHeader,
        encryptedSecret: endpoint.secretKeyEncrypted,
      };
    } catch (error) {
      request.log.error(
        { err: error, endpointKey: params.endpointKey },
        "Failed to look up webhook endpoint",
      );
      return reply.code(503).send({ error: "Webhook service temporarily unavailable" });
    }
  });

  await fastify.register(rateLimit, {
    global: false,
    hook: "preHandler",
    timeWindow: RATE_LIMIT_WINDOW_MS,
    redis: redisClient,
    keyGenerator: (request: FastifyRequest) =>
      request.webhookContext?.workspaceId ?? `unknown:${request.ip}`,
    errorResponseBuilder: (_request, context) => ({
      error: "Rate limit exceeded",
      limit: context.max,
      retryAfter: Math.ceil(context.ttl / 1_000),
    }),
  });

  fastify.post<{ Params: WebhookRouteParams; Body: Buffer }>(
    "/api/v1/webhooks/:endpointKey",
    {
      schema: routeSchema,
      bodyLimit: JSON_BODY_LIMIT_BYTES,
      preHandler: enforceWorkspaceQuota,
      config: {
        rateLimit: {
          max: (request: FastifyRequest) =>
            request.webhookContext
              ? workspaceRateLimit(request.webhookContext.workspaceTier)
              : 30,
        },
      },
    },
    async (request, reply) => {
      const context = request.webhookContext;
      if (!context) {
        request.log.error("Webhook endpoint context is missing after lookup");
        return reply.code(500).send({ error: "Webhook request could not be processed" });
      }
      if (!context.isActive) {
        return reply.code(404).send({ error: "Webhook endpoint not found" });
      }
      if (!Buffer.isBuffer(request.body)) {
        request.log.error({ endpointId: context.endpointId }, "Expected raw webhook body");
        return reply.code(400).send({ error: "A JSON request body is required" });
      }

      const rawBody = request.body;
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString("utf8")) as unknown;
      } catch {
        return reply.code(400).send({ error: "Request body must contain valid JSON" });
      }
      if (!isJsonValue(payload)) {
        return reply.code(400).send({ error: "Request body must be valid JSON" });
      }

      if (context.requireSignature) {
        if (!context.encryptedSecret) {
          request.log.error(
            { endpointId: context.endpointId },
            "Signature verification is enabled but no secret is configured",
          );
          return reply.code(503).send({ error: "Webhook signature configuration is unavailable" });
        }

        let secret: string;
        try {
          secret = decryptSecret(context.encryptedSecret);
        } catch (error) {
          request.log.error(
            { err: error, endpointId: context.endpointId },
            "Could not decrypt webhook signature secret",
          );
          return reply.code(503).send({ error: "Webhook signature configuration is unavailable" });
        }

        const header = request.headers[context.signatureHeader.toLowerCase()];
        const signature = Array.isArray(header) ? header[0] : header;
        if (!verifyHmacSignature(rawBody, secret, signature)) {
          try {
            await prisma.auditLog.create({
              data: {
                workspaceId: context.workspaceId,
                inboundWebhookId: context.endpointId,
                action: "security_rejection",
                resourceType: "inbound_webhook",
                resourceId: context.endpointId,
                ipAddress: request.ip,
                userAgent: request.headers["user-agent"],
                metadata: { reason: "invalid_signature" },
              },
            });
          } catch (error) {
            request.log.error(
              { err: error, endpointId: context.endpointId },
              "Failed to persist webhook signature rejection audit event",
            );
          }

          request.log.warn(
            { endpointId: context.endpointId, workspaceId: context.workspaceId },
            "Rejected webhook with invalid signature",
          );
          return reply.code(401).send({ error: "Invalid HMAC signature verification" });
        }
      }

      const idempotencyDigest = getIdempotencyKey(context.endpointKey, rawBody);
      const lockKey = `webhook:idempotency:${context.workspaceId}:${idempotencyDigest}`;
      const lockToken = randomUUID();

      try {
        const lockAcquired = await redisClient.set(
          lockKey,
          lockToken,
          "EX",
          PROCESSING_LOCK_TTL_SECONDS,
          "NX",
        );
        if (lockAcquired !== "OK") {
          return reply.code(202).send({
            success: true,
            status: "duplicate",
            event_id: idempotencyDigest,
          });
        }

        const job: WebhookProcessingJob = {
          eventId: idempotencyDigest,
          endpointId: context.endpointId,
          endpointKey: context.endpointKey,
          endpointName: context.endpointName,
          workspaceId: context.workspaceId,
          receivedAt: new Date().toISOString(),
          rawBody: rawBody.toString("base64"),
          payload,
        };

        try {
          await processWebhookInline(job);
          await prisma.inboundWebhook.update({
            where: { id: context.endpointId },
            data: { totalReceived: { increment: 1 } },
            select: { id: true },
          });
          const completed = await redisClient.set(
            lockKey,
            "processed",
            "EX",
            IDEMPOTENCY_TTL_SECONDS,
            "XX",
          );
          if (completed !== "OK") {
            throw new Error("Webhook idempotency lock expired before completion");
          }
        } catch (error) {
          try {
            await releaseIdempotencyLock(lockKey, lockToken);
          } catch (releaseError) {
            request.log.error(
              { err: releaseError, endpointId: context.endpointId },
              "Failed to release webhook idempotency lock after processing failure",
            );
          }
          request.log.error(
            { err: error, endpointId: context.endpointId },
            "Inline webhook processing failed",
          );
          return reply.code(500).send({ error: "Webhook processing failed" });
        }

        return reply.code(200).send({
          success: true,
          event_id: idempotencyDigest,
          status: "processed",
        });
      } catch (error) {
        request.log.error(
          { err: error, endpointId: context.endpointId },
          "Failed to process webhook payload",
        );
        return reply.code(503).send({ error: "Webhook could not be processed" });
      }
    },
  );
};

export default webhooksRoutes;
