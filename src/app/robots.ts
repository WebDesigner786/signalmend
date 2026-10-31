import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  const isPreviewDeployment = process.env.VERCEL_ENV === "preview";
  return {
    rules: {
      userAgent: "*",
      ...(isPreviewDeployment
        ? { disallow: "/" }
        : { allow: "/", disallow: ["/dashboard", "/api/", "/onboarding"] }),
    },
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
  };
}
