import { createHmac, timingSafeEqual } from "node:crypto";

import {
  IncidentSeverity,
  IncidentStatus,
  Prisma,
  type SubscriptionTier,
} from "@prisma/client";
import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import { z } from "zod";

import { env } from "../config/env";
import { getWorkspaceMetrics } from "../utils/metrics";
import { prisma } from "../utils/prisma";

const DashboardClaimsSchema = z.object({
  sub: z.string().min(1).max(255),
  exp: z.number().int().positive(),
  nbf: z.number().int().optional(),
  email: z.string().email().optional(),
  workspace_id: z.string().uuid().optional(),
});

const MetricsQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
});

const IncidentsQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  status: z.nativeEnum(IncidentStatus).optional(),
  severity: z.nativeEnum(IncidentSeverity).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

interface DashboardIdentity {
  userId: string;
  pinnedWorkspaceId?: string;
}

interface DashboardWorkspace {
  id: string;
  name: string;
  subscriptionTier: SubscriptionTier;
}

declare module "fastify" {
  interface FastifyRequest {
    dashboardIdentity: DashboardIdentity | null;
  }
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("JWT segment is not valid base64url");
  }
  return Buffer.from(value, "base64url");
}

function verifyDashboardToken(token: string): z.infer<typeof DashboardClaimsSchema> {
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
    throw new Error("Bearer token is not a compact JWT");
  }

  const header = JSON.parse(decodeBase64Url(segments[0]).toString("utf8")) as unknown;
  if (
    typeof header !== "object" ||
    header === null ||
    Array.isArray(header) ||
    (header as Record<string, unknown>).alg !== "HS256"
  ) {
    throw new Error("JWT uses an unsupported signature algorithm");
  }

  const expected = createHmac("sha256", env.dashboardJwtSecret)
    .update(`${segments[0]}.${segments[1]}`, "utf8")
    .digest();
  const received = decodeBase64Url(segments[2]);
  if (
    received.byteLength !== expected.byteLength ||
    !timingSafeEqual(expected, received)
  ) {
    throw new Error("JWT signature verification failed");
  }

  const claims = JSON.parse(decodeBase64Url(segments[1]).toString("utf8")) as unknown;
  const parsed = DashboardClaimsSchema.safeParse(claims);
  if (!parsed.success) {
    throw new Error("JWT claims are invalid");
  }

  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (parsed.data.exp <= nowSeconds) {
    throw new Error("JWT has expired");
  }
  if (parsed.data.nbf !== undefined && parsed.data.nbf > nowSeconds) {
    throw new Error("JWT is not yet valid");
  }

  return parsed.data;
}

function getBearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (!authorization) {
    return null;
  }
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

const authenticateDashboardRequest: preHandlerHookHandler = async (
  request,
  reply,
): Promise<void> => {
  const token = getBearerToken(request);
  if (!token) {
    reply.code(401).send({ error: "Bearer authentication is required" });
    return;
  }

  try {
    const claims = verifyDashboardToken(token);
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { externalAuthId: claims.sub },
          ...( /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.sub)
            ? [{ id: claims.sub }]
            : []),
        ],
      },
      select: { id: true },
    });

    if (!user) {
      reply.code(401).send({ error: "Authenticated user is not registered" });
      return;
    }

    request.dashboardIdentity = {
      userId: user.id,
      ...(claims.workspace_id ? { pinnedWorkspaceId: claims.workspace_id } : {}),
    };
  } catch (error) {
    request.log.warn(
      { reason: error instanceof Error ? error.message : "invalid token" },
      "Rejected dashboard authentication token",
    );
    reply.code(401).send({ error: "Invalid or expired bearer token" });
  }
};

