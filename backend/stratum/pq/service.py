"""PQ Reply Builder: a parliamentary question → a draft reply, part by part.

1. Parse the header (House, Starred/Unstarred No., date, subject) and parts (a), (b), (c)…
2. Answer each part through Ask, carrying the previous part forward for
   "if so, the details thereof" parts.
3. Tables longer than a few rows become Annexures, as ministry replies do.
4. Find similar questions already answered (the PQ archive) and compare every
   figure in this draft with figures previously given to Parliament.
5. Write the draft in reply format as DOCX, with an internal evidence trail.
"""

from __future__ import annotations

import re
import time

from .. import db, docx_out, domain
from ..ask import service as ask_service
from ..ingest.doc_meta import parse_pq_header
from ..search import hybrid

ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]
FOLLOW_ON = re.compile(r"^\s*(if so|if not|the details thereof|details thereof|the reasons therefor|and the reasons|if yes|if no)", re.I)


def parse_question(text: str) -> dict:
    header = parse_pq_header(text)
    body = text
    lead = re.search(r"(?i)will\s+the\s+minister\s+of\s+[a-z &]+?\s+be\s+pleased\s+to\s+state\s*[:\-]?", text)
    if lead:
        body = text[lead.end():]
    parts = []
    for match in re.finditer(r"\(([a-h])\)\s*(.+?)(?=\([a-h]\)\s|$)", body, re.S):
        question = re.sub(r"\s+", " ", match.group(2)).strip().rstrip(";").rstrip(",").strip()
        question = re.sub(r"\s*(and|;)\s*$", "", question)
        if question:
            parts.append({"label": match.group(1), "question": question})
    if not parts:
        parts = [{"label": "a", "question": re.sub(r"\s+", " ", body).strip()}]
    members = re.findall(r"(?:SHRI|SMT\.?|DR\.?|KUMARI)\s+[A-Z][A-Z .]+", text)
    subject = header.get("pq_subject")
    if not subject:
        caps = re.findall(r"^\s*([A-Z][A-Z ,&'()\-]{8,80})\s*$", text, re.M)
        caps = [c for c in caps if not re.search(r"LOK SABHA|RAJYA SABHA|QUESTION|MINISTRY|GOVERNMENT|ANSWERED|SHRI|SMT", c)]
        subject = caps[0].title() if caps else None
    return {**header, "pq_subject": subject, "members": [m.strip().title() for m in members[:4]], "parts": parts}


def _similar(text: str) -> list[dict]:
    hits = hybrid.search(text, k=12, doc_kinds=["pq_reply"])
    seen, out = set(), []
    for hit in hits:
        if hit["document_id"] in seen:
            continue
        seen.add(hit["document_id"])
        out.append(
            {
                "document_id": hit["document_id"],
                "filename": hit["filename"],
                "house": hit.get("pq_house"),
                "number": hit.get("pq_number"),
                "date": hit.get("pq_date"),
                "subject": hit.get("pq_subject") or hit.get("title"),
                "page_no": hit["page_no"],
                "snippet": hit["text"][:300],
                "similarity": hit["vector_sim"],
            }
        )
        if len(out) >= 3:
            break
    return out


