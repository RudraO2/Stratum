"""Mapping + cells → candidate facts. The value is always the cell's own digits."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .. import domain
from ..ingest.cues import Table

SKIP_LABEL = re.compile(r"^\s*(s\.?\s*no\.?|sl\.?\s*no\.?|sr\.?\s*no\.?|particulars|name of|subsidiary|company|state|item|description)\s*$", re.I)


@dataclass
class Candidate:
    entity_code: str
    entity_type: str
    entity_raw: str
    metric: str
    value: float
    unit: str
    period: str
    period_kind: str
    is_provisional: bool
    row: int
    col: int
    raw_text: str
    raw_unit: str
    conversion: str | None
    series_kind: str
    checks: list[dict] = field(default_factory=list)


def _metric_for(series: dict) -> str:
    metric = series.get("metric") or "other"
    kind = series.get("kind")
    if kind == "growth_pct":
        return "growth_pct"
    if kind == "achievement_pct":
        return "achievement_pct"
    if kind == "target":
        return {"coal_production": "production_target", "coal_offtake": "offtake_target"}.get(metric, metric)
    return metric


def extract(table: Table, mapping: dict) -> list[Candidate]:
    if not mapping.get("is_data_table"):
        return []
    grid = table.grid()
    table_unit = domain.resolve_unit(mapping.get("unit")) or domain.resolve_unit(table.caption) or domain.resolve_unit(table.context)
    provisional_table = bool(mapping.get("provisional"))
    entity_index = int(mapping.get("entity_index", 0))
    first = int(mapping.get("first_data_index", 1))
    rows_mode = mapping.get("orientation", "entities_in_rows") == "entities_in_rows"

    out: list[Candidate] = []
    for series in mapping.get("series", []):
        metric = _metric_for(series)
        if metric == "other" or domain.metric(metric) is None:
            continue
        period = domain.parse_period(series.get("period")) or domain.parse_period(series.get("header"))
        if period is None:
            if metric in {"growth_pct", "achievement_pct"}:
                period = domain.parse_period(table.caption) or ("", "raw")
            else:
                continue
        header = f"{series.get('header', '')} {series.get('period', '')}"
        unit = domain.resolve_unit(header) or table_unit
        canonical_unit = domain.metric(metric)["unit"]
        if metric in {"growth_pct", "achievement_pct"}:
            unit = domain.UnitMatch("percent", "percent", 1.0)
        provisional = provisional_table or bool(re.search(r"\(p\)|prov|provisional|\*", header, re.I))
        index = int(series.get("index", -1))
        span = range(first, table.n_rows) if rows_mode else range(first, table.n_cols)
        for other in span:
            r, c = (other, index) if rows_mode else (index, other)
            label = grid[other][entity_index] if rows_mode else grid[entity_index][other]
            if not (0 <= r < table.n_rows and 0 <= c < table.n_cols):
                continue
            raw = grid[r][c]
            value = domain.parse_number(raw)
            if value is None or not label.strip() or SKIP_LABEL.match(label):
                continue
            resolved = domain.resolve_entity(label)
            if resolved is None:
                if re.fullmatch(r"[\d\s.()]+", label):
                    continue
                code, etype = f"RAW:{label.strip()[:60]}", "other"
            else:
                code, etype = resolved.code, resolved.type
            ocr_note = None
            if re.search(r"[.,:;|_]\s*$", raw.strip()):
                ocr_note = {"check": "ocr_cleanup", "result": "warn", "detail": f"the cell reads “{raw.strip()}” — a trailing mark, typical of OCR, was ignored; read as {value:g}"}
            converted = value * unit.factor if (unit and unit.canonical == canonical_unit) else value
            out.append(
                Candidate(
                    entity_code=code,
                    entity_type=etype,
                    entity_raw=label.strip(),
                    metric=metric,
                    value=round(converted, 6),
                    unit=canonical_unit if (unit and unit.canonical == canonical_unit) else (unit.canonical if unit else canonical_unit),
                    period=period[0],
                    period_kind=period[1],
                    is_provisional=provisional,
                    row=r,
                    col=c,
                    raw_text=raw,
                    raw_unit=unit.raw if unit else "",
                    conversion=unit.conversion if unit else None,
                    series_kind=series.get("kind", "actual"),
                    checks=[ocr_note] if ocr_note else [],
                )
            )
    return out
