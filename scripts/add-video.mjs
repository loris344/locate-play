#!/usr/bin/env node
// Downloads a trimmed section of a video, compresses it to a small mp4,
// uploads it to the Supabase "videos" storage bucket, and inserts a row
// into the "videos" table.
//
// Usage: node --env-file=.env.local scripts/add-video.mjs entries.json
// entries.json: [{ url, start, end, latitude, longitude, city, country, actor_name?, actor_photo_url?, source_url? }]

import { createClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'videos';
const MAX_HEIGHT = 720;
const CRF = 30;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run with --env-file=.env.local)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function toSeconds(t) {
  if (typeof t === 'number') return t;
  const parts = String(t).split(':').map(Number);
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

async function downloadClip(url, startS, endS, rawPath) {
  try {
    await execFileAsync(
      'yt-dlp',
      [
        '--no-playlist',
        '--download-sections', `*${startS}-${endS}`,
        '-f', `bv*[height<=${MAX_HEIGHT}]+ba/b[height<=${MAX_HEIGHT}]/best`,
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

async function compress(rawPath, outPath) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', rawPath,
    '-vf', `scale='min(${MAX_HEIGHT},iw)':-2:flags=lanczos`,
    '-c:v', 'libx264',
    '-profile:v', 'main',
    '-preset', 'veryfast',
    '-crf', String(CRF),
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ac', '2',
    '-movflags', '+faststart',
    outPath,
  ]);
}

async function processEntry(entry) {
  const { url, start, end } = entry;
  const startS = toSeconds(start);
  const endS = toSeconds(end);
  const id = crypto.randomUUID();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clip-'));
  const rawPath = path.join(tmpDir, 'raw.mp4');
  const outPath = path.join(tmpDir, 'out.mp4');

  try {
    console.log(`[${url}] downloading ${start} -> ${end}...`);
    await downloadClip(url, startS, endS, rawPath);

    console.log(`[${url}] compressing...`);
    await compress(rawPath, outPath);

    const fileBuffer = await fs.readFile(outPath);
    const sizeMB = (fileBuffer.byteLength / 1024 / 1024).toFixed(2);
    console.log(`[${url}] final size: ${sizeMB} MB`);

    const storagePath = `${id}.mp4`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, fileBuffer, {
      contentType: 'video/mp4',
      cacheControl: '31536000',
      upsert: false,
    });
    if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    const { error: insertError } = await supabase.from('videos').insert({
      video_url: pub.publicUrl,
      latitude: entry.latitude,
      longitude: entry.longitude,
      city: entry.city,
      country: entry.country,
      actor_name: entry.actor_name ?? null,
      actor_photo_url: entry.actor_photo_url ?? null,
      source_url: entry.source_url ?? url,
    });
    if (insertError) throw new Error(`insert failed: ${insertError.message}`);

    console.log(`[${url}] done -> ${pub.publicUrl}`);
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

  for (const entry of entries) {
    try {
      await processEntry(entry);
    } catch (err) {
      console.error(`[${entry.url}] FAILED: ${err.message}`);
    }
  }
}

main();
