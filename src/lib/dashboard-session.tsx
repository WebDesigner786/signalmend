"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { dashboardFetch, type DashboardSession } from "./dashboard-api";

interface DashboardSessionContextValue extends DashboardSession {
  ready: boolean;
  setToken: (token: string) => void;
  setWorkspaceId: (workspaceId: string) => void;
  signOut: () => void;
}

const SESSION_STORAGE_KEY = "signalmend.dashboard.session.v1";
const DashboardSessionContext =
  createContext<DashboardSessionContextValue | null>(null);

function readStoredSession(): DashboardSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("token" in parsed) ||
      typeof parsed.token !== "string" ||
      !("workspaceId" in parsed) ||
      typeof parsed.workspaceId !== "string"
    ) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return { token: parsed.token, workspaceId: parsed.workspaceId };
  } catch {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function DashboardSessionProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [session, setSession] = useState<DashboardSession>({
    token: "",
    workspaceId: "",
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(readStoredSession() ?? { token: "", workspaceId: "" });
    setReady(true);
  }, []);

  const persistSession = useCallback((nextSession: DashboardSession) => {
    setSession(nextSession);
    if (nextSession.token) {
      window.sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify(nextSession),
      );
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, []);

  const setToken = useCallback(
    (token: string) => {
      persistSession({ ...session, token: token.trim() });
    },
    [persistSession, session],
  );

  const setWorkspaceId = useCallback(
    (workspaceId: string) => {
      persistSession({ ...session, workspaceId: workspaceId.trim() });
    },
    [persistSession, session],
  );

  const signOut = useCallback(() => {
    persistSession({ token: "", workspaceId: "" });
  }, [persistSession]);

  const contextValue = useMemo(
    () => ({ ...session, ready, setToken, setWorkspaceId, signOut }),
    [session, ready, setToken, setWorkspaceId, signOut],
  );

  return (
    <DashboardSessionContext.Provider value={contextValue}>
      {children}
    </DashboardSessionContext.Provider>
  );
}

export function useDashboardSession(): DashboardSessionContextValue {
  const context = useContext(DashboardSessionContext);
  if (!context) {
    throw new Error(
      "useDashboardSession must be used inside DashboardSessionProvider",
    );
  }
  return context;
}

export async function validateWorkspaceAccess(
  token: string,
  workspaceId: string,
): Promise<void> {
  await dashboardFetch("/api/v1/dashboard/metrics", { token, workspaceId });
}
