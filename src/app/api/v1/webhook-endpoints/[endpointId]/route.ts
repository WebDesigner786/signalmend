import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDashboardRequestContext } from "../../../../../lib/server/dashboard-request";
import { prisma } from "../../../../../utils/prisma";

export const runtime = "nodejs";

const ParamsSchema = z.string().uuid();
const UpdateSchema = z
  .object({
    isActive: z.boolean().optional(),
    requireSignature: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

function serializeEndpoint(endpoint: {
  id: string;
  name: string;
  endpointKey: string;
  isActive: boolean;
  requireSignature: boolean;
  signatureHeader: string;
  totalReceived: bigint;
  createdAt: Date;
}) {
  return {
    ...endpoint,
    totalReceived: Number(endpoint.totalReceived),
    createdAt: endpoint.createdAt.toISOString(),
  };
}

export async function PATCH(
  request: Request,
  routeContext: { params: Promise<{ endpointId: string }> },
): Promise<NextResponse> {
  const context = await getDashboardRequestContext(request);
  if ("response" in context) return context.response;

  const { endpointId } = await routeContext.params;
  if (!ParamsSchema.safeParse(endpointId).success) {
    return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid webhook endpoint settings" },
      { status: 400 },
    );
  }

  try {
    const existing = await prisma.inboundWebhook.findFirst({
      where: { id: endpointId, workspaceId: context.workspace.id },
      select: { id: true, secretKeyEncrypted: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
    }
    if (parsed.data.requireSignature && !existing.secretKeyEncrypted) {
      return NextResponse.json(
        { error: "Rotate the signing secret before enabling signature verification" },
        { status: 409 },
      );
    }

    const endpoint = await prisma.inboundWebhook.update({
      where: { id: endpointId },
      data: parsed.data,
      select: {
        id: true,
        name: true,
        endpointKey: true,
        isActive: true,
        requireSignature: true,
        signatureHeader: true,
        totalReceived: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ endpoint: serializeEndpoint(endpoint) });
  } catch (error) {
    console.error("Failed to update webhook endpoint", error);
    const status =
      error instanceof Prisma.PrismaClientKnownRequestError ? 503 : 500;
    return NextResponse.json(
      { error: "Webhook endpoint could not be updated" },
      { status },
    );
  }
}
