import { prisma } from "../../utils/prisma";
import type { DashboardIdentity } from "./dashboard-auth";

export async function resolveDashboardWorkspace(
  identity: DashboardIdentity,
  requestedWorkspaceId: string | undefined,
): Promise<
  | {
      workspace: {
        id: string;
        name: string;
        subscriptionTier: "free" | "pro" | "enterprise";
      };
    }
  | { error: string; status: number }
> {
  if (
    identity.pinnedWorkspaceId &&
    requestedWorkspaceId &&
    identity.pinnedWorkspaceId !== requestedWorkspaceId
  ) {
    return {
      error: "Workspace is outside the authenticated token scope",
      status: 403,
    };
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
    return { error: "Workspace not found", status: 404 };
  }
  if (!workspaceId && workspaces.length > 1) {
    return {
      error: "workspace_id is required when the user has access to multiple workspaces",
      status: 400,
    };
  }

  return { workspace: workspaces[0] };
}
