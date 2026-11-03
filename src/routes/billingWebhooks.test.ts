import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findWorkspace: vi.fn(),
  transaction: vi.fn(),
  tenantUpdate: vi.fn(),
  auditCreate: vi.fn(),
  redis: {
    values: new Map<string, string>(),
    set: vi.fn(),
    get: vi.fn(),
    eval: vi.fn(),
  },
  latestSubscriptionUpdate: null as string | null,
}));

vi.mock("../utils/prisma", () => ({
  prisma: {
    workspace: { findUnique: mocks.findWorkspace },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../utils/redis", () => ({
  getRedisClient: () => mocks.redis,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Lemon Squeezy subscription event ordering", () => {
  it("does not let an older cancellation overwrite a newer active subscription", async () => {
    const secret = "billing-webhook-test-secret";
    vi.stubEnv("LEMON_SQUEEZY_WEBHOOK_SECRET", secret);
    mocks.redis.values.clear();
    mocks.latestSubscriptionUpdate = null;
    mocks.redis.set.mockImplementation(
      async (key: string, value: string) => {
        if (mocks.redis.values.has(key)) return null;
        mocks.redis.values.set(key, value);
        return "OK";
      },
    );
    mocks.redis.get.mockImplementation(
      async (key: string) => mocks.redis.values.get(key) ?? null,
    );
    mocks.redis.eval.mockImplementation(
      async (script: string, _keyCount: number, key: string, token: string) => {
        if (!script.includes("processed")) {
          if (mocks.redis.values.get(key) === token) {
            mocks.redis.values.delete(key);
            return 1;
          }
          return 0;
        }
        if (mocks.redis.values.get(key) === token) {
          mocks.redis.values.set(key, "processed");
          return "OK";
        }
        return 0;
      },
    );
    mocks.findWorkspace.mockResolvedValue({
      id: "workspace-1",
      tenantId: "tenant-1",
      lemonSqueezyCustomerId: "customer-1",
    });
    mocks.tenantUpdate.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        $queryRaw: async (
          strings: TemplateStringsArray,
          ...values: unknown[]
        ) => {
          const query = strings.join(" ");
          if (query.includes("set_config")) return [{ set_config: "tenant-1" }];
          const updatedAt = values.find(
            (value): value is string =>
              typeof value === "string" &&
              /^\d{4}-\d{2}-\d{2}T/.test(value),
          );
          if (!updatedAt) throw new Error("Missing subscription timestamp");
          if (
            mocks.latestSubscriptionUpdate &&
            Date.parse(updatedAt) <= Date.parse(mocks.latestSubscriptionUpdate)
          ) {
            return [];
          }
          mocks.latestSubscriptionUpdate = updatedAt;
          return [{ id: "workspace-1" }];
        },
        tenant: { update: mocks.tenantUpdate },
        auditLog: { create: mocks.auditCreate },
      }),
    );

    const { default: billingWebhooksRoutes } = await import("./billingWebhooks");
    const server = Fastify({ logger: false });
    await server.register(billingWebhooksRoutes);
    await server.ready();

    const deliver = async (
      eventName: "subscription_updated" | "subscription_cancelled",
      status: string,
      updatedAt: string,
    ) => {
      const body = JSON.stringify({
        meta: {
          event_name: eventName,
          custom_data: { workspace_id: "workspace-1" },
        },
        data: {
          id: "subscription-1",
          type: "subscriptions",
          attributes: {
            customer_id: "customer-1",
            variant_name: "Pro Team",
            status,
            updated_at: updatedAt,
          },
        },
      });
      const signature = createHmac("sha256", secret).update(body).digest("hex");
      return server.inject({
        method: "POST",
        url: "/api/v1/billing/webhook",
        headers: {
          "content-type": "application/json",
          "x-signature": signature,
          "x-event-name": eventName,
        },
        payload: body,
      });
    };

    try {
      const newest = await deliver(
        "subscription_updated",
        "active",
        "2026-11-03T21:00:00.000000Z",
      );
      const stale = await deliver(
        "subscription_cancelled",
        "cancelled",
        "2026-11-03T20:00:00.000000Z",
      );

      expect(newest.statusCode).toBe(200);
      expect(stale.statusCode).toBe(200);
      expect(stale.json()).toMatchObject({ success: true, stale: true });
      expect(mocks.latestSubscriptionUpdate).toBe("2026-11-03T21:00:00.000000Z");
      expect(mocks.tenantUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });
});
