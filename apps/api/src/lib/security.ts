const encoder = new TextEncoder();
const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const HASH_LENGTH = 32;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    HASH_LENGTH * 8,
  );

  return new Uint8Array(derived);
}

export async function hashPassword(
  password: string,
): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const derived = await deriveKey(password, salt);
  return { hash: bytesToHex(derived), salt: bytesToHex(salt) };
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const saltBytes = hexToBytes(salt);
  const derived = await deriveKey(password, saltBytes);
  const expected = hexToBytes(expectedHash);

  if (derived.byteLength !== expected.byteLength) return false;

  let mismatch = 0;
  for (let i = 0; i < derived.byteLength; i++) {
    mismatch |= derived[i]! ^ expected[i]!;
  }
  return mismatch === 0;
}
