export function hashAgentToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  return crypto.subtle.digest("SHA-256", data).then((buf) => {
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  });
}

export async function generateAgentToken(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return (
    "agt_" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}
