"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CloudCog,
  Eye,
  EyeOff,
  HeartPulse,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  Mail,
  MessageSquare,
  Moon,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Sun,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { signIn, signOut, useSession } from "next-auth/react";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

const INDUSTRIES: Array<{
  name: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    name: "E-Commerce",
    description: "Surface checkout, order, and storefront disruptions.",
    icon: ShoppingBag,
  },
  {
    name: "DevOps & Infrastructure",
    description: "Prioritize API, deployment, and infrastructure alerts.",
    icon: CloudCog,
  },
  {
    name: "HealthTech",
    description: "Spot critical care platform and service interruptions.",
    icon: HeartPulse,
  },
  {
    name: "FinTech",
    description: "Route payment, transaction, and risk signals faster.",
    icon: Landmark,
  },
  {
    name: "Real Estate",
    description: "Monitor listing, application, and property workflows.",
    icon: Store,
  },
  {
    name: "Other",
    description: "Build a useful signal profile for your business.",
    icon: Workflow,
  },
];

const TENANT_STORAGE_KEY = "signalmend.onboarding.tenant.v1";
const WORKSPACE_STORAGE_KEY = "signalmend.onboarding.workspace.v1";
const THEME_STORAGE_KEY = "signalmend.onboarding.theme";

type WizardStep = 1 | 2 | 3;
type VerificationStatus = "not_connected" | "pending" | "verified" | "failed";
type AuthMode = "signin" | "signup";

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

