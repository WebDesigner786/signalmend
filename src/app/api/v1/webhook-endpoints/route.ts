import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDashboardRequestContext } from "../../../../lib/server/dashboard-request";
import { encryptSecret } from "../../../../utils/crypto";
import { prisma } from "../../../../utils/prisma";

export const runtime = "nodejs";

const CreateSchema = z.object({
  name: z.string().trim().min(2).max(255),
  requireSignature: z.boolean(),
  signatureHeader: z.string().regex(/^[a-z0-9-]{2,128}$/),
});

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

export async function GET(request: Request): Promise<NextResponse> {
  const context = await getDashboardRequestContext(request);
  if ("response" in context) return context.response;

  try {
    const endpoints = await prisma.inboundWebhook.findMany({
      where: { workspaceId: context.workspace.id },
      orderBy: { createdAt: "desc" },
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
    return NextResponse.json({
      endpoints: endpoints.map(serializeEndpoint),
    });
  } catch (error) {
    console.error("Failed to list webhook endpoints", error);
    return NextResponse.json(
      { error: "Webhook endpoints are temporarily unavailable" },
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
      { error: "Invalid webhook endpoint settings" },
      { status: 400 },
    );
  }

  const endpointKey = randomBytes(24).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  try {
    const endpoint = await prisma.inboundWebhook.create({
      data: {
        workspaceId: context.workspace.id,
        name: parsed.data.name,
        endpointKey,
        secretKeyEncrypted: encryptSecret(secret),
        requireSignature: parsed.data.requireSignature,
        signatureHeader: parsed.data.signatureHeader,
      },
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
    return NextResponse.json(
      { endpoint: serializeEndpoint(endpoint), secret },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create webhook endpoint", error);
    const status =
      error instanceof Prisma.PrismaClientKnownRequestError ? 503 : 500;
    return NextResponse.json(
      { error: "Webhook endpoint could not be created" },
      { status },
    );
  }
}
