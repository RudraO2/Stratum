"""Ask: question → route → evidence bundle → composed answer → number guard.

The composed answer is the model's prose; the table, the citations and the
guard verdict are ours. When the model is unavailable the answer is written
from the table by a template, so a numerical question still gets its figures.
"""

from __future__ import annotations

import time

from .. import db, domain, llm
from ..config import COMPOSE_MODE
from ..facts import service as facts
from ..search import hybrid
from . import guard, sql
from .intent import QueryIntent, parse

INSUFFICIENT = "Insufficient verified evidence available."
INSUFFICIENT_HI = "पर्याप्त सत्यापित साक्ष्य उपलब्ध नहीं है।"

COMPOSE_PROMPT = """You are Stratum, answering officers of the Ministry of Coal and Coal India from verified evidence only.

Rules:
- Use ONLY the evidence below. Every figure you state must appear in the evidence table or passages, written the same way.
- Put the citation number in square brackets after each figure or claim, e.g. "SECL produced 187.00 MT [2]".
- Be brief and formal: 2–6 sentences. Name units. Say when a figure is provisional.
- If the evidence does not answer the question, reply exactly: "{insufficient}"
- Answer in {language}."""


def _citation_for_fact(n: int, fact: dict) -> dict:
    source = db.row("SELECT page_no, bbox, raw_text, table_id, conversion FROM fact_sources WHERE fact_id=? LIMIT 1", (fact["id"],)) or {}
    entity = domain.entity(fact["entity_code"])
    value = f"{domain.format_value(fact['value'], fact['unit'])} {domain.unit_label(fact['unit'])}".replace("% %", "%")
    cell = f" (cell “{source['raw_text']}”, {source['conversion']})" if source.get("conversion") else ""
    return {
        "n": n,
        "kind": "fact",
        "fact_id": fact["id"],
        "document_id": fact["document_id"],
        "filename": fact["filename"],
        "doc_kind": fact["doc_kind"],
        "page_no": source.get("page_no"),
        "bbox": db.loads(source.get("bbox")),
        "snippet": f"{entity.name if entity else fact['entity_raw']} · {fact['period']} · {value}{cell}",
        "status": fact["status"],
        "provisional": bool(fact["is_provisional"]),
    }


def _citation_for_chunk(n: int, chunk: dict) -> dict:
    label = chunk["filename"]
    if chunk.get("pq_number"):
        label = f"{chunk.get('pq_house') or ''} {chunk['pq_number']} ({chunk.get('pq_date') or ''}) — {chunk['filename']}".strip()
    return {
        "n": n,
        "kind": "passage",
        "chunk_id": chunk["id"],
        "document_id": chunk["document_id"],
        "filename": label,
        "doc_kind": chunk["doc_kind"],
        "page_no": chunk["page_no"],
        "bbox": chunk["bbox"],
        "snippet": chunk["text"][:400],
        "heading_path": chunk["heading_path"],
    }


def _missing_note(table: dict) -> str:
    """Periods asked for that have no figure at all, and entities missing some periods."""
    empty = [p for index, p in enumerate(table["periods"]) if not any(r["cells"][index] for r in table["rows"])]
    partial = [f"{r['short']} ({', '.join(p for p, c in zip(table['periods'], r['cells']) if c is None)})" for r in table["rows"] if any(c is None for c in r["cells"]) and any(r["cells"])]
    notes = []
    if empty:
        notes.append(f"No verified figures for {', '.join(empty)} in the ingested documents.")
    if partial and not empty:
        notes.append("Not available: " + "; ".join(partial) + ".")
    return " ".join(notes)


def _achievement_answer(table: dict, cite_for: dict[int, int]) -> str:
    lines = []
    for row in table["rows"]:
        bits = [f"{label} {cell['display']} {table['unit_label']}{' (provisional)' if cell['provisional'] else ''} [{cite_for[cell['fact_id']]}]" for label, cell in zip(table["periods"], row["cells"]) if cell]
        verdict = ""
        if row["change_pct"] is not None and row["gap"] is not None:
            met = row["gap"] >= 0
            verdict = f" — achievement {row['change_pct']:.2f}%: target {'met' if met else 'not achieved'} ({'surplus' if met else 'shortfall'} of {abs(row['gap']):.2f} {table['unit_label']})"
        else:
            verdict = " — target or actual figure not available, so achievement cannot be stated"
        lines.append(f"- {row['entity']}: " + "; ".join(bits) + verdict)
    return "\n".join(lines)


