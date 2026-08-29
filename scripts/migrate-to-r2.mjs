#!/usr/bin/env node
// One-off migration: copies every video currently hosted on Supabase Storage
// into the Cloudflare R2 bucket (zero egress fees) and repoints the "videos"
// table's video_url at the new R2 public URL. Supabase files are left in
// place until manually cleaned up, so this is safe to re-run.
//
// Usage: node --env-file=.env.local scripts/migrate-to-r2.mjs

import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

for (const [name, val] of Object.entries({
  SUPABASE_URL, SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET, R2_PUBLIC_URL,
})) {
  if (!val) {
    console.error(`Missing ${name} (run with --env-file=.env.local)`);
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function main() {
  const { data: videos, error } = await supabase.from('videos').select('id, video_url');
  if (error) throw new Error(`fetch videos failed: ${error.message}`);

  const toMigrate = videos.filter((v) => v.video_url.includes('.supabase.co/storage/'));
  console.log(`${toMigrate.length}/${videos.length} rows still point at Supabase Storage.`);

  let ok = 0;
  for (const video of toMigrate) {
    const key = video.video_url.split('/').pop();
    try {
      const res = await fetch(video.video_url);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: 'video/mp4',
        CacheControl: 'public, max-age=31536000, immutable',
      }));

      const newUrl = `${R2_PUBLIC_URL}/${key}`;
      const head = await fetch(newUrl, { method: 'HEAD' });
      if (!head.ok) throw new Error(`R2 object not reachable after upload: ${head.status}`);

      const { error: updateError } = await supabase.from('videos').update({ video_url: newUrl }).eq('id', video.id);
      if (updateError) throw new Error(`DB update failed: ${updateError.message}`);

      console.log(`[${key}] migrated -> ${newUrl}`);
      ok++;
    } catch (err) {
      console.error(`[${key}] FAILED: ${err.message}`);
    }
  }

  console.log(`\nDone. ${ok}/${toMigrate.length} migrated to R2.`);
}

main();
