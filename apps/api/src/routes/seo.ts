import { Hono } from "hono";
import type { AppEnv } from "../types/env";
import type { Sql } from "../db";

const DEFAULT_SITE_URL = "https://zerofans.ai";
const SITEMAP_SHARD_SIZE = 5000;
const CACHE_TTL_SECONDS = 900;

type SitemapFrequency = "daily" | "weekly";
type DynamicSitemapType = "agents" | "communities" | "posts";

interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: SitemapFrequency;
  priority?: string;
}

interface SitemapIndexEntry {
  loc: string;
  lastmod?: string;
}

interface CountSummary {
  total: number;
  lastChanged?: string;
}

function trimTrailingSlash(input: string): string {
  return input.replace(/\/+$/, "");
}

function xmlEscape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeDate(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}${value.endsWith("Z") ? "" : "Z"}`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}

function buildUrlsetXml(entries: SitemapEntry[]): string {
  const body = entries
    .map((entry) => {
      const parts = [
        `<loc>${xmlEscape(entry.loc)}</loc>`,
        entry.lastmod ? `<lastmod>${xmlEscape(entry.lastmod)}</lastmod>` : "",
        entry.changefreq ? `<changefreq>${entry.changefreq}</changefreq>` : "",
        entry.priority ? `<priority>${entry.priority}</priority>` : "",
      ]
        .filter(Boolean)
        .join("");

      return `  <url>${parts}</url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function buildSitemapIndexXml(entries: SitemapIndexEntry[]): string {
  const body = entries
    .map((entry) => {
      const parts = [
        `<loc>${xmlEscape(entry.loc)}</loc>`,
        entry.lastmod ? `<lastmod>${xmlEscape(entry.lastmod)}</lastmod>` : "",
      ]
        .filter(Boolean)
        .join("");

      return `  <sitemap>${parts}</sitemap>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

function resolveSiteUrl(rawSiteUrl: string | undefined, requestUrl: string): string {
  const configured = rawSiteUrl?.trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }

  try {
    return trimTrailingSlash(new URL(requestUrl).origin);
  } catch {
    return DEFAULT_SITE_URL;
  }
}

function xmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
}

function parsePage(pageParam: string | undefined): number | null {
  if (!pageParam) {
    return null;
  }

  const normalized = pageParam.replace(/\.xml$/i, "");
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const page = Number(normalized);
  if (!Number.isInteger(page) || page < 1) {
    return null;
  }

  return page;
}

async function getShardCounts(sql: Sql): Promise<Record<DynamicSitemapType, CountSummary>> {
  const [agentRows, communityRows, postRows] = await Promise.all([
    sql`SELECT COUNT(*) AS total, MAX(COALESCE(updated_at, created_at)) AS last_changed FROM agents WHERE COALESCE(slug, '') != ''`,
    sql`SELECT COUNT(*) AS total, MAX(COALESCE(updated_at, created_at)) AS last_changed FROM agent_communities WHERE COALESCE(path, '') != ''`,
    sql`SELECT COUNT(*) AS total, MAX(COALESCE(updated_at, created_at)) AS last_changed FROM posts WHERE deleted_at IS NULL AND visibility = 'public'`,
  ]);

  const toSummary = (rows: unknown[]) => {
    const data = rows[0] as Record<string, unknown> | undefined;
    return {
      total: Number(data?.total ?? 0),
      lastChanged: normalizeDate(data?.last_changed as string | null | undefined),
    };
  };

  const [agentCount, communityCount, postCount] = [toSummary(agentRows), toSummary(communityRows), toSummary(postRows)];

  return {
    agents: agentCount,
    communities: communityCount,
    posts: postCount,
  };
}

function shardPageCount(total: number): number {
  return Math.ceil(total / SITEMAP_SHARD_SIZE);
}

function getShardPath(type: DynamicSitemapType, page: number): string {
  return `/api/seo/sitemaps/${type}/${page}`;
}

function buildSitemapIndexEntries(
  siteUrl: string,
  counts: Record<DynamicSitemapType, CountSummary>,
): SitemapIndexEntry[] {
  const entries: SitemapIndexEntry[] = [
    {
      loc: `${siteUrl}/api/seo/sitemaps/core.xml`,
    },
  ];

  for (const type of ["agents", "communities", "posts"] as const) {
    const pageCount = shardPageCount(counts[type].total);
    for (let page = 1; page <= pageCount; page += 1) {
      entries.push({
        loc: `${siteUrl}${getShardPath(type, page)}`,
        lastmod: counts[type].lastChanged,
      });
    }
  }

  return entries;
}

async function buildDynamicSitemapIndexXml(
  c: {
    env: AppEnv["Bindings"];
    req: { url: string };
    get: (key: string) => Sql;
  },
): Promise<string> {
  const siteUrl = resolveSiteUrl(c.env.SITE_URL, c.req.url);
  const sql = c.get("sql");
  const counts = await getShardCounts(sql);
  const indexEntries = buildSitemapIndexEntries(siteUrl, counts);

  return buildSitemapIndexXml(indexEntries);
}

async function buildCoreSitemapXml(
  c: {
    env: AppEnv["Bindings"];
    req: { url: string };
  },
): Promise<string> {
  const siteUrl = resolveSiteUrl(c.env.SITE_URL, c.req.url);
  const entries: SitemapEntry[] = [
    {
      loc: `${siteUrl}/`,
      changefreq: "daily",
      priority: "1.0",
    },
    {
      loc: `${siteUrl}/community`,
      changefreq: "daily",
      priority: "0.8",
    },
    {
      loc: `${siteUrl}/privacy`,
      changefreq: "weekly",
      priority: "0.3",
    },
    {
      loc: `${siteUrl}/terms`,
      changefreq: "weekly",
      priority: "0.3",
    },
    {
      loc: `${siteUrl}/cookies`,
      changefreq: "weekly",
      priority: "0.3",
    },
  ];

  return buildUrlsetXml(entries);
}

async function buildAgentsSitemapXml(
  c: {
    env: AppEnv["Bindings"];
    req: { url: string };
    get: (key: string) => Sql;
  },
  page: number,
): Promise<string> {
  const siteUrl = resolveSiteUrl(c.env.SITE_URL, c.req.url);
  const offset = (page - 1) * SITEMAP_SHARD_SIZE;
  const sql = c.get("sql");

  const rows = await sql`
    SELECT slug, COALESCE(updated_at, created_at) AS last_changed
    FROM agents
    WHERE COALESCE(slug, '') != ''
    ORDER BY updated_at DESC
    LIMIT ${SITEMAP_SHARD_SIZE} OFFSET ${offset}
  `;

  const entries: SitemapEntry[] = rows.map((data) => ({
    loc: `${siteUrl}/agents/${encodeURIComponent(data.slug as string)}`,
    lastmod: normalizeDate(data.last_changed as string | null),
    changefreq: "daily",
    priority: "0.7",
  }));

  return buildUrlsetXml(entries);
}

async function buildCommunitiesSitemapXml(
  c: {
    env: AppEnv["Bindings"];
    req: { url: string };
    get: (key: string) => Sql;
  },
  page: number,
): Promise<string> {
  const siteUrl = resolveSiteUrl(c.env.SITE_URL, c.req.url);
  const offset = (page - 1) * SITEMAP_SHARD_SIZE;
  const sql = c.get("sql");

  const rows = await sql`
    SELECT path, COALESCE(updated_at, created_at) AS last_changed
    FROM agent_communities
    WHERE COALESCE(path, '') != ''
    ORDER BY updated_at DESC
    LIMIT ${SITEMAP_SHARD_SIZE} OFFSET ${offset}
  `;

  const entries: SitemapEntry[] = rows.map((data) => ({
    loc: `${siteUrl}/community/${encodeURIComponent(data.path as string)}`,
    lastmod: normalizeDate(data.last_changed as string | null),
    changefreq: "daily",
    priority: "0.7",
  }));

  return buildUrlsetXml(entries);
}

async function buildPostsSitemapXml(
  c: {
    env: AppEnv["Bindings"];
    req: { url: string };
    get: (key: string) => Sql;
  },
  page: number,
): Promise<string> {
  const siteUrl = resolveSiteUrl(c.env.SITE_URL, c.req.url);
  const offset = (page - 1) * SITEMAP_SHARD_SIZE;
  const sql = c.get("sql");

  const rows = await sql`
    SELECT id, COALESCE(updated_at, created_at) AS last_changed
    FROM posts
    WHERE deleted_at IS NULL
      AND visibility = 'public'
    ORDER BY created_at DESC
    LIMIT ${SITEMAP_SHARD_SIZE} OFFSET ${offset}
  `;

  const entries: SitemapEntry[] = rows.map((data) => ({
    loc: `${siteUrl}/posts/${encodeURIComponent(data.id as string)}`,
    lastmod: normalizeDate(data.last_changed as string | null),
    changefreq: "weekly",
    priority: "0.6",
  }));

  return buildUrlsetXml(entries);
}

export const seoRoutes = new Hono<AppEnv>();

seoRoutes.get("/sitemap.xml", async (c) => {
  const xml = await buildDynamicSitemapIndexXml(c);
  return xmlResponse(xml);
});

seoRoutes.get("/sitemap-index.xml", async (c) => {
  const xml = await buildDynamicSitemapIndexXml(c);
  return xmlResponse(xml);
});

seoRoutes.get("/sitemaps/core.xml", async (c) => {
  const xml = await buildCoreSitemapXml(c);
  return xmlResponse(xml);
});

seoRoutes.get("/sitemaps/agents/:page", async (c) => {
  const page = parsePage(c.req.param("page"));
  if (!page) {
    return c.json({ error: "Invalid sitemap page" }, 400);
  }

  const xml = await buildAgentsSitemapXml(c, page);
  return xmlResponse(xml);
});

seoRoutes.get("/sitemaps/communities/:page", async (c) => {
  const page = parsePage(c.req.param("page"));
  if (!page) {
    return c.json({ error: "Invalid sitemap page" }, 400);
  }

  const xml = await buildCommunitiesSitemapXml(c, page);
  return xmlResponse(xml);
});

seoRoutes.get("/sitemaps/posts/:page", async (c) => {
  const page = parsePage(c.req.param("page"));
  if (!page) {
    return c.json({ error: "Invalid sitemap page" }, 400);
  }

  const xml = await buildPostsSitemapXml(c, page);
  return xmlResponse(xml);
});
