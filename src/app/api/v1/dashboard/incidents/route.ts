import {
  IncidentSeverity,
  IncidentStatus,
  Prisma,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateDashboardIdentity } from "../../../../../lib/server/dashboard-auth";
import { resolveDashboardWorkspace } from "../../../../../lib/server/dashboard-workspace";
import { prisma } from "../../../../../utils/prisma";

export const runtime = "nodejs";

const QuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  status: z.nativeEnum(IncidentStatus).optional(),
  severity: z.nativeEnum(IncidentSeverity).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: Request): Promise<NextResponse> {
  let identity;
  try {
    identity = await authenticateDashboardIdentity(
      request.headers.get("authorization"),
    );
  } catch {
    return NextResponse.json({ error: "Invalid or expired bearer token" }, { status: 401 });
  }

  const query = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!query.success) {
    return NextResponse.json(
      {
        error: "Invalid incidents query",
        issues: query.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const { workspace_id, status, severity, from, to, page, limit } = query.data;
  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;
  if (fromDate && toDate && fromDate >= toDate) {
    return NextResponse.json({ error: "from must be earlier than to" }, { status: 400 });
  }

  try {
    const result = await resolveDashboardWorkspace(identity, workspace_id);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const where: Prisma.IncidentWhereInput = {
      workspaceId: result.workspace.id,
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
    const [incidents, total, statusGroups, severityGroups] = await Promise.all([
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
        where: { workspaceId: result.workspace.id },
        _count: { _all: true },
      }),
      prisma.incident.groupBy({
        by: ["severity"],
        where: { workspaceId: result.workspace.id },
        _count: { _all: true },
      }),
    ]);

    return NextResponse.json({
      workspace: { id: result.workspace.id, name: result.workspace.name },
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
    console.error("Failed to fetch workspace incidents", error);
    const statusCode =
      error instanceof Prisma.PrismaClientKnownRequestError ? 503 : 500;
    return NextResponse.json(
      { error: "Incident data is temporarily unavailable" },
      { status: statusCode },
    );
  }
}
