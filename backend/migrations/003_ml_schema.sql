-- Migration 003: ML schema for NG prediction and clustering
-- Run once against the PostgreSQL database

CREATE SCHEMA IF NOT EXISTS ml;

CREATE TABLE IF NOT EXISTS ml.embedding_cache (
    ref        TEXT PRIMARY KEY,
    source     TEXT NOT NULL,
    embedding  BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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
);

CREATE TABLE IF NOT EXISTS ml.predictions (
    us_sn        TEXT PRIMARY KEY,
    risk_score   FLOAT NOT NULL,
    risk_level   TEXT NOT NULL,
    predicted_at TIMESTAMPTZ DEFAULT NOW(),
    model_ver    TEXT
);

CREATE TABLE IF NOT EXISTS ml.ng_clusters (
    id              SERIAL PRIMARY KEY,
    cluster_id      INTEGER NOT NULL,
    count           INTEGER NOT NULL,
    representative  TEXT NOT NULL,
    samples         TEXT[],
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_predictions_us_sn ON ml.predictions(us_sn);
CREATE INDEX IF NOT EXISTS idx_ml_ng_clusters_cluster_id ON ml.ng_clusters(cluster_id);
CREATE INDEX IF NOT EXISTS idx_ml_training_log_trained_at ON ml.training_log(trained_at DESC);
