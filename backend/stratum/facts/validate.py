"""Deterministic checks on every extracted fact.

A fact's status is earned from named checks, never from a model's confidence:
  verified   — another independent source agrees, or a reviewer approved it
  consistent — every applicable check passed
  flagged    — a check failed; it goes to the review queue with the reason
"""

from __future__ import annotations

from collections import defaultdict

from .. import db, domain
from .extract import Candidate

TOTAL_CODES = {"CIL", "ALL_INDIA"}


def _check(candidate: Candidate, name: str, result: str, detail: str) -> None:
    candidate.checks.append({"check": name, "result": result, "detail": detail})


def table_checks(candidates: list[Candidate]) -> None:
    for c in candidates:
        info = domain.metric(c.metric) or {}
        if c.metric not in {"growth_pct", "achievement_pct"}:
            if c.raw_unit:
                _check(c, "unit", "pass", f"unit '{c.raw_unit}' → {c.unit}" + (f" ({c.conversion})" if c.conversion else ""))
            else:
                _check(c, "unit", "warn", f"no unit found in header, caption or nearby text; assumed {c.unit}")
        low, high = info.get("range", [None, None])
        if low is not None and not (low <= c.value <= high):
            _check(c, "range", "fail", f"{c.value:g} is outside the plausible range {low}–{high} {c.unit} for {c.metric}")
        elif low is not None:
            _check(c, "range", "pass", f"within {low}–{high}")
        if c.value < 0 and c.metric not in {"growth_pct"}:
            _check(c, "non_negative", "fail", "negative value for a quantity that cannot be negative")
        if c.period_kind == "raw" and c.metric not in {"growth_pct", "achievement_pct"}:
            _check(c, "period", "fail", "period could not be parsed")
        if c.entity_type == "other" and not c.entity_code.lower().startswith("raw:total"):
            _check(c, "entity", "warn", f"'{c.entity_raw}' is not in the master data")

    # Totals: the CIL row must equal the sum of the subsidiary rows in the same column.
    by_column: dict[tuple, list[Candidate]] = defaultdict(list)
    for c in candidates:
        by_column[(c.metric, c.period, c.col if c.col is not None else -1)].append(c)
    subsidiaries = set(domain.cil_subsidiaries())
    for group in by_column.values():
        if group[0].metric in {"growth_pct", "achievement_pct"}:
            continue
        subs = [c for c in group if c.entity_code in subsidiaries]
        total = next((c for c in group if c.entity_code == "CIL"), None)
        if total is None:
            total = next((c for c in group if c.entity_code.lower().startswith("raw:total") or (c.entity_code == "ALL_INDIA" and len(subs) >= 3 and not any(x.entity_code in {"SCCL", "CAPTIVE"} for x in group))), None)
        if total is None or len(subs) < 3:
            continue
        summed = sum(c.value for c in subs)
        tolerance = max(0.006 * abs(total.value), 0.15)
        ok = abs(summed - total.value) <= tolerance
        detail = f"sum of {len(subs)} subsidiaries = {summed:.2f} vs stated total {total.value:.2f}"
        _check(total, "total", "pass" if ok else "fail", detail)
        for c in subs:
            _check(c, "total", "pass" if ok else "warn", detail)
        # All-India = CIL + SCCL + captive/others, when those rows are present too.
    for group in by_column.values():
        parts = {c.entity_code: c for c in group}
        if {"ALL_INDIA", "CIL", "SCCL", "CAPTIVE"} <= parts.keys():
            summed = parts["CIL"].value + parts["SCCL"].value + parts["CAPTIVE"].value
            ok = abs(summed - parts["ALL_INDIA"].value) <= max(0.006 * parts["ALL_INDIA"].value, 0.2)
            _check(parts["ALL_INDIA"], "total", "pass" if ok else "fail", f"CIL + SCCL + captive = {summed:.2f} vs stated {parts['ALL_INDIA'].value:.2f}")

    # Growth: a stated % growth must match the two actual columns beside it.
    actual = defaultdict(dict)
    growth = []
    for c in candidates:
        if c.metric == "growth_pct":
            growth.append(c)
        elif c.series_kind == "actual" and c.period_kind == "fy":
            actual[(c.entity_code, c.metric)][c.period] = c
    for g in growth:
        for (entity_code, metric_key), periods in actual.items():
            if entity_code != g.entity_code or len(periods) < 2:
                continue
            ordered = sorted(periods, key=domain.fy_start)
            prev, last = periods[ordered[-2]], periods[ordered[-1]]
            if prev.value == 0:
                continue
            computed = (last.value - prev.value) / prev.value * 100
            ok = abs(computed - g.value) <= max(0.15, 0.02 * abs(g.value))
            detail = f"stated growth {g.value:.2f}% vs recomputed {computed:.2f}% ({ordered[-2]} → {ordered[-1]})"
            _check(last, "growth", "pass" if ok else "fail", detail)
            _check(g, "growth", "pass" if ok else "fail", detail)
            break

    # Achievement: a stated % must equal actual / target of the same row.
    targets, actuals = {}, {}
    for c in candidates:
        if c.series_kind == "target":
            targets[(c.entity_code, c.period)] = c
        elif c.series_kind == "actual" and c.metric in {"coal_production", "coal_offtake"}:
            actuals[(c.entity_code, c.period)] = c
    for a in (c for c in candidates if c.metric == "achievement_pct"):
        target, actual = targets.get((a.entity_code, a.period)), actuals.get((a.entity_code, a.period))
        if not target or not actual or not target.value:
            continue
        computed = actual.value / target.value * 100
        ok = abs(computed - a.value) <= max(0.15, 0.01 * abs(a.value))
        detail = f"stated achievement {a.value:.2f}% vs recomputed {computed:.2f}% ({actual.value:g} / {target.value:g})"
        for c in (actual, target, a):
            _check(c, "achievement", "pass" if ok else "fail", detail)


