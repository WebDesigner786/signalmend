import { compare } from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";

import { prisma } from "../utils/prisma";

const CredentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z
    .string()
    .min(1)
    .max(128)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72),
});

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/onboarding",
  },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = CredentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        let failureStage:
          | "user_lookup"
          | "password_verification" = "user_lookup";
        try {
          const user = await prisma.user.findUnique({
            where: { email: parsed.data.email.toLowerCase() },
            select: {
              id: true,
              email: true,
              name: true,
              passwordHash: true,
            },
          });
          if (!user?.passwordHash) return null;

          failureStage = "password_verification";
          const isValidPassword = await compare(
            parsed.data.password,
            user.passwordHash,
          );
          if (!isValidPassword) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.name,
          };
        } catch (error) {
          console.error("[Auth Error] Credentials authorization failed.", {
            stage: failureStage,
            message:
              error instanceof Error
                ? error.message
                : "Unknown credentials authorization error",
          });
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};
