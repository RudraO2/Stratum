"""Table → mapping: which column/row is which entity, metric, period and unit.

"The LLM maps, the code extracts." A mapping says *where* the numbers are and
*what they mean*; it never contains a number. Standard coal tables (entities
down the side, financial years across the top) are mapped by deterministic
rules. Only when the rules cannot find an entity axis and a period axis is the
local model asked, under a JSON schema, for the same mapping shape. Either way
the digits are later copied from the cells by `extract.py`.
"""

from __future__ import annotations

import logging
import re

from .. import domain, llm
from ..ingest.cues import Table

log = logging.getLogger("stratum.mapper")

KINDS = ["actual", "target", "growth_pct", "achievement_pct", "other"]


def _is_numeric(text: str) -> bool:
    return domain.parse_number(text) is not None


def _header_depth(grid: list[list[str]]) -> int:
    """Rows at the top that are mostly non-numeric."""
    depth = 0
    for row in grid[:4]:
        filled = [c for c in row if c.strip()]
        if not filled:
            depth += 1
            continue
        numeric = sum(1 for c in filled if _is_numeric(c) and not domain.parse_period(c))
        if numeric / len(filled) < 0.34:
            depth += 1
        else:
            break
    return depth


def _column_header(grid: list[list[str]], depth: int, col: int) -> str:
    parts = []
    for r in range(depth):
        text = grid[r][col].strip()
        if text and text not in parts:
            parts.append(text)
    return " ".join(parts)


def _series_kind(header: str) -> str:
    low = header.lower()
    if re.search(r"growth|% ?change|change ?%|increase|decrease|\bvar", low):
        return "growth_pct"
    if re.search(r"achiev|% of (target|aap)|%\s*ach", low):
        return "achievement_pct"
    if re.search(r"target|aap|\bbe\b|budget", low):
        return "target"
    return "actual"


def table_unit(table: Table) -> domain.UnitMatch | None:
    for source in (table.caption, " ".join(table.grid()[0]) if table.n_rows else "", table.context, table.heading_path):
        match = domain.resolve_unit(source)
        if match and match.canonical != "percent":
            return match
    return None


def table_metric(table: Table) -> str | None:
    # The caption first; then the sentence nearest the table (the end of the context), not the first metric mentioned.
    sentences = re.split(r"(?<=[.!?])\s+", table.context or "")
    context_tail = sentences[-1] if sentences else ""
    for source in (table.caption, context_tail, " ".join(table.grid()[0]) if table.n_rows else "", table.context, table.heading_path):
        found = domain.find_metric(source or "")
        if found and found not in {"growth_pct", "achievement_pct"}:
            return found
    return None

_BASE_OF_TARGET = {"production_target": "coal_production", "offtake_target": "coal_offtake"}
_TARGET_OF_BASE = {v: k for k, v in _BASE_OF_TARGET.items()}


def separate_target_and_actual(series: list[dict]) -> None:
    """A caption like "Production target and achievement" gives every column the target metric.
    When the same table has both Target and Actual columns, Actual measures the base quantity."""
    if not any(s.get("kind") == "target" for s in series):
        return
    for s in series:
        base = _BASE_OF_TARGET.get(s.get("metric"), s.get("metric"))
        if s.get("kind") == "actual":
            s["metric"] = base
        elif s.get("kind") == "target":
            s["metric"] = _TARGET_OF_BASE.get(base, s["metric"])


