"""État du pipeline : une table SQLite `videos` (source de vérité, le Sheet en est un miroir)."""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from typing import Any, Iterator

import config

COLUMNS = [
    ("id", "TEXT PRIMARY KEY"),
    ("url", "TEXT UNIQUE NOT NULL"),
    ("site", "TEXT"),
    ("title", "TEXT"),
    ("description", "TEXT"),
    ("tags", "TEXT"),          # JSON list
    ("performers", "TEXT"),    # JSON list : interprètes listés sur la page
    ("uploader", "TEXT"),
    ("duration", "REAL"),      # secondes, vidéo source
    ("thumbnail_url", "TEXT"),
    ("comments", "TEXT"),      # JSON list de strings
    ("priority", "INTEGER DEFAULT 0"),  # ordre de traitement (titre prometteur d'abord)
    ("hint_country", "TEXT"),   # pays deviné par le pré-tri Gemini à partir du titre (avant tout téléchargement)
    ("hint_city", "TEXT"),
    ("hint_street", "REAL"),    # 0-1 : probabilité d'une vraie scène de rue d'après le titre
    ("hint_done", "INTEGER DEFAULT 0"),
    ("status", "TEXT NOT NULL DEFAULT 'new'"),
    ("error", "TEXT"),
    ("reject_reason", "TEXT"),
    ("nsfw_cut", "REAL"),      # première seconde explicite (nudenet), None si rien dans la fenêtre scannée
    ("safe_start", "REAL"),    # début de la fenêtre non sexuelle envoyée à Gemini (0 sauf intro explicite)
    ("safe_end", "REAL"),      # fin de cette fenêtre
    ("clip_start", "REAL"),    # début réel de safe.mp4 (image-clé ≤ safe_start), pour les aperçus
    ("cdn_hash", "TEXT"),      # identifiant du fichier vidéo sur le CDN (commun xvideos/xnxx) : dédoublonnage inter-sites
    ("segments_json", "TEXT"), # découpage local CLIP : {intro_end, ad_segments, outdoor_segments, intimate_at}
    ("gemini_json", "TEXT"),   # réponse brute de Gemini
    ("intro_end", "REAL"),
    ("intimate_at", "REAL"),
    ("actress", "TEXT"),
    ("actress_confidence", "REAL"),
    ("actress_photo", "TEXT"),   # nom du fichier portrait dans data/videos/<id>/clues/
    ("lat", "REAL"),
    ("lng", "REAL"),
    ("city", "TEXT"),
    ("country", "TEXT"),
    ("location_confidence", "REAL"),
    ("identifiable", "INTEGER"),
    ("clues", "TEXT"),
    ("clues_json", "TEXT"),
    ("skip_json", "TEXT"),
    ("spoilers_json", "TEXT"), # JSON [{t, text, names}] : texte incrusté révélant le lieu, lu par OCR     # JSON [[a, b], …] : cartes pub à couper, en secondes relatives au début du clip    # JSON list : indices localisés (texte, image, zone) pour l'écran de fin de manche
    ("start_s", "REAL"),
    ("end_s", "REAL"),
    ("filename", "TEXT"),
    ("clip_path", "TEXT"),
    ("best_frame", "REAL"),
    ("reviewed_at", "TEXT"),
    ("exported_at", "TEXT"),
    ("created_at", "TEXT"),
    ("updated_at", "TEXT"),
]
COLUMN_NAMES = [c for c, _ in COLUMNS]
JSON_COLUMNS = {"tags", "comments", "performers"}


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    config.ensure_dirs()
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init() -> None:
    with connect() as conn:
        cols = ", ".join(f"{name} {typ}" for name, typ in COLUMNS)
        conn.execute(f"CREATE TABLE IF NOT EXISTS videos ({cols})")
        existing = {r[1] for r in conn.execute("PRAGMA table_info(videos)")}
        for name, typ in COLUMNS:  # migrations légères : colonnes ajoutées plus tard
            if name not in existing:
                conn.execute(f"ALTER TABLE videos ADD COLUMN {name} {typ.replace('PRIMARY KEY', '').replace('UNIQUE', '')}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status)")
        conn.execute("CREATE TABLE IF NOT EXISTS known (url TEXT PRIMARY KEY, numeric_id TEXT, cdn_hash TEXT, source TEXT, fetched_at TEXT)")


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    d = dict(row)
    for c in JSON_COLUMNS:
        if d.get(c):
            try:
                d[c] = json.loads(d[c])
            except (TypeError, json.JSONDecodeError):
                d[c] = []
        else:
            d[c] = []
    return d


