import { describe, expect, it } from "vitest";

import { resolveSlackOAuthConfiguration } from "./slackOAuthConfig";

const appUrl = "https://signalmend-mu.vercel.app";
const redirectUri =
  "https://signalmend-mu.vercel.app/api/auth/slack/callback";

describe("Slack OAuth configuration", () => {
  it("accepts a callback URL matching the canonical app origin and path", () => {
    expect(
      resolveSlackOAuthConfiguration({
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri,
        appUrl,
        production: true,
      }),
    ).toEqual({
      ok: true,
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri,
    });
  });

  it("reports the exact canonical callback when the configured URL differs", () => {
    const result = resolveSlackOAuthConfiguration({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://other.example/api/auth/slack/callback",
      appUrl,
      production: true,
    });

    expect(result).toEqual({
      ok: false,
      error: `SLACK_REDIRECT_URI must exactly match NEXTAUTH_URL: ${redirectUri}`,
      redirectUri,
    });
  });

  it("rejects a callback path with query parameters", () => {
    const result = resolveSlackOAuthConfiguration({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: `${redirectUri}?source=onboarding`,
      appUrl,
      production: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(redirectUri);
      expect(result.redirectUri).toBe(redirectUri);
    }
  });

  it("requires HTTPS for production callback URLs", () => {
    const result = resolveSlackOAuthConfiguration({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost:3000/api/auth/slack/callback",
      production: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "SLACK_REDIRECT_URI must use HTTPS in production.",
      redirectUri: null,
    });
  });

  it("shows the expected URL even when OAuth credentials are not configured", () => {
    const result = resolveSlackOAuthConfiguration({
      redirectUri,
      appUrl,
      production: true,
    });

    expect(result).toEqual({
      ok: false,
      error:
        "Slack OAuth is not fully configured. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_REDIRECT_URI.",
      redirectUri,
    });
  });
});
