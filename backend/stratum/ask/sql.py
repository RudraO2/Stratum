"""QueryIntent → parameterised lookups → an answer table. No model writes SQL.

Each cell is the canonical fact for (metric, entity, period) with its id, so
every number in the table carries a citation back to its source cell.
"""

from __future__ import annotations

from .. import domain
from ..facts import service as facts
from .intent import TARGET_OF, QueryIntent


def _cell(fact: dict) -> dict:
    return {
        "fact_id": fact["id"],
        "value": fact["value"],
        "display": domain.format_value(fact["value"], fact["unit"]),
        "status": fact["status"],
        "provisional": bool(fact["is_provisional"]),
        "reviewed": bool(fact["reviewed"]),
    }


def _row(code: str, cells: list, change: float | None, gap: float | None = None) -> dict:
    entity = domain.entity(code)
    return {
        "entity_code": code,
        "entity": entity.name if entity else code,
        "short": code if entity and entity.type in {"subsidiary", "company"} else (entity.name if entity else code),
        "cells": cells,
        "change_pct": change,
        "gap": gap,
    }


def run(intent: QueryIntent) -> dict:
    if intent.achievement:
        return _run_achievement(intent)
    metric_info = domain.metric(intent.metric) or {"label": intent.metric, "unit": ""}
    rows = []
    used: list[dict] = []
    derived: list[float] = []
    for code in intent.entities:
        cells = []
        values = []
        for period in intent.periods:
            fact = facts.canonical(intent.metric, code, period)
            if fact is None:
                cells.append(None)
                values.append(None)
                continue
            used.append(fact)
            values.append(fact["value"])
            cells.append(_cell(fact))
        change = None
        if len(values) >= 2 and values[0] and values[-1] is not None:
            change = round((values[-1] - values[0]) / values[0] * 100, 2)
            derived += [change, round(values[-1] - values[0], 2)]
        if any(cells):
            rows.append(_row(code, cells, change))
    # Sums the composer may legitimately state ("CIL subsidiaries together produced ...").
    for index in range(len(intent.periods)):
        column = [r["cells"][index]["value"] for r in rows if r["cells"][index] and r["entity_code"] in domain.cil_subsidiaries()]
        if len(column) >= 2:
            derived.append(round(sum(column), 2))
    unit = used[0]["unit"] if used else metric_info.get("unit", "")
    return {
        "title": f"{metric_info.get('label', intent.metric)} ({domain.unit_label(unit)})",
        "kind": "values",
        "metric": intent.metric,
        "unit": unit,
        "unit_label": domain.unit_label(unit),
        "periods": intent.periods,
        "rows": rows,
        "show_change": len(intent.periods) >= 2,
        "change_label": "Change %",
        "facts": used,
        "derived": derived,
        "missing": sum(1 for r in rows for c in r["cells"] if c is None) + (len(intent.entities) - len(rows)) * len(intent.periods),
    }


def _run_achievement(intent: QueryIntent) -> dict:
    """Target and actual side by side, with the achievement % and the gap computed here (not by a model)."""
    target_key = TARGET_OF.get(intent.metric, "production_target")
    metric_info = domain.metric(intent.metric) or {"label": intent.metric, "unit": ""}
    rows, used, derived = [], [], []
    columns = [label for period in intent.periods for label in (f"Target {period}", f"Actual {period}")]
    for code in intent.entities:
        cells, last = [], None
        for period in intent.periods:
            target = facts.canonical(target_key, code, period)
            actual = facts.canonical(intent.metric, code, period)
            for fact in (target, actual):
                cells.append(_cell(fact) if fact else None)
                if fact:
                    used.append(fact)
            if target and actual and target["value"]:
                last = (round(actual["value"] / target["value"] * 100, 2), round(actual["value"] - target["value"], 2))
                derived += [last[0], last[1], abs(last[1])]
        if any(cells):
            rows.append(_row(code, cells, last[0] if last else None, last[1] if last else None))
    unit = used[0]["unit"] if used else metric_info.get("unit", "")
    return {
        "title": f"{metric_info.get('label', intent.metric)}: target vs actual ({domain.unit_label(unit)})",
        "kind": "achievement",
        "metric": intent.metric,
        "unit": unit,
        "unit_label": domain.unit_label(unit),
        "periods": columns,
        "rows": rows,
        "show_change": True,
        "change_label": "Achievement %",
        "facts": used,
        "derived": derived,
        "missing": sum(1 for r in rows for c in r["cells"] if c is None) + (len(intent.entities) - len(rows)) * len(columns),
    }


def to_markdown(table: dict, cite_for: dict[int, int]) -> str:
    """The table as the composer sees it: every value tagged with its citation number."""
    header = ["Entity", *table["periods"]] + ([table.get("change_label", "Change %")] if table["show_change"] else [])
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    achievement = table.get("kind") == "achievement"
    for row in table["rows"]:
        cells = []
        for cell in row["cells"]:
            if cell is None:
                cells.append("not available")
            else:
                mark = " (provisional)" if cell["provisional"] else ""
                cells.append(f"{cell['display']}{mark} [{cite_for.get(cell['fact_id'], '?')}]")
        if table["show_change"]:
            pct = row["change_pct"]
            extra = ["—" if pct is None else (f"{pct:.2f}%" if achievement else f"{pct:+.2f}%")]
        else:
            extra = []
        lines.append("| " + " | ".join([row["short"], *cells, *extra]) + " |")
    return "\n".join(lines)
