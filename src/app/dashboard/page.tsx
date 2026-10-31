"use client";

import dynamic from "next/dynamic";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { IncidentChartPoint } from "../../components/ui/incident-chart";
import { dashboardFetch, type DashboardSession } from "../../lib/dashboard-api";
import { useDashboardSession } from "../../lib/dashboard-session";

const IncidentChart = dynamic(
  () => import("../../components/ui/incident-chart"),
  {
    ssr: false,
    loading: () => (
      <div className="relative h-[260px] overflow-hidden rounded-xl border border-line/60 bg-surface/40">
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-ink/[0.03] to-transparent" />
      </div>
    ),
  },
);

type Timeframe = "24h" | "7d" | "30d";
type IncidentSeverity = "critical" | "warning" | "info";
type IncidentStatus = "triggered" | "acknowledged" | "resolved" | "silenced";

interface TimeframeMetrics {
  timeframe: Timeframe;
  periodStart: string;
  periodEnd: string;
  incidentCount: number;
  activeIncidentCount: number;
  meanTimeToAcknowledgeSeconds: number | null;
  meanTimeToResolveSeconds: number | null;
  estimatedUptimePercent: number;
  uptimeBasis: "estimated_from_incident_durations";
  uptimeTrend: Array<{
    timestamp: string;
    uptimePercent: number;
    outageSeconds: number;
  }>;
}

interface MetricsResponse {
  workspace: { id: string; name: string };
  metrics: {
    generatedAt: string;
    timeframes: Record<Timeframe, TimeframeMetrics>;
    stateDistribution: Array<{ status: IncidentStatus; count: number }>;
    severityDistribution: Array<{ severity: IncidentSeverity; count: number }>;
    monthlyUsage: {
      monthStart: string;
      receivedRequests: number;
      criticalGraceRequests: number;
      monthlyQuota: number;
    };
  };
}

interface IncidentRow {
  id: string;
  title: string;
  service: string | null;
  environment: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  rawPayload: unknown;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  silencedUntil: string | null;
  duplicateCount: number;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

interface IncidentsResponse {
  incidents: IncidentRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface DashboardState {
  metrics: MetricsResponse | null;
  incidents: IncidentRow[];
  incidentsTotal: number;
  loading: boolean;
  refreshing: boolean;
  error: string;
  lastUpdated: Date | null;
}

const INITIAL_STATE: DashboardState = {
  metrics: null,
  incidents: [],
  incidentsTotal: 0,
  loading: true,
  refreshing: false,
  error: "",
  lastUpdated: null,
};

function useAnimatedNumber(value: number | null, duration = 650): number {
  const [animated, setAnimated] = useState(value ?? 0);

  useEffect(() => {
    if (value === null) {
      setAnimated(0);
      return;
    }

    const startValue = animated;
    const delta = value - startValue;
    const startTime = performance.now();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || delta === 0) {
      setAnimated(value);
      return;
    }

    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setAnimated(startValue + delta * eased);
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
    // `animated` intentionally acts as the current start value when new data arrives.
  }, [value, duration]);

  return animated;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < 3_600) {
    const minutes = seconds / 60;
    return `${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)}m`;
  }
  const hours = seconds / 3_600;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Unknown time";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function severityClass(severity: IncidentSeverity): string {
  switch (severity) {
    case "critical":
      return "border-rose-500/25 bg-rose-500/10 text-rose-500";
    case "warning":
      return "border-amber-500/25 bg-amber-500/10 text-amber-500";
    case "info":
      return "border-cyan-500/25 bg-cyan-500/10 text-cyan-500";
  }
}

function statusClass(status: IncidentStatus): string {
  switch (status) {
    case "triggered":
      return "bg-rose-500/10 text-rose-500";
    case "acknowledged":
      return "bg-amber-500/10 text-amber-500";
    case "resolved":
      return "bg-emerald-500/10 text-emerald-500";
    case "silenced":
      return "bg-slate-500/10 text-muted";
  }
}

