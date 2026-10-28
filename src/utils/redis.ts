import Redis, { type RedisOptions } from "ioredis";
import type { IncidentSeverity } from "@prisma/client";

import { env } from "../config/env";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface WebhookProcessingJob {
  eventId: string;
  endpointId: string;
  endpointKey: string;
  endpointName: string;
  workspaceId: string;
  receivedAt: string;
  rawBody: string;
  payload: JsonValue;
  severity?: IncidentSeverity;
}

const reconnectDelay = (attempt: number): number =>
  Math.min(250 * 2 ** Math.min(attempt, 8), 30_000);

function createRedisOptions(
  maxRetriesPerRequest: number | null,
): RedisOptions {
  return {
    maxRetriesPerRequest,
    enableReadyCheck: true,
    retryStrategy: reconnectDelay,
    reconnectOnError: (error) =>
      error.message.includes("READONLY") ||
      error.message.includes("LOADING") ||
      error.message.includes("CLUSTERDOWN"),
  };
}

export const redisClient = new Redis(
  env.redisUrl,
  createRedisOptions(3),
);

export const bullmqConnection = new Redis(
  env.redisUrl,
  createRedisOptions(null),
);

for (const [clientName, client] of [
  ["redis", redisClient],
  ["bullmq-redis", bullmqConnection],
] as const) {
  client.on("connect", () => {
    console.info(JSON.stringify({ level: "info", event: "redis_connect", client: clientName }));
  });
  client.on("ready", () => {
    console.info(JSON.stringify({ level: "info", event: "redis_ready", client: clientName }));
  });
  client.on("reconnecting", (delay: number) => {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "redis_reconnecting",
        client: clientName,
        delay,
      }),
    );
  });
  client.on("close", () => {
    console.warn(JSON.stringify({ level: "warn", event: "redis_closed", client: clientName }));
  });
  client.on("error", (error: Error) => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "redis_error",
        client: clientName,
        message: error.message,
      }),
    );
  });
}

let shutdownPromise: Promise<void> | undefined;
const redisResourceClosers = new Set<() => Promise<void>>();

export function registerRedisResourceCloser(
  closeResource: () => Promise<void>,
): () => void {
  redisResourceClosers.add(closeResource);
  return () => redisResourceClosers.delete(closeResource);
}

export function closeRedisConnections(): Promise<void> {
  if (!shutdownPromise) {
    shutdownPromise = (async () => {
      const resourceResults = await Promise.allSettled(
        [...redisResourceClosers].map((closeResource) => closeResource()),
      );
      const clientResults = await Promise.allSettled([
        redisClient.quit(),
        bullmqConnection.quit(),
      ]);
      const failures = [...resourceResults, ...clientResults].flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length > 0) {
        throw new AggregateError(failures, "One or more Redis resources failed to close");
      }
    })();
  }

  return shutdownPromise;
}

async function handleShutdown(signal: NodeJS.Signals): Promise<void> {
  console.info(JSON.stringify({ level: "info", event: "redis_shutdown_started", signal }));

  try {
    await closeRedisConnections();
    console.info(JSON.stringify({ level: "info", event: "redis_shutdown_complete", signal }));
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "redis_shutdown_failed",
        signal,
        message: error instanceof Error ? error.message : "Unknown shutdown error",
      }),
    );
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void handleShutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void handleShutdown("SIGTERM");
});
