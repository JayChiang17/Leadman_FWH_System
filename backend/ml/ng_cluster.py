# backend/ml/ng_cluster.py
"""
NG reason text clustering using sentence-transformers + HDBSCAN.
Groups similar NG reasons into clusters for Pareto analysis.
"""

import logging
import time
from typing import List, Tuple

import numpy as np

from core.pg import get_conn, get_cursor
from ml.embedding_cache import get_or_compute

logger = logging.getLogger(__name__)

_MODEL = None


def _get_model():
    global _MODEL
    if _MODEL is None:
        logger.info("[ML-Cluster] Loading sentence-transformer model...")
        try:
            from sentence_transformers import SentenceTransformer
            _MODEL = SentenceTransformer("all-MiniLM-L6-v2")
            logger.info("[ML-Cluster] Model loaded")
        except ImportError as e:
            logger.error("[ML-Cluster] sentence-transformers not installed: %s", e)
            raise
    return _MODEL


def _fetch_ng_reasons() -> List[Tuple[str, str]]:
    """
    Collect (ref, text) pairs from:
    - assembly.scans   (ng_reason where status='NG')
    - pcba.boards      (ng_reason text if available)

    Returns list of (ref, text) where ref is "src:key".
    """
    items: List[Tuple[str, str]] = []

    try:
        with get_cursor("assembly") as cur:
            cur.execute(
                """
                SELECT us_sn, ng_reason
                FROM assembly.scans
                WHERE UPPER(status) IN ('NG', 'FIXED')
                  AND ng_reason IS NOT NULL
                  AND ng_reason <> ''
                """
            )
            for row in cur.fetchall():
                items.append((f"assembly:{row['us_sn']}", row["ng_reason"]))
    except Exception as e:
        logger.warning("[ML-Cluster] assembly fetch error: %s", e)

    logger.info("[ML-Cluster] Collected %d NG reason texts", len(items))
    return items


def _merge_similar_clusters(cluster_data, orig_centroids, threshold=0.82):
    """
    Merge HDBSCAN clusters whose original-space centroids have cosine
    similarity >= threshold. Fixes fragmentation like:
      'Air Leak', 'Air leak (low)', 'Air Leak High', 'Air Leak (High)'
    being split into separate clusters.
    """
    n = len(cluster_data)
    if n <= 1:
        return cluster_data

    try:
        from sklearn.metrics.pairwise import cosine_similarity as cos_sim
    except ImportError:
        return cluster_data

    mat = np.array(orig_centroids, dtype=np.float32)
    sim = cos_sim(mat)  # shape (n, n)

    # Union-Find with path compression
    parent = list(range(n))

    def find(x):
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    for i in range(n):
        for j in range(i + 1, n):
            if sim[i][j] >= threshold:
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[ri] = rj

    # Group by root
    groups: dict = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    merged = []
    for members in groups.values():
        total = sum(cluster_data[m]["count"] for m in members)
        all_samples: list = []
        all_member_sns: list = []
        for m in members:
            all_samples.extend(cluster_data[m]["samples"])
            all_member_sns.extend(cluster_data[m].get("member_sns", []))
        # Representative from the largest sub-cluster
        largest = max(members, key=lambda m: cluster_data[m]["count"])
        rep = cluster_data[largest]["representative"]
        merged.append({
            "cluster_id": 0,  # reassigned below
            "count": total,
            "representative": rep,
            "samples": list(dict.fromkeys(all_samples))[:5],
            "member_sns": all_member_sns,
        })

    # Re-sort by count descending, reassign IDs
    merged.sort(key=lambda c: -c["count"])
    for i, c in enumerate(merged):
        c["cluster_id"] = i
    return merged


