"""后台 worker：用 SKIP LOCKED 认领 pending 记录并写入判定结论。

单据生命周期为两段：
  pending（待办）→ processing（在办，已被 worker 认领）→ done（办结）。
认领后先置 processing 并提交，停留 WORKER_PROCESS_SEC 秒模拟现场对中作业，
再判定写入结论。留影正是抄录 pending 与 processing 两类在途单据。
"""

import os
import time
from datetime import datetime, timedelta, timezone

import psycopg

from db import SCHEMA, connect
from rules import judge

POLL_SEC = float(os.environ.get("WORKER_POLL_SEC", "0.5"))
IDLE_SEC = float(os.environ.get("WORKER_IDLE_SEC", "1.0"))
# 在办停留时长，便于在途留影时观察到真实的 processing 单据
PROCESS_SEC = float(os.environ.get("WORKER_PROCESS_SEC", "2.0"))


def ensure_schema(conn):
    conn.execute(SCHEMA)
    conn.commit()


def claim_one(conn) -> bool:
    """认领一条待办单：pending → processing，立即提交使其对外可见为在办。"""
    with conn.transaction():
        row = conn.execute(
            """SELECT id
               FROM yaw_logs
               WHERE status = 'pending'
               ORDER BY id
               FOR UPDATE SKIP LOCKED
               LIMIT 1"""
        ).fetchone()
        if row is None:
            return False
        conn.execute(
            """UPDATE yaw_logs
               SET status = 'processing', claimed_at = %s
               WHERE id = %s""",
            (datetime.now(timezone.utc), row["id"]),
        )
    conn.commit()
    return True


def finish_due(conn) -> bool:
    """办结一条在办停留已满 PROCESS_SEC 的单据：processing → done。"""
    deadline = datetime.now(timezone.utc) - timedelta(seconds=PROCESS_SEC)
    with conn.transaction():
        row = conn.execute(
            """SELECT id, yaw_err_deg
               FROM yaw_logs
               WHERE status = 'processing' AND claimed_at <= %s
               ORDER BY id
               FOR UPDATE SKIP LOCKED
               LIMIT 1""",
            (deadline,),
        ).fetchone()
        if row is None:
            return False
        verdict, reason = judge(float(row["yaw_err_deg"]))
        conn.execute(
            """UPDATE yaw_logs
               SET status = 'done', verdict = %s, reason = %s,
                   processed_at = %s
               WHERE id = %s""",
            (verdict, reason, datetime.now(timezone.utc), row["id"]),
        )
    conn.commit()
    return True


def main():
    print("yaw-align worker started", flush=True)
    with connect() as conn:
        ensure_schema(conn)
    while True:
        try:
            with connect() as conn:
                progressed = finish_due(conn)
                progressed = claim_one(conn) or progressed
            time.sleep(POLL_SEC if progressed else IDLE_SEC)
        except psycopg.Error as exc:
            print(f"worker db error: {exc}", flush=True)
            time.sleep(IDLE_SEC)


if __name__ == "__main__":
    main()
