"""Ingestion pipeline: original → CUES → evidence (chunks) + facts.

Every step is timed and marked automated/manual in the job's step log, which
is exactly what the automation-% metric is computed from.
"""

from __future__ import annotations

import logging
import re
import time
from pathlib import Path

from .. import db, domain, llm
from ..config import MAX_VLM_PAGES_PER_DOC, USE_VISION
from ..facts import mapper, validate
from ..facts.extract import extract
from ..search import embed, hybrid
from . import doc_meta, render, store
from .chunker import chunk
from .cues import Block, ParsedDocument

log = logging.getLogger("stratum.ingest")

TABULAR = {".xlsx", ".xls", ".csv"}
PLAIN = {".txt", ".md"}


def register_upload(data: bytes, filename: str, meta: dict | None = None) -> tuple[int, bool]:
    """Store the original and create (or find) its document row. Returns (document_id, is_new)."""
    ext = Path(filename).suffix.lower()
    if ext not in store.SUPPORTED:
        raise ValueError(f"unsupported file type '{ext}'")
    digest, path = store.put(data, filename)
    existing = db.row("SELECT id FROM documents WHERE sha256=?", (digest,))
    if existing:
        return existing["id"], False
    now = time.time()
    meta = meta or {}
    document_id = db.execute(
        """INSERT INTO documents(sha256, filename, mime, ext, bytes, store_path, doc_kind, subsidiary, status, ingested_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?, 'queued', ?, ?)""",
        (digest, Path(filename).name, store.mime_of(filename), ext, len(data), str(path), meta.get("doc_kind") or "document", meta.get("subsidiary"), now, now),
    )
    db.audit("document.upload", {"id": document_id, "filename": filename, "sha256": digest, "bytes": len(data)})
    return document_id, True


def _set_status(document_id: int, status: str, detail: str = "") -> None:
    db.execute("UPDATE documents SET status=?, status_detail=?, updated_at=? WHERE id=?", (status, detail, time.time(), document_id))


def _parse_plain(path: Path) -> ParsedDocument:
    parsed = ParsedDocument(parser="plain", parser_version="1")
    text = path.read_text(encoding="utf-8", errors="replace")
    for para in [p.strip() for p in text.split("\n\n") if p.strip()]:
        kind = "heading" if para.startswith("#") else "text"
        parsed.blocks.append(Block(1, kind, para.lstrip("# ").strip(), ""))
    parsed.title = path.stem
    return parsed


def _parse(path: Path) -> ParsedDocument:
    ext = path.suffix.lower()
    if ext in TABULAR:
        from . import tabular

        return tabular.parse(path)
    if ext in PLAIN:
        return _parse_plain(path)
    from . import docling_parse

    return docling_parse.parse(path)


def _vision_pass(document_id: int, sha: str, path: Path, parsed: ParsedDocument, steps: list) -> None:
    """Figures and unreadable scan pages → vision-model text blocks (searchable, marked AI-generated)."""
    if path.suffix.lower() not in {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}:
        return
    text_by_page: dict[int, int] = {}
    for block in parsed.blocks:
        text_by_page[block.page_no or 0] = text_by_page.get(block.page_no or 0, 0) + len(block.text)
    targets: list[tuple[int, list[float] | None, str]] = []
    for page in parsed.pages:
        if page.ocr_used and text_by_page.get(page.page_no, 0) < 80:
            targets.append((page.page_no, None, "page"))
    for picture in parsed.pictures:
        x0, y0, x1, y1 = picture.bbox
        if (x1 - x0) * (y1 - y0) >= 0.08:
            targets.append((picture.page_no, picture.bbox, "figure"))
    targets = targets[:MAX_VLM_PAGES_PER_DOC]
    if not targets or not USE_VISION or not llm.available():
        return
    started = time.time()
    for page_no, bbox, what in targets:
        png = render.render_page(path, sha, page_no)
        if png is None:
            continue
        image = render.crop(png, bbox) if bbox else png
        prompt = (
            "This image is from a Coal India / Ministry of Coal document. "
            + (
                "Describe the figure factually: what it shows (map, chart, cross-section, layout), titles, labels, legends, and any numbers printed on it. Do not guess values that are not printed."
                if what == "figure"
                else "Transcribe the text on this scanned page as accurately as you can, keeping table rows on separate lines. Mark unreadable words as [illegible]."
            )
        )
        try:
            text = llm.describe_image(image, prompt)
        except Exception as error:  # noqa: BLE001
            log.warning("vision pass failed on page %s: %s", page_no, error)
            break
        if text.strip():
            label = "Figure description (AI-generated, verify against the image)" if what == "figure" else "Page transcription (AI-generated from scan)"
            parsed.blocks.append(Block(page_no, "figure_description", f"{label}: {text.strip()}", "", bbox or [0, 0, 1, 1], source="vlm"))
            for page in parsed.pages:
                if page.page_no == page_no:
                    page.vlm_used = True
    steps.append({"step": "vision", "automated": True, "seconds": round(time.time() - started, 2), "items": len(targets)})


