import type {
  Incident,
  IncidentSeverity,
  IncidentStatus,
  Integration,
} from "@prisma/client";

import { env } from "../config/env";
import { decryptSecret } from "../utils/crypto";
import { CustomSecurityException } from "../utils/vaultService";

type JsonRecord = Record<string, unknown>;

export interface SlackMessageView {
  text: string;
  attachments: Array<{
    color: string;
    blocks: JsonRecord[];
  }>;
}

export interface SlackIncidentView {
  id: string;
  title: string;
  service: string | null;
  environment: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  rawPayload: unknown;
  createdAt: Date;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  silencedUntil: Date | null;
}

export class SlackApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SlackApiError";
  }
}

const SLACK_API_BASE_URL = "https://slack.com/api";

function severityStyle(severity: IncidentSeverity): {
  label: string;
  color: string;
} {
  switch (severity) {
    case "critical":
      return { label: "CRITICAL", color: "#DC143C" };
    case "warning":
      return { label: "WARNING", color: "#FFBF00" };
    case "info":
      return { label: "INFO", color: "#007FFF" };
  }
}

function formatTimestamp(value: Date | null): string {
  return value ? value.toISOString() : "Not available";
}

function truncate(value: string, maximumLength: number): string {
  return value.length > maximumLength
    ? `${value.slice(0, maximumLength - 1)}…`
    : value;
}

function escapeSlackMrkdwn(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stringifyPayload(payload: unknown): string {
  try {
    return (JSON.stringify(payload, null, 2) ?? String(payload)).replace(/`/g, "'");
  } catch {
    return "[Payload could not be formatted]";
  }
}

function incidentActionButton(
  actionId: "acknowledge" | "resolve" | "silence",
  text: string,
  value: string,
  style?: "primary" | "danger",
): JsonRecord {
  return {
    type: "button",
    action_id: actionId,
    text: { type: "plain_text", text },
    value,
    ...(style ? { style } : {}),
  };
}

export function buildIncidentMessage(
  incident: SlackIncidentView,
  updatedBy?: string,
): SlackMessageView {
  const style = severityStyle(incident.severity);
  const title = truncate(incident.title || "Incident", 150);
  const origin = escapeSlackMrkdwn(incident.service || "Webhook");
  const value = JSON.stringify({ incidentId: incident.id });
  const payloadText = truncate(
    escapeSlackMrkdwn(stringifyPayload(incident.rawPayload)),
    2_800,
  );
  const statusText =
    incident.status === "acknowledged"
      ? `Acknowledged${updatedBy ? ` by ${updatedBy}` : incident.acknowledgedBy ? ` by ${incident.acknowledgedBy}` : ""} at ${formatTimestamp(incident.acknowledgedAt)}`
      : incident.status === "resolved"
        ? `Resolved${updatedBy ? ` by ${updatedBy}` : ""} at ${formatTimestamp(incident.resolvedAt)}`
        : incident.status === "silenced"
          ? `Silenced until ${formatTimestamp(incident.silencedUntil)}`
          : "Triggered";

  const blocks: JsonRecord[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${style.label}: ${title}`, emoji: true },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Environment:* ${escapeSlackMrkdwn(incident.environment ?? "unspecified")}  |  *Timestamp:* ${formatTimestamp(incident.createdAt)}  |  *Origin:* ${origin}`,
        },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Severity*\\n${style.label}` },
        { type: "mrkdwn", text: `*Status*\\n${escapeSlackMrkdwn(statusText)}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Payload*\\n\`\`\`${payloadText}\`\`\``,
      },
    },
  ];

  if (incident.status !== "resolved") {
    const buttons = [
      ...(incident.status === "triggered"
        ? [
            incidentActionButton(
              "acknowledge",
              "Acknowledge",
              value,
              "primary",
            ),
          ]
        : []),
      incidentActionButton("resolve", "Resolve", value, "danger"),
      ...(incident.status !== "silenced"
        ? [incidentActionButton("silence", "Silence 1h", value)]
        : []),
    ];

    blocks.push({
      type: "actions",
      block_id: `incident_actions_${incident.id}`,
      elements: buttons,
    });
  }

  return {
    text: escapeSlackMrkdwn(`[${style.label}] ${title} — ${statusText}`),
    attachments: [{ color: style.color, blocks }],
  };
}

function readConfigString(config: unknown, key: string): string | undefined {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return undefined;
  }
  const value = (config as JsonRecord)[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function getChannelId(integration: Integration): string {
  const channelId = readConfigString(integration.config, "channelId");
  if (!channelId) {
    throw new SlackApiError(
      `Slack integration ${integration.id} is missing config.channelId`,
      false,
    );
  }
  return channelId;
}

function getAccessToken(integration: Integration): string {
  if (!integration.accessTokenEncrypted) {
    throw new SlackApiError(
      `Slack integration ${integration.id} has no encrypted access token`,
      false,
    );
  }

  try {
    return decryptSecret(integration.accessTokenEncrypted);
  } catch (error) {
    if (error instanceof CustomSecurityException) {
      throw error;
    }
    throw new SlackApiError(
      `Unable to decrypt Slack token for integration ${integration.id}: ${error instanceof Error ? error.message : "unknown error"}`,
      false,
    );
  }
}

async function callSlackApi<T extends JsonRecord>(
  method: string,
  token: string,
  body: JsonRecord,
  timeoutMs = env.axiosTimeout,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SLACK_API_BASE_URL}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(100, Math.min(timeoutMs, env.axiosTimeout))),
    });
  } catch (error) {
    throw new SlackApiError(
      `Slack API request ${method} failed: ${error instanceof Error ? error.message : "network error"}`,
      true,
    );
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new SlackApiError(
      `Slack API ${method} returned an invalid JSON response`,
      response.status >= 500,
    );
  }

  if (
    typeof result !== "object" ||
    result === null ||
    typeof (result as JsonRecord).ok !== "boolean"
  ) {
    throw new SlackApiError(`Slack API ${method} returned an unexpected response`, false);
  }

  const slackResult = result as JsonRecord;
  if (!response.ok || slackResult.ok !== true) {
    const errorCode =
      typeof slackResult.error === "string" ? slackResult.error : `HTTP ${response.status}`;
    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      errorCode === "ratelimited" ||
      errorCode === "internal_error" ||
      errorCode === "temporarily_unavailable";
    throw new SlackApiError(`Slack API ${method} failed: ${errorCode}`, retryable);
  }

  return slackResult as T;
}

export async function sendIncidentAlert(
  integration: Integration,
  incident: Incident,
): Promise<{ channelId: string; messageTimestamp: string }> {
  const channelId = getChannelId(integration);
  const message = buildIncidentMessage(incident);
  const result = await callSlackApi("chat.postMessage", getAccessToken(integration), {
    channel: channelId,
    ...message,
    unfurl_links: false,
    unfurl_media: false,
  });
  if (typeof result.ts !== "string") {
    throw new SlackApiError("Slack chat.postMessage response did not include a timestamp", true);
  }
  return { channelId, messageTimestamp: result.ts };
}

export async function updateIncidentMessage(
  integration: Integration,
  incident: SlackIncidentView,
  channelId: string,
  messageTimestamp: string,
  updatedBy: string,
  timeoutMs = 2_000,
): Promise<void> {
  const message = buildIncidentMessage(incident, updatedBy);
  await callSlackApi("chat.update", getAccessToken(integration), {
    channel: channelId,
    ts: messageTimestamp,
    ...message,
  }, timeoutMs);
}

export function getSlackIntegrationTeamId(integration: Integration): string | undefined {
  return readConfigString(integration.config, "teamId");
}
