import type { Metadata } from "next";
import type { ReactNode } from "react";

import Providers from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SignalMend | Incident response",
    template: "%s | SignalMend",
  },
  description: "Secure webhook operations and automated incident response.",
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
