import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from psycopg.errors import UniqueViolation
from quart import Quart, jsonify, request

from db import IN_FLIGHT_STATUSES, SCHEMA, connect
from rules import judge

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

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


class ApiError(Exception):
    def __init__(self, detail: str, status: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status = status


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
            return jsonify({"detail": "仅现场技师（可写身份）可执行该操作"}), 403
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


def _serialize_window_with_snapshots(conn, row):
    snaps = conn.execute(
        """SELECT id, item_count, created_by, created_at
           FROM yaw_snapshots
           WHERE window_id = %s
           ORDER BY id DESC""",
        (row["id"],),
    ).fetchall()
    return {
        "id": row["id"],
        "name": row["name"],
        "status": row["status"],
        "opened_by": row["opened_by"],
        "opened_at": row["opened_at"],
        "closed_by": row["closed_by"],
        "closed_at": row["closed_at"],
        "snapshots": snaps,
    }


@app.get("/api/windows/current")
@require_login
async def current_window(user):
    def query():
        with connect() as conn:
            return conn.execute(
                "SELECT * FROM grid_windows WHERE status = 'open' ORDER BY id DESC LIMIT 1"
            ).fetchone()

    row = await run_db(query)
    return jsonify(row)


@app.get("/api/windows")
@require_login
async def search_windows(user):
    keyword = (request.args.get("name") or "").strip()
    if not keyword:
        return jsonify({"detail": "请填写窗口名"}), 400

    def query():
        with connect() as conn:
            rows = conn.execute(
                """SELECT * FROM grid_windows
                   WHERE name ILIKE %s
                   ORDER BY id DESC
                   LIMIT 50""",
                (f"%{keyword}%",),
            ).fetchall()
            return [_serialize_window_with_snapshots(conn, r) for r in rows]

    result = await run_db(query)
    return jsonify(result)


@app.post("/api/windows")
@require_writer
async def open_window(user):
    body = await request.get_json(force=True, silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"detail": "窗口名不能为空"}), 400
    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            try:
                with conn.transaction():
                    existing = conn.execute(
                        "SELECT id FROM grid_windows WHERE status = 'open' LIMIT 1"
                    ).fetchone()
                    if existing is not None:
                        raise ApiError("已有开启中的并网窗口，请先关闭再开新窗", 409)
                    row = conn.execute(
                        """INSERT INTO grid_windows
                           (name, status, opened_by, opened_at)
                           VALUES (%s, 'open', %s, %s)
                           RETURNING *""",
                        (name, user["username"], now),
                    ).fetchone()
            except UniqueViolation:
                raise ApiError("窗口名已存在", 409)
            conn.commit()
            return row

    try:
        row = await run_db(insert)
    except ApiError as exc:
        return jsonify({"detail": exc.detail}), exc.status
    return jsonify(row), 201


@app.post("/api/windows/<int:window_id>/close")
@require_writer
async def close_window(user, window_id):
    now = datetime.now(timezone.utc)

    def update():
        with connect() as conn:
            with conn.transaction():
                row = conn.execute(
                    "SELECT * FROM grid_windows WHERE id = %s FOR UPDATE",
                    (window_id,),
                ).fetchone()
                if row is None:
                    raise ApiError("窗口不存在", 404)
                if row["status"] != "open":
                    raise ApiError("该窗口已关闭", 409)
                row = conn.execute(
                    """UPDATE grid_windows
                       SET status = 'closed', closed_by = %s, closed_at = %s
                       WHERE id = %s
                       RETURNING *""",
                    (user["username"], now, window_id),
                ).fetchone()
            conn.commit()
            return row

    try:
        row = await run_db(update)
    except ApiError as exc:
        return jsonify({"detail": exc.detail}), exc.status
    return jsonify(row)


# ---------------------------------------------------------------------------
# 在途留影
# ---------------------------------------------------------------------------


