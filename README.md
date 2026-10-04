# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

并网窗口开启期间，可把当时全部**在途**偏航单据（待办 `pending` + 在办 `processing`）压成一份**留影**供监理回看；单据生命周期为 待办 → 在办 → 办结。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交、可开/关并网窗、可点留影 |
| observer | obs123456 | 只读：可查列表/历史/明细，不可开窗、不可留影 |

## 启动

```bash
cd projects/20-yaw-align-log
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待办」，worker 认领后短暂显示「在办」，随后变为对应结论（办结）。
3. observer 可查看列表，无提交表单。
4. **并网窗在途留影**（顶栏「在途留影」专页，分三区）：
   - 技师在专页开启并网窗（同一时刻至多一个开启中）；顶栏显示当前窗口状态。
   - 专页填**窗口名**「查询」可看该窗口历史留影；点「留影」即抄录当时全部待办/在办单的**编号、机组、偏航、当时状态**。
   - 历史留影列表可逐份「看明细」（第三区）；明细是成形时刻的值拷贝，并显著标注为历史影像。
   - observer 可查询历史、查看明细，但「开/关窗」「留影」按钮均禁用（接口侧同样返回 403）。
   - **原子性**：留影头与明细行在同一数据库事务提交，任何一步失败整份回滚，不会只落一半。
   - **不可变 / 新旧分叉可辨**：明细表不对外键在线单据；在线单据之后办结或改状态绝不回写旧留影。
   - 留影后再办结其中一单，重新打开旧留影仍见当时全部在途单据、一行不少、状态停留在当时。
   - 当时若有三条在途，留影必须三条齐全，缺任何一条即视为不合格。
   - 窗口关闭后不能再留影（返回 409），但历史留影仍可查阅。

## 留影相关接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/windows` | writer | 开启并网窗（重名/已有开启窗返回 409） |
| POST | `/api/windows/close` | writer | 关闭当前开启中的窗口 |
| GET | `/api/windows/current` | 登录 | 当前开启中窗口（无则 null） |
| GET | `/api/windows/by-name?name=` | 登录 | 按窗口名查窗口及其留影历史 |
| POST | `/api/windows/{id}/snapshots` | writer | 生成留影（单事务；仅开窗中可用，409 否则） |
| GET | `/api/windows/{id}/snapshots` | 登录 | 某窗口的留影历史 |
| GET | `/api/snapshots/{id}` | 登录 | 留影头 + 明细行 |

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`，待办→在办→办结两段）、Hypercorn
- 留影：`grid_windows` / `yaw_snapshots` / `yaw_snapshot_items` 三表；明细为值拷贝、仅外键留影头；生成时 `FOR UPDATE` 锁定在途单与 worker 状态翻转互斥
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm

