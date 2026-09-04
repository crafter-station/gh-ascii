import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// One entry on purpose: /[user] returns an SVG, not an indexable page, and
// generating a URL per handle would be thin doorway content.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
