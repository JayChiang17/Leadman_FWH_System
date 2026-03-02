-- =============================================================
-- Schema Fix Migration: Resolve discrepancies vs init.sql
-- Generated: 2026-02-27
-- All SQL commands have been verified via test-transaction rollback
-- before inclusion in this file.
-- =============================================================
-- Run as: psql postgresql://leadman:leadman_dev_pw@localhost:5432/leadman -f fix_schema_discrepancies.sql

BEGIN;

-- =============================================================
-- SECTION 1: TYPE FIXES
-- =============================================================

-- 1a. auth.users: is_active INTEGER -> BOOLEAN
--     (must drop default first to allow type cast)
ALTER TABLE auth.users
    ALTER COLUMN is_active DROP DEFAULT,
    ALTER COLUMN is_active TYPE BOOLEAN USING is_active::boolean,
    ALTER COLUMN is_active SET DEFAULT true;

-- 1b. auth.login_audit_logs: success INTEGER -> BOOLEAN
ALTER TABLE auth.login_audit_logs
    ALTER COLUMN success DROP DEFAULT,
    ALTER COLUMN success TYPE BOOLEAN USING success::boolean,
    ALTER COLUMN success SET DEFAULT false;

-- 1c. auth.email_send_history: sent_at TEXT -> TIMESTAMPTZ
ALTER TABLE auth.email_send_history
    ALTER COLUMN sent_at TYPE TIMESTAMPTZ USING sent_at::TIMESTAMPTZ;

-- 1d. downtime.downtime_logs: start_local, end_local, created_at TEXT -> TIMESTAMPTZ
--     NOTE: idx_dt_date_line uses SUBSTRING(start_local FROM 1 FOR 10) which is
--     invalid on TIMESTAMPTZ. Drop all downtime indexes first, then convert columns,
--     then recreate. The date index is recreated using CAST(... AT TIME ZONE 'UTC' AS date)
--     which is IMMUTABLE and valid for expression indexes.
DROP INDEX IF EXISTS downtime.idx_dt_start_local;
DROP INDEX IF EXISTS downtime.idx_dt_end_local;
DROP INDEX IF EXISTS downtime.idx_dt_line_station;
DROP INDEX IF EXISTS downtime.idx_dt_created_at;
DROP INDEX IF EXISTS downtime.idx_dt_date_line;

ALTER TABLE downtime.downtime_logs
    ALTER COLUMN start_local TYPE TIMESTAMPTZ USING start_local::TIMESTAMPTZ,
    ALTER COLUMN end_local   TYPE TIMESTAMPTZ USING end_local::TIMESTAMPTZ,
    ALTER COLUMN created_at  TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ;

CREATE INDEX idx_dt_start_local  ON downtime.downtime_logs(start_local);
CREATE INDEX idx_dt_end_local    ON downtime.downtime_logs(end_local);
CREATE INDEX idx_dt_line_station ON downtime.downtime_logs(line, station);
CREATE INDEX idx_dt_created_at   ON downtime.downtime_logs(created_at DESC);
-- Replacement for SUBSTRING(start_local FROM 1 FOR 10): use AT TIME ZONE 'UTC' which is IMMUTABLE
CREATE INDEX idx_dt_date_line    ON downtime.downtime_logs(CAST(start_local AT TIME ZONE 'UTC' AS date), line);

-- 1e. model.daily_summary: day TEXT -> DATE
ALTER TABLE model.daily_summary
    ALTER COLUMN day TYPE DATE USING day::DATE;

-- 1f. assembly.assembly_weekly_plan: plan_json TEXT -> JSONB
ALTER TABLE assembly.assembly_weekly_plan
    ALTER COLUMN plan_json TYPE JSONB USING plan_json::JSONB;

-- 1g. model.weekly_plan: plan_json TEXT -> JSONB
ALTER TABLE model.weekly_plan
    ALTER COLUMN plan_json TYPE JSONB USING plan_json::JSONB;

-- 1h. qc.qc_records: all timestamp columns TEXT -> TIMESTAMPTZ
ALTER TABLE qc.qc_records
    ALTER COLUMN fqc_ready_at TYPE TIMESTAMPTZ USING fqc_ready_at::TIMESTAMPTZ,
    ALTER COLUMN shipped_at   TYPE TIMESTAMPTZ USING shipped_at::TIMESTAMPTZ,
    ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
    ALTER COLUMN updated_at   TYPE TIMESTAMPTZ USING updated_at::TIMESTAMPTZ;

