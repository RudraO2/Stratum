"""XLSX / CSV → CUES. Each sheet is one table; cell coordinates are the sheet's own."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .cues import Block, Cell, Page, ParsedDocument, Table


def _text(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def parse(path: Path) -> ParsedDocument:
    parsed = ParsedDocument(parser="pandas", parser_version=pd.__version__)
    if path.suffix.lower() == ".csv":
        sheets = {"Sheet1": pd.read_csv(path, header=None, dtype=object)}
    else:
        sheets = pd.read_excel(path, sheet_name=None, header=None, dtype=object)
    for index, (name, frame) in enumerate(sheets.items(), start=1):
        frame = frame.dropna(how="all").dropna(axis=1, how="all")
        if frame.empty:
            continue
        values = frame.values.tolist()
        # Title rows above the grid (one non-empty cell) become the caption.
        caption_lines = []
        while values and sum(1 for v in values[0] if _text(v)) == 1 and len(values) > 2:
            caption_lines.append(next(_text(v) for v in values[0] if _text(v)))
            values.pop(0)
        n_rows, n_cols = len(values), max(len(r) for r in values)
        cells = [
            Cell(r, c, _text(values[r][c]) if c < len(values[r]) else "", is_header=r == 0, bbox=None, page_no=index)
            for r in range(n_rows)
            for c in range(n_cols)
        ]
        caption = " — ".join(caption_lines) or str(name)
        parsed.tables.append(Table(page_no=index, n_rows=n_rows, n_cols=n_cols, cells=cells, caption=caption, heading_path=f"Sheet: {name}", context=caption))
        parsed.blocks.append(Block(index, "heading", caption, f"Sheet: {name}"))
        parsed.pages.append(Page(page_no=index, has_text_layer=True))
    parsed.title = path.stem
    return parsed
