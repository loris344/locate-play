"""Deux appels Gemini par vidéo, sur des IMAGES FIXES déjà filtrées par nudenet (jamais de contenu explicite,
et 10 à 20 fois moins de tokens qu'en envoyant la vidéo) :

1. `segment()` — planches-contact horodatées de toute la fenêtre sûre : fin de l'intro studio, segments
   EXTÉRIEURS, premier moment intime, est-ce bien une drague de rue.
2. `locate()`  — quelques images pleine largeur de la partie extérieure + un extrait audio : lieu (lat/lng,
   confiance, indices), nom de l'actrice (titre / description / tags / commentaires), meilleure image.
Les horodatages sont imprimés sur les images (temps de la vidéo source) ; Gemini répond avec ces valeurs.
"""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Optional

from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field

import config

log = logging.getLogger("gemini")


class GeminiBlocked(Exception):
    """Gemini a refusé le contenu (filtre de sécurité) : on rejette la vidéo."""


class Segment(BaseModel):
    start: str = Field(description="MM:SS imprimé sur l'image")
    end: str = Field(description="MM:SS imprimé sur l'image")


class Segmentation(BaseModel):
    intro_end: str = Field(description="MM:SS de la première image de vrai tournage (après logos/écrans studio/pubs)")
    ad_segments: list[Segment] = Field(default_factory=list, description="Cartes pub/logo studio insérées plus tard dans le tournage (début = 1re image de la carte, fin = 1re image réelle après)")
    outdoor_segments: list[Segment] = Field(description="Passages filmés dehors dans un lieu public réel")
    becomes_intimate_at: Optional[str] = Field(default=None, description="MM:SS du premier moment intime, ou null")
    is_street_pickup: bool = Field(description="Quelqu'un est abordé / dragué dans un lieu public")
    notes: str = Field(description="1 phrase en français pour le relecteur")


class Clue(BaseModel):
    text: str = Field(description="The clue AND what it reveals, in English (e.g. “‘Terminál 1’ sign: the accented á only exists in Czech → Czech Republic”)")
    image_index: Optional[int] = Field(default=None, description="Numéro de l'image jointe (1 = première) où l'indice est visible ; null pour un indice audio/général")
    box_2d: Optional[list[int]] = Field(default=None, description="[ymin, xmin, ymax, xmax] sur une échelle 0-1000 de cette image, serré autour de l'élément ; null si pas d'image")


class Location(BaseModel):
    country: Optional[str] = Field(default=None, description="Country name in English")
    city: Optional[str] = Field(default=None, description="City name in English")
    area: Optional[str] = Field(default=None, description="Quartier / rue / lieu précis si reconnu")
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    confidence: float = Field(description="0-1 : probabilité qu'un bon joueur GeoGuessr trouve la ville")
    identifiable: bool
    clues: list[Clue] = Field(description="Indices visuels concrets, chacun localisé dans une image")
    reasoning: str = Field(description="Raisonnement court, en français")


class Actress(BaseModel):
    name: Optional[str] = None
    confidence: float
    evidence: str = Field(description="D'où vient le nom (titre, commentaire de X…)")


class WomanBox(BaseModel):
    image_index: int = Field(description="Numéro de l'image jointe où la femme est le mieux visible (visage net, de face)")
    box_2d: list[int] = Field(description="[ymin, xmin, ymax, xmax] 0-1000 sur cette image, autour de son visage et ses épaules")


class Localisation(BaseModel):
    location: Location
    giveaway_names: list[str] = Field(default_factory=list, description="Names which, if written on screen, would give the answer away: city, country, district, landmarks, in English AND in the local language/script (e.g. Athens, Αθήνα, Greece, Ελλάδα, Acropolis, Plaka)")
    woman: Optional[WomanBox] = Field(default=None, description="null si aucune image ne montre clairement la femme")
    best_frame: str = Field(description="MM:SS imprimé sur l'image la plus riche en indices de lieu")
    notes: str = Field(description="1-2 phrases en français pour le relecteur")


