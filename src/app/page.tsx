import type { Metadata } from "next";

import LandingPage from "../components/landing-page";
import { siteUrl } from "../lib/site";
import "./landing.css";

export const metadata: Metadata = {
  title: "SignalMend | Incident response, without the noise",
  description:
    "Turn application and infrastructure webhooks into verified, actionable incidents and team alerts.",
  alternates: { canonical: "/" },
  robots: {
    index: process.env.VERCEL_ENV !== "preview",
    follow: process.env.VERCEL_ENV !== "preview",
  },
  openGraph: {
    type: "website",
    siteName: "SignalMend",
    title: "SignalMend | Incident response, without the noise",
    description:
      "Turn application and infrastructure webhooks into verified, actionable incidents and team alerts.",
    url: "/",
  },
};

export default function HomePage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "SignalMend",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Route verified application and infrastructure webhooks into actionable incidents and team alerts.",
    url: siteUrl.toString(),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <LandingPage />
    </>
  );
}
