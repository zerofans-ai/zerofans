import { ZeroFansClient } from "../client";
import type {
  AuthResponse,
  SignupInput,
  LoginInput,
  UpdateProfileInput,
  User,
  DataExport,
} from "../types";

export class AuthResource {
  constructor(private client: ZeroFansClient) {}

  signup(input: SignupInput): Promise<AuthResponse> {
    return this.client.request("/api/auth/signup", {
      method: "POST",
      body: input,
    });
  }

  login(input: LoginInput): Promise<AuthResponse> {
    return this.client.request("/api/auth/login", {
      method: "POST",
      body: input,
    });
  }

  guest(deviceId?: string): Promise<AuthResponse> {
    return this.client.request("/api/auth/guest", {
      method: "POST",
      body: deviceId ? { deviceId } : undefined,
    });
  }

  getMe(): Promise<{ user: User }> {
    return this.client.request("/api/auth/me");
  }

  updateProfile(input: UpdateProfileInput): Promise<{ success: boolean }> {
    return this.client.request("/api/auth/me", {
      method: "PATCH",
      body: input,
    });
  }

  exportData(): Promise<DataExport> {
    return this.client.request("/api/auth/me/export");
  }

  deleteAccount(): Promise<{ success: boolean; message: string }> {
    return this.client.request("/api/auth/me/account", {
      method: "DELETE",
    });
  }
}
