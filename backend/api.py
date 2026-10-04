import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

import psycopg
from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import SCHEMA, connect
from rules import judge

IN_TRANSIT_STATUSES = ("pending", "processing")

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


class HttpError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail

USERS = {
    "technician": {
        "role": "writer",
        "password_hash": pwd.hash("tech123456"),
    },
    "observer": {
        "role": "reader",
        "password_hash": pwd.hash("obs123456"),
    },
}

app = Quart(__name__)


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def seed_if_empty(conn):
    conn.execute(SCHEMA)
    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_logs").fetchone()["n"]
    if count > 0:
        return
    now = datetime.now(timezone.utc)
    samples = [
        ("W01", 0.4, "合格"),
        ("W07", 3.2, "偏航超差"),
    ]
    for code, err, expected_verdict in samples:
        verdict, reason = judge(err)
        assert verdict == expected_verdict
        conn.execute(
            """INSERT INTO yaw_logs
               (turbine_code, yaw_err_deg, status, verdict, reason,
                created_by, created_at, processed_at)
               VALUES (%s, %s, 'done', %s, %s, %s, %s, %s)""",
            (code, err, verdict, reason, "technician", now, now),
        )


@app.before_serving
async def startup():
    def init():
        with connect() as conn:
            seed_if_empty(conn)
            conn.commit()

    await run_db(init)


def parse_bearer():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


async def current_user():
    token = parse_bearer()
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except JWTError:
        return None
    sub = payload.get("sub")
    if sub not in USERS:
        return None
    return {"username": sub, "role": payload.get("role")}


