"""Salle de contrôle locale : python dashboard.py  ->  http://127.0.0.1:8765

Un bouton « Démarrer » lance le pipeline (run.py auto) en arrière-plan, le journal défile en direct, et
chaque vidéo traitée apparaît avec le passage retenu (frise), l'actrice, le lieu, la confiance, les indices.
On corrige / valide / rejette, puis « Exporter » produit l'entries.json pour add-video.mjs (R2 + Supabase).
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import threading
import time
import webbrowser
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

import config
import db
from run import make_filename

log = logging.getLogger("dashboard")
app = FastAPI(title="Locate Play — machine à contenu")

SHEET_URL = f"https://docs.google.com/spreadsheets/d/{config.SHEET_ID}/edit"


# ------------------------------------------------------------- job runner --

class Job:
    """Un seul run.py à la fois, sortie capturée ligne par ligne pour le journal en direct."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.proc: subprocess.Popen | None = None
        self.lines: list[str] = []
        self.base = 0  # index global de lines[0]
        self.kind: str | None = None
        self.started_at: float | None = None
        self.finished_at: float | None = None
        self.returncode: int | None = None
        self.current: dict | None = None

    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self, kind: str, args: list[str]) -> None:
        with self.lock:
            if self.running():
                raise RuntimeError("un traitement est déjà en cours")
            self.lines, self.base = [], 0
            self.kind, self.started_at, self.finished_at, self.returncode, self.current = kind, time.time(), None, None, None
            self.proc = subprocess.Popen(
                [sys.executable, "-u", str(config.ROOT / "run.py"), *args],
                cwd=config.ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
            )
            self._append(f"$ python run.py {' '.join(args)}")
        threading.Thread(target=self._pump, daemon=True).start()

    def _append(self, line: str) -> None:
        self.lines.append(line)
        if len(self.lines) > 3000:
            drop = len(self.lines) - 2000
            del self.lines[:drop]
            self.base += drop

    def _pump(self) -> None:
        assert self.proc and self.proc.stdout
        for raw in self.proc.stdout:
            line = raw.rstrip("\n")
            m = re.search(r"=== (\S+) — (.*)", line)
            if m:
                self.current = {"id": m.group(1), "title": m.group(2)}
            with self.lock:
                self._append(line)
        self.proc.wait()
        with self.lock:
            self.returncode = self.proc.returncode
            self.finished_at = time.time()
            self.current = None
            self._append(f"— terminé (code {self.returncode}) —")

    def stop(self) -> None:
        if self.running():
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def status(self, since: int) -> dict:
        with self.lock:
            start = max(since - self.base, 0)
            return {
                "running": self.running(),
                "kind": self.kind,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "returncode": self.returncode,
                "current": self.current,
                "next": self.base + len(self.lines),
                "lines": self.lines[start:] if since <= self.base + len(self.lines) else self.lines,
            }


job = Job()


class RunParams(BaseModel):
    limit: int = 5
    discover: bool = True
    pages: Optional[int] = None
    query: Optional[str] = None


class ExportParams(BaseModel):
    clips: bool = False


@app.post("/api/run")
def start_run(p: RunParams):
    args = ["auto" if p.discover else "process", "--limit", str(max(1, min(p.limit, 100))), "--retry-errors"]
    if p.discover and p.pages:
        args += ["--pages", str(p.pages)]
    if p.discover and p.query:
        args += ["--query", p.query]
    try:
        job.start("run", args)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return job.status(0)


@app.post("/api/export")
def start_export(p: ExportParams):
    args = ["export", "--push"] + (["--clips"] if p.clips else [])
    try:
        job.start("export", args)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return job.status(0)


@app.post("/api/run/stop")
def stop_run():
    job.stop()
    return {"ok": True}


@app.get("/api/run/status")
def run_status(since: int = 0):
    return job.status(since)


# ------------------------------------------------------------------ data --

class Patch(BaseModel):
    actress: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    city: Optional[str] = None
    country: Optional[str] = None
    start_s: Optional[float] = None
    end_s: Optional[float] = None
    reason: Optional[str] = None


def _public(v: dict[str, Any], with_gemini: bool = False) -> dict[str, Any]:
    d = config.VIDEOS_DIR / v["id"]
    out = dict(v)
    out["has_clip"] = (d / "safe.mp4").exists()
    out["has_thumb"] = (d / "thumb.jpg").exists()
    gemini = None
    if v.get("gemini_json"):
        try:
            gemini = json.loads(v["gemini_json"])
        except json.JSONDecodeError:
            gemini = None
    segments = []  # horodatages absolus (imprimés sur les images) ; fin + un pas d'échantillonnage
    for seg in (gemini or {}).get("outdoor_segments") or []:
        a, b = config.parse_ts(seg.get("start")), config.parse_ts(seg.get("end"))
        if a is not None and b is not None and b >= a:
            segments.append([a, b + config.FRAME_STEP_SECONDS])
    out["segments"] = segments
    try:
        out["clue_items"] = json.loads(v.get("clues_json") or "[]")
    except json.JSONDecodeError:
        out["clue_items"] = []
    out.pop("clues_json", None)
    if gemini:
        from gemini_analyze import cost_usd
        out["cost_usd"] = cost_usd(gemini.get("_meta_segment"), gemini.get("_meta_tail"), gemini.get("_meta_prefilter"), gemini.get("_meta_locate"), gemini.get("_meta_actress"))
    out["gemini"] = gemini if with_gemini else None
    out.pop("gemini_json", None)
    return out


def _apply_patch(v: dict, patch: Patch) -> dict:
    fields = {k: val for k, val in patch.model_dump().items() if val is not None and k != "reason"}
    if "actress" in fields:
        fields["actress"] = fields["actress"].strip() or None
    merged = {**v, **fields}
    if merged.get("lat") is not None and (fields.get("actress") is not None or fields.get("lat") is not None or not merged.get("filename")):
        fields["filename"] = make_filename(merged.get("actress"), float(merged["lat"]), v["id"])
    return fields


def _sheet_sync_bg() -> None:
    import sheet
    if not sheet.is_configured():
        return
    try:
        sheet.sync()
    except Exception as e:
        log.warning("Sheet : %s", e)


def _save_env(key: str, value: str) -> None:
    env_path = config.ROOT / ".env"
    text = env_path.read_text() if env_path.exists() else ""
    if re.search(rf"^{key}=.*$", text, re.M):
        text = re.sub(rf"^{key}=.*$", f"{key}={value}", text, flags=re.M)
    else:
        text += f"\n{key}={value}\n"
    env_path.write_text(text)
    os.environ[key] = value
    setattr(config, key, value)


def _sheet_token() -> str:
    if not config.SHEET_WEBAPP_TOKEN:
        import secrets
        _save_env("SHEET_WEBAPP_TOKEN", secrets.token_hex(12))
    return config.SHEET_WEBAPP_TOKEN


