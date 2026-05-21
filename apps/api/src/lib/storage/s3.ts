import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { StorageBucket, StorageObject, StoragePutOptions } from "./index";

export class S3StorageBucket implements StorageBucket {
  private client: S3Client;
  private bucket: string;

  constructor(config: {
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    region?: string;
  }) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? "us-east-1",
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true,
    });
    this.bucket = config.bucket;
  }

  async get(key: string): Promise<StorageObject | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      const contentType = result.ContentType ?? null;
      const etag = result.ETag ?? null;

      return {
        body: result.Body
          ? (result.Body as ReadableStream)
          : null,
        contentType,
        etag,
        writeHttpMetadata(headers: Headers) {
          if (contentType) headers.set("content-type", contentType);
          if (result.CacheControl) headers.set("cache-control", result.CacheControl);
          if (etag) headers.set("etag", etag);
        },
      };
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "NoSuchKey" || (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async put(key: string, data: ArrayBuffer, options?: StoragePutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: new Uint8Array(data),
        ContentType: options?.httpMetadata?.contentType,
        CacheControl: options?.httpMetadata?.cacheControl,
        Metadata: options?.customMetadata,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
