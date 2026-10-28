import { createHash, randomUUID } from "node:crypto";
import {
  IncidentSeverity,
  IncidentStatus,
  IntegrationProvider,
  Prisma,
  type Incident,
  type IncidentRule,
} from "@prisma/client";

import {
  sendIncidentAlert,
  SlackApiError,
} from "../../integrations/slack";
import {
  getRedisClient,
  type JsonValue,
  type WebhookProcessingJob,
} from "../../utils/redis";
import { prisma } from "../../utils/prisma";

const INCIDENT_LOCK_TTL_SECONDS = 60;

type RuleOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "exists";

interface RuleCondition {
  path: string;
  operator: RuleOperator;
  value?: JsonValue;
}

interface RuleGroup {
  all?: RuleExpression[];
  any?: RuleExpression[];
}

type RuleExpression = RuleCondition | RuleGroup;

interface RuleActions {
  title?: string;
  service?: string;
  environment?: string;
  severity?: IncidentSeverity;
}

interface SlackChannelReference {
  channelId: string;
  messageTimestamp: string;
}

export class IncidentLockBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentLockBusyError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        return false;
      }
      continue;
    }
    if (Array.isArray(current)) {
      for (const entry of current) {
        pending.push(entry);
      }
      continue;
    }
    if (isRecord(current)) {
      for (const entry of Object.values(current)) {
        pending.push(entry);
      }
      continue;
    }
    return false;
  }
  return true;
}

function parseRuleExpression(value: unknown, depth = 0): RuleExpression | null {
  if (depth > 20 || !isRecord(value)) {
    return null;
  }

  if (Array.isArray(value.all) || Array.isArray(value.any)) {
    const all = Array.isArray(value.all)
      ? value.all.map((entry) => parseRuleExpression(entry, depth + 1))
      : undefined;
    const any = Array.isArray(value.any)
      ? value.any.map((entry) => parseRuleExpression(entry, depth + 1))
      : undefined;

    if (
      (all && all.some((entry) => entry === null)) ||
      (any && any.some((entry) => entry === null))
    ) {
      return null;
    }

    return {
      ...(all ? { all: all as RuleExpression[] } : {}),
      ...(any ? { any: any as RuleExpression[] } : {}),
    };
  }

  const { path, operator, value: operand } = value;
  const validOperators: RuleOperator[] = [
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "exists",
  ];

  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > 512 ||
    typeof operator !== "string" ||
    !validOperators.includes(operator as RuleOperator) ||
    (operator !== "exists" && !isJsonValue(operand))
  ) {
    return null;
  }

  return {
    path,
    operator: operator as RuleOperator,
    ...(operator === "exists" ? {} : { value: operand as JsonValue }),
  };
}

function getPathValue(payload: JsonValue, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = payload;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function compareValues(
  actual: JsonValue | undefined,
  operator: RuleOperator,
  expected: JsonValue | undefined,
): boolean {
  switch (operator) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "eq":
      return JSON.stringify(actual) === JSON.stringify(expected);
    case "neq":
      return JSON.stringify(actual) !== JSON.stringify(expected);
    case "gt":
      return typeof actual === "number" &&
        typeof expected === "number" &&
        actual > expected;
    case "gte":
      return typeof actual === "number" &&
        typeof expected === "number" &&
        actual >= expected;
    case "lt":
      return typeof actual === "number" &&
        typeof expected === "number" &&
        actual < expected;
    case "lte":
      return typeof actual === "number" &&
        typeof expected === "number" &&
        actual <= expected;
    case "contains":
      if (typeof actual === "string" && typeof expected === "string") {
        return actual.includes(expected);
      }
      if (Array.isArray(actual)) {
        return actual.some((entry) => JSON.stringify(entry) === JSON.stringify(expected));
      }
      return false;
  }
}

function matchesExpression(
  expression: RuleExpression,
  payload: JsonValue,
): boolean {
  if ("path" in expression) {
    return compareValues(
      getPathValue(payload, expression.path),
      expression.operator,
      expression.value,
    );
  }

  if (expression.all) {
    return expression.all.every((entry) => matchesExpression(entry, payload));
  }
  if (expression.any) {
    return expression.any.some((entry) => matchesExpression(entry, payload));
  }
  return false;
}

function parseRuleActions(actions: Prisma.JsonValue): RuleActions {
  if (!isRecord(actions)) {
    return {};
  }
  const severity = actions.severity;
  return {
    ...(typeof actions.title === "string" ? { title: actions.title } : {}),
    ...(typeof actions.service === "string" ? { service: actions.service } : {}),
    ...(typeof actions.environment === "string"
      ? { environment: actions.environment }
      : {}),
    ...(typeof severity === "string" &&
    Object.values(IncidentSeverity).includes(severity as IncidentSeverity)
      ? { severity: severity as IncidentSeverity }
      : {}),
  };
}