def _title_for(parsed: ParsedDocument, meta: dict, filename: str) -> str:
    """PQ subject, else the parser's title, else the first heading, else the file name. Parsers see the
    content-addressed store file, so their 'name' can be a sha256 — never show that."""
    if meta.get("pq_subject"):
        return meta["pq_subject"]
    if parsed.title and not re.fullmatch(r"[0-9a-f]{32,64}", parsed.title):
        return parsed.title
    for block in parsed.blocks:
        if block.kind in {"heading", "title"} and block.text.strip():
            return block.text.strip()
    return re.sub(r"[-_]+", " ", Path(filename).stem).strip()


def _persist(document_id: int, parsed: ParsedDocument, meta: dict) -> list[int]:
    table_ids: list[int] = []
    with db.tx() as conn:
        conn.execute("DELETE FROM pages WHERE document_id=?", (document_id,))
        conn.execute("DELETE FROM blocks WHERE document_id=?", (document_id,))
        conn.execute("DELETE FROM tables_ WHERE document_id=?", (document_id,))
        conn.execute("DELETE FROM chunks WHERE document_id=?", (document_id,))
        conn.execute("DELETE FROM facts WHERE document_id=?", (document_id,))
        conn.executemany(
            "INSERT INTO pages(document_id, page_no, width, height, has_text_layer, ocr_used, vlm_used) VALUES (?,?,?,?,?,?,?)",
            [(document_id, p.page_no, p.width, p.height, int(p.has_text_layer), int(p.ocr_used), int(p.vlm_used)) for p in parsed.pages],
        )
        conn.executemany(
            "INSERT INTO blocks(document_id, page_no, kind, heading_path, text, bbox, source) VALUES (?,?,?,?,?,?,?)",
            [(document_id, b.page_no, b.kind, b.heading_path, b.text, db.dumps(b.bbox) if b.bbox else None, b.source) for b in parsed.blocks],
        )
        for ordinal, table in enumerate(parsed.tables):
            cur = conn.execute(
                "INSERT INTO tables_(document_id, page_no, ordinal, caption, heading_path, context, n_rows, n_cols, bbox) VALUES (?,?,?,?,?,?,?,?,?)",
                (document_id, table.page_no, ordinal, table.caption, table.heading_path, table.context, table.n_rows, table.n_cols, db.dumps(table.bbox) if table.bbox else None),
            )
            table_id = cur.lastrowid
            table_ids.append(table_id)
            conn.executemany(
                "INSERT INTO cells(table_id, row_idx, col_idx, text, is_header, bbox, page_no) VALUES (?,?,?,?,?,?,?)",
                [(table_id, c.row, c.col, c.text, int(c.is_header), db.dumps(c.bbox) if c.bbox else None, c.page_no) for c in table.cells],
            )
        conn.execute(
            """UPDATE documents SET title=?, doc_kind=?, precedence=?, is_provisional=?, year=COALESCE(?, year), subsidiary=COALESCE(subsidiary, ?),
                      language=?, pq_house=?, pq_number=?, pq_date=?, pq_subject=?, pages=?, parser=?, parser_version=?, updated_at=? WHERE id=?""",
            (
                _title_for(parsed, meta, db.scalar("SELECT filename FROM documents WHERE id=?", (document_id,)) or "")[:300],
                meta["doc_kind"],
                meta["precedence"],
                meta.get("is_provisional", 0),
                meta.get("year"),
                meta.get("subsidiary"),
                meta.get("language", "en"),
                meta.get("pq_house"),
                meta.get("pq_number"),
                meta.get("pq_date"),
                meta.get("pq_subject"),
                len(parsed.pages),
                parsed.parser,
                parsed.parser_version,
                time.time(),
                document_id,
            ),
        )
    return table_ids


