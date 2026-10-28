import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const PAYLOAD_PART_COUNT = 4;

export type TenantEncryptionKey = Buffer | string;

export class CustomSecurityException extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CustomSecurityException";
  }
}

function decodeBase64Url(value: string, fieldName: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new CustomSecurityException(`Encrypted token has an invalid ${fieldName}`);
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new CustomSecurityException(`Encrypted token has an invalid ${fieldName}`);
  }
  return decoded;
}

function getKeyBytes(key: TenantEncryptionKey): Buffer {
  if (Buffer.isBuffer(key)) {
    if (key.byteLength !== 32) {
      throw new TypeError("Tenant encryption keys must be exactly 32 bytes");
    }
    return Buffer.from(key);
  }

  if (/^[\da-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, "hex");
  }

  if (/^[A-Za-z0-9_-]{43}$/.test(key)) {
    const decoded = Buffer.from(key, "base64url");
    if (
      decoded.byteLength === 32 &&
      decoded.toString("base64url") === key
    ) {
      return decoded;
    }
  }

  throw new TypeError(
    "Tenant encryption keys must be 32-byte Buffers, 64-character hexadecimal strings, or canonical 32-byte base64url strings",
  );
}

export class VaultService {
  encryptToken(rawText: string, tenantKey: TenantEncryptionKey): string {
    if (typeof rawText !== "string") {
      throw new TypeError("Token plaintext must be a string");
    }

    const key = getKeyBytes(tenantKey);
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(VERSION, "utf8"));

    const ciphertext = Buffer.concat([
      cipher.update(rawText, "utf8"),
      cipher.final(),
    ]);

    return [
      VERSION,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decryptToken(
    encryptedPayload: string,
    tenantKey: TenantEncryptionKey,
  ): string {
    if (typeof encryptedPayload !== "string") {
      throw new TypeError("Encrypted token payload must be a string");
    }

    const parts = encryptedPayload.split(".");
    if (parts.length !== PAYLOAD_PART_COUNT || parts[0] !== VERSION) {
      throw new CustomSecurityException(
        "Encrypted token has an unsupported or malformed format",
      );
    }

    const iv = decodeBase64Url(parts[1], "initialization vector");
    const authTag = decodeBase64Url(parts[2], "authentication tag");
    const ciphertext = decodeBase64Url(parts[3], "ciphertext");

    if (
      iv.byteLength !== IV_LENGTH_BYTES ||
      authTag.byteLength !== AUTH_TAG_LENGTH_BYTES
    ) {
      throw new CustomSecurityException(
        "Encrypted token has invalid AES-GCM parameters",
      );
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      getKeyBytes(tenantKey),
      iv,
    );
    decipher.setAAD(Buffer.from(VERSION, "utf8"));
    decipher.setAuthTag(authTag);

    const plaintext = decipher.update(ciphertext);
    try {
      return Buffer.concat([plaintext, decipher.final()]).toString("utf8");
    } catch (cause) {
      throw new CustomSecurityException(
        "Encrypted token authentication failed; data may be modified or the tenant key may be incorrect",
        { cause },
      );
    }
  }
}