def _template_answer(table: dict, intent: QueryIntent, cite_for: dict[int, int]) -> str:
    if table.get("kind") == "achievement":
        body = _achievement_answer(table, cite_for)
        return f"{(domain.metric(intent.metric) or {}).get('label', intent.metric)}, target vs actual:\n{body}" if body else ""
    lines = []
    for row in table["rows"]:
        parts = []
        for period, cell in zip(table["periods"], row["cells"]):
            if cell:
                parts.append(f"{cell['display']} {table['unit_label']} in {period}{' (provisional)' if cell['provisional'] else ''} [{cite_for[cell['fact_id']]}]")
        if parts:
            change = f", a change of {row['change_pct']:+.2f}%" if row["change_pct"] is not None else ""
            lines.append(f"- {row['entity']}: " + "; ".join(parts) + change)
    head = (domain.metric(intent.metric) or {}).get("label", intent.metric)
    if not lines:
        return ""
    note = _missing_note(table)
    return f"{head}:\n" + "\n".join(lines) + (f"\n\n{note}" if note else "")


def _join(parts: list[str]) -> str:
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def _reply_answer(table: dict, intent: QueryIntent, cite_for: dict[int, int]) -> str:
    """The same verified figures as formal reply sentences (for Parliament replies and reports)."""
    label = (domain.metric(intent.metric) or {}).get("label", intent.metric or "figure").lower()
    unit = table["unit_label"]
    sentences = []
    for row in table["rows"]:
        if table.get("kind") == "achievement":
            clauses = []
            cells = row["cells"]
            for i in range(0, len(cells), 2):
                period = table["periods"][i].split(" ", 1)[-1]
                target, actual = cells[i], cells[i + 1] if i + 1 < len(cells) else None
                if target and actual:
                    clauses.append(f"the target for {period} was {target['display']} {unit}{' (provisional)' if target['provisional'] else ''} [{cite_for[target['fact_id']]}] against an actual of {actual['display']} {unit}{' (provisional)' if actual['provisional'] else ''} [{cite_for[actual['fact_id']]}]")
                elif target:
                    clauses.append(f"the target for {period} was {target['display']} {unit} [{cite_for[target['fact_id']]}], but no actual figure is available")
                elif actual:
                    clauses.append(f"the actual for {period} was {actual['display']} {unit} [{cite_for[actual['fact_id']]}], but no target is on file")
            if not clauses:
                continue
            if row["change_pct"] is not None and row["gap"] is not None:
                met = row["gap"] >= 0
                tail = f", an achievement of {row['change_pct']:.2f}%; the target was {'met' if met else 'not achieved'} ({'surplus' if met else 'shortfall'} of {abs(row['gap']):.2f} {unit})"
            else:
                tail = "; the achievement cannot be stated as a figure is not available"
            sentences.append(f"For {row['entity']}, {'; '.join(clauses)}{tail}.")
            continue
        parts = [f"{c['display']} {unit} in {p}{' (provisional)' if c['provisional'] else ''} [{cite_for[c['fact_id']]}]" for p, c in zip(table["periods"], row["cells"]) if c]
        if parts:
            sentences.append(f"The {label} of {row['entity']} was {_join(parts)}.")
    note = _missing_note(table)
    return " ".join(sentences) + (f" {note}" if note and sentences else "")


def _needs_prose(table: dict | None, intent: QueryIntent) -> bool:
    """The model writes prose for one figure or for 'why' questions. A grid of figures is stated by the template — a small model reading a table with gaps is where wrong sentences come from."""
    if table is None:
        return True
    if table.get("kind") == "achievement":
        return False  # the verdict (met / not met, shortfall) is arithmetic, stated by the template
    cells = sum(1 for r in table["rows"] for c in r["cells"] if c)
    return intent.explain or (cells <= 1 and not table["missing"])