def require_login(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        return await handler(user, *args, **kwargs)

    return wrapper


def require_writer(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        if user["role"] != "writer":
            return jsonify({"detail": "仅现场技师可提交偏航记录"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


@app.get("/api/health")
async def health():
    return jsonify({"status": "ok", "service": "yaw-align-log"})


@app.post("/api/auth/login")
async def login():
    body = await request.get_json(force=True, silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    user = USERS.get(username)
    if not user or not pwd.verify(password, user["password_hash"]):
        return jsonify({"detail": "用户名或密码错误"}), 401
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode(
        {"sub": username, "role": user["role"], "exp": exp},
        SECRET,
        algorithm="HS256",
    )
    return jsonify(
        {
            "access_token": token,
            "username": username,
            "role": user["role"],
        }
    )


@app.get("/api/logs")
@require_login
async def list_logs(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, turbine_code, yaw_err_deg, status, verdict, reason,
                          created_by, created_at, claimed_at, processed_at
                   FROM yaw_logs ORDER BY id DESC"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/logs")
@require_writer
async def create_log(user):
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip()
    if not turbine_code:
        return jsonify({"detail": "机组编号不能为空"}), 400
    try:
        yaw_err_deg = float(body.get("yaw_err_deg"))
    except (TypeError, ValueError):
        return jsonify({"detail": "偏航误差必须是数字"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            row = conn.execute(
                """INSERT INTO yaw_logs
                   (turbine_code, yaw_err_deg, status, verdict, reason,
                    created_by, created_at)
                   VALUES (%s, %s, 'pending', NULL, NULL, %s, %s)
                   RETURNING id, turbine_code, yaw_err_deg, status, verdict, reason,
                             created_by, created_at, claimed_at, processed_at""",
                (turbine_code, yaw_err_deg, user["username"], now),
            ).fetchone()
            conn.commit()
            return row

    row = await run_db(insert)
    return jsonify(row), 201


# ---------------------------------------------------------------------------
# 并网窗口
# ---------------------------------------------------------------------------


@app.post("/api/windows")
@require_writer
async def open_window(user):
    """开启并网窗口；已有开启中的窗口则冲突。"""
    body = await request.get_json(force=True, silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"detail": "窗口名不能为空"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            existing = conn.execute(
                "SELECT id FROM grid_windows WHERE status = 'open'"
            ).fetchone()
            if existing is not None:
                raise HttpError(409, "已有开启中的并网窗口，请先关闭再开新窗")
            try:
                row = conn.execute(
                    """INSERT INTO grid_windows
                       (name, status, opened_by, opened_at)
                       VALUES (%s, 'open', %s, %s)
                       RETURNING id, name, status, opened_by, opened_at,
                                 closed_by, closed_at""",
                    (name, user["username"], now),
                ).fetchone()
            except psycopg.errors.UniqueViolation:
                raise HttpError(409, "窗口名已存在")
            conn.commit()
            return row

    try:
        row = await run_db(insert)
    except HttpError as exc:
        return jsonify({"detail": exc.detail}), exc.status
    return jsonify(row), 201


@app.post("/api/windows/close")
@require_writer
async def close_window(user):
    """关闭当前开启中的并网窗口。"""
    now = datetime.now(timezone.utc)

    def update():
        with connect() as conn:
            row = conn.execute(
                """UPDATE grid_windows
                   SET status = 'closed', closed_by = %s, closed_at = %s
                   WHERE status = 'open'
                   RETURNING id, name, status, opened_by, opened_at,
                             closed_by, closed_at""",
                (user["username"], now),
            ).fetchone()
            if row is None:
                raise HttpError(404, "当前没有开启中的并网窗口")
            conn.commit()
            return row

    try:
        row = await run_db(update)
    except HttpError as exc:
        return jsonify({"detail": exc.detail}), exc.status
    return jsonify(row)


@app.get("/api/windows/current")
@require_login
async def current_window(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, name, status, opened_by, opened_at,
                          closed_by, closed_at
                   FROM grid_windows
                   WHERE status = 'open'
                   ORDER BY id DESC
                   LIMIT 1"""
            ).fetchone()

    row = await run_db(query)
    return jsonify(row)  # 无开窗时为 null


# ---------------------------------------------------------------------------
# 在途留影
# ---------------------------------------------------------------------------


@app.post("/api/windows/<int:window_id>/snapshots")
@require_writer
async def create_snapshot(user, window_id):
    """抄录当前全部待办/在办单据到留影库。

    留影头与明细行在同一事务提交，禁止只落一半；明细为值拷贝，在线单据
    之后办结或改状态不影响本份留影。窗口必须处于开启中。
    """
    now = datetime.now(timezone.utc)

    def snapshot():
        with connect() as conn:
            with conn.transaction():
                window = conn.execute(
                    "SELECT id, name, status FROM grid_windows WHERE id = %s FOR UPDATE",
                    (window_id,),
                ).fetchone()
                if window is None:
                    raise HttpError(404, "并网窗口不存在")
                if window["status"] != "open":
                    raise HttpError(409, "并网窗口已关闭，不能再留影")

                # 锁定当时全部在途单据，避免与 worker 的状态翻转竞争导致漏抄
                rows = conn.execute(
                    """SELECT id, turbine_code, yaw_err_deg, status,
                              created_by, created_at
                       FROM yaw_logs
                       WHERE status = ANY(%s)
                       ORDER BY id
                       FOR UPDATE""",
                    (list(IN_TRANSIT_STATUSES),),
                ).fetchall()

                head = conn.execute(
                    """INSERT INTO yaw_snapshots
                       (window_id, window_name, snapshotted_by,
                        snapshotted_at, item_count)
                       VALUES (%s, %s, %s, %s, %s)
                       RETURNING id, window_id, window_name, snapshotted_by,
                                 snapshotted_at, item_count""",
                    (
                        window_id,
                        window["name"],
                        user["username"],
                        now,
                        len(rows),
                    ),
                ).fetchone()

                if rows:
                    with conn.cursor() as cur:
                        cur.executemany(
                            """INSERT INTO yaw_snapshot_items
                               (snapshot_id, line_no, log_id, turbine_code,
                                yaw_err_deg, log_status, log_created_by,
                                log_created_at)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                            [
                                (
                                    head["id"],
                                    idx,
                                    r["id"],
                                    r["turbine_code"],
                                    r["yaw_err_deg"],
                                    r["status"],
                                    r["created_by"],
                                    r["created_at"],
                                )
                                for idx, r in enumerate(rows, start=1)
                            ],
                        )
            conn.commit()
            head["items"] = [
                {
                    "line_no": idx,
                    "log_id": r["id"],
                    "turbine_code": r["turbine_code"],
                    "yaw_err_deg": r["yaw_err_deg"],
                    "log_status": r["status"],
                    "log_created_by": r["created_by"],
                    "log_created_at": r["created_at"],
                }
                for idx, r in enumerate(rows, start=1)
            ]
            return head

    try:
        result = await run_db(snapshot)
    except HttpError as exc:
        return jsonify({"detail": exc.detail}), exc.status
    return jsonify(result), 201


@app.get("/api/windows/<int:window_id>/snapshots")
@require_login
async def list_snapshots(user, window_id):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, window_id, window_name, snapshotted_by,
                          snapshotted_at, item_count
                   FROM yaw_snapshots
                   WHERE window_id = %s
                   ORDER BY id DESC""",
                (window_id,),
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.get("/api/snapshots/<int:snapshot_id>")
@require_login
async def get_snapshot(user, snapshot_id):
    def query():
        with connect() as conn:
            head = conn.execute(
                """SELECT id, window_id, window_name, snapshotted_by,
                          snapshotted_at, item_count
                   FROM yaw_snapshots
                   WHERE id = %s""",
                (snapshot_id,),
            ).fetchone()
            if head is None:
                return None
            items = conn.execute(
                """SELECT line_no, log_id, turbine_code, yaw_err_deg,
                          log_status, log_created_by, log_created_at
                   FROM yaw_snapshot_items
                   WHERE snapshot_id = %s
                   ORDER BY line_no""",
                (snapshot_id,),
            ).fetchall()
            return {"head": head, "items": items}

    result = await run_db(query)
    if result is None:
        return jsonify({"detail": "留影不存在"}), 404
    return jsonify(result)


@app.get("/api/windows/by-name")
@require_login
async def find_window_by_name(user):
    """按窗口名查窗口及其留影历史，供专页检索。"""
    name = (request.args.get("name") or "").strip()
    if not name:
        return jsonify({"detail": "窗口名不能为空"}), 400

    def query():
        with connect() as conn:
            window = conn.execute(
                """SELECT id, name, status, opened_by, opened_at,
                          closed_by, closed_at
                   FROM grid_windows
                   WHERE name = %s""",
                (name,),
            ).fetchone()
            if window is None:
                return None
            snapshots = conn.execute(
                """SELECT id, window_id, window_name, snapshotted_by,
                          snapshotted_at, item_count
                   FROM yaw_snapshots
                   WHERE window_id = %s
                   ORDER BY id DESC""",
                (window["id"],),
            ).fetchall()
            return {"window": window, "snapshots": snapshots}

    result = await run_db(query)
    if result is None:
        return jsonify({"detail": "未找到该窗口"}), 404
    return jsonify(result)
