#!/usr/bin/env python3
"""Orchestrateur du pipeline (voir README.md).

  python run.py discover            # cherche des vidéos "pick up" sur xvideos -> base locale (status new)
  python run.py add URL [URL...]    # ajoute des vidéos à la main
  python run.py process [--limit N] # télécharge, détecte le NSFW, coupe, envoie à Gemini, décide
  python run.py sheet               # réécrit l'onglet Google Sheet depuis la base locale
  python run.py export              # vidéos validées -> data/export/entries-*.json pour scripts/add-video.mjs
  python run.py auto                # discover + process + sheet (à mettre dans un cron)
  python run.py status              # compteurs par statut
"""
from __future__ import annotations

import argparse
import collections
import json
import logging
import re
import shutil
import sys
import threading
import time
import unicodedata
from pathlib import Path

import requests

import subprocess

import clip
import config
import db
import frames
import nsfw
import scrape

log = logging.getLogger("run")


# ------------------------------------------------------------------ utils --

def slugify(name: str | None) -> str:
    if not name:
        return "inconnue"
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]", "", s.lower())
    return s or "inconnue"


def make_filename(actress: str | None, lat: float, video_id: str) -> str:
    """'Carolina' + 47.49 -> 'carolina47' (convention des fichiers existants), unique dans la base."""
    base = f"{slugify(actress)}{int(abs(lat))}"
    candidate = base
    suffix = 2
    while db.filename_taken(candidate, except_id=video_id):
        candidate = f"{base}{suffix}"
        suffix += 1
    return candidate


def normalize_url(url: str) -> str:
    u = url.split("?")[0].split("#")[0].rstrip("/")
    return re.sub(r"^https?://(www\.|fr\.|[a-z]{2}\.)?", "", u).lower()


def work_dir(video_id: str) -> Path:
    d = config.VIDEOS_DIR / video_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def cleanup(video_id: str, keep_safe: bool = True) -> None:
    """Supprime ce qui ne sert plus : la source et les images 1/s toujours ; le clip d'aperçu, les planches
    et les images de travail si `keep_safe` est faux (vidéo rejetée ou exportée). La vignette et les indices restent."""
    d = config.VIDEOS_DIR / video_id
    if not d.exists():
        return
    for name in ("source.mp4", "source.part"):
        p = d / name
        if p.exists() and not config.KEEP_SOURCE:
            p.unlink()
    shutil.rmtree(d / "frames", ignore_errors=True)
    shutil.rmtree(d / "grids", ignore_errors=True)
    shutil.rmtree(d / "locate", ignore_errors=True)
    if not keep_safe:
        p = d / "safe.mp4"
        if p.exists():
            p.unlink()


# --------------------------------------------------------------- discover --

def sync_known(max_fetch: int = 200) -> tuple[set[str], set[str]]:
    """Liens déjà dans le jeu (Supabase) ou dans les autres onglets du Sheet -> numéros de vidéo (communs
    xvideos/xnxx) et hash CDN, résolus une fois par lien puis mis en cache."""
    import sheet
    urls: dict[str, str] = {}
    for u in already_in_supabase_urls():
        urls[u] = "supabase"
    for u in sheet.fetch_known_links():
        urls.setdefault(u, "sheet")
    fetched = 0
    for u, src in urls.items():
        if db.known_get(u) or fetched >= max_fetch:
            continue
        try:
            m = scrape.fetch_video_page(u)
            db.known_put(u, m["numeric_id"], m.get("cdn_hash"), src)
        except Exception as e:
            log.warning("lien connu illisible %s : %s", u[:60], e)
            db.known_put(u, None, None, src)
        fetched += 1
        time.sleep(1.0)
    if fetched:
        log.info("liens déjà importés résolus : %d nouveaux (total %d)", fetched, len(urls))
    return db.known_ids()


def already_in_supabase_urls() -> list[str]:
    if not (config.SUPABASE_URL and config.SUPABASE_SERVICE_ROLE_KEY):
        return []
    try:
        r = requests.get(
            f"{config.SUPABASE_URL.rstrip('/')}/rest/v1/videos",
            params={"select": "source_url", "limit": "10000"},
            headers={"apikey": config.SUPABASE_SERVICE_ROLE_KEY,
                     "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}"},
            timeout=30,
        )
        r.raise_for_status()
        return [row["source_url"] for row in r.json() if row.get("source_url")]
    except Exception as e:
        log.warning("Supabase injoignable (%s) : pas de dédoublonnage", e)
        return []


