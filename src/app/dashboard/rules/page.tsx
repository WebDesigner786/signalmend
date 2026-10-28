"use client";

import {
  ArrowDown,
  ArrowRight,
  Braces,
  Check,
  ChevronDown,
  CircleHelp,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { dashboardFetch } from "../../../lib/dashboard-api";
import { useDashboardSession } from "../../../lib/dashboard-session";

type RuleOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "exists";
type RuleField = "severity" | "http_status" | "service" | "environment" | "error.message";
type DeliveryProvider = "slack" | "discord";

interface ConditionRow {
  id: string;
  path: RuleField;
  operator: RuleOperator;
  value: string;
}

interface IncidentRule {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  priority: number;
  conditions: unknown;
  actions: unknown;
  severity: string | null;
  createdAt: string;
}

interface RulesResponse {
  rules: IncidentRule[];
}

interface RuleForm {
  name: string;
  title: string;
  severity: "critical" | "warning" | "info";
  match: "all" | "any";
  conditions: ConditionRow[];
  provider: DeliveryProvider;
  target: string;
}

const FIELD_LABELS: Record<RuleField, string> = {
  severity: "Severity",
  http_status: "HTTP status",
  service: "Service",
  environment: "Environment",
  "error.message": "Error message",
};

const OPERATOR_LABELS: Record<RuleOperator, string> = {
  eq: "equals",
  neq: "does not equal",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  contains: "contains",
  exists: "exists",
};

const EMPTY_FORM: RuleForm = {
  name: "",
  title: "",
  severity: "critical",
  match: "all",
  conditions: [
    { id: "condition-1", path: "severity", operator: "eq", value: "error" },
  ],
  provider: "slack",
  target: "",
};

function isRule(value: unknown): value is IncidentRule {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.isEnabled === "boolean" &&
    typeof record.priority === "number" &&
    typeof record.createdAt === "string" &&
    "conditions" in record &&
    "actions" in record
  );
}

function parseRuleConditions(form: RuleForm): Array<{ path: string; operator: RuleOperator; value?: string | number }> {
  return form.conditions.map((condition) => {
    if (condition.operator === "exists") {
      return { path: condition.path, operator: condition.operator };
    }
    if (condition.path === "http_status") {
      return {
        path: condition.path,
        operator: condition.operator,
        value: Number(condition.value),
      };
    }
    return {
      path: condition.path,
      operator: condition.operator,
      value: condition.value.trim(),
    };
  });
}

function validateTarget(provider: DeliveryProvider, target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    return "A notification destination is required.";
  }
  if (provider === "slack") {
    return /^#?[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(trimmed)
      ? ""
      : "Enter a Slack channel name such as #war-room.";
  }
  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "discord.com" ||
      !/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)
    ) {
      return "Enter a valid HTTPS Discord webhook URL.";
    }
    return "";
  } catch {
    return "Enter a valid HTTPS Discord webhook URL.";
  }
}

function formatRule(rule: IncidentRule): string {
  const conditions = rule.conditions;
  if (typeof conditions !== "object" || conditions === null) {
    return "Condition format unavailable";
  }
  const record = conditions as Record<string, unknown>;
  const entries = Array.isArray(record.all)
    ? record.all
    : Array.isArray(record.any)
      ? record.any
      : [];
  if (entries.length === 0) {
    return "No conditions configured";
  }
  return entries
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return "Invalid condition";
      }
      const item = entry as Record<string, unknown>;
      const path = typeof item.path === "string" ? item.path : "field";
      const operator =
        typeof item.operator === "string" && item.operator in OPERATOR_LABELS
          ? OPERATOR_LABELS[item.operator as RuleOperator]
          : "matches";
      const value = item.value === undefined ? "" : ` “${String(item.value)}”`;
      return `${path} ${operator}${value}`;
    })
    .join(Array.isArray(record.any) ? " OR " : " AND ");
}

