import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { env } from "../config/env";
import { CustomSecurityException } from "./vaultService";

const AES_256_GCM_ALGORITHM = "aes-256-gcm";
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const ENCRYPTED_VALUE_VERSION = "v1";
const ENCRYPTED_VALUE_PARTS = 5;

function getEncryptionKey(): Buffer {
  return createHash("sha256").update(env.encryptionSecret, "utf8").digest();
}

/**
 * Verifies an HMAC-SHA256 signature of the exact request bytes.
 * Accepts hexadecimal signatures, optionally prefixed with "sha256=".
 */
export function verifyHmacSignature(
  payload: Buffer | string,
  secret: string,
  providedSignature: string | undefined,
): boolean {
  if (!secret || !providedSignature) {
    return false;
  }

  const normalizedSignature = providedSignature.startsWith("sha256=")
    ? providedSignature.slice("sha256=".length)
    : providedSignature;

  if (!/^[\da-fA-F]{64}$/.test(normalizedSignature)) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(payload).digest();
  const received = Buffer.from(normalizedSignature, "hex");

  return (
    received.byteLength === expected.byteLength &&
    timingSafeEqual(expected, received)
  );
}

/**
 * Encrypts a UTF-8 value into a versioned, colon-delimited AES-256-GCM envelope.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv(AES_256_GCM_ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTED_VALUE_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
    "",
  ].join(":");
}

/**
 * Decrypts a value created by encryptSecret and rejects malformed or tampered data.
 */
export function decryptSecret(encryptedValue: string): string {
  const parts = encryptedValue.split(":");
  if (
    parts.length !== ENCRYPTED_VALUE_PARTS ||
    parts[0] !== ENCRYPTED_VALUE_VERSION ||
    parts[4] !== ""
  ) {
    throw new Error("Encrypted secret has an unsupported or malformed format");
  }

  const decodeBase64Url = (value: string, fieldName: string): Buffer => {
    if (!/^[A-Za-z0-9_-]*$/.test(value)) {
      throw new CustomSecurityException(
        `Encrypted secret has an invalid ${fieldName}`,
      );
    }
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) {
      throw new CustomSecurityException(
        `Encrypted secret has an invalid ${fieldName}`,
      );
    }
    return decoded;
  };
  const iv = decodeBase64Url(parts[1], "initialization vector");
  const authTag = decodeBase64Url(parts[2], "authentication tag");
  const ciphertext = decodeBase64Url(parts[3], "ciphertext");

  if (iv.byteLength !== AES_GCM_IV_BYTES || authTag.byteLength !== AES_GCM_TAG_BYTES) {
    throw new Error("Encrypted secret has invalid AES-GCM parameters");
  }

  const decipher = createDecipheriv(
    AES_256_GCM_ALGORITHM,
    getEncryptionKey(),
    iv,
  );
  decipher.setAuthTag(authTag);

  const plaintext = decipher.update(ciphertext);
  try {
    return Buffer.concat([plaintext, decipher.final()]).toString("utf8");
  } catch (cause) {
    throw new CustomSecurityException(
      "Encrypted secret authentication failed; data may be modified or the encryption key may be incorrect",
      { cause },
    );
  }
}
