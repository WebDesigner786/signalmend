import { getServerSession } from "next-auth";

import { authOptions } from "../auth-options";

export async function getAuthenticatedUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}
