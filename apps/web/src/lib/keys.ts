const DB_NAME = "zerofans-keys";
const DB_VERSION = 1;
const STORE_NAME = "keypairs";

export interface EncryptedKeypair {
  agentId: string;
  publicKey: string;
  encryptedPrivateKey: string; // base64(salt + iv + ciphertext)
  createdAt: number;
}

export interface Keypair {
  publicKey: string;
  privateKey: string;
}

// ── IndexedDB helpers ──

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "agentId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getRecord(agentId: string): Promise<EncryptedKeypair | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(agentId);
    req.onsuccess = () => resolve(req.result as EncryptedKeypair | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function putRecord(record: EncryptedKeypair): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function deleteRecord(agentId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(agentId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getAllRecords(): Promise<EncryptedKeypair[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as EncryptedKeypair[]);
    req.onerror = () => reject(req.error);
  });
}

// ── Encryption (AES-256-GCM with PBKDF2) ──

const encoder = new TextEncoder();

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 600_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  return btoa(String.fromCharCode(...bytes));
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptPrivateKey(privateKey: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    fromBase64(privateKey) as BufferSource,
  );
  // Combine salt + iv + ciphertext
  const combined = new Uint8Array(16 + 12 + (encrypted as ArrayBuffer).byteLength);
  combined.set(salt, 0);
  combined.set(iv, 16);
  combined.set(new Uint8Array(encrypted), 28);
  return toBase64(combined);
}

async function decryptPrivateKey(encryptedB64: string, password: string): Promise<string> {
  const combined = fromBase64(encryptedB64);
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const ciphertext = combined.slice(28);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ciphertext as BufferSource);
  return toBase64(decrypted);
}

// ── Public API ──

export async function generateKeypair(): Promise<Keypair> {
  const ed25519 = await import("@noble/ed25519");
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  return {
    publicKey: toBase64(publicKey),
    privateKey: toBase64(privateKey),
  };
}

export async function storeKeypair(
  agentId: string,
  keypair: Keypair,
  password: string,
): Promise<void> {
  const encryptedPrivateKey = await encryptPrivateKey(keypair.privateKey, password);
  await putRecord({
    agentId,
    publicKey: keypair.publicKey,
    encryptedPrivateKey,
    createdAt: Date.now(),
  });
}

export async function loadPrivateKey(
  agentId: string,
  password: string,
): Promise<string | null> {
  const record = await getRecord(agentId);
  if (!record) return null;
  try {
    return await decryptPrivateKey(record.encryptedPrivateKey, password);
  } catch {
    return null; // wrong password
  }
}

export async function getPublicKey(agentId: string): Promise<string | null> {
  const record = await getRecord(agentId);
  return record?.publicKey ?? null;
}

export async function hasKey(agentId: string): Promise<boolean> {
  const record = await getRecord(agentId);
  return !!record;
}

export async function deleteKeypair(agentId: string): Promise<void> {
  await deleteRecord(agentId);
}

export async function getAllKeys(): Promise<{ agentId: string; publicKey: string }[]> {
  const records = await getAllRecords();
  return records.map((r) => ({ agentId: r.agentId, publicKey: r.publicKey }));
}

export function exportKeypair(keypair: Keypair & { agentId?: string }): string {
  return JSON.stringify({
    version: 1,
    agentId: keypair.agentId ?? null,
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey,
    exportedAt: new Date().toISOString(),
  }, null, 2);
}

export function parseImport(json: string): Keypair & { agentId?: string } {
  const data = JSON.parse(json);
  if (!data.publicKey || !data.privateKey) {
    throw new Error("Invalid keypair file: missing publicKey or privateKey");
  }
  return {
    agentId: data.agentId ?? undefined,
    publicKey: data.publicKey,
    privateKey: data.privateKey,
  };
}

export function base64ToHex(base64: string): string {
  const bytes = fromBase64(base64);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
