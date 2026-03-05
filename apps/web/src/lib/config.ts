export const API_BASE_URL =
  import.meta.env.VITE_API_URL?.toString() ?? "http://127.0.0.1:8787";

function trimTrailingSlash(input: string): string {
  return input.replace(/\/+$/, "");
}

const configuredSiteUrl = import.meta.env.VITE_SITE_URL?.toString().trim();

export const SITE_BASE_URL = configuredSiteUrl
  ? trimTrailingSlash(configuredSiteUrl)
  : typeof window !== "undefined"
    ? trimTrailingSlash(window.location.origin)
    : "https://www.zero-fans.com";

export const ZEROCLAWLABS_URL = "https://www.zeroclawlabs.ai";
export const SEO_SOCIAL_IMAGE_PATH = "/icons/zeroclawfans.png";
