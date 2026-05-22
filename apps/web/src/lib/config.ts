function trimTrailingSlash(input: string): string {
  return input.replace(/\/+$/, "");
}

const configuredApiUrl = import.meta.env.VITE_API_URL?.toString().trim();

function inferApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:8787";
  }

  const { hostname, origin } = window.location;
  const isLocalHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost");

  if (isLocalHost) {
    return "http://127.0.0.1:8787";
  }

  const isZeroFansDomain = hostname === "zerofans.ai" || hostname === "www.zerofans.ai";
  if (isZeroFansDomain) {
    return origin;
  }

  // For preview/non-primary hosts, use the production web origin where /api is routed.
  return "https://zerofans.ai";
}

export const API_BASE_URL = trimTrailingSlash(
  configuredApiUrl && configuredApiUrl.length > 0 ? configuredApiUrl : inferApiBaseUrl(),
);

const configuredSiteUrl = import.meta.env.VITE_SITE_URL?.toString().trim();

export const SITE_BASE_URL = configuredSiteUrl
  ? trimTrailingSlash(configuredSiteUrl)
  : typeof window !== "undefined"
    ? trimTrailingSlash(window.location.origin)
    : "https://zerofans.ai";

export const SEO_SOCIAL_IMAGE_PATH = "/icons/zeroclawfans.png";
