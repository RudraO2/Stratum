"""What kind of document is this? Deterministic rules over the first pages.

The kind sets source precedence (a Coal Directory figure outranks a press
release) and turns on the parliamentary-question parser for PQ replies.
"""

from __future__ import annotations

import re

from .. import domain

KIND_RULES = [
    ("pq_reply", r"\b(lok\s+sabha|rajya\s+sabha)\b[\s\S]{0,400}\b(starred|unstarred)\s+question\b|\bto\s+be\s+answered\s+on\b"),
    ("coal_directory", r"\bcoal\s+directory\s+of\s+india\b"),
    ("provisional_stats", r"\bprovisional\s+coal\s+statistics\b"),
    ("annual_report", r"\bannual\s+report\b"),
    ("press_release", r"\b(press\s+release|press\s+information\s+bureau|pib\s+delhi)\b"),
    ("geological_report", r"\b(geological\s+report|exploration\s+report|borehole|regional\s+exploration|detailed\s+exploration)\b"),
]


def classify(text: str, filename: str, ext: str) -> dict:
    head = (text or "")[:6000]
    low = head.lower()
    meta: dict = {"doc_kind": "spreadsheet" if ext in {".xlsx", ".xls", ".csv"} else "document"}
    for kind, pattern in KIND_RULES:
        if re.search(pattern, low) or re.search(pattern, filename.lower().replace("_", " ")):
            meta["doc_kind"] = kind
            break
    meta["precedence"] = domain.precedence(meta["doc_kind"])
    meta["is_provisional"] = 1 if re.search(r"\bprovisional\b|\(prov\.?\)", low) or meta["doc_kind"] in {"press_release", "provisional_stats"} else 0

    years = [int(y) for y in re.findall(r"\b(19[5-9]\d|20[0-4]\d)\b", head)]
    if years:
        meta["year"] = max(years)
    subs = [code for code in domain.find_entities(head[:2000]) if (domain.entity(code) or domain.Entity("", "", "")).type == "subsidiary"]
    if len(subs) == 1:
        meta["subsidiary"] = subs[0]
    if re.search(r"[ऀ-ॿ]{20,}", head) and not re.search(r"[a-z]{4,}", low[:500]):
        meta["language"] = "hi"

    if meta["doc_kind"] == "pq_reply":
        meta.update(parse_pq_header(head))
    return meta


def parse_pq_header(text: str) -> dict:
    out: dict = {}
    house = re.search(r"\b(LOK\s+SABHA|RAJYA\s+SABHA)\b", text, re.I)
    if house:
        out["pq_house"] = house.group(1).title().replace("  ", " ")
    number = re.search(r"\b(?:UN)?STARRED\s+QUESTION\s+NO\.?\s*[:\-]?\s*([\d*†]+)", text, re.I)
    if number:
        starred = "Unstarred" if re.search(r"UNSTARRED", number.group(0), re.I) else "Starred"
        out["pq_number"] = f"{starred} {number.group(1).strip('*†')}"
    date = re.search(r"ANSWERED\s+ON\s*[:\-]?\s*([0-9]{1,2}[.\-/ ][0-9A-Za-z]{1,9}[.\-/ ,]*[0-9]{2,4})", text, re.I)
    if date:
        out["pq_date"] = date.group(1).strip()
    subject = re.search(r"ANSWERED\s+ON[^\n]*\n+\s*([A-Z][A-Z0-9 ,&'()\-/]{6,120})\s*\n", text)
    if not subject:
        # Layout engines often merge the header into one line: "TO BE ANSWERED ON 10.03.2025 SAFETY IN COAL MINES"
        subject = re.search(r"ANSWERED\s+ON\s*[:\-]?\s*\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\s+([A-Z][A-Z0-9 ,&'()\-/]{5,120}?)\s*(?:\n|$)", text)
    if subject:
        out["pq_subject"] = subject.group(1).strip().title()
    return out
