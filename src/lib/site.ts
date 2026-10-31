const configuredUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  process.env.NEXTAUTH_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

export const siteUrl = new URL(configuredUrl || "https://signalmend.com");

if (siteUrl.protocol !== "https:" && siteUrl.hostname !== "localhost") {
  throw new Error("The public site URL must use HTTPS outside localhost");
}

siteUrl.pathname = "/";
siteUrl.search = "";
siteUrl.hash = "";
