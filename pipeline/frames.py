"""Images fixes envoyées à Gemini à la place de la vidéo (10 à 20 fois moins de tokens).

- passe 1 : planches-contact 4×6 (24 images, une toutes les FRAME_STEP_SECONDS s), 768×768 px, horodatées
- passe 2 : quelques images pleine largeur (768 px) de la partie extérieure, empilées par deux, + 45 s d'audio
Les horodatages imprimés sont ceux de la vidéo source (MM:SS), Gemini répond avec ces mêmes valeurs.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


def _font(size: int):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def label(seconds: float) -> str:
    s = int(round(seconds))
    return f"{s // 60:02d}:{s % 60:02d}"


def _extract_series(src: Path, step: float, width: int, out_dir: Path, prefix: str = "s",
                    start: float = 0.0, duration: float | None = None) -> list[tuple[float, Path]]:
    """Images toutes les `step` s à partir de `start` (temps relatifs au fichier) -> [(t_rel, path)]."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob(f"{prefix}_*.jpg"):
        old.unlink()
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.3f}", "-i", str(src)]
    if duration is not None:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-vf", f"fps=1/{step},scale={width}:-2", "-q:v", "4", str(out_dir / f"{prefix}_%04d.jpg")]
    subprocess.run(cmd, check=True)
    return [(start + i * step, p) for i, p in enumerate(sorted(out_dir.glob(f"{prefix}_*.jpg")))]


DENSE_SECONDS = 48.0   # le début (intro studio, cartes pub) est échantillonné toutes les 2 s


