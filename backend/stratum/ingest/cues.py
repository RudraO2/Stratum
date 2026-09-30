"""CUES — the CIL Unified Evidence Schema.

Whatever the source (Docling on a PDF, pandas on a spreadsheet, the vision
model on a bad scan), a parsed document becomes this one shape before anything
else touches it. Coordinates are always normalised to the page (0..1, origin
top-left), so the viewer can draw a box over any rendered page at any scale.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

SCHEMA_VERSION = "cues/1.0"


@dataclass
class Block:
    page_no: int | None
    kind: str  # text | heading | caption | list | footnote | figure_description | title
    text: str
    heading_path: str = ""
    bbox: list[float] | None = None
    source: str = "parser"  # parser | ocr | vlm


@dataclass
class Cell:
    row: int
    col: int
    text: str
    is_header: bool = False
    bbox: list[float] | None = None
    page_no: int | None = None


@dataclass
class Table:
    page_no: int | None
    n_rows: int
    n_cols: int
    cells: list[Cell]
    caption: str = ""
    heading_path: str = ""
    context: str = ""  # nearby text: where units such as "(in Million Tonnes)" usually hide
    bbox: list[float] | None = None

    def grid(self) -> list[list[str]]:
        grid = [["" for _ in range(self.n_cols)] for _ in range(self.n_rows)]
        for cell in self.cells:
            if 0 <= cell.row < self.n_rows and 0 <= cell.col < self.n_cols:
                grid[cell.row][cell.col] = cell.text
        return grid

    def cell_at(self, row: int, col: int) -> Cell | None:
        for cell in self.cells:
            if cell.row == row and cell.col == col:
                return cell
        return None


@dataclass
class Picture:
    page_no: int
    bbox: list[float]
    caption: str = ""


@dataclass
class Page:
    page_no: int
    width: float | None = None
    height: float | None = None
    has_text_layer: bool = True
    ocr_used: bool = False
    vlm_used: bool = False


@dataclass
class ParsedDocument:
    parser: str
    parser_version: str
    pages: list[Page] = field(default_factory=list)
    blocks: list[Block] = field(default_factory=list)
    tables: list[Table] = field(default_factory=list)
    pictures: list[Picture] = field(default_factory=list)
    title: str = ""

    def text(self, max_chars: int | None = None) -> str:
        out = "\n".join(block.text for block in self.blocks)
        return out[:max_chars] if max_chars else out

    def to_json(self) -> dict:
        return {"schema_version": SCHEMA_VERSION, **asdict(self)}
