"""The Metrics tab: every percentage the problem statement asks for, computed.

Nothing here is asserted. Each figure is derived from the gold set
(metrics/gold.yaml) or the system's own logs (jobs, answers, reviews), and each
comes with its denominator so a small sample is visibly small.
"""

from __future__ import annotations

import time
from pathlib import Path

import yaml

from .. import db, domain
from ..ask import intent as intent_mod
from ..ask import sql
from ..facts import service as facts

GOLD_PATH = Path(__file__).with_name("gold.yaml")


def _pct(n: float, d: float) -> float | None:
    return round(100.0 * n / d, 1) if d else None


def gold() -> dict:
    return yaml.safe_load(GOLD_PATH.read_text(encoding="utf-8")) or {}


def extraction(gold_facts: list[dict]) -> dict:
    matched, wrong, missing, caught, details = 0, 0, 0, 0, []
    for g in gold_facts:
        fact = facts.canonical(g["metric"], g["entity"], g["period"])
        if fact is None:
            missing += 1
            details.append({**g, "result": "missing"})
        elif abs(fact["value"] - float(g["value"])) <= max(0.005 * abs(float(g["value"])), 0.011):
            matched += 1
            details.append({**g, "result": "match", "got": fact["value"]})
        else:
            wrong += 1
            flagged = fact["status"] == "flagged" or bool(fact["reviewed"])
            caught += flagged
            details.append({**g, "result": "wrong", "got": fact["value"], "flagged": flagged})
    total = len(gold_facts)
    extracted = matched + wrong
    return {
        "gold": total,
        "matched": matched,
        "wrong": wrong,
        "missing": missing,
        "exact_match_pct": _pct(matched, total),
        "precision_pct": _pct(matched, extracted),
        "recall_pct": _pct(extracted, total),
        # A wrong value that carries a failed check (or was corrected by a person) does not reach an answer unseen.
        "wrong_caught": caught,
        "wrong_caught_pct": _pct(caught, wrong),
        "details": details,
    }


def routing(questions: list[dict]) -> dict:
    right, details = 0, []
    for q in questions:
        got = intent_mod.parse(q["q"]).route
        ok = got == q["route"]
        right += ok
        details.append({"q": q["q"], "expected": q["route"], "got": got, "ok": ok})
    return {"questions": len(questions), "accuracy_pct": _pct(right, len(questions)), "details": details}


def numeric_answers(questions: list[dict]) -> dict:
    """Questions with expected figures: does the SQL route return exactly those figures?"""
    scored = [q for q in questions if q.get("expect")]
    right = 0
    for q in scored:
        parsed = intent_mod.parse(q["q"])
        table = sql.run(parsed) if parsed.metric else {"rows": []}
        values = [c["value"] for r in table["rows"] for c in r["cells"] if c] + list(table.get("derived", []))
        if all(any(abs(v - float(e)) <= max(0.005 * abs(float(e)), 0.011) for v in values) for e in q["expect"]):
            right += 1
    return {"questions": len(scored), "correct_pct": _pct(right, len(scored))}


def lineage_integrity() -> dict:
    """Citation correctness: the cited cell's own text must parse to the stored value (before unit conversion)."""
    found = db.rows(
        "SELECT f.value, f.reviewed, s.raw_text, s.conversion FROM facts f JOIN fact_sources s ON s.fact_id=f.id WHERE f.status != 'rejected'"
    )
    ok = 0
    for r in found:
        raw = domain.parse_number(r["raw_text"])
        if raw is None:
            continue
        factor = 1.0
        if r["conversion"]:
            try:
                factor = float(r["conversion"].split("×")[1].split("→")[0])
            except (IndexError, ValueError):
                factor = 1.0
        if r["reviewed"] or abs(raw * factor - r["value"]) <= max(1e-6, 1e-6 * abs(r["value"])):
            ok += 1
    return {"facts": len(found), "citation_correct_pct": _pct(ok, len(found))}


def guard_stats() -> dict:
    row = db.row("SELECT COUNT(*) AS answers, COALESCE(SUM(numbers),0) AS numbers, COALESCE(SUM(unsupported),0) AS unsupported, AVG(seconds) AS avg_s FROM answers") or {}
    return {
        "answers": row.get("answers", 0),
        "numbers_checked": row.get("numbers", 0),
        "unsupported": row.get("unsupported", 0),
        "unsupported_rate_pct": _pct(row.get("unsupported", 0), row.get("numbers", 0)),
        "avg_seconds": round(row["avg_s"], 1) if row.get("avg_s") else None,
    }


def automation() -> dict:
    """Share of repetitive steps done without a person: pipeline steps + facts that needed no review."""
    steps = 0
    for job in db.rows("SELECT steps FROM jobs WHERE status='done' AND steps IS NOT NULL"):
        steps += sum(1 for s in db.loads(job["steps"], []) if s.get("automated"))
    fact_total = db.scalar("SELECT COUNT(*) FROM facts") or 0
    needing_review = db.scalar("SELECT COUNT(*) FROM facts WHERE status='flagged' OR reviewed=1") or 0
    reviews = db.scalar("SELECT COUNT(*) FROM reviews") or 0
    auto_facts = fact_total - needing_review
    automated = steps + auto_facts
    manual = reviews + (db.scalar("SELECT COUNT(*) FROM facts WHERE status='flagged' AND reviewed=0") or 0)
    return {
        "automated_steps": automated,
        "manual_steps": manual,
        "automation_pct": _pct(automated, automated + manual),
        "facts_auto_accepted_pct": _pct(auto_facts, fact_total),
        "facts": fact_total,
        "reviews": reviews,
    }


def time_reduction(trials: list[dict]) -> dict:
    measured = [t for t in trials if t.get("manual_minutes") and t.get("assisted_minutes")]
    manual = sum(float(t["manual_minutes"]) for t in measured)
    assisted = sum(float(t["assisted_minutes"]) for t in measured)
    pq = db.row("SELECT COUNT(*) AS n, AVG(seconds) AS s FROM answers WHERE kind='pq'") or {}
    return {
        "trials": len(measured),
        "reduction_pct": _pct(manual - assisted, manual),
        "manual_minutes": manual or None,
        "assisted_minutes": assisted or None,
        "pq_drafts": pq.get("n", 0),
        "avg_pq_draft_seconds": round(pq["s"], 1) if pq.get("s") else None,
        "details": measured,
    }


def compute() -> dict:
    g = gold()
    library = db.row(
        "SELECT COUNT(*) AS documents, COALESCE(SUM(pages),0) AS pages, SUM(CASE WHEN status='ready' THEN 1 ELSE 0 END) AS ready FROM documents"
    ) or {}
    return {
        "computed_at": time.time(),
        "library": {**library, "chunks": db.scalar("SELECT COUNT(*) FROM chunks") or 0, "tables": db.scalar("SELECT COUNT(*) FROM tables_") or 0, "facts": facts.summary()},
        "extraction": extraction(g.get("facts") or []),
        "routing": routing(g.get("questions") or []),
        "numeric_answers": numeric_answers(g.get("questions") or []),
        "lineage": lineage_integrity(),
        "guard": guard_stats(),
        "automation": automation(),
        "time": time_reduction(g.get("trials") or []),
    }
