import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Slack interaction request signatures", () => {
  it("accepts a current signature over the exact request bytes", async () => {
    const secret = "slack-signing-test-secret";
    vi.stubEnv("SLACK_SIGNING_SECRET", secret);
    const { verifySlackRequestSignature } = await import("./slackActions");
    const timestamp = "1_800_000_000".replaceAll("_", "");
    const rawBody = Buffer.from("payload=%7B%22type%22%3A%22block_actions%22%7D");
    const signature = `v0=${createHmac("sha256", secret)
      .update(Buffer.concat([
        Buffer.from(`v0:${timestamp}:`, "utf8"),
        rawBody,
      ]))
      .digest("hex")}`;

    expect(
      verifySlackRequestSignature(
        rawBody,
        { timestamp, signature },
        Number(timestamp),
      ),
    ).toBe(true);
    expect(
      verifySlackRequestSignature(
        Buffer.from(`${rawBody.toString()}&changed=true`),
        { timestamp, signature },
        Number(timestamp),
      ),
    ).toBe(false);
  });

  it("rejects stale timestamps and malformed signatures", async () => {
    vi.stubEnv("SLACK_SIGNING_SECRET", "slack-signing-test-secret");
    const { verifySlackRequestSignature } = await import("./slackActions");

    expect(
      verifySlackRequestSignature(
        Buffer.from("payload=test"),
        { timestamp: "1000", signature: `v0=${"a".repeat(64)}` },
        1_301,
      ),
    ).toBe(false);
    expect(
      verifySlackRequestSignature(
        Buffer.from("payload=test"),
        { timestamp: "1000", signature: "invalid" },
        1_000,
      ),
    ).toBe(false);
  });
});
