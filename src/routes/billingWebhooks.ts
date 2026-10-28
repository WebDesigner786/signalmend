import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { SubscriptionTier, TenantTier } from "@prisma/client";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../config/env";
import { redisClient } from "../utils/redis";
import { prisma } from "../utils/prisma";

const BILLING_BODY_LIMIT_BYTES = 1_048_576;
const BILLING_EVENT_TTL_SECONDS = 7 * 24 * 60 * 60;

const BillingEventSchema = z.object({
  meta: z.object({
    event_name: z.enum([
      "subscription_created",
      "subscription_updated",
      "subscription_cancelled",
    ]),
    custom_data: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
  data: z.object({
    id: z.string().min(1).max(128),
    type: z.string().optional(),
    attributes: z.object({
      customer_id: z.union([z.string().min(1), z.number().int().positive()]),
      variant_name: z.string().min(1).max(255).optional(),
      status: z.string().min(1).max(64),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

interface BillingEvent {
  eventName: z.infer<typeof BillingEventSchema>["meta"]["event_name"];
  customerId: string;
  workspaceId: string | undefined;
  subscriptionId: string;
  variantName: string | undefined;
  status: string;
}

interface BillingWorkspace {
  id: string;
  tenantId: string | null;
  lemonSqueezyCustomerId: string | null;
}

function getSingleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function verifyBillingSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature || !/^[\da-fA-F]{64}$/.test(signature)) {
    return false;
  }
  const expected = createHmac("sha256", env.lemonSqueezyWebhookSecret)
    .update(rawBody)
    .digest();
  const received = Buffer.from(signature, "hex");
  return (
    received.byteLength === expected.byteLength &&
    timingSafeEqual(expected, received)
  );
}

function decodeBillingEvent(payload: z.infer<typeof BillingEventSchema>): BillingEvent {
  const customData = payload.meta.custom_data;
  const workspaceIdValue = customData?.workspace_id;

  return {
    eventName: payload.meta.event_name,
    customerId: String(payload.data.attributes.customer_id),
    workspaceId:
      typeof workspaceIdValue === "string" ? workspaceIdValue : undefined,
    subscriptionId: payload.data.id,
    variantName: payload.data.attributes.variant_name,
    status: payload.data.attributes.status.toLowerCase(),
  };
}

function tierForVariantName(variantName: string | undefined): SubscriptionTier | null {
  if (!variantName) {
    return null;
  }
  const normalized = variantName.trim().toLowerCase();
  if (normalized === "pro" || normalized.includes("pro team")) {
    return SubscriptionTier.pro;
  }
  if (normalized === "enterprise" || normalized.includes("enterprise")) {
    return SubscriptionTier.enterprise;
  }
  if (
    normalized === "free" ||
    normalized.includes("free developer")
  ) {
    return SubscriptionTier.free;
  }
  return null;
}

function tierForEvent(event: BillingEvent): SubscriptionTier | null {
  if (event.eventName === "subscription_cancelled") {
    return SubscriptionTier.free;
  }
  if (["active", "trialing", "on_trial"].includes(event.status)) {
    return tierForVariantName(event.variantName);
  }
  if (["cancelled", "expired", "past_due", "unpaid", "paused", "on_trial_expired"].includes(event.status)) {
    return SubscriptionTier.free;
  }
  return null;
}

async function findBillingWorkspace(
  event: BillingEvent,
): Promise<BillingWorkspace | null> {
  if (event.workspaceId) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: event.workspaceId },
      select: { id: true, tenantId: true, lemonSqueezyCustomerId: true },
    });
    if (!workspace) {
      return null;
    }
    if (
      workspace.lemonSqueezyCustomerId &&
      workspace.lemonSqueezyCustomerId !== event.customerId
    ) {
      throw new Error("Billing customer does not match the target workspace");
    }
    return workspace;
  }

  return prisma.workspace.findUnique({
    where: { lemonSqueezyCustomerId: event.customerId },
    select: { id: true, tenantId: true, lemonSqueezyCustomerId: true },
  });
}

async function releaseEventLock(key: string, token: string): Promise<void> {
  await redisClient.eval(
    `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`,
    1,
    key,
    token,
  );
}

async function markEventProcessed(key: string, token: string): Promise<void> {
  const result = await redisClient.eval(
    `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("SET", KEYS[1], "processed", "EX", ARGV[2])
      end
      return 0
    `,
    1,
    key,
    token,
    BILLING_EVENT_TTL_SECONDS,
  );
  if (result !== "OK") {
    throw new Error("Could not finalize billing webhook idempotency record");
  }
}

const billingWebhooksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: BILLING_BODY_LIMIT_BYTES },
    async (_request: FastifyRequest, body: Buffer) => body,
  );

  fastify.post(
    "/api/v1/billing/webhook",
    { bodyLimit: BILLING_BODY_LIMIT_BYTES },
    async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) {
        return reply.code(400).send({ error: "Expected a JSON billing event" });
      }

      const rawBody = request.body;
      const signature = getSingleHeader(request.headers["x-signature"]);
      if (!verifyBillingSignature(rawBody, signature)) {
        request.log.warn("Rejected billing webhook with an invalid signature");
        return reply.code(401).send({ error: "Invalid billing webhook signature" });
      }

      let rawEvent: unknown;
      try {
        rawEvent = JSON.parse(rawBody.toString("utf8")) as unknown;
      } catch {
        return reply.code(400).send({ error: "Billing event body must be valid JSON" });
      }

      const parsed = BillingEventSchema.safeParse(rawEvent);
      if (!parsed.success) {
        request.log.warn(
          { validationFields: parsed.error.issues.map((issue) => issue.path.join(".")) },
          "Rejected billing webhook with invalid event structure",
        );
        return reply.code(400).send({ error: "Invalid billing event structure" });
      }

      const event = decodeBillingEvent(parsed.data);
      const headerEventName = getSingleHeader(request.headers["x-event-name"]);
      if (headerEventName && headerEventName !== event.eventName) {
        request.log.warn(
          { headerEventName, payloadEventName: event.eventName },
          "Billing webhook event header and body event types did not match",
        );
        return reply.code(400).send({ error: "Billing event type mismatch" });
      }

      const tier = tierForEvent(event);
      if (tier === null) {
        request.log.warn(
          { eventName: event.eventName, status: event.status, variantName: event.variantName },
          "Received unsupported billing plan or subscription status",
        );
        return reply.code(422).send({ error: "Unsupported subscription plan or status" });
      }

      const eventDigest = createHash("sha256").update(rawBody).digest("hex");
      const lockKey = `billing:event:${eventDigest}`;
      const lockToken = `${Date.now()}:${request.id}`;

      try {
        const acquired = await redisClient.set(
          lockKey,
          lockToken,
          "EX",
          BILLING_EVENT_TTL_SECONDS,
          "NX",
        );
        if (acquired !== "OK") {
          const currentState = await redisClient.get(lockKey);
          if (currentState === "processed") {
            return reply.code(200).send({ success: true, duplicate: true });
          }
          reply.header("retry-after", "2");
          return reply.code(503).send({ error: "Billing event is being processed" });
        }

        const workspace = await findBillingWorkspace(event);
        if (!workspace) {
          await releaseEventLock(lockKey, lockToken);
          request.log.warn(
            {
              customerId: event.customerId,
              workspaceId: event.workspaceId,
              subscriptionId: event.subscriptionId,
            },
            "Billing event did not map to a known workspace",
          );
          return reply.code(404).send({ error: "Billing workspace not found" });
        }
        if (!workspace.tenantId) {
          throw new Error("Billing workspace has no tenant subscription account");
        }
        const tenantId = workspace.tenantId;

        await prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw<Array<{ set_config: string }>>`
            SELECT set_config('app.tenant_id', ${tenantId}, true)
          `;
          await transaction.workspace.update({
            where: { id: workspace.id },
            data: {
              subscriptionTier: tier,
              lemonSqueezyCustomerId: event.customerId,
            },
          });
          await transaction.tenant.update({
            where: { id: tenantId },
            data: {
              tier:
                tier === SubscriptionTier.free
                  ? TenantTier.free
                  : TenantTier.premium,
            },
          });
          await transaction.auditLog.create({
            data: {
              workspaceId: workspace.id,
              action: "subscription_updated",
              resourceType: "workspace",
              resourceId: workspace.id,
              metadata: {
                provider: "lemon_squeezy",
                eventName: event.eventName,
                subscriptionId: event.subscriptionId,
                customerId: event.customerId,
                subscriptionStatus: event.status,
                variantName: event.variantName ?? null,
                subscriptionTier: tier,
              },
            },
          });
        });
        await markEventProcessed(lockKey, lockToken);

        request.log.info(
          {
            workspaceId: workspace.id,
            subscriptionId: event.subscriptionId,
            eventName: event.eventName,
            subscriptionTier: tier,
          },
          "Applied Lemon Squeezy subscription event",
        );
        return reply.code(200).send({
          success: true,
          workspace_id: workspace.id,
          subscription_tier: tier,
        });
      } catch (error) {
        try {
          await releaseEventLock(lockKey, lockToken);
        } catch (releaseError) {
          request.log.error(
            { err: releaseError, eventDigest },
            "Failed to release billing webhook idempotency lock",
          );
        }
        request.log.error(
          { err: error, eventDigest },
          "Failed to apply billing webhook event",
        );
        return reply.code(503).send({ error: "Billing event could not be applied" });
      }
    },
  );
};

export default billingWebhooksRoutes;
