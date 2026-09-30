"""Stratum backend HTTP API (127.0.0.1:8642).

The harness plugin reaches this through its own same-origin proxy
(`/stratum/api/*`), so the browser never talks to another origin and the
backend never listens beyond loopback.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from . import db, domain, jobs, llm
from .config import DB_PATH, DELIVERABLES_DIR, HOME
from .facts import service as facts
from .ingest import pipeline, render

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("stratum.api")

app = FastAPI(title="Stratum", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    db.connect()
    jobs.start()
    log.info("Stratum backend ready — data at %s", HOME)


# ── health & stats ─────────────────────────────────────────────────────────


@app.get("/v1/health")
def health():
    return {
        "ok": True,
        "db": str(DB_PATH),
        "llm": llm.health(),
        "documents": db.scalar("SELECT COUNT(*) FROM documents") or 0,
        "facts": facts.summary(),
        "queue": jobs.pending(),
        "deliverables": str(DELIVERABLES_DIR),
    }


@app.get("/v1/stats")
def stats():
    by_kind = db.rows("SELECT doc_kind, COUNT(*) AS n FROM documents GROUP BY doc_kind ORDER BY n DESC")
    return {
        "documents": db.scalar("SELECT COUNT(*) FROM documents") or 0,
        "pages": db.scalar("SELECT COALESCE(SUM(pages),0) FROM documents") or 0,
        "tables": db.scalar("SELECT COUNT(*) FROM tables_") or 0,
        "chunks": db.scalar("SELECT COUNT(*) FROM chunks") or 0,
        "facts": facts.summary(),
        "by_kind": by_kind,
        "processing": db.scalar("SELECT COUNT(*) FROM documents WHERE status NOT IN ('ready','failed')") or 0,
    }


# ── documents ──────────────────────────────────────────────────────────────


@app.post("/v1/documents")
async def upload(file: UploadFile = File(...), doc_kind: str | None = Form(None), subsidiary: str | None = Form(None)):
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    try:
        document_id, is_new = pipeline.register_upload(data, file.filename or "upload", {"doc_kind": doc_kind, "subsidiary": subsidiary})
    except ValueError as error:
        raise HTTPException(415, str(error)) from error
    job_id = jobs.submit("ingest", document_id) if is_new else None
    return {"document_id": document_id, "duplicate": not is_new, "job_id": job_id}


@app.post("/v1/documents/{document_id}/reingest")
def reingest(document_id: int):
    if not db.row("SELECT id FROM documents WHERE id=?", (document_id,)):
        raise HTTPException(404)
    db.execute("UPDATE documents SET status='queued' WHERE id=?", (document_id,))
    return {"job_id": jobs.submit("ingest", document_id)}


@app.get("/v1/documents")
def list_documents():
    return db.rows(
        """SELECT d.id, d.filename, d.title, d.doc_kind, d.subsidiary, d.year, d.pages, d.status, d.status_detail, d.bytes,
                  d.is_provisional, d.pq_house, d.pq_number, d.pq_date, d.ingested_at, d.sha256, d.parser,
                  (SELECT COUNT(*) FROM facts f WHERE f.document_id=d.id) AS facts,
                  (SELECT COUNT(*) FROM facts f WHERE f.document_id=d.id AND f.status='flagged') AS flagged,
                  (SELECT COUNT(*) FROM tables_ t WHERE t.document_id=d.id) AS tables,
                  (SELECT progress FROM jobs j WHERE j.document_id=d.id ORDER BY j.id DESC LIMIT 1) AS progress
           FROM documents d ORDER BY d.ingested_at DESC"""
    )


def _document(document_id: int) -> dict:
    document = db.row("SELECT * FROM documents WHERE id=?", (document_id,))
    if document is None:
        raise HTTPException(404, "no such document")
    return document


@app.get("/v1/documents/{document_id}")
def get_document(document_id: int):
    document = _document(document_id)
    document["pages_info"] = db.rows("SELECT page_no, width, height, has_text_layer, ocr_used, vlm_used FROM pages WHERE document_id=? ORDER BY page_no", (document_id,))
    document["tables_info"] = db.rows("SELECT id, page_no, ordinal, caption, n_rows, n_cols, mapping_status FROM tables_ WHERE document_id=? ORDER BY ordinal", (document_id,))
    document["job"] = db.row("SELECT id, status, progress, detail, steps FROM jobs WHERE document_id=? ORDER BY id DESC LIMIT 1", (document_id,))
    if document["job"]:
        document["job"]["steps"] = db.loads(document["job"]["steps"], [])
    return document


@app.get("/v1/documents/{document_id}/file")
def get_file(document_id: int):
    document = _document(document_id)
    return FileResponse(document["store_path"], media_type=document["mime"] or "application/octet-stream", filename=document["filename"])


@app.get("/v1/documents/{document_id}/pages/{page_no}.png")
def page_png(document_id: int, page_no: int):
    document = _document(document_id)
    png = render.render_page(Path(document["store_path"]), document["sha256"], page_no)
    if png is None:
        raise HTTPException(404, "this document type has no page images")
    return Response(png, media_type="image/png", headers={"cache-control": "max-age=86400"})


@app.get("/v1/documents/{document_id}/pages/{page_no}/overlay")
def page_overlay(document_id: int, page_no: int):
    """Everything on one page that has a box: blocks, table cells, fact cells."""
    _document(document_id)
    blocks = db.rows("SELECT id, kind, text, bbox, source FROM blocks WHERE document_id=? AND page_no=? AND bbox IS NOT NULL", (document_id, page_no))
    tables = db.rows("SELECT id, caption, bbox, mapping_status FROM tables_ WHERE document_id=? AND page_no=?", (document_id, page_no))
    fact_cells = db.rows(
        """SELECT f.id AS fact_id, f.entity_code, f.metric, f.value, f.unit, f.period, f.status, s.bbox, s.raw_text
           FROM facts f JOIN fact_sources s ON s.fact_id=f.id WHERE f.document_id=? AND s.page_no=? AND s.bbox IS NOT NULL""",
        (document_id, page_no),
    )
    for item in (*blocks, *tables, *fact_cells):
        item["bbox"] = db.loads(item["bbox"])
    return {"page_no": page_no, "blocks": blocks, "tables": tables, "facts": fact_cells}


@app.get("/v1/documents/{document_id}/tables/{table_id}")
def get_table(document_id: int, table_id: int):
    table = db.row("SELECT * FROM tables_ WHERE id=? AND document_id=?", (table_id, document_id))
    if table is None:
        raise HTTPException(404)
    table["mapping"] = db.loads(table["mapping"])
    table["bbox"] = db.loads(table["bbox"])
    table["cells"] = db.rows("SELECT id, row_idx, col_idx, text, is_header, bbox FROM cells WHERE table_id=? ORDER BY row_idx, col_idx", (table_id,))
    for cell in table["cells"]:
        cell["bbox"] = db.loads(cell["bbox"])
    return table


@app.get("/v1/documents/{document_id}/cues")
def cues_export(document_id: int):
    """The document in the CUES interchange shape (pages, blocks, tables, facts, provenance)."""
    document = _document(document_id)
    return {
        "schema_version": "cues/1.0",
        "document_id": f"sha256:{document['sha256']}",
        "source": {k: document[k] for k in ("filename", "mime", "sha256", "bytes", "ingested_at")},
        "document_metadata": {k: document[k] for k in ("title", "doc_kind", "year", "subsidiary", "language", "is_provisional", "pq_house", "pq_number", "pq_date")},
        "provenance": {"parser": document["parser"], "parser_version": document["parser_version"]},
        "pages": db.rows("SELECT page_no, width, height, has_text_layer, ocr_used, vlm_used FROM pages WHERE document_id=?", (document_id,)),
        "blocks": [{**b, "bbox": db.loads(b["bbox"])} for b in db.rows("SELECT page_no, kind, heading_path, text, bbox, source FROM blocks WHERE document_id=?", (document_id,))],
        "tables": [get_table(document_id, t["id"]) for t in db.rows("SELECT id FROM tables_ WHERE document_id=?", (document_id,))],
        "facts": facts.list_facts(document_id=document_id, limit=5000),
    }


@app.delete("/v1/documents/{document_id}")
def delete_document(document_id: int):
    _document(document_id)
    with db.tx() as conn:
        conn.execute("DELETE FROM documents WHERE id=?", (document_id,))
    from .search import hybrid

    hybrid.invalidate()
    db.audit("document.delete", {"id": document_id})
    return {"deleted": document_id}


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: int):
    job = db.row("SELECT * FROM jobs WHERE id=?", (job_id,))
    if job is None:
        raise HTTPException(404)
    job["steps"] = db.loads(job["steps"], [])
    return job


# ── facts & review ─────────────────────────────────────────────────────────


@app.get("/v1/facts")
def list_facts(status: str | None = None, metric: str | None = None, entity: str | None = None, document_id: int | None = None, limit: int = 500):
    return {"summary": facts.summary(), "facts": facts.list_facts(status, metric, entity, document_id, limit)}


@app.get("/v1/facts/{fact_id}")
def get_fact(fact_id: int):
    fact = facts.lineage(fact_id)
    if fact is None:
        raise HTTPException(404)
    return fact


@app.post("/v1/facts/{fact_id}/review")
def review_fact(fact_id: int, payload: dict = Body(...)):
    try:
        return facts.review(fact_id, payload.get("action", ""), payload.get("value"), payload.get("note", ""), payload.get("reviewer", "reviewer"))
    except KeyError as error:
        raise HTTPException(404) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


@app.get("/v1/chunks/{chunk_id}")
def get_chunk(chunk_id: int):
    chunk = db.row("SELECT c.id, c.document_id, c.page_no, c.heading_path, c.text, c.bbox, c.kind, d.filename FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.id=?", (chunk_id,))
    if chunk is None:
        raise HTTPException(404)
    chunk["bbox"] = db.loads(chunk["bbox"])
    return chunk


# ── ask, PQ, reports, topics, metrics ─────────────────────────────────────


@app.post("/v1/ask")
def ask(payload: dict = Body(...)):
    from .ask import service

    question = (payload.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "question is required")
    return service.ask(question, doc_kinds=payload.get("doc_kinds"))


@app.post("/v1/pq")
def pq(payload: dict = Body(...)):
    from .pq import service

    text = (payload.get("text") or "").strip()
    if len(text) < 10:
        raise HTTPException(400, "paste the question text")
    return service.build(text, filename=payload.get("filename"))


@app.get("/v1/reports/templates")
def report_templates():
    from .reports import service

    return [{k: t.get(k) for k in ("id", "title", "description", "params")} for t in service.templates()]


@app.post("/v1/reports")
def report(payload: dict = Body(...)):
    from .reports import service

    template_id = payload.get("template")
    params = payload.get("params") or {}
    if not template_id and payload.get("request"):
        template_id, picked = service.pick_template(payload["request"])
        params = {**picked, **params}
    try:
        return service.generate(template_id or "subsidiary_annual_production", params, filename=payload.get("filename"))
    except KeyError as error:
        raise HTTPException(404, f"no template {template_id}") from error


@app.get("/v1/topics")
def topics():
    from .topics import service

    return service.current()


@app.post("/v1/topics/rebuild")
def topics_rebuild(payload: dict = Body(default={})):
    from .topics import service

    return service.rebuild(payload.get("n_topics"))


@app.get("/v1/topics/wordcloud.png")
def wordcloud():
    from .topics import service

    png = service.wordcloud_png()
    if png is None:
        raise HTTPException(404, "word cloud not built yet")
    return Response(png, media_type="image/png", headers={"cache-control": "no-cache"})


@app.get("/v1/metrics")
def metrics():
    from .metrics import service

    return service.compute()


@app.get("/v1/domain")
def domain_info():
    return {
        "metrics": [{"key": m["key"], "label": m["label"], "unit": m["unit"]} for m in domain.master()["metrics"]],
        "entities": [{"code": e["code"], "name": e["name"], "type": e["type"]} for e in domain.master()["entities"]],
    }


@app.get("/v1/deliverables/{name}")
def deliverable(name: str):
    path = (DELIVERABLES_DIR / name).resolve()
    if DELIVERABLES_DIR.resolve() not in path.parents or not path.exists():
        raise HTTPException(404)
    return FileResponse(path, filename=path.name)


@app.exception_handler(llm.LLMUnavailable)
def _llm_down(_, error):
    return JSONResponse({"error": "local model unavailable", "detail": str(error)}, status_code=503)


@app.middleware("http")
async def _timing(request, call_next):
    started = time.time()
    response = await call_next(request)
    response.headers["x-stratum-ms"] = str(int((time.time() - started) * 1000))
    return response