SEGMENT_PROMPT = """You are preparing rounds for a GeoGuessr-style game.
The attached images are contact sheets of consecutive frames (read left to right, then top to bottom) from the OPENING of a "street pickup" video: someone is approached and chatted up in a public place. Frames after anything not suitable for a general audience were already removed. Each frame has its timestamp (MM:SS of the original video) printed under it; the opening is sampled more densely (every 2 s) than the rest (every {step} s). Use ONLY these printed timestamps in your answer.
{sheets}

Players will later watch only the part filmed outdoors and guess where it was filmed. Return:
1. intro_end: the printed timestamp of the FIRST frame that is real footage. Studio logos, title cards, disclaimer screens, sponsor/promo cards (e.g. a studio name with a slogan and a model posing) are NOT real footage: if the very first frame is such a card, intro_end is the timestamp of the next real frame. "{first}" only if the first frame is already real footage.
1b. ad_segments: the same kind of promo/logo cards when they appear LATER, inserted inside the footage (interstitials): for each, start = timestamp of its first frame, end = timestamp of the first real frame after it. Burned-in watermarks or banners over real footage do not count. Empty list if none.
2. outdoor_segments: list of {{start, end}} where the frames show a real OUTDOOR public place (street, square, park, beach, parking lot, terrace, bus stop, station...). A car interior, a hallway, a staircase inside a building or a flat are NOT outdoors. Merge segments separated by a single frame; ignore segments of a single frame. Empty list if none.
3. becomes_intimate_at: timestamp of the FIRST frame that is no longer suitable for a general audience (kissing, intimate touching, undressing, lingerie, nudity). null if it never happens. Be conservative: when unsure, choose the earlier frame.
4. is_street_pickup: true if someone is approached / chatted up in a public place.
5. notes: one sentence in French for the human reviewer.

Original video title: {title}
"""

LOCATE_PROMPT = """You are preparing rounds for a GeoGuessr-style game.
The attached images are frames (timestamp of the original video printed above each one) from the outdoor opening of a video: a person is approached and chatted up in a public place. {audio_note}
Players will watch this part and must guess WHERE it was filmed, so we only keep clips whose setting is recognisable.

Return:
1. location: where this footage was filmed.
   - Use every clue: street signs, shop names, posters, language of written text and of the dialogue (accents too), licence plates, phone number formats, currency, architecture, road markings, bollards, bins, vegetation, climate, landmarks, bus/tram/taxi liveries.
   - latitude/longitude: as precise as possible (the exact street if you recognise it, otherwise the city centre).
   - confidence: 0-1 that a good GeoGuessr player could name the CITY from the visuals alone.
   - identifiable: true ONLY if the visuals contain enough clues to identify at least the city. A plain beach, a field, a forest, a generic apartment block or an anonymous parking lot is NOT identifiable.
   - clues: 2 to 5 clues, shown to ENGLISH-SPEAKING players after they guess (GeoGuessr-style breakdown), so write them in English. Each clue text must name the concrete element AND explain what it reveals and why, e.g. “‘Terminál 1’ sign: the accented á only exists in Czech and Slovak → Czech Republic” or “White licence plate with a blue EU strip and ‘CZ’ → Czech Republic” or “Berlin TV tower visible in the background → Alexanderplatz”. Prefer clues that pin the COUNTRY or the CITY (language and diacritics on signs, licence plates, phone prefixes, currency, country-specific brands and chains, bus/taxi/police liveries, landmarks, street furniture typical of one country) over generic ones (an airport, a bus shelter, a parking sign). For a visual clue give the image number (1 = first attached image; each attached image stacks two frames, one above the other) and a tight bounding box [ymin, xmin, ymax, xmax] on a 0-1000 scale of that whole attached image: it must be really visible there, players will see a zoom on it. A clue heard in the audio (language spoken, accent, a place named in the dialogue) is welcome as a text-only clue: image_index null, box_2d null.
   - country and city in English (this is what players see); reasoning in French.
2. giveaway_names: every name that would give the answer away if it appeared as on-screen text (city, country, region, district, landmarks, well-known streets), in English and in the local language.
3. woman: the attached image where the woman being chatted up is best visible (face clearly visible, ideally facing the camera, fully clothed) and a box [ymin, xmin, ymax, xmax] (0-1000 of that whole attached image) around her face and shoulders: it becomes her portrait in the game ("Find X"). null if no image shows her clearly.
4. best_frame: the printed timestamp of the frame with the most location clues (one of: {times}).
5. notes: 1-2 sentences in French for the human reviewer.
"""

