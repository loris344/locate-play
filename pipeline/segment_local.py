"""Découpage local, gratuit, par CLIP (zéro-shot) : pour chaque image (1 par seconde) une classe
carte pub / dehors / voiture / intérieur / intime, puis les segments qui en découlent.

Remplace l'appel Gemini de « passe 1 ». Tourne sur la puce graphique du Mac si disponible, sinon CPU.
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

log = logging.getLogger("clip")

PROMPTS: dict[str, list[str]] = {
    "ad": [
        "a title card with a logo and text",
        "an advertisement screen with a website name and a slogan",
        "a video intro screen with big text and a studio logo",
    ],
    "outdoor": [
        "a photo taken outdoors on a city street",
        "people talking outside on a sidewalk",
        "an outdoor public place such as a square, a park, a beach, a parking lot or a train station",
        "a building facade seen from the street",
        "a video frame of a street scene with subtitles or a text banner over it",
    ],
    "car": ["a photo taken inside a car"],
    "indoor": [
        "a photo taken inside an apartment, a hotel room or an office",
        "a room interior with furniture",
        "a staircase or hallway inside a building",
    ],
    "intimate": [
        "two people kissing",
        "a person undressing or posing in underwear",
        "a naked person",
    ],
}
GROUPS = list(PROMPTS)

_model = None
_lock = threading.Lock()


def _load():
    global _model
    if _model is None:
        import torch, open_clip  # imports lents, à la demande
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")
        model = model.to(device).eval()
        tokenizer = open_clip.get_tokenizer("ViT-B-32")
        texts, owner = [], []
        for g, ps in PROMPTS.items():
            for p in ps:
                texts.append(p)
                owner.append(g)
        with torch.no_grad():
            te = model.encode_text(tokenizer(texts).to(device))
            te = te / te.norm(dim=-1, keepdim=True)
        _model = (model, preprocess, te, owner, device)
        log.info("CLIP chargé sur %s", device)
    return _model


def classify(frames: list[Path], batch: int = 48) -> list[dict]:
    """[{t, cls, p}] : classe la plus probable par image (probabilités sommées par groupe)."""
    import torch
    from PIL import Image
    model, preprocess, te, owner, device = _load()
    out: list[dict] = []
    with _lock, torch.no_grad():
        for i in range(0, len(frames), batch):
            ims = []
            for fp in frames[i:i + batch]:
                try:
                    with Image.open(fp) as im:
                        ims.append(preprocess(im.convert("RGB")))
                except Exception:
                    ims.append(torch.zeros(3, 224, 224))
            x = torch.stack(ims).to(device)
            fe = model.encode_image(x)
            fe = fe / fe.norm(dim=-1, keepdim=True)
            probs = (100.0 * fe @ te.T).softmax(dim=-1).cpu()
            for k in range(probs.shape[0]):
                grouped = {g: 0.0 for g in GROUPS}
                for j, g in enumerate(owner):
                    grouped[g] += float(probs[k, j])
                cls = max(grouped, key=grouped.get)
                out.append({"t": float(i + k), "cls": cls, "p": round(grouped[cls], 3), "probs": {g: round(v, 3) for g, v in grouped.items()}})
    return out


def _smooth(classes: list[str], window: int = 3) -> list[str]:
    """Vote majoritaire sur `window` images : gomme les images isolées mal classées."""
    n = len(classes)
    if n < window:
        return classes
    half = window // 2
    out = []
    for i in range(n):
        seg = classes[max(0, i - half):i + half + 1]
        out.append(max(set(seg), key=seg.count) if seg.count(classes[i]) > 1 or len(seg) < 3 else max(set(seg), key=seg.count))
    return out


def motion(frames: list[Path]) -> list[float]:
    """Différence moyenne entre images consécutives (0 = image fixe). Une carte pub est fixe, un tournage bouge."""
    import numpy as np
    from PIL import Image
    prev = None
    out: list[float] = []
    for fp in frames:
        try:
            with Image.open(fp) as im:
                a = np.asarray(im.convert("L").resize((96, 54)), dtype=np.float32)
        except Exception:
            a = None
        out.append(0.0 if prev is None or a is None else float(np.abs(a - prev).mean()))
        if a is not None:
            prev = a
    return out


def _runs(flags: list[bool]) -> list[tuple[int, int]]:
    runs, start = [], None
    for i, f in enumerate(flags + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            runs.append((start, i))
            start = None
    return runs


LETTER = {"ad": "a", "outdoor": "o", "car": "c", "indoor": "i", "intimate": "n"}


def segment(frames: list[Path], scanned_seconds: float, fps: int = 1) -> dict:
    """Segments (secondes absolues, images à 1/s) au même format que la réponse Gemini de passe 1.

    Règles :
    - intro = tout ce qui précède la première image « dehors » (cartes pub, logos, plans d'intérieur d'ouverture) ;
    - carte pub au milieu = ≥ 2 s d'images classées « pub » où la rue n'est presque pas visible (p(dehors) < 0,2),
      ce qui distingue une carte d'un tournage de rue avec du texte incrusté ;
    - intime : estimation locale de repli (6 s bien marquées) ; la vraie frontière est demandée à Gemini sur la fin
      du clip (planche de la dernière minute, modèle léger, ~0,01 centime) ; nudenet reste le garde-fou.
    """
    items = classify(frames)
    raw = [it["cls"] for it in items]
    cls = _smooth(raw)
    n = len(cls)
    p_out = [it["probs"]["outdoor"] for it in items]
    p_ad = [it["probs"]["ad"] for it in items]
    first_out = next((i for i in range(n) if cls[i] == "outdoor"), None)
    intro_end = first_out if first_out is not None else 0
    card = [i >= intro_end and p_ad[i] >= 0.6 and p_out[i] < 0.15 for i in range(n)]  # carte "pure" : rue quasi invisible
    ads = [(a, b) for a, b in _runs(card) if b - a >= 2]
    outdoor = []
    for a, b in _runs([c == "outdoor" for c in cls]):
        if outdoor:
            ga, gb = outdoor[-1][1], a
            gap = cls[ga:gb]
            indoor_run = max((len(x) for x in "".join("i" if c == "indoor" else "." for c in gap).split(".")), default=0)
            if gb - ga <= 20 and indoor_run < 5:
                outdoor[-1] = (outdoor[-1][0], b)
                continue
        outdoor.append((a, b))
    outdoor = [(a, b) for a, b in outdoor if b - a >= 5]
    # estimation locale de repli seulement (CLIP confond gros plans et intimité) : 6 s consécutives bien marquées
    intimate = next((a for a, b in _runs([cls[i] == "intimate" and items[i]["probs"]["intimate"] >= 0.7 and i >= intro_end for i in range(n)]) if b - a >= 6), None)
    is_pickup = any(b - a >= 15 for a, b in outdoor)
    letters = "".join(("A" if card[i] else LETTER[c]) for i, c in enumerate(cls))
    return {
        "intro_end": float(intro_end) / fps,
        "ad_segments": [{"start": a / fps, "end": b / fps} for a, b in ads],
        "outdoor_segments": [{"start": a / fps, "end": b / fps} for a, b in outdoor],
        "becomes_intimate_at": None if intimate is None else float(intimate) / fps,
        "is_street_pickup": is_pickup,
        "notes": "découpage local CLIP",
        "classes": letters,  # A=carte pub a=pub? o=dehors c=voiture i=intérieur n=intime, une lettre par seconde
        "_meta": {"model": "clip-vit-b-32-local", "prompt_tokens": 0, "output_tokens": 0},
    }


if __name__ == "__main__":  # test : python segment_local.py dossier_images/
    import sys, time
    logging.basicConfig(level=logging.INFO)
    fr = sorted(Path(sys.argv[1]).glob("f_*.jpg"))
    t = time.time()
    r = segment(fr, len(fr))
    print(round(time.time() - t, 1), "s")
    print(json.dumps({k: v for k, v in r.items() if k != "classes"}, ensure_ascii=False, indent=1))
    print(r["classes"])
