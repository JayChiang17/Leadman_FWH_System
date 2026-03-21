# backend/api/ml.py
"""
ML API Router

GET  /api/ml/status      — trigger counter, training state, last log
GET  /api/ml/ng-clusters — list of NG reason clusters (for Pareto chart)
POST /api/ml/retrain     — manual retrain (admin only)
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.deps import get_current_user
from core.pg import get_conn, get_cursor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ml", tags=["ml"])


def _ensure_ml_schema():
    """Idempotently create the ml schema and all required tables."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("CREATE SCHEMA IF NOT EXISTS ml")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ml.embedding_cache (
                ref        TEXT PRIMARY KEY,
                source     TEXT NOT NULL,
                embedding  BYTEA NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ml.training_log (
                id          SERIAL PRIMARY KEY,
                trained_at  TIMESTAMPTZ DEFAULT NOW(),
                trigger     TEXT,
                sample_size INTEGER,
                ng_count    INTEGER,
                old_auc     FLOAT,
                new_auc     FLOAT,
                accepted    BOOLEAN,
                note        TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ml.predictions (
                us_sn        TEXT PRIMARY KEY,
                risk_score   FLOAT NOT NULL,
                risk_level   TEXT NOT NULL,
                predicted_at TIMESTAMPTZ DEFAULT NOW(),
                model_ver    TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ml.ng_clusters (
                id              SERIAL PRIMARY KEY,
                cluster_id      INTEGER NOT NULL,
                count           INTEGER NOT NULL,
                representative  TEXT NOT NULL,
                samples         TEXT[],
                member_sns      TEXT[],
                created_at      TIMESTAMPTZ DEFAULT NOW()
            )
            """
        )
        # Add member_sns column to existing tables (idempotent)
        cur.execute(
            """
            ALTER TABLE ml.ng_clusters
            ADD COLUMN IF NOT EXISTS member_sns TEXT[]
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_ml_predictions_us_sn ON ml.predictions(us_sn)"
        )
        # Add shap_values column (idempotent)
        cur.execute(
            "ALTER TABLE ml.predictions ADD COLUMN IF NOT EXISTS shap_values JSONB"
        )
        cur.close()
    logger.info("[ml] Schema ensured")


# ── /api/ml/status ────────────────────────────────────────────────────────────

@router.get("/status", summary="ML trigger status and last training log")
async def ml_status(user=Depends(get_current_user)):
    from ml.ng_trigger import get_status
    state = get_status()

    # Fetch last training log entry
    last_log: Optional[Dict[str, Any]] = None
    try:
        with get_cursor("ml") as cur:
            cur.execute(
                """
                SELECT id, trained_at, trigger, sample_size, ng_count,
                       old_auc, new_auc, accepted, note
                FROM ml.training_log
                ORDER BY trained_at DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
            if row:
                last_log = dict(row)
                if last_log.get("trained_at"):
                    last_log["trained_at"] = last_log["trained_at"].isoformat()
    except Exception as e:
        logger.warning("[ml.status] DB error: %s", e)

    return {
        "counter": state["counter"],
        "threshold": state["threshold"],
        "is_training": state["is_training"],
        "last_trained_at": state["last_trained_at"],
        "last_training_log": last_log,
    }


# ── /api/ml/ng-clusters ───────────────────────────────────────────────────────

@router.get("/ng-clusters", summary="NG reason clusters for Pareto chart")
async def ng_clusters(user=Depends(get_current_user)):
    try:
        with get_cursor("ml") as cur:
            cur.execute(
                """
                SELECT cluster_id, count, representative, samples, created_at
                FROM ml.ng_clusters
                ORDER BY count DESC
                """
            )
            rows = cur.fetchall()
    except Exception as e:
        logger.error("[ml.ng-clusters] DB error: %s", e)
        raise HTTPException(500, f"DB error: {e}")

    if not rows:
        return {"clusters": [], "total_ng": 0}

    total = sum(r["count"] for r in rows)
    clusters: List[Dict] = []
    for r in rows:
        pct = round(r["count"] / total * 100, 1) if total > 0 else 0.0
        clusters.append(
            {
                "cluster_id": r["cluster_id"],
                "count": r["count"],
                "representative": r["representative"],
                "samples": list(r["samples"] or []),
                "pct": pct,
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }
        )

    return {"clusters": clusters, "total_ng": total}


# ── /api/ml/ng-clusters/{cluster_id}/detail ───────────────────────────────────

@router.get("/ng-clusters/{cluster_id}/detail", summary="Detailed records for one NG cluster")
async def ng_cluster_detail(cluster_id: int, user=Depends(get_current_user)):
    # 1. Fetch cluster row
    try:
        with get_cursor("ml") as cur:
            cur.execute(
                """
                SELECT cluster_id, count, representative, samples, member_sns, created_at
                FROM ml.ng_clusters
                WHERE cluster_id = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (cluster_id,),
            )
            row = cur.fetchone()
    except Exception as e:
        raise HTTPException(500, f"DB error: {e}")

    if not row:
        raise HTTPException(404, "Cluster not found")

    member_sns: List[str] = list(row["member_sns"] or [])

    if not member_sns:
        return {
            "cluster_id": cluster_id,
            "representative": row["representative"],
            "count": row["count"],
            "records": [],
            "by_reason": [],
            "by_day": [],
            "by_product_line": [],
        }

    # 2. Fetch assembly records for all members
    try:
        with get_cursor("assembly") as cur:
            cur.execute(
                """
                SELECT us_sn, ng_reason, scanned_at, product_line
                FROM assembly.scans
                WHERE us_sn = ANY(%s)
                ORDER BY scanned_at DESC
                """,
                (member_sns,),
            )
            records = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(500, f"Assembly DB error: {e}")

    # Serialise timestamps
    for r in records:
        if r.get("scanned_at") and hasattr(r["scanned_at"], "isoformat"):
            r["scanned_at"] = r["scanned_at"].isoformat()

    # 3. Aggregate: by_reason
    reason_counts: Dict[str, int] = {}
    for r in records:
        key = (r.get("ng_reason") or "Unknown").strip()
        reason_counts[key] = reason_counts.get(key, 0) + 1
    by_reason = sorted(
        [{"reason": k, "count": v} for k, v in reason_counts.items()],
        key=lambda x: -x["count"],
    )

    # 4. Aggregate: by_day
    day_counts: Dict[str, int] = {}
    for r in records:
        ts = r.get("scanned_at") or ""
        day = str(ts)[:10] if ts else "unknown"
        day_counts[day] = day_counts.get(day, 0) + 1
    by_day = sorted(
        [{"day": k, "count": v} for k, v in day_counts.items()],
        key=lambda x: x["day"],
    )

    # 5. Aggregate: by_product_line
    pl_counts: Dict[str, int] = {}
    for r in records:
        pl = (r.get("product_line") or "Unknown").strip()
        pl_counts[pl] = pl_counts.get(pl, 0) + 1
    by_product_line = sorted(
        [{"product_line": k, "count": v} for k, v in pl_counts.items()],
        key=lambda x: -x["count"],
    )

    return {
        "cluster_id": cluster_id,
        "representative": row["representative"],
        "count": row["count"],
        "records": records[:200],
        "by_reason": by_reason,
        "by_day": by_day,
        "by_product_line": by_product_line,
    }


# ── /api/ml/retrain ───────────────────────────────────────────────────────────

@router.post("/retrain", summary="Manually trigger ML retrain (admin only)")
async def retrain(user=Depends(get_current_user)):
    if getattr(user, "role", None) != "admin":
        raise HTTPException(403, "Admin only")

    try:
        from ml.ng_trigger import trigger_manual
        started = await trigger_manual()
    except Exception as e:
        logger.error("[ml.retrain] error: %s", e)
        raise HTTPException(500, str(e))

    if not started:
        return {"started": False, "message": "Training already in progress"}

    return {"started": True, "message": "Training cycle started in background"}


# ── /api/ml/ng-3d ─────────────────────────────────────────────────────────────

@router.get("/ng-3d", summary="NG clusters × date × count for 3-D scatter chart")
async def ng_3d(days: int = 30, user=Depends(get_current_user)):
    """Returns per-cluster, per-day NG counts for the last N days."""
    try:
        with get_cursor("ml") as cur:
            cur.execute(
                """
                SELECT cluster_id, representative, member_sns, count
                FROM ml.ng_clusters
                ORDER BY count DESC
                LIMIT 12
                """
            )
            clusters = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(500, f"DB error: {e}")

    if not clusters:
        return {"data": [], "clusters": [], "dates": []}

    result: List[Dict] = []
    all_dates: set = set()

    for c in clusters:
        member_sns = list(c.get("member_sns") or [])
        if not member_sns:
            continue
        try:
            with get_cursor("assembly") as cur:
                cur.execute(
                    """
                    SELECT
                        DATE(scanned_at AT TIME ZONE 'America/Los_Angeles') AS day,
                        COUNT(*) AS cnt
                    FROM assembly.scans
                    WHERE us_sn = ANY(%s)
                      AND scanned_at >= NOW() - (%s * INTERVAL '1 day')
                    GROUP BY day
                    ORDER BY day
                    """,
                    (member_sns, days),
                )
                for row in cur.fetchall():
                    day_str = str(row["day"])
                    all_dates.add(day_str)
                    result.append({
                        "cluster":    c["representative"][:28],
                        "cluster_id": c["cluster_id"],
                        "date":       day_str,
                        "count":      row["cnt"],
                    })
        except Exception:
            pass

    sorted_dates = sorted(all_dates)
    cluster_names = [c["representative"][:28] for c in clusters if c.get("member_sns")]

    return {"data": result, "clusters": cluster_names, "dates": sorted_dates}


# ── /api/ml/shap/summary ──────────────────────────────────────────────────────

@router.get("/shap/summary", summary="Global SHAP feature importance (mean |SHAP| across all predictions)")
async def shap_summary(user=Depends(get_current_user)):
    """
    Returns mean absolute SHAP value per feature, aggregated across all stored
    predictions. Use this for the global feature-importance bar chart.
    """
    try:
        with get_cursor("ml") as cur:
            cur.execute(
                """
                SELECT shap_values
                FROM ml.predictions
                WHERE shap_values IS NOT NULL
                ORDER BY predicted_at DESC
                LIMIT 2000
                """
            )
            rows = cur.fetchall()
    except Exception as e:
        logger.error("[ml.shap.summary] DB error: %s", e)
        raise HTTPException(500, f"DB error: {e}")

    if not rows:
        return {"features": [], "sample_count": 0}

    from ml.ng_model import FEATURES
    import json as _json

    # Accumulate sum of |shap| per feature
    sums: Dict[str, float] = {f: 0.0 for f in FEATURES}
    count = 0
    for row in rows:
        sv = row["shap_values"]
        if not sv:
            continue
        # psycopg2 returns JSONB as dict already
        vals = sv.get("values") if isinstance(sv, dict) else _json.loads(sv).get("values", {})
        for f in FEATURES:
            sums[f] += abs(vals.get(f, 0.0))
        count += 1

    if count == 0:
        return {"features": [], "sample_count": 0}

    # Human-readable labels
    labels = {
        "hour_sin":              "Hour (sin)",
        "hour_cos":              "Hour (cos)",
        "day_of_week":           "Day of Week",
        "am7_batch_ng_rate":     "AM7 Batch NG Rate",
        "au8_batch_ng_rate":     "AU8 Batch NG Rate",
        "am7_board_ng":          "AM7 Board NG Flag",
        "au8_board_ng":          "AU8 Board NG Flag",
        "am7_board_age_days":    "AM7 Board Age (days)",
        "au8_board_age_days":    "AU8 Board Age (days)",
        "product_line_freq":     "Product Line Freq",
        "product_line_ng_rate":  "Product Line NG Rate",
        "production_seconds":    "Production Time (s)",
        "assembly_duration_sec": "Assembly Duration (s)",
        "daily_seq":             "Daily Sequence No.",
        "daily_ng_count_before": "NGs Before (today)",
    }

    features = sorted(
        [
            {
                "name":          f,
                "label":         labels.get(f, f),
                "mean_abs_shap": round(sums[f] / count, 6),
            }
            for f in FEATURES
        ],
        key=lambda x: -x["mean_abs_shap"],
    )
    return {"features": features, "sample_count": count}


# ── /api/ml/predictions/{us_sn}/shap ─────────────────────────────────────────

@router.get("/predictions/{us_sn}/shap", summary="SHAP explanation for a single assembly unit")
async def prediction_shap(us_sn: str, user=Depends(get_current_user)):
    """
    Returns the per-feature SHAP values for one unit.
    Positive values push toward NG; negative values push toward OK.
    """
    try:
        with get_cursor("ml") as cur:
            cur.execute(
                """
                SELECT us_sn, risk_score, risk_level, predicted_at, shap_values
                FROM ml.predictions
                WHERE us_sn = %s
                """,
                (us_sn,),
            )
            row = cur.fetchone()
    except Exception as e:
        raise HTTPException(500, f"DB error: {e}")

    if not row:
        raise HTTPException(404, "No prediction found for this unit")

    sv = row["shap_values"]
    if not sv:
        raise HTTPException(404, "SHAP data not yet computed for this unit — re-run predictions")

    import json as _json
    from ml.ng_model import FEATURES

    data = sv if isinstance(sv, dict) else _json.loads(sv)
    vals = data.get("values", {})
    base_value = data.get("base_value", 0.0)

    labels = {
        "hour_sin":              "Hour (sin)",
        "hour_cos":              "Hour (cos)",
        "day_of_week":           "Day of Week",
        "am7_batch_ng_rate":     "AM7 Batch NG Rate",
        "au8_batch_ng_rate":     "AU8 Batch NG Rate",
        "am7_board_ng":          "AM7 Board NG Flag",
        "au8_board_ng":          "AU8 Board NG Flag",
        "am7_board_age_days":    "AM7 Board Age (days)",
        "au8_board_age_days":    "AU8 Board Age (days)",
        "product_line_freq":     "Product Line Freq",
        "product_line_ng_rate":  "Product Line NG Rate",
        "production_seconds":    "Production Time (s)",
        "assembly_duration_sec": "Assembly Duration (s)",
        "daily_seq":             "Daily Sequence No.",
        "daily_ng_count_before": "NGs Before (today)",
    }

    features = sorted(
        [
            {
                "name":       f,
                "label":      labels.get(f, f),
                "shap_value": round(vals.get(f, 0.0), 6),
            }
            for f in FEATURES
        ],
        key=lambda x: -abs(x["shap_value"]),   # sort by impact magnitude
    )

    return {
        "us_sn":        row["us_sn"],
        "risk_score":   row["risk_score"],
        "risk_level":   row["risk_level"],
        "predicted_at": row["predicted_at"].isoformat() if row["predicted_at"] else None,
        "base_value":   round(base_value, 6),
        "features":     features,
    }