def cmd_discover(args) -> None:
    queries = args.query or config.SEARCH_QUERIES
    pages = args.pages or config.SEARCH_PAGES
    known_ids, _ = sync_known()
    known_urls = {normalize_url(u) for u in already_in_supabase_urls()}
    added = skipped_short = skipped_known = 0
    for query in queries:
        for page in range(pages):
            try:
                results = scrape.search(query, page)
            except Exception as e:
                log.error("recherche '%s' page %s : %s", query, page, e)
                continue
            log.info("'%s' page %s : %d résultats", query, page, len(results))
            added_here = 0
            for r in results:
                if added_here >= config.MAX_NEW_PER_QUERY:
                    break
                if r["duration"] is not None and r["duration"] < config.MIN_SOURCE_DURATION:
                    skipped_short += 1
                    continue
                if normalize_url(r["url"]) in known_urls or (r.get("data_id") and r["data_id"] in known_ids):
                    skipped_known += 1
                    continue
                vid = f"{scrape.site_key(r['url'])}{r['data_id']}" if r.get("data_id") else normalize_url(r["url"])
                if db.insert_if_new({
                    "id": vid, "url": r["url"], "site": scrape.site_root(r["url"]),
                    "title": r["title"], "duration": r["duration"], "uploader": r.get("uploader"),
                }):
                    added += 1
                    added_here += 1
            time.sleep(1.5)  # on reste poli avec le site
    log.info("découverte : %d nouvelles, %d trop courtes ignorées, %d déjà dans le jeu ou le Sheet", added, skipped_short, skipped_known)


def cmd_add(args) -> None:
    for url in args.url:
        try:
            meta = scrape.fetch_video_page(url)
        except Exception as e:
            log.error("%s : %s", url, e)
            continue
        ok = db.insert_if_new({k: meta[k] for k in ("id", "url", "site", "title", "description", "tags", "uploader", "duration", "thumbnail_url")})
        log.info("%s : %s", meta["id"], "ajoutée" if ok else "déjà connue")


# ---------------------------------------------------------------- process --

def _reject(video_id: str, reason: str, **extra) -> None:
    log.info("%s : rejet auto — %s", video_id, reason)
    extra.pop("reject_reason", None)
    db.update(video_id, status=config.STATUS_REJECTED_AUTO, reject_reason=reason, error=None, **extra)
    cleanup(video_id, keep_safe=True)


def _abs(text, offset: float):
    t = config.parse_ts(text)
    return None if t is None else t + offset


def decide_window(safe_start: float, safe_end: float, seg: dict, offset: float = 0.0, timeline: list | None = None,
                  step: float | None = None) -> dict:
    """Passe 1 -> début/fin du clip de jeu et bornes de la partie extérieure, ou `_reject`.

    Les timestamps de Gemini sont ceux imprimés sur les images (temps de la vidéo source, offset 0).
    Début = fin de l'intro studio / 1er segment extérieur ; fin = moment intime (spec), bornée par la
    fenêtre sûre nudenet et MAX_CLIP_SECONDS. Une image toutes les FRAME_STEP_SECONDS : on ajoute ce pas
    à la fin des segments (l'image suivante non extérieure n'est pas incluse).
    """
    intro_end = _abs(seg.get("intro_end"), offset) or safe_start
    intimate = _abs(seg.get("becomes_intimate_at"), offset)
    segments = []
    for s in seg.get("outdoor_segments") or []:
        a, b = _abs(s.get("start"), offset), _abs(s.get("end"), offset)
        if b is not None:
            b += step if step is not None else config.FRAME_STEP_SECONDS
        if a is not None and b is not None and b > a:
            segments.append((max(a, safe_start), min(b, safe_end)))
    segments = sorted(x for x in segments if x[1] > x[0])
    ads = []
    for s in seg.get("ad_segments") or []:
        a, b = _abs(s.get("start"), offset), _abs(s.get("end"), offset)
        if a is not None and b is not None and b > a:
            ads.append((a, b))
    ads.sort()
    fields = {"intro_end": intro_end, "intimate_at": intimate, "reject_reason": None, "skip_json": "[]"}
    if not seg.get("is_street_pickup", True):
        return {**fields, "_reject": "pas une drague de rue selon Gemini"}
    if not segments:
        return {**fields, "_reject": "aucune scène extérieure détectée par Gemini"}
    outdoor_start = next((a for a, _ in segments if a >= intro_end), segments[0][0])
    start = max(intro_end, outdoor_start, safe_start)
    for a, b in ads:  # une carte pub qui chevauche le début : on démarre après
        if a <= start < b:
            start = b
    # fin du bloc extérieur : on enchaîne les segments séparés de moins de 20 s (plan de coupe), on s'arrête
    # au premier vrai passage en intérieur — le jeu n'a que faire de l'appartement
    outdoor_end = start
    for a, b in segments:
        if b <= start:
            continue
        if a - outdoor_end > 20 and outdoor_end > start:
            break
        outdoor_end = max(outdoor_end, b)
    end = safe_end if intimate is None else min(safe_end, intimate)
    end = min(end, outdoor_end, start + config.MAX_CLIP_SECONDS)
    # garde-fou : la première image signalée explicite par nudenet après le début, même isolée, coupe le clip
    if timeline:
        hit = next((t for t, score in timeline if t >= start and score >= config.NSFW_THRESHOLD), None)
        if hit is not None:
            end = min(end, hit - config.SAFETY_MARGIN)
    # cartes pub au milieu du clip : coupées au montage (skip) ; une carte qui touche la fin raccourcit le clip
    skips = []
    for a, b in ads:
        if a >= end or b <= start:
            continue
        if b >= end:
            end = a
        else:
            skips.append([round(max(a, start) - start, 1), round(b - start, 1)])
    fields["skip_json"] = json.dumps(skips)
    fields.update(start_s=round(start, 1), end_s=round(end, 1), outdoor_end=round(min(outdoor_end, end), 1))
    if end - start < config.MIN_CLIP_SECONDS:
        return {**fields, "_reject": f"clip trop court ({end - start:.0f}s entre la scène extérieure et le moment intime)"}
    if fields["outdoor_end"] - start < min(config.MIN_CLIP_SECONDS, 20):
        return {**fields, "_reject": f"partie extérieure trop courte ({fields['outdoor_end'] - start:.0f}s)"}
    return fields


