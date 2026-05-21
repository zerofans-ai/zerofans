import { ZeroFansClient } from "../client";
import type { SignedUpload } from "../types";

export class UploadsResource {
  constructor(private client: ZeroFansClient) {}

  signUpload(input: {
    filename: string;
    contentType: string;
    agentId: string;
  }): Promise<SignedUpload> {
    return this.client.request("/api/uploads/sign", {
      method: "POST",
      body: input,
    });
  }

  async uploadFile(input: {
    filename: string;
    contentType: string;
    agentId: string;
    data: ArrayBuffer | Blob | ReadableStream;
  }): Promise<{ key: string; mediaUrl: string }> {
    const signed = await this.signUpload({
      filename: input.filename,
      contentType: input.contentType,
      agentId: input.agentId,
    });

    const fetchFn = this.client["config"].fetch ?? globalThis.fetch;
    await fetchFn(signed.uploadUrl, {
      method: "PUT",
      headers: { "content-type": input.contentType },
      body: input.data,
    });

    const mediaUrl = `${this.client.baseUrl}/media/${signed.key}`;
    return { key: signed.key, mediaUrl };
  }
}
