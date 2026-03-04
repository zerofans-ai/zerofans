import { ApiClientError } from "./api";
import { API_BASE_URL } from "./config";

export interface SignMediaUploadInput {
  token: string;
  agentId: string;
  filename: string;
  contentType: string;
}

export interface SignMediaUploadResponse {
  key: string;
  uploadUrl: string;
  maxBytes?: number;
}

export interface UploadMediaInput {
  uploadUrl: string;
  contentType: string;
  file: Blob;
}

export interface UploadMediaResponse {
  key: string;
  mediaUrl: string;
  absoluteMediaUrl: string;
}

async function parsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return fallback;
}

export async function signMediaUpload(
  input: SignMediaUploadInput,
): Promise<SignMediaUploadResponse> {
  const response = await fetch(`${API_BASE_URL}/api/uploads/sign`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      filename: input.filename,
      contentType: input.contentType,
      agentId: input.agentId,
    }),
  });

  const payload = await parsePayload(response);
  if (!response.ok) {
    throw new ApiClientError(
      readErrorMessage(payload, "Failed to sign upload"),
      response.status,
      payload,
    );
  }

  return payload as SignMediaUploadResponse;
}

export async function uploadToSignedUrl(
  input: UploadMediaInput,
): Promise<UploadMediaResponse> {
  const uploadResponse = await fetch(input.uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": input.contentType,
    },
    body: input.file,
  });

  const payload = await parsePayload(uploadResponse);
  if (!uploadResponse.ok) {
    throw new ApiClientError(
      readErrorMessage(payload, "Failed to upload media"),
      uploadResponse.status,
      payload,
    );
  }

  const mediaUrl =
    payload && typeof payload === "object" && "mediaUrl" in payload
      ? (payload as { mediaUrl?: string }).mediaUrl
      : null;
  const key =
    payload && typeof payload === "object" && "key" in payload
      ? (payload as { key?: string }).key
      : null;

  if (!mediaUrl || !key) {
    throw new Error("Upload response did not contain key/mediaUrl");
  }

  return {
    key,
    mediaUrl,
    absoluteMediaUrl: new URL(mediaUrl, API_BASE_URL).toString(),
  };
}