@app.post("/api/snapshots")
@require_writer
async def create_snapshot(user):
    body = await request.get_json(force=True, silent=True) or {}
    window_name = (body.get("window_name") or "").strip()
    if not window_name:
        return jsonify({"detail": "请填写窗口名"}), 400
    now = datetime.now(timezone.utc)

    def take():
        # 留影头与全部明细行必须在同一事务内落库，绝不只落一半；
        # FOR UPDATE 锁住当刻在途单据，保证抄录期间没有单据被并发办结而漏抄。
        with connect() as conn:
            with conn.transaction():
                window = conn.execute(
                    "SELECT * FROM grid_windows WHERE name = %s FOR UPDATE",
                    (window_name,),
                ).fetchone()
                if window is None:
                    raise ApiError("并网窗口不存在", 404)
                if window["status"] != "open":
                    raise ApiError("并网窗口已关闭，无法再留影", 409)

                rows = conn.execute(
                    """SELECT id, turbine_code, yaw_err_deg, status,
                              created_by, created_at
                       FROM yaw_logs
                       WHERE status = ANY(%s)
                       ORDER BY id
                       FOR UPDATE""",
                    (list(IN_FLIGHT_STATUSES),),
                ).fetchall()
                if not rows:
                    raise ApiError("当前没有在途（待办/在办）单据，无需留影", 409)

                snap = conn.execute(
                    """INSERT INTO yaw_snapshots
                       (window_id, window_name, item_count, created_by, created_at)
                       VALUES (%s, %s, %s, %s, %s)
                       RETURNING *""",
                    (window["id"], window_name, len(rows),
                     user["username"], now),
                ).fetchone()
                with conn.cursor() as cur:
                    cur.executemany(
                        """INSERT INTO yaw_snapshot_items
                           (snapshot_id, log_id, turbine_code, yaw_err_deg,
                            status_frozen, created_by, log_created_at, snapshotted_at)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                        [
                            (
                                snap["id"], r["id"], r["turbine_code"],
                                r["yaw_err_deg"], r["status"], r["created_by"],
                                r["created_at"], now,
                            )
                            for r in rows
                        ],
                    )
                items = conn.execute(
                    """SELECT id, log_id, turbine_code, yaw_err_deg,
                              status_frozen, created_by,
                              log_created_at, snapshotted_at
                       FROM yaw_snapshot_items
                       WHERE snapshot_id = %s
                       ORDER BY id""",
                    (snap["id"],),
                ).fetchall()
            conn.commit()
            return {"header": snap, "items": items}

    try:
        result = await run_db(take)
    except ApiError as exc:
        return jsonify({"detail": exc.detail}), exc.status
    return jsonify(result), 201


@app.get("/api/snapshots")
@require_login
async def list_snapshots(user):
    window_name = (request.args.get("window_name") or "").strip()
    if not window_name:
        return jsonify({"detail": "请填写窗口名"}), 400

    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, window_id, window_name, item_count,
                          created_by, created_at
                   FROM yaw_snapshots
                   WHERE window_name ILIKE %s
                   ORDER BY id DESC
                   LIMIT 100""",
                (f"%{window_name}%",),
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.get("/api/snapshots/<int:snapshot_id>")
@require_login
async def get_snapshot(user, snapshot_id):
    def query():
        with connect() as conn:
            header = conn.execute(
                """SELECT s.id, s.window_id, s.window_name, s.item_count,
                          s.created_by, s.created_at,
                          w.status AS window_status
                   FROM yaw_snapshots s
                   JOIN grid_windows w ON w.id = s.window_id
                   WHERE s.id = %s""",
                (snapshot_id,),
            ).fetchone()
            if header is None:
                raise ApiError("留影不存在", 404)

            # 明细只读出留影当刻的冻结值；另关联在线单据取当前状态，用于呈现新旧分叉。
            items = conn.execute(
                """SELECT i.id, i.log_id, i.turbine_code, i.yaw_err_deg,
                          i.status_frozen, i.created_by,
                          i.log_created_at, i.snapshotted_at,
                          l.status AS current_status,
                          l.verdict AS current_verdict,
                          l.processed_at AS current_processed_at
                   FROM yaw_snapshot_items i
                   LEFT JOIN yaw_logs l ON l.id = i.log_id
                   WHERE i.snapshot_id = %s
                   ORDER BY i.id""",
                (snapshot_id,),
            ).fetchall()
            return {"header": header, "items": items}

    try:
        result = await run_db(query)
    except ApiError as exc:
        return jsonify({"detail": exc.detail}), exc.status
    return jsonify(result)
