import { describe, expect, it } from "vitest";
import {
  decodeEncryptionKey,
  decryptSecret,
  encryptSecret,
  hashPassword,
  verifyPassword,
} from "@/lib/crypto";
import { createSessionToken, verifySessionToken } from "@/lib/auth";

const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
const signingSecret = "a-strong-session-secret-with-more-than-32-characters";

describe("secret encryption", () => {
  it("round-trips a secret with authenticated context", () => {
    const envelope = encryptSecret("AIza-secret-example", encryptionKey, "gemini");
    expect(envelope).not.toContain("AIza-secret-example");
    expect(decryptSecret(envelope, encryptionKey, "gemini")).toBe("AIza-secret-example");
  });

  it("uses a unique nonce for every encryption", () => {
    const first = encryptSecret("same-value", encryptionKey, "resend");
    const second = encryptSecret("same-value", encryptionKey, "resend");
    expect(first).not.toBe(second);
  });

  it("rejects the wrong key, context, and tampered ciphertext", () => {
    const envelope = encryptSecret("sensitive", encryptionKey, "gemini");
    const otherKey = Buffer.alloc(32, 8).toString("base64url");
    expect(() => decryptSecret(envelope, otherKey, "gemini")).toThrow(/could not be decrypted/i);
    expect(() => decryptSecret(envelope, encryptionKey, "resend")).toThrow(/could not be decrypted/i);

    const parts = envelope.split(".");
    parts[2] = `${parts[2].slice(0, -1)}${parts[2].endsWith("A") ? "B" : "A"}`;
    expect(() => decryptSecret(parts.join("."), encryptionKey, "gemini")).toThrow(
      /could not be decrypted/i,
    );
  });

  it("accepts 32-byte hex and base64url keys only", () => {
    expect(decodeEncryptionKey(encryptionKey)).toHaveLength(32);
    expect(decodeEncryptionKey("ab".repeat(32))).toHaveLength(32);
    expect(() => decodeEncryptionKey("too-short")).toThrow(/32 bytes/i);
  });
});

describe("admin password hashing", () => {
  it("verifies the right password and rejects the wrong password", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded).toMatch(/^scrypt\$v1\$/);
    await expect(verifyPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyPassword("incorrect password", encoded)).resolves.toBe(false);
  });

  it("rejects malformed hashes without throwing", async () => {
    await expect(verifyPassword("any password here", "not-a-password-hash")).resolves.toBe(false);
  });
});

describe("signed owner sessions", () => {
  const now = new Date("2026-08-11T10:00:00.000Z");

  it("accepts a signed, unexpired session", () => {
    const { token } = createSessionToken(signingSecret, { now, ttlSeconds: 3_600 });
    const session = verifySessionToken(token, signingSecret, new Date("2026-08-11T10:30:00.000Z"));
    expect(session?.subject).toBe("owner");
    expect(session?.expiresAt).toBe(Math.floor(now.getTime() / 1_000) + 3_600);
  });

  it("rejects expired, tampered, and incorrectly signed sessions", () => {
    const { token } = createSessionToken(signingSecret, { now, ttlSeconds: 3_600 });
    expect(verifySessionToken(token, signingSecret, new Date("2026-08-11T11:00:00.000Z"))).toBeNull();
    expect(verifySessionToken(`x${token}`, signingSecret, now)).toBeNull();
    expect(verifySessionToken(token, `${signingSecret}-different`, now)).toBeNull();
  });
});
