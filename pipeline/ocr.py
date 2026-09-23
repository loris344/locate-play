"""Texte incrusté qui révèle le lieu (sous-titre « Athens », bandeau « Bangkok, Thailand »…), lu en local
avec RapidOCR (gratuit). Utilisé sur les vidéos gardées seulement : le début du clip est décalé après le
texte, une incrustation au milieu est coupée au montage."""
from __future__ import annotations

import logging
import re
import subprocess
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import config

log = logging.getLogger("ocr")
_ocr = None
_lock = threading.Lock()


def _engine():
    global _ocr
    with _lock:
        if _ocr is None:
            from rapidocr_onnxruntime import RapidOCR
            _ocr = RapidOCR()
    return _ocr


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", text)


def read_frame(path: Path, full: bool = False) -> str:
    """Texte lu. `full` : toute l'image (titres centrés du début) ; sinon seulement les bandes haut/bas où vivent
    sous-titres et bandeaux (moitié moins de pixels, deux fois plus vite)."""
    import numpy as np
    from PIL import Image
    texts = []
    with Image.open(path) as im:
        im = im.convert("RGB")
        w, h = im.size
        regions = [im] if full else [im.crop((0, 0, w, int(h * 0.3))), im.crop((0, int(h * 0.6), w, h))]
        for region in regions:
            try:
                res, _ = _engine()(np.asarray(region))
            except Exception as e:
                log.debug("ocr %s: %s", path.name, e)
                continue
            texts += [r[1] for r in (res or []) if len(r) > 1 and r[1]]
    return " ".join(texts)


def sample_times(start: float, end: float, head: int = 20, step: int = 6) -> list[float]:
    """1 image/s sur les `head` premières secondes (là où sont les titres), puis une toutes les `step` s."""
    times = [float(t) for t in range(int(start), int(min(end, start + head)) + 1)]
    t = start + head + step
    while t < end:
        times.append(float(int(t)))
        t += step
    return times


def extract_at(src: Path, times: list[float], out_dir: Path, width: int = 480) -> list[tuple[float, Path]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("o_*.jpg"):
        old.unlink()
    items = []
    for i, t in enumerate(times):
        out = out_dir / f"o_{i:04d}.jpg"
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", str(src), "-frames:v", "1",
                            "-vf", f"scale={width}:-2", "-q:v", "5", str(out)], capture_output=True)
        if r.returncode == 0 and out.exists():
            items.append((t, out))
    return items


def find_spoilers(src: Path, start: float, end: float, names: list[str], work_dir: Path) -> list[dict]:
    """[{t, text}] : secondes du clip où un nom révélateur (ville, pays, quartier, monument…) est lisible à l'écran."""
    keys = [(_norm(n), n) for n in names if n and len(_norm(n)) >= 4]
    if not keys:
        return []
    items = extract_at(src, sample_times(start, end), work_dir)
    hits: list[dict] = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        texts = list(ex.map(lambda it: read_frame(it[1], full=it[0] <= start + 20), items))
    for (t, fp), text in zip(items, texts):
        nt = _norm(text)
        found = [orig for k, orig in keys if k in nt]
        if found:
            hits.append({"t": t, "text": text[:120], "names": found})
    for _, fp in items:
        fp.unlink()
    return hits


def apply_spoilers(start: float, end: float, hits: list[dict], step: int = 6) -> tuple[float, float, list[list[float]], str | None]:
    """Décale le début après un texte révélateur au début, coupe (skip) ceux du milieu, raccourcit à la fin.
    Retourne (start, end, skips relatifs au nouveau début, raison de rejet éventuelle)."""
    if not hits:
        return start, end, [], None
    times = sorted(h["t"] for h in hits)
    # début : tout texte révélateur dans les 30 premières secondes décale le début juste après (+2 s de marge)
    head = [t for t in times if t <= start + 30]
    if head:
        start = max(start, max(head) + 2)
    rest = [t for t in times if t > start]
    skips: list[list[float]] = []
    for t in rest:  # chaque image lue vaut `step` s autour d'elle (échantillonnage)
        a, b = max(start, t - 1), min(end, t + step)
        if b >= end - 2:
            end = a
            break
        if skips and a <= skips[-1][1] + start + 1:
            skips[-1][1] = b - start
        else:
            skips.append([round(a - start, 1), round(b - start, 1)])
    if end - start < config.MIN_CLIP_SECONDS:
        return start, end, skips, f"texte incrusté révélant le lieu ({', '.join(sorted({n for h in hits for n in h['names']}))}) : trop peu de clip utilisable"
    cut = sum(b - a for a, b in skips)
    if cut > 0.3 * (end - start):
        return start, end, skips, "texte incrusté révélant le lieu pendant plus de 30 % du clip"
    return round(start, 1), round(end, 1), skips, None
