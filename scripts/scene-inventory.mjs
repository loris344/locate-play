#!/usr/bin/env node
// Queries the live Supabase "videos" table and writes a city/country round
// count snapshot used to enforce the workbook's "≥3 verified rounds" gate
// for entity (city/country) SEO pages. Re-run whenever new videos are added.
//
// Usage: node --env-file=.env.local scripts/scene-inventory.mjs

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUT_PATH = path.resolve("src/data/scene-inventory.json");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run with --env-file=.env.local)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  const { data, error } = await supabase.from("videos").select("city, country");
  if (error) throw new Error(`fetch videos failed: ${error.message}`);

  const byCity = {};
  const byCountry = {};
  for (const v of data) {
    if (v.city) byCity[v.city] = (byCity[v.city] || 0) + 1;
    if (v.country) byCountry[v.country] = (byCountry[v.country] || 0) + 1;
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), byCity, byCountry }, null, 2)
  );

  console.log(`Wrote ${path.relative(process.cwd(), OUT_PATH)}: ${Object.keys(byCity).length} cities, ${Object.keys(byCountry).length} countries.`);
}

main();
