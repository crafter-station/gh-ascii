import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Without this file the [user] route answers /robots.txt with "Invalid GitHub
// username" (400), so crawlers got no directives at all. Static metadata
// routes take precedence over the dynamic segment.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      // AI search crawlers read their own user-agents rather than the
      // wildcard, so allowing them is a decision, not a default.
      {
        userAgent: [
          "OAI-SearchBot",
          "ChatGPT-User",
          "PerplexityBot",
          "ClaudeBot",
          "Claude-SearchBot",
          "Google-Extended",
          "GoogleOther",
        ],
        allow: "/",
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