ACTRESS_PROMPT = """Below are the title, description, channel, tags and some viewer comments of an online video. Sensitive words were replaced by "…".
Identify the stage name of the woman appearing in the video. Where it usually is:
- in the title, e.g. "… avec Mea Melone …", "… with Kristall …", "(Ivana Sugar)", "- Carolina -";
- in the tags, as a hyphenated "firstname-lastname" tag (see the candidate list below; a male performer may also be listed);
- in the comments: "who is she?" answered with a name, "she is X", "c'est X", "it's X from …".
Return the name exactly as written (capitalised). Never return a studio, channel or series name (German Scout, Public Agent, Mofos…), only a person's stage name. Return null if no name appears anywhere; never invent one. Evidence in French.

Title: {title}
Description: {description}
Channel: {uploader}
Performers listed on the video page (men and women, the answer must be one of them if this list is not empty): {performers}
Tags: {tags}
Candidate names found in the tags: {candidates}
Comments:
{comments}
"""

# Mots qui déclenchent le blocage "PROHIBITED_CONTENT" de Gemini (sexuel + famille + âge) : remplacés par "…"
# avant l'appel texte. Les noms propres (l'info qu'on cherche) ne sont pas touchés.
_BLOCK_WORDS = r"""
bais\w* fuck\w* suc\w* bite cock\w* dick\w* pussy chatte anal\w* cum\w* sperm\w* blowjob pipe sex\w* porn\w* xxx
salope slut\w* whore\w* pute orgasm\w* hardcore gangbang creampie facial squirt\w* sodom\w* encul\w* niqu\w* pound\w*
bang\w* doggy\w* tits seins boobs nichons ass cul butt fesses nue nues nude naked horny hot milf cougar bbw teen\w* ado
ados 18 young jeune jeunes girl girls fille filles schoolgirl écolière ecoliere petite lolita daddy stepmom stepdad stepsister
stepbrother mom mommy maman mère mere mother son fils sister sœur soeur brother frère frere daughter family famille incest\w*
rape\w* viol\w* forced drunk ivre sleep\w* dormir kid kids child children enfant enfants boy boys garçon garcon
"""
_BLOCK_RE = re.compile(r"\b(?:" + "|".join(_BLOCK_WORDS.split()) + r")\b", re.IGNORECASE)
_NAME_HINT_RE = re.compile(r"(?-i:[A-Z][a-zé]+ [A-Z][a-zé]+)|\bname\b|\bnom\b|who is|who's|qui est|c'est|she is|she's|elle s'appelle|called|appelle", re.IGNORECASE)


def sanitize(text: str | None) -> str:
    return _BLOCK_RE.sub("…", text or "").strip()


def _client() -> genai.Client:
    if not config.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY manquant dans pipeline/.env")
    return genai.Client(api_key=config.GEMINI_API_KEY)


def _config(schema, media_resolution: str | None, thinking: str | None) -> types.GenerateContentConfig:
    kwargs = dict(
        response_mime_type="application/json",
        response_schema=schema,
        temperature=0.2,
        safety_settings=[
            types.SafetySetting(category=cat, threshold=types.HarmBlockThreshold.BLOCK_ONLY_HIGH)
            for cat in (
                types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                types.HarmCategory.HARM_CATEGORY_HARASSMENT,
                types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            )
        ],
    )
    if media_resolution:
        kwargs["media_resolution"] = media_resolution
    if thinking:
        kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=thinking)
    return types.GenerateContentConfig(**kwargs)


def _image_part(path: Path) -> types.Part:
    return types.Part.from_bytes(data=path.read_bytes(), mime_type="image/jpeg")


