import type { Metadata } from "next";
import type { ReactNode } from "react";

import Providers from "./providers";
import { siteUrl } from "../lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "SignalMend | Incident response, without the noise",
    template: "%s | SignalMend",
  },
  description:
    "Turn scattered alerts into clear, actionable incidents. SignalMend connects your webhooks, verifies incoming events, and routes the right signals to your team.",
  applicationName: "SignalMend",
  keywords: [
    "incident response",
    "webhook monitoring",
    "Slack incident alerts",
    "incident management for startups",
    "webhook signature verification",
  ],
  openGraph: {
    type: "website",
    siteName: "SignalMend",
    title: "SignalMend | Incident response, without the noise",
    description:
      "Turn application and infrastructure webhooks into verified, actionable incidents and team alerts.",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "SignalMend | Incident response, without the noise",
    description:
      "Turn application and infrastructure webhooks into verified, actionable incidents and team alerts.",
  },
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
