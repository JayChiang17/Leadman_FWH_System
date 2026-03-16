-- Migration 002: Add APower WIP stage tracking to assembly.scans
-- Idempotent (safe to run multiple times)

BEGIN;

-- 1. Add apower_stage column with valid-stage constraint
ALTER TABLE assembly.scans
  ADD COLUMN IF NOT EXISTS apower_stage TEXT NOT NULL DEFAULT 'assembling';

-- Add constraint only if it doesn't exist yet (PG doesn't have IF NOT EXISTS for constraints)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_apower_stage'
      AND conrelid = 'assembly.scans'::regclass
  ) THEN
    ALTER TABLE assembly.scans
      ADD CONSTRAINT chk_apower_stage
        CHECK (apower_stage IN ('assembling','aging','fqc_passed','pending_shipment'));
  END IF;
END $$;

-- 2. Stage tracking metadata
ALTER TABLE assembly.scans
  ADD COLUMN IF NOT EXISTS stage_updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS stage_updated_by TEXT DEFAULT '';

-- 3. Index for fast stage-filtered queries
CREATE INDEX IF NOT EXISTS idx_assy_scans_apower_stage
  ON assembly.scans(apower_stage);

-- 4. Stage history table
CREATE TABLE IF NOT EXISTS assembly.stage_history (
  id          SERIAL PRIMARY KEY,
  scan_id     INTEGER NOT NULL REFERENCES assembly.scans(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT NOT NULL,
  changed_by  TEXT NOT NULL DEFAULT '',
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes       TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_stage_history_scan_id
  ON assembly.stage_history(scan_id);

-- 5. Battery inventory adjustment table (in model schema)
CREATE TABLE IF NOT EXISTS model.battery_inventory_adj (
  id         SERIAL PRIMARY KEY,
  kind       TEXT NOT NULL CHECK(kind IN ('A','B')),
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  operator   TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMIT;