function isWorkspace(value: unknown): value is WorkspaceOption {
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

function Stepper({ step }: { step: WizardStep }) {
  const items = [
    { id: 1, title: "Create account", subtitle: "Secure sign-up" },
    { id: 2, title: "Niche profile", subtitle: "Business context" },
    { id: 3, title: "Connect Slack", subtitle: "Incident delivery" },
  ] as const;

  return (
    <ol aria-label="Onboarding progress" className="grid grid-cols-3">
      {items.map((item, index) => {
        const complete = item.id < step;
        const current = item.id === step;
        return (
          <li key={item.id} className="relative">
            {index === 0 ? (
              <span
                aria-hidden="true"
                className={`absolute left-9 right-0 top-4 h-px sm:left-10 ${
                  complete ? "bg-emerald-500/60" : "bg-line"
                }`}
              />
            ) : null}
            <div className="relative z-10 flex items-start gap-3">
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors ${
                  complete
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                    : current
                      ? "border-accent/40 bg-accent/10 text-accent shadow-[0_0_20px_rgba(99,102,241,0.12)]"
                      : "border-line bg-surface text-muted"
                }`}
              >
                {complete ? <Check size={15} /> : `0${item.id}`}
              </span>
              <span className="pt-0.5">
                <span
                  className={`block text-[11px] font-semibold sm:text-xs ${
                    current || complete ? "text-ink" : "text-muted"
                  }`}
                >
                  {item.title}
                </span>
                <span className="mt-1 hidden text-[10px] text-muted sm:block">
                  {item.subtitle}
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function AuthenticationPanel({
  onAuthenticated,
}: {
  onAuthenticated: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      if (mode === "signup") {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            name: name.trim() || undefined,
            email: email.trim(),
            password,
          }),
          cache: "no-store",
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            getErrorMessage(body, "Your account could not be created."),
          );
        }
      }

      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });
      if (!result || result.error) {
        throw new Error("Email or password is incorrect.");
      }
      onAuthenticated();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Authentication could not be completed.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-md overflow-hidden rounded-[26px] border border-line bg-surface/95 shadow-2xl shadow-black/20 backdrop-blur-xl">
      <div className="h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
      <div className="p-6 sm:p-8">
        <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
          {mode === "signin" ? <LogIn size={19} /> : <Sparkles size={19} />}
        </div>
        <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-accent">
          {mode === "signin" ? "Secure sign in" : "Create your account"}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          {mode === "signin" ? "Welcome to SignalMend" : "Start with SignalMend"}
        </h1>
        <p className="mt-2 text-xs leading-5 text-muted">
          {mode === "signin"
            ? "Sign in to configure your incident operations workspace."
            : "Create an account and sign in immediately to begin workspace setup."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "signup" ? (
            <div>
              <label htmlFor="signup-name" className="mb-1.5 block text-[11px] font-medium text-ink">
                Your name <span className="text-muted">(optional)</span>
              </label>
              <input
                id="signup-name"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={255}
                className="w-full rounded-xl border border-line bg-canvas/70 px-3.5 py-3 text-xs text-ink placeholder:text-muted/70"
              />
            </div>
          ) : null}
          <div>
            <label htmlFor="account-email" className="mb-1.5 block text-[11px] font-medium text-ink">
              Email address
            </label>
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="account-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={320}
                className="w-full rounded-xl border border-line bg-canvas/70 py-3 pl-10 pr-3.5 text-xs text-ink placeholder:text-muted/70"
              />
            </div>
          </div>
          <div>
            <label htmlFor="account-password" className="mb-1.5 block text-[11px] font-medium text-ink">
              Password
            </label>
            <div className="relative">
              <LockKeyhole size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="account-password"
                type={showPassword ? "text" : "password"}
                required
                minLength={mode === "signup" ? 12 : 1}
                maxLength={128}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-line bg-canvas/70 py-3 pl-10 pr-11 text-xs text-ink"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition hover:text-ink"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {mode === "signup" ? (
              <p className="mt-1.5 text-[9px] text-muted">
                Use at least 12 characters (maximum 72 bytes).
              </p>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3.5 py-2.5 text-[10px] leading-5 text-rose-500">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-3 text-xs font-semibold text-white shadow-lg shadow-indigo-950/20 transition hover:brightness-110 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <LoaderCircle size={15} className="animate-spin" />
                {mode === "signin" ? "Signing in…" : "Creating account…"}
              </>
            ) : (
              <>
                {mode === "signin" ? "Sign in securely" : "Create account"}
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </form>

        <div className="mt-5 border-t border-line pt-4 text-center text-[10px] text-muted">
          {mode === "signin" ? "New to SignalMend?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode((value) => (value === "signin" ? "signup" : "signin"));
              setError("");
            }}
            className="font-semibold text-accent transition hover:underline"
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[9px] text-muted">
          <ShieldCheck size={12} className="text-emerald-500" />
          Passwords are securely hashed before storage.
        </p>
      </div>
    </section>
  );
}

export default function OnboardingPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [step, setStep] = useState<WizardStep>(1);
  const [darkMode, setDarkMode] = useState(true);
  const [businessName, setBusinessName] = useState("");
  const [businessNiche, setBusinessNiche] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [connectingSlack, setConnectingSlack] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);

  const authenticated = sessionStatus === "authenticated" && Boolean(session?.user?.id);
  const verified = slackStatus?.verificationStatus === "verified";

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const nextDark = savedTheme ? savedTheme === "dark" : prefersDark;
    setDarkMode(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
  }, []);

  const toggleTheme = () => {
    setDarkMode((current) => {
      const next = !current;
      document.documentElement.classList.toggle("dark", next);
      window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
      return next;
    });
  };

  const loadSlackStatus = useCallback(async () => {
    if (!tenantId) return;
    const response = await fetch(
      `/api/onboarding/slack-status?tenantId=${encodeURIComponent(tenantId)}`,
      { cache: "no-store" },
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
    setSlackStatus(body);
    setBusinessName(body.businessName);
    setBusinessNiche(body.businessNiche);
    setStatusError("");
  }, [tenantId]);

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    const loadWorkspaces = async () => {
      setWorkspacesLoading(true);
      try {
        const response = await fetch("/api/onboarding", {
          headers: { accept: "application/json" },
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
          !body.workspaces.every(isWorkspace)
        ) {
          throw new Error("Available workspaces returned an unexpected response.");
        }
        if (!active) return;

        const options = body.workspaces;
        setWorkspaces(options);
        const savedWorkspace = window.sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
        const preferred = options.find((workspace) => workspace.id === savedWorkspace);
        const savedTenant = window.sessionStorage.getItem(TENANT_STORAGE_KEY);
        const linked = options.find((workspace) => workspace.tenantId === savedTenant);
        const selected = linked?.id ?? preferred?.id ?? options[0]?.id ?? "";
        setWorkspaceId(selected);
        const existingTenantId =
          linked?.tenantId ??
          preferred?.tenantId ??
          options.find((workspace) => workspace.id === selected)?.tenantId ??
          null;
        if (existingTenantId) {
          setTenantId(existingTenantId);
          setStep(3);
          window.sessionStorage.setItem(TENANT_STORAGE_KEY, existingTenantId);
        } else {
          setStep(2);
        }
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
          setWorkspacesLoaded(true);
        }
      }
    };

    void loadWorkspaces();
    return () => {
      active = false;
    };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !workspacesLoaded) return;
    const query = new URLSearchParams(window.location.search);
    const returnedTenant = query.get("tenantId");
    const savedTenant = window.sessionStorage.getItem(TENANT_STORAGE_KEY);
    const nextTenant = returnedTenant ?? savedTenant;
    const result = query.get("slack");

    if (nextTenant && workspaces.some((workspace) => workspace.tenantId === nextTenant)) {
      setTenantId(nextTenant);
      setStep(3);
      window.sessionStorage.setItem(TENANT_STORAGE_KEY, nextTenant);
    } else if (nextTenant) {
      window.sessionStorage.removeItem(TENANT_STORAGE_KEY);
      setTenantId("");
      setStep(2);
      setError("That business workspace is not available to this account. Choose an authorized workspace to continue.");
    }
    if (result === "declined") {
      setError("Slack authorization was canceled. You can connect whenever you’re ready.");
    } else if (result === "failed") {
      setStatusError("Slack verification did not complete. Reconnect to try again.");
    }
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [authenticated, workspaces, workspacesLoaded]);

  useEffect(() => {
    if (step !== 3 || !tenantId || !authenticated) return;
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
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [step, tenantId, authenticated, loadSlackStatus]);

  const saveBusiness = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingBusiness(true);
    setError("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          businessName: businessName.trim(),
          businessNiche,
          ...(workspaceId ? { workspaceId } : {}),
          ...(tenantId ? { tenantId } : {}),
        }),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "Your business profile could not be saved."),
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

      const nextWorkspaceId =
        "workspaceId" in body && typeof body.workspaceId === "string"
          ? body.workspaceId
          : workspaceId;
      setTenantId(body.tenantId);
      setWorkspaceId(nextWorkspaceId);
      setSlackStatus({
        businessName: businessName.trim(),
        businessNiche,
        verificationStatus: "not_connected",
        teamName: null,
        verifiedAt: null,
        verificationError: null,
      });
      window.sessionStorage.setItem(TENANT_STORAGE_KEY, body.tenantId);
      if (nextWorkspaceId) {
        window.sessionStorage.setItem(WORKSPACE_STORAGE_KEY, nextWorkspaceId);
      }
      setStep(3);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your business profile could not be saved.",
      );
    } finally {
      setSavingBusiness(false);
    }
  };

  const connectSlack = async () => {
    setConnectingSlack(true);
    setError("");
    try {
      const response = await fetch("/api/auth/slack/start", {
        method: "POST",
        headers: {
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

      const authorizationUrl = new URL(body.authorizationUrl);
      if (authorizationUrl.origin !== "https://slack.com") {
        throw new Error("The authorization response did not come from Slack.");
      }
      window.location.href = authorizationUrl.toString();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Slack authorization could not be started.",
      );
      setConnectingSlack(false);
    }
  };

  if (sessionStatus === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-canvas text-muted">
        <span className="flex items-center gap-3 text-sm">
          <LoaderCircle size={17} className="animate-spin text-accent" />
          Restoring your secure session…
        </span>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas px-4 py-5 text-ink sm:px-7 sm:py-7 lg:px-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-72 left-[38%] h-[520px] w-[760px] rounded-full bg-accent/[0.12] blur-[140px]" />
        <div className="absolute -right-52 top-[38%] h-[420px] w-[420px] rounded-full bg-violet-500/[0.08] blur-[130px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(127,127,127,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(127,127,127,0.035)_1px,transparent_1px)] bg-[size:72px_72px] opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
      </div>

      <div className="relative mx-auto max-w-7xl">
        <header className="mb-9 flex flex-wrap items-center justify-between gap-4 sm:mb-12">
          <a href="/dashboard" className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl border border-accent/20 bg-gradient-to-br from-indigo-500/15 via-violet-500/10 to-cyan-400/10 text-accent shadow-[0_0_30px_rgba(99,102,241,0.14)]">
              <Activity size={19} />
            </span>
            <span>
              <span className="block text-[15px] font-bold tracking-tight text-ink">
                SignalMend
              </span>
              <span className="mt-0.5 block text-[9px] font-medium uppercase tracking-[0.2em] text-muted">
                Incident Operations
              </span>
            </span>
          </a>
          <div className="flex items-center gap-2">
            {authenticated ? (
              <button
                type="button"
                onClick={() => void signOut({ callbackUrl: "/onboarding" })}
                className="rounded-lg border border-line bg-surface/70 px-3 py-2 text-[10px] font-medium text-muted transition hover:text-ink"
              >
                Sign out
              </button>
            ) : null}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
              className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface/70 text-muted transition hover:text-ink"
            >
              {darkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/[0.06] px-3.5 py-2 text-[10px] font-semibold tracking-wide text-accent">
              <Sparkles size={12} />
              ⚡ AI Incident Operations
            </span>
          </div>
        </header>

        {!authenticated ? (
          <div className="grid min-h-[68vh] place-items-center py-8">
            <div className="w-full max-w-2xl">
              <div className="mb-5 rounded-2xl border border-line bg-surface/75 p-5 backdrop-blur-xl sm:p-6">
                <Stepper step={1} />
              </div>
              <AuthenticationPanel onAuthenticated={() => window.location.reload()} />
            </div>
          </div>
        ) : (
          <>
            <div className="mb-8 grid gap-3 lg:mb-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <p className="mb-3 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.24em] text-accent">
                  <Sparkles size={13} />
                  Guided workspace setup
                </p>
                <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl lg:text-[46px]">
                  Better signals.
                  <span className="bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-500 bg-clip-text text-transparent dark:from-indigo-200 dark:via-violet-200 dark:to-cyan-200">
                    {" "}Faster response.
                  </span>
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
                  Set up your incident operations in three guided steps. Your
                  workspace profile can be changed at any time.
                </p>
              </div>
              <p className="hidden items-center gap-2 text-[10px] text-muted lg:flex">
                <ShieldCheck size={14} className="text-emerald-500" />
                Secure, session-based setup
              </p>
            </div>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_290px] xl:gap-6">
              <section className="overflow-hidden rounded-[26px] border border-line bg-surface/90 shadow-[0_28px_90px_rgba(0,0,0,0.14)] backdrop-blur-xl">
                <div className="h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
                <div className="p-5 sm:p-8 lg:p-10">
                  <Stepper step={step} />

                  <div className="mb-7 mt-8 border-b border-line pb-6 sm:mb-8 sm:mt-10">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-accent">
                      {step === 2
                        ? "02 / NICHE PROFILE"
                        : "03 / HANDS-FREE INTEGRATION"}
                    </p>
                    <h2 className="mt-2.5 text-[25px] font-semibold tracking-[-0.04em] text-ink sm:text-[32px]">
                      {step === 2
                        ? "Make incident intelligence yours."
                        : "Bring your response team closer."}
                    </h2>
                    <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted sm:text-sm">
                      {step === 2
                        ? "Tell us about your business so SignalMend can prioritize the alerts and workflows that matter to your sector."
                        : "Connect the Slack workspace where your team coordinates. Approval happens securely with Slack—no tokens to copy."}
                    </p>
                  </div>

                  {step === 2 ? (
                    <form onSubmit={saveBusiness} className="space-y-7">
                      <div>
                        <label htmlFor="business-name" className="mb-2 block text-xs font-semibold text-ink">
                          Business name
                        </label>
                        <div className="group relative">
                          <Store size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted transition group-focus-within:text-accent" />
                          <input
                            id="business-name"
                            required
                            minLength={2}
                            maxLength={255}
                            value={businessName}
                            onChange={(event) => setBusinessName(event.target.value)}
                            placeholder="e.g. Northstar Health"
                            className="w-full rounded-2xl border border-line bg-canvas/75 py-3.5 pl-11 pr-4 text-sm text-ink placeholder:text-muted/70 transition focus:border-accent/40 focus:outline-none focus:ring-4 focus:ring-accent/[0.08]"
                          />
                        </div>
                      </div>

                      {workspaces.length > 0 ? (
                        <div>
                          <label htmlFor="workspace-select" className="mb-2 block text-xs font-semibold text-ink">
                            Workspace
                          </label>
                          <select
                            id="workspace-select"
                            value={workspaceId}
                            onChange={(event) => setWorkspaceId(event.target.value)}
                            disabled={workspacesLoading}
                            className="w-full rounded-2xl border border-line bg-canvas/75 px-4 py-3.5 text-sm text-ink focus:border-accent/40 focus:outline-none focus:ring-4 focus:ring-accent/[0.08]"
                          >
                            {workspaces.map((workspace) => (
                              <option key={workspace.id} value={workspace.id}>
                                {workspace.name}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1.5 text-[10px] text-muted">
                            Choose a workspace you own or administer.
                          </p>
                        </div>
                      ) : null}

                      <fieldset>
                        <legend className="text-xs font-semibold text-ink">
                          Choose your industry
                        </legend>
                        <p className="mb-4 mt-1.5 text-[10px] leading-5 text-muted">
                          SignalMend adapts alert context and automation to your
                          business—not the other way around.
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
                                onClick={() => setBusinessNiche(industry.name)}
                                className={`group min-h-[116px] rounded-2xl border p-3.5 text-left transition duration-200 ${
                                  selected
                                    ? "border-accent/45 bg-accent/[0.08] shadow-[inset_0_0_24px_rgba(99,102,241,0.06)]"
                                    : "border-line bg-canvas/45 hover:border-accent/25 hover:bg-canvas/75"
                                }`}
                              >
                                <span className="flex items-start justify-between gap-2">
                                  <span className={`grid h-8 w-8 place-items-center rounded-xl border ${
                                    selected
                                      ? "border-accent/20 bg-accent/10 text-accent"
                                      : "border-line bg-surface text-muted group-hover:text-ink"
                                  }`}>
                                    <Icon size={15} />
                                  </span>
                                  {selected ? (
                                    <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-white">
                                      <Check size={12} strokeWidth={3} />
                                    </span>
                                  ) : null}
                                </span>
                                <span className="mt-3 block text-[11px] font-semibold text-ink">
                                  {industry.name}
                                </span>
                                <span className="mt-1 block text-[9px] leading-4 text-muted">
                                  {industry.description}
                                </span>
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

                      <div className="flex flex-col-reverse justify-between gap-3 border-t border-line pt-5 sm:flex-row sm:items-center">
                        <p className="flex items-center gap-2 text-[10px] text-muted">
                          <LockKeyhole size={13} className="text-emerald-500" />
                          Private to your SignalMend workspace.
                        </p>
                        <button
                          type="submit"
                          disabled={
                            savingBusiness ||
                            workspacesLoading ||
                            !businessName.trim() ||
                            !businessNiche ||
                            (workspaces.length > 0 && !workspaceId)
                          }
                          className="group inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-3 text-xs font-semibold text-white shadow-lg shadow-indigo-950/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {savingBusiness ? (
                            <>
                              <LoaderCircle size={15} className="animate-spin" />
                              Preparing your workspace…
                            </>
                          ) : (
                            <>
                              Continue to Slack
                              <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {step === 3 ? (
                    <div className="animate-in fade-in duration-300">
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                        <div className="rounded-2xl border border-line bg-canvas/45 p-5 sm:p-6">
                          <div className="flex items-start gap-4">
                            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-violet-500/20 bg-violet-500/[0.08] text-violet-500 dark:text-violet-200">
                              <MessageSquare size={22} />
                            </span>
                            <div>
                              <h3 className="text-sm font-semibold text-ink">Slack Workspace</h3>
                              <p className="mt-1 text-[10px] leading-5 text-muted">
                                Deliver prioritized incident alerts to the
                                workspace you authorize.
                              </p>
                            </div>
                          </div>
                          <div className="mt-5 space-y-2.5 border-t border-line pt-4">
                            {[
                              "Slack-hosted access approval",
                              "Workspace identity verification",
                              "Revoke access any time",
                            ].map((item) => (
                              <p key={item} className="flex items-center gap-2.5 text-[10px] text-muted">
                                <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
                                {item}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col justify-between rounded-2xl border border-line bg-canvas/60 p-4">
                          <div>
                            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted">
                              Business profile
                            </p>
                            <p className="mt-2 truncate text-sm font-semibold text-ink">
                              {businessName || slackStatus?.businessName}
                            </p>
                            <p className="mt-1 text-[10px] text-muted">
                              {businessNiche || slackStatus?.businessNiche}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setError("");
                              setStep(2);
                            }}
                            className="mt-5 inline-flex items-center gap-1.5 self-start text-[10px] font-medium text-accent transition hover:underline"
                          >
                            <ArrowLeft size={12} />
                            Edit profile
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.035] p-4">
                        <LockKeyhole size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                        <p className="text-[10px] leading-5 text-muted">
                          Enterprise-grade AES-256 OAuth isolation. SignalMend
                          never reads unauthorized messaging channels.
                        </p>
                      </div>

                      {error ? (
                        <p role="alert" className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs leading-5 text-rose-500">
                          {error}
                        </p>
                      ) : null}

                      {statusError ? (
                        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
                          <p className="text-[10px] leading-5 text-rose-500">{statusError}</p>
                          <button
                            type="button"
                            onClick={() => void loadSlackStatus().catch((caught: unknown) =>
                              setStatusError(caught instanceof Error ? caught.message : "Status refresh failed."),
                            )}
                            className="text-[10px] font-semibold text-rose-500 underline underline-offset-2"
                          >
                            Retry status
                          </button>
                        </div>
                      ) : null}

                      {verified ? (
                        <div role="status" className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-xs text-emerald-600 dark:text-emerald-300">
                          <CheckCircle2 size={17} />
                          <span>
                            Slack workspace verified
                            {slackStatus?.teamName ? ` — ${slackStatus.teamName}` : ""}. Your team is ready for alerts.
                          </span>
                        </div>
                      ) : slackStatus?.verificationStatus === "failed" ? (
                        <p className="mt-5 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-xs leading-5 text-rose-500">
                          {slackStatus.verificationError || "Slack verification failed. Reconnect to try again."}
                        </p>
                      ) : null}

                      <div className="mt-6 flex flex-col-reverse justify-between gap-3 border-t border-line pt-5 sm:flex-row">
                        {!verified ? (
                          <button
                            type="button"
                            onClick={() => setStep(2)}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-xs font-medium text-muted transition hover:text-ink"
                          >
                            <ArrowLeft size={14} />
                            Back
                          </button>
                        ) : (
                          <p className="flex items-center gap-2 py-3 text-[10px] text-emerald-600 dark:text-emerald-300">
                            <CheckCircle2 size={14} />
                            Setup complete
                          </p>
                        )}
                        {!verified ? (
                          <button
                            type="button"
                            onClick={() => void connectSlack()}
                            disabled={connectingSlack || !tenantId}
                            className="group inline-flex items-center justify-center gap-2.5 rounded-xl bg-[#4A154B] px-5 py-3.5 text-xs font-semibold text-white shadow-lg shadow-purple-950/20 transition hover:bg-[#5b1d5d] disabled:cursor-wait disabled:opacity-60"
                          >
                            {connectingSlack ? (
                              <>
                                <LoaderCircle size={15} className="animate-spin" />
                                Opening secure Slack approval…
                              </>
                            ) : (
                              <>
                                <MessageSquare size={16} />
                                Instant Connect Slack Workspace
                                <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                              </>
                            )}
                          </button>
                        ) : null}
                        <a
                          href={verified ? "/dashboard/integrations" : "/dashboard"}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 text-xs font-semibold text-accent transition hover:bg-accent/10"
                        >
                          {verified ? "Choose Slack alert channel" : "Continue to dashboard"}
                          <ArrowRight size={14} />
                        </a>
                      </div>
                      <p className="mt-4 text-center text-[10px] leading-5 text-muted">
                        You’ll approve access on Slack. Your password is never
                        shared with SignalMend.
                      </p>
                    </div>
                  ) : null}
                </div>
              </section>

              <aside className="space-y-4">
                <section className="rounded-[24px] border border-line bg-surface/85 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.08)] backdrop-blur-xl">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl border border-accent/20 bg-accent/[0.07] text-accent">
                      <Activity size={16} />
                    </span>
                    <div>
                      <h3 className="text-xs font-semibold text-ink">Incident operations</h3>
                      <p className="mt-0.5 text-[9px] text-muted">Your setup at a glance</p>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    <div className="rounded-xl border border-line bg-canvas/55 p-3">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-muted">Business</p>
                      <p className="mt-1.5 truncate text-xs font-medium text-ink">{businessName || "Not set yet"}</p>
                    </div>
                    <div className="rounded-xl border border-line bg-canvas/55 p-3">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-muted">Industry profile</p>
                      <p className="mt-1.5 text-xs font-medium text-ink">{businessNiche || "Choose your industry"}</p>
                    </div>
                    <div className="rounded-xl border border-line bg-canvas/55 p-3">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-muted">Slack integration</p>
                      <p className="mt-1.5 flex items-center gap-2 text-xs font-medium text-ink">
                        <span className={`h-1.5 w-1.5 rounded-full ${verified ? "bg-emerald-500" : "bg-muted/50"}`} />
                        {verified ? slackStatus?.teamName || "Verified" : "Not connected"}
                      </p>
                    </div>
                  </div>
                </section>
                <section className="rounded-[24px] border border-emerald-500/15 bg-emerald-500/[0.025] p-5">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={15} className="text-emerald-500" />
                    <h3 className="text-[11px] font-semibold text-ink">Built for secure response</h3>
                  </div>
                  <p className="mt-2.5 text-[10px] leading-5 text-muted">
                    Your account uses a verified email session. Integration
                    credentials are encrypted and checked before going live.
                  </p>
                </section>
              </aside>
            </div>
          </>
        )}

        <footer className="relative mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[9px] text-muted">
          <span>SignalMend · Incident Operations</span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={11} />
            Secure onboarding
          </span>
        </footer>
      </div>
    </main>
  );
}