def _encode(fields: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in fields.items():
        if k not in COLUMN_NAMES:
            raise KeyError(f"colonne inconnue: {k}")
        if k in JSON_COLUMNS and not isinstance(v, str) and v is not None:
            v = json.dumps(v, ensure_ascii=False)
        if isinstance(v, bool):
            v = int(v)
        out[k] = v
    return out


def insert_if_new(video: dict[str, Any]) -> bool:
    """Insère une vidéo découverte. Retourne False si l'URL/id existait déjà."""
    fields = _encode(video)
    fields.setdefault("status", config.STATUS_NEW)
    fields["created_at"] = fields["updated_at"] = _now()
    cols = ", ".join(fields)
    marks = ", ".join("?" for _ in fields)
    with connect() as conn:
        cur = conn.execute(f"INSERT OR IGNORE INTO videos ({cols}) VALUES ({marks})", list(fields.values()))
        return cur.rowcount == 1


def update(video_id: str, **fields: Any) -> None:
    fields = _encode(fields)
    fields["updated_at"] = _now()
    sets = ", ".join(f"{k} = ?" for k in fields)
    with connect() as conn:
        conn.execute(f"UPDATE videos SET {sets} WHERE id = ?", [*fields.values(), video_id])


def get(video_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        return _row_to_dict(conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone())


def get_by_url(url: str) -> dict[str, Any] | None:
    with connect() as conn:
        return _row_to_dict(conn.execute("SELECT * FROM videos WHERE url = ?", (url,)).fetchone())


def list_videos(status: str | list[str] | None = None, limit: int | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM videos"
    params: list[Any] = []
    if status:
        statuses = [status] if isinstance(status, str) else list(status)
        sql += " WHERE status IN (" + ", ".join("?" for _ in statuses) + ")"
        params += statuses
    sql += " ORDER BY COALESCE(priority, 0) DESC, created_at ASC, id ASC"
    if limit:
        sql += " LIMIT ?"
        params.append(limit)
    with connect() as conn:
        return [_row_to_dict(r) for r in conn.execute(sql, params).fetchall()]


def counts() -> dict[str, int]:
    with connect() as conn:
        rows = conn.execute("SELECT status, COUNT(*) AS n FROM videos GROUP BY status ORDER BY status").fetchall()
    return {r["status"]: r["n"] for r in rows}


def known_get(url: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM known WHERE url = ?", (url,)).fetchone()
    return dict(row) if row else None


def known_put(url: str, numeric_id: str | None, cdn_hash: str | None, source: str) -> None:
    with connect() as conn:
        conn.execute("INSERT OR REPLACE INTO known (url, numeric_id, cdn_hash, source, fetched_at) VALUES (?, ?, ?, ?, ?)",
                     (url, numeric_id, cdn_hash, source, _now()))


def known_ids() -> tuple[set[str], set[str]]:
    """(numéros de vidéo, hash CDN) de tout ce qui est déjà dans le jeu ou dans le Sheet."""
    with connect() as conn:
        rows = conn.execute("SELECT numeric_id, cdn_hash FROM known").fetchall()
    return {r["numeric_id"] for r in rows if r["numeric_id"]}, {r["cdn_hash"] for r in rows if r["cdn_hash"]}


def filename_taken(filename: str, except_id: str | None = None) -> bool:
    with connect() as conn:
        row = conn.execute(
            "SELECT id FROM videos WHERE filename = ? AND id != ?", (filename, except_id or "")
        ).fetchone()
    return row is not None
