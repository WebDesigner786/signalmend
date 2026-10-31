import Fastify, { type FastifyInstance } from "fastify";
import { NextResponse } from "next/server";

import billingWebhooksRoutes from "../../../../../routes/billingWebhooks";

export const runtime = "nodejs";
export const maxDuration = 10;

const BODY_LIMIT_BYTES = 1_048_576;
let billingServer: Promise<FastifyInstance> | undefined;

class BillingBodyTooLargeError extends Error {
  constructor() {
    super("Billing event exceeds the 1 MB limit.");
    this.name = "BillingBodyTooLargeError";
  }
}

async function readRawBody(request: Request): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Billing event body is required.");

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > BODY_LIMIT_BYTES) {
      void reader.cancel().catch((error: unknown) => {
        console.error("Could not cancel oversized billing event stream", error);
      });
      throw new BillingBodyTooLargeError();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function getBillingServer(): Promise<FastifyInstance> {
  if (!billingServer) {
    billingServer = (async () => {
      const server = Fastify({
        bodyLimit: BODY_LIMIT_BYTES,
        logger: false,
      });
      server.removeContentTypeParser("application/json");
      await server.register(billingWebhooksRoutes);
      await server.ready();
      return server;
    })().catch((error: unknown) => {
      billingServer = undefined;
      throw error;
    });
  }
  return billingServer;
}

export async function POST(request: Request): Promise<NextResponse> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== "application/json") {
    return NextResponse.json({ error: "Expected a JSON billing event." }, { status: 400 });
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(request);
  } catch (error) {
    console.error("Could not read billing webhook body", error);
    if (error instanceof BillingBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    return NextResponse.json({ error: "Billing event body could not be read." }, { status: 400 });
  }

  try {
    const server = await getBillingServer();
    const result = await server.inject({
      method: "POST",
      url: "/api/v1/billing/webhook",
      headers: {
        "content-type": "application/json",
        "x-signature": request.headers.get("x-signature") ?? "",
        ...(request.headers.get("x-event-name")
          ? { "x-event-name": request.headers.get("x-event-name")! }
          : {}),
      },
      payload: rawBody,
    });
    return new NextResponse(result.body, {
      status: result.statusCode,
      headers: {
        "cache-control": "no-store",
        "content-type": result.headers["content-type"] ?? "application/json",
      },
    });
  } catch (error) {
    console.error("Billing webhook handler could not run", error);
    return NextResponse.json(
      { error: "Billing webhook could not be processed." },
      { status: 503 },
    );
  }
}
