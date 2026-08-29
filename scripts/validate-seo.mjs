#!/usr/bin/env node
// Blocking validator for authored SEO pages (content/seo/*.mdx). Wired as a
// prebuild step: any ERROR exits non-zero and stops the deploy.
//
// Usage: node scripts/validate-seo.mjs

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const CONTENT_DIR = path.resolve("content/seo");
const seoPages = JSON.parse(fs.readFileSync(path.resolve("src/data/seo-pages.json"), "utf-8")).pages;
const sceneInventory = JSON.parse(fs.readFileSync(path.resolve("src/data/scene-inventory.json"), "utf-8"));

const SCENE_GATE_MIN = 3;
const pageBySlug = new Map(seoPages.map((p) => [p.slug, p]));

function gateSatisfied(page) {
  if (page.cityDestination) return (sceneInventory.byCity[page.cityDestination] ?? 0) >= SCENE_GATE_MIN;
  if (page.country) return (sceneInventory.byCountry[page.country] ?? 0) >= SCENE_GATE_MIN;
  return true;
}

function shingles(text, n = 5) {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const set = new Set();
  for (let i = 0; i + n <= words.length; i++) set.add(words.slice(i, i + n).join(" "));
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const s of a) if (b.has(s)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

const errors = [];
const warnings = [];

if (!fs.existsSync(CONTENT_DIR)) {
  console.log("No content/seo directory yet - nothing to validate.");
  process.exit(0);
}

const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".mdx"));
const authored = [];

for (const file of files) {
  const slug = file.replace(/\.mdx$/, "");
  const page = pageBySlug.get(slug);
  const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8");
  const { data, content } = matter(raw);

  if (!page) {
    errors.push(`${file}: no matching entry in seo-pages.json (unknown slug "${slug}")`);
    continue;
  }
  if (data.draft === true) continue; // drafts are exempt from the full gate

  if (!gateSatisfied(page)) {
    errors.push(`${file}: scene-inventory gate not satisfied for ${page.cityDestination || page.country} (needs >=${SCENE_GATE_MIN} verified rounds) - must stay draft/noindex`);
    continue;
  }

  const title = data.metaTitle || page.metaTitle;
  const description = data.metaDescription || page.metaDescription;
  const h1 = data.h1 || page.h1;

  if (!title) errors.push(`${file}: missing meta title`);
  if (!description) errors.push(`${file}: missing meta description`);
  else if (description.length < 70 || description.length > 165) warnings.push(`${file}: meta description length ${description.length} (aim 120-160)`);
  if (!h1) errors.push(`${file}: missing H1`);
  if (!page.canonical || !page.canonical.startsWith("https://")) errors.push(`${file}: missing/invalid absolute canonical`);

  if (page.plannedFaq.length > 0 && (!data.faq || data.faq.length === 0)) {
    errors.push(`${file}: plan calls for FAQ but no faq[] written in frontmatter`);
  }

  if (page.imageRequired && data.noImage !== true) {
    warnings.push(`${file}: image required by plan but no image asset wired yet (set noImage:true if intentionally deferred)`);
  }

  if (page.template === "comparison-guide") {
    const hasDisclaimer = /independent|not affiliated|unaffiliated/i.test(content);
    if (!hasDisclaimer) errors.push(`${file}: comparison page missing GeoGuessr-independence disclaimer`);
  }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 150) warnings.push(`${file}: body is only ${wordCount} words - check it fully satisfies the page's intent`);

  const requiredTargets = new Set(page.requiredInternalLinks);
  const knownUrls = new Set(seoPages.map((p) => p.url));
  ["/", "/play/", "/auth/", "/leaderboard/", "/subscription/"].forEach((u) => knownUrls.add(u));
  for (const target of requiredTargets) {
    if (!knownUrls.has(target)) errors.push(`${file}: required internal link "${target}" is not a known route`);
  }

  authored.push({ file, slug, title, description, body: content, shingles: shingles(content) });
}

// Site-wide uniqueness
const titleSeen = new Map();
const descSeen = new Map();
for (const p of authored) {
  if (p.title) {
    if (titleSeen.has(p.title)) errors.push(`${p.file}: meta title duplicates ${titleSeen.get(p.title)}`);
    else titleSeen.set(p.title, p.file);
  }
  if (p.description) {
    if (descSeen.has(p.description)) errors.push(`${p.file}: meta description duplicates ${descSeen.get(p.description)}`);
    else descSeen.set(p.description, p.file);
  }
}

// Pairwise similarity
for (let i = 0; i < authored.length; i++) {
  for (let j = i + 1; j < authored.length; j++) {
    const sim = jaccard(authored[i].shingles, authored[j].shingles);
    if (sim >= 0.7) errors.push(`${authored[i].file} vs ${authored[j].file}: body similarity ${(sim * 100).toFixed(0)}% (>= 70% threshold)`);
  }
}

console.log(`Validated ${authored.length} authored page(s) (${files.length - authored.length} draft/skipped).`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}
if (errors.length) {
  console.log(`\n${errors.length} ERROR(s):`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log("\nAll checks passed.");
