import type { Metadata } from "next";
import type { ReactNode } from "react";

import Providers from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SignalMend | Incident response, without the noise",
    template: "%s | SignalMend",
  },
  description:
    "Turn scattered alerts into clear, actionable incidents. SignalMend connects your webhooks, verifies incoming events, and routes the right signals to your team.",
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