def decide_location(video_id: str, start: float, loc: dict, offset: float = 0.0) -> dict:
    """Passe 2 -> lieu, actrice, nom de fichier, ou `_reject` si le lieu n'est pas identifiable."""
    location = loc.get("location") or {}
    act = loc.get("actress") or {}
    fields = {
        "actress": (act.get("name") or "").strip() or None,
        "actress_confidence": act.get("confidence"),
        "lat": location.get("latitude"),
        "lng": location.get("longitude"),
        "city": location.get("city"),
        "country": location.get("country"),
        "location_confidence": location.get("confidence"),
        "identifiable": bool(location.get("identifiable")),
        "clues": " · ".join((c.get("text") if isinstance(c, dict) else str(c)) for c in (location.get("clues") or [])),
        "best_frame": _abs(loc.get("best_frame"), offset),
    }
    conf = float(location.get("confidence") or 0)
    if not location.get("identifiable") or conf < config.MIN_LOCATION_CONFIDENCE:
        return {**fields, "_reject": f"lieu pas assez identifiable (confiance {conf:.2f}, identifiable={bool(location.get('identifiable'))})"}
    if fields["lat"] is None or fields["lng"] is None:
        return {**fields, "_reject": "Gemini n'a pas donné de coordonnées"}
    fields["filename"] = make_filename(fields["actress"], float(fields["lat"]), video_id)
    return fields


def _load_or_call(path: Path, force: bool, fn):
    if path.exists() and not force:
        return json.loads(path.read_text())
    data = fn()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    return data


def _thumb(src: Path, t: float, d: Path) -> None:
    try:
        clip.make_thumbnail(src, max(t, 0), d / "thumb.jpg")
    except Exception as e:
        log.warning("vignette impossible (%s)", e)