function buildChartData(
  incidents: IncidentRow[],
  timeframe: Timeframe,
  now: Date,
): IncidentChartPoint[] {
  const hours = timeframe === "24h" ? 24 : timeframe === "7d" ? 24 * 7 : 24 * 30;
  const bucketHours = timeframe === "24h" ? 1 : 24;
  const bucketCount = Math.ceil(hours / bucketHours);
  const bucketMilliseconds = bucketHours * 60 * 60 * 1_000;
  const firstBucket =
    Math.floor((now.getTime() - hours * 60 * 60 * 1_000) / bucketMilliseconds) *
    bucketMilliseconds;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const timestamp = new Date(firstBucket + index * bucketMilliseconds);
    return {
      timestamp: timestamp.toISOString(),
      label:
        timeframe === "24h"
          ? new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(timestamp)
          : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp),
      critical: 0,
      warning: 0,
      info: 0,
    };
  });

  for (const incident of incidents) {
    const incidentTime = new Date(incident.createdAt).getTime();
    const bucketIndex = Math.floor((incidentTime - firstBucket) / bucketMilliseconds);
    if (bucketIndex < 0 || bucketIndex >= buckets.length) {
      continue;
    }
    buckets[bucketIndex][incident.severity] += 1;
  }

  return buckets;
}

