"""A single background worker thread over a jobs table.

One worker on purpose: Docling and the embedding model are CPU-heavy and the
LLM has one slot, so parallel ingestion would only thrash a 16 GB laptop.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
import traceback

from . import db

log = logging.getLogger("stratum.jobs")

_queue: "queue.Queue[int]" = queue.Queue()
_started = False


def submit(kind: str, document_id: int | None = None) -> int:
    job_id = db.execute("INSERT INTO jobs(kind, document_id, status, created_at) VALUES (?,?, 'queued', ?)", (kind, document_id, time.time()))
    _queue.put(job_id)
    return job_id


def _progress(job_id: int):
    def update(fraction: float, detail: str) -> None:
        db.execute("UPDATE jobs SET progress=?, detail=? WHERE id=?", (fraction, detail, job_id))

    return update


def _run(job_id: int) -> None:
    from .ingest import pipeline

    job = db.row("SELECT * FROM jobs WHERE id=?", (job_id,))
    if job is None:
        return
    db.execute("UPDATE jobs SET status='running', started_at=? WHERE id=?", (time.time(), job_id))
    try:
        if job["kind"] == "ingest":
            result = pipeline.run(job["document_id"], job_id, _progress(job_id))
            db.execute("UPDATE jobs SET status='done', progress=1, detail=?, steps=?, finished_at=? WHERE id=?", (result["detail"], db.dumps(result["steps"]), time.time(), job_id))
        elif job["kind"] == "topics":
            from .topics import service as topics

            topics.rebuild()
            db.execute("UPDATE jobs SET status='done', progress=1, finished_at=? WHERE id=?", (time.time(), job_id))
    except Exception as error:  # noqa: BLE001
        log.error("job %s failed: %s", job_id, traceback.format_exc())
        db.execute("UPDATE jobs SET status='failed', detail=?, finished_at=? WHERE id=?", (str(error)[:500], time.time(), job_id))
        if job.get("document_id"):
            db.execute("UPDATE documents SET status='failed', status_detail=? WHERE id=?", (str(error)[:500], job["document_id"]))


def _worker() -> None:
    while True:
        job_id = _queue.get()
        try:
            _run(job_id)
        finally:
            _queue.task_done()


def start() -> None:
    global _started
    if _started:
        return
    _started = True
    # Jobs interrupted by a restart go back on the queue.
    for job in db.rows("SELECT id FROM jobs WHERE status IN ('queued','running') ORDER BY id"):
        _queue.put(job["id"])
    threading.Thread(target=_worker, name="stratum-worker", daemon=True).start()


def pending() -> int:
    return _queue.qsize()
