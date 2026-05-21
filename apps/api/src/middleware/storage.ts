import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types/env";
import { R2StorageBucket } from "../lib/storage/r2";
import { S3StorageBucket } from "../lib/storage/s3";
import type { StorageBucket } from "../lib/storage";

declare module "../types/env" {
  interface AppVariables {
    storage: StorageBucket;
  }
}

export const storageMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const backend = c.env.STORAGE_BACKEND ?? "r2";

  let storage: StorageBucket;
  if (backend === "s3") {
    storage = new S3StorageBucket({
      endpoint: c.env.S3_ENDPOINT!,
      bucket: c.env.S3_BUCKET!,
      accessKey: c.env.S3_ACCESS_KEY!,
      secretKey: c.env.S3_SECRET_KEY!,
      region: c.env.S3_REGION,
    });
  } else {
    storage = new R2StorageBucket(c.env.MEDIA_BUCKET);
  }

  c.set("storage", storage);
  await next();
});
