#!/usr/bin/env node
// Imports 1-500seo.xlsx ("SEO Pages" + "Internal Links" sheets) into
// src/data/seo-pages.json + src/data/internal-links.json.
// Re-run only when the workbook changes.
//
// Usage: node --env-file=.env.local scripts/import-seo.mjs

import xlsx from "xlsx";
import fs from "node:fs";
import path from "node:path";

const PRODUCTION_DOMAIN = "https://geogushing.com";
const WORKBOOK_PATH = path.resolve("1-500seo.xlsx");
const OUT_PAGES = path.resolve("src/data/seo-pages.json");
const OUT_LINKS = path.resolve("src/data/internal-links.json");

function pipeList(value) {
  if (!value || typeof value !== "string" || value.trim().toLowerCase() === "none") return [];
  return value.split("|").map((s) => s.trim()).filter(Boolean);
}

function yesNo(value) {
  return String(value ?? "").trim().toLowerCase() === "yes";
}

function toIsoDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function rewriteCanonical(url) {
  if (!url) return url;
  return url.replace(/^https?:\/\/example\.com/i, PRODUCTION_DOMAIN);
}

const wb = xlsx.readFile(WORKBOOK_PATH, { cellDates: true });

const pagesSheet = xlsx.utils.sheet_to_json(wb.Sheets["SEO Pages"], { defval: null });
const pages = pagesSheet.map((row) => ({
  sequence: row["Production Sequence"],
  id: row["ID"],
  url: row["Final URL"],
  slug: row["Slug"],
  pageTitle: row["Page Title"],
  pageType: row["Page Type"],
  template: row["Template"],
  semanticCluster: row["Semantic Cluster"],
  clusterKey: row["Cluster Key"],
  siloLevel: row["Silo Level"],
  primaryKeyword: row["Primary Keyword"],
  secondaryKeywords: pipeList(row["Secondary Keywords"]),
  searchIntent: row["Search Intent"],
  adultIntent: row["Adult Intent"],
  funnelRole: row["Funnel Role"],
  trafficPotential: row["Traffic Potential (Heuristic)"],
  priority: row["Priority"],
  plannedPublishDate: toIsoDate(row["Planned Publish Date"]),
  parentUrl: row["Parent URL"],
  childUrls: pipeList(row["Child URLs"]),
  requiredInternalLinks: pipeList(row["Required Internal Links"]),
  suggestedInternalLinks: pipeList(row["Suggested Internal Links"]),
  ctaTarget: row["CTA Target"],
  sceneInventoryRequirement: row["Scene Inventory Requirement"],
  publishGate: row["Publish Gate"],
  contentAngle: row["Content Angle"],
  metaTitle: row["Meta Title"],
  metaDescription: row["Meta Description"],
  h1: row["H1"],
  proposedH2s: pipeList(row["Proposed H2s"]),
  plannedFaq: pipeList(row["Planned FAQ"]),
  schemaType: row["Schema Type"],
  canonical: rewriteCanonical(row["Canonical"]),
  noindexBeforePublication: yesNo(row["Noindex Before Publication"]),
  needsImage: yesNo(row["Needs Image"]),
  imageRequired: yesNo(row["Image Required"]),
  expectedImageType: row["Expected Image Type"],
  suggestedImageAlt: row["Suggested Image Alt"],
  author: row["Author"],
  reviewer: row["Reviewer"],
  cannibalizationRisk: row["Cannibalization Risk"],
  productionStatus: row["Production Status"],
  researchRequirement: row["Research Requirement"],
  notes: row["Notes"],
  country: row["Country"] || null,
  cityDestination: row["City / Destination"] || null,
  region: row["Region"] || null,
}));

pages.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

const linksSheet = xlsx.utils.sheet_to_json(wb.Sheets["Internal Links"], { defval: null });
const linksByPage = {};
for (const row of linksSheet) {
  const source = row["Source Page"];
  if (!source) continue;
  (linksByPage[source] ||= []).push({
    target: row["Target Page"],
    anchor: row["Suggested Anchor"],
    type: row["Link Type"],
    priority: row["Priority"],
    placement: row["Placement"],
    reason: row["Reason"],
  });
}

fs.mkdirSync(path.dirname(OUT_PAGES), { recursive: true });
fs.writeFileSync(
  OUT_PAGES,
  JSON.stringify(
    {
      meta: {
        generatedFrom: "1-500seo.xlsx",
        generatedAt: new Date().toISOString(),
        productionDomain: PRODUCTION_DOMAIN,
        counts: { total: pages.length },
      },
      pages,
    },
    null,
    2
  )
);
fs.writeFileSync(OUT_LINKS, JSON.stringify(linksByPage, null, 2));

console.log(`Imported ${pages.length} pages -> ${path.relative(process.cwd(), OUT_PAGES)}`);
console.log(`Imported ${linksSheet.length} internal links (${Object.keys(linksByPage).length} source pages) -> ${path.relative(process.cwd(), OUT_LINKS)}`);
