"""SQLite store: evidence layer, fact layer, master data, audit.

One file, WAL mode, one connection per thread. The schema is plain SQL so the
same layer can move to PostgreSQL (+pgvector) in production without changing
the services above it.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterable

from .config import DB_PATH

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
    id            INTEGER PRIMARY KEY,
    sha256        TEXT UNIQUE NOT NULL,
    filename      TEXT NOT NULL,
    mime          TEXT,
    ext           TEXT,
    bytes         INTEGER,
    store_path    TEXT NOT NULL,
    doc_kind      TEXT DEFAULT 'document',   -- pq_reply | coal_directory | annual_report | provisional_stats | press_release | spreadsheet | geological_report | document
    title         TEXT,
    subsidiary    TEXT,
    year          INTEGER,
    language      TEXT DEFAULT 'en',
    precedence    INTEGER DEFAULT 50,        -- higher wins when sources disagree
    is_provisional INTEGER DEFAULT 0,
    pq_house      TEXT,
    pq_number     TEXT,
    pq_date       TEXT,
    pq_subject    TEXT,
    status        TEXT DEFAULT 'queued',     -- queued | parsing | extracting | indexing | ready | failed
    status_detail TEXT,
    pages         INTEGER DEFAULT 0,
    parser        TEXT,
    parser_version TEXT,
    ingested_at   REAL,
    updated_at    REAL
);

CREATE TABLE IF NOT EXISTS pages (
    id          INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_no     INTEGER NOT NULL,
    width       REAL,
    height      REAL,
    has_text_layer INTEGER DEFAULT 1,
    ocr_used    INTEGER DEFAULT 0,
    vlm_used    INTEGER DEFAULT 0,
    UNIQUE (document_id, page_no)
);

CREATE TABLE IF NOT EXISTS blocks (
    id          INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_no     INTEGER,
    kind        TEXT,          -- text | heading | caption | list | figure_description | footnote
    heading_path TEXT,
    text        TEXT,
    bbox        TEXT,          -- JSON [x0,y0,x1,y1] normalised 0..1, origin top-left
    source      TEXT DEFAULT 'parser'  -- parser | ocr | vlm
);

CREATE TABLE IF NOT EXISTS tables_ (
    id          INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_no     INTEGER,
    ordinal     INTEGER,
    caption     TEXT,
    heading_path TEXT,
    context     TEXT,
    n_rows      INTEGER,
    n_cols      INTEGER,
    bbox        TEXT,
    mapping     TEXT,          -- JSON: the LLM's column/row mapping, kept for audit
    mapping_status TEXT        -- mapped | not_data | failed | skipped
);

CREATE TABLE IF NOT EXISTS cells (
    id          INTEGER PRIMARY KEY,
    table_id    INTEGER NOT NULL REFERENCES tables_(id) ON DELETE CASCADE,
    row_idx     INTEGER,
    col_idx     INTEGER,
    text        TEXT,
    is_header   INTEGER DEFAULT 0,
    bbox        TEXT,
    page_no     INTEGER
);
CREATE INDEX IF NOT EXISTS cells_table ON cells(table_id, row_idx, col_idx);

CREATE TABLE IF NOT EXISTS chunks (
    id          INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_no     INTEGER,
    heading_path TEXT,
    text        TEXT,
    bbox        TEXT,
    kind        TEXT DEFAULT 'text',   -- text | table | figure
    table_id    INTEGER,
    embedding   BLOB
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, heading_path, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text, heading_path) VALUES (new.id, new.text, new.heading_path);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text, heading_path) VALUES ('delete', old.id, old.text, old.heading_path);
END;

CREATE TABLE IF NOT EXISTS facts (
    id          INTEGER PRIMARY KEY,
    entity_code TEXT NOT NULL,       -- canonical code: SECL, CIL, ALL_INDIA, STATE:JH, MINE:Gevra ...
    entity_type TEXT,                -- subsidiary | company | country | state | coalfield | mine | other
    entity_raw  TEXT,
    metric      TEXT NOT NULL,       -- coal_production | coal_offtake | obr | production_target | ...
    value       REAL NOT NULL,
    unit        TEXT NOT NULL,       -- canonical unit (million_tonnes, million_cubic_metres, ...)
    period      TEXT NOT NULL,       -- FY2023-24 | 2024-09 | FY2024-25:Apr-Sep | raw
    period_kind TEXT,                -- fy | month | fy_partial | calendar_year | raw
    is_provisional INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'consistent',  -- verified | consistent | flagged | rejected
    reviewed    INTEGER DEFAULT 0,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    created_at  REAL
);
CREATE INDEX IF NOT EXISTS facts_key ON facts(metric, entity_code, period);

CREATE TABLE IF NOT EXISTS fact_sources (
    id          INTEGER PRIMARY KEY,
    fact_id     INTEGER NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
    document_id INTEGER,
    table_id    INTEGER,
    cell_id     INTEGER,
    page_no     INTEGER,
    row_idx     INTEGER,
    col_idx     INTEGER,
    raw_text    TEXT,
    raw_unit    TEXT,
    conversion  TEXT,       -- e.g. "lakh_tonnes × 0.1 → million_tonnes"
    bbox        TEXT,
    parser      TEXT
);

CREATE TABLE IF NOT EXISTS fact_checks (
    id          INTEGER PRIMARY KEY,
    fact_id     INTEGER NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
    check_name  TEXT,
    result      TEXT,       -- pass | fail | warn | na
    detail      TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
    id          INTEGER PRIMARY KEY,
    fact_id     INTEGER REFERENCES facts(id) ON DELETE CASCADE,
    action      TEXT,       -- accept | edit | reject
    old_value   REAL,
    new_value   REAL,
    note        TEXT,
    reviewer    TEXT,
    at          REAL
);

CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY,
    kind        TEXT,
    document_id INTEGER,
    status      TEXT DEFAULT 'queued',   -- queued | running | done | failed
    progress    REAL DEFAULT 0,
    detail      TEXT,
    steps       TEXT,                    -- JSON list of {step, automated, seconds}
    created_at  REAL,
    started_at  REAL,
    finished_at REAL
);

CREATE TABLE IF NOT EXISTS answers (
    id          INTEGER PRIMARY KEY,
    kind        TEXT,           -- ask | pq | report
    question    TEXT,
    route       TEXT,
    payload     TEXT,           -- JSON result as returned to the client
    guard_ok    INTEGER,
    unsupported INTEGER DEFAULT 0,
    numbers     INTEGER DEFAULT 0,
    seconds     REAL,
    at          REAL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY,
    at          REAL,
    actor       TEXT,
    action      TEXT,
    detail      TEXT
);
"""

