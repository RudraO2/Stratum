"""Docling → CUES.

Docling (MIT) gives layout, reading order, headings, TableFormer table
structure with per-cell boxes, and OCR for pages with no text layer. We keep
its provenance (page number + bounding box) on every block and every cell, and
convert boxes to page-normalised top-left coordinates for the viewer.

Large PDFs are converted in page batches: the parse backend holds native
memory per page, and a 16 GB laptop is not a server.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

from .cues import Block, Cell, Page, ParsedDocument, Picture, Table
from .render import page_count, page_text_lengths

log = logging.getLogger("stratum.docling")

BATCH_PAGES = 25


def _version() -> str:
    try:
        from importlib.metadata import version

        return version("docling")
    except Exception:  # noqa: BLE001
        return "unknown"


@lru_cache(maxsize=2)
def _converter(ocr: bool):
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
    from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption

    options = PdfPipelineOptions()
    options.do_ocr = ocr
    options.do_table_structure = True
    options.table_structure_options.mode = TableFormerMode.ACCURATE
    options.table_structure_options.do_cell_matching = True
    try:
        from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions

        options.accelerator_options = AcceleratorOptions(num_threads=6, device=AcceleratorDevice.CPU)
    except Exception:  # noqa: BLE001 — older/newer module layout; defaults are fine
        pass
    # OCR engine: Docling's auto selection (whichever engine is installed).
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=options),
            InputFormat.IMAGE: ImageFormatOption(pipeline_options=options),
        }
    )


def _norm_bbox(bbox, page_w: float | None, page_h: float | None) -> list[float] | None:
    if bbox is None or not page_w or not page_h:
        return None
    try:
        top_left = bbox.to_top_left_origin(page_height=page_h)
        l, t, r, b = top_left.l, top_left.t, top_left.r, top_left.b
    except Exception:  # noqa: BLE001
        l, t, r, b = bbox.l, bbox.t, bbox.r, bbox.b
    x0, x1 = sorted((l / page_w, r / page_w))
    y0, y1 = sorted((t / page_h, b / page_h))
    clamp = lambda v: max(0.0, min(1.0, float(v)))  # noqa: E731
    return [round(clamp(x0), 5), round(clamp(y0), 5), round(clamp(x1), 5), round(clamp(y1), 5)]


def _label(item) -> str:
    label = getattr(item, "label", None)
    return str(getattr(label, "value", label) or "").lower()


def _convert_one(path: Path, ocr: bool, page_range: tuple[int, int] | None):
    converter = _converter(ocr)
    if page_range:
        return converter.convert(str(path), page_range=page_range).document
    return converter.convert(str(path)).document


def parse(path: Path) -> ParsedDocument:
    ext = path.suffix.lower()
    text_lengths = page_text_lengths(path) if ext == ".pdf" else []
    scanned = {i + 1 for i, n in enumerate(text_lengths) if n < 30}
    is_image = ext in {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
    need_ocr = is_image or bool(scanned)

    total = page_count(path) if ext == ".pdf" else 0
    ranges: list[tuple[int, int] | None]
    if total > BATCH_PAGES:
        ranges = [(start, min(start + BATCH_PAGES - 1, total)) for start in range(1, total + 1, BATCH_PAGES)]
    else:
        ranges = [None]

    parsed = ParsedDocument(parser="docling", parser_version=_version())
    pages: dict[int, Page] = {}
    heading_stack: list[tuple[int, str]] = []

    for page_range in ranges:
        doc = _convert_one(path, need_ocr, page_range)
        if not parsed.title:
            parsed.title = getattr(doc, "name", "") or ""
        for page_no, page in (getattr(doc, "pages", {}) or {}).items():
            size = getattr(page, "size", None)
            pages[int(page_no)] = Page(
                page_no=int(page_no),
                width=getattr(size, "width", None),
                height=getattr(size, "height", None),
                has_text_layer=int(page_no) not in scanned and not is_image,
                ocr_used=int(page_no) in scanned or is_image,
            )

        def page_dims(page_no: int | None):
            page = pages.get(page_no or -1)
            return (page.width, page.height) if page else (None, None)

        recent_text: list[str] = []
        for item, level in doc.iterate_items():
            label = _label(item)
            prov = (getattr(item, "prov", None) or [None])[0]
            page_no = int(getattr(prov, "page_no", 0) or 0) or None
            w, h = page_dims(page_no)
            bbox = _norm_bbox(getattr(prov, "bbox", None), w, h)

            if label in {"section_header", "title"}:
                text = (getattr(item, "text", "") or "").strip()
                if not text:
                    continue
                depth = int(getattr(item, "level", level) or 1)
                heading_stack = [(d, t) for d, t in heading_stack if d < depth]
                heading_stack.append((depth, text))
                if label == "title" and not parsed.title:
                    parsed.title = text
                parsed.blocks.append(Block(page_no, "heading", text, " › ".join(t for _, t in heading_stack), bbox))
                recent_text.append(text)
                continue

            heading_path = " › ".join(t for _, t in heading_stack)

            if label == "table":
                table = _table_from(item, doc, page_no, w, h, bbox, heading_path, recent_text)
                if table is not None:
                    parsed.tables.append(table)
                continue

            if label in {"picture", "chart"}:
                if page_no and bbox:
                    caption = ""
                    try:
                        caption = item.caption_text(doc) or ""
                    except Exception:  # noqa: BLE001
                        pass
                    parsed.pictures.append(Picture(page_no, bbox, caption))
                continue

            text = (getattr(item, "text", "") or "").strip()
            if not text:
                continue
            kind = {"caption": "caption", "list_item": "list", "footnote": "footnote", "page_header": "furniture", "page_footer": "furniture"}.get(label, "text")
            if kind == "furniture":
                continue
            parsed.blocks.append(Block(page_no, kind, text, heading_path, bbox, source="ocr" if page_no in scanned else "parser"))
            recent_text.append(text)
            recent_text[:] = recent_text[-4:]

    parsed.pages = [pages[k] for k in sorted(pages)]
    return parsed


def _table_from(item, doc, page_no, w, h, bbox, heading_path, recent_text) -> Table | None:
    data = getattr(item, "data", None)
    if data is None:
        return None
    n_rows = int(getattr(data, "num_rows", 0) or 0)
    n_cols = int(getattr(data, "num_cols", 0) or 0)
    if n_rows == 0 or n_cols == 0:
        return None
    cells: list[Cell] = []
    for tc in getattr(data, "table_cells", []) or []:
        text = (getattr(tc, "text", "") or "").strip()
        cell_bbox = _norm_bbox(getattr(tc, "bbox", None), w, h)
        r0 = int(getattr(tc, "start_row_offset_idx", 0))
        r1 = int(getattr(tc, "end_row_offset_idx", r0 + 1))
        c0 = int(getattr(tc, "start_col_offset_idx", 0))
        c1 = int(getattr(tc, "end_col_offset_idx", c0 + 1))
        header = bool(getattr(tc, "column_header", False))
        # A spanning cell is repeated into every grid slot it covers, so each
        # slot has a text and a box — "2023-24" spanning two sub-columns is the
        # period of both.
        for r in range(r0, max(r1, r0 + 1)):
            for c in range(c0, max(c1, c0 + 1)):
                cells.append(Cell(r, c, text, header, cell_bbox, page_no))
    caption = ""
    try:
        caption = item.caption_text(doc) or ""
    except Exception:  # noqa: BLE001
        pass
    return Table(
        page_no=page_no,
        n_rows=n_rows,
        n_cols=n_cols,
        cells=cells,
        caption=caption,
        heading_path=heading_path,
        context=" ".join(recent_text[-3:])[-600:],
        bbox=bbox,
    )
