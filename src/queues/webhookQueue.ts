import { Queue, type JobsOptions } from "bullmq";

import {
  bullmqConnection,
  registerRedisResourceCloser,
  type WebhookProcessingJob,
} from "../utils/redis";

export const WEBHOOK_QUEUE_NAME = "incident-processing";
const MAX_RETRIES = 5;

const defaultJobOptions: JobsOptions = {
  attempts: MAX_RETRIES + 1,
  backoff: {
    type: "exponential",
    delay: 1_000,
  },
  removeOnComplete: {
    age: 86_400,
    count: 10_000,
  },
  removeOnFail: {
    age: 604_800,
    count: 20_000,
  },
};

export const webhookQueue = new Queue<
  WebhookProcessingJob,
  void,
  "process-webhook"
>(WEBHOOK_QUEUE_NAME, {
  connection: bullmqConnection,
  defaultJobOptions,
});

registerRedisResourceCloser(() => webhookQueue.close());

export async function enqueueWebhookJob(
  job: WebhookProcessingJob,
  deduplicationId: string,
): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(deduplicationId)) {
    throw new Error("Webhook queue deduplication ID has an invalid format");
  }

  const queued = await webhookQueue.add("process-webhook", job, {
    jobId: deduplicationId,
  });
  return queued.id ?? deduplicationId;
}