class WebappParams(BaseModel):
    url: str


@app.get("/api/config/sheet")
def sheet_setup():
    import sheet
    token = _sheet_token()
    return {"mode": sheet.mode(), "url": config.SHEET_WEBAPP_URL, "token": token,
            "script": sheet.apps_script(token), "sheet_url": SHEET_URL, "tab": config.SHEET_TAB}


@app.post("/api/config/sheet-webapp")
async def set_sheet_webapp(p: WebappParams):
    url = p.url.strip()
    if not re.match(r"^https://script\.google\.com/macros/s/[\w-]+/exec$", url):
        raise HTTPException(400, "l'URL doit ressembler à https://script.google.com/macros/s/…/exec (URL de l'application web)")
    _save_env("SHEET_WEBAPP_URL", url)
    _sheet_token()
    import sheet
    try:
        n = await run_in_threadpool(sheet.sync)
    except Exception as e:
        raise HTTPException(502, f"URL enregistrée mais la synchro échoue : {str(e)[:300]}")
    return {"ok": True, "rows": n}


class KeyParams(BaseModel):
    key: str


@app.post("/api/config/gemini-key")
def set_gemini_key(p: KeyParams):
    key = p.key.strip()
    if len(key) < 20 or " " in key:
        raise HTTPException(400, "clé invalide (elle ressemble à AIza… et fait ~39 caractères)")
    env_path = config.ROOT / ".env"
    text = env_path.read_text() if env_path.exists() else ""
    if re.search(r"^GEMINI_API_KEY=.*$", text, re.M):
        text = re.sub(r"^GEMINI_API_KEY=.*$", f"GEMINI_API_KEY={key}", text, flags=re.M)
    else:
        text += f"\nGEMINI_API_KEY={key}\n"
    env_path.write_text(text)
    config.GEMINI_API_KEY = key
    os.environ["GEMINI_API_KEY"] = key  # hérité par les run.py lancés depuis la page
    return {"ok": True}


@app.post("/api/config/gemini-test")
async def test_gemini():
    if not config.GEMINI_API_KEY:
        raise HTTPException(400, "pas de clé")

    def ping():
        from google import genai
        client = genai.Client(api_key=config.GEMINI_API_KEY)
        r = client.models.generate_content(model=config.GEMINI_MODEL_SEGMENT, contents="Réponds juste: ok")
        return (r.text or "").strip()[:40]

    try:
        text = await run_in_threadpool(ping)
    except Exception as e:
        raise HTTPException(502, f"Gemini répond une erreur : {str(e)[:300]}")
    return {"ok": True, "model": config.GEMINI_MODEL_SEGMENT, "text": text}


@app.post("/api/queue/clear")
def clear_queue():
    """Supprime les vidéos en attente (pas encore analysées) : la prochaine recherche repart de zéro, le reste est conservé."""
    with db.connect() as conn:
        n = conn.execute("DELETE FROM videos WHERE status = ?", (config.STATUS_NEW,)).rowcount
    return {"ok": True, "removed": n}


@app.post("/api/reset-all")
async def reset_all():
    """Efface toute la base locale (analyses, clips, indices) et vide l'onglet du Sheet. Irréversible."""
    import shutil
    job.stop()
    for sub in (config.VIDEOS_DIR, config.CLIPS_DIR, config.EXPORT_DIR):
        shutil.rmtree(sub, ignore_errors=True)
    with db.connect() as conn:
        conn.execute("DROP TABLE IF EXISTS videos")
    config.ensure_dirs()
    db.init()
    await run_in_threadpool(_sheet_sync_bg)
    return {"ok": True}


@app.get("/api/config")
def get_config():
    return {
        "sheet_url": SHEET_URL,
        "sheet_tab": config.SHEET_TAB,
        "sheet_ready": __import__("sheet").is_configured(),
        "gemini_ready": bool(config.GEMINI_API_KEY),
        "gemini_model": config.GEMINI_MODEL,
        "search_site": config.SEARCH_SITE,
        "search_queries": config.SEARCH_QUERIES,
        "search_pages": config.SEARCH_PAGES,
        "export_dir": str(config.EXPORT_DIR),
        "gemini_model_segment": config.GEMINI_MODEL_SEGMENT,
        "price_in": config.GEMINI_PRICE_INPUT_PER_M,
        "price_out": config.GEMINI_PRICE_OUTPUT_PER_M,
    }


@app.get("/api/videos")
def list_videos(status: str = config.STATUS_TO_REVIEW):
    statuses = [s for s in status.split(",") if s and s != "all"]
    videos = [_public(v) for v in db.list_videos(status=statuses or None)]
    videos.sort(key=lambda v: v.get("updated_at") or "", reverse=True)
    return videos


@app.get("/api/counts")
def counts():
    c = db.counts()
    from gemini_analyze import cost_usd
    total = 0.0
    for v in db.list_videos():
        if v.get("gemini_json"):
            try:
                g = json.loads(v["gemini_json"])
            except json.JSONDecodeError:
                continue
            total += cost_usd(g.get("_meta_segment"), g.get("_meta_tail"), g.get("_meta_prefilter"), g.get("_meta_locate"), g.get("_meta_actress")) or 0.0
    c["_cost_usd"] = round(total, 4)
    from run import norm_country
    import collections
    have = collections.Counter(norm_country(v.get("country")) for v in db.list_videos(status=[config.STATUS_TO_REVIEW, config.STATUS_APPROVED, config.STATUS_EXPORTED]) if v.get("country"))
    c["_countries"] = dict(have.most_common())
    return c


@app.get("/api/videos/{vid}")
def get_video(vid: str):
    v = db.get(vid)
    if not v:
        raise HTTPException(404)
    return _public(v, with_gemini=True)


@app.patch("/api/videos/{vid}")
def patch_video(vid: str, patch: Patch):
    v = db.get(vid)
    if not v:
        raise HTTPException(404)
    fields = _apply_patch(v, patch)
    if fields:
        db.update(vid, **fields)
    return _public(db.get(vid))


@app.post("/api/videos/{vid}/approve")
async def approve(vid: str, patch: Patch):
    v = db.get(vid)
    if not v:
        raise HTTPException(404)
    fields = _apply_patch(v, patch)
    merged = {**v, **fields}
    if merged.get("lat") is None or merged.get("lng") is None:
        raise HTTPException(400, "latitude/longitude manquantes")
    if merged.get("start_s") is None or merged.get("end_s") is None or merged["end_s"] <= merged["start_s"]:
        raise HTTPException(400, "début/fin invalides")
    if not merged.get("filename"):
        fields["filename"] = make_filename(merged.get("actress"), float(merged["lat"]), vid)
    db.update(vid, status=config.STATUS_APPROVED, reject_reason=None, error=None,
              reviewed_at=time.strftime("%Y-%m-%d %H:%M:%S"), **fields)
    await run_in_threadpool(_sheet_sync_bg)
    return _public(db.get(vid))


