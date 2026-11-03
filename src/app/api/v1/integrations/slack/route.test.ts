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

import { GET } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/v1/integrations/slack", () => {
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

  it("returns non-member channels and follows every Slack pagination cursor", async () => {
    const requestBodies: Record<string, string>[] = [];
    const pages = [
      {
        ok: true,
        channels: [
          { id: "C_PUBLIC", name: "public-room", is_member: false },
          { id: "C_JOINED", name: "joined-room", is_member: true },
        ],
        response_metadata: { next_cursor: "next-page" },
      },
      {
        ok: true,
        channels: [{ id: "C_LATE", name: "later-room", is_member: false }],
        response_metadata: { next_cursor: "" },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, string>);
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
        { id: "C_JOINED", name: "joined-room", isMember: true },
        { id: "C_LATE", name: "later-room", isMember: false },
        { id: "C_PUBLIC", name: "public-room", isMember: false },
      ],
      currentChannelId: null,
    });
    expect(requestBodies).toEqual([
      {
        types: "public_channel,private_channel",
        limit: "200",
      },
      {
        types: "public_channel,private_channel",
        limit: "200",
        cursor: "next-page",
      },
    ]);
  });
});
