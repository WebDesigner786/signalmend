import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUserId } from "../../../lib/server/auth-session";
import { withTenantContext } from "../../../lib/server/tenantRls";
import { encryptSecret } from "../../../utils/crypto";
import { prisma } from "../../../utils/prisma";

export const runtime = "nodejs";

const OnboardingSchema = z.object({
  businessName: z.string().trim().min(2).max(255),
  businessNiche: z.string().trim().min(2).max(120),
  workspaceId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Sign in to continue setting up your business." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const workspaces = await prisma.workspace.findMany({
      where: {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: {
                userId,
                role: { in: ["owner", "admin"] },
              },
            },
          },
        ],
      },
      select: { id: true, name: true, tenantId: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return NextResponse.json(
      { workspaces },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "onboarding_workspace_list_failed",
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return NextResponse.json(
      { error: "Available workspaces could not be loaded." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Sign in to continue setting up your business." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Please enter your business details and try again." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const parsed = OnboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a business name and choose an industry to continue." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  let tenantId = parsed.data.tenantId ?? "";
  try {
    if (!parsed.data.workspaceId && parsed.data.tenantId) {
      return NextResponse.json(
        { error: "Choose a workspace before continuing this setup." },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }

    const workspace = parsed.data.workspaceId
      ? await prisma.workspace.findFirst({
          where: {
            id: parsed.data.workspaceId,
            OR: [
              { ownerId: userId },
              {
                members: {
                  some: {
                    userId,
                    role: { in: ["owner", "admin"] },
                  },
                },
              },
            ],
          },
          select: { id: true, tenantId: true },
        })
      : null;
    if (parsed.data.workspaceId && !workspace) {
      return NextResponse.json(
        { error: "Choose a workspace you have permission to manage." },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }

    tenantId = workspace?.tenantId ?? parsed.data.tenantId ?? randomUUID();
    if (parsed.data.tenantId && workspace?.tenantId && parsed.data.tenantId !== workspace.tenantId) {
      return NextResponse.json(
        { error: "This setup belongs to a different workspace." },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }

    if (workspace?.tenantId) {
      const tenant = await withTenantContext(tenantId, async (transaction) => {
        const membership = await transaction.tenantMember.findUnique({
          where: { tenantId_userId: { tenantId, userId } },
          select: { role: true },
        });
        if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
          return null;
        }
        return transaction.tenant.update({
          where: { id: tenantId },
          data: {
            name: parsed.data.businessName,
            businessNiche: parsed.data.businessNiche,
          },
          select: { id: true },
        });
      });
      if (!tenant) {
        return NextResponse.json(
          { error: "You do not have permission to update this business." },
          { status: 403, headers: { "cache-control": "no-store" } },
        );
      }

      await withTenantContext(tenantId, async (transaction) => {
        const key = await transaction.tenantEncryptionKey.findFirst({
          where: { tenantId, isActive: true },
          select: { id: true },
        });
        if (key) {
          return key;
        }
        const latestKey = await transaction.tenantEncryptionKey.findFirst({
          where: { tenantId },
          orderBy: { keyVersion: "desc" },
          select: { keyVersion: true },
        });
        const keyVersion = (latestKey?.keyVersion ?? 0) + 1;
        const encryptedDataKey = encryptSecret(randomBytes(32).toString("base64url"));
        return transaction.tenantEncryptionKey.create({
          data: {
            tenantId,
            keyReference: `tenant:${tenantId}:v${keyVersion}`,
            keyVersion,
            encryptedDataKey,
            wrappingIv: encryptedDataKey.split(":")[1],
          },
          select: { id: true },
        });
      });

      return NextResponse.json(
        {
          tenantId: tenant.id,
          businessName: parsed.data.businessName,
          businessNiche: parsed.data.businessNiche,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (parsed.data.tenantId && workspace) {
      return NextResponse.json(
        { error: "This business is not linked to the selected workspace." },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }

    const encryptedDataKey = encryptSecret(randomBytes(32).toString("base64url"));
    const workspaceSlug = `${parsed.data.businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "workspace"}-${randomBytes(4).toString("hex")}`;
    let createdWorkspaceId = "";
    await withTenantContext(tenantId, async (transaction) => {
      await transaction.tenant.create({
        data: {
          id: tenantId,
          name: parsed.data.businessName,
          businessNiche: parsed.data.businessNiche,
        },
      });
      await transaction.tenantEncryptionKey.create({
        data: {
          tenantId,
          keyReference: `tenant:${tenantId}:v1`,
          keyVersion: 1,
          encryptedDataKey,
          wrappingIv: encryptedDataKey.split(":")[1],
        },
      });
      await transaction.tenantMember.create({
        data: { tenantId, userId, role: "owner" },
      });
      if (workspace) {
        await transaction.workspace.update({
          where: { id: workspace.id },
          data: { tenantId },
        });
        createdWorkspaceId = workspace.id;
      } else {
        const createdWorkspace = await transaction.workspace.create({
          data: {
            name: parsed.data.businessName,
            slug: workspaceSlug,
            ownerId: userId,
            tenantId,
          },
          select: { id: true },
        });
        createdWorkspaceId = createdWorkspace.id;
      }
    });

    return NextResponse.json(
      {
        tenantId,
        workspaceId: createdWorkspaceId,
        businessName: parsed.data.businessName,
        businessNiche: parsed.data.businessNiche,
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "onboarding_tenant_creation_failed",
        tenantId,
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return NextResponse.json(
      { error: "We could not set up your business. Please try again." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
