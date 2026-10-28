import { Prisma } from "@prisma/client";
import { z } from "zod";

import { withTenantContext } from "./tenantRls";
import { env } from "../../config/env";
import { decryptSecret } from "../../utils/crypto";
import { prisma } from "../../utils/prisma";
import {
  VaultService,
} from "../../utils/vaultService";

export interface SlackHandshakeJob {
  tenantId: string;
  credentialId: string;
}

const CredentialSchema = z.object({
  tenantId: z.string().uuid(),
  tenantEncryptionKeyId: z.string().uuid(),
  encryptedPayload: z.string().min(1),
  encryptedDataKey: z.string().min(1),
});

const AuthTestSchema = z.object({
  ok: z.literal(true),
  team_id: z.string().min(1),
});

const TeamInfoSchema = z.object({
  ok: z.literal(true),
  team: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(255),
    domain: z.string().optional(),
  }),
});

function isPrismaJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function slackApi<T>(
  method: string,
  accessToken: string,
  schema: z.ZodType<T>,
  params?: Record<string, string>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params ?? {}).toString(),
      signal: AbortSignal.timeout(Math.min(env.axiosTimeout, 15_000)),
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(
      `Slack ${method} request failed: ${error instanceof Error ? error.message : "network error"}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Slack ${method} returned invalid JSON`);
  }

  if (!response.ok) {
    throw new Error(`Slack ${method} returned HTTP ${response.status}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const errorCode =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "unexpected_response";
    throw new Error(`Slack ${method} failed: ${errorCode}`);
  }
  return parsed.data;
}

async function loadSlackCredential(job: SlackHandshakeJob): Promise<{
  accessToken: string;
  metadata: Prisma.JsonObject;
}> {
  const credential = await withTenantContext(job.tenantId, async (transaction) => {
    const row = await transaction.encryptedCredential.findFirst({
      where: {
        id: job.credentialId,
        tenantId: job.tenantId,
        serviceName: "SLACK",
      },
      select: {
        tenantId: true,
        tenantEncryptionKeyId: true,
        encryptedPayload: true,
        metadata: true,
        tenantEncryptionKey: {
          select: { encryptedDataKey: true },
        },
      },
    });
    if (!row) {
      throw new Error("Slack credential was not found for its tenant");
    }

    const parsedCredential = CredentialSchema.safeParse({
      tenantId: row.tenantId,
      tenantEncryptionKeyId: row.tenantEncryptionKeyId,
      encryptedPayload: row.encryptedPayload,
      encryptedDataKey: row.tenantEncryptionKey.encryptedDataKey,
    });
    if (!parsedCredential.success || !isPrismaJsonObject(row.metadata)) {
      throw new Error("Slack credential metadata is malformed");
    }
    return { ...parsedCredential.data, metadata: row.metadata };
  });

  const tenantKey = decryptSecret(credential.encryptedDataKey);
  const accessToken = new VaultService().decryptToken(
    credential.encryptedPayload,
    tenantKey,
  );
  return { accessToken, metadata: credential.metadata };
}

async function updateVerificationStatus(
  job: SlackHandshakeJob,
  metadata: Prisma.JsonObject,
): Promise<void> {
  await withTenantContext(job.tenantId, async (transaction) => {
    const updated = await transaction.encryptedCredential.updateMany({
      where: {
        id: job.credentialId,
        tenantId: job.tenantId,
        serviceName: "SLACK",
      },
      data: { metadata },
    });
    if (updated.count !== 1) {
      throw new Error("Tenant Slack credential disappeared before status update");
    }
  });
}

export async function markSlackHandshakeFailed(
  job: SlackHandshakeJob,
): Promise<void> {
  await withTenantContext(job.tenantId, async (transaction) => {
    const credential = await transaction.encryptedCredential.findFirst({
      where: {
        id: job.credentialId,
        tenantId: job.tenantId,
        serviceName: "SLACK",
      },
      select: { metadata: true },
    });
    if (!credential || !isPrismaJsonObject(credential.metadata)) {
      throw new Error("Slack credential metadata is unavailable for failure status");
    }

    const updated = await transaction.encryptedCredential.updateMany({
      where: {
        id: job.credentialId,
        tenantId: job.tenantId,
        serviceName: "SLACK",
      },
      data: {
        metadata: {
          ...credential.metadata,
          verificationStatus: "failed",
          verificationError: "Slack workspace handshake verification failed",
        },
      },
    });
    if (updated.count !== 1) {
      throw new Error("Slack credential disappeared before failure status update");
    }
  });
}

export async function verifySlackHandshake(job: SlackHandshakeJob): Promise<void> {
  const credential = await loadSlackCredential(job);

  const expectedTeamId = credential.metadata.teamId;
  if (typeof expectedTeamId !== "string") {
    throw new Error("Slack credential is missing its team identifier");
  }

  const auth = await slackApi(
    "auth.test",
    credential.accessToken,
    AuthTestSchema,
  );
  if (auth.team_id !== expectedTeamId) {
    throw new Error(
      "Slack token workspace does not match the saved credential",
    );
  }

  const teamInfo = await slackApi(
    "team.info",
    credential.accessToken,
    TeamInfoSchema,
    { team_id: expectedTeamId },
  );
  if (teamInfo.team.id !== expectedTeamId) {
    throw new Error(
      "Slack metadata workspace does not match the saved credential",
    );
  }

  await updateVerificationStatus(job, {
    ...credential.metadata,
    teamName: teamInfo.team.name,
    ...(teamInfo.team.domain ? { teamDomain: teamInfo.team.domain } : {}),
    verificationStatus: "verified",
    verifiedAt: new Date().toISOString(),
  });
  console.info(
    JSON.stringify({
      level: "info",
      event: "slack_handshake_verified",
      tenantId: job.tenantId,
      credentialId: job.credentialId,
      slackTeamId: expectedTeamId,
    }),
  );
}
