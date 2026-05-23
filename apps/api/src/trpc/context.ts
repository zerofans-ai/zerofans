import type { Sql } from "../db";
import type { StorageBucket } from "../lib/storage";

export interface SyncNode {
  id: string;
  name: string;
  publicKey: string;
  capabilities: string[];
}

export function createTRPCContext(opts: {
  sql: Sql;
  storage: StorageBucket;
  node?: SyncNode;
  signingSecret?: string;
}): Context {
  return {
    sql: opts.sql,
    storage: opts.storage,
    node: opts.node ?? null,
    signingSecret: opts.signingSecret ?? null,
  };
}

export type Context = {
  sql: Sql;
  storage: StorageBucket;
  node: SyncNode | null;
  signingSecret: string | null;
};
