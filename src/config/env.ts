import "dotenv/config";

import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  AXIOS_TIMEOUT: z.coerce.number().int().min(100).max(120_000).default(10_000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z
    .string()
    .url()
    .refine(
      (value) => {
        const protocol = new URL(value).protocol;
        return protocol === "redis:" || protocol === "rediss:";
      },
      { message: "must use the redis:// or rediss:// protocol" },
    ),
  ENCRYPTION_SECRET: z
    .string()
    .min(32, "must contain at least 32 characters")
    .refine((value) => Buffer.byteLength(value, "utf8") >= 32, {
      message: "must contain at least 32 bytes when encoded as UTF-8",
    }),
  SLACK_SIGNING_SECRET: z.string().trim().min(1),
  SLACK_CLIENT_ID: z.string().trim().min(1).optional(),
  SLACK_CLIENT_SECRET: z.string().trim().min(1).optional(),
  SLACK_REDIRECT_URI: z
    .string()
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "https:" || protocol === "http:";
    })
    .optional(),
  DASHBOARD_JWT_SECRET: z.string().min(32),
  LEMON_SQUEEZY_WEBHOOK_SECRET: z.string().trim().min(1),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const details = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = {
  nodeEnv: parsedEnvironment.data.NODE_ENV,
  host: parsedEnvironment.data.HOST,
  port: parsedEnvironment.data.PORT,
  axiosTimeout: parsedEnvironment.data.AXIOS_TIMEOUT,
  logLevel: parsedEnvironment.data.LOG_LEVEL,
  databaseUrl: parsedEnvironment.data.DATABASE_URL,
  redisUrl: parsedEnvironment.data.REDIS_URL,
  encryptionSecret: parsedEnvironment.data.ENCRYPTION_SECRET,
  slackSigningSecret: parsedEnvironment.data.SLACK_SIGNING_SECRET,
  slackClientId: parsedEnvironment.data.SLACK_CLIENT_ID,
  slackClientSecret: parsedEnvironment.data.SLACK_CLIENT_SECRET,
  slackRedirectUri: parsedEnvironment.data.SLACK_REDIRECT_URI,
  dashboardJwtSecret: parsedEnvironment.data.DASHBOARD_JWT_SECRET,
  lemonSqueezyWebhookSecret: parsedEnvironment.data.LEMON_SQUEEZY_WEBHOOK_SECRET,
} as const;

export type Environment = typeof env;
