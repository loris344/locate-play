"""Repasse sur les vidéos DÉJÀ en ligne (table videos de Supabase, clips sur R2) : ajoute les indices en image
et le portrait de l'actrice, sans toucher au clip ni au lieu (certifié par Loris).

  python run.py backfill [--limit N] [--dry-run] [--force]
"""
from __future__ import annotations

import json
import logging
import subprocess
import time
from pathlib import Path

import requests

import config
import frames
import scrape

log = logging.getLogger("backfill")


def _sb_headers() -> dict:
    return {"apikey": config.SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json"}


def fetch_rows() -> list[dict]:
    r = requests.get(f"{config.SUPABASE_URL.rstrip('/')}/rest/v1/videos",
                     params={"select": "id,video_url,latitude,longitude,city,country,actor_name,actor_photo_url,source_url,clues",
                             "order": "created_at.asc", "limit": "10000"},
                     headers=_sb_headers(), timeout=60)
    r.raise_for_status()
    return r.json()


def _s3():
    import boto3
    return boto3.client("s3", region_name="auto", endpoint_url=config.R2_ENDPOINT,
                        aws_access_key_id=config.R2_ACCESS_KEY_ID, aws_secret_access_key=config.R2_SECRET_ACCESS_KEY)


def upload(s3, path: Path, key: str) -> str:
    s3.put_object(Bucket=config.R2_BUCKET, Key=key, Body=path.read_bytes(), ContentType="image/jpeg",
                  CacheControl="public, max-age=31536000, immutable")
    return f"{config.R2_PUBLIC_URL}/{key}"


def probe_duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def backfill(limit: int | None = None, dry_run: bool = False, force: bool = False) -> None:
    import gemini_analyze
    for name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET", "R2_PUBLIC_URL"):
        if not getattr(config, name):
            raise RuntimeError(f"{name} manquant dans pipeline/.env")
    rows = fetch_rows()
    todo = [r for r in rows if force or not r.get("clues") or not r.get("actor_photo_url")]
    log.info("%d vidéos en ligne, %d à compléter", len(rows), len(todo))
    if limit:
        todo = todo[:limit]
    work = config.DATA_DIR / "backfill"
    work.mkdir(parents=True, exist_ok=True)
    s3 = None if dry_run else _s3()
    done = 0
    for row in todo:
        vid = row["id"]
        d = work / vid
        marker = d / "done.json"
        if marker.exists() and not force:
            continue
        t0 = time.time()
        try:
            d.mkdir(parents=True, exist_ok=True)
            clip_path = d / "clip.mp4"
            if not clip_path.exists():
                with requests.get(row["video_url"], stream=True, timeout=120) as r:
                    r.raise_for_status()
                    with open(clip_path, "wb") as f:
                        for chunk in r.iter_content(1 << 20):
                            f.write(chunk)
            duration = probe_duration(clip_path)
            if duration < 5:
                raise RuntimeError("clip illisible")
            images, times, geometry = frames.make_locate_images(clip_path, d / "locate", 0.0, duration, offset=0.0, n=config.LOCATE_FRAMES)
            audio = frames.extract_audio(clip_path, 0.0, min(config.LOCATE_AUDIO_SECONDS, duration), d / "locate" / "audio.mp3") if config.LOCATE_AUDIO_SECONDS else None
            loc_path = d / "gemini_locate.json"
            if loc_path.exists() and not force:
                loc = json.loads(loc_path.read_text())
            else:
                loc = gemini_analyze.locate_known(images, times, audio, row)
                loc_path.write_text(json.dumps(loc, ensure_ascii=False, indent=2))
            clue_items = frames.crop_clues((loc.get("location") or {}).get("clues") or [], geometry, d / "clues")
            portrait = frames.crop_portrait(loc.get("woman"), geometry, d / "clues" / "actress.jpg")
            # nom de l'actrice si absent : page source (interprètes, tags), sinon Gemini texte
            actor_name = row.get("actor_name")
            if not actor_name and row.get("source_url"):
                try:
                    meta = scrape.fetch_video_page(row["source_url"])
                    meta["comments"] = scrape.fetch_comments(meta["site"], meta["numeric_id"])
                    actor_name = (gemini_analyze.actress(meta) or {}).get("name")
                except Exception as e:
                    log.warning("%s : nom de l'actrice introuvable (%s)", vid, e)
            key_base = row["video_url"].rsplit("/", 1)[-1].rsplit(".", 1)[0]
            clues_out = []
            for i, c in enumerate(clue_items, start=1):
                if c.get("crop"):
                    frame_url = None if dry_run else upload(s3, d / "clues" / c["frame"], f"{key_base}-clue-{i}-frame.jpg")
                    crop_url = None  # le jeu zoome lui-même dans l'image entière
                    clues_out.append({"text": c["text"], "t": c.get("t"), "crop_url": crop_url, "frame_url": frame_url, "box": c.get("box")})
                else:
                    clues_out.append({"text": c["text"], "t": None, "crop_url": None, "frame_url": None, "box": None})
            photo_url = row.get("actor_photo_url")
            if not photo_url and portrait:
                photo_url = None if dry_run else upload(s3, portrait, f"{key_base}-actor.jpg")
            update = {"clues": clues_out or None}
            if photo_url and not row.get("actor_photo_url"):
                update["actor_photo_url"] = photo_url
            if actor_name and not row.get("actor_name"):
                update["actor_name"] = actor_name
            if not dry_run:
                r = requests.patch(f"{config.SUPABASE_URL.rstrip('/')}/rest/v1/videos", params={"id": f"eq.{vid}"},
                                   headers={**_sb_headers(), "Prefer": "return=minimal"}, json=update, timeout=60)
                r.raise_for_status()
                marker.write_text(json.dumps({"update": update, "at": time.strftime("%Y-%m-%d %H:%M:%S")}, ensure_ascii=False))
            cost = gemini_analyze.cost_usd(loc.get("_meta")) or 0.0
            log.info("%s : %s, %s -> %d indices (%d en image), portrait %s, actrice %s, %.0f s, %.2f ¢%s", vid, row.get("city"), row.get("country"),
                     len(clues_out), sum(1 for c in clues_out if c["crop_url"] or dry_run and c["box"]), "oui" if portrait else "non",
                     actor_name or "?", time.time() - t0, cost * 100, " (simulation)" if dry_run else "")
            done += 1
            for p in list((d / "locate").glob("*")) + [clip_path]:
                if p.exists():
                    p.unlink()
        except Exception as e:
            log.exception("%s : erreur (%s)", vid, e)
    log.info("repasse terminée : %d vidéos complétées", done)
