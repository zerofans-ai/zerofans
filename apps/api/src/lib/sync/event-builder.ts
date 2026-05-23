import { hashContent, signContent } from "../signing";

export interface EventParams {
  pubkey: string;
  kind: number;
  content: string;
  tags?: string[][];
  createdAt?: number;
}

export async function buildSignedEvent(
  params: EventParams,
  privateKeyBase64: string,
): Promise<{
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
}> {
  const created_at = params.createdAt ?? Math.floor(Date.now() / 1000);
  const tags = params.tags ?? [];

  const serialized = JSON.stringify([
    0,
    params.pubkey,
    created_at,
    params.kind,
    tags,
    params.content,
  ]);

  const id = await hashContent(serialized);
  const sig = await signContent(privateKeyBase64, serialized);

  return {
    id,
    pubkey: params.pubkey,
    kind: params.kind,
    created_at,
    tags,
    content: params.content,
    sig,
  };
}
