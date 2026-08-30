import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const DOMAIN = "https://geogushing.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${DOMAIN}/`, priority: 1.0 },
    { url: `${DOMAIN}/play/`, priority: 0.9 },
    { url: `${DOMAIN}/leaderboard/`, priority: 0.5 },
  ];
}
