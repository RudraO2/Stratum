"""The fact layer's read side: canonical values, lineage, the review queue."""

from __future__ import annotations

import time

from .. import db, domain
from .validate import recompute_status, store_checks

STATUS_RANK = {"verified": 3, "consistent": 2, "flagged": 1, "rejected": -1}

CANONICAL_ORDER = """
    CASE WHEN f.reviewed = 1 AND f.status != 'rejected' THEN 0 ELSE 1 END,
    CASE f.status WHEN 'verified' THEN 0 WHEN 'consistent' THEN 1 WHEN 'flagged' THEN 2 ELSE 3 END,
    f.is_provisional ASC,
    d.precedence DESC,
    d.ingested_at DESC
"""


def canonical(metric: str, entity_code: str, period: str) -> dict | None:
    """The one value Stratum reports for a key: reviewed > verified > final > higher-precedence source > newest."""
    return db.row(
        f"""SELECT f.*, d.filename, d.doc_kind, d.precedence FROM facts f JOIN documents d ON d.id = f.document_id
            WHERE f.metric=? AND f.entity_code=? AND f.period=? AND f.status != 'rejected'
            ORDER BY {CANONICAL_ORDER} LIMIT 1""",
        (metric, entity_code, period),
    )


def alternatives(fact: dict) -> list[dict]:
    """Other sources for the same key that disagree with the canonical value.

    Deliberately tight (beyond rounding): a ministry answering Parliament cares that 186.9 was told
    to the House where 187.0 is now on file, even though cross-source *verification* tolerates 0.5%."""
    others = db.rows(
        """SELECT f.id, f.value, f.unit, f.is_provisional, f.status, d.filename, d.doc_kind, d.pq_house, d.pq_number, d.pq_date
           FROM facts f JOIN documents d ON d.id=f.document_id
           WHERE f.metric=? AND f.entity_code=? AND f.period=? AND f.id != ? AND f.status != 'rejected'""",
        (fact["metric"], fact["entity_code"], fact["period"], fact["id"]),
    )
    tolerance = max(0.0002 * abs(fact["value"]), 0.05)
    return [o for o in others if abs(o["value"] - fact["value"]) > tolerance]


def lineage(fact_id: int) -> dict | None:
    fact = db.row(
        """SELECT f.*, d.filename, d.sha256, d.doc_kind, d.title, d.parser, d.parser_version, d.pq_house, d.pq_number, d.pq_date
           FROM facts f JOIN documents d ON d.id=f.document_id WHERE f.id=?""",
        (fact_id,),
    )
    if fact is None:
        return None
    sources = db.rows("SELECT * FROM fact_sources WHERE fact_id=?", (fact_id,))
    for source in sources:
        source["bbox"] = db.loads(source["bbox"])
        if source.get("table_id"):
            table = db.row("SELECT caption, heading_path, mapping FROM tables_ WHERE id=?", (source["table_id"],))
            if table:
                source["table_caption"] = table["caption"]
                source["heading_path"] = table["heading_path"]
                source["mapping_source"] = (db.loads(table["mapping"], {}) or {}).get("source")
                row_cells = db.rows("SELECT col_idx, text FROM cells WHERE table_id=? AND row_idx=? ORDER BY col_idx", (source["table_id"], source["row_idx"]))
                source["row_text"] = " | ".join(c["text"] for c in row_cells)
                header = db.rows("SELECT row_idx, text FROM cells WHERE table_id=? AND col_idx=? AND row_idx < 3 ORDER BY row_idx", (source["table_id"], source["col_idx"]))
                source["column_header"] = " / ".join(dict.fromkeys(h["text"] for h in header if h["text"]))
    fact["sources"] = sources
    fact["checks"] = db.rows("SELECT check_name, result, detail FROM fact_checks WHERE fact_id=? ORDER BY id", (fact_id,))
    fact["reviews"] = db.rows("SELECT action, old_value, new_value, note, reviewer, at FROM reviews WHERE fact_id=? ORDER BY at", (fact_id,))
    fact["unit_label"] = domain.unit_label(fact["unit"])
    fact["metric_label"] = (domain.metric(fact["metric"]) or {}).get("label", fact["metric"])
    entity = domain.entity(fact["entity_code"])
    fact["entity_name"] = entity.name if entity else fact["entity_raw"]
    fact["alternatives"] = alternatives(fact)
    return fact


def list_facts(status: str | None = None, metric: str | None = None, entity: str | None = None, document_id: int | None = None, limit: int = 500) -> list[dict]:
    clauses, params = ["1=1"], []
    if status:
        clauses.append("f.status = ?")
        params.append(status)
    if metric:
        clauses.append("f.metric = ?")
        params.append(metric)
    if entity:
        clauses.append("f.entity_code = ?")
        params.append(entity)
    if document_id:
        clauses.append("f.document_id = ?")
        params.append(document_id)
    found = db.rows(
        f"""SELECT f.id, f.entity_code, f.entity_raw, f.metric, f.value, f.unit, f.period, f.is_provisional, f.status, f.reviewed,
                   d.filename, d.id AS document_id, s.page_no, s.raw_text, s.bbox,
                   (SELECT GROUP_CONCAT(check_name || ':' || result || ':' || detail, '\n') FROM fact_checks c WHERE c.fact_id=f.id AND c.result IN ('fail','warn')) AS issues
            FROM facts f JOIN documents d ON d.id=f.document_id LEFT JOIN fact_sources s ON s.fact_id=f.id
            WHERE {' AND '.join(clauses)}
            ORDER BY CASE f.status WHEN 'flagged' THEN 0 ELSE 1 END, f.metric, f.period DESC, f.entity_code LIMIT ?""",
        [*params, limit],
    )
    for fact in found:
        fact["bbox"] = db.loads(fact["bbox"])
        fact["unit_label"] = domain.unit_label(fact["unit"])
        fact["issues"] = [dict(zip(("check", "result", "detail"), line.split(":", 2))) for line in (fact["issues"] or "").split("\n") if line]
    return found


def review(fact_id: int, action: str, value: float | None = None, note: str = "", reviewer: str = "reviewer") -> dict:
    fact = db.row("SELECT * FROM facts WHERE id=?", (fact_id,))
    if fact is None:
        raise KeyError(fact_id)
    if action not in {"accept", "edit", "reject"}:
        raise ValueError(action)
    new_value = fact["value"]
    if action == "edit":
        if value is None:
            raise ValueError("edit needs a value")
        new_value = float(value)
    status = {"accept": "verified", "edit": "verified", "reject": "rejected"}[action]
    with db.tx() as conn:
        conn.execute("UPDATE facts SET value=?, status=?, reviewed=1 WHERE id=?", (new_value, status, fact_id))
        conn.execute(
            "INSERT INTO reviews(fact_id, action, old_value, new_value, note, reviewer, at) VALUES (?,?,?,?,?,?,?)",
            (fact_id, action, fact["value"], new_value, note, reviewer, time.time()),
        )
    store_checks(fact_id, [{"check": "human_review", "result": "pass" if action != "reject" else "fail", "detail": f"{action} by {reviewer}" + (f": {note}" if note else "")}])
    db.audit("fact.review", {"fact_id": fact_id, "action": action, "old": fact["value"], "new": new_value}, actor=reviewer)
    return lineage(fact_id)


def summary() -> dict:
    counts = {r["status"]: r["n"] for r in db.rows("SELECT status, COUNT(*) AS n FROM facts GROUP BY status")}
    return {"total": sum(counts.values()), **counts}


__all__ = ["canonical", "lineage", "list_facts", "review", "summary", "recompute_status"]