def rule_mapping(table: Table) -> dict | None:
    grid = table.grid()
    if table.n_rows < 2 or table.n_cols < 2:
        return None
    depth = _header_depth(grid)
    if depth == 0:
        return None  # no header row: a continuation of the previous table (see continuation())
    data_rows = list(range(depth, table.n_rows))
    if not data_rows:
        return None

    # Entities down the side: the column whose data rows most often resolve to a known entity.
    best_col, best_hits = None, 0
    for col in range(min(table.n_cols, 3)):
        hits = sum(1 for r in data_rows if domain.resolve_entity(grid[r][col]))
        if hits > best_hits:
            best_col, best_hits = col, hits
    orientation = "entities_in_rows"
    if best_col is None or best_hits < max(2, len(data_rows) // 3):
        # Entities across the top?
        hits = sum(1 for c in range(table.n_cols) if domain.resolve_entity(grid[0][c]))
        if hits >= max(2, table.n_cols // 3):
            orientation = "entities_in_columns"
        else:
            return None

    unit = table_unit(table)
    metric = table_metric(table)
    series = []
    if orientation == "entities_in_rows":
        for col in range(table.n_cols):
            if col == best_col:
                continue
            header = _column_header(grid, depth, col)
            numeric = sum(1 for r in data_rows if _is_numeric(grid[r][col]))
            if numeric < max(1, len(data_rows) // 3):
                continue
            period = domain.parse_period(header) or domain.parse_period(table.caption) or domain.parse_period(table.context)
            kind = _series_kind(header)
            col_metric = domain.find_metric(header) if domain.find_metric(header) not in {None, "growth_pct", "achievement_pct"} else metric
            if kind == "target" and col_metric == "coal_production":
                col_metric = "production_target"
            series.append({"index": col, "metric": col_metric or "other", "period": period[0] if period else header, "kind": kind, "header": header})
        entity_index, first_data = best_col, depth
    else:
        # periods down the side, entities across the top
        for row in data_rows:
            label = grid[row][0]
            period = domain.parse_period(label)
            if not period:
                continue
            series.append({"index": row, "metric": metric or "other", "period": period[0], "kind": _series_kind(label), "header": label})
        entity_index, first_data = 0, 1

    separate_target_and_actual(series)
    usable =[s for s in series if domain.parse_period(s["period"]) or s["kind"] in {"growth_pct", "achievement_pct"}]
    if not usable or all(s["metric"] == "other" for s in usable):
        return None
    return {
        "source": "rules",
        "is_data_table": True,
        "orientation": orientation,
        "entity_index": entity_index,
        "first_data_index": first_data,
        "unit": unit.raw if unit else "",
        "provisional": bool(re.search(r"provisional|\(p\)|prov\.", f"{table.caption} {table.context} {' '.join(grid[0])}", re.I)),
        "series": series,
    }


MAPPING_SCHEMA = {
    "type": "object",
    "properties": {
        "is_data_table": {"type": "boolean"},
        "orientation": {"type": "string", "enum": ["entities_in_rows", "entities_in_columns"]},
        "entity_index": {"type": "integer"},
        "first_data_index": {"type": "integer"},
        "unit": {"type": "string"},
        "provisional": {"type": "boolean"},
        "series": {
            "type": "array",
            "maxItems": 12,
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "metric": {"type": "string", "enum": [*domain.metric_keys(), "other"]},
                    "period": {"type": "string"},
                    "kind": {"type": "string", "enum": KINDS},
                },
                "required": ["index", "metric", "period", "kind"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["is_data_table", "orientation", "entity_index", "first_data_index", "unit", "provisional", "series"],
    "additionalProperties": False,
}

MAPPING_PROMPT = """You map one table from a Coal India / Ministry of Coal document. Return only JSON.

You never copy numbers. You only say where they are:
- orientation: "entities_in_rows" if subsidiaries/states/companies are listed down the left, else "entities_in_columns".
- entity_index: the column (or row) index holding the entity names.
- first_data_index: the first row (or column) index holding data, after headers.
- series: one item per data column (or row): its index, the metric it measures, the period exactly as written in the header (e.g. "2023-24"), and kind (actual, target, growth_pct, achievement_pct, other).
- unit: the unit exactly as written (e.g. "Million Tonnes", "Lakh Tonnes", "M.Cu.M"); empty string if none.
- provisional: true if the table says figures are provisional.
- is_data_table: false if the table holds no measurable figures (a list of names, a table of contents).
Metrics: coal_production, coal_offtake (despatch/dispatch), obr (overburden removal), production_target, offtake_target, capacity, reserves, resources, manpower, oms, exploration_drilling, growth_pct, achievement_pct, other."""


def _render_for_llm(table: Table, max_rows: int = 18) -> str:
    grid = table.grid()
    lines = [f"Caption: {table.caption or '(none)'}", f"Section: {table.heading_path or '(none)'}", f"Nearby text: {table.context[-300:] or '(none)'}", "", "Table (row index: cells, cells separated by ' | ', column indexes start at 0):"]
    header = " | ".join(f"[{c}]" for c in range(table.n_cols))
    lines.append(f"cols: {header}")
    for r, row in enumerate(grid[:max_rows]):
        lines.append(f"{r}: " + " | ".join(cell[:40] for cell in row))
    if table.n_rows > max_rows:
        lines.append(f"... {table.n_rows - max_rows} more rows")
    return "\n".join(lines)


def llm_mapping(table: Table) -> dict | None:
    try:
        mapping = llm.chat_json(
            [{"role": "system", "content": MAPPING_PROMPT}, {"role": "user", "content": _render_for_llm(table)}],
            MAPPING_SCHEMA,
            schema_name="st_table_mapping",
            max_tokens=700,
        )
    except Exception as error:  # noqa: BLE001
        log.warning("llm mapping failed: %s", error)
        return None
    mapping["source"] = "llm"
    grid = table.grid()
    for series in mapping.get("series", []):
        index = series.get("index", -1)
        if mapping.get("orientation") == "entities_in_rows" and 0 <= index < table.n_cols:
            series["header"] = _column_header(grid, max(1, mapping.get("first_data_index", 1)), index)
        elif 0 <= index < table.n_rows:
            series["header"] = grid[index][0]
    separate_target_and_actual(mapping.get("series", []))
    return mapping


def map_table(table: Table, allow_llm: bool = True) -> dict:
    grid = table.grid()
    numeric_cells = sum(1 for row in grid for cell in row if _is_numeric(cell))
    if numeric_cells < 2:
        return {"source": "rules", "is_data_table": False, "series": [], "reason": "no numeric cells"}
    mapping = rule_mapping(table)
    if mapping is not None:
        return mapping
    if allow_llm:
        mapping = llm_mapping(table)
        if mapping is not None:
            return mapping
    return {"source": "none", "is_data_table": False, "series": [], "reason": "no entity/period axis found"}


def continuation(table: Table, previous: Table | None, previous_mapping: dict | None) -> dict | None:
    """A table with no header right after a mapped table with the same columns continues it (split across pages)."""
    if previous is None or not previous_mapping or not previous_mapping.get("is_data_table"):
        return None
    if table.n_cols != previous.n_cols or _header_depth(table.grid()) != 0:
        return None
    if previous.page_no and table.page_no and table.page_no - previous.page_no > 1:
        return None
    mapping = {**previous_mapping, "first_data_index": 0, "source": f"{previous_mapping.get('source')}+continuation"}
    table.caption = table.caption or f"{previous.caption} (continued)"
    table.context = table.context or previous.context
    return mapping