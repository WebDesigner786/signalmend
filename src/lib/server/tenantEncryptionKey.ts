import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { decryptSecret, encryptSecret } from "../../utils/crypto";

export type TenantEncryptionKeyRecord = {
  id: string;
  keyVersion: number;
  encryptedDataKey: string;
};

export async function ensureActiveTenantEncryptionKey(
  transaction: Pick<Prisma.TransactionClient, "tenantEncryptionKey">,
  tenantId: string,
): Promise<TenantEncryptionKeyRecord> {
  const activeKey = await transaction.tenantEncryptionKey.findFirst({
    where: { tenantId, isActive: true },
    orderBy: { keyVersion: "desc" },
    select: { id: true, keyVersion: true, encryptedDataKey: true },
  });

  if (activeKey) {
    try {
      decryptSecret(activeKey.encryptedDataKey);
      return activeKey;
    } catch {
      await transaction.tenantEncryptionKey.updateMany({
        where: { tenantId, isActive: true },
        data: { isActive: false },
      });
    }
  }

  const latestKey = await transaction.tenantEncryptionKey.findFirst({
    where: { tenantId },
    orderBy: { keyVersion: "desc" },
    select: { keyVersion: true },
  });

  const keyVersion = (latestKey?.keyVersion ?? 0) + 1;
  const encryptedDataKey = encryptSecret(randomBytes(32).toString("base64url"));
  const createdKey = await transaction.tenantEncryptionKey.create({
    data: {
      tenantId,
      keyReference: `tenant:${tenantId}:v${keyVersion}`,
      keyVersion,
      encryptedDataKey,
      wrappingIv: encryptedDataKey.split(":")[1] ?? "",
      isActive: true,
    },
    select: { id: true, keyVersion: true, encryptedDataKey: true },
  });

  return createdKey;
}
