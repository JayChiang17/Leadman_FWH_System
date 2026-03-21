# backend/ml/ng_model.py
"""
XGBoost-based NG risk prediction for APower assemblies.

Features (15):
  - hour_sin, hour_cos              (時間循環編碼，避免 23→0 的斷層)
  - day_of_week                     (星期幾)
  - am7_batch_ng_rate               (AM7 批次歷史 NG 率)
  - au8_batch_ng_rate               (AU8 批次歷史 NG 率)
  - am7_board_ng, au8_board_ng      (PCBA 本身 ng_flag)
  - am7_board_age_days              (AM7 板從建立到組裝經過天數)
  - au8_board_age_days              (AU8 板從建立到組裝經過天數)
  - product_line_freq               (product line 頻率編碼)
  - product_line_ng_rate            (product line leave-one-out NG 率)
  - production_seconds              (資料庫欄位，作業時長)
  - assembly_duration_sec           (scanned_at - start_time，組裝花了多久)
  - daily_seq                       (今天第幾顆)
  - daily_ng_count_before           (今天在這顆之前累積了幾顆 NG，製程異常信號)
"""

import logging
import math
import os
import pickle
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

from core.pg import get_conn, get_cursor

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "ng_predictor.pkl"
MODEL_DIR.mkdir(exist_ok=True)

# Bayesian smoothing strength for NG-rate features.
# Equivalent to adding _SMOOTH_K "virtual" samples at the global NG rate.
# Prevents tiny product-lines / batches (all-NG or all-OK) from dominating.
_SMOOTH_K = 50.0

FEATURES = [
    "hour_sin",
    "hour_cos",
    "day_of_week",
    "am7_batch_ng_rate",
    "au8_batch_ng_rate",
    "am7_board_ng",
    "au8_board_ng",
    "am7_board_age_days",
    "au8_board_age_days",
    "product_line_freq",
    "product_line_ng_rate",
    "production_seconds",
    "assembly_duration_sec",
    "daily_seq",
    "daily_ng_count_before",
]

_current_model = None
_model_ver: Optional[str] = None


class _IsoCalibratedClassifier:
    """XGBoost + IsotonicRegression wrapper.

    Replaces CalibratedClassifierCV(cv='prefit') which has broken behaviour
    in some sklearn versions. Fully picklable (defined at module level).
    """
    __slots__ = ("_base", "_iso")

    def __init__(self, base, iso):
        self._base = base
        self._iso = iso

    def predict_proba(self, X):
        raw = self._base.predict_proba(X)[:, 1]
        cal = self._iso.predict(raw)
        return np.column_stack([1.0 - cal, cal])

    @property
    def feature_importances_(self):
        return self._base.feature_importances_

    def shap_explainer(self):
        """Return a TreeExplainer backed by the raw XGBoost model."""
        import shap
        return shap.TreeExplainer(self._base)


# ── Model I/O ─────────────────────────────────────────────────────────────────

def _load_model():
    global _current_model, _model_ver
    if MODEL_PATH.exists():
        try:
            with open(MODEL_PATH, "rb") as f:
                payload = pickle.load(f)
            _current_model = payload["model"]
            _model_ver = payload.get("version", "unknown")
            logger.info("[ML] Loaded model ver=%s", _model_ver)
        except Exception as e:
            logger.warning("[ML] Model load failed: %s", e)
            _current_model = None
            _model_ver = None


def _save_model(model, version: str):
    """Atomic replace: write to tmp then rename."""
    tmp = tempfile.NamedTemporaryFile(
        delete=False, dir=MODEL_DIR, suffix=".pkl.tmp"
    )
    try:
        pickle.dump({"model": model, "version": version}, tmp)
        tmp.flush()
        tmp.close()
        os.replace(tmp.name, MODEL_PATH)
        logger.info("[ML] Model saved ver=%s", version)
    except Exception:
        tmp.close()
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        raise


