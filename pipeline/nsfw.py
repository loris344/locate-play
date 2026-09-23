"""Détection locale (nudenet, hors ligne) des passages sexuels.

Beaucoup de vidéos commencent par un montage d'intro explicite (logo studio + extraits), puis la scène de
rue, puis le sexe. On cherche donc la première *fenêtre sûre* assez longue, pas seulement la première image
explicite. Rien de sexuel ne quitte la machine : seule cette fenêtre est coupée et envoyée à Gemini.
"""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

import config

log = logging.getLogger("nsfw")

EXPLICIT_CLASSES = {
    "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
    "BUTTOCKS_EXPOSED",
    "ANUS_EXPOSED",
}

_detector = None


def detector():
    global _detector
    if _detector is None:
        from nudenet import NudeDetector  # import lent (onnxruntime), fait à la demande
        try:  # puce graphique du Mac si onnxruntime la propose, sinon CPU
            _detector = NudeDetector(providers=["CoreMLExecutionProvider", "CPUExecutionProvider"])
        except Exception:
            _detector = NudeDetector()
    return _detector


_lock = __import__("threading").Lock()


def extract_frames(src: Path, out_dir: Path, seconds: int, fps: int = 1, width: int = 480) -> list[Path]:
    """1 image par seconde (t = 0, 1, 2…) sur les `seconds` premières secondes."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("f_*.jpg"):
        old.unlink()
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(src), "-t", str(seconds),
            "-vf", f"fps={fps},scale={width}:-2",
            "-q:v", "4",
            str(out_dir / "f_%05d.jpg"),
        ],
        check=True,
    )
    return sorted(out_dir.glob("f_*.jpg"))


def _score(det, fp: Path) -> float:
    try:
        detections = det.detect(str(fp))
    except Exception as e:  # image corrompue : considérée sûre mais notée
        log.warning("nudenet %s: %s", fp.name, e)
        detections = []
    return round(float(max((d["score"] for d in detections if d["class"] in EXPLICIT_CLASSES), default=0.0)), 3)


def score_frames(frames: list[Path], fps: int = 1, threshold: float = config.NSFW_THRESHOLD) -> list[list[float]]:
    """[[t, score explicite max], …] pour chaque image.

    Une image sur deux est analysée, puis les voisines de chaque image signalée : deux fois plus rapide,
    même précision aux frontières.
    """
    det = detector()
    scores: dict[int, float] = {}
    with _lock:
        for i in range(0, len(frames), 2):
            scores[i] = _score(det, frames[i])
        for i in [i for i, s in list(scores.items()) if s >= threshold]:
            for j in (i - 1, i + 1):
                if 0 <= j < len(frames) and j not in scores:
                    scores[j] = _score(det, frames[j])
    timeline: list[list[float]] = []
    for i in range(len(frames)):
        s = scores.get(i)
        if s is None:  # image non analysée : on prend le max des voisines analysées (prudent)
            s = max(scores.get(i - 1, 0.0), scores.get(i + 1, 0.0))
        timeline.append([i / fps, s])
    return timeline


def safe_windows(timeline: list[list[float]], threshold: float = config.NSFW_THRESHOLD,
                 consecutive: int = config.NSFW_CONSECUTIVE, min_gap: int = 8) -> list[tuple[float, float]]:
    """Fenêtres [début, fin) sans contenu explicite, en secondes.

    Une image isolée au-dessus du seuil est du bruit : il faut `consecutive` images d'affilée pour marquer
    un passage explicite. Deux passages explicites séparés de moins de `min_gap` s sont fusionnés (un plan
    de coupe au milieu d'une scène de sexe n'est pas une fenêtre sûre).
    """
    if not timeline:
        return []
    flags = [s >= threshold for _, s in timeline]
    n = len(flags)
    explicit = [False] * n
    i = 0
    while i < n:
        if flags[i]:
            j = i
            while j < n and flags[j]:
                j += 1
            if j - i >= consecutive:
                explicit[i:j] = [True] * (j - i)
            i = j
        else:
            i += 1
    # fusion des passages explicites proches
    runs: list[list[int]] = []
    for idx, flag in enumerate(explicit):
        if flag:
            if runs and idx - runs[-1][1] <= min_gap:
                runs[-1][1] = idx + 1
            else:
                runs.append([idx, idx + 1])
    for a, b in runs:
        explicit[a:b] = [True] * (b - a)
    windows: list[tuple[float, float]] = []
    start: int | None = None
    for idx, flag in enumerate(explicit + [True]):  # sentinelle pour fermer la dernière fenêtre
        if not flag and start is None:
            start = idx
        elif flag and start is not None:
            windows.append((timeline[start][0], timeline[idx - 1][0] + 1))
            start = None
    return windows


def choose_window(windows: list[tuple[float, float]], scanned: float,
                  min_len: float = config.MIN_CLIP_SECONDS, margin: float = config.SAFETY_MARGIN) -> tuple[float, float] | None:
    """Première fenêtre sûre assez longue, rognée de `margin` s de chaque côté explicite."""
    for a, b in windows:
        start = a if a == 0 else a + margin
        end = b if b >= scanned else b - margin
        if end - start >= min_len:
            return (round(start, 1), round(end, 1))
    return None


def scan_video(src: Path, work_dir: Path, seconds: int = config.SCAN_SECONDS, frames: list[Path] | None = None) -> dict:
    """Scan nudenet. `frames` : images 1 image/s déjà extraites (partagées avec le découpage local)."""
    own = frames is None
    if own:
        frames = extract_frames(src, work_dir / "frames", seconds)
    timeline = score_frames(frames)
    if own:
        for fp in frames:  # les images extraites ne servent plus (et peuvent être explicites)
            fp.unlink()
    scanned = float(len(timeline))
    windows = safe_windows(timeline)
    chosen = choose_window(windows, scanned)
    first_explicit = next((t for t, s in timeline if s >= config.NSFW_THRESHOLD), None)
    result = {
        "scanned_seconds": scanned,
        "first_explicit": first_explicit,
        "windows": windows,
        "safe_start": chosen[0] if chosen else None,
        "safe_end": chosen[1] if chosen else None,
        "timeline": timeline,
    }
    (work_dir / "nsfw.json").write_text(json.dumps(result))
    return result