async function resolveAuthorizedWorkspace(
  request: FastifyRequest,
  reply: FastifyReply,
  requestedWorkspaceId: string | undefined,
): Promise<DashboardWorkspace | null> {
  const identity = request.dashboardIdentity;
  if (!identity) {
    request.log.error("Dashboard workspace resolution ran without an authenticated identity");
    reply.code(401).send({ error: "Authentication is required" });
    return null;
  }

  if (
    identity.pinnedWorkspaceId &&
    requestedWorkspaceId &&
    identity.pinnedWorkspaceId !== requestedWorkspaceId
  ) {
    reply.code(403).send({ error: "Workspace is outside the authenticated token scope" });
    return null;
  }

  const workspaceId = identity.pinnedWorkspaceId ?? requestedWorkspaceId;
  const workspaces = await prisma.workspace.findMany({
    where: {
      ...(workspaceId ? { id: workspaceId } : {}),
      OR: [
        { ownerId: identity.userId },
        { members: { some: { userId: identity.userId } } },
      ],
    },
    select: { id: true, name: true, subscriptionTier: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });

  if (workspaces.length === 0) {
    reply.code(404).send({ error: "Workspace not found" });
    return null;
  }
  if (!workspaceId && workspaces.length > 1) {
    reply.code(400).send({
      error: "workspace_id is required when the user has access to multiple workspaces",
    });
    return null;
  }

  return workspaces[0];
}

const dashboardApiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest("dashboardIdentity", null);

  fastify.get(
    "/api/v1/dashboard/metrics",
    { preHandler: authenticateDashboardRequest },
    async (request, reply) => {
      const query = MetricsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "Invalid dashboard metrics query" });
      }

      try {
        const workspace = await resolveAuthorizedWorkspace(
          request,
          reply,
          query.data.workspace_id,
        );
        if (!workspace) {
          return;
        }

        const metrics = await getWorkspaceMetrics(
          workspace.id,
          workspace.subscriptionTier,
        );
        return reply.code(200).send({
          workspace: { id: workspace.id, name: workspace.name },
          metrics,
        });
      } catch (error) {
        request.log.error(
          { err: error },
          "Failed to calculate workspace dashboard metrics",
        );
        return reply.code(
          error instanceof Prisma.PrismaClientKnownRequestError ? 503 : 500,
        ).send({ error: "Dashboard metrics are temporarily unavailable" });
      }
    },
  );

  fastify.get(
    "/api/v1/dashboard/incidents",
    { preHandler: authenticateDashboardRequest },
    async (request, reply) => {
      const query = IncidentsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({
          error: "Invalid incidents query",
          issues: query.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        });
      }

      const { workspace_id, status, severity, from, to, page, limit } = query.data;
      const fromDate = from ? new Date(from) : undefined;
      const toDate = to ? new Date(to) : undefined;
      if (fromDate && toDate && fromDate >= toDate) {
        return reply.code(400).send({ error: "from must be earlier than to" });
      }

      try {
        const workspace = await resolveAuthorizedWorkspace(
          request,
          reply,
          workspace_id,
        );
        if (!workspace) {
          return;
        }

        const where: Prisma.IncidentWhereInput = {
          workspaceId: workspace.id,
          ...(status ? { status } : {}),
          ...(severity ? { severity } : {}),
          ...(fromDate || toDate
            ? {
                createdAt: {
                  ...(fromDate ? { gte: fromDate } : {}),
                  ...(toDate ? { lt: toDate } : {}),
                },
              }
            : {}),
        };
        const [incidents, total, statusGroups, severityGroups] =
          await Promise.all([
            prisma.incident.findMany({
              where,
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              skip: (page - 1) * limit,
              take: limit,
              select: {
                id: true,
                title: true,
                service: true,
                environment: true,
                severity: true,
                status: true,
                rawPayload: true,
                acknowledgedBy: true,
                acknowledgedAt: true,
                resolvedAt: true,
                silencedUntil: true,
                duplicateCount: true,
                lastSeenAt: true,
                createdAt: true,
                updatedAt: true,
              },
            }),
            prisma.incident.count({ where }),
            prisma.incident.groupBy({
              by: ["status"],
              where: { workspaceId: workspace.id },
              _count: { _all: true },
            }),
            prisma.incident.groupBy({
              by: ["severity"],
              where: { workspaceId: workspace.id },
              _count: { _all: true },
            }),
          ]);

        return reply.code(200).send({
          workspace: { id: workspace.id, name: workspace.name },
          incidents,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
          stateDistribution: statusGroups.map((row) => ({
            status: row.status,
            count: row._count._all,
          })),
          severityDistribution: severityGroups.map((row) => ({
            severity: row.severity,
            count: row._count._all,
          })),
        });
      } catch (error) {
        request.log.error({ err: error }, "Failed to fetch workspace incidents");
        return reply.code(
          error instanceof Prisma.PrismaClientKnownRequestError ? 503 : 500,
        ).send({ error: "Incident data is temporarily unavailable" });
      }
    },
  );
};

export default dashboardApiRoutes;
