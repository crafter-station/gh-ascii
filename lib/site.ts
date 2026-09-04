/**
 * Canonical origin for metadata, robots and the sitemap. Everything that emits
 * an absolute URL reads it from here so a preview deployment never advertises
 * itself as the canonical host.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const SITE_NAME = "gh-ascii";

export const SITE_DESCRIPTION =
  "Turn any GitHub handle into a neofetch-style ASCII profile card (SVG) for your profile README. The avatar becomes ASCII art and the stats come live from the GitHub API — no hosting, no API key.";
