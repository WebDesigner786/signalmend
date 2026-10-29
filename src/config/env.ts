import "dotenv/config";

import { z } from "zod";

function hasProtocol(
  value: string,
  allowedProtocols: readonly string[],
): boolean {
  try {
    return allowedProtocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const environmentProperties = {
  nodeEnv: {
    envNames: ["NODE_ENV"],
    schema: z.enum(["development", "test", "production"]).default("development"),
  },
  host: {
    envNames: ["HOST"],
    schema: z.string().trim().min(1).default("0.0.0.0"),
  },
  port: {
    envNames: ["PORT"],
    schema: z.coerce.number().int().min(1).max(65_535).default(3000),
  },
  axiosTimeout: {
    envNames: ["AXIOS_TIMEOUT"],
    schema: z.coerce.number().int().min(100).max(120_000).default(10_000),
  },
  logLevel: {
    envNames: ["LOG_LEVEL"],
    schema: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  },
  databaseUrl: {
    envNames: ["DATABASE_URL"],
    schema: z.string().url(),
  },
  redisUrl: {
    envNames: ["REDIS_URL"],
    schema: z
      .string()
      .url()
      .refine(
        (value) => hasProtocol(value, ["redis:", "rediss:"]),
        { message: "must use the redis:// or rediss:// protocol" },
      ),
  },
  encryptionSecret: {
    envNames: ["ENCRYPTION_SECRET"],
    schema: z
      .string()
      .min(32, "must contain at least 32 characters")
      .refine((value) => Buffer.byteLength(value, "utf8") >= 32, {
        message: "must contain at least 32 bytes when encoded as UTF-8",
      }),
  },
  slackSigningSecret: {
    envNames: ["SLACK_SIGNING_SECRET"],
    schema: z.string().trim().min(1),
  },
  slackClientId: {
    envNames: ["SLACK_CLIENT_ID"],
    schema: z.string().trim().min(1).optional(),
  },
  slackClientSecret: {
    envNames: ["SLACK_CLIENT_SECRET"],
    schema: z.string().trim().min(1).optional(),
  },
  slackRedirectUri: {
    envNames: ["SLACK_REDIRECT_URI"],
    schema: z
      .string()
      .url()
      .refine((value) => hasProtocol(value, ["https:", "http:"]))
      .optional(),
  },
  dashboardJwtSecret: {
    envNames: ["DASHBOARD_JWT_SECRET"],
    schema: z.string().min(32),
  },
  nextAuthSecret: {
    envNames: ["NEXTAUTH_SECRET", "AUTH_SECRET"],
    schema: z.string().min(32),
  },
  lemonSqueezyWebhookSecret: {
    envNames: ["LEMON_SQUEEZY_WEBHOOK_SECRET", "LEMONSQUEEZY_WEBHOOK_SECRET"],
    schema: z.string().trim().min(1),
  },
} as const;

export type Environment = {
  [Property in keyof typeof environmentProperties]: z.output<
    (typeof environmentProperties)[Property]["schema"]
  >;
};

const parsedProperties = new Map<keyof Environment, unknown>();

function getEnvironmentProperty(property: keyof Environment) {
  if (parsedProperties.has(property)) {
    return parsedProperties.get(property);
  }

  const definition = environmentProperties[property];
  const envName =
    definition.envNames.find((name) => Boolean(process.env[name]?.trim())) ??
    definition.envNames.find((name) => process.env[name] !== undefined) ??
    definition.envNames[0];
  const parsed = definition.schema.safeParse(process.env[envName]);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) =>
        issue.path.length > 0
          ? `${issue.path.join(".")}: ${issue.message}`
          : issue.message,
      )
      .join("; ");
    throw new Error(`Invalid environment configuration: ${envName}: ${details}`);
  }

  parsedProperties.set(property, parsed.data);
  return parsed.data;
}

export const env: Environment = new Proxy({} as Environment, {
  get(_target, property: string | symbol) {
    if (
      typeof property !== "string" ||
      !Object.prototype.hasOwnProperty.call(environmentProperties, property)
    ) {
      return undefined;
    }

    return getEnvironmentProperty(property as keyof Environment);
  },
});
