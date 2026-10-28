import { Queue, type JobsOptions } from "bullmq";

import {
  bullmqConnection,
  registerRedisResourceCloser,
} from "../utils/redis";

export const SLACK_HANDSHAKE_QUEUE_NAME = "slack-handshake-verification";

export interface SlackHandshakeJob {
  tenantId: string;
  credentialId: string;
}

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 86_400, count: 5_000 },
  removeOnFail: { age: 604_800, count: 10_000 },
};

export const slackHandshakeQueue = new Queue<
  SlackHandshakeJob,
  void,
  "verify-slack-handshake"
>(SLACK_HANDSHAKE_QUEUE_NAME, {
  connection: bullmqConnection,
  defaultJobOptions,
});

registerRedisResourceCloser(() => slackHandshakeQueue.close());

export async function enqueueSlackHandshake(
  job: SlackHandshakeJob,
): Promise<string> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(job.tenantId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(job.credentialId)
  ) {
    throw new Error("Slack handshake job identifiers must be valid UUIDs");
  }

  const queued = await slackHandshakeQueue.add(
    "verify-slack-handshake",
    job,
    { jobId: `slack-handshake-${job.credentialId}` },
  );
  return queued.id ?? `slack-handshake-${job.credentialId}`;
}
