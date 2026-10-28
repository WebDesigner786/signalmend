import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateDashboardIdentity } from "../../../../../lib/server/dashboard-auth";
import { resolveDashboardWorkspace } from "../../../../../lib/server/dashboard-workspace";
import { getWorkspaceMetrics } from "../../../../../utils/metrics";

export const runtime = "nodejs";

const QuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
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
      { error: "Invalid dashboard metrics query" },
      { status: 400 },
    );
  }

  try {
    const result = await resolveDashboardWorkspace(identity, query.data.workspace_id);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const metrics = await getWorkspaceMetrics(
      result.workspace.id,
      result.workspace.subscriptionTier,
    );
    return NextResponse.json({
      workspace: { id: result.workspace.id, name: result.workspace.name },
      metrics,
    });
  } catch (error) {
    console.error("Failed to calculate workspace dashboard metrics", error);
    const status =
      error instanceof Prisma.PrismaClientKnownRequestError ? 503 : 500;
    return NextResponse.json(
      { error: "Dashboard metrics are temporarily unavailable" },
      { status },
    );
  }
}
