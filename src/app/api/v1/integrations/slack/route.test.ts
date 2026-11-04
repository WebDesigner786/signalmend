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
  dbTransaction: vi.fn(),
  createIntegration: vi.fn(),
  updateIntegration: vi.fn(),
  createAuditLog: vi.fn(),
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
    $transaction: mocks.dbTransaction,
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
    mocks.dbTransaction.mockImplementation(async (callback) =>
      callback({
        integration: {
          create: mocks.createIntegration,
          update: mocks.updateIntegration,
        },
        auditLog: { create: mocks.createAuditLog },
      }),
    );
    mocks.createIntegration.mockResolvedValue({ id: "integration-1" });
    mocks.createAuditLog.mockResolvedValue({});
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
          channels: [{ id: "C123456", name: "public-room", is_member: false, is_private: false }],
        response_metadata: { next_cursor: "next-page" },
      },
      {
        ok: true,
          channels: [{ id: "C_JOINED", name: "alerts", is_member: true, is_private: false }],
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
        { id: "C_JOINED", name: "alerts", isMember: true, isPrivate: false },
        { id: "C123456", name: "public-room", isMember: false, isPrivate: false },
      ],
      currentChannelId: null,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url.searchParams.get("limit")).toBe("200");
    expect(calls[1].url.searchParams.get("cursor")).toBe("next-page");
  });

  it("joins a public channel before saving the integration", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          channels: [
            {
              id: "C123456",
              name: "public-room",
              is_member: false,
              is_private: false,
            },
          ],
          response_metadata: { next_cursor: "" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          channel: { id: "C123456", name: "public-room", is_member: true },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("https://signalmend.test/api/v1/integrations/slack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "C123456" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      integrationId: "integration-1",
      channelId: "C123456",
      channelName: "public-room",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const joinRequest = fetchMock.mock.calls[1];
    expect(joinRequest[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "content-type": "application/x-www-form-urlencoded",
      }),
      body: "channel=C123456",
    });
    expect(mocks.createIntegration).toHaveBeenCalled();
  });

  it("requires a manual invite for private channels", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        channels: [
          {
            id: "G123456",
            name: "private-room",
            is_member: false,
            is_private: true,
          },
        ],
        response_metadata: { next_cursor: "" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("https://signalmend.test/api/v1/integrations/slack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "G123456" }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("Invite the SignalMend bot"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.createIntegration).not.toHaveBeenCalled();
  });

  it("prompts Slack reconnection if the join permission was not granted", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            ok: true,
            channels: [
              {
                id: "C123456",
                name: "public-room",
                is_member: false,
                is_private: false,
              },
            ],
            response_metadata: { next_cursor: "" },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ ok: false, error: "missing_scope" }),
        ),
    );

    const response = await POST(
      new Request("https://signalmend.test/api/v1/integrations/slack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "C123456" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("Reconnect Slack"),
    });
    expect(mocks.createIntegration).not.toHaveBeenCalled();
  });
});