def ask(question: str, *, k: int = 6, doc_kinds: list[str] | None = None, record: bool = True, context: str = "", style: str = "list") -> dict:
    """`style="reply"` states figures as formal sentences (the PQ builder); `"list"` as a compact list (chat)."""
    started = time.time()
    write = _reply_answer if style == "reply" else _template_answer
    intent = parse(question, context)
    insufficient = INSUFFICIENT_HI if intent.language == "hi" else INSUFFICIENT
    citations: list[dict] = []
    cite_for_fact: dict[int, int] = {}
    table = None
    passages: list[dict] = []
    allowed: list[float] = domain.numbers_in(question)
    discrepancies = []

    if intent.route in {"sql", "sql_rag"}:
        table = sql.run(intent)
        for fact in table["facts"]:
            if fact["id"] in cite_for_fact:
                continue
            n = len(citations) + 1
            cite_for_fact[fact["id"]] = n
            citations.append(_citation_for_fact(n, fact))
            allowed.append(fact["value"])
            for alt in facts.alternatives(fact):
                discrepancies.append(
                    {
                        "entity": fact["entity_code"],
                        "period": fact["period"],
                        "metric": fact["metric"],
                        "reported": fact["value"],
                        "other": alt["value"],
                        "other_source": alt["filename"],
                        "other_kind": alt["doc_kind"],
                        "pq": f"{alt.get('pq_house') or ''} {alt.get('pq_number') or ''} {alt.get('pq_date') or ''}".strip() or None,
                        "note": "provisional vs final" if bool(alt["is_provisional"]) != bool(fact["is_provisional"]) else "sources disagree",
                    }
                )
        allowed += table["derived"]
        if not table["rows"]:
            intent.notes.append("no verified facts for this metric/entity/period — falling back to documents")
            intent.route = "rag"
            table = None

    if intent.route in {"rag", "sql_rag"}:
        query = f"{question} {context}".strip()
        if intent.route == "sql_rag" and intent.metric:
            query = f"{question} {(domain.metric(intent.metric) or {}).get('label', '')} reasons"
        passages = hybrid.search(query, k=k, doc_kinds=doc_kinds, exclude_kinds=["table"] if table else None)
        if not hybrid.is_relevant(passages):
            passages = []
        for chunk in passages:
            citations.append(_citation_for_chunk(len(citations) + 1, chunk))
            allowed += domain.numbers_in(chunk["text"])

    answer = ""
    composed_by = "none"
    if table is None and not passages:
        answer = insufficient
        status = "insufficient"
    else:
        status = "answered"
        evidence = []
        if table:
            evidence.append(f"Evidence table — {table['title']}:\n{sql.to_markdown(table, cite_for_fact)}")
        for c in citations:
            if c["kind"] == "passage":
                evidence.append(f"[{c['n']}] {c['filename']}, page {c['page_no']}: {c['snippet']}")
        prose = _needs_prose(table, intent) and not (style == "reply" and table is not None and not intent.explain)
        if COMPOSE_MODE != "template" and prose and llm.available():
            try:
                answer = llm.chat(
                    [
                        {"role": "system", "content": COMPOSE_PROMPT.format(insufficient=insufficient, language="Hindi" if intent.language == "hi" else "English")},
                        {"role": "user", "content": f"Question: {question}\n\nEvidence:\n" + "\n\n".join(evidence)},
                    ],
                    max_tokens=420,
                )
                composed_by = "llm"
            except llm.LLMUnavailable:
                answer = ""
        if not answer:
            composed_by = "template"
            answer = write(table, intent, cite_for_fact) if table else "Relevant evidence:\n" + "\n".join(f"- {c['snippet'][:220]}… [{c['n']}]" for c in citations[:4])
        if insufficient[:20] in answer and (table is None or not table["rows"]):
            # The model declined, possibly wrapping the refusal in a sentence; keep only the canonical text.
            answer = insufficient
            status = "insufficient"
        elif answer.strip().startswith(insufficient[:20]):
            status = "insufficient"

    if status == "insufficient":
        # Evidence that does not answer the question must not be shown as if it did.
        considered = len(citations)
        table, citations, discrepancies = None, [], []
        intent.notes.append(f"{considered} loosely related source(s) found and set aside" if considered else "nothing relevant in the ingested documents")
    verdict = guard.check(answer, allowed) if status == "answered" else {"ok": True, "checked": 0, "unsupported": []}
    if not verdict["ok"] and table is not None and composed_by == "llm":
        # The model stated a figure we cannot trace. Replace the prose with the
        # template, which states only table values, and keep the verdict visible.
        answer = write(table, intent, cite_for_fact) + "\n\n_(The generated wording contained figures not found in the evidence and was replaced by the verified table summary.)_"
        composed_by = "template (guard)"

    result = {
        "question": question,
        "language": intent.language,
        "route": intent.route,
        "intent": intent.to_dict(),
        "status": status,
        "answer": answer,
        "composed_by": composed_by,
        "table": _public_table(table),
        "citations": citations,
        "guard": verdict,
        "discrepancies": discrepancies,
        "seconds": round(time.time() - started, 2),
    }
    if record:
        db.execute(
            "INSERT INTO answers(kind, question, route, payload, guard_ok, unsupported, numbers, seconds, at) VALUES ('ask',?,?,?,?,?,?,?,?)",
            (question, intent.route, db.dumps(result), int(verdict["ok"]), len(verdict["unsupported"]), verdict["checked"], result["seconds"], time.time()),
        )
    return result


def _public_table(table: dict | None) -> dict | None:
    if table is None:
        return None
    return {k: v for k, v in table.items() if k not in {"facts", "derived"}}
