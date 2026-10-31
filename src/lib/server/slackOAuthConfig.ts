import { env } from "../../config/env";

const SLACK_CALLBACK_PATH = "/api/auth/slack/callback";

export const REQUIRED_SLACK_SCOPES = [
  "chat:write",
  "team:read",
  "channels:read",
  "groups:read",
] as const;

export interface SlackOAuthSettings {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  appUrl?: string;
  production?: boolean;
}

export type SlackOAuthConfiguration =
  | {
      ok: true;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    }
  | {
      ok: false;
      error: string;
      redirectUri: string | null;
    };

export function resolveSlackOAuthConfiguration(
  settings: SlackOAuthSettings,
): SlackOAuthConfiguration {
  let expectedRedirectUri: string | null = null;
  if (settings.appUrl) {
    try {
      const appUrl = new URL(settings.appUrl);
      if (!["http:", "https:"].includes(appUrl.protocol)) {
        return {
          ok: false,
          error: "NEXTAUTH_URL must use HTTP or HTTPS.",
          redirectUri: null,
        };
      }
      if (settings.production && appUrl.protocol !== "https:") {
        return {
          ok: false,
          error: "NEXTAUTH_URL must use HTTPS in production.",
          redirectUri: null,
        };
      }
      expectedRedirectUri = new URL(SLACK_CALLBACK_PATH, appUrl).toString();
    } catch {
      return {
        ok: false,
        error: "NEXTAUTH_URL must be a valid absolute URL.",
        redirectUri: null,
      };
    }
  }

  if (!settings.clientId || !settings.clientSecret || !settings.redirectUri) {
    return {
      ok: false,
      error:
        "Slack OAuth is not fully configured. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_REDIRECT_URI.",
      redirectUri: expectedRedirectUri ?? settings.redirectUri ?? null,
    };
  }

  let configuredRedirectUri: URL;
  try {
    configuredRedirectUri = new URL(settings.redirectUri);
  } catch {
    return {
      ok: false,
      error: "SLACK_REDIRECT_URI must be a valid absolute URL.",
      redirectUri: expectedRedirectUri,
    };
  }

  if (!["http:", "https:"].includes(configuredRedirectUri.protocol)) {
    return {
      ok: false,
      error: "SLACK_REDIRECT_URI must use HTTP or HTTPS.",
      redirectUri: expectedRedirectUri,
    };
  }
  if (settings.production && configuredRedirectUri.protocol !== "https:") {
    return {
      ok: false,
      error: "SLACK_REDIRECT_URI must use HTTPS in production.",
      redirectUri: expectedRedirectUri,
    };
  }
  if (
    configuredRedirectUri.pathname !== SLACK_CALLBACK_PATH ||
    configuredRedirectUri.search ||
    configuredRedirectUri.hash
  ) {
    return {
      ok: false,
      error: `SLACK_REDIRECT_URI must be exactly ${expectedRedirectUri ?? `https://<app-domain>${SLACK_CALLBACK_PATH}`}.`,
      redirectUri: expectedRedirectUri,
    };
  }

  if (
    expectedRedirectUri &&
    configuredRedirectUri.toString() !== expectedRedirectUri
  ) {
    return {
      ok: false,
      error: `SLACK_REDIRECT_URI must exactly match NEXTAUTH_URL: ${expectedRedirectUri}`,
      redirectUri: expectedRedirectUri,
    };
  }

  return {
    ok: true,
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    redirectUri: configuredRedirectUri.toString(),
  };
}

export function getSlackOAuthConfiguration(): SlackOAuthConfiguration {
  try {
    return resolveSlackOAuthConfiguration({
      clientId: env.slackClientId,
      clientSecret: env.slackClientSecret,
      redirectUri: env.slackRedirectUri,
      appUrl: process.env.NEXTAUTH_URL?.trim() || undefined,
      production: process.env.NODE_ENV === "production",
    });
  } catch (error) {
    console.error("Slack OAuth environment configuration is invalid", {
      message: error instanceof Error ? error.message : "Unknown configuration error",
    });
    return {
      ok: false,
      error: "Slack OAuth environment configuration is invalid. Check the Vercel environment variables.",
      redirectUri: null,
    };
  }
}
