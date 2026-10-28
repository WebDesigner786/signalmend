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
    lazyConnect: true,
    enableReadyCheck: true,
    retryStrategy: reconnectDelay,
    reconnectOnError: (error) =>
      error.message.includes("READONLY") ||
      error.message.includes("LOADING") ||
      error.message.includes("CLUSTERDOWN"),
  };
}

let redisClient: Redis | undefined;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.redisUrl, createRedisOptions(3));
    redisClient.on("connect", () => {
      console.info(JSON.stringify({ level: "info", event: "redis_connect" }));
    });
    redisClient.on("ready", () => {
      console.info(JSON.stringify({ level: "info", event: "redis_ready" }));
    });
    redisClient.on("reconnecting", (delay: number) => {
      console.warn(JSON.stringify({ level: "warn", event: "redis_reconnecting", delay }));
    });
    redisClient.on("close", () => {
      console.warn(JSON.stringify({ level: "warn", event: "redis_closed" }));
    });
    redisClient.on("error", (error: Error) => {
      console.error(
        JSON.stringify({
          level: "error",
          event: "redis_error",
          message: error.message,
        }),
      );
    });
  }
  return redisClient;
}

let shutdownPromise: Promise<void> | undefined;

export function closeRedisConnections(): Promise<void> {
  if (!shutdownPromise) {
    shutdownPromise = redisClient
      ? redisClient.quit().then(() => undefined)
      : Promise.resolve();
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
