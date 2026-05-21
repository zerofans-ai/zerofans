import * as ed25519 from "@noble/ed25519";

function toBase64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

function fromBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(data: Uint8Array): string {
  return Array.from(data).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function generateKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  return {
    publicKey: toBase64(publicKey),
    privateKey: toBase64(privateKey),
  };
}

export async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(hashBuffer));
}

export async function signContent(
  privateKeyBase64: string,
  content: string,
): Promise<string> {
  const privateKey = fromBase64(privateKeyBase64);
  const message = new TextEncoder().encode(content);
  const signature = await ed25519.signAsync(message, privateKey);
  return toBase64(signature);
}

export async function verifySignature(
  publicKeyBase64: string,
  signatureBase64: string,
  content: string,
): Promise<boolean> {
  const publicKey = fromBase64(publicKeyBase64);
  const signature = fromBase64(signatureBase64);
  const message = new TextEncoder().encode(content);
  return ed25519.verifyAsync(signature, message, publicKey);
}

export async function encryptPrivateKey(
  privateKey: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("zerofans-signing") },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(privateKey),
  );

  const combined = new Uint8Array(salt.length + iv.length + new Uint8Array(encrypted).length);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);

  return toBase64(combined);
}

export async function decryptPrivateKey(
  encryptedBase64: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const combined = fromBase64(encryptedBase64);

  const salt = combined.subarray(0, 16);
  const iv = combined.subarray(16, 28);
  const data = combined.subarray(28);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );

  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("zerofans-signing") },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );

  return new TextDecoder().decode(decrypted);
}