_local = threading.local()
_init_lock = threading.Lock()
_initialised = False


def connect() -> sqlite3.Connection:
    global _initialised
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        _local.conn = conn
    if not _initialised:
        with _init_lock:
            if not _initialised:
                conn.executescript(SCHEMA)
                conn.commit()
                _initialised = True
    return conn


@contextmanager
def tx():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def rows(sql: str, params: Iterable[Any] = ()) -> list[dict]:
    return [dict(r) for r in connect().execute(sql, tuple(params)).fetchall()]


def row(sql: str, params: Iterable[Any] = ()) -> dict | None:
    r = connect().execute(sql, tuple(params)).fetchone()
    return dict(r) if r else None


def scalar(sql: str, params: Iterable[Any] = ()) -> Any:
    r = connect().execute(sql, tuple(params)).fetchone()
    return r[0] if r else None


def execute(sql: str, params: Iterable[Any] = ()) -> int:
    with tx() as conn:
        cur = conn.execute(sql, tuple(params))
        return cur.lastrowid


def audit(action: str, detail: Any = None, actor: str = "system") -> None:
    execute(
        "INSERT INTO audit_log(at, actor, action, detail) VALUES (?,?,?,?)",
        (time.time(), actor, action, json.dumps(detail, default=str) if detail is not None else None),
    )


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def loads(value: str | None, default: Any = None) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default
