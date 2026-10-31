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
import { signOut as nextAuthSignOut, useSession } from "next-auth/react";

import type { DashboardSession } from "./dashboard-api";

interface DashboardSessionContextValue extends DashboardSession {
  ready: boolean;
  authenticated: boolean;
  setWorkspaceId: (workspaceId: string) => void;
  signOut: () => void;
}

const SESSION_STORAGE_KEY = "signalmend.dashboard.workspace.v1";
const DashboardSessionContext =
  createContext<DashboardSessionContextValue | null>(null);

function readStoredWorkspaceId(): string {
  try {
    return (
      window.sessionStorage.getItem(SESSION_STORAGE_KEY) ??
      window.sessionStorage.getItem("signalmend.onboarding.workspace.v1") ??
      ""
    );
  } catch {
    return "";
  }
}

export function DashboardSessionProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { status } = useSession();
  const [workspaceId, setWorkspaceIdState] = useState("");
  const [workspaceReady, setWorkspaceReady] = useState(false);

  useEffect(() => {
    setWorkspaceIdState(readStoredWorkspaceId());
    setWorkspaceReady(true);
  }, []);

  const setWorkspaceId = useCallback((nextWorkspaceId: string) => {
    const normalized = nextWorkspaceId.trim();
    setWorkspaceIdState(normalized);
    if (normalized) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, normalized);
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, []);

  const signOut = useCallback(() => {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    void nextAuthSignOut({ callbackUrl: "/onboarding" });
  }, []);

  const contextValue = useMemo(
    () => ({
      token: "",
      workspaceId,
      ready: status !== "loading" && workspaceReady,
      authenticated: status === "authenticated",
      setWorkspaceId,
      signOut,
    }),
    [workspaceId, status, workspaceReady, setWorkspaceId, signOut],
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
