#!/usr/bin/env node
// Downloads a trimmed section of a video, compresses it to a small mp4,
// uploads it to the Cloudflare R2 bucket (zero egress fees), and inserts a
// row into the Supabase "videos" table pointing at the R2 public URL.
//
// Usage: node --env-file=.env.local scripts/add-video.mjs entries.json
// entries.json: [{ url, start, end, latitude, longitude, city?, country?, filename?, actor_name?, actor_photo_url?, source_url?, clues? }]
// city/country are reverse-geocoded from latitude/longitude when omitted.
// skip (optional): [[a, b], ...] seconds relative to `start` to drop at encode time (promo cards inside the footage).
// actor_photo (optional): LOCAL path of a portrait, uploaded to R2 as <filename>-actor.jpg -> actor_photo_url.
// clues (optional, produced by pipeline/): [{ text, t?, crop, frame?, box? }] where crop/frame are LOCAL image
// paths; they are uploaded to R2 next to the clip and stored in videos.clues as { text, t, crop_url, frame_url, box }.

import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const AUDIO_KBPS = 64;
const TARGET_SIZE_MB = 8;
const MAX_VIDEO_KBPS = 1400;
const MIN_VIDEO_KBPS = 150;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

for (const [name, val] of Object.entries({
  SUPABASE_URL, SERVICE_ROLE_KEY, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET, R2_PUBLIC_URL,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSeconds(t) {
  if (typeof t === 'number') return t;
  const parts = String(t).split(':').map(Number);
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

function slugify(name) {
  const slug = String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || crypto.randomUUID();
}

let lastGeocodeCall = 0;
async function nominatimReverse(lat, lng, zoom) {
  const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeCall));
  if (wait > 0) await sleep(wait);
  lastGeocodeCall = Date.now();

  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=${zoom}&addressdetails=1&accept-language=en`;
  const res = await fetch(url, { headers: { 'User-Agent': 'GeogushingVideoIngest/1.0' } });
  if (!res.ok) throw new Error(`reverse geocode failed: ${res.status}`);
  const data = await res.json();
  return data.address || {};
}

async function reverseGeocode(lat, lng) {
  let addr = await nominatimReverse(lat, lng, 10);
  let city = addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state;
  if (!city) {
    // Nothing at city-level zoom (e.g. offshore/rural coordinates) - retry closer in.
    addr = await nominatimReverse(lat, lng, 14);
    city = addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state || 'Unknown';
  }
  const country = addr.country || 'Unknown';
  return { city, country };
}

async function extractDirectMp4(pageUrl) {
  const res = await fetch(pageUrl, { headers: { 'User-Agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`page fetch failed: ${res.status}`);
  const html = await res.text();
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('no JSON-LD block found on page');
  const data = JSON.parse(match[1]);
  if (!data.contentUrl) throw new Error('no contentUrl in JSON-LD');
  return data.contentUrl;
}

async function downloadClip(url, startS, endS, rawPath) {
  const host = new URL(url).hostname.replace(/^www\.|^fr\.|^[a-z]{2}\./, '');

  if (host === 'xnxx.com' || host === 'xvideos.com') {
    const directUrl = await extractDirectMp4(url);
    await execFileAsync('ffmpeg', [
      '-y',
      '-user_agent', BROWSER_UA,
      '-ss', String(startS),
      '-to', String(endS),
      '-i', directUrl,
      '-c', 'copy',
      rawPath,
    ]);
    return;
  }

  try {
    await execFileAsync(
      'yt-dlp',
      [
        '--no-playlist',
        '--download-sections', `*${startS}-${endS}`,
        '-f', 'bv*[height<=720]+ba/b[height<=720]/best',
        '--merge-output-format', 'mp4',
        '--force-keyframes-at-cuts',
        '-o', rawPath,
        url,
      ],
      { maxBuffer: 1024 * 1024 * 100 }
    );
    await fs.access(rawPath);
    return;
  } catch {
    // Fall through to generic ffmpeg trim (progressive/direct file URLs).
  }

  await execFileAsync('ffmpeg', [
    '-y',
    '-ss', String(startS),
    '-to', String(endS),
    '-i', url,
    '-c', 'copy',
    rawPath,
  ]);
}

// skip = [[a, b], ...] seconds relative to the clip start: promo/logo cards inserted in the footage
// (detected by the pipeline) are dropped at encode time so the player never sees them.
function skipFilters(skip) {
  const ranges = (skip ?? []).filter((r) => Array.isArray(r) && r.length === 2 && r[1] > r[0]);
  if (!ranges.length) return null;
  const expr = ranges.map(([a, b]) => `between(t,${a},${b})`).join('+');
  return {
    video: `select='not(${expr})',setpts=N/FRAME_RATE/TB`,
    audio: `aselect='not(${expr})',asetpts=N/SR/TB`,
    removed: ranges.reduce((s, [a, b]) => s + (b - a), 0),
  };
}

function planCompression(durationS) {
  const targetTotalKbps = (TARGET_SIZE_MB * 8192 * 0.92) / durationS;
  const videoKbps = Math.round(Math.min(MAX_VIDEO_KBPS, Math.max(MIN_VIDEO_KBPS, targetTotalKbps - AUDIO_KBPS)));
  const maxHeight = videoKbps >= 900 ? 720 : videoKbps >= 400 ? 480 : 360;
  return { videoKbps, maxHeight };
}

async function compress(rawPath, outPath, durationS, skip) {
  const cut = skipFilters(skip);
  const { videoKbps, maxHeight } = planCompression(durationS - (cut?.removed ?? 0));
  // The raw download starts at the keyframe before the requested start: trim that lead so the
  // skip ranges (relative to the requested start) line up.
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', rawPath]);
  const lead = Math.max(0, parseFloat(stdout) - durationS);
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss', lead.toFixed(3),
    '-i', rawPath,
    '-t', durationS.toFixed(3),
    '-vf', `${cut ? cut.video + ',' : ''}scale=-2:'min(ih,${maxHeight})'`,
    ...(cut ? ['-af', cut.audio] : []),
    '-c:v', 'libx264',
    '-profile:v', 'main',
    '-preset', 'veryfast',
    '-b:v', `${videoKbps}k`,
    '-maxrate', `${Math.round(videoKbps * 1.3)}k`,
    '-bufsize', `${Math.round(videoKbps * 2)}k`,
    '-c:a', 'aac',
    '-b:a', `${AUDIO_KBPS}k`,
    '-ac', '2',
    '-movflags', '+faststart',
    outPath,
  ]);
}

async function processEntry(entry) {
  const { url, start, end } = entry;
  const startS = toSeconds(start);
  const endS = toSeconds(end);
  if (endS <= startS) throw new Error(`invalid range: end (${end}) <= start (${start})`);

  const { data: existing } = await supabase.from('videos').select('id').eq('source_url', url).maybeSingle();
  if (existing) {
    console.log(`[${url}] already ingested, skipping`);
    return;
  }

  let city = entry.city;
  let country = entry.country;
  if (!city || !country) {
    const geo = await reverseGeocode(entry.latitude, entry.longitude);
    city = city || geo.city;
    country = country || geo.country;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clip-'));
  const rawPath = path.join(tmpDir, 'raw.mp4');
  const outPath = path.join(tmpDir, 'out.mp4');

  try {
    console.log(`[${url}] downloading ${start} -> ${end}...`);
    await downloadClip(url, startS, endS, rawPath);

    console.log(`[${url}] compressing (target ~${TARGET_SIZE_MB}MB)...`);
    await compress(rawPath, outPath, endS - startS, entry.skip);

    const fileBuffer = await fs.readFile(outPath);
    const sizeMB = (fileBuffer.byteLength / 1024 / 1024).toFixed(2);
    console.log(`[${url}] final size: ${sizeMB} MB`);

    const storageName = entry.filename ? slugify(entry.filename) : crypto.randomUUID();
    const storagePath = `${storageName}.mp4`;

    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: storagePath,
      Body: fileBuffer,
      ContentType: 'video/mp4',
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    const publicUrl = `${R2_PUBLIC_URL}/${storagePath}`;

    const clues = [];
    for (const [i, clue] of (entry.clues ?? []).entries()) {
      if (!clue?.text) continue;
      if (!clue.crop) {
        clues.push({ text: clue.text, t: clue.t ?? null, crop_url: null, frame_url: null, box: null });
        continue;
      }
      const uploadImage = async (localPath, key) => {
        await s3.send(new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: await fs.readFile(localPath),
          ContentType: 'image/jpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        }));
        return `${R2_PUBLIC_URL}/${key}`;
      };
      // The game zooms into the whole frame itself (CSS), so only the frame is uploaded; the pre-cropped
      // zoom is kept as a fallback only when there is no frame.
      const frame_url = clue.frame ? await uploadImage(clue.frame, `${storageName}-clue-${i + 1}-frame.jpg`) : null;
      const crop_url = frame_url ? null : await uploadImage(clue.crop, `${storageName}-clue-${i + 1}.jpg`);
      clues.push({ text: clue.text, t: clue.t ?? null, crop_url, frame_url, box: clue.box ?? null });
    }
    if (clues.length) console.log(`[${url}] ${clues.length} clue image(s) uploaded`);

    let actorPhotoUrl = entry.actor_photo_url ?? null;
    if (!actorPhotoUrl && entry.actor_photo) {
      const key = `${storageName}-actor.jpg`;
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: await fs.readFile(entry.actor_photo),
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      actorPhotoUrl = `${R2_PUBLIC_URL}/${key}`;
    }

    const { error: insertError } = await supabase.from('videos').insert({
      video_url: publicUrl,
      latitude: entry.latitude,
      longitude: entry.longitude,
      city,
      country,
      actor_name: entry.actor_name ?? null,
      actor_photo_url: actorPhotoUrl,
      source_url: entry.source_url ?? url,
      clues: clues.length ? clues : null,
    });
    if (insertError) throw new Error(`insert failed: ${insertError.message}`);

    console.log(`[${url}] done -> ${publicUrl} (${city}, ${country})`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node --env-file=.env.local scripts/add-video.mjs entries.json');
    process.exit(1);
  }

  const entries = JSON.parse(await fs.readFile(inputPath, 'utf-8'));
  const failures = [];

  for (const entry of entries) {
    try {
      await processEntry(entry);
    } catch (err) {
      console.error(`[${entry.url}] FAILED: ${err.message}`);
      failures.push({ url: entry.url, error: err.message });
    }
  }

  console.log(`\nDone. ${entries.length - failures.length}/${entries.length} succeeded.`);
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log(`  ${f.url}: ${f.error}`);
  }
}

main();
