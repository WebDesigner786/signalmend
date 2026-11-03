"use client";

import Link from "next/link";
import { MessageSquare, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { DashboardApiError, dashboardFetch } from "../../../lib/dashboard-api";
import { useDashboardSession } from "../../../lib/dashboard-session";

interface SlackChannel {
  id: string;
  name: string;
}

interface SlackConfiguration {
  teamName: string;
  channels: SlackChannel[];
  currentChannelId: string | null;
}

function isSlackConfiguration(value: unknown): value is SlackConfiguration {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.teamName === "string" &&
    Array.isArray(record.channels) &&
    record.channels.every(
      (channel) =>
        typeof channel === "object" &&
        channel !== null &&
        "id" in channel &&
        typeof channel.id === "string" &&
        "name" in channel &&
        typeof channel.name === "string",
    ) &&
    (record.currentChannelId === null ||
      typeof record.currentChannelId === "string")
  );
}

export default function IntegrationsPage() {
  const { token, workspaceId, authenticated } = useDashboardSession();
  const [configuration, setConfiguration] = useState<SlackConfiguration | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refresh = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    setError("");
    try {
      const response = await dashboardFetch<unknown>(
        "/api/v1/integrations/slack",
        { token, workspaceId },
      );
      if (!isSlackConfiguration(response)) {
        throw new Error("Slack channel API returned an invalid response.");
      }
      setConfiguration(response);
      setSelectedChannelId(
        response.currentChannelId ??
          response.channels[0]?.id ??
          "",
      );
    } catch (caught) {
      setConfiguration(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "Slack channels could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [authenticated, token, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await dashboardFetch("/api/v1/integrations/slack", { token, workspaceId }, {
        method: "POST",
        body: JSON.stringify({ channelId: selectedChannelId }),
      });
      setSuccess("Slack alerts are configured for this channel.");
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof DashboardApiError && caught.status === 409
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Slack channel could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setError("");
    setSuccess("");
    try {
      await dashboardFetch(
        "/api/v1/integrations/slack/test",
        { token, workspaceId },
        { method: "POST" },
      );
      setSuccess("Test notification sent to Slack.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Slack test notification failed.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-7">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
          Integrations
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Slack alerts
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Choose a channel where SignalMend can post incident alerts. Invite the
          SignalMend bot to the channel before selecting it.
        </p>
      </header>

      <section className="rounded-2xl border border-line/80 bg-surface/70 p-5 shadow-sm sm:p-7">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
            <MessageSquare size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-ink">Incident notifications</h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              {configuration
                ? `Connected to ${configuration.teamName}.`
                : "Connect a Slack workspace to configure incident delivery."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-canvas text-muted transition hover:text-ink disabled:opacity-50"
            aria-label="Refresh Slack channels"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {error ? (
          <div role="alert" className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs leading-5 text-amber-600 dark:text-amber-300">
            <p>{error}</p>
            {              error.toLowerCase().includes("connect slack") ||
            error.toLowerCase().includes("reconnect slack") ? (
              <Link
                href="/onboarding"
                className="mt-3 inline-flex rounded-lg bg-accent px-3 py-2 font-semibold text-white"
              >
                Connect Slack
              </Link>
            ) : null}
          </div>
        ) : null}

        {configuration ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-muted">
                Alert channel
              </span>
              <select
                value={selectedChannelId}
                onChange={(event) => {
                  setSelectedChannelId(event.target.value);
                  setSuccess("");
                }}
                disabled={loading || saving || configuration.channels.length === 0}
                className="w-full rounded-xl border border-line bg-canvas/70 px-3.5 py-3 text-xs text-ink disabled:opacity-50"
              >
                {configuration.channels.length === 0 ? (
                  <option value="">No channels found</option>
                ) : null}
                {configuration.channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={
                  saving ||
                  loading ||
                  !selectedChannelId ||
                  selectedChannelId === configuration.currentChannelId
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-xs font-semibold text-white shadow-lg shadow-accent/15 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? "Saving…" : "Save channel"}
              </button>
              <button
                type="button"
                onClick={() => void sendTest()}
                disabled={testing || saving || loading || !configuration.currentChannelId}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-canvas px-4 py-3 text-xs font-semibold text-ink transition hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {testing ? <RefreshCw size={14} className="animate-spin" /> : null}
                {testing ? "Sending…" : "Send test"}
              </button>
            </div>
          </div>
        ) : null}

        {success ? (
          <p role="status" className="mt-4 flex items-center gap-2 text-xs text-emerald-500">
            <ShieldCheck size={14} /> {success}
          </p>
        ) : null}
        <p className="mt-5 border-t border-line/70 pt-4 text-[10px] leading-5 text-muted">
          Slack buttons for acknowledge, resolve and one-hour silence are
          available on alerts delivered after this integration is configured.
        </p>
      </section>
    </div>
  );
}
