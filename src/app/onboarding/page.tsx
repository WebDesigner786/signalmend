"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  CloudCog,
  HeartPulse,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  MessageSquare,
  Radio,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { useDashboardSession } from "../../lib/dashboard-session";

const INDUSTRIES: Array<{
  name: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    name: "E-Commerce",
    description: "Order flow, checkout, and storefront signals.",
    icon: ShoppingBag,
  },
  {
    name: "Healthcare",
    description: "Care systems and service availability.",
    icon: HeartPulse,
  },
  {
    name: "FinTech",
    description: "Payments, transactions, and risk signals.",
    icon: Landmark,
  },
  {
    name: "DevOps / SaaS",
    description: "Infrastructure, APIs, and product reliability.",
    icon: CloudCog,
  },
  {
    name: "Real Estate",
    description: "Listings, applications, and property platforms.",
    icon: Store,
  },
  {
    name: "Other",
    description: "A flexible signal profile for your business.",
    icon: Workflow,
  },
];

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

function isWorkspaceOption(value: unknown): value is WorkspaceOption {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    (typeof record.tenantId === "string" || record.tenantId === null)
  );
}

function isSlackStatus(value: unknown): value is SlackStatus {
  if (typeof value !== "object" || value === null) return false;
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

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-2xl border border-indigo-300/15 bg-gradient-to-br from-indigo-400/20 via-violet-500/15 to-cyan-400/10 text-indigo-200 shadow-[0_0_34px_rgba(99,102,241,0.16)] ${
        compact ? "h-10 w-10" : "h-12 w-12"
      }`}
    >
      <Activity size={compact ? 19 : 22} strokeWidth={2.2} />
    </span>
  );
}

function Stepper({
  step,
  verified,
}: {
  step: WizardStep;
  verified: boolean;
}) {
  const steps = [
    { number: 1, title: "Business profile", detail: "Make it yours" },
    { number: 2, title: "Connect Slack", detail: "Bring your team in" },
    { number: 3, title: "Go live", detail: "Verify your setup" },
  ] as const;

  return (
    <ol aria-label="Onboarding progress" className="grid grid-cols-3">
      {steps.map((item, index) => {
        const complete = item.number < step || (item.number === 3 && verified);
        const current = item.number === step;
        return (
          <li key={item.number} className="relative min-w-0">
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={`absolute left-7 right-0 top-[17px] h-px sm:left-9 ${
                  item.number < step
                    ? "bg-emerald-400/60"
                    : "bg-white/[0.09]"
                }`}
              />
            ) : null}
            <div className="relative z-10 flex items-start gap-2.5 sm:gap-3">
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors sm:h-10 sm:w-10 ${
                  complete
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                    : current
                      ? "border-indigo-300/40 bg-indigo-400/15 text-indigo-200 shadow-[0_0_20px_rgba(129,140,248,0.16)]"
                      : "border-white/10 bg-white/[0.03] text-slate-500"
                }`}
              >
                {complete ? <Check size={16} /> : `0${item.number}`}
              </span>
              <span className="min-w-0 pt-0.5">
                <span
                  className={`block truncate text-[11px] font-semibold sm:text-xs ${
                    current || complete ? "text-slate-100" : "text-slate-500"
                  }`}
                >
                  {item.title}
                </span>
                <span className="mt-1 hidden text-[10px] text-slate-500 sm:block">
                  {item.detail}
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function AccessGate({ onSave }: { onSave: (token: string) => void }) {
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = accessToken.trim();
    if (value.length < 20) {
      setError("Enter a valid workspace access token to continue.");
      return;
    }
    setError("");
    onSave(value);
  };

  return (
    <section className="mx-auto w-full max-w-xl overflow-hidden rounded-[28px] border border-white/10 bg-[#0e111c]/90 shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
      <div className="h-px bg-gradient-to-r from-transparent via-indigo-300/60 to-transparent" />
      <div className="p-6 sm:p-9">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-300/15 bg-indigo-400/10 text-indigo-200">
          <LockKeyhole size={21} />
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-200">
          Secure workspace access
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Let’s set up your operations
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-slate-400">
          Your workspace access token is used only to authorize setup actions.
          It stays in this browser session and is never sent to Slack.
        </p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <label
            htmlFor="workspace-access-token"
            className="block text-xs font-medium text-slate-300"
          >
            Workspace access token
          </label>
          <textarea
            id="workspace-access-token"
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your secure access token"
            className="min-h-28 w-full resize-y rounded-2xl border border-white/10 bg-[#090b12] px-4 py-3.5 font-mono text-xs leading-5 text-slate-100 placeholder:text-slate-600 transition focus:border-indigo-300/40 focus:outline-none focus:ring-4 focus:ring-indigo-400/10"
          />
          {error ? (
            <p role="alert" className="text-xs text-rose-300">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
          >
            Continue to setup
            <ArrowRight
              size={16}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </button>
        </form>
        <div className="mt-6 flex items-start gap-2.5 border-t border-white/[0.07] pt-5 text-[11px] leading-5 text-slate-500">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-300" />
          <p>
            This is your SignalMend workspace credential, not a Slack token.
            Slack connects separately through its secure OAuth approval flow.
          </p>
        </div>
      </div>
    </section>
  );
}

function FieldLabel({
  htmlFor,
  children,
  optional,
}: {
  htmlFor: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-xs font-semibold text-slate-200"
    >
      {children}
      {optional ? (
        <span className="ml-1.5 font-normal text-slate-500">Optional</span>
      ) : null}
    </label>
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

  const isVerified = status?.verificationStatus === "verified";
  const shouldPoll =
    step === 3 &&
    Boolean(tenantId) &&
    Boolean(token) &&
    status?.verificationStatus !== "verified" &&
    status?.verificationStatus !== "failed";

  useEffect(() => {
    if (!ready || !token) return;

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
          throw new Error(
            getErrorMessage(body, "Available workspaces could not be loaded."),
          );
        }
        if (
          typeof body !== "object" ||
          body === null ||
          !("workspaces" in body) ||
          !Array.isArray(body.workspaces) ||
          !body.workspaces.every(isWorkspaceOption)
        ) {
          throw new Error("Available workspaces returned an unexpected response.");
        }
        if (!active) return;

        const options = body.workspaces;
        setWorkspaces(options);
        const savedWorkspaceId = window.sessionStorage.getItem(
          ONBOARDING_WORKSPACE_KEY,
        );
        const preferredId =
          sessionWorkspaceId || savedWorkspaceId || options[0]?.id || "";
        const preferred = options.find((workspace) => workspace.id === preferredId);
        const linkedTenant = options.find(
          (workspace) => workspace.tenantId === tenantId,
        );
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
        if (active) setWorkspacesLoading(false);
      }
    };

    void loadWorkspaces();
    return () => {
      active = false;
    };
  }, [ready, token, sessionWorkspaceId, tenantId]);

  const loadSlackStatus = useCallback(async () => {
    if (!tenantId || !token) return;
    const response = await fetch(
      `/api/onboarding/slack-status?tenantId=${encodeURIComponent(tenantId)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
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
    if (!ready) return;
    const query = new URLSearchParams(window.location.search);
    const returnedTenantId = query.get("tenantId");
    const savedTenantId = window.sessionStorage.getItem(ONBOARDING_TENANT_KEY);
    const savedWorkspaceId = window.sessionStorage.getItem(
      ONBOARDING_WORKSPACE_KEY,
    );
    const currentTenantId = returnedTenantId ?? savedTenantId;

    if (savedWorkspaceId) {
      setSelectedWorkspaceId(savedWorkspaceId);
      setWorkspaceId(savedWorkspaceId);
    }
    if (!currentTenantId) return;

    setTenantId(currentTenantId);
    const connectionResult = query.get("slack");
    setStep(
      connectionResult === "connected" || connectionResult === "failed" ? 3 : 2,
    );
    if (connectionResult === "declined") {
      setError(
        "Slack authorization was canceled. You can connect it whenever you’re ready.",
      );
    }
    if (
      connectionResult === "connected" ||
      connectionResult === "failed"
    ) {
      window.sessionStorage.setItem(ONBOARDING_TENANT_KEY, currentTenantId);
    }
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [ready, setWorkspaceId]);

  useEffect(() => {
    if (!shouldPoll) return;
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
  }, [shouldPoll, loadSlackStatus]);

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
        throw new Error(
          getErrorMessage(body, "Your business could not be set up."),
        );
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
      window.sessionStorage.setItem(
        ONBOARDING_WORKSPACE_KEY,
        selectedWorkspaceId,
      );
      setStep(2);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your business could not be set up.",
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
        throw new Error(
          getErrorMessage(body, "Slack authorization could not be started."),
        );
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

  const stepContent = useMemo(() => {
    if (step === 1) {
      return {
        eyebrow: "01 / BUSINESS INTELLIGENCE",
        title: "Your business, understood.",
        description:
          "Tell us what you do. SignalMend tunes its incident context to the systems and signals that matter to your industry.",
      };
    }
    if (step === 2) {
      return {
        eyebrow: "02 / INTEGRATION MATRIX",
        title: "Bring your response team closer.",
        description:
          "Connect the Slack workspace where your team coordinates. Approval happens securely with Slack—no tokens to copy or manage.",
      };
    }
    return {
      eyebrow: "03 / CONNECTION HANDSHAKE",
      title: isVerified ? "Your operations are ready." : "We’re checking the connection.",
      description: isVerified
        ? "The workspace handshake is verified. SignalMend is ready to deliver incident alerts to your team."
        : "SignalMend is validating the Slack token lifecycle and workspace identity. This usually takes a few seconds.",
    };
  }, [step, isVerified]);

  if (!ready) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#080910] px-5 text-slate-400">
        <span className="flex items-center gap-3 text-sm">
          <LoaderCircle size={17} className="animate-spin text-indigo-300" />
          Preparing your secure workspace…
        </span>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080910] px-4 py-5 text-slate-100 selection:bg-indigo-400/30 sm:px-7 sm:py-7 lg:px-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-72 left-[38%] h-[520px] w-[760px] rounded-full bg-indigo-600/[0.12] blur-[140px]" />
        <div className="absolute -right-52 top-[38%] h-[420px] w-[420px] rounded-full bg-violet-600/[0.08] blur-[130px]" />
        <div className="absolute -bottom-72 -left-44 h-[460px] w-[560px] rounded-full bg-cyan-500/[0.05] blur-[140px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:72px_72px] opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
      </div>

      <div className="relative mx-auto max-w-7xl">
        <header className="mb-9 flex flex-wrap items-center justify-between gap-4 sm:mb-12">
          <a href="/dashboard" className="group flex items-center gap-3">
            <BrandMark compact />
            <span>
              <span className="block text-[15px] font-bold tracking-[-0.03em] text-white">
                SignalMend
              </span>
              <span className="mt-0.5 block text-[9px] font-medium uppercase tracking-[0.2em] text-slate-500">
                Incident Operations
              </span>
            </span>
          </a>
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-300/15 bg-indigo-400/[0.06] px-3.5 py-2 text-[10px] font-semibold tracking-wide text-indigo-100/90 shadow-[0_0_24px_rgba(99,102,241,0.08)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-300 opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-300" />
            </span>
            <span>⚡ AI Incident Operations</span>
          </div>
        </header>

        {!token ? (
          <div className="grid min-h-[68vh] place-items-center py-8">
            <AccessGate onSave={setToken} />
          </div>
        ) : (
          <>
            <div className="mb-8 grid gap-2 lg:mb-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-indigo-200/80">
                  <Sparkles size={13} />
                  Guided workspace setup
                </p>
                <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.045em] text-white sm:text-4xl lg:text-[46px]">
                  Better signals.
                  <span className="bg-gradient-to-r from-indigo-200 via-violet-200 to-cyan-200 bg-clip-text text-transparent">
                    {" "}Faster response.
                  </span>
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-[15px]">
                  Set up your incident operations in a few guided steps. Your
                  business context and integrations can be updated any time.
                </p>
              </div>
              <div className="hidden items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-2.5 text-[10px] text-slate-400 lg:flex">
                <ShieldCheck size={14} className="text-emerald-300" />
                Secure, guided setup
              </div>
            </div>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px] xl:gap-6">
              <section className="overflow-hidden rounded-[28px] border border-white/[0.09] bg-[#0d1019]/90 shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                <div className="h-px bg-gradient-to-r from-transparent via-indigo-300/40 to-transparent" />
                <div className="p-5 sm:p-8 lg:p-10">
                  <Stepper step={step} verified={Boolean(isVerified)} />

                  <div className="mb-7 mt-8 border-b border-white/[0.07] pb-6 sm:mb-8 sm:mt-10">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-indigo-200/75">
                      {stepContent.eyebrow}
                    </p>
                    <h2 className="mt-2.5 text-[25px] font-semibold tracking-[-0.04em] text-white sm:text-[32px]">
                      {stepContent.title}
                    </h2>
                    <p className="mt-2 max-w-2xl text-[13px] leading-6 text-slate-400 sm:text-sm">
                      {stepContent.description}
                    </p>
                  </div>

                  {step === 1 ? (
                    <form onSubmit={saveBusiness} className="space-y-7">
                      <div>
                        <FieldLabel htmlFor="business-name">
                          Business name
                        </FieldLabel>
                        <div className="group relative">
                          <Store
                            size={17}
                            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-indigo-200"
                          />
                          <input
                            id="business-name"
                            required
                            minLength={2}
                            maxLength={255}
                            value={businessName}
                            onChange={(event) =>
                              setBusinessName(event.target.value)
                            }
                            placeholder="e.g. Northstar Health"
                            className="w-full rounded-2xl border border-white/[0.09] bg-[#090b12]/80 py-3.5 pl-11 pr-4 text-sm text-white placeholder:text-slate-600 transition hover:border-white/[0.14] focus:border-indigo-300/40 focus:outline-none focus:ring-4 focus:ring-indigo-400/[0.08]"
                          />
                        </div>
                        <p className="mt-2 text-[10px] text-slate-500">
                          This name appears in your incident workspace and
                          alert context.
                        </p>
                      </div>

                      <div>
                        <FieldLabel htmlFor="business-workspace">
                          Workspace
                        </FieldLabel>
                        <select
                          id="business-workspace"
                          required
                          value={selectedWorkspaceId}
                          disabled={workspacesLoading || workspaces.length === 0}
                          onChange={(event) => {
                            setSelectedWorkspaceId(event.target.value);
                            setWorkspaceId(event.target.value);
                          }}
                          className="w-full appearance-none rounded-2xl border border-white/[0.09] bg-[#090b12]/80 px-4 py-3.5 text-sm text-white transition hover:border-white/[0.14] focus:border-indigo-300/40 focus:outline-none focus:ring-4 focus:ring-indigo-400/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
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
                          <p className="mt-2 text-[11px] leading-5 text-amber-200/80">
                            Ask a workspace owner or administrator to grant you
                            access before continuing.
                          </p>
                        ) : null}
                      </div>

                      <fieldset>
                        <legend className="text-xs font-semibold text-slate-200">
                          What industry are you in?
                        </legend>
                        <p className="mb-4 mt-1.5 text-[11px] leading-5 text-slate-500">
                          Your selection helps tailor incident context and
                          automation to your sector.
                        </p>
                        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                          {INDUSTRIES.map((industry) => {
                            const Icon = industry.icon;
                            const selected = businessNiche === industry.name;
                            return (
                              <button
                                key={industry.name}
                                type="button"
                                aria-pressed={selected}
                                onClick={() =>
                                  setBusinessNiche(industry.name)
                                }
                                className={`group relative min-h-[92px] rounded-2xl border p-3.5 text-left transition duration-200 ${
                                  selected
                                    ? "border-indigo-300/35 bg-indigo-400/[0.09] shadow-[inset_0_0_24px_rgba(99,102,241,0.06)]"
                                    : "border-white/[0.07] bg-white/[0.018] hover:border-white/[0.14] hover:bg-white/[0.035]"
                                }`}
                              >
                                <span className="flex items-start justify-between gap-2">
                                  <span
                                    className={`grid h-8 w-8 place-items-center rounded-xl border transition-colors ${
                                      selected
                                        ? "border-indigo-300/20 bg-indigo-300/10 text-indigo-200"
                                        : "border-white/[0.07] bg-white/[0.03] text-slate-400 group-hover:text-slate-200"
                                    }`}
                                  >
                                    <Icon size={15} />
                                  </span>
                                  {selected ? (
                                    <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-300 text-[#111321]">
                                      <Check size={12} strokeWidth={3} />
                                    </span>
                                  ) : null}
                                </span>
                                <span className="mt-3 block text-[11px] font-semibold text-slate-100">
                                  {industry.name}
                                </span>
                                <span className="mt-1 block text-[9px] leading-4 text-slate-500">
                                  {industry.description}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </fieldset>

                      {error ? (
                        <p
                          role="alert"
                          className="rounded-xl border border-rose-300/15 bg-rose-400/[0.06] px-4 py-3 text-xs leading-5 text-rose-200"
                        >
                          {error}
                        </p>
                      ) : null}

                      <div className="flex flex-col-reverse justify-between gap-3 border-t border-white/[0.07] pt-5 sm:flex-row sm:items-center">
                        <p className="flex items-center gap-2 text-[10px] text-slate-500">
                          <LockKeyhole
                            size={13}
                            className="text-emerald-300/80"
                          />
                          Your business profile is private to your workspace.
                        </p>
                        <button
                          type="submit"
                          disabled={
                            savingBusiness ||
                            !businessName.trim() ||
                            !businessNiche ||
                            !selectedWorkspaceId
                          }
                          className="group inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-3 text-xs font-semibold text-white shadow-lg shadow-indigo-950/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {savingBusiness ? (
                            <>
                              <LoaderCircle
                                size={15}
                                className="animate-spin"
                              />
                              Saving profile…
                            </>
                          ) : (
                            <>
                              Continue to integrations
                              <ArrowRight
                                size={15}
                                className="transition-transform group-hover:translate-x-0.5"
                              />
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {step === 2 ? (
                    <div className="animate-in fade-in duration-300">
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_230px]">
                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6">
                          <div className="flex items-start gap-4">
                            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-violet-300/15 bg-violet-400/[0.08] text-violet-200">
                              <MessageSquare size={22} />
                            </span>
                            <div>
                              <p className="text-sm font-semibold text-white">
                                Slack Workspace
                              </p>
                              <p className="mt-1 text-[11px] leading-5 text-slate-400">
                                Send incident alerts into the channels your
                                team chooses during Slack approval.
                              </p>
                            </div>
                          </div>
                          <div className="mt-5 space-y-2.5 border-t border-white/[0.07] pt-4">
                            {[
                              "Secure Slack-hosted approval",
                              "Workspace identity verification",
                              "Revoke access any time",
                            ].map((item) => (
                              <p
                                key={item}
                                className="flex items-center gap-2.5 text-[10px] text-slate-400"
                              >
                                <CheckCircle2
                                  size={14}
                                  className="shrink-0 text-emerald-300/80"
                                />
                                {item}
                              </p>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-col justify-between rounded-2xl border border-white/[0.07] bg-[#090b12]/60 p-4">
                          <div>
                            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                              Business profile
                            </p>
                            <p className="mt-2 truncate text-sm font-semibold text-slate-100">
                              {businessName || status?.businessName}
                            </p>
                            <p className="mt-1 text-[10px] text-slate-500">
                              {businessNiche || status?.businessNiche}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setError("");
                              setStep(1);
                            }}
                            className="mt-5 inline-flex items-center gap-1.5 self-start text-[10px] font-medium text-indigo-200/80 transition hover:text-indigo-100"
                          >
                            <ArrowLeft size={12} />
                            Edit details
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.035] p-4">
                        <LockKeyhole
                          size={15}
                          className="mt-0.5 shrink-0 text-emerald-200"
                        />
                        <p className="text-[10px] leading-5 text-slate-300">
                          🔒 Enterprise-grade AES-256 OAuth isolation.
                          SignalMend never reads unauthorized messaging
                          channels.
                        </p>
                      </div>

                      {error ? (
                        <p
                          role="alert"
                          className="mt-4 rounded-xl border border-rose-300/15 bg-rose-400/[0.06] px-4 py-3 text-xs leading-5 text-rose-200"
                        >
                          {error}
                        </p>
                      ) : null}

                      <div className="mt-6 flex flex-col-reverse justify-between gap-3 border-t border-white/[0.07] pt-5 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs font-medium text-slate-400 transition hover:border-white/20 hover:text-white"
                        >
                          <ArrowLeft size={14} />
                          Back
                        </button>
                        <button
                          type="button"
                          onClick={() => void connectSlack()}
                          disabled={connectingSlack || !tenantId}
                          className="group inline-flex items-center justify-center gap-2.5 rounded-xl bg-[#4A154B] px-5 py-3.5 text-xs font-semibold text-white shadow-lg shadow-purple-950/30 transition hover:bg-[#5b1d5d] disabled:cursor-wait disabled:opacity-60"
                        >
                          {connectingSlack ? (
                            <>
                              <LoaderCircle
                                size={15}
                                className="animate-spin"
                              />
                              Opening secure Slack approval…
                            </>
                          ) : (
                            <>
                              <MessageSquare size={16} />
                              Connect Slack Workspace
                              <ArrowRight
                                size={14}
                                className="transition-transform group-hover:translate-x-0.5"
                              />
                            </>
                          )}
                        </button>
                      </div>
                      <p className="mt-4 text-center text-[10px] leading-5 text-slate-500">
                        You’ll be redirected to Slack to review and approve
                        access. Your Slack password is never shared with us.
                      </p>
                    </div>
                  ) : null}

                  {step === 3 ? (
                    <div className="animate-in fade-in duration-300">
                      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090b12]/70">
                        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-4 sm:px-6">
                          <div>
                            <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-slate-500">
                              Workspace handshake
                            </p>
                            <h3 className="mt-1 text-sm font-semibold text-white">
                              {businessName || status?.businessName || "Your business"}
                            </h3>
                          </div>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[9px] font-semibold ${
                              isVerified
                                ? "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-200"
                                : status?.verificationStatus === "failed"
                                  ? "border-rose-300/20 bg-rose-300/[0.06] text-rose-200"
                                  : "border-indigo-300/20 bg-indigo-300/[0.06] text-indigo-100"
                            }`}
                          >
                            {isVerified ? (
                              <CheckCircle2 size={12} />
                            ) : status?.verificationStatus === "failed" ? (
                              <Circle size={11} />
                            ) : (
                              <LoaderCircle
                                size={12}
                                className="animate-spin"
                              />
                            )}
                            {isVerified
                              ? "Verified"
                              : status?.verificationStatus === "failed"
                                ? "Needs attention"
                                : "Verifying"}
                          </span>
                        </div>

                        <ol className="divide-y divide-white/[0.06] px-5 sm:px-6">
                          <li className="flex gap-3.5 py-5">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-200">
                              <Check size={15} />
                            </span>
                            <div className="pt-0.5">
                              <p className="text-xs font-semibold text-slate-100">
                                Business profile saved
                              </p>
                              <p className="mt-1 text-[10px] text-slate-500">
                                {businessNiche || status?.businessNiche}
                              </p>
                            </div>
                          </li>
                          <li className="flex gap-3.5 py-5">
                            <span
                              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border ${
                                isVerified
                                  ? "border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-200"
                                  : status?.verificationStatus === "failed"
                                    ? "border-rose-300/15 bg-rose-300/[0.06] text-rose-200"
                                    : "border-indigo-300/15 bg-indigo-300/[0.06] text-indigo-200"
                              }`}
                            >
                              {isVerified ? (
                                <Check size={15} />
                              ) : status?.verificationStatus === "failed" ? (
                                <Circle size={13} />
                              ) : (
                                <LoaderCircle
                                  size={15}
                                  className="animate-spin"
                                />
                              )}
                            </span>
                            <div className="pt-0.5">
                              <p className="text-xs font-semibold text-slate-100">
                                {isVerified
                                  ? "Slack workspace verified"
                                  : status?.verificationStatus === "failed"
                                    ? "Slack connection needs attention"
                                    : "Verifying Slack workspace"}
                              </p>
                              <p className="mt-1 max-w-xl text-[10px] leading-5 text-slate-500">
                                {isVerified
                                  ? `Connected${status?.teamName ? ` to ${status.teamName}` : ""}. Your team can receive incident alerts.`
                                  : status?.verificationStatus === "failed"
                                    ? status.verificationError ||
                                      "We could not verify this connection. Reconnect Slack to try again."
                                    : "We’re validating your workspace and token lifecycle. You can leave this page and return later."}
                              </p>
                            </div>
                          </li>
                          <li className="flex gap-3.5 py-5">
                            <span
                              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border ${
                                isVerified
                                  ? "border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-200"
                                  : "border-white/[0.07] bg-white/[0.025] text-slate-600"
                              }`}
                            >
                              {isVerified ? <Check size={15} /> : <Radio size={14} />}
                            </span>
                            <div className="pt-0.5">
                              <p className="text-xs font-semibold text-slate-100">
                                Ready for your first alert
                              </p>
                              <p className="mt-1 text-[10px] leading-5 text-slate-500">
                                {isVerified
                                  ? "Your incident operations workspace is live."
                                  : "This step completes as soon as verification succeeds."}
                              </p>
                            </div>
                          </li>
                        </ol>
                      </div>

                      {statusError ? (
                        <div
                          role="alert"
                          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-300/15 bg-rose-400/[0.05] px-4 py-3"
                        >
                          <p className="text-[11px] leading-5 text-rose-200">
                            {statusError}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              void loadSlackStatus().catch((caught: unknown) =>
                                setStatusError(
                                  caught instanceof Error
                                    ? caught.message
                                    : "Status refresh failed.",
                                ),
                              )
                            }
                            className="text-[10px] font-semibold text-rose-100 underline underline-offset-2"
                          >
                            Retry check
                          </button>
                        </div>
                      ) : null}

                      <div className="mt-5 flex flex-col-reverse justify-between gap-3 sm:flex-row">
                        {!isVerified ? (
                          <button
                            type="button"
                            onClick={() => {
                              setError("");
                              setStep(2);
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs font-medium text-slate-400 transition hover:border-white/20 hover:text-white"
                          >
                            <ArrowLeft size={14} />
                            Back to integrations
                          </button>
                        ) : (
                          <p className="flex items-center gap-2 py-3 text-[10px] text-emerald-200/80">
                            <CheckCircle2 size={14} />
                            Setup complete
                          </p>
                        )}
                        {status?.verificationStatus === "failed" ? (
                          <button
                            type="button"
                            onClick={() => void connectSlack()}
                            disabled={connectingSlack}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#4A154B] px-5 py-3 text-xs font-semibold text-white transition hover:bg-[#5b1d5d] disabled:opacity-60"
                          >
                            <MessageSquare size={15} />
                            Reconnect Slack
                            <ArrowRight size={14} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>

              <aside className="space-y-4">
                <section className="rounded-[24px] border border-white/[0.08] bg-[#0d1019]/80 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl border border-indigo-300/15 bg-indigo-300/[0.07] text-indigo-200">
                      <Activity size={16} />
                    </span>
                    <div>
                      <h3 className="text-xs font-semibold text-white">
                        Incident operations
                      </h3>
                      <p className="mt-0.5 text-[9px] text-slate-500">
                        Your setup at a glance
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-500">
                        Business
                      </p>
                      <p className="mt-1.5 truncate text-xs font-medium text-slate-200">
                        {businessName || "Not set yet"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-500">
                        Industry profile
                      </p>
                      <p className="mt-1.5 text-xs font-medium text-slate-200">
                        {businessNiche || "Choose your industry"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-500">
                        Slack integration
                      </p>
                      <p className="mt-1.5 flex items-center gap-2 text-xs font-medium text-slate-200">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isVerified
                              ? "bg-emerald-300"
                              : status?.verificationStatus === "failed"
                                ? "bg-rose-300"
                                : "bg-slate-600"
                          }`}
                        />
                        {isVerified
                          ? status?.teamName || "Verified"
                          : status?.verificationStatus === "failed"
                            ? "Action required"
                            : "Not connected"}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-[24px] border border-emerald-300/10 bg-emerald-300/[0.025] p-5">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={15} className="text-emerald-200" />
                    <h3 className="text-[11px] font-semibold text-slate-100">
                      Built for secure response
                    </h3>
                  </div>
                  <p className="mt-2.5 text-[10px] leading-5 text-slate-400">
                    Credentials are encrypted at rest. Slack connections are
                    authorized by your workspace and verified before setup is
                    marked complete.
                  </p>
                </section>

                <p className="px-1 text-[9px] leading-4 text-slate-600">
                  Need help? Contact your workspace administrator for access
                  or integration permissions.
                </p>
              </aside>
            </div>
          </>
        )}

        <footer className="relative mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-5 text-[9px] text-slate-600">
          <span>SignalMend · Incident Operations</span>
          <span className="inline-flex items-center gap-1.5">
            <Radio size={11} />
            Secure onboarding
          </span>
        </footer>
      </div>
    </main>
  );
}
