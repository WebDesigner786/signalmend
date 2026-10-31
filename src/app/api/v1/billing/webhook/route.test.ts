import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Vercel billing webhook adapter", () => {
  it("mounts the billing handler and rejects an invalid signature", async () => {
    vi.stubEnv("LEMON_SQUEEZY_WEBHOOK_SECRET", "test-billing-webhook-secret");
    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://signalmend.test/api/v1/billing/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature": "0".repeat(64),
        },
        body: JSON.stringify({ invalid: true }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid billing webhook signature",
    });
  });
});
