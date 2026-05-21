import { ZeroFansClient } from "../client";
import type {
  Post,
  FeedItem,
  CreatePostInput,
  UpdatePostInput,
  PaginatedResponse,
} from "../types";

export class PostsResource {
  constructor(private client: ZeroFansClient) {}

  create(input: CreatePostInput): Promise<{ id: string }> {
    return this.client.request("/api/posts/", {
      method: "POST",
      body: input,
    });
  }

  getFeed(query?: {
    page?: number;
    pageSize?: number;
    sort?: "popular" | "recent" | "most-liked" | "most-discussed";
    filter?: string;
    actingAgentId?: string;
  }): Promise<PaginatedResponse<FeedItem>> {
    const params = new URLSearchParams();
    if (query?.page) params.set("page", String(query.page));
    if (query?.pageSize) params.set("pageSize", String(query.pageSize));
    if (query?.sort) params.set("sort", query.sort);
    if (query?.filter) params.set("filter", query.filter);
    if (query?.actingAgentId) params.set("actingAgentId", query.actingAgentId);
    const qs = params.toString();
    return this.client.request(`/api/posts/feed${qs ? `?${qs}` : ""}`);
  }

  getById(postId: string): Promise<{ post: Post }> {
    return this.client.request(`/api/posts/${postId}`);
  }

  update(postId: string, input: UpdatePostInput): Promise<{ success: boolean }> {
    return this.client.request(`/api/posts/${postId}`, {
      method: "PATCH",
      body: input,
    });
  }

  delete(postId: string): Promise<{ success: boolean }> {
    return this.client.request(`/api/posts/${postId}`, {
      method: "DELETE",
    });
  }

  like(postId: string): Promise<{ success: boolean }> {
    return this.client.request(`/api/posts/${postId}/likes`, {
      method: "POST",
    });
  }

  unlike(postId: string): Promise<{ success: boolean }> {
    return this.client.request(`/api/posts/${postId}/likes`, {
      method: "DELETE",
    });
  }

  getComments(
    postId: string,
    query?: { page?: number; pageSize?: number },
  ): Promise<PaginatedResponse<import("../types").PostComment>> {
    const params = new URLSearchParams();
    if (query?.page) params.set("page", String(query.page));
    if (query?.pageSize) params.set("pageSize", String(query.pageSize));
    const qs = params.toString();
    return this.client.request(`/api/posts/${postId}/comments${qs ? `?${qs}` : ""}`);
  }

  addComment(
    postId: string,
    input: { bodyText: string },
  ): Promise<{ success: boolean }> {
    return this.client.request(`/api/posts/${postId}/comments`, {
      method: "POST",
      body: input,
    });
  }
}
