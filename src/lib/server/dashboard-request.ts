import { NextResponse } from "next/server";
import { z } from "zod";

import {
  authenticateDashboardIdentity,
  type DashboardIdentity,
} from "./dashboard-auth";
import { resolveDashboardWorkspace } from "./dashboard-workspace";

export async function getDashboardRequestContext(
  request: Request,
): Promise<
  | {
      identity: DashboardIdentity;
      workspace: {
        id: string;
        name: string;
        subscriptionTier: "free" | "pro" | "enterprise";
      };
    }
  | { response: NextResponse }
> {
  let identity: DashboardIdentity;
  try {
    identity = await authenticateDashboardIdentity(
      request.headers.get("authorization"),
    );
  } catch {
    return {
      response: NextResponse.json(
        { error: "Invalid or expired bearer token" },
        { status: 401 },
      ),
    };
  }

  const searchParams = new URL(request.url).searchParams;
  const workspaceIds = searchParams.getAll("workspace_id");
  if (workspaceIds.length > 1) {
    return {
      response: NextResponse.json(
        { error: "Invalid workspace_id query" },
        { status: 400 },
      ),
    };
  }
  const parsedWorkspaceId = z.string().uuid().optional().safeParse(workspaceIds[0]);
  if (!parsedWorkspaceId.success) {
    return {
      response: NextResponse.json(
        { error: "Invalid workspace_id query" },
        { status: 400 },
      ),
    };
  }

  try {
    const result = await resolveDashboardWorkspace(
      identity,
      parsedWorkspaceId.data,
    );
    if ("error" in result) {
      return {
        response: NextResponse.json(
          { error: result.error },
          { status: result.status },
        ),
      };
    }
    return { identity, workspace: result.workspace };
  } catch (error) {
    console.error("Failed to resolve dashboard workspace", error);
    return {
      response: NextResponse.json(
        { error: "Workspace is temporarily unavailable" },
        { status: 503 },
      ),
    };
  }
}