# ── Shared feature helpers ────────────────────────────────────────────────────

def _to_dt(v):
    """Convert DB value (datetime or str) to aware datetime."""
    if v is None:
        return None
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except Exception:
            return None
    if hasattr(v, "tzinfo"):
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v
    return None


def _board_age(created_at, scanned_at) -> float:
    """Days from board creation to assembly scan. Returns 0 if unavailable."""
    ca = _to_dt(created_at)
    sa = _to_dt(scanned_at)
    if ca is None or sa is None:
        return 0.0
    diff = (sa - ca).total_seconds() / 86400
    return max(0.0, diff)


def _assy_duration(start_time, scanned_at) -> float:
    """Seconds from assembly start_time to scanned_at."""
    st = _to_dt(start_time)
    sc = _to_dt(scanned_at)
    if st is None or sc is None:
        return 0.0
    diff = (sc - st).total_seconds()
    return max(0.0, min(diff, 86400))  # cap at 24h to remove outliers


def _build_features(
    r,
    ts: Optional[datetime],
    batch_ng: Dict, batch_total: Dict,
    pl_ng: Dict, pl_total: Dict, pl_count: Dict, total_pl: int,
    daily_seq: int,
    daily_ng_before: int,
    global_ng_rate: float = 0.02,
) -> List[float]:
    hour = ts.hour if ts else 12
    dow  = ts.weekday() if ts else 0

    am7b = r.get("am7_batch") or ""
    au8b = r.get("au8_batch") or ""
    # Bayesian-smoothed batch NG rates: shrink small batches toward global prior
    am7_ng_rate = (batch_ng.get(am7b, 0) + _SMOOTH_K * global_ng_rate) / (batch_total.get(am7b, 0) + _SMOOTH_K)
    au8_ng_rate = (batch_ng.get(au8b, 0) + _SMOOTH_K * global_ng_rate) / (batch_total.get(au8b, 0) + _SMOOTH_K)

    pl = r.get("product_line") or "unknown"
    pl_f    = pl_count.get(pl, 0) / max(total_pl, 1)
    # Bayesian-smoothed product-line NG rate (pl_ng is already LOO-adjusted in training)
    pl_ng_r = (pl_ng.get(pl, 0) + _SMOOTH_K * global_ng_rate) / (pl_total.get(pl, 0) + _SMOOTH_K)

    am7_age = _board_age(r.get("am7_created_at"), r.get("scanned_at"))
    au8_age = _board_age(r.get("au8_created_at"), r.get("scanned_at"))
    assy_dur = _assy_duration(r.get("start_time"), r.get("scanned_at"))
    prod_sec = float(r.get("production_seconds") or 0)

    return [
        math.sin(2 * math.pi * hour / 24),   # hour_sin
        math.cos(2 * math.pi * hour / 24),   # hour_cos
        float(dow),
        am7_ng_rate,
        au8_ng_rate,
        float(r.get("am7_board_ng") or 0),
        float(r.get("au8_board_ng") or 0),
        am7_age,
        au8_age,
        pl_f,
        pl_ng_r,
        prod_sec,
        assy_dur,
        float(daily_seq),
        float(daily_ng_before),
    ]


# ── Training data fetch ───────────────────────────────────────────────────────

