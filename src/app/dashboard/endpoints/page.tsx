"use client";

import {
  Activity,
  Check,
  Clipboard,
  Copy,
  Fingerprint,
  KeyRound,
  Plus,
  Radio,
  RefreshCw,
  Shield,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Webhook,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { dashboardFetch, getDashboardApiBaseUrl } from "../../../lib/dashboard-api";
import { useDashboardSession } from "../../../lib/dashboard-session";

interface WebhookEndpoint {
  id: string;
  name: string;
  endpointKey: string;
  isActive: boolean;
  requireSignature: boolean;
  signatureHeader: string;
  totalReceived: number;
  createdAt: string;
}

interface EndpointListResponse {
  endpoints: WebhookEndpoint[];
}

interface EndpointMutationResponse {
  endpoint: WebhookEndpoint;
  secret?: string;
}

interface EndpointFormState {
  name: string;
  requireSignature: boolean;
  signatureHeader: string;
}

const EMPTY_FORM: EndpointFormState = {
  name: "",
  requireSignature: true,
  signatureHeader: "x-signature",
};

function isEndpoint(value: unknown): value is WebhookEndpoint {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.endpointKey === "string" &&
    typeof record.isActive === "boolean" &&
    typeof record.requireSignature === "boolean" &&
    typeof record.signatureHeader === "string" &&
    typeof record.totalReceived === "number" &&
    typeof record.createdAt === "string"
  );
}

function endpointUrl(key: string): string {
  return `${getDashboardApiBaseUrl()}/api/v1/webhooks/${encodeURIComponent(key)}`;
}

function InlineAlert({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  if (!message) {
    return null;
  }
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs leading-5 text-rose-500">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss error">
        <X size={14} />
      </button>
    </div>
  );
}

function EndpointSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-28 animate-pulse rounded-2xl border border-line bg-surface/50" />
      ))}
    </div>
  );
}

