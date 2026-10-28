import type { Prisma } from "@prisma/client";

import { prisma } from "../../utils/prisma";

export async function withTenantContext<T>(
  tenantId: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw<Array<{ set_config: string }>>`
      SELECT set_config('app.tenant_id', ${tenantId}, true)
    `;
    return operation(transaction);
  });
}
