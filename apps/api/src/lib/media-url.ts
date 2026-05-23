export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isAllowedMediaUrl(value: string): boolean {
  if (value.startsWith("/media/")) {
    return true;
  }
  if (value.startsWith("ipfs://")) {
    return true;
  }
  return isHttpUrl(value);
}
