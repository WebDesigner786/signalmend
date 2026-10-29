import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("environment configuration", () => {
  it("does not validate runtime secrets while the module is imported", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("ENCRYPTION_SECRET", "");
    vi.stubEnv("SLACK_SIGNING_SECRET", "");
    vi.stubEnv("DASHBOARD_JWT_SECRET", "");
    vi.stubEnv("LEMON_SQUEEZY_WEBHOOK_SECRET", "");

    await expect(import("./env")).resolves.toHaveProperty("env");

    const { env } = await import("./env");
    expect(() => env.redisUrl).toThrow(/Invalid environment configuration/);
  });

  it("validates only the requested setting", async () => {
    const secret = "test-nextauth-secret-that-is-long-enough";
    vi.stubEnv("NEXTAUTH_SECRET", secret);
    vi.stubEnv("REDIS_URL", "");

    const { env } = await import("./env");

    expect(env.nextAuthSecret).toBe(secret);
    expect(() => env.redisUrl).toThrow(/REDIS_URL/);
  });

  it("accepts the existing Lemon Squeezy webhook variable name", async () => {
    vi.stubEnv("LEMON_SQUEEZY_WEBHOOK_SECRET", "");
    vi.stubEnv("LEMONSQUEEZY_WEBHOOK_SECRET", "test-webhook-secret");

    const { env } = await import("./env");

    expect(env.lemonSqueezyWebhookSecret).toBe("test-webhook-secret");
  });
});
