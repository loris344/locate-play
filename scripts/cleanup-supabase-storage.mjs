#!/usr/bin/env node
// One-off cleanup: deletes every object left in the Supabase Storage "videos"
// bucket now that all rows in the "videos" table point at R2 instead.
// Safe to run: it refuses to delete anything still referenced by a video_url
// or actor_photo_url pointing at supabase.co/storage.
//
// Usage: node --env-file=.env.local scripts/cleanup-supabase-storage.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'videos';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run with --env-file=.env.local)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function listAll(prefix = '') {
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list failed at "${prefix}": ${error.message}`);
  let paths = [];
  for (const item of data) {
    const full = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      paths = paths.concat(await listAll(full));
    } else {
      paths.push(full);
    }
  }
  return paths;
}

async function main() {
  const { data: videos, error: vErr } = await supabase.from('videos').select('video_url, actor_photo_url');
  if (vErr) throw new Error(`videos select failed: ${vErr.message}`);

  const stillReferenced = videos.some(
    (v) => v.video_url?.includes('supabase.co/storage') || v.actor_photo_url?.includes('supabase.co/storage')
  );
  if (stillReferenced) {
    console.error('ABORT: at least one row still references a supabase.co/storage URL. Not deleting anything.');
    process.exit(1);
  }

  const paths = await listAll();
  console.log(`Found ${paths.length} objects in bucket "${BUCKET}".`);
  if (paths.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  let deleted = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { data, error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) {
      console.error(`Batch ${i / 100 + 1} FAILED: ${error.message}`);
      continue;
    }
    deleted += data.length;
    console.log(`Deleted batch ${i / 100 + 1}: ${data.length} objects`);
  }

  console.log(`\nDone. ${deleted}/${paths.length} objects deleted from "${BUCKET}".`);

  const remaining = await listAll();
  console.log(`Remaining objects in bucket: ${remaining.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