def run_clustering() -> int:
    """
    Run the full clustering pipeline:
    1. Fetch NG texts
    2. Get/compute embeddings (cached)
    3. PCA reduction
    4. HDBSCAN clustering
    5. UPSERT ml.ng_clusters

    Returns number of clusters found (excluding noise).
    """
    try:
        from sklearn.decomposition import PCA
    except ImportError as e:
        logger.error("[ML-Cluster] scikit-learn not installed: %s", e)
        return 0

    try:
        import hdbscan
    except ImportError as e:
        logger.error("[ML-Cluster] hdbscan not installed: %s", e)
        return 0

    t0 = time.time()
    logger.info("[ML-Cluster] ════ Starting clustering ════")

    items = _fetch_ng_reasons()
    if len(items) < 3:
        logger.warning("[ML-Cluster] Too few samples (%d), skipping clustering", len(items))
        return 0

    model = _get_model()
    emb_map = get_or_compute(items, model)

    # Build matrix in order
    valid_items = [(ref, text) for ref, text in items if ref in emb_map]
    if len(valid_items) < 3:
        logger.warning("[ML-Cluster] Too few embeddings after cache lookup, skipping")
        return 0

    texts = [text for _, text in valid_items]
    vecs = np.array([emb_map[ref] for ref, _ in valid_items], dtype=np.float32)
    logger.info("[ML-Cluster] Embedding matrix: %s", vecs.shape)

    # ── PCA dimensionality reduction ──────────────────────────
    n_components = min(10, len(valid_items) - 1, vecs.shape[1])
    if n_components < 2:
        reduced = vecs
    else:
        pca = PCA(n_components=n_components, random_state=42)
        reduced = pca.fit_transform(vecs)
        logger.info(
            "[ML-Cluster] PCA: %dd → %dd (var=%.2f%%)",
            vecs.shape[1],
            n_components,
            pca.explained_variance_ratio_.sum() * 100,
        )

    # ── HDBSCAN ───────────────────────────────────────────────
    min_cs = max(3, min(10, len(valid_items) // 20))
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cs,
        min_samples=2,
        metric="euclidean",
        prediction_data=True,
    )
    labels = clusterer.fit_predict(reduced)

    n_clusters = int(labels.max()) + 1 if labels.max() >= 0 else 0
    n_noise = int((labels == -1).sum())
    logger.info("[ML-Cluster] Result: %d clusters, %d noise", n_clusters, n_noise)

    if n_clusters == 0:
        logger.warning("[ML-Cluster] No clusters found")
        return 0

    # ── Build cluster summaries ───────────────────────────────
    cluster_data = []
    orig_centroids = []   # centroids in original embedding space (for merge)

    # valid_items[i][0] is "assembly:us_sn"
    refs = [ref for ref, _ in valid_items]

    for cid in range(n_clusters):
        mask = labels == cid
        idx = np.where(mask)[0]
        cluster_texts = [texts[i] for i in idx]
        cluster_vecs = reduced[idx]
        orig_vecs = vecs[idx]

        # Representative: text closest to centroid (in PCA space)
        centroid = cluster_vecs.mean(axis=0)
        dists = np.linalg.norm(cluster_vecs - centroid, axis=1)
        rep_idx = int(dists.argmin())
        representative = cluster_texts[rep_idx]

        # Centroid in original embedding space (for cosine merge)
        orig_centroids.append(orig_vecs.mean(axis=0))

        # Sample: up to 5 unique examples
        samples = list(dict.fromkeys(cluster_texts))[:5]

        # All member us_sns (strip "assembly:" prefix)
        member_sns = [
            refs[i].split(":", 1)[1]
            for i in idx
            if refs[i].startswith("assembly:")
        ]

        cluster_data.append(
            {
                "cluster_id": cid,
                "count": len(idx),
                "representative": representative,
                "samples": samples,
                "member_sns": member_sns,
            }
        )
        logger.info(
            "[ML-Cluster]   Cluster %d (%d): %s",
            cid,
            len(idx),
            representative[:60],
        )

    # ── Post-process: merge semantically similar clusters ─────
    before_merge = len(cluster_data)
    cluster_data = _merge_similar_clusters(cluster_data, orig_centroids, threshold=0.82)
    after_merge = len(cluster_data)
    if after_merge < before_merge:
        logger.info(
            "[ML-Cluster] Merged %d → %d clusters (cosine threshold=0.82)",
            before_merge, after_merge,
        )
    for c in cluster_data:
        logger.info(
            "[ML-Cluster]   Final %d (%d): %s",
            c["cluster_id"], c["count"], c["representative"][:60],
        )

    # ── Persist ───────────────────────────────────────────────
    try:
        with get_conn("ml") as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM ml.ng_clusters")
            for c in cluster_data:
                cur.execute(
                    """
                    INSERT INTO ml.ng_clusters
                      (cluster_id, count, representative, samples, member_sns)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        c["cluster_id"], c["count"], c["representative"],
                        c["samples"], c.get("member_sns", []),
                    ),
                )
            cur.close()
        logger.info("[ML-Cluster] UPSERT ml.ng_clusters: %d rows", len(cluster_data))
    except Exception as e:
        logger.error("[ML-Cluster] persist error: %s", e)

    elapsed = time.time() - t0
    logger.info("[ML-Cluster] ════ Clustering complete (%.1fs) ════", elapsed)
    return n_clusters
