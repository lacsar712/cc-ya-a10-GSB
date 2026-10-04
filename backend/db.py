import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


# 单据在途状态：pending=待办、processing=在办（worker 已认领尚未办结）、done=已办结。
IN_FLIGHT_STATUSES = ("pending", "processing")


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
    processed_at timestamptz,
    claimed_at timestamptz
);

ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- 并网窗口：同一时间只允许一个开启中的窗口（部分唯一索引）。
CREATE TABLE IF NOT EXISTS grid_windows (
    id serial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'open',
    opened_by text NOT NULL,
    opened_at timestamptz NOT NULL,
    closed_by text,
    closed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS grid_windows_only_one_open
    ON grid_windows ((1)) WHERE status = 'open';

-- 留影头：一份留影属于某个并网窗口。
CREATE TABLE IF NOT EXISTS yaw_snapshots (
    id serial PRIMARY KEY,
    window_id integer NOT NULL REFERENCES grid_windows(id),
    window_name text NOT NULL,
    item_count integer NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL
);

-- 留影明细：所有字段均为留影当刻的复制值，此后在线单据如何变化都不回写本表。
CREATE TABLE IF NOT EXISTS yaw_snapshot_items (
    id serial PRIMARY KEY,
    snapshot_id integer NOT NULL
        REFERENCES yaw_snapshots(id) ON DELETE CASCADE,
    log_id integer NOT NULL REFERENCES yaw_logs(id),
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    status_frozen text NOT NULL,
    created_by text NOT NULL,
    log_created_at timestamptz NOT NULL,
    snapshotted_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshot_items_snapshot
    ON yaw_snapshot_items (snapshot_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_snapshot_item_log
    ON yaw_snapshot_items (snapshot_id, log_id);
"""
