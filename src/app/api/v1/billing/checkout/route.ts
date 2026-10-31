import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "../../../../../config/env";
import { getDashboardRequestContext } from "../../../../../lib/server/dashboard-request";

export const runtime = "nodejs";
export const maxDuration = 10;

const CheckoutSchema = z.object({
  tier: z.enum(["pro", "enterprise"]),
}).strict();

const CheckoutResponseSchema = z.object({
  data: z.object({
    attributes: z.object({ url: z.string().url() }),
  }),
});

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getDashboardRequestContext(request);
  if ("response" in context) return context.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid subscription plan." }, { status: 400 });
  }

  const apiKey = env.lemonSqueezyApiKey;
  const storeId = env.lemonSqueezyStoreId;
  const variantId =
    parsed.data.tier === "pro"
      ? env.lemonSqueezyProVariantId
      : env.lemonSqueezyEnterpriseVariantId;
  if (!apiKey || !storeId || !variantId) {
    return NextResponse.json(
      { error: "Paid checkout is not configured. Add Lemon Squeezy API, store, and plan variant IDs." },
      { status: 503 },
    );
  }

  try {
    const [{ prisma }, { siteUrl }] = await Promise.all([
      import("../../../../../utils/prisma"),
      import("../../../../../lib/site"),
    ]);
    const [workspace, user] = await Promise.all([
      prisma.workspace.findFirst({
        where: {
          id: context.workspace.id,
          OR: [
            { ownerId: context.identity.userId },
            {
              members: {
                some: {
                  userId: context.identity.userId,
                  role: { in: ["owner", "admin"] },
                },
              },
            },
          ],
        },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { id: context.identity.userId },
        select: { email: true },
      }),
    ]);
    if (!workspace || !user) {
      return NextResponse.json(
        { error: "Workspace owner or administrator access is required for billing." },
        { status: 403 },
      );
    }

    const response = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: {
        accept: "application/vnd.api+json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/vnd.api+json",
      },
      body: JSON.stringify({
        data: {
          type: "checkouts",
          attributes: {
            checkout_options: { embed: false },
            checkout_data: {
              email: user.email,
              custom: { workspace_id: workspace.id },
            },
            product_options: {
              redirect_url: new URL("/dashboard/billing?checkout=success", siteUrl).toString(),
            },
          },
          relationships: {
            store: { data: { type: "stores", id: storeId } },
            variant: { data: { type: "variants", id: variantId } },
          },
        },
      }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new Error("Lemon Squeezy returned an invalid checkout response.");
    }
    const checkout = CheckoutResponseSchema.safeParse(responseBody);
    if (!response.ok || !checkout.success) {
      console.error("Lemon Squeezy checkout creation failed", {
        status: response.status,
        errors:
          typeof responseBody === "object" &&
          responseBody !== null &&
          "errors" in responseBody
            ? responseBody.errors
            : undefined,
      });
      return NextResponse.json(
        { error: "A secure checkout could not be created. Please try again." },
        { status: 502 },
      );
    }

    const checkoutUrl = new URL(checkout.data.data.attributes.url);
    if (
      checkoutUrl.protocol !== "https:" ||
      !checkoutUrl.hostname.endsWith(".lemonsqueezy.com")
    ) {
      throw new Error("Lemon Squeezy returned an untrusted checkout URL.");
    }
    return NextResponse.json(
      { checkoutUrl: checkoutUrl.toString() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not start Lemon Squeezy checkout", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Checkout could not be started." },
      { status: 502 },
    );
  }
}