def _call(parts: list[types.Part], prompt: str, schema, media_resolution: str | None, model: str,
          thinking: str | None = None) -> dict:
    """Envoie images/audio + prompt ; retourne le JSON validé par `schema` + `_meta` (tokens)."""
    client = _client()
    thinking = thinking or config.GEMINI_THINKING_LEVEL
    response = None
    for attempt in range(5):
        try:
            response = client.models.generate_content(
                model=model, contents=[*parts, prompt], config=_config(schema, media_resolution, thinking)
            )
            break
        except errors.ClientError as e:
            msg = str(e).lower()
            if media_resolution and "media_resolution" in msg:  # option refusée par ce modèle
                media_resolution = None
                continue
            if thinking and "thinking" in msg:
                thinking = "LOW" if thinking != "LOW" else None  # MINIMAL refusé par 3.8 Flash -> LOW
                continue
            if e.code == 429 and attempt < 4:
                wait = 20 * (attempt + 1)
                log.warning("Gemini 429 (quota), nouvel essai dans %ss", wait)
                time.sleep(wait)
                continue
            raise
        except errors.ServerError as e:
            if attempt < 4:
                wait = 10 * (attempt + 1)
                log.warning("Gemini %s, nouvel essai dans %ss", e.code, wait)
                time.sleep(wait)
                continue
            raise
    if response is None:
        raise RuntimeError("Gemini : pas de réponse")

    feedback = getattr(response, "prompt_feedback", None)
    if feedback is not None and getattr(feedback, "block_reason", None):
        raise GeminiBlocked(f"prompt bloqué : {feedback.block_reason}")
    candidates = response.candidates or []
    if not candidates:
        raise GeminiBlocked("aucune réponse (candidats vides)")
    finish = getattr(candidates[0], "finish_reason", None)
    if finish is not None and finish.name in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"):
        raise GeminiBlocked(f"réponse bloquée : {finish.name}")

    parsed = response.parsed
    data = parsed.model_dump() if isinstance(parsed, schema) else schema.model_validate_json(response.text).model_dump()
    usage = getattr(response, "usage_metadata", None)
    data["_meta"] = {
        "model": model,
        "media_resolution": media_resolution,
        "thinking_level": thinking,
        "prompt_tokens": getattr(usage, "prompt_token_count", None),
        "output_tokens": getattr(usage, "candidates_token_count", None),
        "thoughts_tokens": getattr(usage, "thoughts_token_count", None),
    }
    return data


def _lbl(seconds: float) -> str:
    s = int(round(seconds))
    return f"{s // 60:02d}:{s % 60:02d}"


def segment(grids: list[dict], meta: dict) -> dict:
    """grids = [{path, times}] (frames.make_segment_grids)."""
    sheets = "\n".join(
        f"Image {i + 1}: {len(g['times'])} frames from {_lbl(g['times'][0])} to {_lbl(g['times'][-1])}."
        for i, g in enumerate(grids)
    )
    prompt = SEGMENT_PROMPT.format(step=config.FRAME_STEP_SECONDS, sheets=sheets,
                                   first=_lbl(grids[0]["times"][0]), title=meta.get("title") or "")
    parts = [_image_part(Path(g["path"])) for g in grids]
    return _call(parts, prompt, Segmentation, "MEDIA_RESOLUTION_LOW", config.GEMINI_MODEL_SEGMENT, thinking="MINIMAL")


def locate(images: list[Path], times: list[float], audio: Path | None) -> dict:
    """Lieu à partir des images (+ audio). Si Gemini bloque avec l'audio, on réessaie sans."""
    parts = [_image_part(p) for p in images]
    for with_audio in ((True, False) if audio else (False,)):
        prompt = LOCATE_PROMPT.format(
            audio_note="An audio excerpt of the dialogue is attached: the language and accents are clues." if with_audio else "",
            times=", ".join(_lbl(t) for t in times),
        )
        extra = [types.Part.from_bytes(data=audio.read_bytes(), mime_type="audio/mp3")] if with_audio else []
        try:
            data = _call(parts + extra, prompt, Localisation, config.GEMINI_MEDIA_RESOLUTION, config.GEMINI_MODEL)
            data["_meta"]["audio"] = with_audio
            return data
        except GeminiBlocked as e:
            if with_audio:
                log.warning("lieu bloqué avec l'audio (%s), nouvel essai images seules", e)
                continue
            raise
    raise GeminiBlocked("images seules bloquées")


def name_candidates(meta: dict) -> list[str]:
    """Noms probables lus sans IA : tags "prenom-nom" et motifs du titre ("avec X Y", "(X Y)", "- X Y -")."""
    out: list[str] = []
    for t in meta.get("tags") or []:
        parts = t.split("-")
        if 2 <= len(parts) <= 3 and all(p.isalpha() for p in parts) and not _BLOCK_RE.search(t):
            out.append(" ".join(p.capitalize() for p in parts))
    title = meta.get("title") or ""
    for pat in (r"(?:avec|with|feat\.?|ft\.?|starring|mit)\s+([A-Z][a-zà-ÿ]+(?:\s[A-Z][a-zà-ÿ]+)?)",
                r"\(([A-Z][a-zà-ÿ]+(?:\s[A-Z][a-zà-ÿ]+)?)\)",
                r"-\s*([A-Z][a-zà-ÿ]+\s[A-Z][a-zà-ÿ]+)\s*-"):
        for m in re.finditer(pat, title):
            if not _BLOCK_RE.search(m.group(1)):
                out.append(m.group(1))
    seen: set[str] = set()
    studios = set(config.PRIORITY_STUDIOS) | {"german scout", "public agent", "czech streets", "street casting", "mofos", "bangbros"}
    return [c for c in out if c.lower() not in studios and not (c.lower() in seen or seen.add(c.lower()))]