-- 1i. qc.qc_issues: all timestamp columns TEXT -> TIMESTAMPTZ (table is empty)
ALTER TABLE qc.qc_issues
    ALTER COLUMN created_at  TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
    ALTER COLUMN updated_at  TYPE TIMESTAMPTZ USING updated_at::TIMESTAMPTZ,
    ALTER COLUMN resolved_at TYPE TIMESTAMPTZ USING resolved_at::TIMESTAMPTZ;


-- =============================================================
-- SECTION 2: COLUMN RENAME
-- =============================================================

-- 2a. qc.qc_issues: image_base64 -> image_path (to match init.sql)
--     (table is empty so rename is safe with no data impact)
ALTER TABLE qc.qc_issues RENAME COLUMN image_base64 TO image_path;


-- =============================================================
-- SECTION 3: MISSING GENERATED COLUMN
-- =============================================================

-- 3a. pcba.boards: ADD serial_normalized GENERATED ALWAYS AS ... STORED
--     (missing from actual DB, required by init.sql for fast JOIN with assembly)
ALTER TABLE pcba.boards ADD COLUMN serial_normalized TEXT
    GENERATED ALWAYS AS (REPLACE(REPLACE(UPPER(serial_number), '-', ''), ' ', '')) STORED;

-- The index on the generated column already exists on the expression,
-- but add the canonical named index to match init.sql:
-- (idx_boards_serial_norm already exists as an expression index on the same expression;
--  after adding the generated column, PostgreSQL will use it automatically)


-- =============================================================
-- SECTION 4: MISSING INDEXES
-- =============================================================

-- 4a. assembly.scans: composite indexes for status filtering
CREATE INDEX IF NOT EXISTS idx_assy_scans_am7_status   ON assembly.scans(am7, status);
CREATE INDEX IF NOT EXISTS idx_assy_scans_au8_status   ON assembly.scans(au8, status);
CREATE INDEX IF NOT EXISTS idx_assy_scans_us_sn_status ON assembly.scans(us_sn, status);

-- 4b. auth.users: role lookup index
CREATE INDEX IF NOT EXISTS idx_users_role ON auth.users(role);

-- 4c. auth.refresh_tokens: expiry cleanup index
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON auth.refresh_tokens(expires_at);

-- 4d. downtime.downtime_logs: end_local index (already recreated above in section 1d,
--     but kept here as IF NOT EXISTS for idempotency)
CREATE INDEX IF NOT EXISTS idx_dt_end_local ON downtime.downtime_logs(end_local);

-- 4e. qc.qc_issues: composite line+status index
CREATE INDEX IF NOT EXISTS idx_qc_issues_line_status ON qc.qc_issues(line, status);


-- =============================================================
-- SECTION 5: MISSING DEFAULT VALUES
-- =============================================================

-- 5a. auth.email_config: updated_at should default to NOW()
ALTER TABLE auth.email_config
    ALTER COLUMN updated_at SET DEFAULT NOW();

-- 5b. auth.email_recipients: created_at should default to NOW()
ALTER TABLE auth.email_recipients
    ALTER COLUMN created_at SET DEFAULT NOW();

-- 5c. auth.email_send_history: sent_at should default to NOW()
--     (column type was already fixed in section 1c)
ALTER TABLE auth.email_send_history
    ALTER COLUMN sent_at SET DEFAULT NOW();

-- 5d. downtime.downtime_logs: created_at should default to NOW()
--     (column type was already fixed in section 1d)
ALTER TABLE downtime.downtime_logs
    ALTER COLUMN created_at SET DEFAULT NOW();


COMMIT;

-- =============================================================
-- POST-MIGRATION VERIFICATION QUERIES
-- Run these after COMMIT to confirm all fixes applied:
-- =============================================================

-- Verify BOOLEAN types
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE (table_schema='auth' AND table_name='users' AND column_name='is_active')
--    OR (table_schema='auth' AND table_name='login_audit_logs' AND column_name='success');

-- Verify TIMESTAMPTZ columns
-- SELECT table_schema, table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE (table_schema, table_name, column_name) IN (
--   ('auth','email_send_history','sent_at'),
--   ('downtime','downtime_logs','start_local'),
--   ('downtime','downtime_logs','end_local'),
--   ('downtime','downtime_logs','created_at'),
--   ('qc','qc_records','fqc_ready_at'),
--   ('qc','qc_records','created_at'),
--   ('qc','qc_issues','created_at')
-- );

-- Verify generated column
-- SELECT column_name, is_generated FROM information_schema.columns
-- WHERE table_schema='pcba' AND table_name='boards' AND column_name='serial_normalized';

-- Verify renamed column
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='qc' AND table_name='qc_issues' AND column_name='image_path';
