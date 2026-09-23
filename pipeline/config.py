"""Toute la configuration du pipeline (lue depuis pipeline/.env)."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", override=True)  # le fichier .env fait toujours foi


def _env(name: str, default=None, cast=str):
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return cast(value)


DATA_DIR = Path(_env("DATA_DIR", str(ROOT / "data")))
DB_PATH = DATA_DIR / "pipeline.sqlite"
VIDEOS_DIR = DATA_DIR / "videos"
CLIPS_DIR = DATA_DIR / "clips"
EXPORT_DIR = DATA_DIR / "export"

GEMINI_API_KEY = _env("GEMINI_API_KEY")
GEMINI_MODEL = _env("GEMINI_MODEL", "gemini-3.8-flash")                  # passe 2 : lieu + actrice
GEMINI_MODEL_SEGMENT = _env("GEMINI_MODEL_SEGMENT", GEMINI_MODEL)          # passe 1 : découpage (Flash-Lite rate les cartes pub, garder 3.8 Flash)
GEMINI_MEDIA_RESOLUTION = _env("GEMINI_MEDIA_RESOLUTION", "MEDIA_RESOLUTION_HIGH")  # images de la passe 2
GEMINI_THINKING_LEVEL = _env("GEMINI_THINKING_LEVEL", "LOW")               # MINIMAL | LOW | MEDIUM | HIGH
GEMINI_PRICE_INPUT_PER_M = _env("GEMINI_PRICE_INPUT_PER_M", 0.75, float)   # $ / million de tokens (pour l'estimation affichée)
GEMINI_PRICE_OUTPUT_PER_M = _env("GEMINI_PRICE_OUTPUT_PER_M", 3.75, float)
FRAME_STEP_SECONDS = _env("FRAME_STEP_SECONDS", 4, int)    # passe 1 : une image toutes les N s
LOCATE_FRAMES = _env("LOCATE_FRAMES", 6, int)              # passe 2 : nombre d'images pleine largeur
LOCATE_AUDIO_SECONDS = _env("LOCATE_AUDIO_SECONDS", 30, int)  # passe 2 : extrait audio (langue/accent), 0 = aucun

SHEET_ID = _env("SHEET_ID", "1VwF5sQOScyDzVDCkkPUUDvsZaQiDH4Fr55UDJbve2lw")
SHEET_TAB = _env("SHEET_TAB", "Pipeline")
# Méthode simple : script Apps Script déployé depuis le Sheet (URL .../exec) + jeton partagé
SHEET_WEBAPP_URL = _env("SHEET_WEBAPP_URL")
SHEET_WEBAPP_TOKEN = _env("SHEET_WEBAPP_TOKEN")
# Méthode alternative : compte de service Google
GOOGLE_SERVICE_ACCOUNT_JSON = Path(_env("GOOGLE_SERVICE_ACCOUNT_JSON", str(ROOT / "service-account.json")))
if not GOOGLE_SERVICE_ACCOUNT_JSON.is_absolute():
    GOOGLE_SERVICE_ACCOUNT_JSON = ROOT / GOOGLE_SERVICE_ACCOUNT_JSON

SEARCH_SITE = _env("SEARCH_SITE", "https://fr.xvideos.com").rstrip("/")
# Requêtes de recherche. Mesuré le 2026-09-23 sur 49 vidéos : les requêtes « pickup + nationalité » ramènent German
# Scout ou de l'amateur en intérieur (1 gardée sur 26) ; la famille « vlog / voyage » donne 1 gardée sur 3, dans des
# villes du monde entier. 2e test (32 vidéos) : sightseeing 2/2, vlog / travel vlog / vlog voyage / tourist 1/2 chacune,
# trip / vacances / holiday / airbnb / hotel balcony / road trip / walking in the city / viaje / viagem / reise 0/18.
# D'où ce défaut : pick up + les 6 requêtes voyage productives.
_WORLD = "pick up street,public pickup,street casting,nanpa japanese street,thai street pickup,bangkok pickup,filipina pickup street,pinay pickup,latina calle pickup,colombiana calle,mexicana calle pickup,brasileira rua,argentina calle,chilena calle,peruana calle,russian pickup street,ukrainian street pickup,polish street pickup,hungarian street pickup,romanian street pickup,bulgarian street,serbian street,italian strada pickup,spanish calle pickup,portuguese rua,turkish sokak,greek street pickup,indian street pickup,indonesian street,vietnamese street pickup,korean street pickup,chinese street pickup,malaysian street,arab street pickup,moroccan street,egyptian street,south african street pickup,nigerian street,australian street pickup,canadian street pickup,new york street pickup,miami street pickup,los angeles street pickup,texas street pickup,london street pickup,paris drague rue,dutch street pickup,belgian street,swedish street pickup,finnish street,german scout,public agent,czech streets"
SEARCH_QUERIES = [q.strip() for q in _env("SEARCH_QUERIES", "pick up,vlog,travel vlog,vlog voyage,sightseeing,tourist,city tour").split(",") if q.strip()]
MAX_NEW_PER_QUERY = _env("MAX_NEW_PER_QUERY", 60, int)
DOWNLOAD_SECONDS = _env("DOWNLOAD_SECONDS", 540, int)     # on ne télécharge que le début (fenêtre scannée + marge)
WORKERS = _env("WORKERS", 3, int)                         # vidéos traitées en parallèle
STUDIO_SATURATION = _env("STUDIO_SATURATION", 3, int)     # un uploader déjà présent N fois (à valider/validées) passe en fin de file
MAX_PER_COUNTRY = _env("MAX_PER_COUNTRY", 0, int)         # 0 = pas de quota ; sinon au-delà de N vidéos d'un pays -> rejet "quota"
PREFILTER = _env("PREFILTER", "1") == "1"                 # pré-filtre "lieu reconnaissable ?" par le modèle léger avant le modèle complet
GEMINI_MODEL_PREFILTER = _env("GEMINI_MODEL_PREFILTER", "gemini-3.5-flash-lite")
PREFILTER_MIN = _env("PREFILTER_MIN", 0.25, float)        # en dessous de cette confiance "pays reconnaissable", rejet sans appel complet
LOCAL_SEGMENT = _env("LOCAL_SEGMENT", "1") == "1"
OCR_SPOILERS = _env("OCR_SPOILERS", "1") == "1"           # lit le texte incrusté des vidéos gardées : nom du lieu à l'écran = début décalé / coupe         # découpage (pub / dehors / intérieur / intime) par CLIP en local, sinon Gemini

# Priorité de traitement (0 = neutre) : studios connus pour leurs vraies scènes de rue, villes/pays dans le titre
PRIORITY_STUDIOS = [s.strip().lower() for s in _env("PRIORITY_STUDIOS", "german scout,scout allemand,public agent,czech streets,street casting,erocom,mofozo,public pickups,deutschland report,fake agent,czech bitch,street").split(",") if s.strip()]
PRIORITY_PLACES = [s.strip().lower() for s in _env("PRIORITY_PLACES", "berlin,hamburg,hambourg,munich,münchen,cologne,köln,frankfurt,francfort,prague,praha,budapest,vienne,wien,vienna,paris,london,londres,barcelona,barcelone,madrid,lisbon,lisbonne,rome,roma,milan,milano,amsterdam,varsovie,warsaw,bratislava,tokyo,bangkok,pattaya,manila,new york,los angeles,miami,allemand,allemande,german,tchèque,czech,hongrois,hungarian,espagnol,spanish,italien,italian,français,french,japonais,japanese,thai,russe,russian,polonais,polish").split(",") if s.strip()]

SEARCH_PAGES = _env("SEARCH_PAGES", 3, int)
MIN_SOURCE_DURATION = _env("MIN_SOURCE_DURATION", 600, int)

SCAN_SECONDS = _env("SCAN_SECONDS", 480, int)
NSFW_THRESHOLD = _env("NSFW_THRESHOLD", 0.45, float)
NSFW_CONSECUTIVE = _env("NSFW_CONSECUTIVE", 2, int)
SAFETY_MARGIN = _env("SAFETY_MARGIN", 4, int)
MIN_CLIP_SECONDS = _env("MIN_CLIP_SECONDS", 30, int)
MAX_CLIP_SECONDS = _env("MAX_CLIP_SECONDS", 240, int)
MIN_LOCATION_CONFIDENCE = _env("MIN_LOCATION_CONFIDENCE", 0.6, float)
KEEP_SOURCE = _env("KEEP_SOURCE", "0") == "1"

SUPABASE_URL = _env("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = _env("SUPABASE_SERVICE_ROLE_KEY")

DASHBOARD_PORT = _env("DASHBOARD_PORT", 8765, int)

# Cloudflare R2 (mêmes valeurs que .env.local de l'app) : repasse « indices + portraits » sur les vidéos déjà en ligne
R2_ACCESS_KEY_ID = _env("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = _env("R2_SECRET_ACCESS_KEY")
R2_ENDPOINT = _env("R2_ENDPOINT")
R2_BUCKET = _env("R2_BUCKET")
R2_PUBLIC_URL = (_env("R2_PUBLIC_URL") or "").rstrip("/")


def app_env_file() -> Path | None:
    """Le .env.local de l'app (clés R2 + Supabase) pour scripts/add-video.mjs : dépôt, puis dossier parent."""
    for p in (ROOT.parent / ".env.local", ROOT.parent.parent / ".env.local"):
        if p.exists():
            return p
    return None

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)