function firstString(payload: JsonValue, paths: string[]): string | null {
  for (const path of paths) {
    const value = getPathValue(payload, path);
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 500);
    }
  }
  return null;
}

function deriveIncidentFields(
  rule: IncidentRule,
  payload: JsonValue,
): { title: string; service: string | null; environment: string | null; severity: IncidentSeverity } {
  const actions = parseRuleActions(rule.actions);
  const payloadSeverity = getPathValue(payload, "severity");
  return {
    title:
      actions.title?.trim().slice(0, 500) ||
      firstString(payload, ["title", "message", "error.message", "event.message"]) ||
      `Incident from webhook ${rule.name}`,
    service:
      actions.service?.trim().slice(0, 255) ||
      firstString(payload, ["service", "service_name", "project", "project.name"]),
    environment:
      actions.environment?.trim().slice(0, 100) ||
      firstString(payload, ["environment", "env", "deployment.environment"]),
    severity:
      rule.severity ??
      actions.severity ??
      (payloadSeverity === "warning" || payloadSeverity === "info"
        ? payloadSeverity
        : "critical"),
  };
}

function getIncidentFingerprint(
  job: WebhookProcessingJob,
  ruleId: string,
  fields: ReturnType<typeof deriveIncidentFields>,
): string {
  const receivedAt = new Date(job.receivedAt);
  if (!Number.isFinite(receivedAt.getTime())) {
    throw new Error(`Webhook job ${job.eventId} has an invalid receivedAt timestamp`);
  }
  const utcDay = receivedAt.toISOString().slice(0, 10);
  return createHash("sha256")
    .update(job.endpointId)
    .update("\0")
    .update(ruleId)
    .update("\0")
    .update(fields.title.toLowerCase())
    .update("\0")
    .update(fields.service?.toLowerCase() ?? "")
    .update("\0")
    .update(fields.environment?.toLowerCase() ?? "")
    .update("\0")
    .update(utcDay)
    .digest("hex");
}

async function releaseOwnedLock(key: string, token: string): Promise<void> {
  const compareAndDelete = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;
  await getRedisClient().eval(compareAndDelete, 1, key, token);
}

async function resolveIncident(
  job: WebhookProcessingJob,
  rule: IncidentRule,
  fields: ReturnType<typeof deriveIncidentFields>,
): Promise<{ incident: Incident; isDuplicate: boolean }> {
  const fingerprint = getIncidentFingerprint(job, rule.id, fields);
  const lockKey = `incident:processing:${job.workspaceId}:${fingerprint}`;
  const lockToken = randomUUID();

  const recordDuplicate = async (existing: Incident): Promise<void> => {
    await prisma.$transaction([
      prisma.incident.update({
        where: { id: existing.id },
        data: {
          duplicateCount: { increment: 1 },
          lastSeenAt: new Date(job.receivedAt),
        },
      }),
      prisma.auditLog.create({
        data: {
          workspaceId: job.workspaceId,
          inboundWebhookId: job.endpointId,
          incidentId: existing.id,
          action: "duplicate_incident_suppressed",
          resourceType: "incident",
          resourceId: existing.id,
          metadata: {
            fingerprint,
            sourceEventId: job.eventId,
          },
        },
      }),
    ]);
  };

  const findExisting = (): Promise<Incident | null> =>
    prisma.incident.findFirst({
      where: {
        workspaceId: job.workspaceId,
        idempotencyKey: fingerprint,
      },
    });

  const alreadyCreated = await findExisting();
  if (alreadyCreated) {
    await recordDuplicate(alreadyCreated);
    return { incident: alreadyCreated, isDuplicate: true };
  }

  const acquired = await getRedisClient().set(
    lockKey,
    lockToken,
    "EX",
    INCIDENT_LOCK_TTL_SECONDS,
    "NX",
  );
  if (acquired !== "OK") {
    const concurrentResult = await findExisting();
    if (!concurrentResult) {
      throw new IncidentLockBusyError(
        `Fingerprint ${fingerprint} is being processed by another request`,
      );
    }
    await recordDuplicate(concurrentResult);
    return { incident: concurrentResult, isDuplicate: true };
  }

  try {
    const createdByAnotherJob = await findExisting();
    if (createdByAnotherJob) {
      await recordDuplicate(createdByAnotherJob);
      return { incident: createdByAnotherJob, isDuplicate: true };
    }

    const incident = await prisma.$transaction(async (transaction) => {
      const created = await transaction.incident.create({
        data: {
          workspaceId: job.workspaceId,
          inboundWebhookId: job.endpointId,
          incidentRuleId: rule.id,
          idempotencyKey: fingerprint,
          title: fields.title,
          service: fields.service,
          environment: fields.environment,
          severity: fields.severity,
          status: IncidentStatus.triggered,
          rawPayload: job.payload as Prisma.InputJsonValue,
        },
      });

      await transaction.auditLog.create({
        data: {
          workspaceId: job.workspaceId,
          inboundWebhookId: job.endpointId,
          incidentId: created.id,
          action: "incident_triggered",
          resourceType: "incident",
          resourceId: created.id,
          metadata: {
            ruleId: rule.id,
            eventId: job.eventId,
            fingerprint,
          },
        },
      });

      return created;
    });

    return { incident, isDuplicate: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await findExisting();
      if (existing) {
        return { incident: existing, isDuplicate: true };
      }
    }
    throw error;
  } finally {
    try {
      await releaseOwnedLock(lockKey, lockToken);
    } catch (releaseError) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "incident_lock_release_failed",
          workspaceId: job.workspaceId,
          message:
            releaseError instanceof Error ? releaseError.message : "unknown error",
        }),
      );
    }
  }
}

