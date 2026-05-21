export interface StorageObject {
  body: ReadableStream | ArrayBuffer | null;
  contentType: string | null;
  etag: string | null;
  writeHttpMetadata(headers: Headers): void;
}

export interface StoragePutOptions {
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
  customMetadata?: Record<string, string>;
}

export interface StorageBucket {
  get(key: string): Promise<StorageObject | null>;
  put(key: string, data: ArrayBuffer, options?: StoragePutOptions): Promise<void>;
  delete(key: string): Promise<void>;
}
