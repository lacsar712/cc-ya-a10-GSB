import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

type LogRow = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  status: string;
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  claimed_at: string | null;
  processed_at: string | null;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type WindowRow = {
  id: number;
  name: string;
  status: "open" | "closed";
  opened_by: string;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
};

type SnapshotHead = {
  id: number;
  window_id: number;
  window_name: string;
  snapshotted_by: string;
  snapshotted_at: string;
  item_count: number;
};

type SnapshotItem = {
  line_no: number;
  log_id: number;
  turbine_code: string;
  yaw_err_deg: number;
  log_status: string;
  log_created_by: string;
  log_created_at: string;
};

type SnapshotDetail = {
  head: SnapshotHead;
  items: SnapshotItem[];
};

type WindowLookup = {
  window: WindowRow;
  snapshots: SnapshotHead[];
};

type View = "logs" | "snapshots";

function fmtTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("zh-CN", { hour12: false });
}

function statusLabel(status: string): string {
  if (status === "pending") return "待办";
  if (status === "processing") return "在办";
  if (status === "done") return "办结";
  return status;
}

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
      max-width: 1000px;
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin-bottom: 1rem;
    }
    .brand {
      font-size: 1.15rem;
      font-weight: 700;
      color: #38bdf8;
      margin-right: auto;
    }
    .winchip {
      font-size: 0.82rem;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      border: 1px solid #475569;
      color: #cbd5e1;
    }
    .winchip.open {
      background: #14532d;
      border-color: #166534;
      color: #86efac;
    }
    .winchip.closed {
      background: #3f3f46;
      color: #d4d4d8;
    }
    nav {
      display: flex;
      gap: 0.4rem;
    }
    nav button.tab {
      background: #334155;
    }
    nav button.tab.active {
      background: #0284c7;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
      color: #38bdf8;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1.5rem;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    section > h2 {
      margin-top: 0;
      font-size: 1.05rem;
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-bottom: 0.25rem;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
    }
    .inline-input {
      width: auto;
      min-width: 200px;
      margin-bottom: 0;
    }
    button {
      cursor: pointer;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
    }
    button.secondary {
      background: #475569;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid #334155;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .ok {
      background: #14532d;
      color: #86efac;
    }
    .bad {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .pending {
      background: #713f12;
      color: #fde68a;
    }
    .processing {
      background: #1e3a8a;
      color: #bfdbfe;
    }
    .done {
      background: #14532d;
      color: #86efac;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.85rem;
      margin: 0.3rem 0 0;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .freeze-banner {
      background: #422006;
      border: 1px solid #a16207;
      color: #fde68a;
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
      font-size: 0.88rem;
      margin-bottom: 0.75rem;
    }
    .zone-tag {
      display: inline-block;
      font-size: 0.75rem;
      color: #0f172a;
      background: #38bdf8;
      border-radius: 4px;
      padding: 0.1rem 0.45rem;
      margin-right: 0.5rem;
      vertical-align: middle;
    }
    .clickable {
      cursor: pointer;
    }
    .clickable:hover td {
      background: #243349;
    }
  `;

  @state() private session: Session | null = null;
  @state() private view: View = "logs";
  @state() private logs: LogRow[] = [];
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private loading = false;

  // 并网窗口
  @state() private currentWindow: WindowRow | null = null;
  @state() private newWindowName = "";

  // 在途留影专页
  @state() private queryWindowName = "";
  @state() private lookup: WindowLookup | null = null;
  @state() private detail: SnapshotDetail | null = null;
  @state() private snapshotError = "";
  @state() private snapshotBusy = false;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.onSessionReady();
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) clearInterval(this._pollTimer);
  }

  private _pollTimer?: number;

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private async api(
    path: string,
    options: RequestInit = {}
  ): Promise<{ ok: boolean; status: number; data: any }> {
    const res = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...this.authHeaders(),
        ...(options.headers || {}),
      },
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  }

  private async onSessionReady() {
    await this.refreshLogs();
    await this.refreshCurrentWindow();
    this._pollTimer = window.setInterval(() => {
      void this.refreshLogs();
      void this.refreshCurrentWindow();
    }, 2000);
  }

  private async refreshLogs() {
    if (!this.session) return;
    const r = await this.api("/api/logs");
    if (r.status === 401) return this.logout();
    if (r.ok) this.logs = r.data as LogRow[];
  }

  private async refreshCurrentWindow() {
    if (!this.session) return;
    const r = await this.api("/api/windows/current");
    if (r.status === 401) return this.logout();
    if (r.ok) this.currentWindow = (r.data as WindowRow | null) ?? null;
  }

  private async login() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.loginUser,
          password: this.loginPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "登录失败";
        return;
      }
      this.session = {
        token: data.access_token,
        username: data.username,
        role: data.role,
      };
      localStorage.setItem("yaw_session", JSON.stringify(this.session));
      await this.onSessionReady();
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.session = null;
    this.logs = [];
    this.currentWindow = null;
    this.lookup = null;
    this.detail = null;
    localStorage.removeItem("yaw_session");
  }

  private async submitLog() {
    this.error = "";
    this.loading = true;
    try {
      const r = await this.api("/api/logs", {
        method: "POST",
        body: JSON.stringify({
          turbine_code: this.turbineCode,
          yaw_err_deg: Number(this.yawErr),
        }),
      });
      if (!r.ok) {
        this.error = r.data?.detail || "提交失败";
        return;
      }
      this.turbineCode = "";
      this.yawErr = "";
      await this.refreshLogs();
    } catch {
      this.error = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  // --- 并网窗口 ---

  private async openWindow() {
    this.snapshotError = "";
    const name = this.newWindowName.trim();
    if (!name) {
      this.snapshotError = "窗口名不能为空";
      return;
    }
    this.snapshotBusy = true;
    try {
      const r = await this.api("/api/windows", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        this.snapshotError = r.data?.detail || "开窗失败";
        return;
      }
      this.newWindowName = "";
      await this.refreshCurrentWindow();
    } catch {
      this.snapshotError = "开窗时网络异常";
    } finally {
      this.snapshotBusy = false;
    }
  }

  private async closeWindow() {
    this.snapshotError = "";
    this.snapshotBusy = true;
    try {
      const r = await this.api("/api/windows/close", { method: "POST" });
      if (!r.ok) {
        this.snapshotError = r.data?.detail || "关窗失败";
        return;
      }
      await this.refreshCurrentWindow();
      // 同步刷新专页里该窗口的开闭状态
      if (this.lookup) await this.lookupWindow();
    } catch {
      this.snapshotError = "关窗时网络异常";
    } finally {
      this.snapshotBusy = false;
    }
  }

  // --- 在途留影 ---

  private async lookupWindow() {
    this.snapshotError = "";
    const name = this.queryWindowName.trim();
    if (!name) {
      this.snapshotError = "请输入窗口名";
      return;
    }
    this.snapshotBusy = true;
    try {
      const r = await this.api(
        `/api/windows/by-name?name=${encodeURIComponent(name)}`
      );
      if (!r.ok) {
        this.lookup = null;
        this.detail = null;
        this.snapshotError = r.data?.detail || "未找到该窗口";
        return;
      }
      this.lookup = r.data as WindowLookup;
      this.detail = null;
    } catch {
      this.snapshotError = "查询时网络异常";
    } finally {
      this.snapshotBusy = false;
    }
  }

  private async takeSnapshot() {
    if (!this.lookup || this.lookup.window.status !== "open") return;
    this.snapshotError = "";
    this.snapshotBusy = true;
    try {
      const r = await this.api(
        `/api/windows/${this.lookup.window.id}/snapshots`,
        { method: "POST" }
      );
      if (!r.ok) {
        this.snapshotError = r.data?.detail || "留影失败";
        return;
      }
      const created = r.data as SnapshotHead;
      await this.lookupWindow();
      // 留影后直接打开新留影明细，便于核对在途笔数
      await this.openSnapshotDetail(created.id);
    } catch {
      this.snapshotError = "留影时网络异常";
    } finally {
      this.snapshotBusy = false;
    }
  }

  private async openSnapshotDetail(id: number) {
    this.snapshotError = "";
    const r = await this.api(`/api/snapshots/${id}`);
    if (!r.ok) {
      this.snapshotError = r.data?.detail || "读取留影明细失败";
      return;
    }
    this.detail = r.data as SnapshotDetail;
  }

  private statusClass(status: string) {
    if (status === "pending") return "pending";
    if (status === "processing") return "processing";
    if (status === "done") return "done";
    return "";
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending" || row.status === "processing") {
      return this.statusClass(row.status);
    }
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  // --- 渲染 ---

  private renderTopBar() {
    return html`
      <div class="topbar">
        <span class="brand">风机偏航对中台</span>
        ${this.currentWindow
          ? html`<span class="winchip open"
              >并网窗开启中：${this.currentWindow.name}</span
            >`
          : html`<span class="winchip closed">无开启中的并网窗</span>`}
        <nav>
          <button
            class="tab ${this.view === "logs" ? "active" : "secondary"}"
            @click=${() => (this.view = "logs")}
          >
            对中记录
          </button>
          <button
            class="tab ${this.view === "snapshots" ? "active" : "secondary"}"
            @click=${() => (this.view = "snapshots")}
          >
            在途留影
          </button>
        </nav>
        <span class="hint" style="margin:0;"
          >${this.session!.username}（${this.isWriter ? "可写" : "观察只读"}）</span
        >
        <button class="secondary" @click=${this.logout}>退出</button>
      </div>
    `;
  }

  private renderWindowControl() {
    return html`
      <section>
        <h2><span class="zone-tag">窗口</span>并网窗口</h2>
        ${this.currentWindow
          ? html`
              <div class="row-actions">
                <span>
                  当前窗口 <strong>${this.currentWindow.name}</strong>，开启人
                  ${this.currentWindow.opened_by}，开启于
                  ${fmtTime(this.currentWindow.opened_at)}
                </span>
                <button
                  class="secondary"
                  ?disabled=${this.snapshotBusy || !this.isWriter}
                  @click=${this.closeWindow}
                  title=${this.isWriter ? "" : "观察身份只读，不可关窗"}
                >
                  关闭并网窗
                </button>
              </div>
              ${!this.isWriter
                ? html`<p class="hint">观察身份可查阅，不能开/关窗或留影。</p>`
                : null}
            `
          : html`
              <label>新窗口名</label>
              <div class="row-actions">
                <input
                  class="inline-input"
                  placeholder="例如 2026-10 并网窗口"
                  .value=${this.newWindowName}
                  @input=${(e: Event) =>
                    (this.newWindowName = (e.target as HTMLInputElement).value)}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter") void this.openWindow();
                  }}
                />
                <button
                  ?disabled=${this.snapshotBusy || !this.isWriter}
                  @click=${this.openWindow}
                  title=${this.isWriter ? "" : "观察身份只读，不可开窗"}
                >
                  开启并网窗
                </button>
              </div>
              ${!this.isWriter
                ? html`<p class="hint">观察身份可查阅，不能开/关窗或留影。</p>`
                : null}
            `}
      </section>
    `;
  }

  private renderSnapshotsView() {
    const canSnapshot =
      this.isWriter && this.lookup?.window.status === "open";
    return html`
      <h1>并网窗在途留影</h1>
      <p class="sub">
        填写窗口名查询历史留影并查看明细；留影会抄录当时全部待办/在办单据的编号、机组、偏航。
      </p>

      ${this.renderWindowControl()}

      <!-- 第一区：查窗口 + 留影操作 -->
      <section>
        <h2><span class="zone-tag">一</span>窗口查询与留影</h2>
        <label>窗口名</label>
        <div class="row-actions">
          <input
            class="inline-input"
            placeholder="输入窗口名查历史"
            .value=${this.queryWindowName}
            @input=${(e: Event) =>
              (this.queryWindowName = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") void this.lookupWindow();
            }}
          />
          <button
            class="secondary"
            ?disabled=${this.snapshotBusy}
            @click=${this.lookupWindow}
          >
            查询
          </button>
          <button
            ?disabled=${!canSnapshot || this.snapshotBusy}
            @click=${this.takeSnapshot}
            title=${this.isWriter
              ? this.lookup?.window.status === "open"
                ? ""
                : "该窗口未开启或已关闭"
              : "观察身份只读，不可点留影"}
          >
            留影（抄录当前在途单据）
          </button>
        </div>
        ${this.lookup
          ? html`
              <p class="hint">
                窗口「${this.lookup.window.name}」状态：
                <span
                  class="tag ${this.lookup.window.status === "open"
                    ? "ok"
                    : "pending"}"
                  >${this.lookup.window.status === "open" ? "开启中" : "已关闭"}</span
                >
                ，共 ${this.lookup.snapshots.length} 份留影。
              </p>
            `
          : html`<p class="hint">输入窗口名查询其历史留影。</p>`}
        ${!this.isWriter
          ? html`<p class="hint">观察身份可查阅历史与明细，但「留影」按钮不可用。</p>`
          : null}
        ${this.snapshotError
          ? html`<p class="err">${this.snapshotError}</p>`
          : null}
      </section>

      <!-- 第二区：历史留影列表 -->
      <section>
        <h2><span class="zone-tag">二</span>历史留影</h2>
        ${this.lookup && this.lookup.snapshots.length > 0
          ? html`
              <table>
                <thead>
                  <tr>
                    <th>留影号</th>
                    <th>窗口</th>
                    <th>留影时间</th>
                    <th>操作人</th>
                    <th>在途笔数</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${this.lookup.snapshots.map(
                    (s) => html`
                      <tr
                        class="clickable"
                        @click=${() => void this.openSnapshotDetail(s.id)}
                      >
                        <td>${s.id}</td>
                        <td>${s.window_name}</td>
                        <td>${fmtTime(s.snapshotted_at)}</td>
                        <td>${s.snapshotted_by}</td>
                        <td>${s.item_count}</td>
                        <td>
                          <button
                            class="secondary"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              void this.openSnapshotDetail(s.id);
                            }}
                          >
                            看明细
                          </button>
                        </td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            `
          : html`<p class="hint">${this.lookup
              ? "该窗口暂无留影。"
              : "先在上方查询一个窗口。"}</p>`}
      </section>

      <!-- 第三区：留影明细 -->
      <section>
        <h2><span class="zone-tag">三</span>留影明细</h2>
        ${this.detail
          ? html`
              <div class="freeze-banner">
                历史影像（留影号 ${this.detail.head.id}，成形于
                ${fmtTime(this.detail.head.snapshotted_at)}）：以下为当时抄录的编号、机组、偏航与状态，
                在线单据之后办结或改状态<strong>不会</strong>改写本份留影，新旧分叉可辨。
              </div>
              <p class="hint" style="margin-bottom:0.6rem;">
                窗口 ${this.detail.head.window_name} · 留影人
                ${this.detail.head.snapshotted_by} · 共
                ${this.detail.items.length} 行
              </p>
              <table>
                <thead>
                  <tr>
                    <th>行号</th>
                    <th>单据编号</th>
                    <th>机组</th>
                    <th>偏航°</th>
                    <th>当时状态</th>
                    <th>提交人</th>
                    <th>提交时间</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.detail.items.map(
                    (it) => html`
                      <tr>
                        <td>${it.line_no}</td>
                        <td>${it.log_id}</td>
                        <td>${it.turbine_code}</td>
                        <td>${it.yaw_err_deg}</td>
                        <td>
                          <span class="tag ${this.statusClass(it.log_status)}"
                            >${statusLabel(it.log_status)}</span
                          >
                        </td>
                        <td>${it.log_created_by}</td>
                        <td>${fmtTime(it.log_created_at)}</td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            `
          : html`<p class="hint">从历史留影中选择一份查看明细。</p>`}
      </section>
    `;
  }

  render() {
    if (!this.session) {
      return html`
        <h1>风机偏航对中台</h1>
        <p class="sub">现场技师提交偏航误差，后台 worker 认领后给出合格或偏航超差结论。</p>
        <section>
          <label>用户名</label>
          <input
            .value=${this.loginUser}
            @input=${(e: Event) =>
              (this.loginUser = (e.target as HTMLInputElement).value)}
          />
          <label>密码</label>
          <input
            type="password"
            .value=${this.loginPass}
            @input=${(e: Event) =>
              (this.loginPass = (e.target as HTMLInputElement).value)}
          />
          <button ?disabled=${this.loading} @click=${this.login}>登录</button>
          ${this.error ? html`<p class="err">${this.error}</p>` : null}
        </section>
      `;
    }

    return html`
      ${this.renderTopBar()}
      ${this.view === "logs"
        ? html`
            <section>
              <div class="row-actions">
                <button
                  class="secondary"
                  ?disabled=${this.loading}
                  @click=${this.refreshLogs}
                >
                  刷新列表
                </button>
              </div>
            </section>

            ${this.isWriter
              ? html`
                  <section>
                    <h2 style="margin-top:0;font-size:1.1rem;">提交偏航记录</h2>
                    <label>机组编号</label>
                    <input
                      placeholder="例如 W12"
                      .value=${this.turbineCode}
                      @input=${(e: Event) =>
                        (this.turbineCode = (e.target as HTMLInputElement).value)}
                    />
                    <label>偏航误差（度，可正可负）</label>
                    <input
                      type="number"
                      step="0.1"
                      .value=${this.yawErr}
                      @input=${(e: Event) =>
                        (this.yawErr = (e.target as HTMLInputElement).value)}
                    />
                    <button ?disabled=${this.loading} @click=${this.submitLog}>
                      提交（进入待认领队列）
                    </button>
                    ${this.error ? html`<p class="err">${this.error}</p>` : null}
                  </section>
                `
              : null}

            <section>
              <h2 style="margin-top:0;font-size:1.1rem;">对中记录</h2>
              <table>
                <thead>
                  <tr>
                    <th>编号</th>
                    <th>机组</th>
                    <th>误差°</th>
                    <th>状态</th>
                    <th>结论</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.logs.map(
                    (row) => html`
                      <tr>
                        <td>${row.id}</td>
                        <td>${row.turbine_code}</td>
                        <td>${row.yaw_err_deg}</td>
                        <td>
                          <span class="tag ${this.statusClass(row.status)}">
                            ${statusLabel(row.status)}
                          </span>
                        </td>
                        <td>
                          ${row.verdict
                            ? html`<span class="tag ${this.verdictClass(row)}"
                                >${row.verdict}</span
                              >`
                            : "—"}
                        </td>
                        <td>${row.reason ?? "—"}</td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            </section>
          `
        : this.renderSnapshotsView()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