@app.post("/api/videos/{vid}/reject")
async def reject(vid: str, patch: Patch):
    if not db.get(vid):
        raise HTTPException(404)
    db.update(vid, status=config.STATUS_REJECTED, reject_reason=(patch.reason or "rejeté à la main"),
              reviewed_at=time.strftime("%Y-%m-%d %H:%M:%S"))
    await run_in_threadpool(_sheet_sync_bg)
    return {"ok": True}


class ReprocessParams(BaseModel):
    full: bool = False  # True : refait aussi le téléchargement et le scan nudenet


@app.post("/api/videos/{vid}/reprocess")
def reprocess(vid: str, p: ReprocessParams):
    v = db.get(vid)
    if not v:
        raise HTTPException(404)
    if job.running():
        raise HTTPException(409, "un traitement est déjà en cours, attends la fin ou clique Stop")
    import shutil
    d = config.VIDEOS_DIR / vid
    for name in ("gemini_segment.json", "gemini_prefilter.json", "gemini_locate.json", "gemini_actress.json", "gemini.json", "segments.json", "thumb.jpg"):
        if (d / name).exists():
            (d / name).unlink()
    for sub in ("grids", "locate", "clues"):
        shutil.rmtree(d / sub, ignore_errors=True)
    if p.full:
        for name in ("nsfw.json", "safe.mp4", "source.mp4", "segments.json"):
            if (d / name).exists():
                (d / name).unlink()
    db.update(vid, status=config.STATUS_NEW, error=None, reject_reason=None, gemini_json=None, clues_json=None,
              actress=None, actress_confidence=None, actress_photo=None, lat=None, lng=None, city=None, country=None,
              location_confidence=None, identifiable=None, clues=None, start_s=None, end_s=None, filename=None,
              best_frame=None, intro_end=None, intimate_at=None, reviewed_at=None, exported_at=None)
    job.start("run", ["process", "--id", vid])
    return {"ok": True}


@app.post("/api/videos/{vid}/reopen")
async def reopen(vid: str):
    if not db.get(vid):
        raise HTTPException(404)
    db.update(vid, status=config.STATUS_TO_REVIEW, reject_reason=None, exported_at=None)
    return {"ok": True}


@app.post("/api/sync")
async def sync():
    import sheet
    if not sheet.is_configured():
        return JSONResponse({"ok": False, "error": "Google Sheet non connecté : bouton « Connecter le Sheet »"}, status_code=400)
    try:
        n = await run_in_threadpool(sheet.sync)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    return {"ok": True, "rows": n}


@app.get("/media/{vid}/clues/{name}")
def media_clue(vid: str, name: str):
    if not re.fullmatch(r"(clue|frame)_\d+\.jpg|actress\.jpg", name):
        raise HTTPException(404)
    p = config.VIDEOS_DIR / vid / "clues" / name
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/media/{vid}/{name}")
def media(vid: str, name: str):
    if name not in ("safe.mp4", "thumb.jpg"):
        raise HTTPException(404)
    p = config.VIDEOS_DIR / vid / name
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p)


# ------------------------------------------------------------------- page --

