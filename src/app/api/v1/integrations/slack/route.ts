import { IntegrationProvider, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDashboardRequestContext } from "../../../../../lib/server/dashboard-request";
import { withTenantContext } from "../../../../../lib/server/tenantRls";
import { encryptSecret, decryptSecret } from "../../../../../utils/crypto";
import { prisma } from "../../../../../utils/prisma";
import { VaultService } from "../../../../../utils/vaultService";

export const runtime = "nodejs";

const ConfigureSchema = z.object({
  channelId: z.string().regex(/^[A-Z0-9]{2,64}$/),
});

const SlackChannelsSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      is_member: z.boolean(),
    }),
  ).optional(),
});

const SlackChannelSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  channel: z.object({
    id: z.string(),
    name: z.string(),
    is_member: z.boolean(),
  }).optional(),
});

interface SlackCredential {
  accessToken: string;
  teamId: string;
  teamName: string;
}

async function loadSlackCredential(
  workspaceId: string,
  userId: string,
): Promise<
  | { credential: SlackCredential }
  | { response: NextResponse }
> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { tenantId: true },
  });
  if (!workspace?.tenantId) {
    return {
      response: NextResponse.json(
        { error: "Connect Slack from onboarding before configuring channels." },
        { status: 409 },
      ),
    };
  }

  const stored = await withTenantContext(workspace.tenantId, async (transaction) => {
    const membership = await transaction.tenantMember.findUnique({
      where: {
        tenantId_userId: { tenantId: workspace.tenantId!, userId },
      },
      select: { role: true },
    });
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      return { kind: "forbidden" as const };
    }

    const credential = await transaction.encryptedCredential.findFirst({
      where: { tenantId: workspace.tenantId!, serviceName: "SLACK" },
      orderBy: { updatedAt: "desc" },
      select: {
        encryptedPayload: true,
        metadata: true,
      },
    });
    if (!credential) {
      return { kind: "missing" as const };
    }

    const metadata = credential.metadata;
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata) ||
      metadata.verificationStatus !== "verified" ||
      typeof metadata.teamId !== "string" ||
      typeof metadata.teamName !== "string"
    ) {
      return { kind: "unverified" as const };
    }

    const key = await transaction.tenantEncryptionKey.findFirst({
      where: { tenantId: workspace.tenantId!, isActive: true },
      orderBy: { keyVersion: "desc" },
      select: { encryptedDataKey: true },
    });
    if (!key) {
      return { kind: "key_missing" as const };
    }

    const tenantKey = decryptSecret(key.encryptedDataKey);
    const accessToken = new VaultService().decryptToken(
      credential.encryptedPayload,
      tenantKey,
    );
    return {
      kind: "ready" as const,
      credential: {
        accessToken,
        teamId: metadata.teamId,
        teamName: metadata.teamName,
      },
    };
  });

  if (stored.kind !== "ready") {
    const status = stored.kind === "forbidden" ? 403 : 409;
    const message = {
      forbidden: "Tenant administrator access is required to configure Slack.",
      missing: "Connect Slack from onboarding before configuring channels.",
      unverified: "Slack authorization has not been verified. Reconnect Slack.",
      key_missing: "The Slack encryption key is unavailable.",
    }[stored.kind];
    return { response: NextResponse.json({ error: message }, { status }) };
  }
  return { credential: stored.credential };
}

async function callSlack<T extends { ok: boolean; error?: string }>(
  method: string,
  accessToken: string,
  body: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (error) {
    console.error("Slack API request failed", { method, error });
    throw new Error("Slack is temporarily unavailable");
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("Slack returned an invalid response");
  }
  const parsed = schema.safeParse(result);
  if (!response.ok || !parsed.success || !parsed.data.ok) {
    const reason =
      parsed.success && parsed.data.error
        ? parsed.data.error
        : `HTTP ${response.status}`;
    throw new Error(`Slack request failed: ${reason}`);
  }
  return parsed.data;
}

async function getAuthorizedSlackCredential(request: Request) {
  const context = await getDashboardRequestContext(request);
  if ("response" in context) return context;

  const credential = await loadSlackCredential(
    context.workspace.id,
    context.identity.userId,
  );
  if ("response" in credential) return credential;
  return { ...context, credential: credential.credential };
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const context = await getAuthorizedSlackCredential(request);
    if ("response" in context) return context.response;

    const [channelsResult, integration] = await Promise.all([
      callSlack(
        "conversations.list",
        context.credential.accessToken,
        { types: "public_channel,private_channel", limit: "200" },
        SlackChannelsSchema,
      ),
      prisma.integration.findFirst({
        where: {
          workspaceId: context.workspace.id,
          provider: IntegrationProvider.slack,
          isEnabled: true,
          config: {
            path: ["teamId"],
            equals: context.credential.teamId,
          },
        },
        select: { config: true },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    const config =
      integration?.config &&
      typeof integration.config === "object" &&
      !Array.isArray(integration.config)
        ? integration.config
        : null;
    return NextResponse.json({
      teamName: context.credential.teamName,
      channels: (channelsResult.channels ?? [])
        .filter((channel) => channel.is_member)
        .map(({ id, name }) => ({ id, name })),
      currentChannelId:
        config && typeof config.channelId === "string" ? config.channelId : null,
    });
  } catch (error) {
    console.error("Failed to load Slack channel configuration", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Slack channels could not be loaded." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getAuthorizedSlackCredential(request);
  if ("response" in context) return context.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsedBody = ConfigureSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Choose a valid Slack channel." }, { status: 400 });
  }

  try {
    const result = await callSlack(
      "conversations.info",
      context.credential.accessToken,
      { channel: parsedBody.data.channelId },
      SlackChannelSchema,
    );
    const channel = result.channel;
    if (!channel || channel.id !== parsedBody.data.channelId || !channel.is_member) {
      return NextResponse.json(
        { error: "Invite the SignalMend bot to that channel before configuring alerts." },
        { status: 409 },
      );
    }

    const existing = await prisma.integration.findFirst({
      where: {
        workspaceId: context.workspace.id,
        provider: IntegrationProvider.slack,
        isEnabled: true,
        config: {
          path: ["teamId"],
          equals: context.credential.teamId,
        },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    const data = {
      name: `${context.credential.teamName} #${channel.name}`,
      config: {
        teamId: context.credential.teamId,
        teamName: context.credential.teamName,
        channelId: channel.id,
        channelName: channel.name,
      } satisfies Prisma.InputJsonObject,
      accessTokenEncrypted: encryptSecret(context.credential.accessToken),
      isEnabled: true,
    };
    const integration = await prisma.$transaction(async (transaction) => {
      const saved = existing
        ? await transaction.integration.update({
            where: { id: existing.id },
            data,
            select: { id: true },
          })
        : await transaction.integration.create({
            data: {
              ...data,
              workspaceId: context.workspace.id,
              provider: IntegrationProvider.slack,
            },
            select: { id: true },
          });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspace.id,
          actorUserId: context.identity.userId,
          action: "integration_configured",
          resourceType: "integration",
          resourceId: saved.id,
          metadata: {
            provider: "slack",
            teamId: context.credential.teamId,
            channelId: channel.id,
            channelName: channel.name,
          },
        },
      });
      return saved;
    });

    return NextResponse.json({
      integrationId: integration.id,
      channelId: channel.id,
      channelName: channel.name,
    });
  } catch (error) {
    console.error("Failed to save Slack channel configuration", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Slack channel could not be saved." },
      { status: 502 },
    );
  }
}