def actress(meta: dict) -> dict:
    """Nom de l'actrice : d'abord sans IA (interprète listée sur la page, tag prenom-nom repris dans le titre),
    sinon appel texte assaini (le modèle choisit la femme parmi les interprètes listés)."""
    studios = set(config.PRIORITY_STUDIOS) | {"german scout", "public agent", "czech streets", "street casting", "mofos", "bangbros"}
    performers = [p for p in (meta.get("performers") or []) if p and p.lower() not in studios]
    if len(performers) == 1:
        return {"name": performers[0], "confidence": 0.85, "evidence": "seule interprète listée sur la page xvideos", "_meta": None}
    candidates = name_candidates(meta)
    title_l = (meta.get("title") or "").lower()
    for c in performers + candidates:
        if c.lower() in title_l:
            return {"name": c, "confidence": 0.9, "evidence": f"« {c} » apparaît dans le titre" + (" et est listée sur la page" if c in performers else " et dans les tags"), "_meta": None}
    comments = [c for c in (meta.get("comments") or []) if _NAME_HINT_RE.search(c)][:15]
    tags = [t for t in (meta.get("tags") or []) if not _BLOCK_RE.search(t)][:20]
    prompt = ACTRESS_PROMPT.format(
        title=sanitize(meta.get("title")),
        description=sanitize((meta.get("description") or "")[:800]),
        uploader=sanitize(meta.get("uploader")),
        tags=", ".join(tags) or "(aucun)",
        performers=", ".join(performers) or "(aucun)",
        candidates=", ".join(candidates) or "(aucun)",
        comments="\n".join(f"- {sanitize(c)[:200]}" for c in comments) or "- (aucun)",
    )
    if not performers and not candidates and not comments:
        return {"name": None, "confidence": 0.0, "evidence": "aucun nom dans le titre, les tags, les interprètes ni les commentaires", "_meta": None}
    try:
        return _call([], prompt, Actress, None, config.GEMINI_MODEL, thinking="MINIMAL")  # ~400 tokens
    except GeminiBlocked as e:
        log.warning("actrice : métadonnées bloquées par Gemini (%s)", e)
        return {"name": None, "confidence": 0.0, "evidence": f"métadonnées bloquées par Gemini ({e})", "_meta": None}


class Prefilter(BaseModel):
    country: Optional[str] = Field(default=None, description="Pays le plus probable, en français, ou null")
    country_confidence: float = Field(description="0-1 : un bon joueur GeoGuessr pourrait-il nommer le PAYS à partir de ces images ?")
    city_confidence: float = Field(description="0-1 : idem pour la VILLE")
    reason: str = Field(description="Une phrase en français")


PREFILTER_PROMPT = """These frames come from the outdoor opening of a video (someone chatted up in a public place). Quick check only: from what is VISIBLE (signs, language, plates, architecture, vehicles, street furniture, landmarks), could a skilled GeoGuessr player name the COUNTRY, and the CITY? Anonymous places (plain beach, field, forest, generic parking lot, generic apartment block) score low. Answer in French for the reason.
"""


class TailCheck(BaseModel):
    becomes_intimate_at: Optional[str] = Field(default=None, description="MM:SS imprimé sous la première image intime, ou null")
    notes: str = Field(description="Une phrase en français")


TAIL_PROMPT = """The attached contact sheets show the LAST part of a clip (one frame every 2 seconds, timestamp printed under each frame, read left to right then top to bottom). The clip is the outdoor opening of a "street pickup" video and will be shown to a general audience; it must stop BEFORE anything intimate.
Return becomes_intimate_at: the printed timestamp of the FIRST frame that is no longer suitable for a general audience (kissing, intimate touching, undressing, lingerie, nudity, a bedroom scene starting). null if every frame is fine. When unsure, choose the earlier frame.
{sheets}
"""


