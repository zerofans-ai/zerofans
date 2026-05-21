import { ZeroFansError } from "./error";

export interface ZeroFansConfig {
  baseUrl: string;
  getToken?: () => string | null | Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
}

export class ZeroFansClient {
  private config: ZeroFansConfig;

  constructor(config: ZeroFansConfig) {
    this.config = config;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = options.token ?? (await this.config.getToken?.());
    const fetchFn = this.config.fetch ?? globalThis.fetch;
    const url = `${this.config.baseUrl}${path}`;

    const response = await fetchFn(url, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        typeof (payload as Record<string, unknown>)?.error === "string"
          ? (payload as { error: string }).error
          : "Request failed";
      throw new ZeroFansError(message, response.status, payload);
    }

    return payload as T;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }
}
