"""Miroir de la base locale dans l'onglet Google Sheet.

Deux façons d'écrire : un petit script Apps Script déployé depuis le Sheet (SHEET_WEBAPP_URL, le plus simple),
ou un compte de service gspread (service-account.json). La base locale est la source de vérité : l'onglet est
réécrit en entier à chaque synchronisation.
"""
from __future__ import annotations

import logging

import requests

import config
import db

log = logging.getLogger("sheet")

HEADER = [
    "Statut", "Lien video", "Nom actrice", "Localisation L/L", "Nom fichier .mp4", "début", "fin",
    "Ville", "Pays", "Confiance lieu", "Indices", "Titre", "Uploader", "Durée source", "Fenêtre sûre",
    "Raison rejet / notes", "Mis à jour", "ID",
]

STATUS_LABEL = {
    config.STATUS_NEW: "en attente",
    config.STATUS_TO_REVIEW: "à valider",
    config.STATUS_APPROVED: "validé",
    config.STATUS_EXPORTED: "exporté",
    config.STATUS_REJECTED: "rejeté",
    config.STATUS_REJECTED_AUTO: "rejeté auto",
    config.STATUS_ERROR: "erreur",
}
STATUS_ORDER = [
    config.STATUS_TO_REVIEW, config.STATUS_APPROVED, config.STATUS_EXPORTED,
    config.STATUS_REJECTED, config.STATUS_REJECTED_AUTO, config.STATUS_ERROR, config.STATUS_NEW,
]
SHEET_STATUSES = STATUS_ORDER[:-1]  # les "new" pas encore traitées n'ont rien à montrer

APPS_SCRIPT = """// Locate Play — reçoit les lignes du pipeline et les écrit dans l'onglet "{tab}".
// Déployer : Déployer > Nouveau déploiement > Application web > Exécuter en tant que : Moi > Accès : Tout le monde.
const TOKEN = "{token}";

function doPost(e) {{
  const data = JSON.parse(e.postData.contents);
  if (data.token !== TOKEN) return reply({{ ok: false, error: "mauvais jeton" }});
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = data.tab || "{tab}";
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  const rows = data.rows || [];
  if (rows.length) sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, rows.length ? rows[0].length : 1).setFontWeight("bold");
  return reply({{ ok: true, rows: Math.max(rows.length - 1, 0) }});
}}

function doGet(e) {{
  if (e && e.parameter && e.parameter.links) {{  // liens de tous les autres onglets (déjà importés à la main)
    const out = [];
    SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sh) {{
      if (sh.getName() === "{tab}") return;
      sh.getDataRange().getValues().forEach(function (row) {{
        row.forEach(function (v) {{ if (typeof v === "string" && /^https?:\/\//.test(v)) out.push(v); }});
      }});
    }});
    return reply({{ ok: true, links: out }});
  }}
  return reply({{ ok: true, ping: "Locate Play" }});
}}

function reply(obj) {{
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}}
"""


def mode() -> str | None:
    """'webapp' | 'service_account' | None selon ce qui est configuré."""
    if config.SHEET_WEBAPP_URL and config.SHEET_WEBAPP_TOKEN:
        return "webapp"
    if config.GOOGLE_SERVICE_ACCOUNT_JSON.exists():
        return "service_account"
    return None


def is_configured() -> bool:
    return mode() is not None


def apps_script(token: str) -> str:
    return APPS_SCRIPT.format(tab=config.SHEET_TAB, token=token)


def row_for(v: dict) -> list:
    latlng = f"{v['lat']}, {v['lng']}" if v.get("lat") is not None and v.get("lng") is not None else ""
    notes = v.get("reject_reason") or v.get("error") or ""
    return [
        STATUS_LABEL.get(v["status"], v["status"]),
        v.get("url") or "",
        v.get("actress") or "",
        latlng,
        f"{v['filename']}.mp4" if v.get("filename") else "",
        config.fmt_ts(v.get("start_s")),
        config.fmt_ts(v.get("end_s")),
        v.get("city") or "",
        v.get("country") or "",
        "" if v.get("location_confidence") is None else round(float(v["location_confidence"]), 2),
        v.get("clues") or "",
        v.get("title") or "",
        v.get("uploader") or "",
        config.fmt_ts(v.get("duration")),
        (config.fmt_ts(v.get("safe_start")) + " → " + config.fmt_ts(v.get("safe_end"))) if v.get("safe_end") is not None else "",
        notes,
        v.get("updated_at") or "",
        v.get("id") or "",
    ]


def build_rows() -> list[list]:
    videos = db.list_videos(status=SHEET_STATUSES)
    videos.sort(key=lambda v: (STATUS_ORDER.index(v["status"]), v.get("updated_at") or ""))
    return [HEADER] + [row_for(v) for v in videos]


def _sync_webapp(rows: list[list]) -> int:
    r = requests.post(
        config.SHEET_WEBAPP_URL,
        json={"token": config.SHEET_WEBAPP_TOKEN, "tab": config.SHEET_TAB, "rows": rows},
        timeout=90, allow_redirects=True,
    )
    r.raise_for_status()
    try:
        data = r.json()
    except ValueError:
        raise RuntimeError(
            "le script ne répond pas en JSON : vérifie que le déploiement est en « Application web », "
            "accès « Tout le monde », et que l'URL finit par /exec"
        )
    if not data.get("ok"):
        raise RuntimeError(f"le script répond : {data.get('error') or data}")
    return int(data.get("rows", len(rows) - 1))


def _sync_service_account(rows: list[list]) -> int:
    import gspread
    gc = gspread.service_account(filename=str(config.GOOGLE_SERVICE_ACCOUNT_JSON))
    sh = gc.open_by_key(config.SHEET_ID)
    try:
        ws = sh.worksheet(config.SHEET_TAB)
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title=config.SHEET_TAB, rows=2000, cols=len(HEADER))
    ws.clear()
    ws.update(rows, value_input_option="RAW")
    try:
        ws.freeze(rows=1)
        ws.format("A1:R1", {"textFormat": {"bold": True}})
    except Exception as e:  # cosmétique
        log.debug("format: %s", e)
    return len(rows) - 1


def fetch_known_links() -> list[str]:
    """Liens présents dans les autres onglets du Sheet (vidéos déjà importées à la main). [] si le script
    déployé ne le gère pas encore (redéployer une « nouvelle version » avec le script du dashboard)."""
    if not config.SHEET_WEBAPP_URL:
        return []
    try:
        r = requests.get(config.SHEET_WEBAPP_URL, params={"links": "1"}, timeout=60, allow_redirects=True)
        data = r.json()
        return [str(u) for u in (data.get("links") or [])]
    except Exception as e:
        log.warning("liens du Sheet : %s", e)
        return []


def sync() -> int:
    """Réécrit tout l'onglet depuis la base locale. Retourne le nombre de lignes."""
    m = mode()
    if m is None:
        raise RuntimeError("Google Sheet non connecté : bouton « Connecter le Sheet » dans le dashboard (ou README)")
    rows = build_rows()
    n = _sync_webapp(rows) if m == "webapp" else _sync_service_account(rows)
    log.info("Sheet '%s' (%s) : %d lignes", config.SHEET_TAB, m, n)
    return n