def process_one(video: dict, force_gemini: bool = False) -> None:
    import gemini_analyze  # SDK lent à charger, inutile pour discover/sheet

    vid = video["id"]
    d = work_dir(vid)
    source = d / "source.mp4"
    safe_clip = d / "safe.mp4"
    nsfw_path = d / "nsfw.json"
    seg_path = d / "segments.json"

    # 1. métadonnées + commentaires (toujours rafraîchis : l'URL mp4 signée expire)
    meta = scrape.fetch_video_page(video["url"])
    meta["comments"] = scrape.fetch_comments(meta["site"], meta["numeric_id"])
    meta["url"] = video["url"]
    db.update(vid, title=meta["title"], description=meta["description"], tags=meta["tags"], uploader=meta["uploader"],
              performers=meta.get("performers") or [], cdn_hash=meta.get("cdn_hash"),
              duration=meta["duration"] or video.get("duration"), thumbnail_url=meta["thumbnail_url"], comments=meta["comments"])
    known_nums, known_hashes = db.known_ids()
    if meta["numeric_id"] in known_nums or (meta.get("cdn_hash") and meta["cdn_hash"] in known_hashes):
        _reject(vid, "déjà dans le jeu (même vidéo sous un autre lien)")
        cleanup(vid, keep_safe=False)
        return

    # 2. téléchargement du début seulement, images 1/s partagées : nudenet (explicite) + CLIP (découpage)
    if nsfw_path.exists() and seg_path.exists() and not force_gemini:
        result = json.loads(nsfw_path.read_text())
        seg = json.loads(seg_path.read_text())
    else:
        if not source.exists():
            log.info("%s : téléchargement (%ss)…", vid, config.DOWNLOAD_SECONDS)
            scrape.download_source(meta, source, seconds=config.DOWNLOAD_SECONDS)
        frames_1s = nsfw.extract_frames(source, d / "frames", config.SCAN_SECONDS)
        log.info("%s : scan explicite + découpage local (%d images)…", vid, len(frames_1s))
        result = nsfw.scan_video(source, d, frames=frames_1s)
        if config.LOCAL_SEGMENT:
            import segment_local
            seg = segment_local.segment(frames_1s, len(frames_1s))
        else:
            grids = frames.make_segment_grids(source, d / "grids", offset=0.0, step=config.FRAME_STEP_SECONDS)
            seg = gemini_analyze.segment(grids, meta)
        seg_path.write_text(json.dumps(seg, ensure_ascii=False))
    frames_1s = sorted((d / "frames").glob("f_*.jpg"))
    first_explicit = result.get("first_explicit")
    safe_start, safe_end = result.get("safe_start"), result.get("safe_end")
    db.update(vid, nsfw_cut=first_explicit, safe_start=safe_start, safe_end=safe_end,
              segments_json=json.dumps({k: v for k, v in seg.items() if k != "_meta"}, ensure_ascii=False))
    log.info("%s : explicite à %s, fenêtre sûre %s -> %s | dehors %s | pub %s | intime %s", vid, first_explicit,
             safe_start, safe_end, [(round(x["start"]), round(x["end"])) for x in seg.get("outdoor_segments", [])],
             [(round(x["start"]), round(x["end"])) for x in seg.get("ad_segments", [])], seg.get("becomes_intimate_at"))
    if safe_start is None:
        if source.exists():
            _thumb(source, 1.0, d)
        _reject(vid, f"aucune fenêtre non sexuelle de {config.MIN_CLIP_SECONDS}s dans les {int(result.get('scanned_seconds') or 0)} premières secondes")
        cleanup(vid, keep_safe=False)
        return

    # 3. fenêtre du clip de jeu (temps absolus : découpage local et horodatages imprimés sont en secondes source)
    step = 1.0 if str((seg.get("_meta") or {}).get("model", "")).startswith("clip") else float(config.FRAME_STEP_SECONDS)
    fields = decide_window(safe_start, safe_end, seg, timeline=result.get("timeline"), step=step)
    # 3b. frontière intime précise : Gemini léger sur la dernière minute du clip candidat (le local se trompe sur les gros plans)
    if not fields.get("_reject") and seg.get("_meta", {}).get("model", "").startswith("clip"):
        cand_start, cand_end = fields["start_s"], fields["end_s"]
        lo = max(cand_start, cand_end - 90)
        items = [(float(i), fp) for i, fp in enumerate(frames_1s) if lo <= i <= cand_end and int(i - lo) % 2 == 0]
        if items or ((d / "gemini_tail.json").exists() and not force_gemini):
            try:
                tail = _load_or_call(d / "gemini_tail.json", force_gemini,
                                     lambda: gemini_analyze.tail_check(frames.grids_from_frames(items, d / "grids")))
                t_int = config.parse_ts(tail.get("becomes_intimate_at"))
                seg["becomes_intimate_at"] = t_int if t_int is not None else seg.get("becomes_intimate_at")
                seg["_meta_tail"] = tail.get("_meta")
                fields = decide_window(safe_start, safe_end, seg, timeline=result.get("timeline"), step=step)
            except gemini_analyze.GeminiBlocked as e:
                log.warning("%s : vérification de fin bloquée (%s), on garde le découpage local", vid, e)
    for fp in frames_1s:
        fp.unlink()
    reason = fields.pop("_reject", None)
    outdoor_end = fields.pop("outdoor_end", None)
    gemini_json = {**{k: v for k, v in seg.items() if k not in ("_meta", "_meta_tail", "classes")}, "_meta_segment": seg.get("_meta"), "_meta_tail": seg.get("_meta_tail")}
    if reason:
        if source.exists():
            _thumb(source, safe_start, d)
        db.update(vid, gemini_json=json.dumps(gemini_json, ensure_ascii=False))
        _reject(vid, reason, **fields)
        cleanup(vid, keep_safe=False)
        return
    start, end = fields["start_s"], fields["end_s"]

    # 4. clip d'aperçu (copie sans ré-encodage depuis l'image-clé) + images de la scène de rue depuis la source
    if not source.exists():
        scrape.download_source(meta, source, seconds=config.DOWNLOAD_SECONDS)
    if not safe_clip.exists():
        kf = clip.copy_clip(source, safe_start, safe_end, safe_clip)
        db.update(vid, clip_start=kf)
    images, times, geometry = frames.make_locate_images(source, d / "locate", start, outdoor_end, offset=0.0, n=config.LOCATE_FRAMES)
    audio = None
    if config.LOCATE_AUDIO_SECONDS > 0:
        audio = frames.extract_audio(source, start, min(config.LOCATE_AUDIO_SECONDS, outdoor_end - start), d / "locate" / "audio.mp3")

    def blocked(e: Exception) -> None:
        _thumb(source, start, d)
        db.update(vid, gemini_json=json.dumps(gemini_json, ensure_ascii=False), **fields)
        _reject(vid, f"bloqué par le filtre Gemini ({e})")
        cleanup(vid, keep_safe=False)

    # 5. pré-filtre léger : lieu manifestement anonyme -> on s'arrête là (~0,1 centime)
    if config.PREFILTER:
        try:
            pre = _load_or_call(d / "gemini_prefilter.json", force_gemini, lambda: gemini_analyze.prefilter(images))
        except gemini_analyze.GeminiBlocked as e:
            blocked(e)
            return
        gemini_json["_meta_prefilter"] = pre.get("_meta")
        gemini_json["prefilter"] = {k: v for k, v in pre.items() if k != "_meta"}
        conf = float(pre.get("country_confidence") or 0)
        if conf < config.PREFILTER_MIN:
            _thumb(source, start, d)
            db.update(vid, gemini_json=json.dumps(gemini_json, ensure_ascii=False), country=pre.get("country"),
                      location_confidence=conf, **fields)
            _reject(vid, f"lieu manifestement anonyme (pré-filtre {conf:.2f}) : {pre.get('reason') or ''}"[:300])
            cleanup(vid, keep_safe=False)
            return

    # 6. lieu (modèle complet) + actrice, en parallèle
    log.info("%s : Gemini lieu (%d images%s, %s -> %s) + actrice…", vid, len(images), " + audio" if audio else "",
             config.fmt_ts(start), config.fmt_ts(outdoor_end))
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_loc = ex.submit(_load_or_call, d / "gemini_locate.json", force_gemini, lambda: gemini_analyze.locate(images, times, audio))
        f_act = ex.submit(_load_or_call, d / "gemini_actress.json", force_gemini, lambda: gemini_analyze.actress(meta))
        try:
            loc = f_loc.result()
        except gemini_analyze.GeminiBlocked as e:
            f_act.result()
            blocked(e)
            return
        act = f_act.result()
    loc["actress"] = {k: v for k, v in act.items() if k != "_meta"}
    gemini_json.update({k: v for k, v in loc.items() if k != "_meta"}, _meta_locate=loc.get("_meta"), _meta_actress=act.get("_meta"),
                       notes=" ".join(x for x in (seg.get("notes"), loc.get("notes")) if x))

    # 7. décision lieu, quota pays, indices, portrait, vignette
    fields.update(decide_location(vid, start, loc))
    reason = fields.pop("_reject", None)
    # 7b. texte incrusté qui révèle la réponse (sous-titre « Athens »…) : OCR local sur les vidéos gardées
    if not reason and config.OCR_SPOILERS:
        import ocr
        names = list(loc.get("giveaway_names") or []) + [x for x in (fields.get("city"), fields.get("country"), (loc.get("location") or {}).get("area")) if x]
        hits = ocr.find_spoilers(source, start, end, names, d / "ocr")
        fields["spoilers_json"] = json.dumps(hits, ensure_ascii=False)
        if hits:
            new_start, new_end, extra_skips, sp_reason = ocr.apply_spoilers(start, end, hits)
            log.info("%s : texte révélateur à l'écran %s -> clip %s -> %s", vid, [(h["t"], h["names"]) for h in hits][:6],
                     config.fmt_ts(new_start), config.fmt_ts(new_end))
            if sp_reason:
                reason = sp_reason
            else:
                old_skips = json.loads(fields.get("skip_json") or "[]")
                shifted = [[round(a - (new_start - start), 1), round(b - (new_start - start), 1)] for a, b in old_skips if b - (new_start - start) > 0]
                shifted = [[max(0.0, a), b] for a, b in shifted]
                fields["skip_json"] = json.dumps(sorted(shifted + extra_skips))
                fields["start_s"], fields["end_s"] = new_start, new_end
                start, end = new_start, new_end
    if not reason and config.MAX_PER_COUNTRY:
        have = sum(1 for v in db.list_videos(status=[config.STATUS_TO_REVIEW, config.STATUS_APPROVED, config.STATUS_EXPORTED])
                   if norm_country(v.get("country")) == norm_country(fields.get("country")))
        if have >= config.MAX_PER_COUNTRY:
            reason = f"quota pays atteint ({fields.get('country')} : {have})"
    clue_items = frames.crop_clues((loc.get("location") or {}).get("clues") or [], geometry, d / "clues")
    fields["clues_json"] = json.dumps(clue_items, ensure_ascii=False)
    portrait = frames.crop_portrait(loc.get("woman"), geometry, d / "clues" / "actress.jpg")
    fields["actress_photo"] = portrait.name if portrait else None
    best = fields.get("best_frame")
    _thumb(source, best if best is not None else start, d)
    db.update(vid, gemini_json=json.dumps(gemini_json, ensure_ascii=False))
    if reason:
        _reject(vid, reason, **fields)
        cleanup(vid, keep_safe=False)
        return
    current = (db.get(vid) or {}).get("status")
    keep = current if current in (config.STATUS_APPROVED, config.STATUS_EXPORTED) else config.STATUS_TO_REVIEW
    db.update(vid, status=keep, error=None, **fields)  # jamais rétrograder une vidéo validée par Loris
    cleanup(vid, keep_safe=True)
    cost = gemini_analyze.cost_usd(gemini_json.get("_meta_tail"), gemini_json.get("_meta_prefilter"), loc.get("_meta"), act.get("_meta"))
    log.info("%s : À VALIDER — %s, %s (%s) conf %.2f, %s -> %s, coût Gemini ≈ %s", vid, fields.get("actress"), fields.get("city"),
             fields.get("country"), fields.get("location_confidence") or 0, config.fmt_ts(start), config.fmt_ts(end),
             f"{cost:.4f} $" if cost is not None else "?")


