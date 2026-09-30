"""CUES blocks → retrieval chunks.

Chunks never cross a page (so a citation is one page) and each carries its
heading path as a prefix (so "Production › Subsidiary-wise" context survives
retrieval — the useful half of hierarchical indexes, for free). Tables also
become chunks, rendered as pipe rows, so a narrative question can still find
the table that answers it.
"""

from __future__ import annotations

from .cues import ParsedDocument

TARGET_CHARS = 900
MAX_CHARS = 1400


def _union(boxes: list[list[float] | None]) -> list[float] | None:
    real = [b for b in boxes if b]
    if not real:
        return None
    return [min(b[0] for b in real), min(b[1] for b in real), max(b[2] for b in real), max(b[3] for b in real)]


def chunk(parsed: ParsedDocument) -> list[dict]:
    chunks: list[dict] = []
    current: list = []
    current_len = 0

    def flush():
        nonlocal current, current_len
        if not current:
            return
        text = "\n".join(b.text for b in current).strip()
        if len(text) >= 25:
            chunks.append(
                {
                    "page_no": current[0].page_no,
                    "heading_path": current[-1].heading_path,
                    "text": text,
                    "bbox": _union([b.bbox for b in current]),
                    "kind": "figure" if any(b.kind == "figure_description" for b in current) else "text",
                    "table_ordinal": None,
                }
            )
        current, current_len = [], 0

    for block in parsed.blocks:
        if block.kind == "heading":
            flush()
            current = [block]
            current_len = len(block.text)
            continue
        same_page = not current or current[0].page_no == block.page_no
        same_section = not current or current[-1].heading_path == block.heading_path or current[-1].kind == "heading"
        if not same_page or not same_section or current_len + len(block.text) > MAX_CHARS:
            flush()
        current.append(block)
        current_len += len(block.text)
        if current_len >= TARGET_CHARS:
            flush()
    flush()

    for ordinal, table in enumerate(parsed.tables):
        grid = table.grid()
        lines = [" | ".join(cell for cell in row) for row in grid]
        head = table.caption or table.context[-200:]
        body = "\n".join(lines)
        for start in range(0, max(1, len(lines)), 25):
            part = "\n".join(lines[start : start + 25])
            if not part.strip():
                continue
            chunks.append(
                {
                    "page_no": table.page_no,
                    "heading_path": table.heading_path,
                    "text": f"{head}\n{part}".strip() if head else part,
                    "bbox": table.bbox,
                    "kind": "table",
                    "table_ordinal": ordinal,
                }
            )
        del body
    return chunks