async function getSlackReference(
  incidentId: string,
  integrationId: string,
): Promise<SlackChannelReference | null> {
  const audit = await prisma.auditLog.findFirst({
    where: {
      incidentId,
      action: "integration_dispatched",
      resourceType: "integration",
      resourceId: integrationId,
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  if (!audit || !isRecord(audit.metadata)) {
    return null;
  }
  const { channelId, messageTimestamp } = audit.metadata;
  return typeof channelId === "string" && typeof messageTimestamp === "string"
    ? { channelId, messageTimestamp }
    : null;
}

async function dispatchSlack(
  job: WebhookProcessingJob,
  incident: Incident,
): Promise<void> {
  const integrations = await prisma.integration.findMany({
    where: {
      workspaceId: job.workspaceId,
      provider: IntegrationProvider.slack,
      isEnabled: true,
    },
  });

  for (const integration of integrations) {
    if (await getSlackReference(incident.id, integration.id)) {
      continue;
    }

    try {
      const reference = await sendIncidentAlert(integration, incident);
      await prisma.auditLog.create({
        data: {
          workspaceId: job.workspaceId,
          inboundWebhookId: job.endpointId,
          incidentId: incident.id,
          action: "integration_dispatched",
          resourceType: "integration",
          resourceId: integration.id,
          metadata: {
            provider: "slack",
            channelId: reference.channelId,
            messageTimestamp: reference.messageTimestamp,
          },
        },
      });
      console.info(
        JSON.stringify({
          level: "info",
          event: "slack_incident_dispatched",
          incidentId: incident.id,
          integrationId: integration.id,
        }),
      );
    } catch (error) {
      const retryable = !(error instanceof SlackApiError) || error.retryable;
      console.error(
        JSON.stringify({
          level: retryable ? "error" : "warn",
          event: "slack_incident_dispatch_failed",
          incidentId: incident.id,
          integrationId: integration.id,
          retryable,
          message: error instanceof Error ? error.message : "unknown error",
        }),
      );

      if (!retryable) {
        await prisma.auditLog.create({
          data: {
            workspaceId: job.workspaceId,
            inboundWebhookId: job.endpointId,
            incidentId: incident.id,
            action: "integration_dispatch_failed",
            resourceType: "integration",
            resourceId: integration.id,
            metadata: {
              provider: "slack",
              retryable: false,
              reason: error instanceof Error ? error.message.slice(0, 1_000) : "unknown",
            },
          },
        });
        continue;
      }
      throw error;
    }
  }
}

export async function processWebhookInline(
  job: WebhookProcessingJob,
): Promise<void> {
  const payload = job.payload;
  if (!isJsonValue(payload)) {
    throw new Error(`Webhook event ${job.eventId} contains invalid JSON data`);
  }

  const rules = await prisma.incidentRule.findMany({
    where: {
      workspaceId: job.workspaceId,
      isEnabled: true,
      OR: [{ inboundWebhookId: null }, { inboundWebhookId: job.endpointId }],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  let selected:
    | { rule: IncidentRule; fields: ReturnType<typeof deriveIncidentFields> }
    | undefined;

  for (const rule of rules) {
    const expression = parseRuleExpression(rule.conditions);
    if (!expression) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "incident_rule_invalid",
          ruleId: rule.id,
          workspaceId: job.workspaceId,
        }),
      );
      continue;
    }
    if (matchesExpression(expression, payload)) {
      selected = { rule, fields: deriveIncidentFields(rule, payload) };
      break;
    }
  }

  if (!selected) {
    console.info(
      JSON.stringify({
        level: "info",
        event: "webhook_no_incident_rule_matched",
        eventId: job.eventId,
        workspaceId: job.workspaceId,
        endpointId: job.endpointId,
      }),
    );
    return;
  }

  const { incident, isDuplicate } = await resolveIncident(
    job,
    selected.rule,
    selected.fields,
  );

  if (isDuplicate) {
    console.info(
      JSON.stringify({
        level: "info",
        event: "duplicate_incident_suppressed",
        incidentId: incident.id,
        eventId: job.eventId,
      }),
    );
  }

  await dispatchSlack(job, incident);
}
