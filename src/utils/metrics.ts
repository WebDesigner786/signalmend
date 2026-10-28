import { IncidentSeverity, IncidentStatus, Prisma } from "@prisma/client";

import { prisma } from "./prisma";

export type MetricsTimeframe = "24h" | "7d" | "30d";

export interface UptimeTrendPoint {
  timestamp: string;
  uptimePercent: number;
  outageSeconds: number;
}

export interface TimeframeMetrics {
  timeframe: MetricsTimeframe;
  periodStart: string;
  periodEnd: string;
  incidentCount: number;
  activeIncidentCount: number;
  meanTimeToAcknowledgeSeconds: number | null;
  meanTimeToResolveSeconds: number | null;
  estimatedUptimePercent: number;
  uptimeBasis: "estimated_from_incident_durations";
  uptimeTrend: UptimeTrendPoint[];
}

export interface WorkspaceMetrics {
  generatedAt: string;
  timeframes: Record<MetricsTimeframe, TimeframeMetrics>;
  stateDistribution: Array<{ status: IncidentStatus; count: number }>;
  severityDistribution: Array<{ severity: IncidentSeverity; count: number }>;
  monthlyUsage: {
    monthStart: string;
    receivedRequests: number;
    criticalGraceRequests: number;
    monthlyQuota: number;
  };
}

interface DurationAggregate {
  mean_ack_seconds: number | null;
  mean_resolve_seconds: number | null;
}

interface TrendAggregate {
  bucket_start: Date;
  bucket_end: Date;
  outage_seconds: number | null;
}

interface CountAggregate {
  count: bigint;
  status: IncidentStatus;
}

interface SeverityCountAggregate {
  count: bigint;
  severity: IncidentSeverity;
}

interface TimeframeConfiguration {
  hours: number;
  bucketHours: number;
}

const TIMEFRAMES: Record<MetricsTimeframe, TimeframeConfiguration> = {
  "24h": { hours: 24, bucketHours: 1 },
  "7d": { hours: 24 * 7, bucketHours: 24 },
  "30d": { hours: 24 * 30, bucketHours: 24 },
};

function asCount(value: bigint | number): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Database returned an invalid incident count");
  }
  return count;
}

function asNonNegativeSeconds(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Database returned an invalid incident duration metric");
  }
  return Math.round(value * 100) / 100;
}

