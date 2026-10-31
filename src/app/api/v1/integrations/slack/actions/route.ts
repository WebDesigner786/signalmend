import { IncidentStatus, IntegrationProvider, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getSlackIntegrationTeamId,
  updateIncidentMessage,
} from "../../../../../../integrations/slack";
import { verifySlackRequestSignature } from "../../../../../../routes/slackActions";
import { prisma } from "../../../../../../utils/prisma";

export const runtime = "nodejs";
export const maxDuration = 10;

const BODY_LIMIT_BYTES = 262_144;
const SlackPayloadSchema = z.object({
  type: z.literal("block_actions"),
  user: z.object({ id: z.string().min(1).max(64) }),
  team: z.object({ id: z.string().min(1).max(64) }),
  channel: z.object({ id: z.string().min(1).max(64) }),
  message: z.object({ ts: z.string().min(1).max(32) }),
  actions: z.array(
    z.object({
      action_id: z.enum(["acknowledge", "resolve", "silence"]),
      value: z.string().min(1).max(1_024),
    }),
  ).length(1),
}).passthrough();

const ActionValueSchema = z.object({ incidentId: z.string().uuid() }).strict();

async function readRawBody(request: Request): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > BODY_LIMIT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") {
    return jsonError("Expected a form-urlencoded Slack callback", 400);
  }

  let rawBody: Buffer | null;
  try {
    rawBody = await readRawBody(request);
  } catch (error) {
    console.error("Could not read Slack action request body", error);
    return jsonError("Slack callback body could not be read", 400);
  }
  if (!rawBody) {
    return jsonError("Slack callback body is missing or too large", 413);
  }

  if (!verifySlackRequestSignature(rawBody, {
    timestamp: request.headers.get("x-slack-request-timestamp") ?? undefined,
    signature: request.headers.get("x-slack-signature") ?? undefined,
  })) {
    return jsonError("Invalid or expired Slack request signature", 401);
  }

  const form = new URLSearchParams(rawBody.toString("utf8"));
  const payloads = form.getAll("payload");
  if (payloads.length !== 1 || !payloads[0]) {
    return jsonError("Slack callback must contain exactly one payload", 400);
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(payloads[0]) as unknown;
  } catch {
    return jsonError("Slack callback payload must be valid JSON", 400);
  }
  const parsedPayload = SlackPayloadSchema.safeParse(rawPayload);
  if (!parsedPayload.success) {
    return jsonError("Invalid Slack callback payload", 400);
  }

  const callback = parsedPayload.data;
  let rawActionValue: unknown;
  try {
    rawActionValue = JSON.parse(callback.actions[0].value) as unknown;
  } catch {
    return jsonError("Invalid Slack action value", 400);
  }
  const actionValue = ActionValueSchema.safeParse(rawActionValue);
  if (!actionValue.success) {
    return jsonError("Invalid incident reference", 400);
  }

  try {
    const incident = await prisma.incident.findUnique({
      where: { id: actionValue.data.incidentId },
    });
    if (!incident) return jsonError("Incident message not found", 404);

    const integrations = await prisma.integration.findMany({
      where: {
        workspaceId: incident.workspaceId,
        provider: IntegrationProvider.slack,
        isEnabled: true,
      },
    });
    let integration: (typeof integrations)[number] | undefined;
    for (const candidate of integrations) {
      if (getSlackIntegrationTeamId(candidate) !== callback.team.id) continue;
      const dispatch = await prisma.auditLog.findFirst({
        where: {
          workspaceId: incident.workspaceId,
          incidentId: incident.id,
          action: "integration_dispatched",
          resourceType: "integration",
          resourceId: candidate.id,
        },
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
      });
      if (
        dispatch?.metadata &&
        typeof dispatch.metadata === "object" &&
        !Array.isArray(dispatch.metadata) &&
        dispatch.metadata.channelId === callback.channel.id &&
        dispatch.metadata.messageTimestamp === callback.message.ts
      ) {
        integration = candidate;
        break;
      }
    }
    if (!integration) return jsonError("Incident message not found", 404);

    const actionId = callback.actions[0].action_id;
    const targetStatus = {
      acknowledge: IncidentStatus.acknowledged,
      resolve: IncidentStatus.resolved,
      silence: IncidentStatus.silenced,
    }[actionId];
    const allowedStatuses = {
      acknowledge: [IncidentStatus.triggered],
      resolve: [
        IncidentStatus.triggered,
        IncidentStatus.acknowledged,
        IncidentStatus.silenced,
      ],
      silence: [IncidentStatus.triggered, IncidentStatus.acknowledged],
    }[actionId];
    const actorName = `Slack user ${callback.user.id}`;
    const now = new Date();
    const updatedIncident = await prisma.$transaction(async (transaction) => {
      const update = await transaction.incident.updateMany({
        where: {
          id: incident.id,
          workspaceId: incident.workspaceId,
          status: { in: allowedStatuses },
        },
        data: {
          status: targetStatus,
          ...(actionId === "acknowledge"
            ? { acknowledgedBy: actorName, acknowledgedAt: now }
            : {}),
          ...(actionId === "resolve" ? { resolvedAt: now } : {}),
          ...(actionId === "silence"
            ? { silencedUntil: new Date(now.getTime() + 60 * 60 * 1_000) }
            : {}),
        },
      });
      if (update.count > 0) {
        await transaction.auditLog.create({
          data: {
            workspaceId: incident.workspaceId,
            incidentId: incident.id,
            action: `incident_${actionId}`,
            resourceType: "incident",
            resourceId: incident.id,
            metadata: {
              slackUserId: callback.user.id,
              slackTeamId: callback.team.id,
              priorStatus: incident.status,
              status: targetStatus,
            },
          },
        });
      }
      return transaction.incident.findUniqueOrThrow({ where: { id: incident.id } });
    });

    await updateIncidentMessage(
      integration,
      updatedIncident,
      callback.channel.id,
      callback.message.ts,
      actorName,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("Database rejected Slack incident action", {
        code: error.code,
        message: error.message,
      });
    } else {
      console.error("Failed to process Slack incident action", error);
    }
    return jsonError("Slack action could not be completed", 503);
  }
}
