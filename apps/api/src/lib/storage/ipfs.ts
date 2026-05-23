import type { StorageBucket, StorageObject, StoragePutOptions } from "./index";

const PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const CID_PREFIXES = ["Qm", "bafy", "bafk"];

function isCID(key: string): boolean {
  return CID_PREFIXES.some((p) => key.startsWith(p));
}

export class IPFSStorageBucket implements StorageBucket {
  private jwt: string;
  private gateway: string;

  constructor(config: { jwt: string; gateway: string }) {
    this.jwt = config.jwt;
    this.gateway = config.gateway.replace(/\/$/, "");
  }

  async put(
    key: string,
    data: ArrayBuffer,
    options?: StoragePutOptions,
  ): Promise<string> {
    const contentType = options?.httpMetadata?.contentType ?? "application/octet-stream";
    const filename = key.split("/").pop() ?? "file";

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([data], { type: contentType }),
      filename,
    );

    if (options?.customMetadata) {
      const pinataMetadata = {
        key,
        name: filename,
        keyvalues: options.customMetadata,
      };
      formData.append("pinataMetadata", JSON.stringify(pinataMetadata));
    }

    const res = await fetch(PINATA_PIN_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.jwt}` },
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`Pinata pin failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as { IpfsHash: string };
    return json.IpfsHash;
  }

  async get(key: string): Promise<StorageObject | null> {
    const cid = isCID(key) ? key : null;
    if (!cid) return null;

    const url = `${this.gateway}/ipfs/${cid}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type");
    const body = await res.arrayBuffer();

    return {
      body,
      contentType,
      etag: `"${cid}"`,
      writeHttpMetadata(headers: Headers) {
        if (contentType) headers.set("content-type", contentType);
        headers.set("cache-control", "public, max-age=31536000, immutable");
        headers.set("etag", `"${cid}"`);
      },
    };
  }

  async delete(key: string): Promise<void> {
    const cid = isCID(key) ? key : null;
    if (!cid) return;

    const res = await fetch(
      `https://api.pinata.cloud/pinning/unpin/${cid}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.jwt}` },
      },
    );

    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`Pinata unpin failed (${res.status}): ${text}`);
    }
  }
}
