import {
  UnrecoverableError,
  Worker,
  type Job,
} from "bullmq";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { SLACK_HANDSHAKE_QUEUE_NAME, type SlackHandshakeJob } from "../queues/slackHandshakeQueue";
import { withTenantContext } from "../lib/server/tenantRls";
import { env } from "../config/env";
import { decryptSecret } from "../utils/crypto";
import { prisma } from "../utils/prisma";
import {
  bullmqConnection,
  closeRedisConnections,
  registerRedisResourceCloser,
} from "../utils/redis";
import {
  CustomSecurityException,
  VaultService,
} from "../utils/vaultService";

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

class FatalHandshakeSecurityError extends UnrecoverableError {
  constructor(readonly securityException: CustomSecurityException) {
    super(securityException.message);
    this.name = "FatalHandshakeSecurityError";
  }
}

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
      signal: AbortSignal.timeout(env.axiosTimeout),
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
      throw new UnrecoverableError("Slack credential was not found for its tenant");
    }

    const parsedCredential = CredentialSchema.safeParse({
      tenantId: row.tenantId,
      tenantEncryptionKeyId: row.tenantEncryptionKeyId,
      encryptedPayload: row.encryptedPayload,
      encryptedDataKey: row.tenantEncryptionKey.encryptedDataKey,
    });
    if (!parsedCredential.success || !isPrismaJsonObject(row.metadata)) {
      throw new UnrecoverableError("Slack credential metadata is malformed");
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

async function verifySlackHandshake(
  job: Job<SlackHandshakeJob, void, "verify-slack-handshake">,
): Promise<void> {
  let credential: Awaited<ReturnType<typeof loadSlackCredential>>;
  try {
    credential = await loadSlackCredential(job.data);
  } catch (error) {
    if (error instanceof CustomSecurityException) {
      throw new FatalHandshakeSecurityError(error);
    }
    throw error;
  }

  const expectedTeamId = credential.metadata.teamId;
  if (typeof expectedTeamId !== "string") {
    throw new UnrecoverableError("Slack credential is missing its team identifier");
  }

  const auth = await slackApi(
    "auth.test",
    credential.accessToken,
    AuthTestSchema,
  );
  if (auth.team_id !== expectedTeamId) {
    throw new UnrecoverableError(
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
    throw new UnrecoverableError(
      "Slack metadata workspace does not match the saved credential",
    );
  }

  await updateVerificationStatus(job.data, {
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
      tenantId: job.data.tenantId,
      credentialId: job.data.credentialId,
      slackTeamId: expectedTeamId,
    }),
  );
}

export const slackHandshakeWorker = new Worker<
  SlackHandshakeJob,
  void,
  "verify-slack-handshake"
>(SLACK_HANDSHAKE_QUEUE_NAME, verifySlackHandshake, {
  connection: bullmqConnection,
  concurrency: 4,
  lockDuration: 30_000,
  maxStalledCount: 1,
});

slackHandshakeWorker.on("ready", () => {
  console.info(JSON.stringify({ level: "info", event: "slack_handshake_worker_ready" }));
});
slackHandshakeWorker.on("failed", (job, error) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "slack_handshake_job_failed",
      jobId: job?.id,
      tenantId: job?.data.tenantId,
      credentialId: job?.data.credentialId,
      attemptsMade: job?.attemptsMade,
      message: error.message,
    }),
  );

  if (error instanceof FatalHandshakeSecurityError && job) {
    process.exitCode = 1;
    void updateVerificationStatus(job.data, {
      verificationStatus: "failed",
      verificationError: "Credential authentication failed",
    })
      .catch((statusError: unknown) => {
        console.error(
          JSON.stringify({
            level: "error",
            event: "slack_handshake_failure_status_update_failed",
            credentialId: job?.data.credentialId,
            message:
              statusError instanceof Error
                ? statusError.message
                : "unknown error",
          }),
        );
      })
      .finally(() => {
        void closeRedisConnections().catch((shutdownError: unknown) => {
          console.error(
            JSON.stringify({
              level: "fatal",
              event: "slack_handshake_security_shutdown_failed",
              message:
                shutdownError instanceof Error
                  ? shutdownError.message
                  : "unknown error",
            }),
          );
          process.exitCode = 1;
        });
      });
  } else if (
    job &&
    (error instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts.attempts ?? 1))
  ) {
    void updateVerificationStatus(job.data, {
      verificationStatus: "failed",
      verificationError: "Slack workspace handshake verification failed",
    }).catch((statusError: unknown) => {
      console.error(
        JSON.stringify({
          level: "error",
          event: "slack_handshake_failure_status_update_failed",
          credentialId: job.data.credentialId,
          message:
            statusError instanceof Error
              ? statusError.message
              : "unknown error",
        }),
      );
    });
  }
});
slackHandshakeWorker.on("error", (error) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "slack_handshake_worker_error",
      message: error.message,
    }),
  );
});

registerRedisResourceCloser(async () => {
  await slackHandshakeWorker.close();
  await prisma.$disconnect();
});
