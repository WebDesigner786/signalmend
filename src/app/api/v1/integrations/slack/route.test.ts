import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboardRequestContext: vi.fn(),
  withTenantContext: vi.fn(),
  findWorkspace: vi.fn(),
  findMember: vi.fn(),
  findCredential: vi.fn(),
  findEncryptionKey: vi.fn(),
  findIntegration: vi.fn(),
  decryptSecret: vi.fn(),
  decryptToken: vi.fn(),
}));

vi.mock("../../../../../lib/server/dashboard-request", () => ({
  getDashboardRequestContext: mocks.getDashboardRequestContext,
}));

vi.mock("../../../../../lib/server/tenantRls", () => ({
  withTenantContext: mocks.withTenantContext,
}));

vi.mock("../../../../../utils/crypto", () => ({
  decryptSecret: mocks.decryptSecret,
  encryptSecret: vi.fn(),
}));

vi.mock("../../../../../utils/prisma", () => ({
  prisma: {
    workspace: { findUnique: mocks.findWorkspace },
    integration: { findFirst: mocks.findIntegration },
  },
}));

vi.mock("../../../../../utils/vaultService", () => ({
  VaultService: class {
    decryptToken = mocks.decryptToken;
  },
}));

import { GET, POST } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Slack channel configuration API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDashboardRequestContext.mockResolvedValue({
      workspace: { id: "workspace-1" },
      identity: { userId: "user-1" },
    });
    mocks.findWorkspace.mockResolvedValue({ tenantId: "tenant-1" });
    mocks.withTenantContext.mockImplementation(
      async (_tenantId, callback) =>
        callback({
          tenantMember: { findUnique: mocks.findMember },
          encryptedCredential: { findFirst: mocks.findCredential },
          tenantEncryptionKey: { findFirst: mocks.findEncryptionKey },
        }),
    );
    mocks.findMember.mockResolvedValue({ role: "owner" });
    mocks.findCredential.mockResolvedValue({
      encryptedPayload: "encrypted-token",
      metadata: {
        verificationStatus: "verified",
        teamId: "TEAM1",
        teamName: "Example workspace",
      },
    });
    mocks.findEncryptionKey.mockResolvedValue({
      encryptedDataKey: "encrypted-key",
    });
    mocks.decryptSecret.mockReturnValue("tenant-key");
    mocks.decryptToken.mockReturnValue("slack-token");
    mocks.findIntegration.mockResolvedValue(null);
  });

  it("returns channels across Slack pages, including channels the bot has not joined", async () => {
    const calls: Array<{ url: URL; method: string | undefined }> = [];
    const pages = [
      {
        ok: true,
        channels: [{ id: "C123456", name: "public-room", is_member: false }],
        response_metadata: { next_cursor: "next-page" },
      },
      {
        ok: true,
        channels: [{ id: "C_JOINED", name: "alerts", is_member: true }],
        response_metadata: { next_cursor: "" },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: new URL(String(input)), method: init?.method });
        return Response.json(pages.shift());
      }),
    );

    const response = await GET(
      new Request("https://signalmend.test/api/v1/integrations/slack"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      teamName: "Example workspace",
      channels: [
        { id: "C_JOINED", name: "alerts", isMember: true },
        { id: "C123456", name: "public-room", isMember: false },
      ],
      currentChannelId: null,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url.searchParams.get("limit")).toBe("200");
    expect(calls[1].url.searchParams.get("cursor")).toBe("next-page");
  });

  it("rejects saving a channel until the bot has joined it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: true,
          channels: [{ id: "C123456", name: "public-room", is_member: false }],
          response_metadata: { next_cursor: "" },
        }),
      ),
    );

    const response = await POST(
      new Request("https://signalmend.test/api/v1/integrations/slack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "C123456" }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Invite the SignalMend bot to that channel before configuring alerts.",
    });
    expect(mocks.findIntegration).not.toHaveBeenCalled();
  });
});
