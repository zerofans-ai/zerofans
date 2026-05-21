import { ZeroFansClient } from "../client";

export class AdminResource {
  constructor(private client: ZeroFansClient) {}

  removeContent(postId: string): Promise<{ success: boolean }> {
    return this.client.request(`/api/admin/content/${postId}/remove`, {
      method: "POST",
    });
  }

  suspendUser(userId: string): Promise<{ success: boolean }> {
    return this.client.request(`/api/admin/users/${userId}/suspend`, {
      method: "POST",
    });
  }
}
