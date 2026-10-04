# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，先置「在办」并按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

并网窗口开启期间，可写身份（technician）可对当刻全部在途单据（待办 pending + 在办 processing）点「留影」，把编号、机组、偏航、状态抄入留影库供监理回看；观察身份（observer）可查阅、不可点留影。留影头与明细行同一事务提交；留影生成后在线单据再办结或改状态不会回写旧留影，明细同时展示冻结状态与在线当前状态，新旧分叉可辨。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交 |
| observer | obs123456 | 只读 |

## 启动

```bash
cd projects/20-yaw-align-log
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待办」，worker 认领后短暂显示「在办」，数秒内变为对应结论（已办结）。
3. observer 可查看列表与留影，无提交表单、无开/关窗与留影按钮。
4. 顶栏进入「并网窗在途留影」专页，页面分三区：
   - 一区：当前并网窗口。technician 填窗口名开窗；开窗时点「留影」即抄录当刻全部待办+在办单据；可关窗。同时仅允许一个开启中的窗口。
   - 二区：填窗口名（模糊）查历史窗口及其留影头列表，点「看明细」。
   - 三区：留影明细，列为单据编号、机组、偏航°、留影状态（冻结）、在线当前状态、新旧分叉。
5. 留影头与明细在同一数据库事务内提交；任一行插入失败则整份回滚，不存在只落一半的留影。
6. 留影后在线单据再办结或改状态不改写旧留影：打开旧留影仍见当刻全部行、不少一行，冻结状态保持「待办/在办」，分叉行标「已分叉」。
7. 权限：开窗、关窗、留影均仅 writer（technician）可用；observer 调用返回 403。窗口关闭后再留影返回 409；无在途单据时留影返回 409。

## 接口（除 health/login 外均需 Bearer 登录）

| 方法/路径 | 权限 | 说明 |
|---|---|---|
| `GET /api/windows/current` | 登录 | 当前开启中的窗口（无则 null） |
| `POST /api/windows` | writer | 开并网窗口 `{name}` |
| `POST /api/windows/{id}/close` | writer | 关窗 |
| `GET /api/windows?name=` | 登录 | 按窗口名模糊查历史（含留影头） |
| `POST /api/snapshots` | writer | 对指定开窗 `{window_name}` 留影，事务内锁定并抄录在途单 |
| `GET /api/snapshots?window_name=` | 登录 | 按窗口名查留影头 |
| `GET /api/snapshots/{id}` | 登录 | 留影明细（冻结值 + 在线当前状态） |

## 数据表

- `grid_windows`：并网窗口，部分唯一索引保证同时只有一个 `open`。
- `yaw_snapshots`：留影头（窗口、笔数、留影人、时间）。
- `yaw_snapshot_items`：留影明细，`status_frozen` 等全部为当刻复制值，`(snapshot_id, log_id)` 唯一；此后 `yaw_logs` 状态变化不回写本表。
- `yaw_logs` 新增 `claimed_at`：worker 认领时刻，状态机 pending → processing → done。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
