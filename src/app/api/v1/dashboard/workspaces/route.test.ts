import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateDashboardIdentity: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("../../../../../lib/server/dashboard-auth", () => ({
  authenticateDashboardIdentity: mocks.authenticateDashboardIdentity,
}));

vi.mock("../../../../../utils/prisma", () => ({
  prisma: { workspace: { findMany: mocks.findMany } },
}));

import { GET } from "./route";

describe("GET /api/v1/dashboard/workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all workspaces the authenticated user can access", async () => {
    const workspaces = [
      { id: "workspace-1", name: "Primary", subscriptionTier: "free" },
      { id: "workspace-2", name: "Shared", subscriptionTier: "pro" },
    ];
    mocks.authenticateDashboardIdentity.mockResolvedValue({
      userId: "user-1",
    });
    mocks.findMany.mockResolvedValue(workspaces);

    const response = await GET(
      new Request("https://signalmend.test/api/v1/dashboard/workspaces"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaces });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { ownerId: "user-1" },
            { members: { some: { userId: "user-1" } } },
          ],
        },
        take: 100,
      }),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("limits a pinned bearer identity to its workspace", async () => {
    mocks.authenticateDashboardIdentity.mockResolvedValue({
      userId: "user-1",
      pinnedWorkspaceId: "workspace-2",
    });
    mocks.findMany.mockResolvedValue([]);

    const response = await GET(
      new Request("https://signalmend.test/api/v1/dashboard/workspaces"),
    );

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "workspace-2",
          OR: [
            { ownerId: "user-1" },
            { members: { some: { userId: "user-1" } } },
          ],
        },
      }),
    );
  });

  it("requires an authenticated dashboard identity", async () => {
    mocks.authenticateDashboardIdentity.mockRejectedValue(new Error("unauthorized"));

    const response = await GET(
      new Request("https://signalmend.test/api/v1/dashboard/workspaces"),
    );

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