HTML = r"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Locate Play — machine à contenu</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>
:root{--bg:#0f1115;--panel:#181b22;--line:#2a2f3a;--txt:#e6e8ee;--muted:#8b93a7;--ok:#22c55e;--ko:#ef4444;--acc:#6366f1;--warn:#f59e0b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 -apple-system,Segoe UI,sans-serif;display:flex;flex-direction:column;height:100vh}
select,input,button{font:inherit;color:var(--txt);background:#11141a;border:1px solid var(--line);border-radius:6px;padding:6px 8px}
input[type=number]{width:60px}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}
button.ok{background:var(--ok);border-color:var(--ok);color:#03210c;font-weight:600}button.ko{background:var(--ko);border-color:var(--ko);color:#fff;font-weight:600}button.acc{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}button.sm{padding:2px 8px;font-size:12px}
#top{padding:10px 16px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--panel)}
#top .title{font-weight:700;font-size:15px;margin-right:6px}
#status{padding:3px 10px;border-radius:99px;background:#26304a;font-size:12px}#status.run{background:#14532d;color:#bbf7d0}#status.run::before{content:"● ";animation:blink 1s infinite}@keyframes blink{50%{opacity:.3}}
#topright{margin-left:auto;display:flex;gap:8px;align-items:center}
#settings{display:none;padding:10px 16px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);background:#13161c}#settings a{color:#a5b4fc}#settings.open{display:block}
#body{display:grid;grid-template-columns:minmax(340px,38%) 1fr;flex:1;min-height:0}
#left{border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0}
#logwrap{border-bottom:1px solid var(--line)}#logtoggle{width:100%;text-align:left;border:0;border-radius:0;background:#0b0d12;color:var(--muted);font-size:12px;padding:6px 12px}
#log{display:none;background:#07090c;color:#9fe3b3;font:12px/1.4 ui-monospace,Menlo,monospace;padding:8px 10px;height:150px;overflow:auto;white-space:pre-wrap}#log.open{display:block}
#log .hl{color:#fde68a}#log .err{color:#fca5a5}#log .ok{color:#86efac;font-weight:600}
#listbar{padding:8px 12px;border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:center}
#list{overflow:auto;flex:1;padding:8px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px;margin-bottom:8px;cursor:pointer;display:grid;grid-template-columns:110px 1fr;gap:10px;align-items:center}
.card:hover,.card.sel{border-color:var(--acc)}.card img{width:110px;height:62px;object-fit:cover;border-radius:6px;background:#000}
.card .t{font-weight:600;font-size:13px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}.card .m{color:var(--muted);font-size:12px;margin-top:2px}
.badge{padding:1px 7px;border-radius:99px;font-size:11px;background:#26304a;margin-right:4px}.badge.to_review{background:#3b3f1f;color:#fde68a}.badge.approved,.badge.exported{background:#14532d;color:#bbf7d0}.badge.rejected,.badge.rejected_auto,.badge.error{background:#4c1d1d;color:#fecaca}
#detail{overflow:auto;padding:14px;max-width:1100px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px}.panel h3{margin:0 0 8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
video{width:100%;background:#000;border-radius:8px}#map{height:280px;border-radius:8px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}.row label{color:var(--muted);min-width:56px}.row input[type=text]{flex:1;min-width:80px}
.muted{color:var(--muted)}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.clues{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}.clues figure{margin:0}.clues img,.clues .txt{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#000}.clues .txt{display:flex;align-items:center;justify-content:center;font-size:26px;background:#11141a;border:1px solid var(--line)}.clues figcaption{font-size:11px;margin-top:3px;line-height:1.3}
.bar{position:relative;height:12px;background:#0b0d12;border-radius:4px;overflow:hidden;margin:6px 0 2px}.bar span{position:absolute;top:0;height:100%}
.bar .safe{background:#14532d}.bar .out{background:#1d4ed8;top:3px;height:6px}.bar .sel{border:2px solid #facc15;background:rgba(250,204,21,.22)}.bar .mark{width:2px}.bar .hot{background:#ef4444}.bar .intro{background:#9ca3af}.bar .nsfw{background:#f97316}.bar .ad{background:#a855f7;opacity:.8}
.legend{font-size:11px;color:var(--muted)}.sw{display:inline-block;width:10px;height:8px;border-radius:2px;margin:0 2px 0 6px;vertical-align:middle}.sw.safe{background:#14532d}.sw.out{background:#1d4ed8}.sw.sel{background:#facc15}.sw.hot{background:#ef4444}.sw.ad{background:#a855f7}
details pre{white-space:pre-wrap;font-size:12px;max-height:200px;overflow:auto;background:#0f1115;padding:8px;border-radius:6px}
.actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.actions button{flex:1;padding:10px}
kbd{background:#11141a;border:1px solid var(--line);border-radius:4px;padding:0 5px;font-size:11px}
#empty{padding:30px;color:var(--muted)}
@media(max-width:1000px){#body{grid-template-columns:1fr}#left{max-height:50vh}.two{grid-template-columns:1fr}}
</style></head><body>
<div id="top">
 <span class="title">Locate Play</span>
 <button class="acc" id="start">▶ Démarrer</button>
 <label class="muted"><input type="number" id="limit" value="5" min="1" max="100"> vidéos</label>
 <label class="muted" title="Sinon, seules les vidéos déjà trouvées et en attente sont traitées"><input type="checkbox" id="discover"> chercher aussi de nouvelles vidéos sur xvideos</label>
 <button id="stop" disabled>■ Stop</button>
 <span id="status">arrêtée</span><span id="current" class="muted"></span>
 <div id="topright"><span id="countries" class="badge" title="pays des vidéos à valider / validées"></span><span id="cost" class="badge" title="tokens facturés × prix de .env">Gemini 0 $</span><button id="export" title="Envoie les vidéos validées dans le jeu (Cloudflare + Supabase)">⇪ Envoyer dans le jeu</button><button id="sync" title="Réécrire l'onglet Google Sheet">Sheet ⟳</button><button id="gear" title="Réglages, connexions, journal">⚙</button></div>
</div>
<div id="settings"></div>
<div id="body">
 <div id="left">
  <div id="logwrap"><button id="logtoggle">Journal ▸</button><div id="log">Clique sur Démarrer.</div></div>
  <div id="listbar">
   <select id="filter">
    <option value="to_review">À valider</option><option value="approved">Validées</option><option value="exported">Exportées</option>
    <option value="rejected_auto">Rejetées auto</option><option value="rejected">Rejetées</option><option value="error">Erreurs</option><option value="new">En attente</option>
   </select>
   <span id="count" class="badge">0</span>
   <span class="muted" style="margin-left:auto;font-size:11px"><kbd>V</kbd> valider <kbd>R</kbd> rejeter <kbd>N</kbd> suivante</span>
  </div>
  <div id="list"></div>
 </div>
 <div id="detail"><div id="empty">Choisis une vidéo à gauche.</div></div>
</div>
<div id="pv" style="display:none;position:fixed;inset:0;z-index:100;background:#07080b;color:#fff;font-family:inherit">
 <button id="pvclose" style="position:absolute;top:12px;right:12px;z-index:2">✕ Fermer l'aperçu</button>
 <div id="pvstage" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:16px"></div>
</div>
<dialog id="sheetdlg" style="background:var(--panel);color:var(--txt);border:1px solid var(--line);border-radius:12px;max-width:760px;width:92vw;padding:18px">
 <h3 style="margin:0 0 10px">Connecter le Google Sheet (4 étapes, depuis le Sheet lui-même)</h3>
 <ol style="line-height:1.6;padding-left:20px">
  <li>Ouvre <a id="sheetlink" href="#" target="_blank">le Sheet</a> → menu <b>Extensions</b> → <b>Apps Script</b>.</li>
  <li>Efface le contenu de l'éditeur, colle le script ci-dessous, puis <b>Ctrl/Cmd + S</b>.<br>
   <textarea id="script" readonly style="width:100%;height:120px;font:11px ui-monospace,Menlo,monospace;margin-top:6px"></textarea>
   <button id="copyscript" style="margin-top:4px">Copier le script</button></li>
  <li>Bouton bleu <b>Déployer</b> → <b>Nouveau déploiement</b> → type <b>Application web</b> → Exécuter en tant que : <b>Moi</b> → Qui a accès : <b>Tout le monde</b> → <b>Déployer</b>, puis autoriser (<i>Paramètres avancés</i> → <i>Accéder</i> si Google avertit). Copie l'<b>URL de l'application web</b> (<code>/exec</code>).</li>
  <li>Colle-la ici : <input id="webappurl" type="text" placeholder="https://script.google.com/macros/s/…/exec" style="width:100%;margin-top:6px">
   <div style="display:flex;gap:8px;margin-top:8px"><button class="acc" id="savewebapp">Enregistrer et tester</button><button id="closedlg">Fermer</button><span id="webappmsg" class="muted"></span></div></li>
 </ol>
</dialog>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=s=>{if(s==null||isNaN(s))return"";s=Math.round(s);return[Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(x=>String(x).padStart(2,"0")).join(":")};
const short=s=>fmt(s).replace(/^00:/,"");
const parse=t=>{if(t===""||t==null)return null;const p=String(t).split(":").map(Number);if(p.some(isNaN))return null;return p.reduce((a,b)=>a*60+b,0)};
const LABEL={new:"en attente",to_review:"à valider",approved:"validée",exported:"exportée",rejected:"rejetée",rejected_auto:"rejetée auto",error:"erreur"};
let videos=[],cur=null,map=null,marker=null,logNext=0,running=false,cfg={},openedAt=0,lastAction=0;
const off=()=>(cur&&(cur.clip_start??cur.safe_start))||0; // safe.mp4 commence à l'image-clé ≤ safe_start (clip_start)
async function api(path,opt={}){const r=await fetch(path,{headers:{"Content-Type":"application/json"},...opt});if(!r.ok){const e=await r.json().catch(()=>({detail:r.statusText}));throw new Error(e.detail||e.error||r.statusText)}return r.json()}
const skipsOf=v=>{try{return JSON.parse(v.skip_json||"[]")}catch(e){return[]}};

function bar(v){const T=Math.max(v.safe_end||0,v.end_s||0,v.intimate_at||0,60);const pct=x=>Math.min(100,Math.max(0,x/T*100));let h='<div class="bar">';
 if(v.safe_end!=null)h+=`<span class="safe" style="left:${pct(v.safe_start||0)}%;width:${pct(v.safe_end)-pct(v.safe_start||0)}%" title="fenêtre sûre nudenet"></span>`;
 (v.segments||[]).forEach(([a,b])=>h+=`<span class="out" style="left:${pct(a)}%;width:${pct(b)-pct(a)}%" title="extérieur ${fmt(a)}–${fmt(b)}"></span>`);
 if(v.start_s!=null&&v.end_s!=null){h+=`<span class="sel" style="left:${pct(v.start_s)}%;width:${pct(v.end_s)-pct(v.start_s)}%" title="clip ${fmt(v.start_s)}–${fmt(v.end_s)}"></span>`;skipsOf(v).forEach(([a,b])=>h+=`<span class="ad" style="left:${pct(v.start_s+a)}%;width:${pct(v.start_s+b)-pct(v.start_s+a)}%" title="carte pub coupée"></span>`)}
 if(v.intro_end)h+=`<span class="mark intro" style="left:${pct(v.intro_end)}%" title="fin intro"></span>`;
 if(v.nsfw_cut!=null)h+=`<span class="mark nsfw" style="left:${pct(v.nsfw_cut)}%" title="1re image explicite"></span>`;
 if(v.intimate_at!=null)h+=`<span class="mark hot" style="left:${pct(v.intimate_at)}%" title="devient intime"></span>`;
 return h+`</div><div class="legend">0 → ${fmt(T)} <i class="sw safe"></i>sûr <i class="sw out"></i>extérieur <i class="sw sel"></i>clip <i class="sw ad"></i>pub coupée <i class="sw hot"></i>intime</div>`}

function card(v){const conf=v.location_confidence!=null?Math.round(v.location_confidence*100)+"%":"";const place=[v.city,v.country].filter(Boolean).join(", ");
 return `<div class="card ${cur&&cur.id===v.id?"sel":""}" data-id="${v.id}">
  <img src="${v.has_thumb?`/media/${v.id}/thumb.jpg?${v.updated_at}`:(v.thumbnail_url||"")}" loading="lazy">
  <div><div class="t">${esc(v.title||v.url)}</div>
   <div class="m"><span class="badge ${v.status}">${LABEL[v.status]||v.status}</span>${place?esc(place)+(conf?" · "+conf:""):(v.status==="new"?"pas encore traitée":"lieu ?")}${v.start_s!=null?` · ${short(v.start_s)} → ${short(v.end_s)}`:""}</div>
   ${v.reject_reason||v.error?`<div class="m" style="color:#fca5a5">${esc(v.reject_reason||v.error)}</div>`:""}</div></div>`}

async function loadList(keep){videos=await api("/api/videos?status="+$("#filter").value);$("#count").textContent=videos.length;
 $("#list").innerHTML=videos.map(card).join("")||'<div class="muted" style="padding:12px">Rien ici pour l\'instant.</div>';
 document.querySelectorAll(".card").forEach(el=>el.onclick=()=>open(el.dataset.id));
 if(!keep&&videos.length&&!cur)open(videos[0].id);
 const c=await api("/api/counts");$("#cost").textContent=`Gemini ${(c._cost_usd||0).toFixed(3)} $`;const cs=Object.entries(c._countries||{});$("#countries").textContent=cs.length?`🌍 ${cs.length} pays`:"🌍 0 pays";$("#countries").title=cs.map(([k,n])=>`${k} : ${n}`).join("\n")||"aucune vidéo analysée"}

async function open(id){cur=await api("/api/videos/"+id);openedAt=Date.now();document.querySelectorAll(".card").forEach(el=>el.classList.toggle("sel",el.dataset.id===id));render()}
function render(){const v=cur,g=v.gemini||{},loc=g.location||{},skips=skipsOf(v),clues=v.clue_items||[];
 $("#detail").innerHTML=`
 <div class="panel">
  <div style="display:flex;gap:8px;align-items:baseline;margin-bottom:8px"><strong style="flex:1;font-size:15px">${esc(v.title||v.url)}</strong><a href="${v.url}" target="_blank" class="muted">source ↗</a></div>
  ${v.has_clip?`<video id="vid" controls preload="metadata" src="/media/${v.id}/safe.mp4"></video>`:`<p class="muted">Pas de clip local (statut ${LABEL[v.status]||v.status}).</p>`}
  <div class="row" style="margin-top:8px"><button class="acc" id="previewPlayer" ${v.has_clip?"":"disabled"}>👁 Aperçu joueur (intro, clip, révélation)</button><button id="preview" ${v.has_clip?"":"disabled"}>▶ rejouer début→fin</button></div>
  <div class="row"><label>Début</label><input type="text" id="start" value="${fmt(v.start_s)}" style="max-width:110px"><button class="sm" id="setStart" title="[">◀ ici</button>
   <label>Fin</label><input type="text" id="end" value="${fmt(v.end_s)}" style="max-width:110px"><button class="sm" id="setEnd" title="]">ici ▶</button>
   ${skips.length?`<span class="muted">Coupé au montage : ${skips.map(([a,b])=>short((v.start_s||0)+a)+"–"+short((v.start_s||0)+b)).join(", ")}</span>`:""}</div>
  ${(()=>{try{const sp=JSON.parse(v.spoilers_json||"[]");return sp.length?`<div class="muted" style="font-size:12px">⚠️ Texte à l'écran révélant le lieu : ${sp.map(h=>short(h.t)+" « "+esc(h.names.join(", "))+" »").join(", ")} — début décalé / passage coupé</div>`:""}catch(e){return""}})()}
 </div>
 <div class="two">
 <div class="panel">
  <h3>Actrice (écran « Find X »)</h3>
  <div class="row">${v.actress_photo?`<img src="/media/${v.id}/clues/${v.actress_photo}?${v.updated_at}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--acc)">`:`<span class="muted" style="width:64px;height:64px;border-radius:50%;background:#26304a;display:inline-flex;align-items:center;justify-content:center">?</span>`}<input type="text" id="actress" value="${esc(v.actress||"")}" placeholder="nom inconnu"></div>
  <div class="muted" style="font-size:12px">${esc(g.actress&&g.actress.evidence||"")}</div>
 </div>
 <div class="panel">
  <h3>Lieu <span class="badge">${loc.confidence!=null?Math.round(loc.confidence*100)+"%":""}</span></h3>
  <div class="row"><label>Ville</label><input type="text" id="city" value="${esc(v.city||"")}"><label>Pays</label><input type="text" id="country" value="${esc(v.country||"")}"></div>
  <div class="row"><label>Lat, Lng</label><input type="text" id="lat" value="${v.lat??""}"><input type="text" id="lng" value="${v.lng??""}"></div>
  <div id="map"></div>
  <p class="muted" style="font-size:12px;margin:8px 0 0">${esc(loc.reasoning||"")}</p>
 </div>
 </div>
 <div class="panel">
  <h3>Indices montrés au joueur après sa réponse</h3>
  ${clues.length?`<div class="clues">${clues.map(c=>`<figure>${c.crop?`<img src="/media/${v.id}/clues/${c.crop}?${v.updated_at}">`:`<div class="txt">🎧</div>`}<figcaption>${esc(c.text)}</figcaption></figure>`).join("")}</div>`:`<span class="muted">Aucun indice pour cette vidéo.</span>`}
 </div>
 <div class="actions"><button class="ok" id="approve">✔ Valider (V)</button><button class="ko" id="reject">✘ Rejeter (R)</button>${v.status!=="to_review"?'<button id="reopen">↺ Remettre à valider</button>':""}<button id="reprocess" title="Efface les analyses Gemini et relance le traitement de cette vidéo">↻ Retraiter</button></div>
 <div id="msg" class="muted" style="margin-top:6px">${v.status!=="to_review"?"Statut : "+esc(LABEL[v.status]||v.status)+(v.reject_reason?" — "+esc(v.reject_reason):"")+(v.error?" — "+esc(v.error):""):""}</div>
 <details style="margin-top:10px"><summary class="muted">Détails techniques</summary>
  ${bar(v)}
  <p class="muted" style="font-size:12px">Fichier : <b>${esc(v.filename||"?")}.mp4</b> (actrice + latitude entière) · coût Gemini ${v.cost_usd!=null?(v.cost_usd*100).toFixed(2)+" ¢":"?"} · durée source ${fmt(v.duration)}${(v.performers||[]).length?" · interprètes listés : "+esc(v.performers.join(", ")):""}</p>
  <p class="muted" style="font-size:12px">${esc(g.notes||"")}</p>
  <pre>${esc(JSON.stringify({intro_end:g.intro_end,ad_segments:g.ad_segments,outdoor_segments:g.outdoor_segments,becomes_intimate_at:g.becomes_intimate_at,is_street_pickup:g.is_street_pickup,best_frame:g.best_frame,tokens:{segment:g._meta_segment,locate:g._meta_locate,actress:g._meta_actress}},null,1))}</pre>
  <pre>${esc((v.comments||[]).join("\n")||"(aucun commentaire)")}</pre></details>`;
 const vid=$("#vid");
 const jumpSkips=(el,start)=>{const sk=skipsOf(v);return()=>{const t=el.currentTime+off()-start;for(const [a,b] of sk){if(t>=a&&t<b){el.currentTime=start+b-off();break}}}};
 if(vid){vid.currentTime=Math.max((v.start_s||0)-off(),0);$("#setStart").onclick=()=>{$("#start").value=fmt(vid.currentTime+off())};$("#setEnd").onclick=()=>{$("#end").value=fmt(vid.currentTime+off())};
  $("#preview").onclick=()=>{const st=parse($("#start").value)||0;vid.currentTime=Math.max(st-off(),0);vid.play();const js=jumpSkips(vid,st);const stop=()=>{js();if(vid.currentTime+off()>=(parse($("#end").value)||1e9)){vid.pause();vid.removeEventListener("timeupdate",stop)}};vid.addEventListener("timeupdate",stop)}}
 $("#approve").onclick=approve;$("#reject").onclick=reject;$("#previewPlayer").onclick=()=>playerPreview(v);const ro=$("#reopen");if(ro)ro.onclick=async()=>{await api(`/api/videos/${v.id}/reopen`,{method:"POST"});cur=null;loadList()};
 $("#reprocess").onclick=async()=>{const full=confirm("Retraiter cette vidéo ?\n\nOK = tout refaire (téléchargement, scan, Gemini)\nAnnuler = garder le scan, refaire seulement Gemini");try{await api(`/api/videos/${v.id}/reprocess`,{method:"POST",body:JSON.stringify({full})});$("#log").textContent="";logNext=0;running=true;openLog(true);$("#msg").textContent="Retraitement lancé, suis le journal."}catch(e){alert(e.message)}};
 const lat=v.lat??20,lng=v.lng??0;map=L.map("map").setView([lat,lng],v.lat!=null?12:2);
 L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(map);
 marker=L.marker([lat,lng],{draggable:true}).addTo(map);
 const setLL=ll=>{$("#lat").value=ll.lat.toFixed(6);$("#lng").value=ll.lng.toFixed(6);marker.setLatLng(ll)};
 marker.on("dragend",()=>setLL(marker.getLatLng()));map.on("click",e=>setLL(e.latlng));
 $("#lat").onchange=$("#lng").onchange=()=>{const ll=L.latLng(parseFloat($("#lat").value),parseFloat($("#lng").value));if(!isNaN(ll.lat)&&!isNaN(ll.lng)){marker.setLatLng(ll);map.panTo(ll)}};
}
function payload(){return{actress:$("#actress").value,lat:parseFloat($("#lat").value),lng:parseFloat($("#lng").value),city:$("#city").value,country:$("#country").value,start_s:parse($("#start").value),end_s:parse($("#end").value)}}
function next(){const i=videos.findIndex(v=>v.id===cur.id);cur=null;loadList(true).then(()=>{if(videos.length)open(videos[Math.min(i,videos.length-1)].id);else $("#detail").innerHTML='<div id="empty">Plus rien dans cette liste.</div>'})}
async function approve(){if(Date.now()-lastAction<1500)return;lastAction=Date.now();try{$("#msg").textContent="…";await api(`/api/videos/${cur.id}/approve`,{method:"POST",body:JSON.stringify(payload())});next()}catch(e){$("#msg").textContent="Erreur : "+e.message}}
async function reject(){if(Date.now()-lastAction<1500)return;lastAction=Date.now();const reason=prompt("Raison du rejet (optionnel)","");if(reason===null)return;try{await api(`/api/videos/${cur.id}/reject`,{method:"POST",body:JSON.stringify({reason})});next()}catch(e){$("#msg").textContent="Erreur : "+e.message}}
document.addEventListener("keydown",e=>{if(!cur||e.repeat||e.target.matches("input,textarea,select")||$("#pv").style.display==="block")return;const vid=$("#vid");
 if((e.key==="v"||e.key==="V"||e.key==="r"||e.key==="R")&&Date.now()-openedAt<1500)return; // une vidéo qui vient de s'ouvrir ne se valide pas au clavier
 if(e.key==="v"||e.key==="V")approve();else if(e.key==="r"||e.key==="R")reject();else if(e.key==="n"||e.key==="N")next();
 else if(e.key==="["&&vid)$("#setStart").click();else if(e.key==="]"&&vid)$("#setEnd").click();else if(e.key===" "&&vid){e.preventDefault();vid.paused?vid.play():vid.pause()}});

// ---- aperçu joueur : intro "Find X" -> clip début→fin (cartes pub sautées) -> révélation avec indices zoomés ----
let pvTimer=null;
function zoomStyle(box){const [y0,x0,y1,x1]=box;const w=Math.max(x1-x0,.06),h=Math.max(y1-y0,.06);const cx=(x0+x1)/2*100,cy=(y0+y1)/2*100;const s=Math.min(1/w,1/h,4)*.85;return{zoom:`translate(${(50-cx)*s}%,${(50-cy)*s}%) scale(${s})`,outline:`left:${x0*100}%;top:${y0*100}%;width:${w*100}%;height:${h*100}%`}}
function playerPreview(v){const p=payload();const start=p.start_s??v.start_s??0,end=p.end_s??v.end_s??start+30;const name=p.actress||v.actress;const st=$("#pvstage");$("#pv").style.display="block";clearTimeout(pvTimer);const sk=skipsOf(v);
 const intro=()=>{st.innerHTML=`<div style="font-size:12px;letter-spacing:.2em;color:#9aa;text-transform:uppercase">Round 1/5</div>
   ${v.actress_photo?`<img src="/media/${v.id}/clues/${v.actress_photo}?${v.updated_at}" style="width:220px;height:220px;border-radius:50%;object-fit:cover;border:4px solid #e11d48;box-shadow:0 0 40px #e11d4866">`:`<div style="width:220px;height:220px;border-radius:50%;background:#26304a;display:flex;align-items:center;justify-content:center;font-size:64px;font-weight:900">${esc((name||"?")[0])}</div>`}
   <div style="font-size:44px;font-weight:900">Find <span style="color:#f43f5e">${esc(name||"her")}</span></div><div style="color:#9aa">📍 (2,5 s, puis la vidéo démarre)</div>`;pvTimer=setTimeout(clip,2500)};
 const clip=()=>{st.innerHTML=`<div style="width:min(100%,960px)"><video id="pvvid" src="/media/${v.id}/safe.mp4" style="width:100%;border-radius:10px;background:#000" autoplay playsinline></video>
   <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;color:#9aa"><span>Le joueur regarde ce clip (${fmt(start)} → ${fmt(end)}, ${Math.round(end-start)} s${sk.length?", cartes pub sautées":""}) et place son marqueur.</span><button id="pvskip">Passer à la révélation ▶</button></div></div>`;
  const vid=$("#pvvid");vid.currentTime=Math.max(start-off(),0);vid.play().catch(()=>{});const stop=()=>{const t=vid.currentTime+off()-start;for(const [a,b] of sk){if(t>=a&&t<b){vid.currentTime=start+b-off();return}}if(vid.currentTime+off()>=end){vid.pause();vid.removeEventListener("timeupdate",stop);reveal()}};vid.addEventListener("timeupdate",stop);$("#pvskip").onclick=()=>{vid.pause();reveal()}};
 const reveal=()=>{const lat=p.lat??v.lat,lng=p.lng??v.lng;const clues=v.clue_items||[];
  st.innerHTML=`<div style="width:min(100%,960px);display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">
   <div><div style="background:#181b22;border:2px solid #e11d48;border-radius:10px;padding:14px;text-align:center"><div style="font-size:28px">🔥</div><div style="font-size:26px;font-weight:900;color:#f43f5e">3 240 pts <span style="font-size:12px;color:#9aa;font-weight:400">(exemple)</span></div><div style="font-size:13px;color:#9aa">412 km from <b style="color:#fbbf24">${esc((p.city||v.city||"?")+", "+(p.country||v.country||"?"))}</b></div></div>
    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#9aa;margin:12px 0 6px">Clues you could have spotted</div>
    <div style="display:flex;gap:8px;overflow-x:auto">${clues.map((c,i)=>{if(!c.crop)return`<figure style="margin:0;width:200px;flex:none"><div style="aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;border-radius:8px;background:#181b22;border:1px solid #2a2f3a;font-size:26px">🎧</div><figcaption style="font-size:11px;margin-top:4px">${esc(c.text)}</figcaption></figure>`;const z=zoomStyle(c.box);return`<figure style="margin:0;width:200px;flex:none;cursor:pointer" data-i="${i}"><div style="position:relative;aspect-ratio:16/9;overflow:hidden;border-radius:8px;background:#000;border:1px solid #2a2f3a"><img class="pvimg" data-zoom="${z.zoom}" src="/media/${v.id}/clues/${c.frame}?${v.updated_at}" style="width:100%;height:100%;object-fit:cover;transition:transform 1.1s ease-in-out;transform:none"><div class="pvbox" style="position:absolute;border:2px solid #fbbf24;border-radius:3px;${z.outline}"></div></div><figcaption style="font-size:11px;margin-top:4px">${esc(c.text)}</figcaption></figure>`}).join("")||'<span style="color:#9aa">Aucun indice pour cette vidéo.</span>'}</div></div>
   <div id="pvmap" style="height:320px;border-radius:10px"></div></div>`;
  const zoomAll=on=>{document.querySelectorAll(".pvimg").forEach(im=>im.style.transform=on?im.dataset.zoom:"none");document.querySelectorAll(".pvbox").forEach(b=>b.style.display=on?"none":"block")};
  let z=false;pvTimer=setTimeout(()=>{z=true;zoomAll(true)},900);document.querySelectorAll("#pvstage figure[data-i]").forEach(f=>f.onclick=()=>{z=!z;zoomAll(z)});
  if(lat!=null&&lng!=null){const m=L.map("pvmap").setView([lat,lng],11);L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(m);L.marker([lat,lng]).addTo(m).bindPopup("Réponse").openPopup();L.circleMarker([lat+2.2,lng-3.1],{color:"#f43f5e",radius:7}).addTo(m).bindPopup("Marqueur du joueur (exemple)")}};
 $("#pvclose").onclick=()=>{clearTimeout(pvTimer);const vid=$("#pvvid");if(vid)vid.pause();$("#pv").style.display="none";st.innerHTML=""};
 intro()}

// ---- machine : démarrer / stop / journal en direct ----
function openLog(on){$("#log").classList.toggle("open",on);$("#logtoggle").textContent=on?"Journal ▾":"Journal ▸"}
$("#logtoggle").onclick=()=>openLog(!$("#log").classList.contains("open"));
function logLine(l){const cls=/À VALIDER|entrées ->/.test(l)?"ok":/rejet auto|WARNING/.test(l)?"hl":/ERROR|Traceback|Error/.test(l)?"err":"";const el=$("#log");
 el.insertAdjacentHTML("beforeend",`<div class="${cls}">${esc(l.replace(/^\d{4}-\d\d-\d\d /,""))}</div>`);while(el.childElementCount>1500)el.firstChild.remove();el.scrollTop=el.scrollHeight}
async function poll(){try{const s=await api("/api/run/status?since="+logNext);
  if(logNext===0&&s.lines.length)$("#log").textContent="";
  let refresh=false;s.lines.forEach(l=>{if(/AFC|httpx/.test(l))return;logLine(l);if(/À VALIDER|rejet auto|erreur|terminé|entrées ->|Sheet/.test(l))refresh=true});logNext=s.next;
  const was=running;running=s.running;if(running&&!was)openLog(true);
  $("#status").textContent=running?(s.kind==="export"?"export en cours":"en cours"):(s.finished_at?"terminée":"arrêtée");$("#status").className=running?"run":"";
  const last=s.lines.length?s.lines[s.lines.length-1]:null;
  $("#current").textContent=s.current?` ${s.current.title.slice(0,50)}${last&&/téléchargement|scan nudenet|passe 1|passe 2/.test(last)?" · "+(last.match(/téléchargement|scan nudenet|Gemini passe \d[^…]*/)||[""])[0]:""}`:"";
  $("#start").disabled=$("#export").disabled=running;$("#stop").disabled=!running;
  if(refresh||(was&&!running))loadList(true);
 }catch(e){}
 setTimeout(poll,running?1000:4000)}
$("#start").onclick=async()=>{try{$("#log").textContent="";logNext=0;await api("/api/run",{method:"POST",body:JSON.stringify({limit:+$("#limit").value||5,discover:$("#discover").checked})});running=true;openLog(true)}catch(e){alert(e.message)}};
$("#stop").onclick=()=>api("/api/run/stop",{method:"POST"});
$("#export").onclick=async()=>{if(!confirm("Envoyer les vidéos validées dans le jeu ? (clip, portrait et indices sur Cloudflare, ligne dans Supabase — quelques minutes par vidéo, suis le journal)"))return;try{$("#log").textContent="";logNext=0;await api("/api/export",{method:"POST",body:JSON.stringify({clips:false})});running=true;openLog(true)}catch(e){alert(e.message)}};
$("#sync").onclick=async()=>{$("#sync").textContent="…";try{const r=await api("/api/sync",{method:"POST"});$("#sync").textContent=`Sheet ✓ ${r.rows}`}catch(e){$("#sync").textContent="Sheet ✗";alert(e.message)}};
$("#filter").onchange=()=>{cur=null;loadList()};
$("#gear").onclick=()=>$("#settings").classList.toggle("open");
async function openSheetDialog(){const s=await api("/api/config/sheet");$("#sheetlink").href=s.sheet_url;$("#script").value=s.script;$("#webappurl").value=s.url||"";$("#webappmsg").textContent="";$("#sheetdlg").showModal()}
$("#copyscript").onclick=()=>{navigator.clipboard.writeText($("#script").value);$("#copyscript").textContent="Copié ✓"};
$("#closedlg").onclick=()=>$("#sheetdlg").close();
$("#savewebapp").onclick=async()=>{$("#webappmsg").textContent="test en cours…";try{const r=await api("/api/config/sheet-webapp",{method:"POST",body:JSON.stringify({url:$("#webappurl").value})});$("#webappmsg").textContent=`✓ ${r.rows} lignes écrites dans le Sheet`;await renderSettings();loadList(true)}catch(e){$("#webappmsg").textContent="✗ "+e.message}};
async function renderSettings(){cfg=await api("/api/config");
 $("#settings").innerHTML=`Recherche ${esc(cfg.search_site)} « ${esc(cfg.search_queries.join(", "))} » → base locale → <a href="${cfg.sheet_url}" target="_blank">Google Sheet</a> (onglet « ${esc(cfg.sheet_tab)} »${cfg.sheet_ready?" ✓":" — <b style='color:#fca5a5'>non connecté</b> <button class='sm' id='sheetsetup'>Connecter le Sheet</button>"}) → validation ici → Exporter → <code>add-video.mjs</code> → Cloudflare R2 + Supabase → le jeu.
 <br>Gemini ${cfg.gemini_ready?"✓ "+esc(cfg.gemini_model_segment)+" (découpage) / "+esc(cfg.gemini_model)+" (lieu) <button class='sm' id='gtest'>tester</button>":"<b style='color:#fca5a5'>✗ clé manquante</b> — <input id='gkey' type='password' placeholder='colle ta clé (AIza…)' style='width:300px;padding:2px 6px;font-size:12px'> <button class='sm' id='gsave'>Enregistrer</button>"} · prix ${cfg.price_in} $ / ${cfg.price_out} $ par M tokens · réglages dans <code>pipeline/.env</code>
 <br><button class='sm' id='clearqueue' style='margin-top:6px'>🧹 Vider la file d'attente</button> <span class='muted'>enlève les vidéos trouvées mais pas encore analysées</span>
 &nbsp; <button class='sm ko' id='resetall' style='margin-top:6px'>🗑 Tout remettre à zéro</button> <span class='muted'>efface toutes les vidéos analysées sur ce Mac et vide l'onglet du Sheet ; la prochaine recherche repart de rien</span>`;
 $("#clearqueue").onclick=async()=>{if(!confirm("Vider la file d'attente ? Les vidéos trouvées mais pas encore analysées sont enlevées (elles pourront revenir à une prochaine recherche)."))return;try{const r=await api("/api/queue/clear",{method:"POST"});alert(r.removed+" vidéos enlevées de la file");loadList(true)}catch(e){alert(e.message)}};
 $("#resetall").onclick=async()=>{if(!confirm("Tout effacer ? Toutes les vidéos trouvées, analysées et validées sur ce Mac seront supprimées, et l'onglet du Sheet vidé. Irréversible."))return;try{await api("/api/reset-all",{method:"POST"});cur=null;$("#detail").innerHTML='<div id="empty">Base vide. Coche « chercher aussi de nouvelles vidéos » puis Démarrer.</div>';loadList(true)}catch(e){alert(e.message)}};
 if(!cfg.gemini_ready||!cfg.sheet_ready)$("#settings").classList.add("open");
 const ss=$("#sheetsetup");if(ss)ss.onclick=openSheetDialog;
 const gs=$("#gsave");if(gs)gs.onclick=async()=>{try{await api("/api/config/gemini-key",{method:"POST",body:JSON.stringify({key:$("#gkey").value})});await renderSettings();$("#gtest").click()}catch(e){alert(e.message)}};
 const gt=$("#gtest");if(gt)gt.onclick=async()=>{gt.textContent="…";try{const r=await api("/api/config/gemini-test",{method:"POST"});gt.textContent="✓ "+r.model+" répond";}catch(e){gt.textContent="✗ erreur";alert(e.message)}};}
(async()=>{await renderSettings();loadList();poll()})();
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
def index():
    return HTML


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    config.ensure_dirs()
    db.init()
    url = f"http://127.0.0.1:{config.DASHBOARD_PORT}"
    print(f"Machine à contenu : {url}")
    if "--no-open" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=config.DASHBOARD_PORT, log_level="warning")
