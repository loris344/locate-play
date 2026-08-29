import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import seoPagesData from "@/data/seo-pages.json";
import sceneInventoryData from "@/data/scene-inventory.json";
import internalLinksData from "@/data/internal-links.json";

const SCENE_GATE_MIN = 3;
const CONTENT_DIR = path.resolve(process.cwd(), "content/seo");

export interface SeoPage {
  sequence: number;
  id: string;
  url: string;
  slug: string;
  pageTitle: string;
  pageType: string;
  template: string;
  semanticCluster: string;
  clusterKey: string;
  siloLevel: number;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: string;
  adultIntent: string;
  funnelRole: string;
  trafficPotential: number;
  priority: string;
  plannedPublishDate: string | null;
  parentUrl: string | null;
  childUrls: string[];
  requiredInternalLinks: string[];
  suggestedInternalLinks: string[];
  ctaTarget: string;
  sceneInventoryRequirement: string;
  publishGate: string;
  contentAngle: string;
  metaTitle: string;
  metaDescription: string;
  h1: string;
  proposedH2s: string[];
  plannedFaq: string[];
  schemaType: string;
  canonical: string;
  noindexBeforePublication: boolean;
  needsImage: boolean;
  imageRequired: boolean;
  expectedImageType: string;
  suggestedImageAlt: string;
  author: string;
  reviewer: string;
  cannibalizationRisk: string;
  productionStatus: string;
  researchRequirement: string;
  notes: string;
  country: string | null;
  cityDestination: string | null;
  region: string | null;
}

export interface SeoContent {
  slug: string;
  draft: boolean;
  metaTitle?: string;
  metaDescription?: string;
  h1?: string;
  noImage?: boolean;
  minWords?: number;
  sources?: string[];
  faq?: { q: string; a: string }[];
  gameEmbed?: { mode: "city" | "country" | "random"; filter?: string };
  body: string;
}

export const allPages: SeoPage[] = seoPagesData.pages as SeoPage[];
export const sceneInventory = sceneInventoryData as {
  byCity: Record<string, number>;
  byCountry: Record<string, number>;
};

/** URL path segments -> the "--"-joined content filename key (matches the workbook's own Slug column). */
export function slugFromSegments(segments: string[]): string {
  return segments.join("--");
}

export function urlToPage(): Map<string, SeoPage> {
  const map = new Map<string, SeoPage>();
  for (const page of allPages) map.set(page.url, page);
  return map;
}

/**
 * A city/country page is only eligible once the live game has at least
 * SCENE_GATE_MIN verified rounds for that entity - anti-doorway-page policy
 * from the workbook's "Claude Workflow" sheet. Pages with no city/country
 * requirement always pass.
 */
export function gateSatisfied(page: SeoPage): boolean {
  if (page.cityDestination) {
    return (sceneInventory.byCity[page.cityDestination] ?? 0) >= SCENE_GATE_MIN;
  }
  if (page.country) {
    return (sceneInventory.byCountry[page.country] ?? 0) >= SCENE_GATE_MIN;
  }
  return true;
}

export function getContent(slug: string): SeoContent | null {
  const filePath = path.join(CONTENT_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  return {
    slug,
    draft: data.draft === true,
    metaTitle: data.metaTitle,
    metaDescription: data.metaDescription,
    h1: data.h1,
    noImage: data.noImage === true,
    minWords: data.minWords,
    sources: data.sources ?? [],
    faq: data.faq ?? [],
    gameEmbed: data.gameEmbed,
    body: content.trim(),
  };
}

/**
 * A page goes live as soon as it's authored (content exists, not draft) and
 * passes the scene-inventory gate. `plannedPublishDate` is scheduling
 * guidance surfaced in `seo-status.mjs`, not a hard runtime gate - the real
 * pacing mechanism is the one-page-at-a-time, research-first workflow
 * itself, which already throttles output far below any calendar cap.
 */
export function isPublished(page: SeoPage, content: SeoContent | null): boolean {
  if (!content || content.draft) return false;
  return gateSatisfied(page);
}

export interface PublishedEntry {
  page: SeoPage;
  content: SeoContent;
}

export function getPublishedEntries(): PublishedEntry[] {
  const entries: PublishedEntry[] = [];
  for (const page of allPages) {
    const content = getContent(page.slug);
    if (isPublished(page, content)) entries.push({ page, content: content! });
  }
  return entries;
}

export function buildBreadcrumb(page: SeoPage): { label: string; href: string }[] {
  const byUrl = urlToPage();
  const published = new Set(getPublishedEntries().map((e) => e.page.url));
  const trail: { label: string; href: string }[] = [{ label: "Home", href: "/" }];
  const chain: SeoPage[] = [];
  let current: SeoPage | undefined = page;
  const seen = new Set<string>();
  while (current?.parentUrl && current.parentUrl !== "/" && !seen.has(current.parentUrl)) {
    seen.add(current.parentUrl);
    const parent = byUrl.get(current.parentUrl);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  for (const p of chain) {
    if (published.has(p.url)) trail.push({ label: p.h1 || p.pageTitle, href: p.url });
  }
  trail.push({ label: page.h1 || page.pageTitle, href: page.url });
  return trail;
}

export interface InternalLink {
  target: string;
  anchor: string;
  type: string;
  priority: string;
  placement: string;
  reason: string;
}

const internalLinks = internalLinksData as Record<string, InternalLink[]>;

/** Set of URLs that are (or already were) published as of this build - used
 * to decide whether an internal link renders as a real <a> or as plain text
 * ("dormant" link). It self-heals on the next daily rebuild once the target
 * page goes live. */
export function getPublishedUrlSet(): Set<string> {
  const EXISTING_PUBLIC = new Set(["/", "/play/", "/auth/", "/leaderboard/", "/subscription/"]);
  for (const { page } of getPublishedEntries()) EXISTING_PUBLIC.add(page.url);
  return EXISTING_PUBLIC;
}

export function getInternalLinksForPage(url: string): InternalLink[] {
  return internalLinks[url] ?? [];
}
