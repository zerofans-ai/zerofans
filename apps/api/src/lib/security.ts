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

export async function hashPassword(
  password: string,
  salt: string = crypto.randomUUID(),
): Promise<{ hash: string; salt: string }> {
  const hash = await sha256(`${salt}:${password}`);
  return { hash, salt };
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const calculated = await sha256(`${salt}:${password}`);
  return calculated === expectedHash;
}
