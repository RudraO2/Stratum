"""Paths, ports and model names — every setting in one place, overridable by env."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _default_home() -> Path:
    # The repo sits in OneDrive on the team laptops; keep the database, file store
    # and page cache off it so they are not synced.
    if os.environ.get("STRATUM_HOME"):
        return Path(os.environ["STRATUM_HOME"])
    if Path("D:/").exists():
        return Path("D:/stratum/data")
    return BACKEND_ROOT / "data"


HOME = _default_home()
DB_PATH = HOME / "stratum.db"
STORE_DIR = HOME / "store"  # content-addressed originals: store/<sha256[:2]>/<sha256><ext>
PAGES_DIR = HOME / "pages"  # rendered page PNG cache
# The harness workspace: a folder of its own, outside the repo and OneDrive, so the workbench does not load the
# developer notes in the checkout as "context" and the deliverables row can open files by workspace-relative path.
WORKSPACE_DIR = Path(os.environ.get("STRATUM_WORKSPACE", Path.home() / ".stratum" / "workspace"))
DELIVERABLES_DIR = Path(os.environ.get("STRATUM_DELIVERABLES", WORKSPACE_DIR / "deliverables"))
CORPUS_DIR = REPO_ROOT / "corpus"

LLM_ENDPOINT = os.environ.get("STRATUM_LLM_ENDPOINT", "http://127.0.0.1:8090").rstrip("/")
LLM_TEXT_MODEL = os.environ.get("STRATUM_LLM_MODEL", "st-text")
LLM_VISION_MODEL = os.environ.get("STRATUM_VISION_MODEL", "st-vision")
LLM_TIMEOUT_S = float(os.environ.get("STRATUM_LLM_TIMEOUT", "180"))

EMBED_MODEL = os.environ.get("STRATUM_EMBED_MODEL", "intfloat/multilingual-e5-small")

PAGE_RENDER_SCALE = 2.0  # 144 dpi — readable, and small enough to serve quickly
MAX_VLM_PAGES_PER_DOC = int(os.environ.get("STRATUM_MAX_VLM_PAGES", "4"))
# "auto" = the local model writes answers/narrative; "template" = deterministic wording only
# (fast on a machine whose GPU is unavailable). Figures are identical either way.
COMPOSE_MODE = os.environ.get("STRATUM_COMPOSE", "auto")
USE_VISION = os.environ.get("STRATUM_VISION", "1") == "1"

for directory in (HOME, STORE_DIR, PAGES_DIR, DELIVERABLES_DIR):
    directory.mkdir(parents=True, exist_ok=True)