COUNTRY_ALIASES = {
    "czechia": "czech republic", "tchéquie": "czech republic", "république tchèque": "czech republic", "republique tcheque": "czech republic",
    "allemagne": "germany", "deutschland": "germany", "états-unis": "united states", "etats-unis": "united states", "usa": "united states",
    "royaume-uni": "united kingdom", "uk": "united kingdom", "england": "united kingdom", "angleterre": "united kingdom",
    "espagne": "spain", "italie": "italy", "japon": "japan", "thaïlande": "thailand", "thailande": "thailand",
    "hongrie": "hungary", "russie": "russia", "pologne": "poland", "brésil": "brazil", "brasil": "brazil",
    "mexique": "mexico", "colombie": "colombia", "pays-bas": "netherlands", "autriche": "austria", "suisse": "switzerland",
    "belgique": "belgium", "grèce": "greece", "turquie": "turkey", "portugal": "portugal", "roumanie": "romania",
}


def norm_country(name: str | None) -> str | None:
    if not name:
        return None
    n = name.strip().lower()
    return COUNTRY_ALIASES.get(n, n)


def pick_next(limit: int, retry_errors: bool) -> list[dict]:
    """Prochaines vidéos : dans l'ordre de la recherche, mais les uploaders déjà bien représentés
    (≥ STUDIO_SATURATION vidéos à valider ou validées) passent en fin de file : jamais toujours le même studio."""
    statuses = [config.STATUS_NEW] + ([config.STATUS_ERROR] if retry_errors else [])
    candidates = db.list_videos(status=statuses)
    def norm_up(name, title=None):  # "SCOUT69official" (recherche) et "scout69_official" (page) = même studio
        n = re.sub(r"[^a-z0-9]", "", (name or "").lower())
        if not n and title:  # uploader inconnu : studio deviné dans le titre
            t = title.lower()
            for studio in config.PRIORITY_STUDIOS:
                if studio in t:
                    return re.sub(r"[^a-z0-9]", "", studio)
        return n
    per_uploader: collections.Counter = collections.Counter()
    for v in db.list_videos(status=[config.STATUS_TO_REVIEW, config.STATUS_APPROVED, config.STATUS_EXPORTED]):
        if v.get("uploader"):
            per_uploader[norm_up(v["uploader"])] += 1
    saturated = {u for u, n in per_uploader.items() if n >= config.STUDIO_SATURATION}
    saturated |= {re.sub(r"[^a-z0-9]", "", st) for st in config.PRIORITY_STUDIOS if any(st in (v.get("uploader") or "").lower() or st in (v.get("title") or "").lower() for v in db.list_videos(status=[config.STATUS_APPROVED, config.STATUS_EXPORTED])) and per_uploader.get(re.sub(r"[^a-z0-9]", "", st), 0) + sum(1 for v in db.list_videos(status=[config.STATUS_APPROVED, config.STATUS_EXPORTED]) if st in (v.get("title") or "").lower()) >= config.STUDIO_SATURATION}
    candidates.sort(key=lambda v: (1 if norm_up(v.get("uploader"), v.get("title")) in saturated else 0, v.get("created_at") or "", v["id"]))
    return candidates[:limit]


