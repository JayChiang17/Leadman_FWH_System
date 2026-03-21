-- =============================================================
-- Leadman FWH System — PostgreSQL initialization
-- Creates 8 schemas mirroring the 8 former SQLite databases.
-- Executed automatically on first start via docker-entrypoint-initdb.d
-- =============================================================

-- Install pg_trgm in public so gin_trgm_ops is always reachable
-- regardless of which schema's search_path is active.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

-- -----------------------------------------
-- Schema: pcba (was pcba.db)
-- -----------------------------------------
CREATE SCHEMA IF NOT EXISTS pcba;

CREATE TABLE IF NOT EXISTS pcba.boards (
    id            TEXT PRIMARY KEY,
    serial_number TEXT UNIQUE NOT NULL,
    batch_number  TEXT NOT NULL,
    model         TEXT NOT NULL CHECK(UPPER(model) IN ('AM7','AU8')),
    stage         TEXT NOT NULL CHECK(stage IN ('aging','coating','completed')),
    start_time    TIMESTAMPTZ NOT NULL,
    last_update   TIMESTAMPTZ NOT NULL,
    operator      TEXT NOT NULL,
    slip_number   TEXT,
    ng_flag       INTEGER NOT NULL DEFAULT 0,
    ng_reason     TEXT,
    ng_time       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    serial_normalized TEXT GENERATED ALWAYS AS (
        REPLACE(REPLACE(UPPER(serial_number), '-', ''), ' ', '')
    ) STORED
);

CREATE INDEX IF NOT EXISTS idx_boards_serial      ON pcba.boards(serial_number);
CREATE INDEX IF NOT EXISTS idx_boards_stage        ON pcba.boards(stage);
CREATE INDEX IF NOT EXISTS idx_boards_batch        ON pcba.boards(batch_number);
CREATE INDEX IF NOT EXISTS idx_boards_model        ON pcba.boards(model);
CREATE INDEX IF NOT EXISTS idx_boards_slip         ON pcba.boards(slip_number);
CREATE INDEX IF NOT EXISTS idx_boards_last_update  ON pcba.boards(last_update DESC);
CREATE INDEX IF NOT EXISTS idx_boards_serial_norm  ON pcba.boards(serial_normalized);
CREATE INDEX IF NOT EXISTS idx_boards_stage_ng_slip ON pcba.boards(stage, ng_flag, slip_number);
CREATE INDEX IF NOT EXISTS idx_boards_ng_flag      ON pcba.boards(ng_flag);

