import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
CREATE TABLE IF NOT EXISTS yaw_logs (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    claimed_at timestamptz,
    processed_at timestamptz
);
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- 并网窗口：同一时刻至多一个 open
CREATE TABLE IF NOT EXISTS grid_windows (
    id serial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'open',
    opened_by text NOT NULL,
    opened_at timestamptz NOT NULL,
    closed_by text,
    closed_at timestamptz,
    CHECK (status IN ('open', 'closed'))
);

-- 留影头：一份留影对应一个并网窗口
CREATE TABLE IF NOT EXISTS yaw_snapshots (
    id serial PRIMARY KEY,
    window_id integer NOT NULL REFERENCES grid_windows(id),
    window_name text NOT NULL,
    snapshotted_by text NOT NULL,
    snapshotted_at timestamptz NOT NULL,
    item_count integer NOT NULL
);

-- 留影明细：编号/机组/偏航/当时状态全部为值拷贝，且不对在线单据设外键，
-- 在线单据后续办结或改状态一律不得回写本表，保证新旧分叉可辨。
CREATE TABLE IF NOT EXISTS yaw_snapshot_items (
    id serial PRIMARY KEY,
    snapshot_id integer NOT NULL REFERENCES yaw_snapshots(id) ON DELETE CASCADE,
    line_no integer NOT NULL,
    log_id integer NOT NULL,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    log_status text NOT NULL,
    log_created_by text NOT NULL,
    log_created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshot_items_snapshot
    ON yaw_snapshot_items(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_window
    ON yaw_snapshots(window_id);
"""
