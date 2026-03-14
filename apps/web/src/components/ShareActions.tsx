import { useMemo } from "react";
import {
  buildPlatformShareUrls,
  buildEmbedCode,
  copyTextToClipboard,
  shareUrl,
  toAbsoluteShareUrl,
} from "../lib/share";
import { useToast } from "./ToastProvider";

interface ShareActionsProps {
  url: string;
  title: string;
  text?: string;
  includeEmbed?: boolean;
  includePlatformIntents?: boolean;
  compact?: boolean;
  className?: string;
}

function XIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M18.25 3h-3.02l-3 4.41L9.02 3H4.75l5.03 7.24L4.5 21h3.02l3.14-4.62L14.98 21h4.27l-5.36-7.78L18.25 3Zm-3.42 14.02-1.9-2.76-3.04-4.41 1.91-2.79 1.9 2.79 3.03 4.41-1.9 2.76Z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M4.98 3.5C4.98 4.6 4.1 5.5 3 5.5S1 4.6 1 3.5 1.9 1.5 3 1.5s1.98.9 1.98 2Zm.02 3.75H1V22h4V7.25Zm5.5 0H7.5V22h4v-7.5c0-1.98 1.02-3 2.63-3 1.58 0 2.37 1.08 2.37 3.06V22h4v-8.48C20.5 9.01 18.56 7 15.78 7c-1.9 0-3.3.84-4.28 2.22V7.25Z" />
    </svg>
  );
}

function RedditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M22 11.5c0-1.38-1.12-2.5-2.5-2.5-.8 0-1.5.38-1.96.97-1.14-.72-2.66-1.18-4.34-1.24L14.1 4.5l2.1.44a1.5 1.5 0 1 0 .17-1l-2.82-.6a.75.75 0 0 0-.87.56l-1 4.16c-1.76.04-3.36.5-4.56 1.25A2.5 2.5 0 0 0 4.5 9C3.12 9 2 10.12 2 11.5c0 .94.52 1.75 1.28 2.17-.05.22-.08.45-.08.68 0 2.8 3.02 5.08 6.98 5.08s6.98-2.28 6.98-5.08c0-.2-.02-.4-.06-.6A2.5 2.5 0 0 0 22 11.5Zm-14 1.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm7.73 3.18C14.7 17.8 13.45 18.3 12 18.3s-2.7-.5-3.73-1.37a.5.5 0 1 1 .66-.76c.78.68 1.83 1.04 3.07 1.04s2.29-.36 3.07-1.04a.5.5 0 0 1 .66.76Zm-.23-1.93a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M20.32 4.37A18.3 18.3 0 0 0 15.86 3l-.23.43a16.65 16.65 0 0 1 3.06 1.02c-1.34-.63-2.82-1.06-4.38-1.3a15.9 15.9 0 0 0-3.26 0 16.35 16.35 0 0 0-4.41 1.3c.99-.47 1.98-.8 3.06-1.02L9.47 3a18.3 18.3 0 0 0-4.46 1.37C2.7 8.03 2 11.6 2.27 15.13c1.67 1.24 3.51 2 5.44 2.44l.43-.98c-.75-.25-1.46-.58-2.13-.98l.53-.33c3.99 1.87 8.32 1.87 12.28 0l.53.33c-.67.4-1.38.73-2.13.98l.43.98a13.7 13.7 0 0 0 5.44-2.44c.24-3.2-.37-6.73-1.77-10.76ZM9.1 14.3c-.86 0-1.57-.8-1.57-1.78 0-.98.7-1.78 1.57-1.78.88 0 1.58.8 1.57 1.78 0 .97-.7 1.78-1.57 1.78Zm5.8 0c-.86 0-1.57-.8-1.57-1.78s.7-1.78 1.57-1.78c.87 0 1.57.8 1.57 1.78s-.7 1.78-1.57 1.78Z" />
    </svg>
  );
}

export function ShareActions({
  url,
  title,
  text,
  includeEmbed = true,
  includePlatformIntents = true,
  compact = false,
  className,
}: ShareActionsProps) {
  const { showToast } = useToast();

  const absoluteUrl = useMemo(() => toAbsoluteShareUrl(url), [url]);
  const embedCode = useMemo(() => buildEmbedCode(absoluteUrl, title), [absoluteUrl, title]);
  const platformUrls = useMemo(
    () =>
      buildPlatformShareUrls({
        url: absoluteUrl,
        title,
        text,
      }),
    [absoluteUrl, text, title],
  );

  const handleShare = async () => {
    const result = await shareUrl({
      url: absoluteUrl,
      title,
      text,
    });
    if (result === "shared") {
      showToast("Shared successfully", "success");
      return;
    }
    if (result === "copied") {
      showToast("Link copied to clipboard", "success");
      return;
    }
    showToast("Share failed", "error");
  };

  const handleCopyLink = async () => {
    const copied = await copyTextToClipboard(absoluteUrl);
    showToast(copied ? "Link copied to clipboard" : "Copy failed", copied ? "success" : "error");
  };

  const handleCopyEmbed = async () => {
    const copied = await copyTextToClipboard(embedCode);
    showToast(copied ? "Embed code copied" : "Copy failed", copied ? "success" : "error");
  };

  const buttonClassName = compact
    ? "rounded-full border border-tide/30 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-ember hover:text-ember"
    : "rounded-full border border-tide/30 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-ember hover:text-ember";
  const platformButtonClassName =
    "inline-flex items-center gap-1 rounded-full border border-tide/30 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 transition hover:border-ember hover:text-ember";

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={handleShare} className={buttonClassName}>
          Share
        </button>
        <button type="button" onClick={handleCopyLink} className={buttonClassName}>
          Copy link
        </button>
        {includeEmbed ? (
          <button type="button" onClick={handleCopyEmbed} className={buttonClassName}>
            Copy embed
          </button>
        ) : null}
      </div>
      {includePlatformIntents ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          <span className="hidden sm:inline">Post to</span>
          <a
            href={platformUrls.x}
            target="_blank"
            rel="noreferrer"
            className={platformButtonClassName}
            aria-label="Share on X"
            title="Share on X"
          >
            <XIcon />
            <span className="hidden sm:inline">X</span>
          </a>
          <a
            href={platformUrls.linkedIn}
            target="_blank"
            rel="noreferrer"
            className={platformButtonClassName}
            aria-label="Share on LinkedIn"
            title="Share on LinkedIn"
          >
            <LinkedInIcon />
            <span className="hidden sm:inline">LinkedIn</span>
          </a>
          <a
            href={platformUrls.reddit}
            target="_blank"
            rel="noreferrer"
            className={platformButtonClassName}
            aria-label="Share on Reddit"
            title="Share on Reddit"
          >
            <RedditIcon />
            <span className="hidden sm:inline">Reddit</span>
          </a>
          <a
            href="https://discord.com/invite/wDshRVqRjx"
            target="_blank"
            rel="noreferrer"
            className={platformButtonClassName}
            aria-label="Open ZeroClaw Labs Discord"
            title="Open ZeroClaw Labs Discord"
          >
            <DiscordIcon />
            <span className="hidden sm:inline">Discord</span>
          </a>
        </div>
      ) : null}
    </div>
  );
}
