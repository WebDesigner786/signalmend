"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  BellRing,
  Check,
  ChevronDown,
  CircleHelp,
  Command,
  CreditCard,
  Gauge,
  Layers3,
  LogOut,
  Menu,
  Moon,
  Radio,
  Settings2,
  ShieldCheck,
  Sun,
  Workflow,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { DashboardApiError, dashboardFetch } from "../../lib/dashboard-api";
import {
  DashboardSessionProvider,
  useDashboardSession,
  validateWorkspaceAccess,
} from "../../lib/dashboard-session";

interface WorkspaceMetricsResponse {
  workspace: { id: string; name: string };
  metrics: {
    monthlyUsage: {
      receivedRequests: number;
      criticalGraceRequests: number;
      monthlyQuota: number;
    };
  };
}

const PRIMARY_NAVIGATION = [
  { label: "Overview", href: "/dashboard", icon: Gauge },
  { label: "Endpoints", href: "/dashboard/endpoints", icon: Radio },
  { label: "Incident rules", href: "/dashboard/rules", icon: Workflow },
  { label: "Integrations", href: "/dashboard/integrations", icon: Layers3 },
] as const;

function useWorkspaceMetrics(
  token: string,
  workspaceId: string,
  authenticated: boolean,
) {
  const [data, setData] = useState<WorkspaceMetricsResponse | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!authenticated) {
      setData(null);
      setError("");
      return;
    }

    try {
      const next = await dashboardFetch<WorkspaceMetricsResponse>(
        "/api/v1/dashboard/metrics",
        { token, workspaceId },
      );
      setData(next);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Workspace usage could not be loaded",
      );
    }
  }, [token, workspaceId, authenticated]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { data, error, refresh };
}