export default function RulesPage() {
  const { token, workspaceId } = useDashboardSession();
  const [rules, setRules] = useState<IncidentRule[]>([]);
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const targetError = useMemo(
    () => validateTarget(form.provider, form.target),
    [form.provider, form.target],
  );

  const refresh = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const response = await dashboardFetch<RulesResponse>(
        "/api/v1/incident-rules",
        { token, workspaceId },
      );
      if (!response || !Array.isArray(response.rules) || !response.rules.every(isRule)) {
        throw new Error("Incident rule API returned an invalid response");
      }
      setRules(response.rules);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Incident rules could not be loaded",
      );
    } finally {
      setLoading(false);
    }
  }, [token, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addCondition = () => {
    setForm((current) => ({
      ...current,
      conditions: [
        ...current.conditions,
        {
          id: `condition-${crypto.randomUUID()}`,
          path: "http_status",
          operator: "gt",
          value: "500",
        },
      ],
    }));
  };

  const updateCondition = (
    id: string,
    patch: Partial<Omit<ConditionRow, "id">>,
  ) => {
    setForm((current) => ({
      ...current,
      conditions: current.conditions.map((condition) =>
        condition.id === id ? { ...condition, ...patch } : condition,
      ),
    }));
  };

  const removeCondition = (id: string) => {
    setForm((current) => ({
      ...current,
      conditions:
        current.conditions.length <= 1
          ? current.conditions
          : current.conditions.filter((condition) => condition.id !== id),
    }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    const title = form.title.trim();
    if (name.length < 2 || name.length > 255) {
      setError("Rule names must be between 2 and 255 characters.");
      return;
    }
    if (form.conditions.some((condition) =>
      condition.operator !== "exists" &&
      (!condition.value.trim() ||
        (condition.path === "http_status" && !Number.isFinite(Number(condition.value)))),
    )) {
      setError("Complete each condition and use a numeric value for HTTP status.");
      return;
    }
    if (targetError) {
      setError(targetError);
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const conditions = parseRuleConditions(form);
      const response = await dashboardFetch<{ rule: IncidentRule }>(
        "/api/v1/incident-rules",
        { token, workspaceId },
        {
          method: "POST",
          body: JSON.stringify({
            name,
            priority: 100,
            isEnabled: true,
            conditions: { [form.match]: conditions },
            severity: form.severity,
            actions: {
              title: title || undefined,
              severity: form.severity,
              delivery: {
                provider: form.provider,
                target: form.target.trim(),
              },
            },
          }),
        },
      );
      if (!response || !isRule(response.rule)) {
        throw new Error("Incident rule API returned an invalid response");
      }
      setRules((current) => [response.rule, ...current]);
      setForm(EMPTY_FORM);
      setSuccess("Rule saved. The worker will evaluate it against new webhook payloads.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Incident rule could not be saved",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-7">
      <header className="animate-fade-in-up">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/5 px-2.5 py-1 text-[10px] font-medium text-violet-400">
          <Workflow size={12} /> Automation engine
        </div>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-ink sm:text-[34px]">
              Incident rules
            </h1>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted">
              Turn noisy provider events into deterministic, actionable incident signals.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface/70 px-3 py-2 text-xs text-muted">
            <Route size={14} className="text-accent" />
            <span className="font-semibold tabular-nums text-ink">{rules.length}</span>
            configured rules
          </div>
        </div>
      </header>

      {error ? (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs leading-5 text-rose-500">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button>
        </div>
      ) : null}
      {success ? (
        <div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs leading-5 text-emerald-500">
          {success}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(290px,0.65fr)]">
        <article className="rounded-2xl border border-line/80 bg-surface/70 p-5 shadow-sm sm:p-6">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/10 text-violet-400">
              <Braces size={17} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">Build a trigger rule</h2>
              <p className="mt-0.5 text-[11px] text-muted">Conditions are evaluated in priority order.</p>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="rule-name" className="mb-1.5 block text-[11px] font-medium text-muted">Rule name</label>
                <input
                  id="rule-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Critical API errors"
                  maxLength={255}
                  required
                  className="w-full rounded-xl border border-line bg-canvas/70 px-3.5 py-2.5 text-xs text-ink placeholder:text-muted/70"
                />
              </div>
              <div>
                <label htmlFor="incident-title" className="mb-1.5 block text-[11px] font-medium text-muted">Incident title template</label>
                <input
                  id="incident-title"
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Production API error"
                  maxLength={500}
                  className="w-full rounded-xl border border-line bg-canvas/70 px-3.5 py-2.5 text-xs text-ink placeholder:text-muted/70"
                />
              </div>
            </div>

            <div className="rounded-xl border border-line/80 bg-canvas/40 p-3.5 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-ink">Match conditions</p>
                  <p className="mt-0.5 text-[10px] text-muted">Choose whether every row or any row must match.</p>
                </div>
                <div className="flex rounded-lg border border-line bg-surface p-0.5">
                  {(["all", "any"] as const).map((match) => (
                    <button
                      key={match}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, match }))}
                      aria-pressed={form.match === match}
                      className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium transition ${
                        form.match === match ? "bg-accent text-white" : "text-muted hover:text-ink"
                      }`}
                    >
                      {match === "all" ? "Match all" : "Match any"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {form.conditions.map((condition, index) => (
                  <div key={condition.id} className="flex flex-col gap-2 rounded-xl border border-line/70 bg-surface/70 p-2.5 sm:flex-row sm:items-center">
                    <span className="hidden w-10 shrink-0 text-center text-[9px] font-semibold uppercase tracking-wide text-muted sm:block">
                      {index === 0 ? "If" : form.match === "all" ? "And" : "Or"}
                    </span>
                    <label className="sr-only" htmlFor={`${condition.id}-field`}>Condition field</label>
                    <div className="relative min-w-0 flex-1">
                      <select
                        id={`${condition.id}-field`}
                        value={condition.path}
                        onChange={(event) => updateCondition(condition.id, { path: event.target.value as RuleField })}
                        className="w-full appearance-none rounded-lg border border-line bg-canvas px-3 py-2 text-[11px] text-ink"
                      >
                        {(Object.keys(FIELD_LABELS) as RuleField[]).map((field) => (
                          <option key={field} value={field}>{FIELD_LABELS[field]}</option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
                    </div>
                    <label className="sr-only" htmlFor={`${condition.id}-operator`}>Condition operator</label>
                    <div className="relative min-w-0 flex-1">
                      <select
                        id={`${condition.id}-operator`}
                        value={condition.operator}
                        onChange={(event) => updateCondition(condition.id, { operator: event.target.value as RuleOperator })}
                        className="w-full appearance-none rounded-lg border border-line bg-canvas px-3 py-2 text-[11px] text-ink"
                      >
                        {(Object.keys(OPERATOR_LABELS) as RuleOperator[]).map((operator) => (
                          <option key={operator} value={operator}>{OPERATOR_LABELS[operator]}</option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
                    </div>
                    <label className="sr-only" htmlFor={`${condition.id}-value`}>Condition value</label>
                    <input
                      id={`${condition.id}-value`}
                      value={condition.value}
                      onChange={(event) => updateCondition(condition.id, { value: event.target.value })}
                      disabled={condition.operator === "exists"}
                      placeholder={condition.path === "http_status" ? "500" : "error"}
                      inputMode={condition.path === "http_status" ? "numeric" : "text"}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-[11px] text-ink placeholder:text-muted/70 disabled:opacity-40"
                    />
                    <button
                      type="button"
                      onClick={() => removeCondition(condition.id)}
                      disabled={form.conditions.length <= 1}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-30"
                      aria-label="Remove condition"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addCondition}
                disabled={form.conditions.length >= 10}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2 text-[10px] font-medium text-muted transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
              >
                <Plus size={12} /> Add condition
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="rule-severity" className="mb-1.5 block text-[11px] font-medium text-muted">Incident severity</label>
                <select
                  id="rule-severity"
                  value={form.severity}
                  onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value as RuleForm["severity"] }))}
                  className="w-full rounded-xl border border-line bg-canvas/70 px-3.5 py-2.5 text-xs text-ink"
                >
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                  <option value="info">Info</option>
                </select>
              </div>
              <div>
                <label htmlFor="rule-provider" className="mb-1.5 block text-[11px] font-medium text-muted">Notification destination</label>
                <select
                  id="rule-provider"
                  value={form.provider}
                  onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value as DeliveryProvider, target: "" }))}
                  className="w-full rounded-xl border border-line bg-canvas/70 px-3.5 py-2.5 text-xs text-ink"
                >
                  <option value="slack">Slack channel</option>
                  <option value="discord">Discord webhook</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="rule-target" className="mb-1.5 block text-[11px] font-medium text-muted">
                {form.provider === "slack" ? "Slack channel" : "Discord webhook URL"}
              </label>
              <input
                id="rule-target"
                value={form.target}
                onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))}
                placeholder={form.provider === "slack" ? "#war-room" : "https://discord.com/api/webhooks/…"}
                className={`w-full rounded-xl border bg-canvas/70 px-3.5 py-2.5 text-xs text-ink placeholder:text-muted/70 ${
                  form.target && targetError ? "border-rose-500/50" : "border-line"
                }`}
              />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className={`text-[10px] ${targetError && form.target ? "text-rose-500" : "text-muted"}`}>
                  {targetError || (form.provider === "discord"
                    ? "HTTPS Discord webhook URL is validated locally before save."
                    : "Enter a channel name; connect the matching Slack integration in settings.")}
                </p>
                {form.target && !targetError ? <Check size={13} className="shrink-0 text-emerald-500" /> : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 pt-4">
              <p className="flex items-center gap-1.5 text-[10px] leading-4 text-muted">
                <CircleHelp size={13} />
                Rule is evaluated against each incoming JSON payload.
              </p>
              <button
                type="submit"
                disabled={saving || Boolean(targetError)}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-accent/15 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                {saving ? "Saving rule…" : "Save rule"}
              </button>
            </div>
          </form>
        </article>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-line/80 bg-surface/70 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-500/10 text-cyan-400"><Radio size={15} /></span>
              <h2 className="text-xs font-semibold text-ink">Rule preview</h2>
            </div>
            <div className="mt-4 rounded-xl border border-line bg-canvas/70 p-3.5 font-mono text-[10px] leading-5 text-muted">
              <p><span className="text-violet-400">IF</span> {form.conditions.map((condition) => `${condition.path} ${condition.operator} ${condition.value || "…"}`).join(form.match === "all" ? " AND " : " OR ")}</p>
              <p className="mt-1"><span className="text-amber-400">THEN</span> create <span className="text-rose-400">{form.severity}</span> incident</p>
              <p className="mt-1"><span className="text-cyan-400">ROUTE</span> to {form.provider === "slack" ? "Slack" : "Discord"} {form.target || "destination"}</p>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-muted">
              <ArrowRight size={12} className="text-accent" />
              Rules are stored as nested JSON conditions.
            </div>
          </div>
          <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[0.04] p-4">
            <p className="text-[11px] font-semibold text-ink">Destination note</p>
            <p className="mt-1.5 text-[10px] leading-5 text-muted">
              Rule storage and evaluation are provided by the API. Provider-specific routing requires an enabled integration and a corresponding worker dispatcher.
            </p>
          </div>
        </aside>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Saved rules</h2>
            <p className="mt-1 text-[11px] text-muted">Active rules are evaluated in configured priority order.</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh rules" className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface/70 text-muted transition hover:text-ink disabled:opacity-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((row) => <div key={row} className="h-20 animate-pulse rounded-2xl border border-line bg-surface/50" />)}
          </div>
        ) : rules.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface/30 px-6 py-10 text-center">
            <p className="text-sm font-medium text-ink">No saved rules</p>
            <p className="mt-1 text-xs text-muted">Create a trigger above to start automating incident response.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <article key={rule.id} className="flex flex-col gap-3 rounded-2xl border border-line/80 bg-surface/70 p-4 transition hover:border-accent/25 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xs font-semibold text-ink">{rule.name}</h3>
                    <span className={`rounded-md px-2 py-0.5 text-[9px] font-semibold ${rule.isEnabled ? "bg-emerald-500/10 text-emerald-500" : "bg-slate-500/10 text-muted"}`}>
                      {rule.isEnabled ? "Enabled" : "Disabled"}
                    </span>
                    <span className="text-[9px] text-muted">Priority {rule.priority}</span>
                  </div>
                  <p className="mt-1.5 truncate font-mono text-[10px] text-muted">{formatRule(rule)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {rule.severity ? <span className="rounded-md bg-rose-500/10 px-2 py-1 text-[9px] font-bold uppercase text-rose-500">{rule.severity}</span> : null}
                  <span className="inline-flex items-center gap-1 text-[9px] text-muted">
                    <ArrowDown size={11} /> {new Date(rule.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