def tail_check(grids: list[dict]) -> dict:
    """Frontière intime précise sur la fin du clip : planches en basse résolution, modèle léger, ~0,01 centime."""
    sheets = "\n".join(f"Image {i + 1}: frames {_lbl(g['times'][0])} to {_lbl(g['times'][-1])}." for i, g in enumerate(grids))
    parts = [_image_part(Path(g["path"])) for g in grids]
    return _call(parts, TAIL_PROMPT.format(sheets=sheets), TailCheck, "MEDIA_RESOLUTION_LOW", config.GEMINI_MODEL_PREFILTER, thinking="LOW")


LOCATE_KNOWN_PROMPT = """You are preparing the post-round breakdown of a GeoGuessr-style game.
The attached images are frames (timestamp printed above each one) from a clip filmed in {city}, {country} (latitude {lat}, longitude {lng}). This location is CERTAIN. {audio_note}
Return:
1. location: echo the known place (country and city in English, the given coordinates, confidence 1, identifiable true) and 2 to 5 clues that a player could have used to find it, in English, each naming a concrete VISIBLE element AND what it reveals (e.g. “‘Terminál 1’ sign: the accented á only exists in Czech → Czech Republic”). Prefer clues that pin the country or the city; give the attached image number (1 = first; each attached image stacks two frames) and a tight box [ymin, xmin, ymax, xmax] on a 0-1000 scale of that whole attached image. A clue heard in the audio (language, accent, place named) is welcome as a text-only clue (image_index null). Reasoning in French.
2. giveaway_names: names which, if written on screen, would give the answer away (city, country, district, landmarks), in English and in the local language.
3. woman: the attached image where the woman is best visible (face clearly visible, fully clothed) and a box around her face and shoulders, for her portrait; null if none.
4. best_frame: the printed timestamp of the frame with the most clues (one of: {times}).
5. notes: one sentence in French.
"""


def locate_known(images: list[Path], times: list[float], audio: Path | None, known: dict) -> dict:
    """Indices, noms révélateurs et portrait pour une vidéo dont le lieu est déjà certifié (repasse des vidéos en ligne)."""
    parts = [_image_part(p) for p in images]
    if audio:
        parts.append(types.Part.from_bytes(data=audio.read_bytes(), mime_type="audio/mp3"))
    prompt = LOCATE_KNOWN_PROMPT.format(
        city=known.get("city") or "?", country=known.get("country") or "?", lat=known.get("latitude"), lng=known.get("longitude"),
        audio_note="An audio excerpt is attached: the spoken language is a clue." if audio else "",
        times=", ".join(_lbl(t) for t in times),
    )
    return _call(parts, prompt, Localisation, config.GEMINI_MEDIA_RESOLUTION, config.GEMINI_MODEL)


def prefilter(images: list[Path]) -> dict:
    """Modèle léger, images en basse résolution, sans audio : « lieu reconnaissable ou pas ». ~0,1 centime."""
    parts = [_image_part(p) for p in images]
    return _call(parts, PREFILTER_PROMPT, Prefilter, "MEDIA_RESOLUTION_MEDIUM", config.GEMINI_MODEL_PREFILTER, thinking="LOW")


def cost_usd(*metas: dict | None) -> float | None:
    """Estimation $ à partir des tokens réellement facturés (prix dans .env)."""
    tin = tout = 0
    seen = False
    for m in metas:
        if not m:
            continue
        seen = True
        tin += m.get("prompt_tokens") or 0
        tout += (m.get("output_tokens") or 0) + (m.get("thoughts_tokens") or 0)
    if not seen:
        return None
    return tin * config.GEMINI_PRICE_INPUT_PER_M / 1e6 + tout * config.GEMINI_PRICE_OUTPUT_PER_M / 1e6


if __name__ == "__main__":  # test rapide : python gemini_analyze.py data/videos/<id>/grids/grid_01.jpg
    import sys
    logging.basicConfig(level=logging.INFO)
    grid = {"path": sys.argv[1], "times": [float(i * config.FRAME_STEP_SECONDS) for i in range(24)]}
    print(json.dumps(segment([grid], {"title": "test"}), ensure_ascii=False, indent=2))
