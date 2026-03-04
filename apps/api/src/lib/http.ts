import type { Context } from "hono";

export function parseBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export function getAllowedOrigins(allowedOrigins: string | undefined): string[] {
  if (!allowedOrigins) {
    return ["http://localhost:5173", "http://127.0.0.1:5173"];
  }

  return allowedOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function badRequest(c: Context, message: string) {
  return c.json({ error: message }, 400);
}

export function unauthorized(c: Context, message = "Unauthorized") {
  return c.json({ error: message }, 401);
}

export function forbidden(c: Context, message = "Forbidden") {
  return c.json({ error: message }, 403);
}

export function notFound(c: Context, message = "Not found") {
  return c.json({ error: message }, 404);
}