def _fetch_training_data() -> Tuple[np.ndarray, np.ndarray, List[str]]:
    logger.info("[ML] Fetching training data...")

    with get_cursor("assembly") as cur:
        cur.execute(
            """
            SELECT
              s.us_sn,
              s.scanned_at,
              s.start_time,
              s.am7,
              s.au8,
              s.product_line,
              COALESCE(s.production_seconds, 0) AS production_seconds,
              CASE WHEN UPPER(s.status) = 'NG' THEN 1 ELSE 0 END AS label,
              COALESCE(p1.ng_flag, 0)   AS am7_board_ng,
              COALESCE(p2.ng_flag, 0)   AS au8_board_ng,
              p1.batch_number           AS am7_batch,
              p2.batch_number           AS au8_batch,
              p1.created_at             AS am7_created_at,
              p2.created_at             AS au8_created_at
            FROM assembly.scans s
            LEFT JOIN pcba.boards p1
              ON p1.serial_normalized =
                 REPLACE(REPLACE(UPPER(COALESCE(s.am7,'')),'-',''),' ','')
            LEFT JOIN pcba.boards p2
              ON p2.serial_normalized =
                 REPLACE(REPLACE(UPPER(COALESCE(s.au8,'')),'-',''),' ','')
            WHERE s.us_sn IS NOT NULL
              AND s.scanned_at IS NOT NULL
            ORDER BY s.scanned_at
            """
        )
        rows = cur.fetchall()

    if not rows:
        raise ValueError("No training data available")

    n = len(rows)
    logger.info("[ML] Raw rows: %d", n)

    # ── Aggregate stats ───────────────────────────────────────
    batch_total: Dict[str, int] = {}
    batch_ng:    Dict[str, int] = {}
    pl_total:    Dict[str, int] = {}
    pl_ng:       Dict[str, int] = {}
    pl_count:    Dict[str, int] = {}

    for r in rows:
        label = int(r["label"])
        for b in (r["am7_batch"], r["au8_batch"]):
            if b:
                batch_total[b] = batch_total.get(b, 0) + 1
                batch_ng[b]    = batch_ng.get(b, 0) + label
        pl = r["product_line"] or "unknown"
        pl_total[pl] = pl_total.get(pl, 0) + 1
        pl_ng[pl]    = pl_ng.get(pl, 0) + label
        pl_count[pl] = pl_count.get(pl, 0) + 1

    total_pl = sum(pl_count.values()) or 1
    global_ng_rate = sum(pl_ng.values()) / max(sum(pl_total.values()), 1)

    # ── Build features (rows are time-sorted → safe for daily counters) ───
    daily_seq_map:  Dict[str, int] = {}
    daily_ng_map:   Dict[str, int] = {}

    X_rows: List[List[float]] = []
    y_rows: List[int] = []
    us_sns: List[str] = []

    for r in rows:
        ts = _to_dt(r["scanned_at"])
        date_str = ts.strftime("%Y-%m-%d") if ts else "unknown"

        seq        = daily_seq_map.get(date_str, 0)
        ng_before  = daily_ng_map.get(date_str, 0)
        label      = int(r["label"])

        # Leave-one-out for product line NG rate
        pl = r["product_line"] or "unknown"
        loo_pl_ng    = max(0, pl_ng.get(pl, 0) - label)
        loo_pl_total = max(0, pl_total.get(pl, 0) - 1)
        r_mod = dict(r)
        r_mod["product_line"] = pl  # ensure key exists

        # Temporarily override pl_ng/pl_total for LOO
        orig_ng    = pl_ng.get(pl, 0)
        orig_total = pl_total.get(pl, 0)
        pl_ng[pl]    = loo_pl_ng
        pl_total[pl] = loo_pl_total

        feat = _build_features(
            r_mod, ts,
            batch_ng, batch_total,
            pl_ng, pl_total, pl_count, total_pl,
            seq, ng_before,
            global_ng_rate,
        )

        # Restore
        pl_ng[pl]    = orig_ng
        pl_total[pl] = orig_total

        X_rows.append(feat)
        y_rows.append(label)
        us_sns.append(r["us_sn"])

        daily_seq_map[date_str] = seq + 1
        if label == 1:
            daily_ng_map[date_str] = ng_before + 1

    X = np.array(X_rows, dtype=np.float32)
    y = np.array(y_rows, dtype=np.int32)
    logger.info("[ML] Feature matrix: %s  NG rate=%.2f%%",
                X.shape, 100 * y.mean())
    return X, y, us_sns


# ── Train ─────────────────────────────────────────────────────────────────────

