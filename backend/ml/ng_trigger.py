# backend/ml/ng_trigger.py
"""
Event-driven ML update trigger.

Every time a new NG is marked in ATE, call record_new_ng().
When the counter reaches _THRESHOLD, a background training cycle runs:
  1. Train / evaluate XGBoost model
  2. If accepted: predict all assembling units, upsert ml.predictions
  3. Run HDBSCAN clustering, upsert ml.ng_clusters
  4. Log to ml.training_log
  5. Broadcast ml_updated via WebSocket
"""

import asyncio
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

_counter: int = 0
_THRESHOLD: int = 20
_is_training: bool = False
_last_trained_at: Optional[float] = None


def get_status() -> dict:
    """Return current trigger state (for /api/ml/status)."""
    return {
        "counter": _counter,
        "threshold": _THRESHOLD,
        "is_training": _is_training,
        "last_trained_at": _last_trained_at,
    }


async def record_new_ng(us_sn: str, ng_reason: str, product_line: Optional[str]):
    """
    Called after each successful ATE mark_ng.
    Increments counter; triggers background training when threshold hit.
    """
    global _counter, _is_training

    _counter += 1
    logger.debug("[ML-Trigger] NG counter: %d/%d  sn=%s", _counter, _THRESHOLD, us_sn)

    if _counter < _THRESHOLD or _is_training:
        return

    _counter = 0
    _is_training = True
    asyncio.create_task(_run_update())


async def trigger_manual():
    """Force a training cycle regardless of counter (admin retrain)."""
    global _counter, _is_training

    if _is_training:
        return False  # already running

    _counter = 0
    _is_training = True
    asyncio.create_task(_run_update(trigger="manual"))
    return True


async def _run_update(trigger: str = "auto"):
    """Background task: runs blocking training in executor, then broadcasts."""
    global _is_training, _last_trained_at
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, lambda: _blocking_train(trigger))
    except Exception as e:
        logger.error("[ML-Trigger] Training error: %s", e)
    finally:
        _is_training = False
        _last_trained_at = time.time()


def _blocking_train(trigger: str = "auto"):
    """
    Synchronous training pipeline (runs in thread pool).
    Safe to call from executor — no async I/O here.
    """
    from datetime import datetime

    try:
        from ml.ng_model import fetch_and_train, predict_assembling, upsert_predictions
        from ml.ng_cluster import run_clustering
        from core.pg import get_conn
        from core.ws_manager import ws_manager
    except ImportError as e:
        logger.error("[ML-Trigger] Import error: %s", e)
        return

    logger.info("[ML-Trigger] ── Starting training cycle (trigger=%s) ──", trigger)
    t0 = time.time()

    # 1. Train
    try:
        new_auc, old_auc, accepted = fetch_and_train()
    except Exception as e:
        logger.error("[ML-Trigger] Training failed: %s", e)
        new_auc, old_auc, accepted = 0.0, None, False

    # 2. Predict assembling units if model accepted
    if accepted:
        try:
            predictions = predict_assembling()
            upsert_predictions(predictions)
        except Exception as e:
            logger.error("[ML-Trigger] Prediction failed: %s", e)

    # 3. Clustering
    n_clusters = 0
    try:
        n_clusters = run_clustering()
    except Exception as e:
        logger.error("[ML-Trigger] Clustering failed: %s", e)

    # 4. Log to ml.training_log
    try:
        # Need to fetch sample size and NG count from DB
        from core.pg import get_cursor
        with get_cursor("assembly") as cur:
            cur.execute(
                "SELECT COUNT(*) AS total, "
                "SUM(CASE WHEN UPPER(status)='NG' THEN 1 ELSE 0 END) AS ng "
                "FROM assembly.scans"
            )
            row = cur.fetchone()
            sample_size = int(row["total"] or 0)
            ng_count = int(row["ng"] or 0)

        with get_conn("ml") as conn:
            c = conn.cursor()
            c.execute(
                """
                INSERT INTO ml.training_log
                  (trigger, sample_size, ng_count, old_auc, new_auc, accepted, note)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (trigger, sample_size, ng_count, old_auc, new_auc, accepted,
                 f"clusters={n_clusters}"),
            )
            c.close()
    except Exception as e:
        logger.error("[ML-Trigger] training_log insert error: %s", e)

    # 5. Broadcast via WebSocket
    try:
        msg = {
            "type": "ml_updated",
            "trigger": trigger,
            "accepted": accepted,
            "new_auc": round(new_auc, 4) if new_auc else None,
            "old_auc": round(old_auc, 4) if old_auc else None,
            "n_clusters": n_clusters,
            "trained_at": datetime.utcnow().isoformat(),
        }
        # Run broadcast in a new event loop since we're in a thread
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.run_coroutine_threadsafe(ws_manager.broadcast(msg), loop)
            else:
                loop.run_until_complete(ws_manager.broadcast(msg))
        except RuntimeError:
            # No event loop in this thread — create one
            new_loop = asyncio.new_event_loop()
            new_loop.run_until_complete(ws_manager.broadcast(msg))
            new_loop.close()
    except Exception as e:
        logger.warning("[ML-Trigger] WS broadcast error: %s", e)

    elapsed = time.time() - t0
    logger.info(
        "[ML-Trigger] ── Cycle complete (%.1fs) accepted=%s auc=%.4f ──",
        elapsed, accepted, new_auc,
    )
