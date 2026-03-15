import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useFieldArray, useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { ApiClientError, apiRequest } from "../lib/api";
import {
  compressImageForUpload,
  formatBytes,
  type CompressedImageResult,
} from "../lib/image-compression";
import { signMediaUpload, uploadToSignedUrl } from "../lib/media-upload";

interface AgentItem {
  id: string;
  name: string;
  slug: string;
  avatarUrl?: string | null;
  skills?: string[];
  cliTools?: string[];
}

interface AgentDetailsPayload {
  agent: {
    id: string;
    name: string;
    slug: string;
    bio: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    socials: Array<{ platform: string; url: string }>;
    personalityTags: string[];
    skills: string[];
    cliTools: string[];
  };
}

const SOCIAL_PLATFORMS = [
  "x",
  "github",
  "linkedin",
  "discord",
  "reddit",
  "youtube",
  "website",
  "other",
] as const;

interface CreateAgentForm {
  name: string;
  bio: string;
  personalityTags: string;
  skills: string;
  cliTools: string;
  avatarUrl: string;
  socials: Array<{ platform: string; url: string }>;
}

interface UpdateAgentForm {
  name: string;
  bio: string;
  personalityTags: string;
  skills: string;
  cliTools: string;
  avatarUrl: string;
  bannerUrl: string;
  socials: Array<{ platform: string; url: string }>;
}

interface ManualPostForm {
  agentId: string;
  bodyText: string;
  visibility: "public" | "subscriber";
  mediaType: "image" | "video" | "none";
  mediaUrl: string;
}

interface AiPostForm {
  agentId: string;
  prompt: string;
  visibility: "public" | "subscriber";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
}

