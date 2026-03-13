import { useEffect } from "react";
import { SITE_BASE_URL } from "../lib/config";

interface DynamicSeoOptions {
  title?: string;
  description?: string;
  ogImage?: string;
  ogImageAlt?: string;
  ogType?: "website" | "article" | "profile";
  keywords?: string;
}

function upsertMeta(selector: string, attributes: Record<string, string>, content: string): void {
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  const target = existing ?? document.createElement("meta");
  for (const [key, value] of Object.entries(attributes)) {
    target.setAttribute(key, value);
  }
  target.setAttribute("content", content);
  if (!existing) document.head.appendChild(target);
}

export function useDynamicSeo(options: DynamicSeoOptions | null): void {
  useEffect(() => {
    if (!options) return;

    if (options.title) {
      document.title = options.title;
      upsertMeta('meta[property="og:title"]', { property: "og:title" }, options.title);
      upsertMeta('meta[name="twitter:title"]', { name: "twitter:title" }, options.title);
    }

    if (options.description) {
      upsertMeta('meta[name="description"]', { name: "description" }, options.description);
      upsertMeta('meta[property="og:description"]', { property: "og:description" }, options.description);
      upsertMeta('meta[name="twitter:description"]', { name: "twitter:description" }, options.description);
    }

    if (options.ogImage) {
      const imageUrl = options.ogImage.startsWith("http")
        ? options.ogImage
        : new URL(options.ogImage, `${SITE_BASE_URL}/`).toString();
      upsertMeta('meta[property="og:image"]', { property: "og:image" }, imageUrl);
      upsertMeta('meta[property="og:image:secure_url"]', { property: "og:image:secure_url" }, imageUrl);
      upsertMeta('meta[name="twitter:image"]', { name: "twitter:image" }, imageUrl);
    }

    if (options.ogImageAlt) {
      upsertMeta('meta[property="og:image:alt"]', { property: "og:image:alt" }, options.ogImageAlt);
      upsertMeta('meta[name="twitter:image:alt"]', { name: "twitter:image:alt" }, options.ogImageAlt);
    }

    if (options.ogType) {
      upsertMeta('meta[property="og:type"]', { property: "og:type" }, options.ogType);
    }

    if (options.keywords) {
      const existing = document.head.querySelector<HTMLMetaElement>('meta[name="keywords"]');
      const base = existing?.content ?? "";
      const combined = options.keywords + (base ? `, ${base}` : "");
      upsertMeta('meta[name="keywords"]', { name: "keywords" }, combined);
    }
  }, [options?.title, options?.description, options?.ogImage, options?.ogImageAlt, options?.ogType, options?.keywords]);
}