def _get_last_auc() -> Optional[float]:
    try:
        with get_cursor("ml") as cur:
            cur.execute(
                """
                SELECT new_auc FROM ml.training_log
                WHERE accepted = TRUE
                ORDER BY trained_at DESC LIMIT 1
                """
            )
            row = cur.fetchone()
            return float(row["new_auc"]) if row else None
    except Exception:
        return None


def fetch_and_train() -> Tuple[float, Optional[float], bool]:
    """Train XGBoost + Isotonic Calibration, returns (new_auc, old_auc, accepted)."""
    try:
        from xgboost import XGBClassifier
        from sklearn.isotonic import IsotonicRegression
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import roc_auc_score
    except ImportError as e:
        logger.error("[ML] Missing dependency: %s", e)
        return 0.0, None, False

    t0 = time.time()
    logger.info("[ML] ════ Starting training ════════════════════════════")

    X, y, _ = _fetch_training_data()
    ng_count = int(y.sum())
    logger.info("[ML] Features: %d  Samples: %d  NG: %d",
                X.shape[1], len(y), ng_count)

    if ng_count < 5:
        logger.warning("[ML] Too few NG samples (%d), skipping", ng_count)
        return 0.0, None, False

    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.2, random_state=42,
        stratify=y if ng_count >= 10 else None,
    )
    logger.info("[ML] Train/Val: %d / %d", len(X_train), len(X_val))

    neg = int((y_train == 0).sum())
    pos = int((y_train == 1).sum())
    spw = round(neg / max(pos, 1), 1)
    logger.info("[ML] scale_pos_weight = %s", spw)

    # ── Step 1: Train base XGBoost ────────────────────────────
    base = XGBClassifier(
        n_estimators=300,
        max_depth=5,
        learning_rate=0.03,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=3,
        scale_pos_weight=spw,
        eval_metric="auc",
        random_state=42,
        n_jobs=-1,
        verbosity=0,
    )

    logger.info("[ML] XGBoost training... (n_estimators=300)")
    base.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=50)

    # ── Step 2: Isotonic Calibration (sklearn-version-agnostic) ─────────────
    # Uses IsotonicRegression directly — avoids CalibratedClassifierCV(cv='prefit')
    # which has broken behaviour in some sklearn versions.
    raw_val_probs = base.predict_proba(X_val)[:, 1]
    iso = IsotonicRegression(out_of_bounds="clip")
    iso.fit(raw_val_probs, y_val)
    model = _IsoCalibratedClassifier(base, iso)
    logger.info("[ML] Isotonic calibration applied")

    y_prob = model.predict_proba(X_val)[:, 1]
    try:
        new_auc = float(roc_auc_score(y_val, y_prob))
    except Exception:
        new_auc = 0.5
    logger.info("[ML] New AUC (calibrated): %.4f", new_auc)

    # Log feature importances (from base XGBoost, unaffected by calibration)
    importances = base.feature_importances_
    fi = sorted(zip(FEATURES, importances), key=lambda x: -x[1])
    for fname, imp in fi[:8]:
        logger.info("[ML]   %-28s %.4f", fname, imp)

    old_auc = _get_last_auc()
    if old_auc is not None:
        logger.info("[ML] Old AUC: %.4f", old_auc)

    accepted = old_auc is None or new_auc >= old_auc - 0.01
    if accepted:
        version = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        _save_model(model, version)
        global _current_model, _model_ver
        _current_model = model
        _model_ver = version
        logger.info("[ML] ✅ Model accepted, saved ver=%s", version)
    else:
        logger.info("[ML] ⚠️  New model worse, keeping old")

    elapsed = time.time() - t0
    logger.info("[ML] ════ Done (%.1fs) ════════════════", elapsed)
    return new_auc, old_auc, accepted


# ── Predict assembling units ──────────────────────────────────────────────────

