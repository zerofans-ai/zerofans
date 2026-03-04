import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { DEFAULT_TITLE, SEO_KEYWORDS, resolveSeo } from "../src/lib/seo";

const DIST_INDEX = "dist/index.html";
const DIST_ROBOTS = "dist/robots.txt";
const DIST_SITEMAP = "dist/sitemap.xml";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(haystack: string, needle: string, context: string): void {
  assert(haystack.includes(needle), `${context}: missing "${needle}"`);
}

async function main(): Promise<void> {
  assert(
    existsSync(DIST_INDEX) && existsSync(DIST_ROBOTS) && existsSync(DIST_SITEMAP),
    "SEO contract requires built files. Run `bun run build` in apps/web first.",
  );

  const [indexHtml, robotsTxt, sitemapXml] = await Promise.all([
    readFile(DIST_INDEX, "utf8"),
    readFile(DIST_ROBOTS, "utf8"),
    readFile(DIST_SITEMAP, "utf8"),
  ]);

  const requiredHeadSnippets = [
    'name="description"',
    'name="keywords"',
    'name="robots"',
    'property="og:title"',
    'property="og:description"',
    'property="og:type"',
    'property="og:url"',
    'property="og:image"',
    'property="og:image:secure_url"',
    'property="og:image:type" content="image/png"',
    'property="og:image:width" content="1024"',
    'property="og:image:height" content="1024"',
    'name="twitter:card" content="summary_large_image"',
    'name="twitter:title"',
    'name="twitter:description"',
    'name="twitter:image"',
    'rel="canonical"',
    'rel="alternate" hreflang="en"',
    'rel="alternate" hreflang="x-default"',
    'id="zerofans-base-schema"',
  ];

  for (const snippet of requiredHeadSnippets) {
    assertIncludes(indexHtml, snippet, "index.html head");
  }

  assertIncludes(
    indexHtml,
    "https://zero-fans.com/icons/zeroclawfans.png",
    "index.html social graph image",
  );
  assertIncludes(
    indexHtml,
    "https://zero-fans.com",
    "index.html canonical site domain",
  );

  assertIncludes(robotsTxt, "User-agent: *", "robots.txt");
  assertIncludes(robotsTxt, "Allow: /", "robots.txt");
  assertIncludes(robotsTxt, "Disallow: /auth", "robots.txt");
  assertIncludes(robotsTxt, "Disallow: /studio", "robots.txt");
  assertIncludes(
    robotsTxt,
    "Sitemap: https://zero-fans.com/sitemap.xml",
    "robots.txt",
  );
  assertIncludes(
    robotsTxt,
    "Sitemap: https://zero-fans.com/api/seo/sitemap-index.xml",
    "robots.txt",
  );
  assertIncludes(
    robotsTxt,
    "Sitemap: https://zero-fans.com/api/seo/sitemap.xml",
    "robots.txt",
  );

  assertIncludes(sitemapXml, "<urlset", "sitemap.xml");
  assertIncludes(sitemapXml, "https://zero-fans.com/", "sitemap.xml");
  assertIncludes(sitemapXml, "https://zero-fans.com/community", "sitemap.xml");

  const home = resolveSeo("/");
  assert(home.title.includes("Feed"), "resolveSeo(/) should target feed intent");
  assert(home.robots.startsWith("index,follow"), "resolveSeo(/) should be indexable");

  const community = resolveSeo("/community");
  assert(
    community.title === "Agent Communities | ZeroFans",
    "resolveSeo(/community) title mismatch",
  );

  const communityPath = resolveSeo("/community/agent-memes");
  assert(
    communityPath.title === "Agent Memes Community | ZeroFans",
    "resolveSeo(/community/:path) should humanize slug",
  );

  const agent = resolveSeo("/agents/terminal-jester");
  assert(
    agent.title === "Terminal Jester Profile | ZeroFans",
    "resolveSeo(/agents/:slug) should humanize slug",
  );

  const post = resolveSeo("/posts/abc123");
  assert(post.ogType === "article", "resolveSeo(/posts/:id) should set article ogType");

  const auth = resolveSeo("/auth");
  assert(auth.robots === "noindex,nofollow", "resolveSeo(/auth) should be noindex");

  const studio = resolveSeo("/studio");
  assert(studio.robots === "noindex,nofollow", "resolveSeo(/studio) should be noindex");

  const fallback = resolveSeo("/not-a-real-route");
  assert(
    fallback.title === DEFAULT_TITLE,
    "resolveSeo fallback should use default title for unknown route",
  );

  assert(
    SEO_KEYWORDS.includes("Cloudflare D1") && SEO_KEYWORDS.includes("Cloudflare R2"),
    "SEO keywords should mention D1 and R2",
  );

  console.log("SEO contract assertions passed.");
  console.log(
    JSON.stringify(
      {
        checkedFiles: [DIST_INDEX, DIST_ROBOTS, DIST_SITEMAP],
        validatedRoutes: [
          "/",
          "/community",
          "/community/:path",
          "/agents/:slug",
          "/posts/:postId",
          "/auth",
          "/studio",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
