"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface IncidentChartPoint {
  label: string;
  timestamp: string;
  critical: number;
  warning: number;
  info: number;
}

interface IncidentChartProps {
  data: IncidentChartPoint[];
  loading?: boolean;
}

const SERIES = [
  { key: "critical", label: "Critical", color: "#f05252" },
  { key: "warning", label: "Warning", color: "#f5a524" },
  { key: "info", label: "Info", color: "#22d3ee" },
] as const;

function ChartSkeleton() {
  return (
    <div
      aria-label="Loading incident chart"
      className="relative h-[260px] overflow-hidden rounded-xl border border-line/60 bg-surface/40"
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      <div className="absolute inset-x-7 bottom-8 top-8 flex items-end gap-3">
        {[35, 57, 43, 76, 52, 88, 61, 71, 48, 82, 56, 68].map(
          (height, index) => (
            <div
              key={index}
              className="w-full rounded-t-md bg-slate-400/10"
              style={{ height: `${height}%` }}
            />
          ),
        )}
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="min-w-36 rounded-xl border border-line bg-surface/95 p-3 shadow-2xl backdrop-blur-xl">
      <p className="mb-2 text-xs font-medium text-muted">{label}</p>
      <div className="space-y-1.5">
        {SERIES.map((series) => {
          const value =
            payload.find((entry) => entry.dataKey === series.key)?.value ?? 0;
          return (
            <div
              key={series.key}
              className="flex items-center justify-between gap-5 text-xs"
            >
              <span className="flex items-center gap-2 text-muted">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: series.color }}
                />
                {series.label}
              </span>
              <span className="font-semibold tabular-nums text-ink">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function IncidentChart({
  data,
  loading = false,
}: IncidentChartProps) {
  if (loading) {
    return <ChartSkeleton />;
  }

  if (data.length === 0) {
    return (
      <div className="grid h-[260px] place-items-center rounded-xl border border-dashed border-line bg-surface/30 px-6 text-center">
        <div>
          <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-muted">
            <span className="text-sm font-semibold">—</span>
          </div>
          <p className="text-sm font-medium text-ink">No incident activity yet</p>
          <p className="mt-1 max-w-xs text-xs leading-5 text-muted">
            Incoming incidents will appear here as your rules begin routing events.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[260px] w-full animate-fade-in-up">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 12, right: 4, left: -20, bottom: 0 }}
        >
          <defs>
            {SERIES.map((series) => (
              <linearGradient
                key={series.key}
                id={`gradient-${series.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={series.color} stopOpacity={0.28} />
                <stop offset="95%" stopColor={series.color} stopOpacity={0.01} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="rgb(var(--line) / 0.72)"
            strokeDasharray="3 5"
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
            tickMargin={12}
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
            tickMargin={8}
          />
          <Tooltip content={<ChartTooltip />} />
          {SERIES.map((series) => (
            <Area
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.label}
              stackId="volume"
              stroke={series.color}
              strokeWidth={2}
              fill={`url(#gradient-${series.key})`}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive
              animationDuration={700}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
