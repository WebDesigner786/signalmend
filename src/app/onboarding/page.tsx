"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Circle,
  LoaderCircle,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { useDashboardSession } from "../../lib/dashboard-session";

const INDUSTRIES = [
  "E-commerce",
  "Healthcare",
  "Real Estate",
  "Legal",
  "Financial services",
  "Technology",
  "Professional services",
  "Other",
] as const;
const ONBOARDING_TENANT_KEY = "signalmend.onboarding.tenant.v1";
const ONBOARDING_WORKSPACE_KEY = "signalmend.onboarding.workspace.v1";

type VerificationStatus = "not_connected" | "pending" | "verified" | "failed";
type WizardStep = 1 | 2 | 3;

interface WorkspaceOption {
  id: string;
  name: string;
  tenantId: string | null;
}

interface SlackStatus {
  businessName: string;
  businessNiche: string;
  verificationStatus: VerificationStatus;
  teamName: string | null;
  verifiedAt: string | null;
  verificationError: string | null;
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return fallback;
}

function isSlackStatus(value: unknown): value is SlackStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.businessName === "string" &&
    typeof record.businessNiche === "string" &&
    (record.verificationStatus === "not_connected" ||
      record.verificationStatus === "pending" ||
      record.verificationStatus === "verified" ||
      record.verificationStatus === "failed") &&
    (typeof record.teamName === "string" || record.teamName === null) &&
    (typeof record.verifiedAt === "string" || record.verifiedAt === null) &&
    (typeof record.verificationError === "string" ||
      record.verificationError === null)
  );
}

