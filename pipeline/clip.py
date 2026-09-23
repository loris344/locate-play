"""Découpes ffmpeg : clip "sûr" pour Gemini, clip final pour le jeu, vignettes."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path


def probe_duration(path: Path) -> float | None:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(json.loads(r.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError):
        return None


def make_safe_clip(src: Path, start_s: float, end_s: float, out: Path, height: int = 360) -> Path:
    """[start_s, end_s] ré-encodé léger (audio conservé : la langue parlée est un indice de lieu)."""
    if end_s <= start_s:
        raise ValueError("fin <= début")
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{start_s:.3f}", "-i", str(src), "-t", f"{end_s - start_s:.3f}",
            "-vf", f"scale=-2:'min(ih,{height})'",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "64k", "-ac", "1",
            "-movflags", "+faststart",
            str(out),
        ],
        check=True,
    )
    return out


def keyframe_before(path: Path, t: float) -> float:
    """Temps de la dernière image-clé ≤ t (0 si aucune)."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
         "-show_entries", "frame=pts_time", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    best = 0.0
    for line in r.stdout.split():
        try:
            v = float(line.strip().rstrip(","))
        except ValueError:
            continue
        if v <= t + 0.01:
            best = max(best, v)
    return best


def copy_clip(src: Path, start_s: float, end_s: float, out: Path) -> float:
    """[image-clé ≤ start_s, end_s] copié sans ré-encodage (≈ 1 s). Retourne le début réel du fichier."""
    kf = keyframe_before(src, start_s)
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{kf:.3f}", "-i", str(src), "-t", f"{max(end_s - kf, 1.0):.3f}",
         "-c", "copy", "-movflags", "+faststart", str(out)],
        check=True,
    )
    return kf


def make_final_clip(src: Path, start_s: float, end_s: float, out: Path) -> Path:
    """[start_s, end_s] ré-encodé (coupe précise à l'image près)."""
    if end_s <= start_s:
        raise ValueError("fin <= début")
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{start_s:.3f}", "-i", str(src), "-t", f"{end_s - start_s:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "96k", "-ac", "2",
            "-movflags", "+faststart",
            str(out),
        ],
        check=True,
    )
    return out


def make_thumbnail(src: Path, t: float, out: Path, width: int = 640) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{max(t, 0):.3f}", "-i", str(src),
            "-frames:v", "1", "-vf", f"scale={width}:-2", "-q:v", "3",
            str(out),
        ],
        check=True,
    )
    return out
