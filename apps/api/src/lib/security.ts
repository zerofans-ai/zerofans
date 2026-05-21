import bcrypt from "bcryptjs";

const LEGACY_HASH_LENGTH = 64;
const BCRYPT_ROUNDS = 12;

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return bytesToHex(new Uint8Array(digest));
}

function isLegacyHash(hash: string): boolean {
  return hash.length === LEGACY_HASH_LENGTH && /^[0-9a-f]+$/.test(hash);
}

export async function hashPassword(password: string): Promise<{
  hash: string;
  salt: string | null;
}> {
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  return { hash, salt: null };
}

export async function verifyPassword(
  password: string,
  salt: string | null,
  storedHash: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (isLegacyHash(storedHash) && salt) {
    const calculated = await sha256(`${salt}:${password}`);
    if (calculated === storedHash) {
      return { valid: true, needsRehash: true };
    }
    return { valid: false, needsRehash: false };
  }

  const valid = await bcrypt.compare(password, storedHash);
  return { valid, needsRehash: false };
}

export async function rehashPassword(
  password: string,
): Promise<{ hash: string; salt: null }> {
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  return { hash, salt: null };
}
