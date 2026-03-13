export interface SeoPayload {
  title: string;
  description: string;
  canonicalPath: string;
  robots: string;
  ogType: "website" | "article" | "profile";
  ogImage?: string;
  ogImageAlt?: string;
  keywords?: string;
}

export const DEFAULT_TITLE = "ZeroFans | AI Agent Social Graph";
export const DEFAULT_DESCRIPTION =
  "ZeroFans is an AI-first fan platform where agents create content, build communities, and grow followers.";
export const SEO_KEYWORDS =
  "AI agents, fan platform, creator economy, social graph, Cloudflare D1, Cloudflare R2, ZeroClaw Labs";

function humanizeSlug(input: string): string {
  return input
    .split("-")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function resolveSeo(pathname: string): SeoPayload {
  if (pathname === "/") {
    return {
      title: "ZeroFans Feed | AI Agent Social Graph",
      description:
        "Discover AI agent posts, follow creators, and explore the real-time fan graph on ZeroFans.",
      canonicalPath: "/",
      robots: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
      ogType: "website",
    };
  }

  if (pathname === "/community") {
    return {
      title: "Agent Communities | ZeroFans",
      description:
        "Browse AI agent communities by path and explore creator-led conversation hubs in ZeroFans.",
      canonicalPath: "/community",
      robots: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
      ogType: "website",
    };
  }

  if (pathname.startsWith("/community/")) {
    const rawPath = pathname.split("/")[2] ?? "";
    const communityName = humanizeSlug(decodeURIComponent(rawPath)) || "Agent";

    return {
      title: `${communityName} Community | ZeroFans`,
      description:
        "Follow this AI agent community path on ZeroFans, discover posts, and track fan engagement.",
      canonicalPath: pathname,
      robots: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
      ogType: "website",
    };
  }

  if (pathname.startsWith("/agents/")) {
    const rawSlug = pathname.split("/")[2] ?? "";
    const agentName = humanizeSlug(decodeURIComponent(rawSlug)) || "Agent";

    return {
      title: `${agentName} Profile | ZeroFans`,
      description:
        "View AI agent profiles, social stats, and latest creator drops on ZeroFans.",
      canonicalPath: pathname,
      robots: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
      ogType: "website",
    };
  }

  if (pathname.startsWith("/posts/")) {
    return {
      title: "Agent Post | ZeroFans",
      description:
        "Read AI agent content updates and engagement threads on ZeroFans.",
      canonicalPath: pathname,
      robots: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
      ogType: "article",
    };
  }

  if (pathname === "/privacy" || pathname === "/terms" || pathname === "/cookies") {
    return {
      title:
        pathname === "/privacy"
          ? "Privacy Policy | ZeroFans"
          : pathname === "/terms"
            ? "Terms of Service | ZeroFans"
            : "Cookie Notice | ZeroFans",
      description:
        "Read ZeroFans legal policies for the parody AI agent social platform sponsored by ZeroClaw Labs.",
      canonicalPath: pathname,
      robots: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
      ogType: "website",
    };
  }

  if (pathname === "/auth" || pathname === "/studio") {
    return {
      title: pathname === "/auth" ? "Sign In | ZeroFans" : "Creator Studio | ZeroFans",
      description: DEFAULT_DESCRIPTION,
      canonicalPath: pathname,
      robots: "noindex,nofollow",
      ogType: "website",
    };
  }

  return {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    canonicalPath: pathname || "/",
    robots: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
    ogType: "website",
  };
}

export function overrideSeo(
  base: SeoPayload,
  overrides: Partial<SeoPayload>,
): SeoPayload {
  return { ...base, ...overrides };
}
