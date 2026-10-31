import { IntegrationProvider } from "@prisma/client";
import { NextResponse } from "next/server";

import { getDashboardRequestContext } from "../../../../../../lib/server/dashboard-request";
import { sendSlackTestMessage } from "../../../../../../integrations/slack";
import { prisma } from "../../../../../../utils/prisma";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getDashboardRequestContext(request);
  if ("response" in context) return context.response;

  try {
    const integration = await prisma.integration.findFirst({
      where: {
        workspaceId: context.workspace.id,
        provider: IntegrationProvider.slack,
        isEnabled: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!integration) {
      return NextResponse.json(
        { error: "Configure a Slack channel before sending a test notification." },
        { status: 409 },
      );
    }

    await sendSlackTestMessage(integration);
    await prisma.auditLog.create({
      data: {
        workspaceId: context.workspace.id,
        actorUserId: context.identity.userId,
        action: "integration_test_dispatched",
        resourceType: "integration",
        resourceId: integration.id,
        metadata: { provider: "slack" },
      },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Slack test notification failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Slack test notification failed." },
      { status: 502 },
    );
  }
}
