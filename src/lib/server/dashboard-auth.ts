import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { env } from "../../config/env";
import { prisma } from "../../utils/prisma";

const DashboardClaimsSchema = z.object({
  sub: z.string().min(1).max(255),
  exp: z.number().int().positive(),
  nbf: z.number().int().optional(),
  workspace_id: z.string().uuid().optional(),
});

export interface DashboardIdentity {
  userId: string;
  pinnedWorkspaceId?: string;
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Malformed bearer token");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("Malformed bearer token");
  }
  return decoded;
}

export async function authenticateDashboardBearer(
  authorization: string | null,
): Promise<string> {
  return (await authenticateDashboardIdentity(authorization)).userId;
}

export async function authenticateDashboardIdentity(
  authorization: string | null,
): Promise<DashboardIdentity> {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_.-]{1,8192})$/);
  if (!match) {
    throw new Error("A valid bearer token is required");
  }

  try {
    const [encodedHeader, encodedClaims, encodedSignature, ...extra] =
      match[1].split(".");
    if (
      extra.length > 0 ||
      !encodedHeader ||
      !encodedClaims ||
      !encodedSignature
    ) {
      throw new Error("Malformed bearer token");
    }

    const header: unknown = JSON.parse(
      decodeBase64Url(encodedHeader).toString("utf8"),
    );
    if (
      typeof header !== "object" ||
      header === null ||
      Array.isArray(header) ||
      (header as Record<string, unknown>).alg !== "HS256"
    ) {
      throw new Error("Unsupported bearer token algorithm");
    }

    const expected = createHmac("sha256", env.dashboardJwtSecret)
      .update(`${encodedHeader}.${encodedClaims}`, "utf8")
      .digest();
    const received = decodeBase64Url(encodedSignature);
    if (
      received.byteLength !== expected.byteLength ||
      !timingSafeEqual(expected, received)
    ) {
      throw new Error("Invalid bearer token signature");
    }

    const claims = DashboardClaimsSchema.parse(
      JSON.parse(decodeBase64Url(encodedClaims).toString("utf8")) as unknown,
    );
    const now = Math.floor(Date.now() / 1_000);
    if (claims.exp <= now || (claims.nbf !== undefined && claims.nbf > now)) {
      throw new Error("Expired or not-yet-valid bearer token");
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { externalAuthId: claims.sub },
          ...( /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.sub)
            ? [{ id: claims.sub }]
            : []),
        ],
      },
      select: { id: true },
    });

    if (!user) {
      throw new Error("Bearer token user is not registered");
    }
    return {
      userId: user.id,
      ...(claims.workspace_id ? { pinnedWorkspaceId: claims.workspace_id } : {}),
    };
  } catch {
    throw new Error("Invalid or expired bearer token");
  }
}