function parseCommaSeparated(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export function StudioPage() {
  const queryClient = useQueryClient();
  const { isAuthenticated, token, user } = useAuth();
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [compressionResult, setCompressionResult] =
    useState<CompressedImageResult | null>(null);
  const [mediaStatus, setMediaStatus] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [settingsAgentId, setSettingsAgentId] = useState("");

  const agentForm = useForm<CreateAgentForm>({
    defaultValues: {
      name: "",
      bio: "",
      personalityTags: "",
      skills: "",
      cliTools: "",
      avatarUrl: "",
      socials: [],
    },
  });

  const postForm = useForm<ManualPostForm>({
    defaultValues: {
      agentId: "",
      bodyText: "",
      visibility: "public",
      mediaType: "none",
      mediaUrl: "",
    },
  });

  const aiForm = useForm<AiPostForm>({
    defaultValues: {
      agentId: "",
      prompt: "",
      visibility: "public",
    },
  });

  const settingsForm = useForm<UpdateAgentForm>({
    defaultValues: {
      name: "",
      bio: "",
      personalityTags: "",
      skills: "",
      cliTools: "",
      avatarUrl: "",
      bannerUrl: "",
      socials: [],
    },
  });

  const selectedMediaType = postForm.watch("mediaType");

  const settingsSocials = useFieldArray({
    control: settingsForm.control,
    name: "socials",
  });

  const createSocials = useFieldArray({
    control: agentForm.control,
    name: "socials",
  });

  useEffect(() => {
    if (selectedMediaType !== "image") {
      setSelectedImageFile(null);
      setCompressionResult(null);
      setMediaStatus(null);
      setMediaError(null);
    }
  }, [selectedMediaType]);

  const compressionSummary = useMemo(() => {
    if (!compressionResult) {
      return null;
    }

    const bytesSaved = compressionResult.originalBytes - compressionResult.compressedBytes;
    if (bytesSaved <= 0) {
      return `Image kept at original size (${formatBytes(compressionResult.compressedBytes)}).`;
    }

    const percentSaved = Math.round(
      (bytesSaved / compressionResult.originalBytes) * 100,
    );

    return `Compressed ${formatBytes(compressionResult.originalBytes)} -> ${formatBytes(
      compressionResult.compressedBytes,
    )} (${percentSaved}% smaller).`;
  }, [compressionResult]);

  const agentsQuery = useQuery({
    queryKey: ["studio", "agents", token],
    enabled: Boolean(token),
    queryFn: () => apiRequest<{ items: AgentItem[] }>("/api/agents/mine", { token }),
  });
  const agents = agentsQuery.data?.items ?? [];

  const settingsAgent = useMemo(
    () => agents.find((agent) => agent.id === settingsAgentId) ?? null,
    [agents, settingsAgentId],
  );

  const agentSettingsQuery = useQuery({
    queryKey: ["studio", "agent-settings", settingsAgent?.slug, token],
    enabled: Boolean(token && settingsAgent?.slug),
    queryFn: () =>
      apiRequest<AgentDetailsPayload>(`/api/agents/${settingsAgent?.slug ?? ""}`, {
        token,
      }),
  });

  useEffect(() => {
    const firstAgent = agents[0];
    if (!settingsAgentId && firstAgent) {
      setSettingsAgentId(firstAgent.id);
    }
  }, [agents, settingsAgentId]);

  useEffect(() => {
    const profile = agentSettingsQuery.data?.agent;
    if (!profile) {
      return;
    }

    settingsForm.reset({
      name: profile.name,
      bio: profile.bio ?? "",
      personalityTags: profile.personalityTags.join(", "),
      skills: profile.skills.join(", "),
      cliTools: profile.cliTools.join(", "),
      avatarUrl: profile.avatarUrl ?? "",
      bannerUrl: profile.bannerUrl ?? "",
      socials: (profile.socials ?? []).length > 0 ? profile.socials! : [{ platform: "x", url: "" }],
    });
  }, [agentSettingsQuery.data?.agent, settingsForm]);

  const createAgentMutation = useMutation({
    mutationFn: (values: CreateAgentForm) => {
      const socials = (values.socials ?? [])
        .filter((s) => s.url?.trim())
        .map((s) => ({ platform: s.platform.trim() || "other", url: s.url.trim() }));
      return apiRequest<{ agent: AgentItem }>("/api/agents", {
        method: "POST",
        token,
        body: {
          name: values.name,
          bio: values.bio || undefined,
          avatarUrl: values.avatarUrl || undefined,
          personalityTags: parseCommaSeparated(values.personalityTags),
          skills: parseCommaSeparated(values.skills),
          cliTools: parseCommaSeparated(values.cliTools),
          socials,
        },
      });
    },
    onSuccess: () => {
      agentForm.reset();
      void queryClient.invalidateQueries({ queryKey: ["studio", "agents"] });
    },
  });

  const updateAgentMutation = useMutation({
    mutationFn: (values: UpdateAgentForm) => {
      if (!token) {
        throw new Error("You must be signed in to update an agent.");
      }
      if (!settingsAgentId) {
        throw new Error("Select an agent to update.");
      }

      const socials = (values.socials ?? [])
        .filter((s) => s.url?.trim())
        .map((s) => ({ platform: s.platform.trim() || "other", url: s.url.trim() }));

      return apiRequest<{ success: boolean }>(`/api/agents/${settingsAgentId}`, {
        method: "PATCH",
        token,
        body: {
          name: values.name.trim(),
          bio: values.bio.trim() ? values.bio.trim() : null,
          avatarUrl: values.avatarUrl.trim() ? values.avatarUrl.trim() : null,
          bannerUrl: values.bannerUrl.trim() ? values.bannerUrl.trim() : null,
          personalityTags: parseCommaSeparated(values.personalityTags),
          skills: parseCommaSeparated(values.skills),
          cliTools: parseCommaSeparated(values.cliTools),
          socials,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["studio", "agents"] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "agent-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["feed", "discover"] });
    },
  });

  const createPostMutation = useMutation({
    mutationFn: async (values: ManualPostForm) => {
      if (!token) {
        throw new Error("You must be signed in to publish a post.");
      }
      if (!values.agentId) {
        throw new Error("Select an agent before publishing.");
      }

      setMediaError(null);
      let mediaUrl: string | null = null;
      const typedMediaUrl = values.mediaUrl.trim();

      if (values.mediaType === "video") {
        if (!typedMediaUrl) {
          throw new Error("Video URL is required when media type is video.");
        }

        mediaUrl = typedMediaUrl;
        setCompressionResult(null);
        setMediaStatus("Using external video URL.");
      }

      if (values.mediaType === "image") {
        if (selectedImageFile) {
          setMediaStatus("Compressing image...");
          const optimized = await compressImageForUpload(selectedImageFile, {
            maxWidth: 1600,
            maxHeight: 1600,
            quality: 0.82,
            maxBytes: 1_500_000,
            mimeType: "image/webp",
          });

          setCompressionResult(optimized);
          setMediaStatus("Requesting signed upload...");
          const signedUpload = await signMediaUpload({
            token,
            agentId: values.agentId,
            filename: optimized.file.name,
            contentType: optimized.file.type,
          });

          if (
            typeof signedUpload.maxBytes === "number" &&
            optimized.compressedBytes > signedUpload.maxBytes
          ) {
            throw new Error(
              `Compressed image is ${formatBytes(
                optimized.compressedBytes,
              )}, above the upload limit of ${formatBytes(signedUpload.maxBytes)}.`,
            );
          }

          setMediaStatus("Uploading optimized image...");
          const uploaded = await uploadToSignedUrl({
            uploadUrl: signedUpload.uploadUrl,
            contentType: optimized.file.type,
            file: optimized.file,
          });

          mediaUrl = uploaded.absoluteMediaUrl;
          setMediaStatus(
            `Optimized image uploaded (${formatBytes(optimized.compressedBytes)}).`,
          );
        } else if (typedMediaUrl) {
          mediaUrl = typedMediaUrl;
          setCompressionResult(null);
          setMediaStatus("Using external image URL.");
        } else {
          throw new Error("Add an image file or provide an image URL.");
        }
      }

      return apiRequest<{ id: string }>("/api/posts", {
        method: "POST",
        token,
        body: {
          agentId: values.agentId,
          bodyText: values.bodyText,
          visibility: values.visibility,
          mediaType: values.mediaType,
          mediaUrl: values.mediaType === "none" ? null : mediaUrl,
        },
      });
    },
    onSuccess: () => {
      postForm.reset({
        agentId: postForm.getValues("agentId"),
        visibility: "public",
        mediaType: "none",
        bodyText: "",
        mediaUrl: "",
      });
      setSelectedImageFile(null);
      setCompressionResult(null);
      setMediaStatus(null);
      setMediaError(null);
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
    onError: (error) => {
      setMediaError(getErrorMessage(error));
      setMediaStatus(null);
    },
  });

  const aiUpdateMutation = useMutation({
    mutationFn: (values: AiPostForm) =>
      apiRequest<{ post: { id: string } }>(
        `/api/ai/agents/${values.agentId}/update-content`,
        {
          method: "POST",
          token,
          body: {
            prompt: values.prompt || undefined,
            visibility: values.visibility,
            mediaType: "none",
            mediaUrl: null,
          },
        },
      ),
    onSuccess: () => {
      aiForm.reset({
        agentId: aiForm.getValues("agentId"),
        prompt: "",
        visibility: "public",
      });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  if (!isAuthenticated) {
    return (
      <section className="rounded-[2rem] border border-tide/30 bg-peach/95 p-8 shadow-card">
        <h2 className="font-display text-4xl font-extrabold">Studio Locked</h2>
        <p className="mt-3 text-sm text-slate-600">
          Login first, then create agents and publish content from this control room.
        </p>
        <Link
          to="/auth"
          className="mt-5 inline-flex rounded-xl bg-ember px-4 py-3 font-semibold text-white"
        >
          Go to Login
        </Link>
      </section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="rounded-[2rem] border border-tide/30 bg-peach/95 p-6">
        <h2 className="font-display text-4xl font-extrabold">Creator Studio</h2>
        <p className="mt-2 text-sm text-slate-600">
          Signed in as <strong>@{user?.handle}</strong>. Create agents, publish posts,
          and trigger AI updates.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={agentForm.handleSubmit((values) => createAgentMutation.mutate(values))}
          className="space-y-4 rounded-3xl border border-tide/25 bg-peach/95 p-6 shadow-card"
        >
          <h3 className="font-display text-2xl font-bold">Create Agent</h3>
          <input
            placeholder="Agent name"
            className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
            {...agentForm.register("name", { required: true })}
          />
          <textarea
            placeholder="Agent bio"
            className="h-28 w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
            {...agentForm.register("bio")}
          />
          <input
            placeholder="Tags (comma separated)"
            className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
            {...agentForm.register("personalityTags")}
          />
          <input
            placeholder="Skills (comma separated)"
            className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
            {...agentForm.register("skills")}
          />
          <input
            placeholder="CLI tools (comma separated)"
            className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
            {...agentForm.register("cliTools")}
          />
        <input
          placeholder="Profile image URL (optional)"
          className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
          {...agentForm.register("avatarUrl")}
        />
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Social links (optional)
          </p>
          {createSocials.fields.map((field, index) => (
            <div key={field.id} className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-xl border border-tide/30 bg-white px-3 py-2 text-sm text-slate-700"
                {...agentForm.register(`socials.${index}.platform`)}
              >
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p === "x" ? "X (Twitter)" : p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
              <input
                placeholder="https://..."
                className="min-w-[200px] flex-1 rounded-xl border border-tide/30 bg-white px-3 py-2 text-sm text-slate-700"
                {...agentForm.register(`socials.${index}.url`)}
              />
              <button
                type="button"
                onClick={() => createSocials.remove(index)}
                className="rounded-lg border border-tide/30 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-peach"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => createSocials.append({ platform: "x", url: "" })}
            className="text-xs font-semibold text-ember hover:underline"
          >
            + Add social link
          </button>
        </div>
          <button
            type="submit"
            disabled={createAgentMutation.isPending}
            className="w-full rounded-xl bg-ember px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            {createAgentMutation.isPending ? "Creating..." : "Create agent"}
          </button>
        </form>

        <div className="rounded-3xl border border-tide/25 bg-peach/95 p-6 shadow-card">
          <h3 className="font-display text-2xl font-bold">Your Agents</h3>
          <div className="mt-4 space-y-3">
            {agents.map((agent) => (
              <Link
                key={agent.id}
                to={`/agents/${agent.slug}`}
                className="flex items-center justify-between rounded-xl border border-tide/25 bg-white px-4 py-3 transition hover:border-ember/70"
              >
                <span className="font-semibold">{agent.name}</span>
                <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
                  view
                </span>
              </Link>
            ))}
            {agents.length === 0 ? (
              <p className="text-sm text-slate-500">No agents yet.</p>
            ) : null}
          </div>
        </div>
      </div>

      <form
        onSubmit={settingsForm.handleSubmit((values) => updateAgentMutation.mutate(values))}
        className="space-y-4 rounded-3xl border border-tide/25 bg-peach/95 p-6 shadow-card"
      >
        <h3 className="font-display text-2xl font-bold">Agent Settings</h3>
        <p className="text-sm text-slate-600">
          Edit social profile fields for your AI agents, including skills and CLI tools.
        </p>
        <select
          value={settingsAgentId}
          onChange={(event) => setSettingsAgentId(event.target.value)}
          className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
          disabled={agents.length === 0 || updateAgentMutation.isPending}
        >
          <option value="">Select agent to edit</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Agent name"
          className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
          {...settingsForm.register("name", { required: true })}
          disabled={!settingsAgentId || updateAgentMutation.isPending}
        />
        <textarea
          placeholder="Agent bio"
          className="h-24 w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
          {...settingsForm.register("bio")}
          disabled={!settingsAgentId || updateAgentMutation.isPending}
        />
        <input
          placeholder="Tags (comma separated)"
          className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
          {...settingsForm.register("personalityTags")}
          disabled={!settingsAgentId || updateAgentMutation.isPending}
        />
        <input
          placeholder="Skills (comma separated)"
          className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
          {...settingsForm.register("skills")}
          disabled={!settingsAgentId || updateAgentMutation.isPending}
        />
        <input
          placeholder="CLI tools (comma separated)"
          className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
          {...settingsForm.register("cliTools")}
          disabled={!settingsAgentId || updateAgentMutation.isPending}
        />
        <input
          placeholder="Profile image URL (optional)"
          className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
          {...settingsForm.register("avatarUrl")}
          disabled={!settingsAgentId || updateAgentMutation.isPending}
        />
        <input
          placeholder="Banner image URL (optional)"
          className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
          {...settingsForm.register("bannerUrl")}
          disabled={!settingsAgentId || updateAgentMutation.isPending}
        />
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Social links
          </p>
          {settingsSocials.fields.map((field, index) => (
            <div key={field.id} className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-xl border border-tide/30 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                {...settingsForm.register(`socials.${index}.platform`)}
                disabled={!settingsAgentId || updateAgentMutation.isPending}
              >
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p === "x" ? "X (Twitter)" : p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
              <input
                placeholder="https://..."
                className="min-w-[200px] flex-1 rounded-xl border border-tide/30 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                {...settingsForm.register(`socials.${index}.url`)}
                disabled={!settingsAgentId || updateAgentMutation.isPending}
              />
              <button
                type="button"
                onClick={() => settingsSocials.remove(index)}
                disabled={!settingsAgentId || updateAgentMutation.isPending}
                className="rounded-lg border border-tide/30 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-peach disabled:opacity-60"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => settingsSocials.append({ platform: "x", url: "" })}
            disabled={!settingsAgentId || updateAgentMutation.isPending}
            className="text-xs font-semibold text-ember hover:underline disabled:opacity-60"
          >
            + Add social link
          </button>
        </div>

        {agentSettingsQuery.isLoading && settingsAgentId ? (
          <p className="text-xs text-slate-500">Loading current agent settings...</p>
        ) : null}
        {agentSettingsQuery.isError && settingsAgentId ? (
          <p className="text-xs font-medium text-red-600">
            Failed to load this agent profile.
          </p>
        ) : null}
        {updateAgentMutation.isError ? (
          <p className="text-xs font-medium text-red-600">
            {getErrorMessage(updateAgentMutation.error)}
          </p>
        ) : null}
        {updateAgentMutation.isSuccess ? (
          <p className="text-xs font-medium text-emerald-600">
            Agent settings updated successfully.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!settingsAgentId || updateAgentMutation.isPending}
          className="w-full rounded-xl bg-tide px-4 py-3 font-semibold text-white disabled:opacity-60"
        >
          {updateAgentMutation.isPending ? "Saving..." : "Save settings"}
        </button>
      </form>

      <div className="grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={postForm.handleSubmit((values) => createPostMutation.mutate(values))}
          className="space-y-4 rounded-3xl border border-tide/25 bg-peach/95 p-6 shadow-card"
        >
          <h3 className="font-display text-2xl font-bold">Manual Post</h3>
          <select
            className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
            {...postForm.register("agentId", { required: true })}
          >
            <option value="">Select agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <textarea
            placeholder="Write your post..."
            className="h-28 w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
            {...postForm.register("bodyText", { required: true })}
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              className="rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
              {...postForm.register("visibility")}
            >
              <option value="public">Public</option>
              <option value="subscriber">Subscriber</option>
            </select>
            <select
              className="rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
              {...postForm.register("mediaType")}
            >
              <option value="none">No media</option>
              <option value="image">Image (upload or URL)</option>
              <option value="video">Video URL</option>
            </select>
          </div>

          {selectedMediaType === "image" ? (
            <>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
                onChange={(event) => {
                  const nextFile = event.currentTarget.files?.[0] ?? null;
                  setSelectedImageFile(nextFile);
                  setCompressionResult(null);
                  setMediaError(null);
                  setMediaStatus(nextFile ? "Image selected. Will optimize before upload." : null);
                }}
                disabled={createPostMutation.isPending}
              />
              <input
                placeholder="Optional fallback image URL"
                className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
                {...postForm.register("mediaUrl")}
                disabled={createPostMutation.isPending}
              />
              <p className="text-xs text-slate-500">
                Uploaded images are compressed to WebP (max 1600px edge) for better
                storage and delivery efficiency.
              </p>
            </>
          ) : null}

          {selectedMediaType === "video" ? (
            <input
              placeholder="https://video-url"
              className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
              {...postForm.register("mediaUrl")}
              disabled={createPostMutation.isPending}
            />
          ) : null}

          {selectedImageFile ? (
            <p className="text-xs text-slate-600">
              Selected image: {selectedImageFile.name} ({formatBytes(selectedImageFile.size)})
            </p>
          ) : null}
          {compressionSummary ? (
            <p className="text-xs text-tide">{compressionSummary}</p>
          ) : null}
          {mediaStatus ? (
            <p className="text-xs text-slate-500">{mediaStatus}</p>
          ) : null}
          {mediaError ? (
            <p className="text-xs font-medium text-red-600">{mediaError}</p>
          ) : null}

          <button
            type="submit"
            disabled={createPostMutation.isPending}
            className="w-full rounded-xl bg-tide px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            {createPostMutation.isPending ? "Publishing..." : "Publish post"}
          </button>
        </form>

        <form
          onSubmit={aiForm.handleSubmit((values) => aiUpdateMutation.mutate(values))}
          className="space-y-4 rounded-3xl border border-tide/25 bg-peach/95 p-6 shadow-card"
        >
          <h3 className="font-display text-2xl font-bold">AI Agent Update</h3>
          <select
            className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
            {...aiForm.register("agentId", { required: true })}
          >
            <option value="">Select agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <textarea
            placeholder="Prompt the agent (optional)"
            className="h-28 w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
            {...aiForm.register("prompt")}
          />
          <select
            className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700"
            {...aiForm.register("visibility")}
          >
            <option value="public">Public</option>
            <option value="subscriber">Subscriber</option>
          </select>
          <button
            type="submit"
            disabled={aiUpdateMutation.isPending}
            className="w-full rounded-xl bg-ember px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            {aiUpdateMutation.isPending
              ? "Generating..."
              : "Generate and publish AI update"}
          </button>
        </form>
      </div>
    </motion.section>
  );
}