CREATE TABLE IF NOT EXISTS pcba.board_history (
    id        SERIAL PRIMARY KEY,
    board_id  TEXT NOT NULL REFERENCES pcba.boards(id) ON DELETE CASCADE,
    stage     TEXT NOT NULL CHECK(stage IN ('aging','coating','completed')),
    occurred_at TIMESTAMPTZ NOT NULL,
    operator  TEXT NOT NULL,
    notes     TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_board       ON pcba.board_history(board_id);
CREATE INDEX IF NOT EXISTS idx_history_occurred     ON pcba.board_history(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_occurred_board ON pcba.board_history(occurred_at DESC, board_id);

CREATE TABLE IF NOT EXISTS pcba.slips (
    slip_number  TEXT PRIMARY KEY,
    target_pairs INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- -----------------------------------------
-- Schema: assembly (was assembly.db)
-- -----------------------------------------
CREATE SCHEMA IF NOT EXISTS assembly;

CREATE TABLE IF NOT EXISTS assembly.scans (
    id                 SERIAL PRIMARY KEY,
    scanned_at         TIMESTAMPTZ,
    cn_sn              TEXT UNIQUE,
    us_sn              TEXT UNIQUE,
    mod_a              TEXT UNIQUE,
    mod_b              TEXT UNIQUE,
    au8                TEXT UNIQUE,
    am7                TEXT UNIQUE,
    product_line       TEXT,
    status             TEXT DEFAULT '' CHECK (UPPER(status) IN ('', 'OK', 'NG', 'FIXED')),
    ng_reason          TEXT DEFAULT '',
    start_time         TIMESTAMPTZ,
    production_seconds INTEGER,
    apower_stage       TEXT NOT NULL DEFAULT 'assembling' CHECK (apower_stage IN ('assembling','aging','fqc_passed','pending_shipment')),
    stage_updated_at   TIMESTAMPTZ DEFAULT NOW(),
    stage_updated_by   TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_assy_scans_scanned_at     ON assembly.scans(scanned_at);
CREATE INDEX IF NOT EXISTS idx_assy_scans_us_sn          ON assembly.scans(us_sn);
CREATE INDEX IF NOT EXISTS idx_assy_scans_am7            ON assembly.scans(am7);
CREATE INDEX IF NOT EXISTS idx_assy_scans_au8            ON assembly.scans(au8);
CREATE INDEX IF NOT EXISTS idx_assy_scans_status         ON assembly.scans(status);
CREATE INDEX IF NOT EXISTS idx_assy_scans_product_line   ON assembly.scans(product_line);
CREATE INDEX IF NOT EXISTS idx_assy_scans_start_time     ON assembly.scans(start_time);
CREATE INDEX IF NOT EXISTS idx_assy_scans_scanned_status ON assembly.scans(scanned_at, status);
CREATE INDEX IF NOT EXISTS idx_assy_scans_am7_status     ON assembly.scans(am7, status);
CREATE INDEX IF NOT EXISTS idx_assy_scans_au8_status     ON assembly.scans(au8, status);
CREATE INDEX IF NOT EXISTS idx_assy_scans_us_sn_status   ON assembly.scans(us_sn, status);
CREATE INDEX IF NOT EXISTS idx_assy_scans_apower_stage   ON assembly.scans(apower_stage);

CREATE TABLE IF NOT EXISTS assembly.stage_history (
    id          SERIAL PRIMARY KEY,
    scan_id     INTEGER NOT NULL REFERENCES assembly.scans(id) ON DELETE CASCADE,
    from_stage  TEXT,
    to_stage    TEXT NOT NULL,
    changed_by  TEXT NOT NULL DEFAULT '',
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes       TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_stage_history_scan_id ON assembly.stage_history(scan_id);

CREATE TABLE IF NOT EXISTS assembly.daily_summary (
    day   DATE PRIMARY KEY,
    total INTEGER DEFAULT 0,
    ng    INTEGER DEFAULT 0,
    fixed INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assembly.assembly_weekly_plan (
    week_start TEXT PRIMARY KEY,
    plan_json  JSONB
);


-- -----------------------------------------
-- Schema: model (was model.db)
-- -----------------------------------------
CREATE SCHEMA IF NOT EXISTS model;

CREATE TABLE IF NOT EXISTS model.scans (
    id         SERIAL PRIMARY KEY,
    sn         TEXT,
    kind       TEXT CHECK (kind IN ('A', 'B')),
    scanned_at TIMESTAMPTZ,
    status     TEXT DEFAULT '',
    ng_reason  TEXT
);

CREATE INDEX IF NOT EXISTS idx_model_scans_scanned_at ON model.scans(scanned_at);
CREATE INDEX IF NOT EXISTS idx_model_scans_sn         ON model.scans(sn);
CREATE INDEX IF NOT EXISTS idx_model_scans_kind        ON model.scans(kind);

CREATE TABLE IF NOT EXISTS model.daily_summary (
    day     DATE PRIMARY KEY,
    count_a INTEGER DEFAULT 0,
    count_b INTEGER DEFAULT 0,
    total   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS model.weekly_plan (
    week_start TEXT PRIMARY KEY,
    plan_json  JSONB
);

CREATE TABLE IF NOT EXISTS model.battery_inventory_adj (
    id         SERIAL PRIMARY KEY,
    kind       TEXT NOT NULL CHECK(kind IN ('A','B')),
    delta      INTEGER NOT NULL,
    reason     TEXT NOT NULL DEFAULT '',
    operator   TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- -----------------------------------------
-- Schema: auth (was login.db)
-- -----------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id              SERIAL PRIMARY KEY,
    username        TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'viewer',
    full_name       TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON auth.users(role);

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token      TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON auth.refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS auth.login_audit_logs (
    id             SERIAL PRIMARY KEY,
    username       TEXT NOT NULL REFERENCES auth.users(username) ON DELETE CASCADE,
    ip_address     TEXT,
    user_agent     TEXT,
    success        BOOLEAN NOT NULL DEFAULT false,
    failure_reason TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_audit_username ON auth.login_audit_logs(username);
CREATE INDEX IF NOT EXISTS idx_login_audit_created  ON auth.login_audit_logs(created_at);

-- Email tables (also in auth schema, was part of login.db)
CREATE TABLE IF NOT EXISTS auth.email_config (
    id         SERIAL PRIMARY KEY,
    send_time  TEXT NOT NULL DEFAULT '18:00',
    enabled    BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth.email_recipients (
    id           SERIAL PRIMARY KEY,
    email        TEXT NOT NULL UNIQUE,
    display_name TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth.email_send_history (
    id            SERIAL PRIMARY KEY,
    sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recipients    TEXT NOT NULL,
    status        TEXT NOT NULL,
    error_message TEXT,
    triggered_by  TEXT NOT NULL
);


-- -----------------------------------------
-- Schema: downtime (was downtime.db)
-- -----------------------------------------
CREATE SCHEMA IF NOT EXISTS downtime;

CREATE TABLE IF NOT EXISTS downtime.downtime_logs (
    id            SERIAL PRIMARY KEY,
    line          TEXT NOT NULL,
    station       TEXT NOT NULL,
    start_local   TIMESTAMPTZ NOT NULL,
    end_local     TIMESTAMPTZ NOT NULL,
    duration_min  REAL NOT NULL CHECK (duration_min > 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    TEXT,
    modified_by   TEXT,
    downtime_type TEXT DEFAULT 'Other',
    reason        TEXT
);

CREATE INDEX IF NOT EXISTS idx_dt_start_local  ON downtime.downtime_logs(start_local);
CREATE INDEX IF NOT EXISTS idx_dt_end_local    ON downtime.downtime_logs(end_local);
CREATE INDEX IF NOT EXISTS idx_dt_line_station ON downtime.downtime_logs(line, station);
CREATE INDEX IF NOT EXISTS idx_dt_created_at   ON downtime.downtime_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dt_date_line    ON downtime.downtime_logs(CAST(start_local AS DATE), line);


-- -----------------------------------------
-- Schema: documents (was documents.db)
-- -----------------------------------------
CREATE SCHEMA IF NOT EXISTS documents;

CREATE TABLE IF NOT EXISTS documents.documents (
    id              SERIAL PRIMARY KEY,
    filename        TEXT NOT NULL,
    original_name   TEXT NOT NULL,
    category        TEXT NOT NULL,
    file_type       TEXT NOT NULL,
    file_size       INTEGER,
    file_hash       TEXT UNIQUE,
    content_preview TEXT,
    upload_date     TIMESTAMPTZ DEFAULT NOW(),
    uploaded_by     TEXT,
    status          TEXT DEFAULT 'active' CHECK (status IN ('active','archived','deleted')),
    tags            TEXT,
    description     TEXT
);

CREATE INDEX IF NOT EXISTS idx_docs_status_cat ON documents.documents(status, category);
CREATE INDEX IF NOT EXISTS idx_docs_hash       ON documents.documents(file_hash);

-- GIN index for full-text search on documents metadata
CREATE INDEX IF NOT EXISTS idx_docs_fts ON documents.documents
    USING GIN(to_tsvector('simple', COALESCE(original_name,'') || ' ' || COALESCE(tags,'') || ' ' || COALESCE(description,'')));

CREATE TABLE IF NOT EXISTS documents.document_chunks (
    id            SERIAL PRIMARY KEY,
    document_id   INTEGER NOT NULL REFERENCES documents.documents(id) ON DELETE CASCADE,
    chunk_index   INTEGER,
    content       TEXT,
    chunk_size    INTEGER,
    search_vector TSVECTOR,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON documents.document_chunks(document_id);
-- GIN index for full-text search on chunk content
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON documents.document_chunks USING GIN(search_vector);

-- Auto-update tsvector on INSERT/UPDATE
CREATE OR REPLACE FUNCTION documents.update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('simple', COALESCE(NEW.content, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_search_vector ON documents.document_chunks;
CREATE TRIGGER trg_update_search_vector
    BEFORE INSERT OR UPDATE OF content ON documents.document_chunks
    FOR EACH ROW
    EXECUTE FUNCTION documents.update_search_vector();


-- -----------------------------------------
-- Schema: monitor (was monitor.db)
-- -----------------------------------------
CREATE SCHEMA IF NOT EXISTS monitor;

CREATE TABLE IF NOT EXISTS monitor.api_logs (
    id          SERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    method      TEXT NOT NULL,
    path        TEXT NOT NULL,
    status_code INTEGER,
    duration_ms REAL,
    username    TEXT,
    ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_logs_occurred    ON monitor.api_logs(occurred_at);
CREATE INDEX IF NOT EXISTS idx_api_logs_path        ON monitor.api_logs(path);
CREATE INDEX IF NOT EXISTS idx_api_logs_status      ON monitor.api_logs(status_code);
CREATE INDEX IF NOT EXISTS idx_api_logs_username    ON monitor.api_logs(username);
CREATE INDEX IF NOT EXISTS idx_api_logs_occurred_status ON monitor.api_logs(occurred_at, status_code);
CREATE INDEX IF NOT EXISTS idx_api_logs_occurred_dur   ON monitor.api_logs(occurred_at, duration_ms);

CREATE TABLE IF NOT EXISTS monitor.audit_logs (
    id          SERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    username    TEXT NOT NULL,
    action      TEXT NOT NULL,
    target      TEXT,
    old_value   TEXT,
    new_value   TEXT,
    ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred  ON monitor.audit_logs(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_username  ON monitor.audit_logs(username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action    ON monitor.audit_logs(action);

CREATE TABLE IF NOT EXISTS monitor.frontend_errors (
    id            SERIAL PRIMARY KEY,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    component     TEXT,
    error_message TEXT,
    stack         TEXT,
    username      TEXT,
    url           TEXT
);

CREATE INDEX IF NOT EXISTS idx_fe_errors_occurred ON monitor.frontend_errors(occurred_at);


-- -----------------------------------------
-- Schema: qc (was qc_v2.db)
-- -----------------------------------------
CREATE SCHEMA IF NOT EXISTS qc;

CREATE TABLE IF NOT EXISTS qc.qc_issues (
    id           SERIAL PRIMARY KEY,
    line         TEXT NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    category     TEXT,
    severity     TEXT DEFAULT 'minor' CHECK (severity IN ('minor','major','critical')),
    status       TEXT DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
    image_path   TEXT,
    created_by   TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    resolved_by  TEXT,
    resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_qc_issues_line      ON qc.qc_issues(line);
CREATE INDEX IF NOT EXISTS idx_qc_issues_status    ON qc.qc_issues(status);
CREATE INDEX IF NOT EXISTS idx_qc_issues_created   ON qc.qc_issues(created_at);
CREATE INDEX IF NOT EXISTS idx_qc_issues_category  ON qc.qc_issues(category);
CREATE INDEX IF NOT EXISTS idx_qc_issues_line_status ON qc.qc_issues(line, status);

CREATE TABLE IF NOT EXISTS qc.qc_records (
    id           SERIAL PRIMARY KEY,
    sn           TEXT NOT NULL,
    fqc_ready_at TIMESTAMPTZ,
    shipped_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qc_records_sn       ON qc.qc_records(sn);
CREATE INDEX IF NOT EXISTS idx_qc_records_fqc      ON qc.qc_records(fqc_ready_at);


-- -----------------------------------------
-- Schema: ml (NG prediction and clustering)
-- -----------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_ml_predictions_us_sn        ON ml.predictions(us_sn);
CREATE INDEX IF NOT EXISTS idx_ml_ng_clusters_cluster_id   ON ml.ng_clusters(cluster_id);
CREATE INDEX IF NOT EXISTS idx_ml_training_log_trained_at  ON ml.training_log(trained_at DESC);


-- -----------------------------------------
-- Default admin user (password: 0000)
-- -----------------------------------------
INSERT INTO auth.users (username, hashed_password, role, full_name, is_active)
VALUES ('admin', '$2b$12$V0srB2h3ST8xGLWVGmQdyOQPtJKFXZXgOsuw5Oxw4OH4FrD5wiq1q', 'admin', 'Administrator', true)
ON CONFLICT (username) DO NOTHING;
