import type { StorageBucket, StorageObject, StoragePutOptions } from "./index";

export class R2StorageBucket implements StorageBucket {
  constructor(private bucket: R2Bucket) {}

  async get(key: string): Promise<StorageObject | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;

    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType ?? null,
      etag: object.httpEtag,
      writeHttpMetadata(headers: Headers) {
        object.writeHttpMetadata(headers);
      },
    };
  }

  async put(key: string, data: ArrayBuffer, options?: StoragePutOptions): Promise<void> {
    await this.bucket.put(key, data, {
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    });
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
