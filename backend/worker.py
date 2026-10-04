"""后台 worker：用 SKIP LOCKED 认领 pending 记录。

认领时先置「在办」(processing) 并提交，使在途单据分为待办与在办两态、
可被并网窗口留影抄录；停留 WORKER_HOLD_SEC 后再写入判定结论办结。
worker 重启时把遗留的 processing 回收为待办；运行中超 HOLD 上限的在办
单也会被重新认领，避免单据永久卡在在办。
"""

import os
import time
from datetime import datetime, timedelta, timezone

import psycopg

from db import SCHEMA, connect
from rules import judge

POLL_SEC = float(os.environ.get("WORKER_POLL_SEC", "0.5"))
IDLE_SEC = float(os.environ.get("WORKER_IDLE_SEC", "1.0"))
# 在办停留时长：调大可让留影更容易抓到在办单。
HOLD_SEC = float(os.environ.get("WORKER_HOLD_SEC", "0.3"))
# 在办超过该秒数视为 worker 崩溃遗留，可被重新认领。
STALE_SEC = float(os.environ.get("WORKER_STALE_SEC", "300"))


def ensure_schema(conn):
    conn.execute(SCHEMA)
    conn.commit()


def recover_orphans(conn):
    """单机部署：启动时把上次未办结的在办单退回待办。"""
    conn.execute(
        """UPDATE yaw_logs
           SET status = 'pending', claimed_at = NULL
           WHERE status = 'processing'"""
    )
    conn.commit()


def claim(conn):
    """认领一笔：待办优先，其次回收超时在办。认领结果单独提交，
    使「在办」状态对外可见。"""
    stale_before = datetime.now(timezone.utc) - timedelta(seconds=STALE_SEC)
    now = datetime.now(timezone.utc)
    with conn.transaction():
        row = conn.execute(
            """UPDATE yaw_logs
               SET status = 'processing', claimed_at = %s
               WHERE id = (
                   SELECT id
                   FROM yaw_logs
                   WHERE status = 'pending'
                      OR (status = 'processing'
                          AND claimed_at IS NOT NULL
                          AND claimed_at < %s)
                   ORDER BY id
                   FOR UPDATE SKIP LOCKED
                   LIMIT 1
               )
               RETURNING id, turbine_code, yaw_err_deg""",
            (now, stale_before),
        ).fetchone()
    if row is not None:
        conn.commit()
    return row


def finish(conn, row):
    verdict, reason = judge(float(row["yaw_err_deg"]))
    now = datetime.now(timezone.utc)
    conn.execute(
        """UPDATE yaw_logs
           SET status = 'done', verdict = %s, reason = %s, processed_at = %s
           WHERE id = %s""",
        (verdict, reason, now, row["id"]),
    )
    conn.commit()


def main():
    print("yaw-align worker started", flush=True)
    with connect() as conn:
        ensure_schema(conn)
        recover_orphans(conn)
    while True:
        try:
            with connect() as conn:
                row = claim(conn)
                if row is None:
                    time.sleep(IDLE_SEC)
                    continue
                if HOLD_SEC > 0:
                    time.sleep(HOLD_SEC)
                finish(conn, row)
                time.sleep(POLL_SEC)
        except psycopg.Error as exc:
            print(f"worker db error: {exc}", flush=True)
            time.sleep(IDLE_SEC)


if __name__ == "__main__":
    main()