def build(text: str, write_docx: bool = True, filename: str | None = None) -> dict:
    started = time.time()
    parsed = parse_question(text)
    subject = parsed.get("pq_subject") or ""
    answers = []
    annexures = []
    citations_all: list[dict] = []
    warnings = []
    previous_question = ""
    for part in parsed["parts"]:
        query = part["question"]
        if FOLLOW_ON.search(query) and previous_question:
            query = f"{previous_question} — {query}"
        # The subject line and the previous part may name the entity or year a part leaves implicit
        # ("whether the target was achieved") — but never choose the metric for it.
        context = " ".join(x for x in (subject, previous_question) if x)
        result = ask_service.ask(query, record=False, context=context, style="reply")
        # Renumber this part's citations into the reply-wide list.
        offset = len(citations_all)
        renumber = {c["n"]: c["n"] + offset for c in result["citations"]}
        for c in result["citations"]:
            citations_all.append({**c, "n": renumber[c["n"]], "part": part["label"]})
        answer = re.sub(r"\[(\d+)\]", lambda m: f"[{renumber.get(int(m.group(1)), m.group(1))}]", result["answer"])
        annexure = None
        if result["table"] and len(result["table"]["rows"]) > 3:
            annexure = {"label": f"Annexure-{ROMAN[len(annexures)]}", "part": part["label"], "table": result["table"]}
            annexures.append(annexure)
            answer = f"{answer}\n\nThe details are given at {annexure['label']}."
        for d in result["discrepancies"]:
            if d["other_kind"] == "pq_reply":
                warnings.append({"part": part["label"], "kind": "past_reply_mismatch", "message": f"{d['entity']} {d['metric'].replace('_', ' ')} {d['period']}: this draft states {d['reported']:g}, but {d.get('pq') or d['other_source']} stated {d['other']:g} ({d['note']}).", **d})
            else:
                warnings.append({"part": part["label"], "kind": "source_disagreement", "message": f"{d['entity']} {d['period']}: {d['other_source']} states {d['other']:g} vs {d['reported']:g} used here ({d['note']}).", **d})
        if not result["guard"]["ok"]:
            warnings.append({"part": part["label"], "kind": "unsupported_number", "message": f"Part ({part['label']}): figures not found in evidence: {', '.join(f'{v:g}' for v in result['guard']['unsupported'])}"})
        if result["status"] == "insufficient":
            warnings.append({"part": part["label"], "kind": "insufficient", "message": f"Part ({part['label']}): no verified evidence found — needs officer input."})
        answers.append({"label": part["label"], "question": part["question"], "answer": answer, "route": result["route"], "status": result["status"], "table": result["table"], "guard": result["guard"]})
        previous_question = part["question"]

    # The same discrepancy often surfaces in several parts; say it once, naming every part it touches.
    merged: dict[tuple, dict] = {}
    for w in warnings:
        key = (w["kind"], w["message"])
        if key in merged:
            merged[key]["part"] = f"{merged[key]['part']}, {w['part']}"
        else:
            merged[key] = dict(w)
    warnings = list(merged.values())

    similar = _similar(text)
    payload = {
        "header": {k: parsed.get(k) for k in ("pq_house", "pq_number", "pq_date", "pq_subject")},
        "members": parsed["members"],
        "parts": answers,
        "annexures": annexures,
        "similar": similar,
        "warnings": warnings,
        "citations": citations_all,
        "seconds": None,
    }
    if write_docx:
        payload["docx_path"] = str(_write_docx(payload, text, filename))
    payload["seconds"] = round(time.time() - started, 2)
    unsupported = sum(len(p["guard"]["unsupported"]) for p in answers)
    db.execute(
        "INSERT INTO answers(kind, question, route, payload, guard_ok, unsupported, numbers, seconds, at) VALUES ('pq',?,?,?,?,?,?,?,?)",
        (text[:2000], "pq", db.dumps(payload), int(unsupported == 0), unsupported, sum(p["guard"]["checked"] for p in answers), payload["seconds"], time.time()),
    )
    return payload


def _write_docx(payload: dict, original: str, filename: str | None = None):
    header = payload["header"]
    doc = docx_out.new_document()
    docx_out.centered(doc, "GOVERNMENT OF INDIA")
    docx_out.centered(doc, "MINISTRY OF COAL")
    docx_out.centered(doc, (header.get("pq_house") or "LOK SABHA").upper())
    kind, _, number = (header.get("pq_number") or "Unstarred ____").partition(" ")
    docx_out.centered(doc, f"{kind.upper()} QUESTION NO. {number or '____'}")
    docx_out.centered(doc, f"TO BE ANSWERED ON {header.get('pq_date') or '____'}")
    docx_out.centered(doc, (header.get("pq_subject") or "SUBJECT").upper())
    doc.add_paragraph()
    for member in payload["members"][:2]:
        docx_out.paragraph(doc, f"{member}:", bold=True)
    docx_out.paragraph(doc, "Will the Minister of COAL be pleased to state:")
    for part in payload["parts"]:
        docx_out.paragraph(doc, f"({part['label']}) {part['question']};")
    doc.add_paragraph()
    docx_out.centered(doc, "ANSWER")
    docx_out.centered(doc, "THE MINISTER OF COAL AND MINES (SHRI ____________)", bold=True)
    doc.add_paragraph()
    for part in payload["parts"]:
        docx_out.paragraph(doc, f"({part['label']}): {part['answer']}")
    for annexure in payload["annexures"]:
        doc.add_page_break()
        docx_out.centered(doc, annexure["label"].upper())
        docx_out.paragraph(doc, f"Annexure referred to in reply to part ({annexure['part']}) of {header.get('pq_house') or 'Lok Sabha'} {header.get('pq_number') or 'Question'} for {header.get('pq_date') or '____'}", italic=True)
        head, rows = docx_out.table_rows(annexure["table"])
        docx_out.table(doc, head, rows, title=annexure["table"]["title"])
    if payload["warnings"]:
        doc.add_page_break()
        docx_out.paragraph(doc, "Stratum review notes (internal — remove before dispatch)", bold=True)
        for w in payload["warnings"]:
            docx_out.paragraph(doc, f"• {w['message']}", size=10)
    docx_out.evidence_section(doc, payload["citations"])
    stem = f"PQ-{(header.get('pq_house') or 'LS').replace(' ', '')}-{(header.get('pq_number') or 'draft').replace(' ', '')}"
    return docx_out.save(doc, stem, filename)
