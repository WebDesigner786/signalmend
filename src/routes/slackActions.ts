import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { URLSearchParams } from "node:url";

import {
  IncidentStatus,
  IntegrationProvider,
  Prisma,
} from "@prisma/client";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../config/env";
import {
  getSlackIntegrationTeamId,
  updateIncidentMessage,
} from "../integrations/slack";
import { prisma } from "../utils/prisma";

const SLACK_REQUEST_MAX_AGE_SECONDS = 300;
const SLACK_ACTION_BODY_LIMIT_BYTES = 262_144;
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

const ActionValueSchema = z.object({
  incidentId: z.string().uuid(),
}).strict();

interface SlackSignatureHeaders {
  timestamp: string | undefined;
  signature: string | undefined;
}

export function verifySlackRequestSignature(
  rawBody: Buffer,
  headers: SlackSignatureHeaders,
  nowSeconds = Math.floor(Date.now() / 1_000),
): boolean {
  if (
    !headers.timestamp ||
    !headers.signature ||
    !/^\d{1,12}$/.test(headers.timestamp) ||
    !/^v0=[\da-f]{64}$/i.test(headers.signature)
  ) {
    return false;
  }

  const timestampSeconds = Number(headers.timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > SLACK_REQUEST_MAX_AGE_SECONDS
  ) {
    return false;
  }

  const baseString = Buffer.concat([
    Buffer.from(`v0:${headers.timestamp}:`, "utf8"),
    rawBody,
  ]);
  const expected = createHmac("sha256", env.slackSigningSecret)
    .update(baseString)
    .digest();
  const received = Buffer.from(headers.signature.slice(3), "hex");

  return (
    expected.byteLength === received.byteLength &&
    timingSafeEqual(expected, received)
  );
}

