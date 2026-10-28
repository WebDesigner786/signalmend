import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";

import {
  CustomSecurityException,
  VaultService,
} from "./vaultService";

describe("VaultService", () => {
  const vault = new VaultService();
  const key = randomBytes(32);

  it("round-trips an encrypted token and generates a distinct IV each time", () => {
    const token = "xoxb-sensitive-token";
    const first = vault.encryptToken(token, key);
    const second = vault.encryptToken(token, key);

    expect(vault.decryptToken(first, key)).toBe(token);
    expect(vault.decryptToken(second, key)).toBe(token);
    expect(first).not.toBe(second);
    expect(first.split(".")).toHaveLength(4);
  });

  it("rejects a payload modified after encryption", () => {
    const parts = vault.encryptToken("secret", key).split(".");
    const ciphertext = parts[3];
    const changedCharacter = ciphertext[0] === "A" ? "B" : "A";
    parts[3] = `${changedCharacter}${ciphertext.slice(1)}`;

    expect(() => vault.decryptToken(parts.join("."), key)).toThrow(
      CustomSecurityException,
    );
  });

  it("rejects an authentication tag modified after encryption", () => {
    const parts = vault.encryptToken("secret", key).split(".");
    const authenticationTag = parts[2];
    const changedCharacter = authenticationTag[0] === "A" ? "B" : "A";
    parts[2] = `${changedCharacter}${authenticationTag.slice(1)}`;

    expect(() => vault.decryptToken(parts.join("."), key)).toThrow(
      CustomSecurityException,
    );
  });

  it("rejects an incorrect tenant key", () => {
    const encrypted = vault.encryptToken("tenant token", key);
    const otherTenantKey = randomBytes(32);

    expect(() => vault.decryptToken(encrypted, otherTenantKey)).toThrow(
      CustomSecurityException,
    );
  });

  it("rejects malformed envelopes and invalid key lengths", () => {
    expect(() => vault.decryptToken("v1.bad.payload", key)).toThrow(
      CustomSecurityException,
    );
    expect(() => vault.encryptToken("secret", Buffer.alloc(16))).toThrow(
      TypeError,
    );
  });

  it("performs 1,000 authenticated encryption round trips within five seconds", () => {
    const startedAt = performance.now();
    for (let index = 0; index < 1_000; index += 1) {
      const encrypted = vault.encryptToken(`token-${index}`, key);
      expect(vault.decryptToken(encrypted, key)).toBe(`token-${index}`);
    }

    expect(performance.now() - startedAt).toBeLessThan(5_000);
  });
});
