import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDashboardRequestContext } from "../../../../../../lib/server/dashboard-request";
import { encryptSecret } from "../../../../../../utils/crypto";
import { prisma } from "../../../../../../utils/prisma";

export const runtime = "nodejs";

const ParamsSchema = z.string().uuid();

export async function POST(
  request: Request,
  routeContext: { params: Promise<{ endpointId: string }> },
): Promise<NextResponse> {
  const context = await getDashboardRequestContext(request);
  if ("response" in context) return context.response;

  const { endpointId } = await routeContext.params;
  if (!ParamsSchema.safeParse(endpointId).success) {
    return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
  }

  const secret = randomBytes(32).toString("base64url");
  try {
    const updated = await prisma.inboundWebhook.updateMany({
      where: { id: endpointId, workspaceId: context.workspace.id },
      data: { secretKeyEncrypted: encryptSecret(secret) },
    });
    if (updated.count !== 1) {
      return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
    }
    const endpoint = await prisma.inboundWebhook.findUniqueOrThrow({
      where: { id: endpointId },
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
      endpoint: {
        ...endpoint,
        totalReceived: Number(endpoint.totalReceived),
        createdAt: endpoint.createdAt.toISOString(),
      },
      secret,
    });
  } catch (error) {
    console.error("Failed to rotate webhook endpoint secret", error);
    const status =
      error instanceof Prisma.PrismaClientKnownRequestError ? 503 : 500;
    return NextResponse.json(
      { error: "Signing secret could not be rotated" },
      { status },
    );
  }
}
