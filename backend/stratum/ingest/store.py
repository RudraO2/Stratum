"""Content-addressed, write-once store for original files.

The sha256 of the bytes is the identity: the same report uploaded twice is one
document, and an original is never modified after it lands.
"""

from __future__ import annotations

import hashlib
import mimetypes
from pathlib import Path

from ..config import STORE_DIR

SUPPORTED = {".pdf", ".docx", ".pptx", ".xlsx", ".xls", ".csv", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".html", ".htm", ".md", ".txt"}


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def put(data: bytes, filename: str) -> tuple[str, Path]:
    digest = sha256_of(data)
    ext = Path(filename).suffix.lower()
    target = STORE_DIR / digest[:2] / f"{digest}{ext}"
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(target.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(target)
        try:
            target.chmod(0o444)  # immutable original
        except OSError:
            pass
    return digest, target


def mime_of(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"
