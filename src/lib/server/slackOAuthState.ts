import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

const SlackOAuthStateSchema = z.object({
  v: z.literal(1),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  exp: z.number().int().positive(),
});

export type SlackOAuthState = z.infer<typeof SlackOAuthStateSchema>;

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Malformed OAuth state");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("Malformed OAuth state");
  }
  return decoded;
}

function stateSignature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

export function createSlackOAuthState(
  tenantId: string,
  userId: string,
  secret: string,
): SlackOAuthState & { token: string } {
  const claims: SlackOAuthState = {
    v: 1,
    tenantId,
    userId,
    nonce: randomBytes(32).toString("base64url"),
    exp: Math.floor(Date.now() / 1_000) + 600,
  };
  const payload = toBase64Url(JSON.stringify(claims));
  const signature = stateSignature(payload, secret).toString("base64url");
  return { ...claims, token: `${payload}.${signature}` };
}

export function verifySlackOAuthState(
  token: string,
  secret: string,
): SlackOAuthState {
  const [encodedClaims, encodedSignature, ...extra] = token.split(".");
  if (!encodedClaims || !encodedSignature || extra.length > 0) {
    throw new Error("Malformed OAuth state");
  }

  const expected = stateSignature(encodedClaims, secret);
  const received = decodeBase64Url(encodedSignature);
  if (
    received.byteLength !== expected.byteLength ||
    !timingSafeEqual(expected, received)
  ) {
    throw new Error("Invalid OAuth state signature");
  }

  const claims = SlackOAuthStateSchema.parse(
    JSON.parse(decodeBase64Url(encodedClaims).toString("utf8")) as unknown,
  );
  if (claims.exp <= Math.floor(Date.now() / 1_000)) {
    throw new Error("Expired OAuth state");
  }
  return claims;
}
