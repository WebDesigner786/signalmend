import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "../../../../utils/prisma";

export const runtime = "nodejs";

const RegistrationSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z
    .string()
    .min(12)
    .max(128)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72),
  name: z.string().trim().min(1).max(255).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Enter a valid email address and password." },
      { status: 400 },
    );
  }

  const parsed = RegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Use a valid email address and a password with at least 12 characters and no more than 72 bytes.",
      },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const passwordHash = await hash(parsed.data.password, 12);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
      },
      select: { id: true, email: true, name: true },
    });

    return NextResponse.json(
      { user },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "An account with this email already exists. Sign in instead." },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }

    console.error("Email registration failed", error);
    return NextResponse.json(
      { error: "Registration could not be completed. Please try again." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
