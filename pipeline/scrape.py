"""Recherche xvideos, métadonnées d'une page vidéo, commentaires, téléchargement de la source."""
from __future__ import annotations

import html
import json
import logging
import re
import subprocess
from pathlib import Path
from urllib.parse import quote_plus, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

import config

log = logging.getLogger("scrape")

_session: requests.Session | None = None


def session() -> requests.Session:
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers.update({
            "User-Agent": config.USER_AGENT,
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        })
    return _session


def site_root(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def site_key(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if "xnxx" in host:
        return "xn"
    if "xvideos" in host:
        return "xv"
    return re.sub(r"[^a-z0-9]", "", host)[:6] or "web"


def parse_duration(text: str | None) -> int | None:
    """'8 min' / '36min' / '1 h 2 min' / '45 sec' / 'PT00H08M00S' -> secondes."""
    if not text:
        return None
    t = text.strip().lower()
    m = re.match(r"pt(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$", t)
    if m:
        h, mi, s = (int(x) if x else 0 for x in m.groups())
        return h * 3600 + mi * 60 + s
    total = 0
    found = False
    for value, unit in re.findall(r"(\d+)\s*(h|min|sec|s)\b", t):
        found = True
        v = int(value)
        total += v * 3600 if unit == "h" else v * 60 if unit == "min" else v
    return total if found else None


# ---------------------------------------------------------------- recherche --

def search(query: str, page: int, site: str = config.SEARCH_SITE) -> list[dict]:
    """Une page de résultats de recherche xvideos/xnxx -> [{url, title, duration, data_id}]."""
    if "xnxx" in site:
        url = f"{site}/search/{quote_plus(query)}/{page}"
    else:
        url = f"{site}/?k={quote_plus(query)}&durf=10min_more&p={page}"  # xvideos ne renvoie que les vidéos ≥ 10 min
    r = session().get(url, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    results: list[dict] = []
    for block in soup.select("div.thumb-block"):
        a = block.select_one("p.title a[href]") or block.select_one("a[href^='/video']")
        if not a:
            continue
        href = a.get("href", "")
        if not href.startswith("/video"):
            continue
        title = a.get("title") or a.get_text(" ", strip=True)
        dur_el = block.select_one("span.duration") or block.select_one("p.metadata")
        up_el = block.select_one("p.metadata a.name") or block.select_one("p.metadata a")
        results.append({
            "url": urljoin(site, href.split("?")[0]),
            "title": html.unescape(title or "").strip(),
            "duration": parse_duration(dur_el.get_text(" ", strip=True) if dur_el else None),
            "data_id": block.get("data-id"),
            "uploader": html.unescape(up_el.get_text(" ", strip=True)).strip() if up_el else None,
        })
    return results


# ------------------------------------------------------------- page vidéo --

def _ld_json(page: str) -> dict:
    m = re.search(r'<script type="application/ld\+json">\s*(\{.*?\})\s*</script>', page, re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return {}


def fetch_video_page(url: str) -> dict:
    """Métadonnées d'une page xvideos/xnxx (titre, description, tags, uploader, durée, mp4 direct)."""
    r = session().get(url, timeout=30)
    r.raise_for_status()
    page = r.text
    ld = _ld_json(page)

    numeric = re.search(r'"id_video":(\d+)', page)
    if not numeric:
        raise ValueError("id_video introuvable dans la page (page bloquée ou structure changée)")
    numeric_id = numeric.group(1)

    title = ld.get("name") or ""
    if not title:
        m = re.search(r"setVideoTitle\('([^']*)'\)", page)
        title = m.group(1) if m else ""
    description = ld.get("description") or ""
    if not description:
        m = re.search(r'<meta name="description" content="([^"]*)"', page)
        description = m.group(1) if m else ""

    uploader = None
    m = re.search(r"setUploaderName\('([^']*)'\)", page) or re.search(r'"uploader":"([^"]+)"', page)
    if m:
        uploader = html.unescape(m.group(1))

    tags: list[str] = []
    m = re.search(r'"video_tags":(\[[^\]]*\])', page)
    if m:
        try:
            tags = json.loads(m.group(1))
        except json.JSONDecodeError:
            tags = []

    content_url = None
    for key in ("setVideoUrlHigh", "setVideoUrlLow"):
        m = re.search(key + r"\('([^']+)'\)", page)
        if m:
            content_url = html.unescape(m.group(1))
            break
    if not content_url and ld.get("contentUrl"):
        content_url = html.unescape(ld["contentUrl"])
    hls_url = None
    m = re.search(r"setVideoHLS\('([^']+)'\)", page)
    if m:
        hls_url = html.unescape(m.group(1))

    performers: list[str] = []
    for a in re.finditer(r'<a href="/(?:pornstars|models)/[^"]+"[^>]*class="[^"]*profile[^"]*"[^>]*>(.*?)</a>', page, re.S):
        name = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", a.group(1)))).strip()
        name = re.sub(r"\s+\d+(?:[.,]\d+)?[kKmM]?$", "", name).strip()  # "Sky Rodgers 4k" -> "Sky Rodgers"
        if name and name not in performers:
            performers.append(name)

    thumb = ld.get("thumbnailUrl")
    if isinstance(thumb, list):
        thumb = thumb[0] if thumb else None
    if not thumb:
        m = re.search(r"setThumbUrl169\('([^']+)'\)", page) or re.search(r"setThumbUrl\('([^']+)'\)", page)
        thumb = m.group(1) if m else None

    cdn_hash = None
    m = re.search(r"-cdn\.com/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", page)
    if m:
        cdn_hash = m.group(1)

    return {
        "cdn_hash": cdn_hash,
        "id": f"{site_key(r.url)}{numeric_id}",
        "numeric_id": numeric_id,
        "url": r.url.split("?")[0],
        "site": site_root(r.url),
        "title": html.unescape(title).strip(),
        "description": html.unescape(description).strip(),
        "tags": tags,
        "performers": performers,
        "uploader": uploader,
        "duration": parse_duration(ld.get("duration")),
        "thumbnail_url": thumb,
        "content_url": content_url,
        "hls_url": hls_url,
        "upload_date": ld.get("uploadDate"),
    }


def _strip_html(text) -> str:
    if not isinstance(text, str):  # certains commentaires arrivent sous forme de dict/list
        text = json.dumps(text, ensure_ascii=False) if isinstance(text, (dict, list)) else str(text or "")
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text))).strip()


def fetch_comments(site: str, numeric_id: str, max_comments: int = 40) -> list[str]:
    """Commentaires "top" d'une vidéo (les commentaires donnent souvent le nom de l'actrice)."""
    url = f"{site}/threads/video-comments/get-posts/top/{numeric_id}/0/0"
    try:
        r = session().post(url, headers={"X-Requested-With": "XMLHttpRequest", "Referer": site + "/"}, timeout=30)
    except requests.RequestException as e:
        log.warning("commentaires: %s", e)
        return []
    if not r.ok or "json" not in r.headers.get("content-type", ""):
        return []
    try:
        data = r.json()
    except ValueError:
        return []
    posts = data.get("posts")
    if isinstance(posts, dict):
        posts = posts.get("posts", posts)
    if isinstance(posts, dict):
        posts = list(posts.values())
    if not isinstance(posts, list):
        return []

    out: list[str] = []

    def walk(items):
        for p in items:
            if not isinstance(p, dict):
                continue
            msg = _strip_html(p.get("message", ""))
            if msg:
                votes = p.get("votes") or {}
                nb = votes.get("nb") if isinstance(votes, dict) else None
                out.append(f"{p.get('name', '?')} (+{nb or 0}): {msg}")
            replies = p.get("replies")
            if isinstance(replies, dict):
                replies = replies.get("posts", replies)
            if isinstance(replies, dict):
                replies = list(replies.values())
            if isinstance(replies, list):
                walk(replies)

    walk(posts)
    return out[:max_comments]


# ----------------------------------------------------------- téléchargement --

def download_source(meta: dict, dest: Path, seconds: int | None = None) -> Path:
    """Télécharge la vidéo source (mp4 direct signé de la page, sinon yt-dlp).

    Avec `seconds`, seul le début est récupéré (ffmpeg lit le fichier en flux et s'arrête) : 5 fois moins de
    données, tout ce qui compte pour le jeu est dans les premières minutes.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    content_url = meta.get("content_url")
    if content_url and seconds:
        r = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-user_agent", config.USER_AGENT,
             "-headers", f"Referer: {meta['site']}/\r\n", "-i", content_url, "-t", str(seconds),
             "-c", "copy", "-movflags", "+faststart", str(dest)],
            capture_output=True, text=True,
        )
        if r.returncode == 0 and dest.exists() and dest.stat().st_size > 200_000:
            return dest
        log.warning("téléchargement partiel KO (%s), téléchargement complet", (r.stderr or "")[-160:].strip())
    if content_url:
        try:
            with session().get(content_url, headers={"Referer": meta["site"] + "/"}, stream=True, timeout=120) as r:
                r.raise_for_status()
                tmp = dest.with_suffix(".part")
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            if tmp.stat().st_size < 200_000:
                raise ValueError(f"fichier trop petit ({tmp.stat().st_size} octets)")
            tmp.rename(dest)
            return dest
        except (requests.RequestException, ValueError, OSError) as e:
            log.warning("mp4 direct KO (%s), essai yt-dlp", e)
    subprocess.run(
        [
            "yt-dlp", "--no-playlist", "--no-warnings",
            "-f", "bv*[height<=480]+ba/b[height<=480]/best",
            "--merge-output-format", "mp4",
            "-o", str(dest),
            meta["url"],
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    if not dest.exists():
        raise RuntimeError("yt-dlp n'a produit aucun fichier")
    return dest