async function getTimeframeMetrics(
  workspaceId: string,
  timeframe: MetricsTimeframe,
  now: Date,
): Promise<TimeframeMetrics> {
  const configuration = TIMEFRAMES[timeframe];
  const periodStart = new Date(now.getTime() - configuration.hours * 60 * 60 * 1_000);
  const durationRows = await prisma.$queryRaw<DurationAggregate[]>(Prisma.sql`
    SELECT
      AVG(EXTRACT(EPOCH FROM (acknowledged_at - created_at)))
        FILTER (
          WHERE acknowledged_at IS NOT NULL
            AND acknowledged_at >= created_at
            AND acknowledged_at <= ${now}
        )::double precision
        AS mean_ack_seconds,
      AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)))
        FILTER (
          WHERE resolved_at IS NOT NULL
            AND resolved_at >= created_at
            AND resolved_at <= ${now}
        )::double precision
        AS mean_resolve_seconds
    FROM incidents
    WHERE workspace_id = ${workspaceId}::uuid
      AND created_at >= ${periodStart}
      AND created_at < ${now}
  `);

  const countRows = await prisma.incident.groupBy({
    by: ["status"],
    where: {
      workspaceId,
      createdAt: { gte: periodStart, lt: now },
    },
    _count: { _all: true },
  });
  const incidentCount = countRows.reduce(
    (total, row) => total + asCount(row._count._all),
    0,
  );
  const activeStatuses = new Set<IncidentStatus>([
    IncidentStatus.triggered,
    IncidentStatus.acknowledged,
    IncidentStatus.silenced,
  ]);
  const activeIncidentCount = countRows
    .filter((row) => activeStatuses.has(row.status))
    .reduce((total, row) => total + asCount(row._count._all), 0);

  const trendRows = await prisma.$queryRaw<TrendAggregate[]>(Prisma.sql`
    WITH bounds AS (
      SELECT ${periodStart}::timestamptz AS starts_at,
             ${now}::timestamptz AS ends_at,
             ${configuration.bucketHours}::integer AS bucket_hours
    ),
    buckets AS (
      SELECT bucket_start,
             LEAST(
               bucket_start + make_interval(hours => bounds.bucket_hours),
               bounds.ends_at
             ) AS bucket_end
      FROM bounds
      CROSS JOIN LATERAL generate_series(
        bounds.starts_at,
        bounds.ends_at,
        make_interval(hours => bounds.bucket_hours)
      ) AS bucket_start
      WHERE bucket_start < bounds.ends_at
    ),
    clipped_incidents AS (
      SELECT buckets.bucket_start,
             GREATEST(incidents.created_at, buckets.bucket_start) AS outage_start,
             LEAST(COALESCE(incidents.resolved_at, ${now}::timestamptz), buckets.bucket_end) AS outage_end
      FROM buckets
      JOIN incidents
        ON incidents.workspace_id = ${workspaceId}::uuid
       AND incidents.severity IN ('critical', 'warning')
       AND incidents.created_at < buckets.bucket_end
       AND COALESCE(incidents.resolved_at, ${now}::timestamptz) > buckets.bucket_start
    ),
    ordered_intervals AS (
      SELECT bucket_start,
             outage_start,
             outage_end,
             MAX(outage_end) OVER (
               PARTITION BY bucket_start
               ORDER BY outage_start, outage_end
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ) AS prior_max_end
      FROM clipped_incidents
      WHERE outage_end > outage_start
    ),
    marked_intervals AS (
      SELECT bucket_start,
             outage_start,
             outage_end,
             SUM(
               CASE WHEN prior_max_end IS NULL OR outage_start > prior_max_end
                    THEN 1 ELSE 0 END
             ) OVER (
               PARTITION BY bucket_start
               ORDER BY outage_start, outage_end
             ) AS interval_group
      FROM ordered_intervals
    ),
    merged_intervals AS (
      SELECT bucket_start,
             interval_group,
             MIN(outage_start) AS outage_start,
             MAX(outage_end) AS outage_end
      FROM marked_intervals
      GROUP BY bucket_start, interval_group
    ),
    outage_totals AS (
      SELECT bucket_start,
             SUM(EXTRACT(EPOCH FROM (outage_end - outage_start)))::double precision AS outage_seconds
      FROM merged_intervals
      GROUP BY bucket_start
    )
    SELECT buckets.bucket_start,
           buckets.bucket_end,
           COALESCE(outage_totals.outage_seconds, 0)::double precision AS outage_seconds
    FROM buckets
    LEFT JOIN outage_totals USING (bucket_start)
    ORDER BY buckets.bucket_start
  `);

  const windowSeconds = configuration.hours * 60 * 60;
  const outageSeconds = trendRows.reduce((total, row) => {
    const outage = Number(row.outage_seconds ?? 0);
    if (!Number.isFinite(outage) || outage < 0) {
      throw new Error("Database returned invalid uptime trend data");
    }
    return total + outage;
  }, 0);
  const estimatedUptimePercent =
    Math.round(
      Math.max(0, Math.min(100, (1 - outageSeconds / windowSeconds) * 100)) * 100,
    ) / 100;
  const uptimeTrend = trendRows.map((row) => {
    const bucketDuration =
      (row.bucket_end.getTime() - row.bucket_start.getTime()) / 1_000;
    const outage = Math.min(bucketDuration, Number(row.outage_seconds ?? 0));
    return {
      timestamp: row.bucket_start.toISOString(),
      uptimePercent:
        Math.round(
          Math.max(0, Math.min(100, (1 - outage / bucketDuration) * 100)) * 100,
        ) / 100,
      outageSeconds: Math.round(outage * 100) / 100,
    };
  });

  return {
    timeframe,
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
    incidentCount,
    activeIncidentCount,
    meanTimeToAcknowledgeSeconds: asNonNegativeSeconds(
      durationRows[0]?.mean_ack_seconds ?? null,
    ),
    meanTimeToResolveSeconds: asNonNegativeSeconds(
      durationRows[0]?.mean_resolve_seconds ?? null,
    ),
    estimatedUptimePercent,
    uptimeBasis: "estimated_from_incident_durations",
    uptimeTrend,
  };
}

function monthlyQuotaForTier(
  tier: "free" | "pro" | "enterprise",
): number {
  switch (tier) {
    case "free":
      return 1_000;
    case "pro":
      return 50_000;
    case "enterprise":
      return 500_000;
  }
}

export async function getWorkspaceMetrics(
  workspaceId: string,
  tier: "free" | "pro" | "enterprise",
  now = new Date(),
): Promise<WorkspaceMetrics> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [day, week, month, statusGroups, severityGroups, usage] =
    await Promise.all([
      getTimeframeMetrics(workspaceId, "24h", now),
      getTimeframeMetrics(workspaceId, "7d", now),
      getTimeframeMetrics(workspaceId, "30d", now),
      prisma.$queryRaw<CountAggregate[]>(Prisma.sql`
        SELECT status, COUNT(*)::bigint AS count
        FROM incidents
        WHERE workspace_id = ${workspaceId}::uuid
          AND created_at >= ${monthStart}
        GROUP BY status
      `),
      prisma.$queryRaw<SeverityCountAggregate[]>(Prisma.sql`
        SELECT severity, COUNT(*)::bigint AS count
        FROM incidents
        WHERE workspace_id = ${workspaceId}::uuid
          AND created_at >= ${monthStart}
        GROUP BY severity
      `),
      prisma.workspaceUsage.findUnique({
        where: {
          workspaceId_monthStart: { workspaceId, monthStart },
        },
        select: {
          receivedRequests: true,
          criticalGraceRequests: true,
        },
      }),
    ]);

  return {
    generatedAt: now.toISOString(),
    timeframes: { "24h": day, "7d": week, "30d": month },
    stateDistribution: statusGroups.map((row) => ({
      status: row.status,
      count: asCount(row.count),
    })),
    severityDistribution: severityGroups.map((row) => ({
      severity: row.severity,
      count: asCount(row.count),
    })),
    monthlyUsage: {
      monthStart: monthStart.toISOString(),
      receivedRequests: usage?.receivedRequests ?? 0,
      criticalGraceRequests: usage?.criticalGraceRequests ?? 0,
      monthlyQuota: monthlyQuotaForTier(tier),
    },
  };
}
