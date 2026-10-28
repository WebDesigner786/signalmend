"use client";

import type { ReactNode } from "react";

import { DashboardSessionProvider } from "../../lib/dashboard-session";

export default function OnboardingLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <DashboardSessionProvider>{children}</DashboardSessionProvider>;
}