def _index(document_id: int, parsed: ParsedDocument, table_ids: list[int]) -> int:
    pieces = chunk(parsed)
    vectors = embed.embed_passages([p["text"] for p in pieces])
    with db.tx() as conn:
        conn.executemany(
            "INSERT INTO chunks(document_id, page_no, heading_path, text, bbox, kind, table_id, embedding) VALUES (?,?,?,?,?,?,?,?)",
            [
                (
                    document_id,
                    p["page_no"],
                    p["heading_path"],
                    p["text"],
                    db.dumps(p["bbox"]) if p["bbox"] else None,
                    p["kind"],
                    table_ids[p["table_ordinal"]] if p["table_ordinal"] is not None and p["table_ordinal"] < len(table_ids) else None,
                    embed.to_blob(vectors[i]),
                )
                for i, p in enumerate(pieces)
            ],
        )
    hybrid.invalidate()
    return len(pieces)


def _extract_facts(document_id: int, parsed: ParsedDocument, table_ids: list[int], meta: dict, allow_llm: bool) -> dict:
    stats = {"tables": len(parsed.tables), "mapped": 0, "facts": 0, "rules": 0, "llm": 0, "llm_mapped_tables": 0}
    new_fact_ids: list[int] = []
    previous, previous_mapping = None, None
    groups: list[list[tuple]] = []  # a table and its continuations on following pages are checked as one
    for table, table_id in zip(parsed.tables, table_ids):
        continued = mapper.continuation(table, previous, previous_mapping)
        mapping = continued or mapper.map_table(table, allow_llm=allow_llm)
        previous, previous_mapping = table, mapping
        candidates = extract(table, mapping)
        status = "mapped" if candidates else ("not_data" if not mapping.get("is_data_table") else "failed")
        db.execute("UPDATE tables_ SET mapping=?, mapping_status=? WHERE id=?", (db.dumps(mapping), status, table_id))
        if not candidates:
            continue
        stats["mapped"] += 1
        source = mapping.get("source", "rules").split("+")[0]
        stats[source] = stats.get(source, 0) + 1
        if continued and groups:
            groups[-1].append((table, table_id, mapping, candidates))
        else:
            groups.append([(table, table_id, mapping, candidates)])

    provisional_doc = bool(meta.get("is_provisional"))
    for group in groups:
        validate.table_checks([c for _, _, _, candidates in group for c in candidates])
        for table, table_id, mapping, candidates in group:
            _store_candidates(document_id, parsed, table, table_id, mapping, candidates, provisional_doc, new_fact_ids)
    for fact_id in new_fact_ids:
        validate.cross_source(fact_id)
        validate.recompute_status(fact_id)
    stats["facts"] = len(new_fact_ids)
    stats["llm_mapped_tables"] = stats.get("llm", 0)
    return stats


