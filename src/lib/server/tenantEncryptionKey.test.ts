import { describe, expect, it, vi } from "vitest";

const { encryptSecret } = vi.hoisted(() => ({
  encryptSecret: vi.fn((value: string) => `v1:random-iv:random-tag:${value}:`),
}));

vi.mock("../../utils/crypto", () => ({
  encryptSecret,
}));

import { ensureActiveTenantEncryptionKey } from "./tenantEncryptionKey";

describe("ensureActiveTenantEncryptionKey", () => {
  it("returns the active key when one already exists", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "active-key",
      keyVersion: 2,
      encryptedDataKey: "v1:existing-key",
    });
    const transaction = {
      tenantEncryptionKey: { findFirst },
    } as any;

    const key = await ensureActiveTenantEncryptionKey(transaction, "tenant-123");

    expect(key).toMatchObject({ id: "active-key", keyVersion: 2 });
    expect(encryptSecret).not.toHaveBeenCalled();
  });

  it("creates a new active key when the tenant has no active key", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const create = vi.fn().mockImplementation(async ({ data }) => ({
      id: "created-key",
      keyVersion: data.keyVersion,
      encryptedDataKey: data.encryptedDataKey,
    }));

    const transaction = {
      tenantEncryptionKey: { findFirst, create },
    } as any;

    const key = await ensureActiveTenantEncryptionKey(transaction, "tenant-123");

    expect(key).toMatchObject({ id: "created-key", keyVersion: 1 });
    expect(encryptSecret).toHaveBeenCalledTimes(1);
    expect(encryptSecret).toHaveBeenCalledWith(expect.stringMatching(/^[A-Za-z0-9_-]{43}$/));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-123",
          keyReference: "tenant:tenant-123:v1",
          keyVersion: 1,
          isActive: true,
        }),
      }),
    );
  });
});