# Statuts d'une vidéo dans la base locale
STATUS_NEW = "new"                    # trouvée, pas encore traitée
STATUS_TO_REVIEW = "to_review"        # Gemini a répondu, en attente de validation humaine
STATUS_APPROVED = "approved"          # validée dans le dashboard, clip final découpé
STATUS_REJECTED = "rejected"          # rejetée à la main
STATUS_REJECTED_AUTO = "rejected_auto"  # rejetée automatiquement (lieu non identifiable, trop court, sexuel dès le début…)
STATUS_ERROR = "error"                # erreur technique, relançable avec --retry-errors
STATUS_EXPORTED = "exported"          # présente dans un entries.json envoyé à add-video.mjs


def ensure_dirs() -> None:
    for d in (DATA_DIR, VIDEOS_DIR, CLIPS_DIR, EXPORT_DIR):
        d.mkdir(parents=True, exist_ok=True)


def fmt_ts(seconds: float | None) -> str:
    """12.0 -> '00:00:12' (format des colonnes début/fin du Sheet)."""
    if seconds is None:
        return ""
    s = int(round(seconds))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def parse_ts(text: str | float | int | None) -> float | None:
    """'01:15' / '00:01:15' / 75 -> 75.0. None si vide."""
    if text is None or text == "":
        return None
    if isinstance(text, (int, float)):
        return float(text)
    parts = [p.strip() for p in str(text).strip().split(":")]
    try:
        total = 0.0
        for p in parts:
            total = total * 60 + float(p)
        return total
    except ValueError:
        return None