def _store_candidates(document_id, parsed, table, table_id, mapping, candidates, provisional_doc, new_fact_ids) -> None:
    cell_ids = {(r["row_idx"], r["col_idx"]): (r["id"], r["bbox"]) for r in db.rows("SELECT id, row_idx, col_idx, bbox FROM cells WHERE table_id=?", (table_id,))}
    if True:
        for c in candidates:
            if c.metric in {"growth_pct", "achievement_pct"}:
                continue  # stated percentages are checked against the actuals, not stored as facts
            cell_id, bbox = cell_ids.get((c.row, c.col), (None, None))
            with db.tx() as conn:
                cur = conn.execute(
                    """INSERT INTO facts(entity_code, entity_type, entity_raw, metric, value, unit, period, period_kind, is_provisional, status, document_id, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (c.entity_code, c.entity_type, c.entity_raw, c.metric, c.value, c.unit, c.period, c.period_kind, int(c.is_provisional or provisional_doc), "consistent", document_id, time.time()),
                )
                fact_id = cur.lastrowid
                conn.execute(
                    """INSERT INTO fact_sources(fact_id, document_id, table_id, cell_id, page_no, row_idx, col_idx, raw_text, raw_unit, conversion, bbox, parser)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (fact_id, document_id, table_id, cell_id, table.page_no, c.row, c.col, c.raw_text, c.raw_unit, c.conversion, bbox, f"{parsed.parser} + mapping:{mapping.get('source')}"),
                )
            validate.store_checks(fact_id, c.checks)
            new_fact_ids.append(fact_id)


def run(document_id: int, job_id: int | None = None, progress=lambda p, d: None) -> dict:
    document = db.row("SELECT * FROM documents WHERE id=?", (document_id,))
    if document is None:
        raise KeyError(document_id)
    path = Path(document["store_path"])
    steps: list[dict] = [{"step": "fingerprint_and_store", "automated": True, "seconds": 0.0}]

    _set_status(document_id, "parsing", "reading layout, tables and text")
    progress(0.1, "parsing")
    started = time.time()
    parsed = _parse(path)
    steps.append({"step": "parse", "automated": True, "seconds": round(time.time() - started, 2), "parser": parsed.parser, "pages": len(parsed.pages), "tables": len(parsed.tables)})

    meta = doc_meta.classify(parsed.text(8000), document["filename"], path.suffix.lower())
    if document.get("doc_kind") and document["doc_kind"] != "document":
        meta["doc_kind"] = document["doc_kind"]
        meta["precedence"] = domain.precedence(meta["doc_kind"])
    steps.append({"step": "classify", "automated": True, "seconds": 0.0, "doc_kind": meta["doc_kind"]})

    progress(0.35, "vision")
    _vision_pass(document_id, document["sha256"], path, parsed, steps)

    progress(0.5, "saving evidence")
    table_ids = _persist(document_id, parsed, meta)

    _set_status(document_id, "indexing", "embedding chunks for search")
    progress(0.6, "indexing")
    started = time.time()
    n_chunks = _index(document_id, parsed, table_ids)
    steps.append({"step": "index", "automated": True, "seconds": round(time.time() - started, 2), "chunks": n_chunks})

    _set_status(document_id, "extracting", "mapping tables to facts")
    progress(0.8, "extracting facts")
    started = time.time()
    stats = _extract_facts(document_id, parsed, table_ids, meta, allow_llm=llm.available())
    steps.append({"step": "extract_and_validate", "automated": True, "seconds": round(time.time() - started, 2), **stats})

    flagged = db.scalar("SELECT COUNT(*) FROM facts WHERE document_id=? AND status='flagged'", (document_id,)) or 0
    detail = f"{len(parsed.pages)} pages · {len(parsed.tables)} tables · {stats['facts']} facts" + (f" · {flagged} flagged for review" if flagged else "")
    _set_status(document_id, "ready", detail)
    progress(1.0, "ready")
    db.audit("document.ingested", {"id": document_id, "steps": steps})
    return {"document_id": document_id, "steps": steps, "detail": detail}