export default function EndpointsPage() {
  const { token, workspaceId } = useDashboardSession();
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [revealedSecret, setRevealedSecret] = useState("");
  const [copied, setCopied] = useState("");

  const refresh = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const response = await dashboardFetch<EndpointListResponse>(
        "/api/v1/webhook-endpoints",
        { token, workspaceId },
      );
      if (!response || !Array.isArray(response.endpoints) || !response.endpoints.every(isEndpoint)) {
        throw new Error("Endpoint management API returned an invalid response");
      }
      setEndpoints(response.endpoints);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Webhook endpoints could not be loaded",
      );
    } finally {
      setLoading(false);
    }
  }, [token, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createEndpoint = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    const signatureHeader = form.signatureHeader.trim().toLowerCase();
    if (name.length < 2 || name.length > 255) {
      setError("Endpoint names must be between 2 and 255 characters.");
      return;
    }
    if (!/^[a-z0-9-]{2,128}$/.test(signatureHeader)) {
      setError("Use a valid header name such as x-signature or x-hub-signature-256.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");
    setRevealedSecret("");
    try {
      const response = await dashboardFetch<EndpointMutationResponse>(
        "/api/v1/webhook-endpoints",
        { token, workspaceId },
        {
          method: "POST",
          body: JSON.stringify({
            name,
            requireSignature: form.requireSignature,
            signatureHeader,
          }),
        },
      );
      if (!response || !isEndpoint(response.endpoint)) {
        throw new Error("Endpoint creation API returned an invalid response");
      }
      setEndpoints((current) => [response.endpoint, ...current]);
      setForm(EMPTY_FORM);
      setRevealedSecret(response.secret ?? "");
      setSuccess(
        response.secret
          ? "Endpoint created. Copy the signing secret now; it will not be shown again."
          : "Endpoint created successfully.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Endpoint could not be created",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const updateEndpoint = async (
    endpoint: WebhookEndpoint,
    patch: Partial<Pick<WebhookEndpoint, "isActive" | "requireSignature">>,
  ) => {
    setPendingId(endpoint.id);
    setError("");
    setSuccess("");
    try {
      const response = await dashboardFetch<EndpointMutationResponse>(
        `/api/v1/webhook-endpoints/${encodeURIComponent(endpoint.id)}`,
        { token, workspaceId },
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      if (!response || !isEndpoint(response.endpoint)) {
        throw new Error("Endpoint update API returned an invalid response");
      }
      setEndpoints((current) =>
        current.map((item) =>
          item.id === endpoint.id ? response.endpoint : item,
        ),
      );
      setSuccess("Endpoint settings saved.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Endpoint settings could not be saved",
      );
    } finally {
      setPendingId("");
    }
  };

  const rotateSecret = async (endpoint: WebhookEndpoint) => {
    if (
      !window.confirm(
        `Rotate the signing secret for “${endpoint.name}”? Existing senders will need the new secret immediately.`,
      )
    ) {
      return;
    }
    setPendingId(endpoint.id);
    setError("");
    setSuccess("");
    try {
      const response = await dashboardFetch<EndpointMutationResponse>(
        `/api/v1/webhook-endpoints/${encodeURIComponent(endpoint.id)}/rotate-secret`,
        { token, workspaceId },
        { method: "POST", body: JSON.stringify({}) },
      );
      if (!response || !isEndpoint(response.endpoint) || !response.secret) {
        throw new Error("Secret rotation API did not return the new secret");
      }
      setEndpoints((current) =>
        current.map((item) =>
          item.id === endpoint.id ? response.endpoint : item,
        ),
      );
      setRevealedSecret(response.secret);
      setSuccess("Signing secret rotated. Update the source webhook immediately.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Signing secret could not be rotated",
      );
    } finally {
      setPendingId("");
    }
  };

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1_800);
    } catch {
      setError("Clipboard access was denied by this browser. Select and copy the value manually.");
    }
  };

  const totalReceived = endpoints.reduce((total, endpoint) => total + endpoint.totalReceived, 0);

  return (
    <div className="space-y-7">
      <header className="animate-fade-in-up">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-1 text-[10px] font-medium text-cyan-500">
          <Radio size={12} /> Ingestion control
        </div>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-ink sm:text-[34px]">
              Webhook endpoints
            </h1>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted">
              Configure secure ingress pipelines and manage source signing credentials.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface/70 px-3 py-2 text-xs text-muted">
            <Activity size={14} className="text-accent" />
            <span className="font-semibold tabular-nums text-ink">{totalReceived.toLocaleString()}</span>
            <span>events received</span>
          </div>
        </div>
      </header>

      <InlineAlert message={error} onDismiss={() => setError("")} />
      {success ? (
        <div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs leading-5 text-emerald-500">
          {success}
        </div>
      ) : null}
      {revealedSecret ? (
        <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-500">
              <KeyRound size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-ink">Copy this signing secret now</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                SignalMend stores signing secrets encrypted. This value is shown only once and cannot be recovered.
              </p>
              <div className="mt-3 flex gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[11px] text-ink">
                  {revealedSecret}
                </code>
                <button
                  type="button"
                  onClick={() => void copyValue("secret", revealedSecret)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-[11px] font-semibold text-slate-950 transition hover:brightness-110"
                >
                  {copied === "secret" ? <Check size={14} /> : <Copy size={14} />}
                  {copied === "secret" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <button type="button" onClick={() => setRevealedSecret("")} aria-label="Dismiss signing secret">
              <X size={15} className="text-muted" />
            </button>
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <article className="rounded-2xl border border-line/80 bg-surface/70 p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent">
              <Plus size={17} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">Create an endpoint</h2>
              <p className="mt-0.5 text-[11px] text-muted">Create a unique ingress URL for any JSON provider.</p>
            </div>
          </div>
          <form onSubmit={createEndpoint} className="space-y-4">
            <div>
              <label htmlFor="endpoint-name" className="mb-1.5 block text-[11px] font-medium text-muted">
                Endpoint name
              </label>
              <input
                id="endpoint-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Production Sentry"
                maxLength={255}
                required
                className="w-full rounded-xl border border-line bg-canvas/70 px-3.5 py-2.5 text-xs text-ink placeholder:text-muted/70"
              />
            </div>
            <div>
              <label htmlFor="signature-header" className="mb-1.5 block text-[11px] font-medium text-muted">
                Signature header
              </label>
              <input
                id="signature-header"
                value={form.signatureHeader}
                onChange={(event) => setForm((current) => ({ ...current, signatureHeader: event.target.value }))}
                placeholder="x-signature"
                maxLength={128}
                required={form.requireSignature}
                disabled={!form.requireSignature}
                className="w-full rounded-xl border border-line bg-canvas/70 px-3.5 py-2.5 font-mono text-xs text-ink placeholder:text-muted/70 disabled:opacity-50"
              />
              <p className="mt-1.5 text-[10px] leading-4 text-muted">
                Signature is HMAC-SHA256 of the exact raw JSON body.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line/80 bg-canvas/50 p-3.5 transition hover:border-accent/30">
              <input
                type="checkbox"
                checked={form.requireSignature}
                onChange={(event) => setForm((current) => ({ ...current, requireSignature: event.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-indigo-500"
              />
              <span>
                <span className="flex items-center gap-2 text-xs font-semibold text-ink">
                  <ShieldCheck size={14} className="text-emerald-500" />
                  Require signature verification
                </span>
                <span className="mt-1 block text-[10px] leading-4 text-muted">
                  Reject unauthenticated payloads before they enter the processing queue.
                </span>
              </span>
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-accent/15 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
            >
              {submitting ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
              {submitting ? "Creating endpoint…" : "Create endpoint"}
            </button>
          </form>
        </article>

        <aside className="rounded-2xl border border-line/80 bg-surface/70 p-5 shadow-sm sm:p-6">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/10 text-violet-400">
            <Fingerprint size={17} />
          </span>
          <h2 className="mt-4 text-sm font-semibold text-ink">Signed payloads</h2>
          <p className="mt-2 text-xs leading-5 text-muted">
            Compute an HMAC-SHA256 digest over the raw request body and send it in your configured header.
          </p>
          <div className="mt-4 rounded-xl border border-line bg-canvas/70 p-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">Example header</p>
            <code className="mt-2 block break-all font-mono text-[10px] leading-5 text-ink">
              x-signature: &lt;hex-encoded-hmac-sha256&gt;
            </code>
          </div>
          <div className="mt-4 flex gap-2 rounded-xl bg-emerald-500/5 p-3 text-[10px] leading-4 text-muted">
            <Shield size={14} className="mt-0.5 shrink-0 text-emerald-500" />
            Secrets are returned only during creation or rotation and encrypted at rest.
          </div>
        </aside>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Configured endpoints</h2>
            <p className="mt-1 text-[11px] text-muted">Manage routing addresses and security controls.</p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface/70 text-muted transition hover:text-ink disabled:opacity-50"
            aria-label="Refresh endpoints"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {loading ? <EndpointSkeleton /> : endpoints.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface/30 px-6 py-12 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-line bg-surface text-muted">
              <Webhook size={19} />
            </span>
            <p className="mt-3 text-sm font-medium text-ink">No endpoints yet</p>
            <p className="mt-1 text-xs text-muted">Create your first signed webhook endpoint above.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {endpoints.map((endpoint) => {
              const url = endpointUrl(endpoint.endpointKey);
              const busy = pendingId === endpoint.id;
              return (
                <article key={endpoint.id} className="rounded-2xl border border-line/80 bg-surface/70 p-4 shadow-sm transition hover:border-accent/25 sm:p-5">
                  <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xs font-semibold text-ink">{endpoint.name}</h3>
                        <span className={`rounded-md px-2 py-0.5 text-[9px] font-semibold ${
                          endpoint.isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-slate-500/10 text-muted"
                        }`}>
                          {endpoint.isActive ? "Active" : "Paused"}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-md bg-canvas px-2 py-0.5 text-[9px] text-muted">
                          <Activity size={10} /> {endpoint.totalReceived.toLocaleString()} received
                        </span>
                      </div>
                      <div className="mt-3 flex min-w-0 items-center gap-2 rounded-lg border border-line bg-canvas/70 px-3 py-2">
                        <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted">{url}</code>
                        <button
                          type="button"
                          title="Copy endpoint URL"
                          onClick={() => void copyValue(endpoint.id, url)}
                          className="shrink-0 rounded-md p-1 text-muted transition hover:bg-accent/10 hover:text-accent"
                          aria-label={`Copy URL for ${endpoint.name}`}
                        >
                          {copied === endpoint.id ? <Check size={14} /> : <Clipboard size={14} />}
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted">
                        <span>Header: <code className="text-ink">{endpoint.signatureHeader}</code></span>
                        <span>Created {new Date(endpoint.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void updateEndpoint(endpoint, { requireSignature: !endpoint.requireSignature })}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] font-medium transition disabled:opacity-50 ${
                          endpoint.requireSignature
                            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-500"
                            : "border-line bg-canvas text-muted"
                        }`}
                        aria-pressed={endpoint.requireSignature}
                      >
                        {endpoint.requireSignature ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                        Signature {endpoint.requireSignature ? "on" : "off"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void updateEndpoint(endpoint, { isActive: !endpoint.isActive })}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-2.5 py-2 text-[10px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
                      >
                        {endpoint.isActive ? "Pause" : "Enable"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void rotateSecret(endpoint)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-2.5 py-2 text-[10px] font-medium text-muted transition hover:border-amber-500/25 hover:text-amber-500 disabled:opacity-50"
                      >
                        <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
                        Rotate secret
                      </button>
                      <button
                        type="button"
                        disabled
                        title="Endpoint deletion is not currently supported by the management API"
                        className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-canvas text-muted/40"
                        aria-label={`Delete ${endpoint.name} (unavailable)`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
