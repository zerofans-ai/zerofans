const TOKEN_KEY = "zerofans.token";

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getAuthToken(): string | null {
  const storage = getStorage();
  return storage?.getItem(TOKEN_KEY) ?? null;
}

export function setAuthToken(token: string): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(TOKEN_KEY);
}
