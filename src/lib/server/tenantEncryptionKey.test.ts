import { describe, expect, it, vi } from "vitest";

const { decryptSecret, encryptSecret } = vi.hoisted(() => ({
  decryptSecret: vi.fn((value: string) => {
    if (value.includes("broken")) {
      throw new Error("broken key");
    }
    return "plaintext";
  }),
  encryptSecret: vi.fn((value: string) => `v1:random-iv:random-tag:${value}:`),
}));

vi.mock("../../utils/crypto", () => ({
  decryptSecret,
  encryptSecret,
}));

import { ensureActiveTenantEncryptionKey } from "./tenantEncryptionKey";

describe("ensureActiveTenantEncryptionKey", () => {
  it("returns the active key when it is still decryptable", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "active-key",
      keyVersion: 2,
      encryptedDataKey: "v1:valid-key",
    });
    const transaction = {
      tenantEncryptionKey: { findFirst, updateMany: vi.fn() },
    } as any;

    const key = await ensureActiveTenantEncryptionKey(transaction, "tenant-123");

    expect(key).toMatchObject({ id: "active-key", keyVersion: 2 });
    expect(transaction.tenantEncryptionKey.updateMany).not.toHaveBeenCalled();
    expect(encryptSecret).not.toHaveBeenCalled();
  });

  it("rotates a broken active key before creating a replacement", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: "broken-key",
        keyVersion: 7,
        encryptedDataKey: "v1:broken-key",
      })
      .mockResolvedValueOnce(null);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockImplementation(async ({ data }) => ({
      id: "created-key",
      keyVersion: data.keyVersion,
      encryptedDataKey: data.encryptedDataKey,
    }));

    const transaction = {
      tenantEncryptionKey: { findFirst, updateMany, create },
    } as any;

    const key = await ensureActiveTenantEncryptionKey(transaction, "tenant-123");

    expect(transaction.tenantEncryptionKey.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-123", isActive: true },
      data: { isActive: false },
    });
    expect(key).toMatchObject({ id: "created-key", keyVersion: 1 });
    expect(encryptSecret).toHaveBeenCalledTimes(1);
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
