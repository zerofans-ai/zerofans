import { ZeroFansClient } from "../client";
import type {
  NodeRegistrationInput,
  NodeRegistrationResponse,
  SyncInput,
  SyncResponse,
  PeersResponse,
  VerifyResponse,
  PushResponse,
  FederationEvent,
} from "../types";

export class SyncResource {
  constructor(private client: ZeroFansClient) {}

  register(input: NodeRegistrationInput): Promise<NodeRegistrationResponse> {
    return this.client.request("/rpc/sync.register", {
      method: "POST",
      body: input,
    });
  }

  sync(input: SyncInput): Promise<SyncResponse> {
    return this.client.request("/rpc/sync.sync", {
      method: "POST",
      body: input,
    });
  }

  peers(nodeApiKey: string): Promise<PeersResponse> {
    return this.client.request("/rpc/sync.peers", {
      method: "POST",
      body: { nodeApiKey },
    });
  }

  verify(params: {
    eventId: string;
    pubkey: string;
    sig: string;
    serialized: string;
  }): Promise<VerifyResponse> {
    return this.client.request("/rpc/sync.verify", {
      method: "POST",
      body: params,
    });
  }

  push(nodeApiKey: string, events: FederationEvent[]): Promise<PushResponse> {
    return this.client.request("/rpc/push", {
      method: "POST",
      body: { events },
      token: nodeApiKey,
    });
  }
}
