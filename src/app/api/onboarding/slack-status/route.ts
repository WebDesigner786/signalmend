import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { getAuthenticatedUserId } from "../../../../lib/server/auth-session";
import { withTenantContext } from "../../../../lib/server/tenantRls";

export const runtime = "nodejs";

const TenantIdSchema = z.string().uuid();

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: Request): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Sign in to check your Slack connection." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const tenantId = TenantIdSchema.safeParse(
    new URL(request.url).searchParams.get("tenantId"),
  );
  if (!tenantId.success) {
    return NextResponse.json(
      { error: "The business setup could not be found. Please start again." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await withTenantContext(tenantId.data, async (transaction) => {
      const membership = await transaction.tenantMember.findUnique({
        where: {
          tenantId_userId: { tenantId: tenantId.data, userId },
        },
        select: { role: true },
      });
      if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
        return null;
      }

      const [tenant, credential] = await Promise.all([
        transaction.tenant.findUnique({
          where: { id: tenantId.data },
          select: { name: true, businessNiche: true },
        }),
        transaction.encryptedCredential.findFirst({
          where: { tenantId: tenantId.data, serviceName: "SLACK" },
          orderBy: { updatedAt: "desc" },
          select: { metadata: true },
        }),
      ]);
      if (!tenant) {
        return null;
      }

      const metadata =
        credential && isJsonObject(credential.metadata)
          ? credential.metadata
          : null;
      const rawStatus = metadata?.verificationStatus;
      const verificationStatus =
        rawStatus === "verified" || rawStatus === "failed" || rawStatus === "pending"
          ? rawStatus
          : "not_connected";

      return {
        businessName: tenant.name,
        businessNiche: tenant.businessNiche,
        verificationStatus,
        teamName: typeof metadata?.teamName === "string" ? metadata.teamName : null,
        verifiedAt: typeof metadata?.verifiedAt === "string" ? metadata.verifiedAt : null,
        verificationError:
          typeof metadata?.verificationError === "string"
            ? metadata.verificationError
            : null,
      };
    });

    if (!result) {
      return NextResponse.json(
        { error: "This business setup is no longer available to your account." },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }

    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "onboarding_slack_status_failed",
        tenantId: tenantId.data,
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return NextResponse.json(
      { error: "Slack connection status is temporarily unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
