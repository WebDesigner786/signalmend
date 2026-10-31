import { NextResponse } from "next/server";

import {
  authenticateDashboardIdentity,
  type DashboardIdentity,
} from "../../../../../lib/server/dashboard-auth";
import { prisma } from "../../../../../utils/prisma";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  let identity: DashboardIdentity;
  try {
    identity = await authenticateDashboardIdentity(
      request.headers.get("authorization"),
    );
  } catch {
    return NextResponse.json(
      { error: "Sign in to list your workspaces." },
      { status: 401 },
    );
  }

  try {
    const workspaces = await prisma.workspace.findMany({
      where: {
        ...(identity.pinnedWorkspaceId
          ? { id: identity.pinnedWorkspaceId }
          : {}),
        OR: [
          { ownerId: identity.userId },
          { members: { some: { userId: identity.userId } } },
        ],
      },
      select: {
        id: true,
        name: true,
        subscriptionTier: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    });

    return NextResponse.json(
      { workspaces },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to list dashboard workspaces", error);
    return NextResponse.json(
      { error: "Workspaces could not be loaded. Please try again." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
