import { describe, expect, it } from "vitest";

import {
  createSlackOAuthState,
  verifySlackOAuthState,
} from "./slackOAuthState";

describe("Slack OAuth state", () => {
  const secret = "test-dashboard-secret-that-is-long-enough";
  const tenantId = "a22d7a09-480b-4644-adf3-93ee6679b988";
  const userId = "b4ee2a6a-c177-4f15-9b41-986ae240b2b3";

  it("verifies signed state and retains the initiating tenant identity", () => {
    const state = createSlackOAuthState(tenantId, userId, secret);
    const verified = verifySlackOAuthState(state.token, secret);

    expect(verified).toMatchObject({
      tenantId,
      userId,
      nonce: state.nonce,
      v: 1,
    });
  });

  it("rejects state modified by an untrusted callback", () => {
    const state = createSlackOAuthState(tenantId, userId, secret);
    const [claims, signature] = state.token.split(".");
    const changed = `${claims.slice(0, -1)}${claims.endsWith("A") ? "B" : "A"}.${signature}`;

    expect(() => verifySlackOAuthState(changed, secret)).toThrow();
  });

  it("rejects a signature created with a different application secret", () => {
    const state = createSlackOAuthState(tenantId, userId, secret);

    expect(() =>
      verifySlackOAuthState(state.token, "different-dashboard-secret"),
    ).toThrow();
  });
});
