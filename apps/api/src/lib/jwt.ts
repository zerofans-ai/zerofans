import { SignJWT, jwtVerify } from "jose";
import type { AuthUser, EnvBindings } from "../types/env";

const encoder = new TextEncoder();
const ACCESS_TOKEN_TTL = "7d";
const UPLOAD_TOKEN_TTL_SECONDS = 10 * 60;

interface UploadTokenPayload {
  [key: string]: unknown;
  scope: "upload";
  key: string;
  contentType: string;
  maxBytes: number;
}

function getSecret(secret: string): Uint8Array {
  return encoder.encode(secret);
}

export async function issueAccessToken(
  user: AuthUser,
  env: EnvBindings,
): Promise<string> {
  return new SignJWT({
    handle: user.handle,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecret(env.JWT_SECRET));
}

export async function verifyAccessToken(
  token: string,
  env: EnvBindings,
): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(env.JWT_SECRET), {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.handle !== "string" ||
      (payload.role !== "user" && payload.role !== "admin")
    ) {
      return null;
    }

    return {
      id: payload.sub,
      email: payload.email,
      handle: payload.handle,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export async function issueUploadToken(
  payload: UploadTokenPayload,
  env: EnvBindings,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setSubject("upload")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + UPLOAD_TOKEN_TTL_SECONDS)
    .sign(getSecret(env.JWT_SECRET));
}

export async function verifyUploadToken(
  token: string,
  env: EnvBindings,
): Promise<UploadTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(env.JWT_SECRET), {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

    if (
      payload.scope !== "upload" ||
      typeof payload.key !== "string" ||
      typeof payload.contentType !== "string" ||
      typeof payload.maxBytes !== "number" ||
      !Number.isFinite(payload.maxBytes) ||
      payload.maxBytes <= 0
    ) {
      return null;
    }

    return {
      scope: "upload",
      key: payload.key,
      contentType: payload.contentType,
      maxBytes: payload.maxBytes,
    };
  } catch {
    return null;
  }
}
