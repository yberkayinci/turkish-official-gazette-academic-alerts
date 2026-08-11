import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

const ENVELOPE_VERSION = "v1";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const SCRYPT_KEY_BYTES = 64;
const SCRYPT_DEFAULTS = Object.freeze({ N: 16_384, r: 8, p: 1 });

function toBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoded value.");
  return Buffer.from(value, "base64url");
}

export function decodeEncryptionKey(value: string): Buffer {
  const trimmed = value.trim();
  const decoded = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64url");
  if (decoded.length !== 32) {
    throw new Error("The encryption key must contain exactly 32 bytes.");
  }
  return decoded;
}

function associatedData(context: string): Buffer {
  const normalized = context.trim();
  if (!normalized || normalized.length > 200) throw new Error("A valid encryption context is required.");
  return Buffer.from(`official-gazette-monitor:${ENVELOPE_VERSION}:${normalized}`, "utf8");
}

export function encryptSecret(plaintext: string, keyMaterial: string, context: string): string {
  if (!plaintext || Buffer.byteLength(plaintext, "utf8") > 65_536) {
    throw new Error("The secret must contain between 1 and 65,536 bytes.");
  }
  const key = decodeEncryptionKey(keyMaterial);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  cipher.setAAD(associatedData(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, toBase64Url(iv), toBase64Url(ciphertext), toBase64Url(tag)].join(".");
}

export function decryptSecret(envelope: string, keyMaterial: string, context: string): string {
  try {
    const parts = envelope.split(".");
    if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) throw new Error("Invalid envelope.");
    const iv = fromBase64Url(parts[1]);
    const ciphertext = fromBase64Url(parts[2]);
    const tag = fromBase64Url(parts[3]);
    if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid envelope.");

    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, decodeEncryptionKey(keyMaterial), iv);
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("The stored secret could not be decrypted.");
  }
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function derivePasswordKey(
  password: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
  keyLength = SCRYPT_KEY_BYTES,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 1_024) {
    throw new Error("The admin password must contain between 12 and 1,024 bytes.");
  }
  const salt = randomBytes(16);
  const derived = await derivePasswordKey(
    password,
    salt,
    SCRYPT_DEFAULTS.N,
    SCRYPT_DEFAULTS.r,
    SCRYPT_DEFAULTS.p,
  );
  return [
    "scrypt",
    ENVELOPE_VERSION,
    SCRYPT_DEFAULTS.N,
    SCRYPT_DEFAULTS.r,
    SCRYPT_DEFAULTS.p,
    toBase64Url(salt),
    toBase64Url(derived),
  ].join("$");
}

interface ParsedPasswordHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  expected: Buffer;
}

function parsePasswordHash(encoded: string): ParsedPasswordHash | null {
  try {
    const [algorithm, version, nValue, rValue, pValue, saltValue, hashValue, ...rest] =
      encoded.split("$");
    if (rest.length || algorithm !== "scrypt" || version !== ENVELOPE_VERSION) return null;
    const N = Number(nValue);
    const r = Number(rValue);
    const p = Number(pValue);
    if (!Number.isInteger(N) || N < 4_096 || N > 65_536 || (N & (N - 1)) !== 0) return null;
    if (!Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 2) {
      return null;
    }
    const salt = fromBase64Url(saltValue);
    const expected = fromBase64Url(hashValue);
    if (salt.length < 16 || salt.length > 64 || expected.length < 32 || expected.length > 64) return null;
    return { N, r, p, salt, expected };
  } catch {
    return null;
  }
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (Buffer.byteLength(password, "utf8") > 1_024) return false;
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) return false;
  try {
    const actual = await derivePasswordKey(
      password,
      parsed.salt,
      parsed.N,
      parsed.r,
      parsed.p,
      parsed.expected.length,
    );
    return timingSafeEqual(actual, parsed.expected);
  } catch {
    return false;
  }
}

export function hmacSha256(value: string, secret: string): Buffer {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("The signing secret must contain at least 32 bytes.");
  }
  return createHmac("sha256", secret).update(value, "utf8").digest();
}
