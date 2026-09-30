"""Topic identification + word cloud.

BERTopic over the library's text chunks, reusing the embeddings already stored
for search (no second embedding pass). K-means rather than HDBSCAN as the
cluster model, so a small library still yields topics instead of "all noise".
Topics are counted per document year (topic-over-time) and per subsidiary, and
every topic keeps the chunk ids it came from, for drill-down to the page.
"""

from __future__ import annotations

import io
import json
import logging
import re
import time
from collections import Counter

import numpy as np

from .. import db, domain, llm
from ..config import HOME
from ..search import embed

log = logging.getLogger("stratum.topics")

RESULT_PATH = HOME / "topics.json"
CLOUD_PATH = HOME / "wordcloud.png"


def _stopwords() -> list[str]:
    from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS

    return sorted(set(ENGLISH_STOP_WORDS) | {str(word) for word in domain.master()["stopwords_domain"]})


def _clean(text: str) -> str:
    text = re.sub(r"\b\d[\d,./-]*\b", " ", text)
    return re.sub(r"\s+", " ", text)


LABEL_SCHEMA = {
    "type": "object",
    "properties": {"labels": {"type": "array", "items": {"type": "string"}}},
    "required": ["labels"],
    "additionalProperties": False,
}


def _labels(keyword_lists: list[list[str]]) -> list[str]:
    fallback = [" · ".join(words[:3]).title() for words in keyword_lists]
    if not llm.available():
        return fallback
    listing = "\n".join(f"{i + 1}. {', '.join(words[:8])}" for i, words in enumerate(keyword_lists))
    try:
        answer = llm.chat_json(
            [
                {"role": "system", "content": "Name each topic from a coal-sector document collection in 2–4 words (e.g. 'Mine safety', 'Coal import substitution'). Return JSON {\"labels\": [...]} with one label per numbered line, in order."},
                {"role": "user", "content": listing},
            ],
            LABEL_SCHEMA,
            schema_name="st_topic_labels",
            max_tokens=300,
        )
        labels = [str(l).strip() for l in answer.get("labels", [])]
        return [labels[i] if i < len(labels) and labels[i] else fallback[i] for i in range(len(keyword_lists))]
    except Exception:  # noqa: BLE001
        return fallback


def rebuild(n_topics: int | None = None) -> dict:
    started = time.time()
    chunks = db.rows(
        """SELECT c.id, c.text, c.embedding, c.document_id, c.page_no, d.year, d.subsidiary, d.doc_kind, d.filename
           FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.kind != 'table' AND c.embedding IS NOT NULL"""
    )
    if len(chunks) < 12:
        result = {"status": "too_few", "message": f"Only {len(chunks)} text chunks in the library — ingest more documents to discover topics.", "topics": [], "built_at": time.time()}
        RESULT_PATH.write_text(json.dumps(result), encoding="utf-8")
        return result
    docs = [_clean(c["text"]) for c in chunks]
    vectors = np.vstack([embed.from_blob(c["embedding"]) for c in chunks])
    k = n_topics or max(3, min(12, len(chunks) // 12))

    from bertopic import BERTopic
    from sklearn.cluster import KMeans
    from sklearn.decomposition import PCA
    from sklearn.feature_extraction.text import CountVectorizer

    vectorizer = CountVectorizer(stop_words=_stopwords(), ngram_range=(1, 2), min_df=2 if len(docs) > 40 else 1, token_pattern=r"(?u)\b[a-zA-Zऀ-ॿ][a-zA-Zऀ-ॿ-]{2,}\b")
    model = BERTopic(
        embedding_model=None,
        umap_model=PCA(n_components=min(10, len(docs) - 1)),
        hdbscan_model=KMeans(n_clusters=k, n_init=10, random_state=42),
        vectorizer_model=vectorizer,
        calculate_probabilities=False,
        verbose=False,
    )
    assignments, _ = model.fit_transform(docs, embeddings=vectors)

    info = model.get_topic_info()
    keyword_lists, topic_ids = [], []
    for topic_id in info["Topic"].tolist():
        if topic_id == -1:
            continue
        words = [w for w, _ in (model.get_topic(topic_id) or [])][:10]
        keyword_lists.append(words)
        topic_ids.append(topic_id)
    labels = _labels(keyword_lists)

    topics = []
    for label, words, topic_id in zip(labels, keyword_lists, topic_ids):
        members = [c for c, a in zip(chunks, assignments) if a == topic_id]
        by_year = Counter(str(c["year"]) for c in members if c["year"])
        by_subsidiary = Counter(c["subsidiary"] for c in members if c["subsidiary"])
        by_kind = Counter(c["doc_kind"] for c in members)
        topics.append(
            {
                "id": int(topic_id),
                "label": label,
                "keywords": words,
                "count": len(members),
                "by_year": dict(sorted(by_year.items())),
                "by_subsidiary": dict(by_subsidiary.most_common()),
                "by_kind": dict(by_kind.most_common()),
                "examples": [{"chunk_id": c["id"], "document_id": c["document_id"], "filename": c["filename"], "page_no": c["page_no"], "snippet": c["text"][:240]} for c in members[:6]],
            }
        )
    topics.sort(key=lambda t: -t["count"])

    # Word cloud from the same vocabulary, weighted by term frequency.
    counts = CountVectorizer(stop_words=_stopwords(), token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z-]{3,}\b").fit(docs)
    matrix = counts.transform(docs)
    freqs = dict(zip(counts.get_feature_names_out(), np.asarray(matrix.sum(axis=0)).ravel().tolist()))
    top_terms = dict(sorted(freqs.items(), key=lambda kv: -kv[1])[:150])
    try:
        from wordcloud import WordCloud

        cloud = WordCloud(width=1100, height=520, background_color=None, mode="RGBA", colormap="viridis", prefer_horizontal=0.95, random_state=7).generate_from_frequencies(top_terms)
        buffer = io.BytesIO()
        cloud.to_image().save(buffer, format="PNG")
        CLOUD_PATH.write_bytes(buffer.getvalue())
    except Exception as error:  # noqa: BLE001
        log.warning("word cloud failed: %s", error)

    result = {
        "status": "ok",
        "topics": topics,
        "terms": [{"term": t, "count": int(n)} for t, n in list(top_terms.items())[:60]],
        "chunks": len(chunks),
        "documents": len({c["document_id"] for c in chunks}),
        "built_at": time.time(),
        "seconds": round(time.time() - started, 2),
    }
    RESULT_PATH.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


def current() -> dict:
    if RESULT_PATH.exists():
        return json.loads(RESULT_PATH.read_text(encoding="utf-8"))
    return {"status": "not_built", "topics": [], "message": "Topics have not been built yet."}


def wordcloud_png() -> bytes | None:
    return CLOUD_PATH.read_bytes() if CLOUD_PATH.exists() else None
