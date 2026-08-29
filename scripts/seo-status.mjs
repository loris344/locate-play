#!/usr/bin/env node
// Production dashboard: next eligible page to write, blocked-by-gate list,
// and overall progress. Read-only, no side effects.
//
// Usage: node scripts/seo-status.mjs

import fs from "node:fs";
import path from "node:path";

const CONTENT_DIR = path.resolve("content/seo");
const seoPages = JSON.parse(fs.readFileSync(path.resolve("src/data/seo-pages.json"), "utf-8")).pages;
const sceneInventory = JSON.parse(fs.readFileSync(path.resolve("src/data/scene-inventory.json"), "utf-8"));
const SCENE_GATE_MIN = 3;

const written = new Set(
  fs.existsSync(CONTENT_DIR) ? fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".mdx")).map((f) => f.replace(/\.mdx$/, "")) : []
);

function gateSatisfied(page) {
  if (page.cityDestination) return (sceneInventory.byCity[page.cityDestination] ?? 0) >= SCENE_GATE_MIN;
  if (page.country) return (sceneInventory.byCountry[page.country] ?? 0) >= SCENE_GATE_MIN;
  return true;
}

const total = seoPages.length;
const writtenCount = seoPages.filter((p) => written.has(p.slug)).length;
const blocked = seoPages.filter((p) => !written.has(p.slug) && !gateSatisfied(p));
const eligible = seoPages.filter((p) => !written.has(p.slug) && gateSatisfied(p)).sort((a, b) => a.sequence - b.sequence);

console.log(`Progress: ${writtenCount}/${total} pages written.`);
console.log(`Blocked by scene-inventory gate: ${blocked.length}`);
console.log(`Eligible and waiting: ${eligible.length}`);

if (eligible.length > 0) {
  const next = eligible[0];
  console.log(`\nNext eligible (Production Sequence ${next.sequence}): ${next.id} - ${next.url}`);
  console.log(`  Template: ${next.template} | Priority: ${next.priority}`);
  console.log(`  Primary keyword: ${next.primaryKeyword}`);
}

if (process.argv.includes("--blocked")) {
  console.log("\nBlocked entities (need >=3 verified rounds):");
  const entities = new Map();
  for (const p of blocked) {
    const key = p.cityDestination ? `city:${p.cityDestination}` : `country:${p.country}`;
    if (!entities.has(key)) entities.set(key, 0);
    entities.set(key, entities.get(key) + 1);
  }
  const closestFirst = [...entities.entries()].sort((a, b) => {
    const countA = a[0].startsWith("city:") ? sceneInventory.byCity[a[0].slice(5)] ?? 0 : sceneInventory.byCountry[a[0].slice(8)] ?? 0;
    const countB = b[0].startsWith("city:") ? sceneInventory.byCity[b[0].slice(5)] ?? 0 : sceneInventory.byCountry[b[0].slice(8)] ?? 0;
    return countB - countA;
  });
  for (const [key, pageCount] of closestFirst) {
    const [type, name] = key.split(":");
    const have = type === "city" ? sceneInventory.byCity[name] ?? 0 : sceneInventory.byCountry[name] ?? 0;
    console.log(`  ${name} (${type}): ${have}/${SCENE_GATE_MIN} rounds - blocks ${pageCount} page(s)`);
  }
}