function MetricCard({
  label,
  value,
  suffix,
  detail,
  icon: Icon,
  accent,
  trend,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  detail: string;
  icon: typeof Clock3;
  accent: "violet" | "cyan" | "emerald" | "rose";
  trend?: "up" | "down";
}) {
  const animatedValue = useAnimatedNumber(value);
  const accentClasses = {
    violet: "bg-violet-500/10 text-violet-400 ring-violet-500/10",
    cyan: "bg-cyan-500/10 text-cyan-400 ring-cyan-500/10",
    emerald: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/10",
    rose: "bg-rose-500/10 text-rose-400 ring-rose-500/10",
  };

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-line/80 bg-surface/70 p-5 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-accent/25 hover:shadow-glow">
      <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-accent/5 blur-3xl transition group-hover:bg-accent/10" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted">{label}</p>
          <div className="mt-4 flex items-baseline gap-1.5">
            <span className="text-[30px] font-semibold tracking-tight tabular-nums text-ink">
              {value === null ? "—" : Math.round(animatedValue * 10) / 10}
            </span>
            {suffix ? <span className="text-xs font-medium text-muted">{suffix}</span> : null}
          </div>
          <p className="mt-2 text-[11px] text-muted">{detail}</p>
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-xl ring-1 ${accentClasses[accent]}`}>
          <Icon size={18} />
        </span>
      </div>
      {trend ? (
        <span className={`absolute bottom-5 right-5 inline-flex items-center gap-1 text-[10px] ${trend === "down" ? "text-emerald-500" : "text-amber-500"}`}>
          {trend === "down" ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}
          vs prior period
        </span>
      ) : null}
    </article>
  );
}

function IncidentTable({
  incidents,
  loading,
}: {
  incidents: IncidentRow[];
  loading: boolean;
}) {
  if (loading && incidents.length === 0) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-[58px] animate-pulse rounded-xl bg-ink/[0.035] dark:bg-white/[0.035]" />
        ))}
      </div>
    );
  }

  if (incidents.length === 0) {
    return (
      <div className="grid min-h-56 place-items-center px-6 text-center">
        <div>
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-line bg-canvas text-muted">
            <CheckCircle2 size={20} />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">All quiet on the signal front</p>
          <p className="mt-1 text-xs text-muted">Incidents will stream into this feed as they arrive.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[690px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line/70 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            <th className="px-5 py-3.5">Incident</th>
            <th className="px-4 py-3.5">Severity</th>
            <th className="px-4 py-3.5">Status</th>
            <th className="px-4 py-3.5">Environment</th>
            <th className="px-4 py-3.5">Received</th>
            <th className="px-4 py-3.5"><span className="sr-only">Open incident</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/50">
          {incidents.map((incident) => (
            <tr
              key={incident.id}
              className={`group transition-colors hover:bg-ink/[0.025] dark:hover:bg-white/[0.025] ${
                incident.severity === "critical" && incident.status !== "resolved"
                  ? "animate-breathe border-l-2 border-l-rose-500/50"
                  : "border-l-2 border-l-transparent"
              }`}
            >
              <td className="max-w-[340px] px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    incident.status === "resolved" ? "bg-emerald-500" : incident.severity === "critical" ? "bg-rose-500" : incident.severity === "warning" ? "bg-amber-400" : "bg-cyan-400"
                  }`} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink">{incident.title}</p>
                    <p className="mt-1 truncate text-[10px] text-muted">
                      {incident.service ?? "Webhook"} · {incident.duplicateCount > 0 ? `${incident.duplicateCount} duplicate${incident.duplicateCount === 1 ? "" : "s"}` : incident.id.slice(0, 8)}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3.5">
                <span className={`inline-flex rounded-md border px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${severityClass(incident.severity)}`}>
                  {incident.severity}
                </span>
              </td>
              <td className="px-4 py-3.5">
                <span className={`inline-flex rounded-md px-2 py-1 text-[9px] font-semibold capitalize ${statusClass(incident.status)}`}>
                  {incident.status}
                </span>
              </td>
              <td className="px-4 py-3.5 text-[11px] text-muted">{incident.environment ?? "—"}</td>
              <td className="whitespace-nowrap px-4 py-3.5 text-[11px] tabular-nums text-muted">
                {formatDate(incident.createdAt)}
              </td>
              <td className="px-4 py-3.5">
                <button
                  type="button"
                  title={`Open raw payload for ${incident.title}`}
                  onClick={() => {
                    window.alert(JSON.stringify(incident.rawPayload, null, 2));
                  }}
                  className="grid h-7 w-7 place-items-center rounded-lg text-muted opacity-0 transition hover:bg-accent/10 hover:text-accent group-hover:opacity-100 focus:opacity-100"
                  aria-label={`Inspect ${incident.title} payload`}
                >
                  <ExternalLink size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DashboardPage() {
  const { token, workspaceId, authenticated } = useDashboardSession();
  const [timeframe, setTimeframe] = useState<Timeframe>("24h");
  const [state, setState] = useState<DashboardState>(INITIAL_STATE);

  const refresh = useCallback(
    async (initial = false) => {
      if (!authenticated) {
        return;
      }
      setState((current) => ({
        ...current,
        loading: initial && !current.metrics,
        refreshing: !initial,
        error: "",
      }));

      const session: DashboardSession = { token, workspaceId };
      try {
        const [metrics, incidentResult] = await Promise.all([
          dashboardFetch<MetricsResponse>("/api/v1/dashboard/metrics", session),
          dashboardFetch<IncidentsResponse>(
            "/api/v1/dashboard/incidents?page=1&limit=100",
            session,
          ),
        ]);
        setState({
          metrics,
          incidents: incidentResult.incidents,
          incidentsTotal: incidentResult.pagination.total,
          loading: false,
          refreshing: false,
          error: "",
          lastUpdated: new Date(),
        });
      } catch (caught) {
        setState((current) => ({
          ...current,
          loading: false,
          refreshing: false,
          error:
            caught instanceof Error
              ? caught.message
              : "Dashboard data could not be loaded",
        }));
      }
    },
    [token, workspaceId, authenticated],
  );

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selectedMetrics = state.metrics?.metrics.timeframes[timeframe] ?? null;
  const chartData = useMemo(
    () => buildChartData(state.incidents, timeframe, new Date()),
    [state.incidents, timeframe],
  );

  const criticalCount =
    state.metrics?.metrics.severityDistribution.find((entry) => entry.severity === "critical")?.count ?? 0;
  const activeCount = selectedMetrics?.activeIncidentCount ?? 0;
  const uptime = selectedMetrics?.estimatedUptimePercent ?? null;

  return (
    <div className="space-y-7">
      <section className="animate-fade-in-up">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 text-[10px] font-medium text-emerald-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Operational overview
            </div>
            <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-ink sm:text-[34px]">
              Incident command
            </h1>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted">
              Your systems, signals, and response health — all in one live view.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-xl border border-line bg-surface/70 p-1">
              {(["24h", "7d", "30d"] as const).map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setTimeframe(range)}
                  aria-pressed={timeframe === range}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition ${
                    timeframe === range
                      ? "bg-ink text-canvas shadow-sm"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void refresh(false)}
              disabled={state.refreshing}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface/70 px-3 text-xs font-medium text-muted transition hover:border-accent/30 hover:text-ink disabled:opacity-60"
            >
              <RefreshCw size={13} className={state.refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
        {state.error ? (
          <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-500">
            <ShieldAlert className="mt-0.5 shrink-0" size={15} />
            <span>{state.error}</span>
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Mean time to acknowledge"
          value={selectedMetrics?.meanTimeToAcknowledgeSeconds ?? null}
          suffix={selectedMetrics?.meanTimeToAcknowledgeSeconds == null ? undefined : "sec"}
          detail={`Average over the last ${timeframe}`}
          icon={Clock3}
          accent="violet"
        />
        <MetricCard
          label="Mean time to resolve"
          value={selectedMetrics?.meanTimeToResolveSeconds ?? null}
          suffix={selectedMetrics?.meanTimeToResolveSeconds == null ? undefined : "sec"}
          detail={`Average over the last ${timeframe}`}
          icon={CheckCircle2}
          accent="cyan"
        />
        <MetricCard
          label="Estimated uptime"
          value={uptime}
          suffix={uptime === null ? undefined : "%"}
          detail="Estimated from incident durations"
          icon={Activity}
          accent="emerald"
        />
        <MetricCard
          label="Active incidents"
          value={state.metrics ? activeCount : null}
          detail={`${criticalCount} critical in the current month`}
          icon={Zap}
          accent={activeCount > 0 ? "rose" : "emerald"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.8fr)]">
        <article className="overflow-hidden rounded-2xl border border-line/80 bg-surface/70 p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-ink">Incident volume</h2>
                <span className="rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[9px] font-medium text-muted">
                  {timeframe}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                Recent incidents grouped by severity
              </p>
            </div>
            <div className="flex items-center gap-3">
              {[
                { label: "Critical", color: "bg-rose-500" },
                { label: "Warning", color: "bg-amber-400" },
                { label: "Info", color: "bg-cyan-400" },
              ].map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1.5 text-[10px] text-muted">
                  <span className={`h-1.5 w-1.5 rounded-full ${item.color}`} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>
          <IncidentChart data={chartData} loading={state.loading} />
          <p className="mt-3 text-[10px] leading-4 text-muted/80">
            Volume is built from the latest 100 incident records returned by the API; webhook request-volume history is not currently exposed by the backend.
          </p>
        </article>

        <article className="overflow-hidden rounded-2xl border border-line/80 bg-surface/70 p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Reliability trend</h2>
              <p className="mt-1 text-[11px] text-muted">Estimated availability · {timeframe}</p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500">
              <Activity size={17} />
            </span>
          </div>
          <div className="mt-7">
            <p className="text-[38px] font-semibold tracking-[-0.05em] tabular-nums text-ink">
              {uptime === null ? "—" : `${uptime.toFixed(2)}%`}
            </p>
            <p className="mt-1 text-[11px] text-muted">
              {selectedMetrics?.incidentCount ?? 0} incidents in this window
            </p>
          </div>
          <div className="mt-6 space-y-3">
            {selectedMetrics?.uptimeTrend.slice(-5).map((point) => (
              <div key={point.timestamp} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-[10px] tabular-nums text-muted">
                  {formatDate(point.timestamp)}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      point.uptimePercent < 99 ? "bg-amber-400" : "bg-emerald-500"
                    }`}
                    style={{ width: `${point.uptimePercent}%` }}
                  />
                </div>
                <span className="w-12 text-right text-[10px] font-medium tabular-nums text-ink">
                  {point.uptimePercent.toFixed(1)}%
                </span>
              </div>
            ))}
            {!selectedMetrics?.uptimeTrend.length ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[11px] text-muted">
                Reliability history will appear when metrics are available.
              </p>
            ) : null}
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-xl bg-canvas/70 px-3 py-2.5 text-[10px] leading-4 text-muted">
            <ShieldAlert size={13} className="shrink-0 text-amber-500" />
            An estimate from tracked critical and warning incident duration, not an external probe.
          </div>
        </article>
      </section>

      <section className="overflow-hidden rounded-2xl border border-line/80 bg-surface/70 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent">
              <Activity size={16} />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-surface bg-emerald-500" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">Incident stream</h2>
              <p className="mt-0.5 text-[10px] text-muted">
                Latest {state.incidents.length} of {state.incidentsTotal.toLocaleString()} incidents · refreshes every 15 seconds
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted">
            <Clock3 size={12} />
            {state.lastUpdated ? `Updated ${formatDate(state.lastUpdated.toISOString())}` : "Waiting for first sync"}
          </div>
        </div>
        <IncidentTable incidents={state.incidents} loading={state.loading} />
        <div className="flex items-center justify-between border-t border-line/70 px-5 py-3.5 sm:px-6">
          <span className="text-[10px] text-muted">
            Tenant-scoped stream · newest events first
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent">
            Live telemetry <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          </span>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-muted/80">
        <span>Workspace data is isolated by your authenticated API session.</span>
        <span className="inline-flex items-center gap-1.5">
          <RefreshCw size={11} /> Auto-refresh active
        </span>
      </div>
    </div>
  );
}
