"""Page images for the evidence viewer (pypdfium2, Apache-2.0/BSD) — cached on disk."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from ..config import PAGE_RENDER_SCALE, PAGES_DIR

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}


def page_count(path: Path) -> int:
    if path.suffix.lower() == ".pdf":
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(str(path))
        try:
            return len(pdf)
        finally:
            pdf.close()
    if path.suffix.lower() in IMAGE_EXTS:
        with Image.open(path) as image:
            return getattr(image, "n_frames", 1)
    return 0


def page_text_lengths(path: Path) -> list[int]:
    """Characters in each page's text layer; ~0 means a scanned page that needs OCR."""
    if path.suffix.lower() != ".pdf":
        return []
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(path))
    try:
        lengths = []
        for index in range(len(pdf)):
            page = pdf[index]
            textpage = page.get_textpage()
            lengths.append(len((textpage.get_text_range() or "").strip()))
            textpage.close()
            page.close()
        return lengths
    finally:
        pdf.close()


def render_page(path: Path, sha: str, page_no: int) -> bytes | None:
    """PNG bytes for 1-based `page_no`; None when the file type has no pages."""
    cache = PAGES_DIR / sha / f"{page_no}.png"
    if cache.exists():
        return cache.read_bytes()
    ext = path.suffix.lower()
    image: Image.Image | None = None
    if ext == ".pdf":
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(str(path))
        try:
            if not 1 <= page_no <= len(pdf):
                return None
            page = pdf[page_no - 1]
            image = page.render(scale=PAGE_RENDER_SCALE).to_pil()
            page.close()
        finally:
            pdf.close()
    elif ext in IMAGE_EXTS:
        with Image.open(path) as source:
            if page_no > 1:
                source.seek(page_no - 1)
            image = source.convert("RGB")
    if image is None:
        return None
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    data = buffer.getvalue()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(data)
    return data


def crop(png: bytes, bbox: list[float], pad: float = 0.01) -> bytes:
    """Crop a normalised [x0,y0,x1,y1] region from a rendered page."""
    with Image.open(io.BytesIO(png)) as image:
        w, h = image.size
        x0, y0, x1, y1 = bbox
        box = (
            max(0, int((x0 - pad) * w)),
            max(0, int((y0 - pad) * h)),
            min(w, int((x1 + pad) * w)),
            min(h, int((y1 + pad) * h)),
        )
        out = io.BytesIO()
        image.crop(box).save(out, format="PNG")
        return out.getvalue()