function parseSlackPayload(rawBody: Buffer): unknown {
  const form = new URLSearchParams(rawBody.toString("utf8"));
  const payloads = form.getAll("payload");
  if (payloads.length !== 1 || !payloads[0]) {
    throw new Error("Slack callback must contain exactly one payload field");
  }
  return JSON.parse(payloads[0]) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSingleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toIncidentStatus(
  actionId: "acknowledge" | "resolve" | "silence",
): IncidentStatus {
  switch (actionId) {
    case "acknowledge":
      return IncidentStatus.acknowledged;
    case "resolve":
      return IncidentStatus.resolved;
    case "silence":
      return IncidentStatus.silenced;
  }
}

function allowedSourceStatuses(
  actionId: "acknowledge" | "resolve" | "silence",
): IncidentStatus[] {
  switch (actionId) {
    case "acknowledge":
      return [IncidentStatus.triggered];
    case "resolve":
      return [
        IncidentStatus.triggered,
        IncidentStatus.acknowledged,
        IncidentStatus.silenced,
      ];
    case "silence":
      return [IncidentStatus.triggered, IncidentStatus.acknowledged];
  }
}

const slackActionsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "buffer", bodyLimit: SLACK_ACTION_BODY_LIMIT_BYTES },
    async (_request: FastifyRequest, body: Buffer) => body,
  );

  fastify.post(
    "/api/v1/integrations/slack/actions",
    {
      bodyLimit: SLACK_ACTION_BODY_LIMIT_BYTES,
      config: { rateLimit: false },
    },
    async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) {
        return reply.code(400).send({ error: "Expected form-urlencoded Slack callback" });
      }
      const rawBody = request.body;

      const signatureValid = verifySlackRequestSignature(rawBody, {
        timestamp: getSingleHeader(request.headers["x-slack-request-timestamp"]),
        signature: getSingleHeader(request.headers["x-slack-signature"]),
      });
      if (!signatureValid) {
        request.log.warn("Rejected Slack callback with an invalid or expired signature");
        return reply.code(401).send({ error: "Invalid Slack request signature" });
      }

      let rawPayload: unknown;
      try {
        rawPayload = parseSlackPayload(rawBody);
      } catch (error) {
        request.log.warn(
          { err: error },
          "Rejected malformed Slack interactive callback body",
        );
        return reply.code(400).send({ error: "Malformed Slack callback payload" });
      }

      const parsed = SlackPayloadSchema.safeParse(rawPayload);
      if (!parsed.success) {
        request.log.warn(
          { validationIssues: parsed.error.issues.map((issue) => issue.path.join(".")) },
          "Rejected invalid Slack interactive callback payload",
        );
        return reply.code(400).send({ error: "Invalid Slack callback payload" });
      }

      const callback = parsed.data;
      const action = callback.actions[0];
      let actionValue: unknown;
      try {
        actionValue = JSON.parse(action.value) as unknown;
      } catch {
        return reply.code(400).send({ error: "Invalid Slack action value" });
      }
      const actionValueResult = ActionValueSchema.safeParse(actionValue);
      if (!actionValueResult.success) {
        return reply.code(400).send({ error: "Invalid Slack incident reference" });
      }

      try {
        const incident = await prisma.incident.findUnique({
          where: { id: actionValueResult.data.incidentId },
        });
        if (!incident) {
          return reply.code(404).send({ error: "Incident message not found" });
        }

        const [membership, integrations] = await Promise.all([
          prisma.workspaceMember.findUnique({
            where: {
              workspaceId_slackUserId: {
                workspaceId: incident.workspaceId,
                slackUserId: callback.user.id,
              },
            },
            include: { user: { select: { name: true, email: true } } },
          }),
          prisma.integration.findMany({
            where: {
              workspaceId: incident.workspaceId,
              provider: IntegrationProvider.slack,
              isEnabled: true,
            },
          }),
        ]);

        if (!membership || integrations.length === 0) {
          request.log.warn(
            {
              incidentId: incident.id,
              workspaceId: incident.workspaceId,
              slackUserId: callback.user.id,
            },
            "Slack action user is not mapped to an active workspace member",
          );
          return reply.code(403).send({ error: "User is not authorized for this workspace" });
        }

        let integration: (typeof integrations)[number] | undefined;
        for (const candidate of integrations) {
          const configuredTeamId = getSlackIntegrationTeamId(candidate);
          if (!configuredTeamId || configuredTeamId !== callback.team.id) {
            continue;
          }

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
            dispatch &&
            isRecord(dispatch.metadata) &&
            dispatch.metadata.channelId === callback.channel.id &&
            dispatch.metadata.messageTimestamp === callback.message.ts
          ) {
            integration = candidate;
            break;
          }
        }

        if (!integration) {
          return reply.code(404).send({ error: "Incident message not found" });
        }

        const actorName = membership.user.name?.trim() || membership.user.email;
        const targetStatus = toIncidentStatus(action.action_id);
        const allowedStatuses = allowedSourceStatuses(action.action_id);
        const now = new Date();
        const updatedIncident = await prisma.$transaction(async (transaction) => {
          const change = await transaction.incident.updateMany({
            where: {
              id: incident.id,
              workspaceId: incident.workspaceId,
              status: { in: allowedStatuses },
            },
            data: {
              status: targetStatus,
              ...(action.action_id === "acknowledge"
                ? { acknowledgedBy: actorName, acknowledgedAt: now }
                : {}),
              ...(action.action_id === "resolve" ? { resolvedAt: now } : {}),
              ...(action.action_id === "silence"
                ? { silencedUntil: new Date(now.getTime() + 60 * 60 * 1_000) }
                : {}),
            },
          });

          if (change.count > 0) {
            await transaction.auditLog.create({
              data: {
                workspaceId: incident.workspaceId,
                actorUserId: membership.userId,
                incidentId: incident.id,
                action: `incident_${action.action_id}`,
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

          return transaction.incident.findUniqueOrThrow({
            where: { id: incident.id },
          });
        });

        await updateIncidentMessage(
          integration,
          updatedIncident,
          callback.channel.id,
          callback.message.ts,
          actorName,
        );

        request.log.info(
          {
            incidentId: updatedIncident.id,
            action: action.action_id,
            workspaceId: updatedIncident.workspaceId,
            userId: membership.userId,
          },
          "Processed Slack incident action",
        );
        return reply.code(200).send({ ok: true });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          request.log.error(
            { err: error, code: error.code },
            "Database rejected Slack incident action",
          );
        } else {
          request.log.error({ err: error }, "Failed to process Slack incident action");
        }
        return reply.code(503).send({ error: "Slack action could not be completed" });
      }
    },
  );
};

export default slackActionsRoutes;