def make_segment_grids(src: Path, out_dir: Path, offset: float, step: float = 4.0,
                       cols: int = 4, rows: int = 6, cell_w: int = 192) -> list[dict]:
    """Planches 768×768 horodatées à partir du clip sûr. Retourne [{path, times: [s absolues]}].

    Les DENSE_SECONDS premières secondes sont échantillonnées toutes les 2 s (fin d'intro précise), la suite
    toutes les `step` s. Les horodatages imprimés sont absolus, Gemini les recopie.
    """
    frames = _extract_series(src, 2.0, cell_w, out_dir, prefix="a", start=0.0, duration=DENSE_SECONDS)
    frames += _extract_series(src, step, cell_w, out_dir, prefix="b", start=DENSE_SECONDS)
    frame_h = int(round(cell_w * 9 / 16))
    strip = 20
    cell_h = frame_h + strip
    font = _font(13)
    grids: list[dict] = []
    per = cols * rows
    for g in range(0, len(frames), per):
        chunk = frames[g:g + per]
        canvas = Image.new("RGB", (cols * cell_w, rows * cell_h), (12, 12, 14))
        draw = ImageDraw.Draw(canvas)
        times: list[float] = []
        for i, (t_rel, fp) in enumerate(chunk):
            t = offset + t_rel
            times.append(t)
            x, y = (i % cols) * cell_w, (i // cols) * cell_h
            with Image.open(fp) as im:
                im = im.convert("RGB")
                im.thumbnail((cell_w, frame_h))
                canvas.paste(im, (x + (cell_w - im.width) // 2, y))
            draw.rectangle([x, y + frame_h, x + cell_w - 1, y + cell_h - 1], fill=(30, 30, 36))
            draw.text((x + 4, y + frame_h + 3), label(t), fill=(255, 230, 120), font=font)
        path = out_dir / f"grid_{g // per + 1:02d}.jpg"
        canvas.save(path, "JPEG", quality=82)
        grids.append({"path": str(path), "times": times})
    for _, fp in frames:
        fp.unlink()
    return grids


def grids_from_frames(items: list[tuple[float, Path]], out_dir: Path, prefix: str = "tail",
                      cols: int = 4, rows: int = 6, cell_w: int = 192) -> list[dict]:
    """Planches horodatées à partir d'images déjà extraites [(t absolu, chemin)]."""
    out_dir.mkdir(parents=True, exist_ok=True)
    frame_h = int(round(cell_w * 9 / 16))
    strip = 20
    cell_h = frame_h + strip
    font = _font(13)
    grids: list[dict] = []
    per = cols * rows
    for g in range(0, len(items), per):
        chunk = items[g:g + per]
        canvas = Image.new("RGB", (cols * cell_w, rows * cell_h), (12, 12, 14))
        draw = ImageDraw.Draw(canvas)
        times: list[float] = []
        for i, (t, fp) in enumerate(chunk):
            times.append(t)
            x, y = (i % cols) * cell_w, (i // cols) * cell_h
            with Image.open(fp) as im:
                im = im.convert("RGB")
                im.thumbnail((cell_w, frame_h))
                canvas.paste(im, (x + (cell_w - im.width) // 2, y))
            draw.rectangle([x, y + frame_h, x + cell_w - 1, y + cell_h - 1], fill=(30, 30, 36))
            draw.text((x + 4, y + frame_h + 3), label(t), fill=(255, 230, 120), font=font)
        path = out_dir / f"{prefix}_{g // per + 1:02d}.jpg"
        canvas.save(path, "JPEG", quality=82)
        grids.append({"path": str(path), "times": times})
    return grids


def extract_frame(src: Path, t_rel: float, out: Path, width: int = 768) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{max(t_rel, 0):.3f}", "-i", str(src),
         "-frames:v", "1", "-vf", f"scale={width}:-2", "-q:v", "3", str(out)],
        check=True,
    )
    return out


def make_locate_images(src: Path, out_dir: Path, start_rel: float, end_rel: float, offset: float,
                       n: int = 6, width: int = 768) -> tuple[list[Path], list[float], list[list[dict]]]:
    """n images réparties sur [start_rel, end_rel] du clip sûr, empilées par deux, horodatées (temps absolu).

    Retourne (composites, temps absolus, géométrie) ; géométrie[k] = [{single, t, y0, h, w}, …] pour retrouver
    l'image simple et la zone d'un indice donné par Gemini sur le composite k. Les images simples sont gardées.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.jpg"):
        old.unlink()
    span = max(end_rel - start_rel, 1.0)
    n = max(2, n)
    times_rel = [start_rel + span * (i + 0.5) / n for i in range(n)]
    singles = [extract_frame(src, t, out_dir / f"f_{i:02d}.jpg", width) for i, t in enumerate(times_rel)]
    font = _font(15)
    strip = 22
    images: list[Path] = []
    geometry: list[list[dict]] = []
    for k in range(0, n, 2):
        pair = singles[k:k + 2]
        ims = [Image.open(p).convert("RGB") for p in pair]
        h = sum(im.height + strip for im in ims)
        canvas = Image.new("RGB", (width, h), (12, 12, 14))
        draw = ImageDraw.Draw(canvas)
        y = 0
        geo: list[dict] = []
        for im, t, p in zip(ims, times_rel[k:k + 2], pair):
            draw.rectangle([0, y, width - 1, y + strip - 1], fill=(30, 30, 36))
            draw.text((6, y + 3), label(offset + t), fill=(255, 230, 120), font=font)
            y += strip
            canvas.paste(im, (0, y))
            geo.append({"single": str(p), "t": offset + t, "y0": y, "h": im.height, "w": im.width, "H": h})
            y += im.height
        path = out_dir / f"locate_{k // 2 + 1:02d}.jpg"
        canvas.save(path, "JPEG", quality=85)
        images.append(path)
        geometry.append(geo)
        for im in ims:
            im.close()
    return images, [offset + t for t in times_rel], geometry


def crop_clues(clues: list[dict], geometry: list[list[dict]], out_dir: Path, pad: float = 0.35,
               min_px: int = 120, crop_width: int = 640) -> list[dict]:
    """Pour chaque indice {text, image_index, box_2d[ymin,xmin,ymax,xmax] 0-1000 sur le composite} :
    retrouve l'image simple, découpe la zone (avec marge) en `clue_N.jpg`, copie l'image en `frame_N.jpg`.
    Retourne [{text, t, frame, crop, box}] avec box normalisée 0-1 [ymin,xmin,ymax,xmax] sur l'image simple.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.jpg"):
        old.unlink()
    result: list[dict] = []
    for i, clue in enumerate(clues, start=1):
        try:
            if clue.get("image_index") is None or not clue.get("box_2d"):  # indice audio / général : texte seul
                if clue.get("text"):
                    result.append({"text": clue["text"], "t": None, "frame": None, "crop": None, "box": None})
                continue
            idx = int(clue.get("image_index") or 1) - 1
            box = [float(v) for v in (clue.get("box_2d") or [])]
            if not (0 <= idx < len(geometry)) or len(box) != 4:
                if clue.get("text"):
                    result.append({"text": clue["text"], "t": None, "frame": None, "crop": None, "box": None})
                continue
            comp = geometry[idx]
            H = comp[0]["H"]
            ymin, xmin, ymax, xmax = box[0] / 1000 * H, box[1] / 1000, box[2] / 1000 * H, box[3] / 1000
            cy = (ymin + ymax) / 2
            frame = min(comp, key=lambda g: abs((g["y0"] + g["h"] / 2) - cy))
            # zone relative à l'image simple, en 0-1
            fy0, fh, fw = frame["y0"], frame["h"], frame["w"]
            by0 = max(0.0, min(1.0, (ymin - fy0) / fh)); by1 = max(0.0, min(1.0, (ymax - fy0) / fh))
            bx0 = max(0.0, min(1.0, xmin)); bx1 = max(0.0, min(1.0, xmax))
            if by1 - by0 < 0.01 or bx1 - bx0 < 0.01:
                continue
            with Image.open(frame["single"]) as im:
                im = im.convert("RGB")
                W, Hs = im.size
                x0, y0, x1, y1 = bx0 * W, by0 * Hs, bx1 * W, by1 * Hs
                bw, bh = max(x1 - x0, min_px), max(y1 - y0, min_px)
                cx, cyy = (x0 + x1) / 2, (y0 + y1) / 2
                bw, bh = bw * (1 + 2 * pad), bh * (1 + 2 * pad)
                cx0, cy0 = max(0, cx - bw / 2), max(0, cyy - bh / 2)
                cx1, cy1 = min(W, cx + bw / 2), min(Hs, cyy + bh / 2)
                crop = im.crop((int(cx0), int(cy0), int(cx1), int(cy1)))
                scale = crop_width / max(crop.width, 1)
                crop = crop.resize((crop_width, max(1, int(crop.height * scale))), Image.LANCZOS)
                crop_path = out_dir / f"clue_{i}.jpg"; crop.save(crop_path, "JPEG", quality=88)
                frame_path = out_dir / f"frame_{i}.jpg"; im.save(frame_path, "JPEG", quality=85)
            result.append({"text": clue.get("text") or "", "t": round(frame["t"], 1),
                           "frame": frame_path.name, "crop": crop_path.name,
                           "box": [round(by0, 4), round(bx0, 4), round(by1, 4), round(bx1, 4)]})
        except Exception:  # un indice mal formé ne doit pas faire échouer la vidéo
            continue
    return result


def crop_portrait(woman: dict | None, geometry: list[list[dict]], out: Path, size: int = 512, pad: float = 0.9) -> Path | None:
    """Portrait carré de la femme (zone Gemini + marge) depuis l'image simple correspondante, pour l'écran « Find X »."""
    if not woman:
        return None
    try:
        idx = int(woman.get("image_index") or 1) - 1
        box = [float(v) for v in (woman.get("box_2d") or [])]
        if not (0 <= idx < len(geometry)) or len(box) != 4:
            return None
        comp = geometry[idx]
        H = comp[0]["H"]
        ymin, xmin, ymax, xmax = box[0] / 1000 * H, box[1] / 1000, box[2] / 1000 * H, box[3] / 1000
        cy = (ymin + ymax) / 2
        frame = min(comp, key=lambda g: abs((g["y0"] + g["h"] / 2) - cy))
        by0 = max(0.0, min(1.0, (ymin - frame["y0"]) / frame["h"])); by1 = max(0.0, min(1.0, (ymax - frame["y0"]) / frame["h"]))
        if by1 - by0 < 0.02 or xmax - xmin < 0.02:
            return None
        with Image.open(frame["single"]) as im:
            im = im.convert("RGB")
            W, Hs = im.size
            x0, y0, x1, y1 = xmin * W, by0 * Hs, xmax * W, by1 * Hs
            side = max(x1 - x0, y1 - y0) * (1 + pad)
            side = min(side, W, Hs)
            # la zone Gemini part souvent des yeux : on décale le carré vers le haut pour garder le haut de la tête
            cx, cyy = (x0 + x1) / 2, (y0 + y1) / 2 - 0.12 * side
            left = min(max(0, cx - side / 2), W - side); top = min(max(0, cyy - side / 2), Hs - side)
            crop = im.crop((int(left), int(top), int(left + side), int(top + side))).resize((size, size), Image.LANCZOS)
            out.parent.mkdir(parents=True, exist_ok=True)
            crop.save(out, "JPEG", quality=88)
        return out
    except Exception:
        return None


def extract_audio(src: Path, start_rel: float, seconds: float, out: Path) -> Path | None:
    """Extrait `seconds` s d'audio (mono 16 kHz, 32 kb/s) ; None si la source n'a pas de piste audio."""
    out.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{max(start_rel, 0):.3f}", "-t", f"{seconds:.1f}",
         "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", str(out)],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not out.exists() or out.stat().st_size < 1000:
        return None
    return out
