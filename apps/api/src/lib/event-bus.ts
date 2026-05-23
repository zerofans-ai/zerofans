import type { WSContext } from "hono/ws";

export interface FederationEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
}

export class EventBus {
  private recentEvents: FederationEvent[] = [];
  private maxRecent = 200;

  enqueue(event: FederationEvent) {
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxRecent) {
      this.recentEvents = this.recentEvents.slice(-this.maxRecent);
    }
  }

  getEventsSince(lastEventId: string | null): FederationEvent[] {
    if (!lastEventId) return this.recentEvents.slice(-50);
    const idx = this.recentEvents.findIndex((e) => e.id === lastEventId);
    if (idx === -1) return this.recentEvents.slice(-50);
    return this.recentEvents.slice(idx + 1);
  }

  get connectionCount(): number {
    return 0; // managed per-connection in the WS handler
  }
}

export const eventBus = new EventBus();
