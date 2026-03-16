# backend/ml/embedding_cache.py
"""
Embedding cache: stores sentence vectors in ml.embedding_cache (PostgreSQL BYTEA).
Only recomputes embeddings for new/unseen texts.
"""
import logging
import pickle
from typing import Dict, List, Optional, Tuple

import numpy as np

from core.pg import get_conn, get_cursor

logger = logging.getLogger(__name__)


def _serialize(vec: np.ndarray) -> bytes:
    return pickle.dumps(vec, protocol=4)


def _deserialize(data: bytes) -> np.ndarray:
    return pickle.loads(data)


def get_or_compute(
    items: List[Tuple[str, str]],
    model,
    batch_size: int = 64,
) -> Dict[str, np.ndarray]:
    """
    Return embeddings for all (ref, text) pairs.
    - `ref` is a stable unique key (e.g. "assembly:us_sn" or "pcba:serial")
    - `text` is the ng_reason string to embed
    - `model` is a sentence_transformers.SentenceTransformer instance

    Only calls model.encode() for refs not already in the cache.
    Returns dict[ref -> np.ndarray].
    """
    if not items:
        return {}

    refs = [r for r, _ in items]
    text_by_ref = {r: t for r, t in items}

    # ── Load cached ───────────────────────────────────────────
    cached: Dict[str, np.ndarray] = {}
    try:
        with get_cursor("ml") as cur:
            cur.execute(
                "SELECT ref, embedding FROM ml.embedding_cache WHERE ref = ANY(%s)",
                (refs,),
            )
            for row in cur.fetchall():
                cached[row["ref"]] = _deserialize(bytes(row["embedding"]))
    except Exception as e:
        logger.warning("[EmbCache] load error: %s", e)

    # ── Compute missing ───────────────────────────────────────
    missing_refs = [r for r in refs if r not in cached]
    logger.info(
        "[EmbCache] cached=%d / missing=%d", len(cached), len(missing_refs)
    )

    if missing_refs:
        texts = [text_by_ref[r] for r in missing_refs]
        vecs = model.encode(texts, batch_size=batch_size, show_progress_bar=False)

        # ── Persist new embeddings ────────────────────────────
        rows_to_insert = []
        for ref, text, vec in zip(missing_refs, texts, vecs):
            cached[ref] = vec
            rows_to_insert.append((ref, text, _serialize(vec)))

        try:
            with get_conn("ml") as conn:
                cur = conn.cursor()
                for ref, source, blob in rows_to_insert:
                    cur.execute(
                        """
                        INSERT INTO ml.embedding_cache (ref, source, embedding)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (ref) DO UPDATE
                          SET source = EXCLUDED.source,
                              embedding = EXCLUDED.embedding,
                              created_at = NOW()
                        """,
                        (ref, source, blob),
                    )
                cur.close()
        except Exception as e:
            logger.warning("[EmbCache] persist error: %s", e)

    return {r: cached[r] for r in refs if r in cached}