def store_checks(fact_id: int, checks: list[dict]) -> None:
    with db.tx() as conn:
        conn.executemany(
            "INSERT INTO fact_checks(fact_id, check_name, result, detail) VALUES (?,?,?,?)",
            [(fact_id, c["check"], c["result"], c["detail"]) for c in checks],
        )


def cross_source(fact_id: int) -> None:
    """Compare a stored fact with the same entity/metric/period from other documents, and with the year before."""
    fact = db.row("SELECT * FROM facts WHERE id=?", (fact_id,))
    if fact is None or fact["metric"] in {"growth_pct", "achievement_pct"}:
        return
    others = db.rows(
        """SELECT f.id, f.value, f.is_provisional, d.filename, d.doc_kind FROM facts f JOIN documents d ON d.id=f.document_id
           WHERE f.metric=? AND f.entity_code=? AND f.period=? AND f.document_id != ? AND f.status != 'rejected'""",
        (fact["metric"], fact["entity_code"], fact["period"], fact["document_id"]),
    )
    checks = []
    agree = 0
    for other in others:
        tolerance = max(0.005 * abs(fact["value"]), 0.05)
        if abs(other["value"] - fact["value"]) <= tolerance:
            agree += 1
            checks.append({"check": "cross_source", "result": "pass", "detail": f"agrees with {other['filename']} ({other['value']:g})"})
            source = db.row("SELECT d.filename FROM documents d WHERE d.id=?", (fact["document_id"],)) or {"filename": "another document"}
            store_checks(other["id"], [{"check": "cross_source", "result": "pass", "detail": f"agrees with {source['filename']} ({fact['value']:g})"}])
        else:
            provisional = bool(other["is_provisional"]) != bool(fact["is_provisional"])
            checks.append(
                {
                    "check": "cross_source",
                    "result": "warn" if provisional else "fail",
                    "detail": f"{other['filename']} ({other['doc_kind']}) states {other['value']:g}"
                    + (" — provisional vs final figure" if provisional else ""),
                }
            )
    if fact["period_kind"] == "fy":
        prev = db.row(
            "SELECT value FROM facts WHERE metric=? AND entity_code=? AND period=? AND status != 'rejected' ORDER BY is_provisional LIMIT 1",
            (fact["metric"], fact["entity_code"], domain.fy_label(domain.fy_start(fact["period"]) - 1)),
        )
        if prev and prev["value"]:
            change = (fact["value"] - prev["value"]) / prev["value"] * 100
            checks.append({"check": "year_on_year", "result": "warn" if abs(change) > 45 else "pass", "detail": f"{change:+.1f}% vs previous year ({prev['value']:g})"})
    if checks:
        store_checks(fact_id, checks)
    recompute_status(fact_id, agree_hint=agree)
    # The other side of an agreement is now verified too.
    for other in others:
        recompute_status(other["id"])


def recompute_status(fact_id: int, agree_hint: int | None = None) -> str:
    fact = db.row("SELECT status, reviewed FROM facts WHERE id=?", (fact_id,))
    if fact is None:
        return "missing"
    if fact["reviewed"]:
        return fact["status"]
    checks = db.rows("SELECT check_name, result FROM fact_checks WHERE fact_id=?", (fact_id,))
    if any(c["result"] == "fail" for c in checks):
        status = "flagged"
    elif any(c["check_name"] == "cross_source" and c["result"] == "pass" for c in checks) or (agree_hint or 0) > 0:
        status = "verified"
    else:
        status = "consistent"
    db.execute("UPDATE facts SET status=? WHERE id=?", (status, fact_id))
    return status