def predict_assembling() -> List[Dict]:
    global _current_model, _model_ver
    if _current_model is None:
        _load_model()
    if _current_model is None:
        logger.info("[ML] No model available")
        return []

    try:
        with get_cursor("assembly") as cur:
            cur.execute(
                """
                SELECT
                  s.us_sn,
                  s.scanned_at,
                  s.start_time,
                  s.am7,
                  s.au8,
                  s.product_line,
                  COALESCE(s.production_seconds, 0) AS production_seconds,
                  COALESCE(p1.ng_flag, 0)   AS am7_board_ng,
                  COALESCE(p2.ng_flag, 0)   AS au8_board_ng,
                  p1.batch_number           AS am7_batch,
                  p2.batch_number           AS au8_batch,
                  p1.created_at             AS am7_created_at,
                  p2.created_at             AS au8_created_at
                FROM assembly.scans s
                LEFT JOIN pcba.boards p1
                  ON p1.serial_normalized =
                     REPLACE(REPLACE(UPPER(COALESCE(s.am7,'')),'-',''),' ','')
                LEFT JOIN pcba.boards p2
                  ON p2.serial_normalized =
                     REPLACE(REPLACE(UPPER(COALESCE(s.au8,'')),'-',''),' ','')
                WHERE s.apower_stage = 'assembling'
                  AND s.us_sn IS NOT NULL
                ORDER BY s.scanned_at
                """
            )
            rows = cur.fetchall()
    except Exception as e:
        logger.error("[ML] Prediction fetch error: %s", e)
        return []

    if not rows:
        return []

    logger.info("[ML] Predicting %d assembling units...", len(rows))

    # ── Global stats for encoding ─────────────────────────────
    try:
        with get_cursor("assembly") as cur:
            # batch_ng_rate = assembly NG rate per batch (consistent with training)
            cur.execute(
                """
                SELECT batch_number,
                       SUM(total) AS total,
                       SUM(ng)    AS ng
                FROM (
                  SELECT p1.batch_number,
                         COUNT(*)  AS total,
                         SUM(CASE WHEN UPPER(s.status)='NG' THEN 1 ELSE 0 END) AS ng
                  FROM assembly.scans s
                  JOIN pcba.boards p1
                    ON p1.serial_normalized =
                       REPLACE(REPLACE(UPPER(COALESCE(s.am7,'')),'-',''),' ','')
                  WHERE p1.batch_number IS NOT NULL
                  GROUP BY p1.batch_number
                  UNION ALL
                  SELECT p2.batch_number,
                         COUNT(*),
                         SUM(CASE WHEN UPPER(s.status)='NG' THEN 1 ELSE 0 END)
                  FROM assembly.scans s
                  JOIN pcba.boards p2
                    ON p2.serial_normalized =
                       REPLACE(REPLACE(UPPER(COALESCE(s.au8,'')),'-',''),' ','')
                  WHERE p2.batch_number IS NOT NULL
                  GROUP BY p2.batch_number
                ) combined
                GROUP BY batch_number
                """
            )
            batch_rows = cur.fetchall()
            batch_total = {r["batch_number"]: int(r["total"]) for r in batch_rows}
            batch_ng    = {r["batch_number"]: int(r["ng"])    for r in batch_rows}

            cur.execute(
                """
                SELECT product_line,
                       COUNT(*) AS total,
                       SUM(CASE WHEN UPPER(status)='NG' THEN 1 ELSE 0 END) AS ng
                FROM assembly.scans
                WHERE product_line IS NOT NULL
                GROUP BY product_line
                """
            )
            pl_rows   = cur.fetchall()
            pl_total  = {r["product_line"]: int(r["total"]) for r in pl_rows}
            pl_ng     = {r["product_line"]: int(r["ng"])    for r in pl_rows}
            pl_count  = pl_total.copy()
            total_pl  = sum(pl_count.values()) or 1
    except Exception as e:
        logger.error("[ML] Stats fetch error: %s", e)
        batch_total = batch_ng = pl_total = pl_ng = pl_count = {}
        total_pl = 1

    global_ng_rate = sum(pl_ng.values()) / max(sum(pl_total.values()), 1)

    daily_seq_map: Dict[str, int] = {}
    daily_ng_map:  Dict[str, int] = {}
    X_rows = []
    us_sns = []

    for r in rows:
        ts = _to_dt(r["scanned_at"])
        date_str = ts.strftime("%Y-%m-%d") if ts else "unknown"
        seq       = daily_seq_map.get(date_str, 0)
        ng_before = daily_ng_map.get(date_str, 0)

        feat = _build_features(
            dict(r), ts,
            batch_ng, batch_total,
            pl_ng, pl_total, pl_count, total_pl,
            seq, ng_before,
            global_ng_rate,
        )
        X_rows.append(feat)
        us_sns.append(r["us_sn"])
        daily_seq_map[date_str] = seq + 1

    X = np.array(X_rows, dtype=np.float32)
    probs = _current_model.predict_proba(X)[:, 1]

    # ── SHAP values ───────────────────────────────────────────────────────────
    shap_matrix = None
    shap_base = 0.0
    try:
        explainer = _current_model.shap_explainer()
        sv = explainer.shap_values(X)
        # TreeExplainer on XGBoost binary returns shape (n, features)
        # or a list [neg, pos] depending on version — normalise to pos class
        if isinstance(sv, list):
            sv = sv[1]
        shap_matrix = sv                            # (n, 15) float64
        shap_base = float(explainer.expected_value)
        if isinstance(shap_base, (list, np.ndarray)):
            shap_base = float(shap_base[-1])        # take positive-class value
        logger.info("[ML] SHAP computed for %d units", len(us_sns))
    except Exception as e:
        logger.warning("[ML] SHAP skipped: %s", e)

    results = []
    for i, (us_sn, score) in enumerate(zip(us_sns, probs)):
        score = float(score)
        level = "high" if score > 0.4 else "medium" if score > 0.15 else "low"
        entry: Dict = {
            "us_sn":       us_sn,
            "risk_score":  round(score, 4),
            "risk_level":  level,
            "model_ver":   _model_ver or "unknown",
        }
        if shap_matrix is not None:
            entry["shap"] = {
                "base_value": round(shap_base, 6),
                "values": {
                    f: round(float(shap_matrix[i, j]), 6)
                    for j, f in enumerate(FEATURES)
                },
            }
        results.append(entry)

    logger.info("[ML] Prediction complete: %d units", len(results))
    return results


