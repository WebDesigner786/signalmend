import {
  IncidentSeverity,
  Prisma,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDashboardRequestContext } from "../../../../lib/server/dashboard-request";
import { prisma } from "../../../../utils/prisma";

export const runtime = "nodejs";

const ConditionSchema = z.object({
  path: z.string().min(1).max(255),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists"]),
  value: z.union([z.string().max(4_096), z.number(), z.boolean(), z.null()]).optional(),
});

const ConditionsSchema = z
  .object({
    all: z.array(ConditionSchema).min(1).max(50).optional(),
    any: z.array(ConditionSchema).min(1).max(50).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.all) !== Boolean(value.any));

const ActionsSchema = z
  .object({
    title: z.string().max(500).optional(),
    service: z.string().max(255).optional(),
    environment: z.string().max(100).optional(),
    severity: z.enum(["critical", "warning", "info"]).optional(),
    delivery: z
      .object({
        provider: z.enum(["slack", "discord"]),
        target: z.string().min(1).max(2_048),
      })
      .optional(),
  })
  .strict();

const CreateSchema = z.object({
  name: z.string().trim().min(2).max(255),
  description: z.string().max(10_000).nullable().optional(),
  isEnabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(1_000_000).default(100),
  conditions: ConditionsSchema,
  actions: ActionsSchema,
  severity: z.nativeEnum(IncidentSeverity).nullable().optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const context = await getDashboardRequestContext(request);
  if ("response" in context) return context.response;

  try {
    const rules = await prisma.incidentRule.findMany({
      where: { workspaceId: context.workspace.id },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        description: true,
        isEnabled: true,
        priority: true,
        conditions: true,
        actions: true,
        severity: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ rules });
  } catch (error) {
    console.error("Failed to list incident rules", error);
    return NextResponse.json(
      { error: "Incident rules are temporarily unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getDashboardRequestContext(request);
  if ("response" in context) return context.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid incident rule",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const rule = await prisma.incidentRule.create({
      data: {
        workspaceId: context.workspace.id,
        name: parsed.data.name,
        description: parsed.data.description,
        isEnabled: parsed.data.isEnabled,
        priority: parsed.data.priority,
        conditions: parsed.data.conditions as Prisma.InputJsonValue,
        actions: parsed.data.actions as Prisma.InputJsonValue,
        severity: parsed.data.severity,
      },
      select: {
        id: true,
        name: true,
        description: true,
        isEnabled: true,
        priority: true,
        conditions: true,
        actions: true,
        severity: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    console.error("Failed to create incident rule", error);
    const status =
      error instanceof Prisma.PrismaClientKnownRequestError ? 503 : 500;
    return NextResponse.json(
      { error: "Incident rule could not be saved" },
      { status },
    );
  }
}
