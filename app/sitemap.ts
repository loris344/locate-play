import type { MetadataRoute } from "next";
import { getPublishedEntries } from "@/lib/seo-pages";

export const dynamic = "force-static";

const DOMAIN = "https://geogushing.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${DOMAIN}/`, priority: 1.0 },
    { url: `${DOMAIN}/play/`, priority: 0.9 },
    { url: `${DOMAIN}/leaderboard/`, priority: 0.5 },
  ];

  const seoRoutes: MetadataRoute.Sitemap = getPublishedEntries()
    .filter(({ page }) => !page.noindexBeforePublication)
    .map(({ page }) => ({
      url: page.canonical,
      lastModified: page.plannedPublishDate ?? undefined,
      priority: page.priority === "P1" ? 0.8 : page.priority === "P2" ? 0.7 : 0.6,
    }));

  return [...staticRoutes, ...seoRoutes];
}
