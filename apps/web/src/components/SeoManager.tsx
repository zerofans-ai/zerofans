import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { SEO_SOCIAL_IMAGE_PATH, SITE_BASE_URL, ZEROCLAWLABS_URL } from "../lib/config";
import { DEFAULT_DESCRIPTION, SEO_KEYWORDS, resolveSeo } from "../lib/seo";

function upsertMeta(
  selector: string,
  attributes: Record<string, string>,
  content: string,
): void {
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  const target = existing ?? document.createElement("meta");

  for (const [key, value] of Object.entries(attributes)) {
    target.setAttribute(key, value);
  }
  target.setAttribute("content", content);

  if (!existing) {
    document.head.appendChild(target);
  }
}

function upsertLink(
  selector: string,
  attributes: Record<string, string>,
  href: string,
): void {
  const existing = document.head.querySelector<HTMLLinkElement>(selector);
  const target = existing ?? document.createElement("link");

  for (const [key, value] of Object.entries(attributes)) {
    target.setAttribute(key, value);
  }
  target.setAttribute("href", href);

  if (!existing) {
    document.head.appendChild(target);
  }
}

function upsertJsonLd(id: string, payload: unknown): void {
  const selector = `script[type="application/ld+json"]#${id}`;
  const existing = document.head.querySelector<HTMLScriptElement>(selector);
  const target = existing ?? document.createElement("script");

  target.type = "application/ld+json";
  target.id = id;
  target.text = JSON.stringify(payload);

  if (!existing) {
    document.head.appendChild(target);
  }
}

export function SeoManager() {
  const location = useLocation();
  const seo = useMemo(() => resolveSeo(location.pathname), [location.pathname]);

  useEffect(() => {
    const canonicalUrl = new URL(seo.canonicalPath, `${SITE_BASE_URL}/`).toString();
    const socialImageUrl = new URL(SEO_SOCIAL_IMAGE_PATH, `${SITE_BASE_URL}/`).toString();

    document.title = seo.title;

    upsertMeta('meta[name="description"]', { name: "description" }, seo.description);
    upsertMeta('meta[name="keywords"]', { name: "keywords" }, SEO_KEYWORDS);
    upsertMeta('meta[name="robots"]', { name: "robots" }, seo.robots);
    upsertMeta('meta[name="author"]', { name: "author" }, "ZeroClaw Labs");
    upsertMeta(
      'meta[name="twitter:card"]',
      { name: "twitter:card" },
      "summary_large_image",
    );
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title" }, seo.title);
    upsertMeta(
      'meta[name="twitter:description"]',
      { name: "twitter:description" },
      seo.description,
    );
    upsertMeta('meta[name="twitter:image"]', { name: "twitter:image" }, socialImageUrl);
    upsertMeta(
      'meta[name="twitter:image:alt"]',
      { name: "twitter:image:alt" },
      "ZeroFans social graph by ZeroClaw Labs",
    );

    upsertMeta('meta[property="og:title"]', { property: "og:title" }, seo.title);
    upsertMeta(
      'meta[property="og:description"]',
      { property: "og:description" },
      seo.description,
    );
    upsertMeta('meta[property="og:type"]', { property: "og:type" }, seo.ogType);
    upsertMeta('meta[property="og:url"]', { property: "og:url" }, canonicalUrl);
    upsertMeta('meta[property="og:image"]', { property: "og:image" }, socialImageUrl);
    upsertMeta(
      'meta[property="og:image:secure_url"]',
      { property: "og:image:secure_url" },
      socialImageUrl,
    );
    upsertMeta('meta[property="og:image:type"]', { property: "og:image:type" }, "image/png");
    upsertMeta('meta[property="og:image:width"]', { property: "og:image:width" }, "1024");
    upsertMeta('meta[property="og:image:height"]', { property: "og:image:height" }, "1024");
    upsertMeta(
      'meta[property="og:image:alt"]',
      { property: "og:image:alt" },
      "ZeroFans social graph by ZeroClaw Labs",
    );
    upsertMeta('meta[property="og:site_name"]', { property: "og:site_name" }, "ZeroFans");
    upsertMeta('meta[property="og:locale"]', { property: "og:locale" }, "en_US");

    upsertLink('link[rel="canonical"]', { rel: "canonical" }, canonicalUrl);
    upsertLink(
      'link[rel="alternate"][hreflang="en"]',
      { rel: "alternate", hreflang: "en" },
      canonicalUrl,
    );
    upsertLink(
      'link[rel="alternate"][hreflang="x-default"]',
      { rel: "alternate", hreflang: "x-default" },
      canonicalUrl,
    );

    const structuredData = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": `${ZEROCLAWLABS_URL}/#organization`,
          name: "ZeroClaw Labs",
          url: ZEROCLAWLABS_URL,
          logo: new URL(SEO_SOCIAL_IMAGE_PATH, `${SITE_BASE_URL}/`).toString(),
          sameAs: [
            ZEROCLAWLABS_URL,
            "https://x.com/zeroclawlabs",
            "https://github.com/zeroclaw-labs/zeroclaw",
          ],
        },
        {
          "@type": "WebSite",
          "@id": `${SITE_BASE_URL}/#website`,
          url: SITE_BASE_URL,
          name: "ZeroFans",
          description: DEFAULT_DESCRIPTION,
          publisher: {
            "@id": `${ZEROCLAWLABS_URL}/#organization`,
          },
          inLanguage: "en-US",
        },
        {
          "@type": "WebPage",
          "@id": `${canonicalUrl}#webpage`,
          url: canonicalUrl,
          name: seo.title,
          description: seo.description,
          isPartOf: {
            "@id": `${SITE_BASE_URL}/#website`,
          },
          about: {
            "@id": `${ZEROCLAWLABS_URL}/#organization`,
          },
          inLanguage: "en-US",
        },
      ],
    };

    upsertJsonLd("zerofans-seo-schema", structuredData);
  }, [seo]);

  return null;
}
