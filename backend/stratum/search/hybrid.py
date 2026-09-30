"""Hybrid retrieval: FTS5 keyword (BM25) + dense vectors, fused by reciprocal rank.

Keyword search catches exact codes, names and figures ("SECL", "Gevra",
"787.9"); dense search catches paraphrase and Hindi. RRF needs no score
calibration between the two, which is why it is the default everywhere.
"""

from __future__ import annotations

import re
import threading

import numpy as np

from .. import db
from . import embed

RRF_K = 60

_index_lock = threading.Lock()
_index: dict = {"version": -1, "ids": np.zeros(0, dtype=np.int64), "matrix": np.zeros((0, embed.DIM), dtype=np.float32)}


def _version() -> int:
    return int(db.scalar("SELECT COALESCE(MAX(id),0) + COUNT(*) FROM chunks WHERE embedding IS NOT NULL") or 0)


def invalidate() -> None:
    with _index_lock:
        _index["version"] = -1


def _load() -> tuple[np.ndarray, np.ndarray]:
    with _index_lock:
        version = _version()
        if version != _index["version"]:
            found = db.rows("SELECT id, embedding FROM chunks WHERE embedding IS NOT NULL ORDER BY id")
            ids = np.array([r["id"] for r in found], dtype=np.int64)
            matrix = np.vstack([embed.from_blob(r["embedding"]) for r in found]) if found else np.zeros((0, embed.DIM), dtype=np.float32)
            _index.update(version=version, ids=ids, matrix=matrix)
        return _index["ids"], _index["matrix"]


def _fts_query(text: str) -> str | None:
    terms = [t for t in re.findall(r"[\wऀ-ॿ]+", text.lower()) if len(t) > 1]
    stop = {"what", "which", "the", "was", "were", "is", "are", "of", "in", "for", "and", "to", "a", "an", "how", "why", "did", "does", "do", "give", "show", "tell", "me", "about", "during", "by", "with", "on", "from", "between", "list"}
    terms = [t for t in terms if t not in stop][:16]
    if not terms:
        return None
    return " OR ".join(f'"{t}"' for t in terms)


def _allowed(document_ids: list[int] | None, doc_kinds: list[str] | None) -> set[int] | None:
    if not document_ids and not doc_kinds:
        return None
    clauses, params = [], []
    if document_ids:
        clauses.append(f"c.document_id IN ({','.join('?' * len(document_ids))})")
        params += document_ids
    if doc_kinds:
        clauses.append(f"d.doc_kind IN ({','.join('?' * len(doc_kinds))})")
        params += doc_kinds
    return {r["id"] for r in db.rows(f"SELECT c.id FROM chunks c JOIN documents d ON d.id=c.document_id WHERE {' AND '.join(clauses)}", params)}


def search(query: str, k: int = 8, document_ids: list[int] | None = None, doc_kinds: list[str] | None = None, exclude_kinds: list[str] | None = None) -> list[dict]:
    allowed = _allowed(document_ids, doc_kinds)
    ranked: dict[int, float] = {}
    lexical: dict[int, int] = {}
    vector_score: dict[int, float] = {}

    fts = _fts_query(query)
    if fts:
        try:
            hits = db.rows("SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT 40", (fts,))
        except Exception:  # noqa: BLE001 — a malformed MATCH must never fail a question
            hits = []
        rank = 0
        for hit in hits:
            if allowed is not None and hit["id"] not in allowed:
                continue
            rank += 1
            lexical[hit["id"]] = rank
            ranked[hit["id"]] = ranked.get(hit["id"], 0.0) + 1.0 / (RRF_K + rank)

    ids, matrix = _load()
    if len(ids):
        q = embed.embed_query(query)
        sims = matrix @ q
        order = np.argsort(-sims)[:60]
        rank = 0
        for index in order:
            chunk_id = int(ids[index])
            if allowed is not None and chunk_id not in allowed:
                continue
            rank += 1
            vector_score[chunk_id] = float(sims[index])
            ranked[chunk_id] = ranked.get(chunk_id, 0.0) + 1.0 / (RRF_K + rank)
            if rank >= 40:
                break

    top = sorted(ranked.items(), key=lambda kv: -kv[1])[: k * 3]
    if not top:
        return []
    placeholders = ",".join("?" * len(top))
    details = {
        r["id"]: r
        for r in db.rows(
            f"""SELECT c.id, c.document_id, c.page_no, c.heading_path, c.text, c.bbox, c.kind, c.table_id,
                       d.filename, d.title, d.doc_kind, d.year, d.pq_house, d.pq_number, d.pq_date, d.pq_subject
                FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id IN ({placeholders})""",
            [cid for cid, _ in top],
        )
    }
    results = []
    for chunk_id, score in top:
        detail = details.get(chunk_id)
        if not detail or (exclude_kinds and detail["kind"] in exclude_kinds):
            continue
        detail = dict(detail)
        detail["bbox"] = db.loads(detail["bbox"])
        detail["score"] = round(score, 5)
        detail["vector_sim"] = round(vector_score.get(chunk_id, 0.0), 4)
        detail["lexical_rank"] = lexical.get(chunk_id)
        results.append(detail)
        if len(results) >= k:
            break
    return results


def is_relevant(results: list[dict]) -> bool:
    """Enough evidence to answer from? Weak vector similarity and no keyword hit means no."""
    if not results:
        return False
    best = results[0]
    return best["vector_sim"] >= 0.80 or best["lexical_rank"] is not None