# ── Bulk UPSERT predictions ───────────────────────────────────────────────────

def upsert_predictions(predictions: List[Dict]):
    if not predictions:
        return
    import json as _json
    try:
        with get_conn("ml") as conn:
            cur = conn.cursor()
            for p in predictions:
                shap_json = _json.dumps(p["shap"]) if p.get("shap") else None
                cur.execute(
                    """
                    INSERT INTO ml.predictions
                      (us_sn, risk_score, risk_level, predicted_at, model_ver, shap_values)
                    VALUES (%s, %s, %s, NOW(), %s, %s::jsonb)
                    ON CONFLICT (us_sn) DO UPDATE
                      SET risk_score   = EXCLUDED.risk_score,
                          risk_level   = EXCLUDED.risk_level,
                          predicted_at = EXCLUDED.predicted_at,
                          model_ver    = EXCLUDED.model_ver,
                          shap_values  = EXCLUDED.shap_values
                    """,
                    (p["us_sn"], p["risk_score"], p["risk_level"],
                     p["model_ver"], shap_json),
                )
            cur.close()
        logger.info("[ML] UPSERT ml.predictions: %d rows", len(predictions))
    except Exception as e:
        logger.error("[ML] upsert_predictions error: %s", e)


# Load model on import
try:
    _load_model()
except Exception:
    pass
