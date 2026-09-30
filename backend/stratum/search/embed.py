"""multilingual-e5-small embeddings on CPU (English + Hindi), kept in memory.

~20k chunks × 384 floats is ~30 MB, and a brute-force cosine over it takes
milliseconds — a vector database would be infrastructure for its own sake at
this scale. In production the same vectors move to pgvector.
"""

from __future__ import annotations

import logging
import os
import threading

import numpy as np

from ..config import EMBED_MODEL

log = logging.getLogger("stratum.embed")

if os.path.exists("D:/") and not os.environ.get("HF_HOME"):
    os.environ["HF_HOME"] = "D:/stratum/hf"

_model = None
_model_lock = threading.Lock()
DIM = 384


def model():
    global _model
    with _model_lock:
        if _model is None:
            from sentence_transformers import SentenceTransformer

            log.info("loading embedding model %s", EMBED_MODEL)
            _model = SentenceTransformer(EMBED_MODEL, device="cpu")
        return _model


def embed_passages(texts: list[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, DIM), dtype=np.float32)
    vectors = model().encode([f"passage: {t[:2000]}" for t in texts], batch_size=16, normalize_embeddings=True, show_progress_bar=False)
    return np.asarray(vectors, dtype=np.float32)


def embed_query(text: str) -> np.ndarray:
    vector = model().encode([f"query: {text}"], normalize_embeddings=True, show_progress_bar=False)
    return np.asarray(vector[0], dtype=np.float32)


def to_blob(vector: np.ndarray) -> bytes:
    return np.asarray(vector, dtype=np.float32).tobytes()


def from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)