def cmd_process(args) -> None:
    if not config.GEMINI_API_KEY:
        log.error("GEMINI_API_KEY manquante dans pipeline/.env : rien n'est traité (clé sur https://aistudio.google.com/apikey)")
        return
    if args.id:
        videos = [v for v in (db.get(i) for i in args.id) if v]
        if not args.force:
            locked = [v["id"] for v in videos if v["status"] in (config.STATUS_APPROVED, config.STATUS_EXPORTED)]
            if locked:
                log.warning("vidéos validées/exportées, non retraitées (utilise --force) : %s", ", ".join(locked))
            videos = [v for v in videos if v["status"] not in (config.STATUS_APPROVED, config.STATUS_EXPORTED)]
    else:
        videos = pick_next(args.limit, args.retry_errors)
    if not videos:
        log.info("rien à traiter")
        return
    import sheet
    from concurrent.futures import ThreadPoolExecutor
    sync_each = not args.no_sheet and sheet.is_configured()
    if not args.no_sheet and not sync_each:
        log.warning("Google Sheet non connecté (bouton « Connecter le Sheet » dans le dashboard) : Sheet non mis à jour")
    sheet_lock = threading.Lock()

    def worker(video: dict) -> None:
        log.info("=== %s — %s", video["id"], (video.get("title") or "")[:80])
        t0 = time.time()
        try:
            process_one(video, force_gemini=args.force)
        except Exception as e:
            log.exception("%s : erreur", video["id"])
            db.update(video["id"], status=config.STATUS_ERROR, error=f"{type(e).__name__}: {str(e)[:500]}")
        log.info("%s : terminé en %.0f s", video["id"], time.time() - t0)
        if sync_each:  # le Sheet suit en direct, vidéo par vidéo
            with sheet_lock:
                try:
                    sheet.sync()
                except Exception as e:
                    log.error("Sheet : %s", e)

    workers = 1 if args.id else max(1, config.WORKERS)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(worker, videos))


