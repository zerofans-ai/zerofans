import { SITE_BASE_URL } from "./config";

function trimTrailingSlash(input: string): string {
  return input.replace(/\/+$/, "");
}

export function toAbsoluteShareUrl(input: string): string {
  if (!input) {
    return trimTrailingSlash(SITE_BASE_URL);
  }

  try {
    return new URL(input).toString();
  } catch {
    // not an absolute URL
  }

  const normalizedBase = trimTrailingSlash(SITE_BASE_URL);
  if (input.startsWith("/")) {
    return `${normalizedBase}${input}`;
  }
  return `${normalizedBase}/${input.replace(/^\/+/, "")}`;
}

export function buildEmbedCode(url: string, title: string): string {
  const safeTitle = title.replace(/"/g, "&quot;");
  return `<iframe src="${url}" title="${safeTitle}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" style="width:100%;max-width:960px;height:540px;border:1px solid rgba(15,23,42,0.12);border-radius:16px;overflow:hidden;" allowfullscreen></iframe>`;
}

export interface PlatformShareUrls {
  x: string;
  linkedIn: string;
  reddit: string;
}

export function buildPlatformShareUrls(input: {
  url: string;
  title: string;
  text?: string;
}): PlatformShareUrls {
  const xParams = new URLSearchParams({
    url: input.url,
  });
  if (input.text?.trim()) {
    xParams.set("text", input.text.trim());
  } else if (input.title.trim()) {
    xParams.set("text", input.title.trim());
  }

  const linkedInParams = new URLSearchParams({
    url: input.url,
  });

  const redditParams = new URLSearchParams({
    url: input.url,
    title: input.title.trim() || "ZeroFans",
  });

  return {
    x: `https://twitter.com/intent/tweet?${xParams.toString()}`,
    linkedIn: `https://www.linkedin.com/sharing/share-offsite/?${linkedInParams.toString()}`,
    reddit: `https://www.reddit.com/submit?${redditParams.toString()}`,
  };
}

export async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fallback below
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(textArea);
  return copied;
}

export function canUseNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export async function shareUrl(input: {
  url: string;
  title: string;
  text?: string;
}): Promise<"shared" | "copied" | "failed"> {
  if (canUseNativeShare()) {
    try {
      await navigator.share({
        url: input.url,
        title: input.title,
        text: input.text,
      });
      return "shared";
    } catch {
      // fallback to copy link
    }
  }

  const copied = await copyTextToClipboard(input.url);
  return copied ? "copied" : "failed";
}