function StepIndicator({
  currentStep,
  completed,
}: {
  currentStep: WizardStep;
  completed: boolean;
}) {
  const steps = [
    { number: 1, label: "Your business" },
    { number: 2, label: "Connect Slack" },
    { number: 3, label: "All set" },
  ] as const;

  return (
    <ol
      aria-label="Onboarding progress"
      className="mb-9 grid grid-cols-3"
    >
      {steps.map((step, index) => {
        const isComplete = step.number < currentStep || (step.number === 3 && completed);
        const isCurrent = step.number === currentStep;
        return (
          <li key={step.number} className="relative flex flex-col items-center gap-2">
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={`absolute left-1/2 top-4 h-px w-full ${
                  step.number < currentStep ? "bg-emerald-500/60" : "bg-line"
                }`}
              />
            ) : null}
            <span
              className={`relative z-10 grid h-8 w-8 place-items-center rounded-full border text-xs font-semibold ${
                isComplete
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : isCurrent
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-line bg-surface text-muted"
              }`}
            >
              {isComplete ? <Check size={15} /> : step.number}
            </span>
            <span
              className={`text-center text-[11px] font-medium ${
                isCurrent || isComplete ? "text-ink" : "text-muted"
              }`}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function AccessPrompt({
  onSave,
}: {
  onSave: (token: string) => void;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (token.trim().length < 20) {
      setError("Enter a valid dashboard access token to continue.");
      return;
    }
    setError("");
    onSave(token.trim());
  };

  return (
    <section className="w-full max-w-lg rounded-3xl border border-line bg-surface/90 p-7 shadow-2xl shadow-black/10 backdrop-blur-xl sm:p-9">
      <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
        <LockKeyhole size={21} />
      </div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
        Secure setup
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
        Sign in to set up your business
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        Use the dashboard access token provided by your SignalMend administrator.
        It stays in this browser tab.
      </p>
      <form className="mt-6 space-y-3" onSubmit={submit}>
        <label className="sr-only" htmlFor="onboarding-token">
          Dashboard access token
        </label>
        <textarea
          id="onboarding-token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste your access token"
          className="min-h-24 w-full resize-y rounded-xl border border-line bg-canvas px-4 py-3 font-mono text-xs text-ink placeholder:text-muted/70"
        />
        {error ? <p role="alert" className="text-xs text-rose-500">{error}</p> : null}
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Continue securely <ArrowRight size={16} />
        </button>
      </form>
    </section>
  );
}

export default function OnboardingPage() {
  const {
    ready,
    token,
    workspaceId: sessionWorkspaceId,
    setToken,
    setWorkspaceId,
  } = useDashboardSession();
  const [businessName, setBusinessName] = useState("");
  const [businessNiche, setBusinessNiche] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [connectingSlack, setConnectingSlack] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");

  const canPoll = step === 3 && Boolean(tenantId) && Boolean(token);

  useEffect(() => {
    if (!ready || !token) {
      return;
    }

    let active = true;
    const loadWorkspaces = async () => {
      setWorkspacesLoading(true);
      try {
        const response = await fetch("/api/onboarding", {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
          },
          cache: "no-store",
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(getErrorMessage(body, "Available workspaces could not be loaded."));
        }
        if (
          typeof body !== "object" ||
          body === null ||
          !("workspaces" in body) ||
          !Array.isArray(body.workspaces) ||
          !body.workspaces.every(
            (workspace) =>
              typeof workspace === "object" &&
              workspace !== null &&
              "id" in workspace &&
              typeof workspace.id === "string" &&
              "name" in workspace &&
              typeof workspace.name === "string" &&
              "tenantId" in workspace &&
              (typeof workspace.tenantId === "string" || workspace.tenantId === null),
          )
        ) {
          throw new Error("Available workspaces returned an unexpected response.");
        }
        if (!active) {
          return;
        }
        const options = body.workspaces as WorkspaceOption[];
        setWorkspaces(options);
        const savedWorkspaceId = window.sessionStorage.getItem(ONBOARDING_WORKSPACE_KEY);
        const preferredWorkspaceId =
          sessionWorkspaceId || savedWorkspaceId || options[0]?.id || "";
        const preferred = options.find((workspace) => workspace.id === preferredWorkspaceId);
        const linkedTenant = options.find((workspace) => workspace.tenantId === tenantId);
        setSelectedWorkspaceId(linkedTenant?.id ?? preferred?.id ?? "");
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Available workspaces could not be loaded.",
          );
        }
      } finally {
        if (active) {
          setWorkspacesLoading(false);
        }
      }
    };

    void loadWorkspaces();
    return () => {
      active = false;
    };
  }, [ready, token, sessionWorkspaceId, tenantId]);

  const loadSlackStatus = useCallback(async () => {
    if (!tenantId || !token) {
      return;
    }
    const response = await fetch(
      `/api/onboarding/slack-status?tenantId=${encodeURIComponent(tenantId)}`,
      {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        cache: "no-store",
      },
    );
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        getErrorMessage(body, "Slack connection status could not be checked."),
      );
    }
    if (!isSlackStatus(body)) {
      throw new Error("Slack connection status returned an unexpected response.");
    }
    setStatus(body);
    setBusinessName(body.businessName);
    setBusinessNiche(body.businessNiche);
    setStatusError("");
  }, [tenantId, token]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const query = new URLSearchParams(window.location.search);
    const returnedTenantId = query.get("tenantId");
    const savedTenantId = window.sessionStorage.getItem(ONBOARDING_TENANT_KEY);
    const savedWorkspaceId = window.sessionStorage.getItem(ONBOARDING_WORKSPACE_KEY);
    const currentTenantId = returnedTenantId ?? savedTenantId;
    if (savedWorkspaceId) {
      setSelectedWorkspaceId(savedWorkspaceId);
      setWorkspaceId(savedWorkspaceId);
    }
    if (!currentTenantId) {
      return;
    }
    setTenantId(currentTenantId);
    setStep(query.get("slack") === "connected" ? 3 : 2);
    if (query.get("slack") === "declined") {
      setError("Slack authorization was canceled. You can connect it whenever you’re ready.");
    }
    if (query.get("slack") === "connected") {
      window.sessionStorage.setItem(ONBOARDING_TENANT_KEY, currentTenantId);
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [ready, setWorkspaceId]);

  useEffect(() => {
    if (!canPoll) {
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        await loadSlackStatus();
      } catch (caught) {
        if (active) {
          setStatusError(
            caught instanceof Error
              ? caught.message
              : "Slack connection status could not be checked.",
          );
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [canPoll, loadSlackStatus]);

  const saveBusiness = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSavingBusiness(true);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          businessName,
          businessNiche,
          workspaceId: selectedWorkspaceId,
          ...(tenantId ? { tenantId } : {}),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "Your business could not be set up."));
      }
      if (
        typeof body !== "object" ||
        body === null ||
        !("tenantId" in body) ||
        typeof body.tenantId !== "string"
      ) {
        throw new Error("Business setup returned an unexpected response.");
      }
      setTenantId(body.tenantId);
      setWorkspaceId(selectedWorkspaceId);
      setStatus({
        businessName,
        businessNiche,
        verificationStatus: "not_connected",
        teamName: null,
        verifiedAt: null,
        verificationError: null,
      });
      window.sessionStorage.setItem(ONBOARDING_TENANT_KEY, body.tenantId);
      window.sessionStorage.setItem(ONBOARDING_WORKSPACE_KEY, selectedWorkspaceId);
      setStep(2);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Your business could not be set up.",
      );
    } finally {
      setSavingBusiness(false);
    }
  };

  const connectSlack = async () => {
    setError("");
    setConnectingSlack(true);
    try {
      const response = await fetch("/api/auth/slack/start", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ tenantId }),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "Slack authorization could not be started."));
      }
      if (
        typeof body !== "object" ||
        body === null ||
        !("authorizationUrl" in body) ||
        typeof body.authorizationUrl !== "string"
      ) {
        throw new Error("Slack authorization returned an unexpected response.");
      }
      window.location.assign(body.authorizationUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Slack authorization could not be started.",
      );
      setConnectingSlack(false);
    }
  };

  const returnToIntegrations = () => {
    setStep(2);
    setStatusError("");
    setError("");
  };

  const stepTitle = useMemo(() => {
    if (step === 1) return "Let’s get to know your business";
    if (step === 2) return "Bring your team into the loop";
    return "Your workspace connection";
  }, [step]);

  if (!ready) {
    return (
      <main className="grid min-h-screen place-items-center bg-canvas px-5 text-muted">
        <span className="flex items-center gap-3 text-sm">
          <LoaderCircle size={17} className="animate-spin text-accent" />
          Preparing your secure setup…
        </span>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas px-4 py-6 text-ink sm:px-7 sm:py-9">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex items-center justify-between">
          <a href="/dashboard" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 text-white shadow-lg shadow-indigo-500/20">
              <Activity size={19} />
            </span>
            <span>
              <span className="block text-sm font-bold tracking-tight">SignalMend</span>
              <span className="block text-[9px] font-semibold uppercase tracking-[0.2em] text-muted">
                Incident operations
              </span>
            </span>
          </a>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-[10px] font-medium text-muted">
            <ShieldCheck size={13} className="text-emerald-500" />
            Secure setup
          </span>
        </header>

        {!token ? (
          <div className="grid place-items-center py-10">
            <AccessPrompt onSave={setToken} />
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
            <section className="rounded-3xl border border-line bg-surface/85 p-5 shadow-xl shadow-black/[0.03] backdrop-blur-xl sm:p-9">
              <div className="mb-7 flex items-center gap-2 text-xs font-semibold text-accent">
                <Sparkles size={15} />
                <span>WELCOME TO SIGNALMEND</span>
              </div>
              <StepIndicator
                currentStep={step}
                completed={status?.verificationStatus === "verified"}
              />
              <div className="mb-7 border-b border-line/80 pb-6">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {stepTitle}
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
                  {step === 1
                    ? "A few details help us tailor your workspace. You can update these later."
                    : step === 2
                      ? "Connect Slack so important alerts can reach the right people."
                      : "We’re checking that your Slack workspace is ready to use. This usually takes a few seconds."}
                </p>
              </div>

              {step === 1 ? (
                <form onSubmit={saveBusiness} className="space-y-6">
                  <div>
                    <label htmlFor="business-workspace" className="mb-2 block text-sm font-medium">
                      Which workspace should this business use?
                    </label>
                    <select
                      id="business-workspace"
                      required
                      value={selectedWorkspaceId}
                      disabled={workspacesLoading || workspaces.length === 0}
                      onChange={(event) => {
                        setSelectedWorkspaceId(event.target.value);
                        setWorkspaceId(event.target.value);
                      }}
                      className="w-full rounded-xl border border-line bg-canvas/70 px-4 py-3 text-sm text-ink disabled:opacity-60"
                    >
                      <option value="">
                        {workspacesLoading
                          ? "Loading your workspaces…"
                          : workspaces.length
                            ? "Choose a workspace"
                            : "No workspaces available"}
                      </option>
                      {workspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                    {!workspacesLoading && workspaces.length === 0 ? (
                      <p className="mt-2 text-xs leading-5 text-muted">
                        Ask a workspace owner or administrator to grant you access before continuing.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label htmlFor="business-name" className="mb-2 block text-sm font-medium">
                      What’s your business called?
                    </label>
                    <div className="relative">
                      <Building2
                        size={17}
                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
                      />
                      <input
                        id="business-name"
                        required
                        minLength={2}
                        maxLength={255}
                        value={businessName}
                        onChange={(event) => setBusinessName(event.target.value)}
                        placeholder="e.g. Northstar Health"
                        className="w-full rounded-xl border border-line bg-canvas/70 py-3 pl-10 pr-4 text-sm text-ink placeholder:text-muted/60"
                      />
                    </div>
                  </div>
                  <fieldset>
                    <legend className="mb-1 text-sm font-medium">
                      Which industry best describes you?
                    </legend>
                    <p className="mb-3 text-xs text-muted">
                      Choose the closest match. It helps us personalize your setup.
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {INDUSTRIES.map((industry) => {
                        const selected = businessNiche === industry;
                        return (
                          <button
                            key={industry}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setBusinessNiche(industry)}
                            className={`min-h-11 rounded-xl border px-3 py-2 text-left text-xs font-medium transition ${
                              selected
                                ? "border-accent/50 bg-accent/10 text-accent"
                                : "border-line bg-canvas/40 text-muted hover:border-accent/30 hover:text-ink"
                            }`}
                          >
                            {industry}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                  {error ? (
                    <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs leading-5 text-rose-500">
                      {error}
                    </p>
                  ) : null}
                  <div className="flex justify-end border-t border-line/70 pt-5">
                    <button
                      type="submit"
                      disabled={
                        savingBusiness ||
                        !businessName.trim() ||
                        !businessNiche ||
                        !selectedWorkspaceId
                      }
                      className="flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingBusiness ? (
                        <>
                          <LoaderCircle size={16} className="animate-spin" />
                          Setting up…
                        </>
                      ) : (
                        <>
                          Continue <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : null}

              {step === 2 ? (
                <div>
                  <div className="rounded-2xl border border-line bg-canvas/45 p-4 sm:p-5">
                    <div className="flex items-start gap-4">
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-violet-500/20 bg-violet-500/10 text-violet-500">
                        <MessageSquare size={22} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h2 className="font-semibold">Slack</h2>
                        <p className="mt-1 text-xs leading-5 text-muted">
                          Send incident alerts to a channel your team already uses.
                          You’ll approve the connection in Slack.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {["Secure authorization", "You can disconnect anytime"].map((item) => (
                            <span
                              key={item}
                              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/70 px-2.5 py-1 text-[10px] text-muted"
                            >
                              <CheckCircle2 size={12} className="text-emerald-500" />
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    {status?.verificationStatus === "verified" ? (
                      <div className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 size={18} />
                        Slack is connected
                        {status.teamName ? ` to ${status.teamName}` : ""}
                      </div>
                    ) : null}
                  </div>
                  {error ? (
                    <p role="alert" className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs leading-5 text-rose-500">
                      {error}
                    </p>
                  ) : null}
                  <div className="mt-6 flex flex-col-reverse justify-between gap-3 border-t border-line/70 pt-5 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-line px-4 py-3 text-sm font-medium text-muted transition hover:text-ink"
                    >
                      <ArrowLeft size={15} /> Back
                    </button>
                    <button
                      type="button"
                      onClick={connectSlack}
                      disabled={connectingSlack || !tenantId}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#4A154B] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-950/15 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
                    >
                      {connectingSlack ? (
                        <>
                          <LoaderCircle size={16} className="animate-spin" />
                          Opening Slack…
                        </>
                      ) : (
                        <>
                          <MessageSquare size={16} />
                          Connect Slack Workspace
                          <ArrowRight size={15} />
                        </>
                      )}
                    </button>
                  </div>
                  <p className="mt-4 text-center text-[11px] leading-5 text-muted">
                    Slack will ask you to approve SignalMend. We never ask for your Slack password.
                  </p>
                </div>
              ) : null}

              {step === 3 ? (
                <div>
                  <div className="rounded-2xl border border-line bg-canvas/45 p-4 sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                          {businessName || status?.businessName || "Your business"}
                        </p>
                        <h2 className="mt-1 text-lg font-semibold">Setup progress</h2>
                      </div>
                      <span className="rounded-full border border-line bg-surface/70 px-2.5 py-1 text-[10px] font-medium text-muted">
                        {status?.verificationStatus === "verified" ? "Ready" : "In progress"}
                      </span>
                    </div>
                    <ol className="mt-6 space-y-0">
                      <li className="flex gap-3 pb-5">
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-500">
                          <Check size={15} />
                        </span>
                        <div>
                          <p className="text-sm font-medium">Business details saved</p>
                          <p className="mt-1 text-xs text-muted">
                            {businessNiche || status?.businessNiche}
                          </p>
                        </div>
                      </li>
                      <li className="flex gap-3 pb-5">
                        <span
                          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                            status?.verificationStatus === "verified"
                              ? "bg-emerald-500/10 text-emerald-500"
                              : status?.verificationStatus === "failed"
                                ? "bg-rose-500/10 text-rose-500"
                                : "bg-accent/10 text-accent"
                          }`}
                        >
                          {status?.verificationStatus === "verified" ? (
                            <Check size={15} />
                          ) : status?.verificationStatus === "failed" ? (
                            <Circle size={13} />
                          ) : (
                            <LoaderCircle size={15} className="animate-spin" />
                          )}
                        </span>
                        <div>
                          <p className="text-sm font-medium">
                            {status?.verificationStatus === "verified"
                              ? "Slack workspace verified"
                              : status?.verificationStatus === "failed"
                                ? "Slack connection needs attention"
                                : "Verifying Slack workspace"}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {status?.verificationStatus === "verified"
                              ? `Connected${status.teamName ? ` to ${status.teamName}` : ""}. Your team can receive alerts.`
                              : status?.verificationStatus === "failed"
                                ? status.verificationError ||
                                  "We could not verify this connection. Reconnect Slack to try again."
                                : "SignalMend is securely checking the connection. You can leave this page and come back anytime."}
                          </p>
                        </div>
                      </li>
                      <li className="flex gap-3">
                        <span
                          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                            status?.verificationStatus === "verified"
                              ? "bg-emerald-500/10 text-emerald-500"
                              : "bg-surface text-muted"
                          }`}
                        >
                          {status?.verificationStatus === "verified" ? (
                            <Check size={15} />
                          ) : (
                            <Circle size={13} />
                          )}
                        </span>
                        <div>
                          <p className="text-sm font-medium">Ready for your first alert</p>
                          <p className="mt-1 text-xs text-muted">
                            {status?.verificationStatus === "verified"
                              ? "Your Slack connection is active."
                              : "This step completes as soon as the connection is verified."}
                          </p>
                        </div>
                      </li>
                    </ol>
                  </div>
                  {statusError ? (
                    <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
                      <p className="text-xs leading-5 text-rose-500">{statusError}</p>
                      <button
                        type="button"
                        onClick={() => void loadSlackStatus().catch((caught: unknown) =>
                          setStatusError(
                            caught instanceof Error ? caught.message : "Status refresh failed.",
                          ),
                        )}
                        className="text-xs font-semibold text-rose-500 underline underline-offset-2"
                      >
                        Try again
                      </button>
                    </div>
                  ) : null}
                  {status?.verificationStatus === "verified" ? (
                    <div className="mt-6 flex flex-col-reverse justify-between gap-3 border-t border-line/70 pt-5 sm:flex-row">
                      <button
                        type="button"
                        onClick={returnToIntegrations}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-line px-4 py-3 text-sm font-medium text-muted transition hover:text-ink"
                      >
                        <ArrowLeft size={15} /> Back to integrations
                      </button>
                      <a
                        href="/dashboard"
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:brightness-110"
                      >
                        Go to dashboard <ArrowRight size={16} />
                      </a>
                    </div>
                  ) : status?.verificationStatus === "failed" ? (
                    <div className="mt-6 flex justify-end border-t border-line/70 pt-5">
                      <button
                        type="button"
                        onClick={returnToIntegrations}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110"
                      >
                        Reconnect Slack <ArrowRight size={16} />
                      </button>
                    </div>
                  ) : null}
                  {status?.verifiedAt ? (
                    <p className="mt-4 text-center text-[10px] text-muted">
                      Verified {new Date(status.verifiedAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            <aside className="rounded-3xl border border-line/80 bg-surface/55 p-5 sm:p-6">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck size={17} className="text-emerald-500" />
                Your setup, protected
              </div>
              <p className="mt-2 text-xs leading-5 text-muted">
                Your connection is encrypted and only used to deliver alerts to your team.
              </p>
              <div className="my-5 h-px bg-line/70" />
              <ul className="space-y-3 text-xs leading-5 text-muted">
                <li className="flex gap-2.5">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                  No code or technical setup required
                </li>
                <li className="flex gap-2.5">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                  You approve access directly with Slack
                </li>
                <li className="flex gap-2.5">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                  You can change integrations later
                </li>
              </ul>
              <div className="mt-6 rounded-2xl border border-accent/15 bg-accent/5 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-accent">
                  Need a hand?
                </p>
                <p className="mt-1.5 text-xs leading-5 text-muted">
                  You can safely leave and return to setup at any time in this browser.
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
