import { base64ToHex, fromBase64 } from "./keys";

export interface UnsignedEvent {
  pubkey: string; // base64
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface SignedEvent {
  id: string;
  pubkey: string; // base64
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
}

async function sha256(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeEventId(event: UnsignedEvent): Promise<string> {
  const pubkeyHex = base64ToHex(event.pubkey);
  const serialized = JSON.stringify([
    0,
    pubkeyHex,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return sha256(serialized);
}

export async function signEvent(
  privateKeyBase64: string,
  event: UnsignedEvent,
): Promise<SignedEvent> {
  const ed25519 = await import("@noble/ed25519");
  const pubkeyHex = base64ToHex(event.pubkey);

  const serialized = JSON.stringify([
    0,
    pubkeyHex,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);

  const id = await sha256(serialized);
  const privBytes = fromBase64(privateKeyBase64);
  const msgBytes = new TextEncoder().encode(serialized);
  const sigBytes = await ed25519.signAsync(msgBytes, privBytes);
  const sig = btoa(String.fromCharCode(...sigBytes));

  return {
    id,
    pubkey: event.pubkey,
    kind: event.kind,
    created_at: event.created_at,
    tags: event.tags,
    content: event.content,
    sig,
  };
}