# ------------------------------------------------------------ sheet/export --

def try_sheet() -> None:
    import sheet
    if not sheet.is_configured():
        log.warning("Google Sheet non connecté (bouton « Connecter le Sheet » dans le dashboard) : Sheet non mis à jour")
        return
    try:
        sheet.sync()
    except Exception as e:
        log.error("Sheet : %s", e)


def cmd_sheet(args) -> None:
    import sheet
    n = sheet.sync()
    print(f"{n} lignes écrites dans l'onglet '{config.SHEET_TAB}'")


def cmd_export(args) -> None:
    """Vidéos validées -> entries.json au format de scripts/add-video.mjs (R2 + Supabase)."""
    videos = db.list_videos(status=config.STATUS_APPROVED)
    if args.include_exported:
        videos += db.list_videos(status=config.STATUS_EXPORTED)
    if not videos:
        print("aucune vidéo validée à exporter")
        return
    entries = []
    for v in videos:
        entries.append({
            "url": v["url"],
            "source_url": v["url"],
            "start": config.fmt_ts(v["start_s"]),
            "end": config.fmt_ts(v["end_s"]),
            "latitude": v["lat"],
            "longitude": v["lng"],
            "city": v.get("city") or None,
            "country": v.get("country") or None,
            "filename": v["filename"],
            "actor_name": v.get("actress") or None,
            "skip": json.loads(v.get("skip_json") or "[]"),
            "actor_photo": str(config.VIDEOS_DIR / v["id"] / "clues" / v["actress_photo"])
            if v.get("actress_photo") and (config.VIDEOS_DIR / v["id"] / "clues" / v["actress_photo"]).exists() else None,
            "clues": [
                {"text": c["text"], "t": c.get("t"), "box": c.get("box"),
                 "crop": str(config.VIDEOS_DIR / v["id"] / "clues" / c["crop"]) if c.get("crop") else None,
                 "frame": str(config.VIDEOS_DIR / v["id"] / "clues" / c["frame"]) if c.get("frame") else None}
                for c in json.loads(v.get("clues_json") or "[]")
                if not c.get("crop") or (config.VIDEOS_DIR / v["id"] / "clues" / c["crop"]).exists()
            ],
        })
        if args.clips:
            src = config.VIDEOS_DIR / v["id"] / "safe.mp4"
            if src.exists():
                out = config.CLIPS_DIR / f"{v['filename']}.mp4"
                clip.make_final_clip(src, v["start_s"], v["end_s"], out)
                db.update(v["id"], clip_path=str(out))
    config.ensure_dirs()
    out_path = Path(args.out) if args.out else config.EXPORT_DIR / f"entries-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out_path.write_text(json.dumps(entries, ensure_ascii=False, indent=2))
    print(f"{len(entries)} entrées -> {out_path}")
    pushed_ok = False
    if args.push:
        env_file = config.app_env_file()
        script = config.ROOT.parent / "scripts" / "add-video.mjs"
        if not env_file or not script.exists():
            log.error("push impossible : .env.local ou scripts/add-video.mjs introuvable (%s, %s)", env_file, script)
        else:
            log.info("envoi vers Cloudflare R2 + Supabase : node add-video.mjs (%d vidéos)…", len(entries))
            proc = subprocess.Popen(["node", f"--env-file={env_file}", str(script), str(out_path)], cwd=config.ROOT.parent,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in proc.stdout:
                log.info("add-video: %s", line.rstrip())
            pushed_ok = proc.wait() == 0
            if not pushed_ok:
                log.error("add-video.mjs a échoué : les vidéos restent « validées », relance l'export plus tard")
    if pushed_ok or not args.push:
        for v in videos:
            if v["status"] == config.STATUS_APPROVED:
                db.update(v["id"], status=config.STATUS_EXPORTED, exported_at=time.strftime("%Y-%m-%d %H:%M:%S"))
                if not args.clips:
                    cleanup(v["id"], keep_safe=False)  # le jeu a sa copie sur R2 : plus besoin du clip d'aperçu
    if not args.push:
        print("Envoi vers Cloudflare R2 + Supabase (depuis le dossier de l'app, avec .env.local) :")
        print(f"  node --env-file=.env.local scripts/add-video.mjs \"{out_path}\"")
    if not args.no_sheet:
        try_sheet()


def cmd_status(args) -> None:
    for status, n in db.counts().items():
        print(f"{status:15s} {n}")
    have = collections.Counter(norm_country(v.get("country")) for v in db.list_videos(status=[config.STATUS_TO_REVIEW, config.STATUS_APPROVED, config.STATUS_EXPORTED]) if v.get("country"))
    if have:
        print("pays couverts :", ", ".join(f"{c} {n}" for c, n in have.most_common()))


def cmd_auto(args) -> None:
    cmd_discover(args)
    args.id = None
    args.retry_errors = getattr(args, "retry_errors", False)
    args.force = False
    args.no_sheet = False
    cmd_process(args)


def cmd_reset(args) -> None:
    """Remet une vidéo en 'new' (et efface l'analyse Gemini si --force) pour la retraiter."""
    ids = list(args.id)
    if args.gemini_blocked:
        ids += [v["id"] for v in db.list_videos(status=config.STATUS_REJECTED_AUTO)
                if "bloqué par le filtre Gemini" in (v.get("reject_reason") or "")]
    for vid in ids:
        d = config.VIDEOS_DIR / vid
        if args.force:
            for name in ("gemini_segment.json", "gemini_tail.json", "gemini_prefilter.json", "gemini_locate.json", "gemini_actress.json", "gemini.json", "segments.json", "outdoor.mp4"):
                if (d / name).exists():
                    (d / name).unlink()
            shutil.rmtree(d / "grids", ignore_errors=True)
            shutil.rmtree(d / "locate", ignore_errors=True)
        if args.keep_segment:
            for name in ("gemini_locate.json", "gemini_actress.json"):
                if (d / name).exists():
                    (d / name).unlink()
        db.update(vid, status=config.STATUS_NEW, error=None, reject_reason=None)
        print(f"{vid} -> new")


# ------------------------------------------------------------------- main --

def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("discover", help="cherche de nouvelles vidéos")
    d.add_argument("--query", action="append", help="requête (répétable), défaut SEARCH_QUERIES")
    d.add_argument("--pages", type=int)
    d.set_defaults(func=cmd_discover)

    a = sub.add_parser("add", help="ajoute des URL à la main")
    a.add_argument("url", nargs="+")
    a.set_defaults(func=cmd_add)

    pr = sub.add_parser("process", help="traite les vidéos en attente")
    pr.add_argument("--limit", type=int, default=5)
    pr.add_argument("--id", action="append", help="traiter seulement cet id (répétable)")
    pr.add_argument("--retry-errors", action="store_true")
    pr.add_argument("--force", action="store_true", help="refait l'appel Gemini même si déjà fait")
    pr.add_argument("--no-sheet", action="store_true")
    pr.set_defaults(func=cmd_process)

    s = sub.add_parser("sheet", help="synchronise le Google Sheet")
    s.set_defaults(func=cmd_sheet)

    e = sub.add_parser("export", help="vidéos validées -> entries.json pour add-video.mjs")
    e.add_argument("--out")
    e.add_argument("--clips", action="store_true", help="découpe aussi les mp4 finaux dans data/clips/")
    e.add_argument("--include-exported", action="store_true")
    e.add_argument("--push", action="store_true", help="envoie aussitôt sur R2 + Supabase via scripts/add-video.mjs")
    e.add_argument("--no-sheet", action="store_true")
    e.set_defaults(func=cmd_export)

    au = sub.add_parser("auto", help="discover + process + sheet")
    au.add_argument("--query", action="append")
    au.add_argument("--pages", type=int)
    au.add_argument("--limit", type=int, default=10)
    au.add_argument("--retry-errors", action="store_true", help="relance aussi les vidéos en erreur")
    au.set_defaults(func=cmd_auto)

    st = sub.add_parser("status")
    st.set_defaults(func=cmd_status)

    bf = sub.add_parser("backfill", help="ajoute indices + portrait aux vidéos déjà en ligne (R2 + Supabase)")
    bf.add_argument("--limit", type=int)
    bf.add_argument("--dry-run", action="store_true")
    bf.add_argument("--force", action="store_true")
    bf.set_defaults(func=lambda a: __import__("backfill").backfill(a.limit, a.dry_run, a.force))

    kn = sub.add_parser("known", help="résout les liens déjà dans le jeu / le Sheet (dédoublonnage inter-sites)")
    kn.set_defaults(func=lambda a: sync_known())

    rs = sub.add_parser("reset", help="remet des vidéos en 'new'")
    rs.add_argument("id", nargs="*")
    rs.add_argument("--force", action="store_true", help="efface aussi les réponses Gemini")
    rs.add_argument("--keep-segment", action="store_true", help="garde la passe 1, refait lieu + actrice")
    rs.add_argument("--gemini-blocked", action="store_true", help="cible toutes les vidéos rejetées pour blocage Gemini")
    rs.set_defaults(func=cmd_reset)

    args = p.parse_args(argv)
    config.ensure_dirs()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(config.DATA_DIR / "pipeline.log")],
    )
    db.init()
    args.func(args)


if __name__ == "__main__":
    main()