function AccessGate() {
  const { ready, authenticated } = useDashboardSession();

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          Securing your workspace…
        </div>
      </div>
    );
  }
  if (authenticated) {
    return null;
  }

  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section className="w-full max-w-md rounded-3xl border border-line bg-surface/80 p-7 shadow-2xl shadow-black/10 backdrop-blur-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          SignalMend
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Sign in to your workspace
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Sign in or create an account to open your incident dashboard.
        </p>
        <Link
          href="/onboarding"
          className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:brightness-110"
        >
          Continue to sign in <ArrowUpRight size={16} />
        </Link>
      </section>
    </main>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const saved = window.localStorage.getItem("signalmend.theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldUseDark = saved ? saved === "dark" : prefersDark;
    setDark(shouldUseDark);
    document.documentElement.classList.toggle("dark", shouldUseDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem("signalmend.theme", next ? "dark" : "light");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface/70 text-muted transition hover:border-accent/40 hover:text-ink"
      aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
      title={`Switch to ${dark ? "light" : "dark"} mode`}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function WorkspaceSwitcher({
  currentName,
  currentId,
}: {
  currentName: string;
  currentId: string;
}) {
  const { token, setWorkspaceId } = useDashboardSession();
  const [open, setOpen] = useState(false);
  const [candidate, setCandidate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const switchWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextId = candidate.trim();
    if (!nextId || nextId === currentId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await validateWorkspaceAccess(token, nextId);
      setWorkspaceId(nextId);
      setOpen(false);
      setCandidate("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Workspace access could not be verified",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl border border-line/80 bg-surface/70 p-2.5 text-left shadow-sm transition hover:border-accent/30 hover:bg-surface"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white">
          {currentName.slice(0, 1).toUpperCase() || "S"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-ink">
            {currentName || "Your workspace"}
          </span>
          <span className="mt-0.5 block text-[10px] text-muted">Workspace</span>
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 rounded-2xl border border-line bg-surface p-3 shadow-2xl shadow-black/15">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              Switch workspace
            </p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close workspace switcher">
              <X size={14} className="text-muted" />
            </button>
          </div>
          <p className="mb-3 text-[11px] leading-5 text-muted">
            Enter a workspace ID you belong to. SignalMend verifies access before switching.
          </p>
          <form onSubmit={switchWorkspace} className="space-y-2">
            <input
              value={candidate}
              onChange={(event) => setCandidate(event.target.value)}
              placeholder="Workspace UUID"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[11px] text-ink placeholder:text-muted/70"
              autoComplete="off"
            />
            {error ? <p role="alert" className="text-[11px] text-rose-500">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || !candidate.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-canvas transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Verifying access…" : "Switch workspace"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function UsageMeter({
  usage,
  error,
}: {
  usage: WorkspaceMetricsResponse["metrics"]["monthlyUsage"] | null;
  error: string;
}) {
  if (!usage) {
    return (
      <div className="mt-4 rounded-xl border border-line/70 bg-canvas/50 p-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted">{error ? "Usage unavailable" : "Loading usage"}</span>
          {!error ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> : null}
        </div>
        {error ? <p className="mt-2 text-[10px] leading-4 text-rose-400">{error}</p> : null}
      </div>
    );
  }

  const percent = Math.min(
    100,
    Math.round((usage.receivedRequests / Math.max(usage.monthlyQuota, 1)) * 100),
  );

  return (
    <div className="mt-4 rounded-xl border border-line/70 bg-canvas/50 p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted">Monthly events</span>
        <span className="rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
          {usage.receivedRequests >= usage.monthlyQuota ? "At limit" : "Live"}
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-base font-semibold tabular-nums text-ink">
          {usage.receivedRequests.toLocaleString()}
        </span>
        <span className="text-[10px] text-muted">
          / {usage.monthlyQuota.toLocaleString()}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Monthly webhook usage"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            percent >= 90 ? "bg-rose-500" : percent >= 70 ? "bg-amber-400" : "bg-accent"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {usage.criticalGraceRequests > 0 ? (
        <p className="mt-2 text-[10px] text-amber-500">
          {usage.criticalGraceRequests.toLocaleString()} critical grace events used
        </p>
      ) : null}
    </div>
  );
}

function DashboardShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const { ready, authenticated, token, workspaceId, setWorkspaceId, signOut } = useDashboardSession();
  const { data, error } = useWorkspaceMetrics(token, workspaceId, authenticated);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!workspaceId && data?.workspace.id) {
      setWorkspaceId(data.workspace.id);
    }
  }, [data?.workspace.id, setWorkspaceId, workspaceId]);

  const currentName = data?.workspace.name ?? "SignalMend";
  const tierLabel = data
    ? data.metrics.monthlyUsage.monthlyQuota >= 500_000
      ? "Enterprise"
      : data.metrics.monthlyUsage.monthlyQuota >= 50_000
        ? "Pro Team"
        : "Developer"
    : "Plan";

  if (!ready || !authenticated) {
    return <AccessGate />;
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {mobileOpen ? (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col border-r border-line/80 bg-surface/80 px-4 py-5 shadow-2xl shadow-black/5 backdrop-blur-2xl transition-transform duration-300 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-7 flex items-center justify-between px-1">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 text-white shadow-lg shadow-indigo-500/20">
              <Activity size={19} strokeWidth={2.2} />
            </span>
            <span>
              <span className="block text-sm font-bold tracking-tight text-ink">SignalMend</span>
              <span className="block text-[9px] font-semibold uppercase tracking-[0.2em] text-muted">
                Incident operations
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-2 text-muted lg:hidden"
            aria-label="Close menu"
          >
            <X size={17} />
          </button>
        </div>

        <WorkspaceSwitcher currentName={currentName} currentId={data?.workspace.id ?? workspaceId} />

        <div className="mt-4 flex items-center justify-between rounded-xl border border-line/70 bg-canvas/50 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-400/10 text-amber-500">
              <Command size={14} />
            </span>
            <span className="text-[11px] font-medium text-muted">Current plan</span>
          </div>
          <span className="rounded-md bg-ink/5 px-2 py-1 text-[10px] font-semibold text-ink dark:bg-white/10">
            {tierLabel}
          </span>
        </div>
        <UsageMeter usage={data?.metrics.monthlyUsage ?? null} error={error} />

        <div className="mb-2 mt-8 px-2 text-[9px] font-bold uppercase tracking-[0.19em] text-muted/80">
          Workspace
        </div>
        <nav className="space-y-1" aria-label="Primary navigation">
          {PRIMARY_NAVIGATION.map(({ label, href, icon: Icon }) => {
            const active =
              href === "/dashboard"
                ? pathname === href
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition-all duration-200 ${
                  active
                    ? "bg-accent/10 text-accent shadow-sm"
                    : "text-muted hover:translate-x-0.5 hover:bg-ink/5 hover:text-ink dark:hover:bg-white/5"
                }`}
              >
                <Icon size={16} className={active ? "text-accent" : "opacity-70 group-hover:opacity-100"} />
                <span className="flex-1">{label}</span>
                {active ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="mb-2 mt-8 px-2 text-[9px] font-bold uppercase tracking-[0.19em] text-muted/80">
          System
        </div>
        <div className="space-y-1">
          <Link
            href="/dashboard/billing"
            aria-current={pathname === "/dashboard/billing" ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition ${
              pathname === "/dashboard/billing"
                ? "bg-accent/10 text-accent"
                : "text-muted hover:bg-ink/5 hover:text-ink dark:hover:bg-white/5"
            }`}
          >
            <CreditCard size={16} /> Billing
          </Link>
        </div>

        <div className="mt-auto">
          <div className="mb-3 rounded-2xl border border-indigo-500/15 bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-transparent p-3.5">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-ink">
              <BellRing size={14} className="text-accent" />
              Incident-ready
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-muted">
              Your webhook pipeline is monitored continuously.
            </p>
            <Link
              href="/dashboard/endpoints"
              className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline"
            >
              Configure ingress <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="flex items-center gap-2 border-t border-line/70 pt-3">
            <button
              type="button"
              onClick={signOut}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-[11px] font-medium text-muted transition hover:bg-rose-500/10 hover:text-rose-500"
            >
              <LogOut size={14} /> Sign out
            </button>
            <ThemeToggle />
            <button
              type="button"
              title="Help"
              aria-label="Help"
              className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface/70 text-muted transition hover:text-ink"
            >
              <CircleHelp size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-[264px]">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-line/70 bg-canvas/75 px-4 backdrop-blur-2xl sm:px-7 lg:px-10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface/70 text-muted lg:hidden"
            >
              <Menu size={17} />
            </button>
            <div className="hidden items-center gap-2 text-xs text-muted sm:flex">
              <span className="font-medium text-ink">{currentName}</span>
              <span className="text-line">/</span>
              <span>{PRIMARY_NAVIGATION.find((item) => item.href === pathname)?.label ?? "Operations"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 text-[10px] font-medium text-emerald-500 sm:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Systems operational
            </span>
            <div className="grid h-8 w-8 place-items-center rounded-full border border-line bg-gradient-to-br from-indigo-500/15 to-cyan-500/15 text-[10px] font-bold text-accent">
              <ShieldCheck size={15} />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-7 sm:py-9 lg:px-10">
          {children}
        </main>
        <footer className="mx-auto flex max-w-[1500px] items-center justify-between px-4 pb-6 text-[10px] text-muted/70 sm:px-7 lg:px-10">
          <span className="inline-flex items-center gap-1.5">
            <Settings2 size={12} /> SignalMend Operations
          </span>
          <span className="inline-flex items-center gap-1">
            Secure by design <Check size={11} className="text-emerald-500" />
          </span>
        </footer>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <DashboardSessionProvider>
      <DashboardShell>{children}</DashboardShell>
    </DashboardSessionProvider>
  );
}
