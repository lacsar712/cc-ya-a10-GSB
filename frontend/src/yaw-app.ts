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
  status: string;
  opened_by: string;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  snapshots: SnapshotHeader[];
};

type SnapshotHeader = {
  id: number;
  window_id?: number;
  window_name?: string;
  item_count: number;
  created_by: string;
  created_at: string;
};

type SnapshotItem = {
  id: number;
  log_id: number;
  turbine_code: string;
  yaw_err_deg: number;
  status_frozen: string;
  created_by: string;
  log_created_at: string;
  snapshotted_at: string;
  current_status: string | null;
  current_verdict: string | null;
  current_processed_at: string | null;
};

type SnapshotDetail = {
  header: SnapshotHeader & { window_status: string };
  items: SnapshotItem[];
};

const STATUS_TEXT: Record<string, string> = {
  pending: "待办",
  processing: "在办",
  done: "已办结",
};

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
      max-width: 960px;
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin-bottom: 1.25rem;
    }
    .topbar h1 {
      margin: 0;
      font-size: 1.4rem;
      color: #38bdf8;
    }
    .topbar .spacer {
      flex: 1;
    }
    .navbtn {
      background: #1e293b;
      border: 1px solid #334155;
      color: #cbd5e1;
    }
    .navbtn.active {
      background: #0284c7;
      border-color: #0284c7;
      color: #fff;
    }
    .who {
      color: #94a3b8;
      font-size: 0.85rem;
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
    h2 {
      margin-top: 0;
      font-size: 1.1rem;
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
      display: flex;
      gap: 0.5rem;
    }
    .inline-input input {
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
    button.snap {
      background: #b45309;
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
    .frozen {
      background: #334155;
      color: #cbd5e1;
    }
    .fork {
      background: #4a1d96;
      color: #ddd6fe;
    }
    tr.diverged {
      background: rgba(168, 85, 247, 0.08);
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.85rem;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .clickable {
      cursor: pointer;
      color: #7dd3fc;
      text-decoration: underline;
    }
    .zone-no {
      font-size: 0.75rem;
      border: 1px solid #475569;
      border-radius: 999px;
      padding: 0.05rem 0.5rem;
      color: #94a3b8;
      margin-right: 0.5rem;
      vertical-align: middle;
    }
  `;

  @state() private session: Session | null = null;
  @state() private view: "logs" | "snapshots" = "logs";
  @state() private logs: LogRow[] = [];
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private loading = false;

  // 留影专页状态
  @state() private currentWindow: WindowRow | null = null;
  @state() private newWindowName = "";
  @state() private historyKeyword = "";
  @state() private history: WindowRow[] = [];
  @state() private historySearched = false;
  @state() private detail: SnapshotDetail | null = null;
  @state() private snapError = "";
  @state() private snapBusy = false;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.refreshLogs();
        void this.refreshCurrentWindow();
        this._pollTimer = window.setInterval(() => {
          void this.refreshLogs();
          if (this.view === "snapshots") void this.refreshCurrentWindow();
        }, 2000);
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
    }
  }

  private _pollTimer?: number;

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async api(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; data: unknown }> {
    const res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...this.authHeaders(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }

  private async refreshLogs() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/logs", { headers: this.authHeaders() });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.logs = (await res.json()) as LogRow[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async refreshCurrentWindow() {
    if (!this.session) return;
    const { status, data } = await this.api("GET", "/api/windows/current");
    if (status === 200) this.currentWindow = (data as WindowRow) ?? null;
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
      await this.refreshLogs();
      await this.refreshCurrentWindow();
      this._pollTimer = window.setInterval(() => {
        void this.refreshLogs();
        if (this.view === "snapshots") void this.refreshCurrentWindow();
      }, 2000);
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
    this.history = [];
    this.detail = null;
    localStorage.removeItem("yaw_session");
  }

  private switchView(v: "logs" | "snapshots") {
    this.view = v;
    this.snapError = "";
    if (v === "snapshots") void this.refreshCurrentWindow();
  }

  private async submitLog() {
    this.error = "";
    this.loading = true;
    try {
      const { status, data } = await this.api("POST", "/api/logs", {
        turbine_code: this.turbineCode,
        yaw_err_deg: Number(this.yawErr),
      });
      if (![200, 201].includes(status)) {
        this.error = (data as { detail?: string })?.detail || "提交失败";
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

  // ---- 并网窗口 / 留影 ----

  private async openWindow() {
    this.snapError = "";
    const name = this.newWindowName.trim();
    if (!name) {
      this.snapError = "窗口名不能为空";
      return;
    }
    this.snapBusy = true;
    const { status, data } = await this.api("POST", "/api/windows", { name });
    this.snapBusy = false;
    if (status === 201) {
      this.newWindowName = "";
      await this.refreshCurrentWindow();
    } else {
      this.snapError = (data as { detail?: string })?.detail || "开窗失败";
    }
  }

  private async closeWindow() {
    if (!this.currentWindow) return;
    this.snapError = "";
    this.snapBusy = true;
    const { status, data } = await this.api(
      "POST",
      `/api/windows/${this.currentWindow.id}/close`
    );
    this.snapBusy = false;
    if (status === 200) {
      await this.refreshCurrentWindow();
    } else {
      this.snapError = (data as { detail?: string })?.detail || "关窗失败";
    }
  }

  private async takeSnapshot() {
    if (!this.currentWindow) return;
    this.snapError = "";
    this.snapBusy = true;
    const { status, data } = await this.api("POST", "/api/snapshots", {
      window_name: this.currentWindow.name,
    });
    this.snapBusy = false;
    if (status === 201) {
      const created = data as SnapshotDetail;
      await this.refreshCurrentWindow();
      await this.openSnapshot(created.header.id);
      if (this.historyKeyword.trim()) await this.searchHistory();
    } else {
      this.snapError = (data as { detail?: string })?.detail || "留影失败";
    }
  }

  private async searchHistory() {
    this.snapError = "";
    const keyword = this.historyKeyword.trim();
    if (!keyword) {
      this.snapError = "请填写窗口名再查询";
      return;
    }
    const { status, data } = await this.api(
      "GET",
      `/api/windows?name=${encodeURIComponent(keyword)}`
    );
    if (status === 200) {
      this.history = data as WindowRow[];
      this.historySearched = true;
    } else {
      this.snapError = (data as { detail?: string })?.detail || "查询失败";
    }
  }

  private async openSnapshot(id: number) {
    this.snapError = "";
    const { status, data } = await this.api("GET", `/api/snapshots/${id}`);
    if (status === 200) {
      this.detail = data as SnapshotDetail;
    } else {
      this.snapError = (data as { detail?: string })?.detail || "打开留影失败";
    }
  }

  private statusTagClass(status: string | null) {
    if (status === "done") return "ok";
    if (status === "processing") return "processing";
    if (status === "pending") return "pending";
    return "frozen";
  }

  private statusText(status: string | null) {
    return status ? STATUS_TEXT[status] ?? status : "已不存在";
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending") return "pending";
    if (row.status === "processing") return "processing";
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  private fmt(ts: string | null) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleString("zh-CN", { hour12: false });
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
      <div class="topbar">
        <h1>风机偏航对中台</h1>
        <button
          class="navbtn ${this.view === "logs" ? "active" : ""}"
          @click=${() => this.switchView("logs")}
        >
          对中记录
        </button>
        <button
          class="navbtn ${this.view === "snapshots" ? "active" : ""}"
          @click=${() => this.switchView("snapshots")}
        >
          并网窗在途留影
        </button>
        <span class="spacer"></span>
        <span class="who">
          ${this.session.username}（${this.isWriter ? "可写" : "观察 / 只读"}）
        </span>
        <button class="secondary" @click=${this.logout}>退出</button>
      </div>

      ${this.view === "logs" ? this.renderLogs() : this.renderSnapshots()}
    `;
  }

  private renderLogs() {
    return html`
      ${this.isWriter
        ? html`
            <section>
              <h2>提交偏航记录</h2>
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
        <div class="row-actions" style="margin-bottom:0.5rem;">
          <h2 style="margin:0;">对中记录</h2>
          <span class="spacer" style="flex:1;"></span>
          <button class="secondary" ?disabled=${this.loading} @click=${this.refreshLogs}>
            刷新列表
          </button>
        </div>
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
                    <span class="tag ${this.statusTagClass(row.status)}">
                      ${this.statusText(row.status)}
                    </span>
                  </td>
                  <td>
                    ${row.verdict
                      ? html`<span class="tag ${this.verdictClass(row)}">${row.verdict}</span>`
                      : "—"}
                  </td>
                  <td>${row.reason ?? "—"}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </section>
    `;
  }

  private renderSnapshots() {
    return html`
      <p class="sub">
        并网窗口开启期间，可写身份点「留影」即抄录当刻全部待办与在办单据；
        留影头与明细同事务落库，此后在线单据办结不改写旧留影。
      </p>
      ${this.renderZoneCurrent()}
      ${this.renderZoneHistory()}
      ${this.renderZoneDetail()}
    `;
  }

  // 分区一：当前窗口与留影操作
  private renderZoneCurrent() {
    const w = this.currentWindow;
    return html`
      <section>
        <h2><span class="zone-no">一区</span>当前并网窗口 · 在途留影</h2>
        ${w
          ? html`
              <p style="margin-top:0;">
                窗口名：<strong>${w.name}</strong>
                <span class="tag ok">开启中</span>
              </p>
              <p class="hint" style="margin-top:0;">
                开窗人 ${w.opened_by} · 开启于 ${this.fmt(w.opened_at)}
              </p>
              <div class="row-actions">
                ${this.isWriter
                  ? html`
                      <button
                        class="snap"
                        ?disabled=${this.snapBusy}
                        @click=${this.takeSnapshot}
                      >
                        留影（抄录当前待办+在办）
                      </button>
                      <button
                        class="secondary"
                        ?disabled=${this.snapBusy}
                        @click=${this.closeWindow}
                      >
                        关闭窗口
                      </button>
                    `
                  : html`<span class="hint">观察身份：可查阅留影，不可点留影。</span>`}
              </div>
            `
          : html`
              <p class="hint" style="margin-top:0;">当前没有开启中的并网窗口。</p>
              ${this.isWriter
                ? html`
                    <label>窗口名</label>
                    <div class="inline-input">
                      <input
                        placeholder="例如 2026-10 并网窗"
                        .value=${this.newWindowName}
                        @input=${(e: Event) =>
                          (this.newWindowName = (e.target as HTMLInputElement).value)}
                        @keydown=${(e: KeyboardEvent) =>
                          e.key === "Enter" ? this.openWindow() : null}
                      />
                      <button
                        ?disabled=${this.snapBusy}
                        @click=${this.openWindow}
                      >
                        开启窗口
                      </button>
                    </div>
                  `
                : html`<span class="hint">等待可写身份开启并网窗口。</span>`}
            `}
        ${this.snapError ? html`<p class="err">${this.snapError}</p>` : null}
      </section>
    `;
  }

  // 分区二：填窗口名查历史
  private renderZoneHistory() {
    return html`
      <section>
        <h2><span class="zone-no">二区</span>填窗口名查历史</h2>
        <div class="inline-input">
          <input
            placeholder="输入窗口名（支持模糊）"
            .value=${this.historyKeyword}
            @input=${(e: Event) =>
              (this.historyKeyword = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) =>
              e.key === "Enter" ? this.searchHistory() : null}
          />
          <button @click=${this.searchHistory}>查询</button>
        </div>
        ${this.historySearched && this.history.length === 0
          ? html`<p class="hint">未找到匹配窗口。</p>`
          : null}
        ${this.history.map(
          (w) => html`
            <div style="margin-top:0.75rem;">
              <strong>${w.name}</strong>
              <span class="tag ${w.status === "open" ? "ok" : "frozen"}">
                ${w.status === "open" ? "开启中" : "已关闭"}
              </span>
              <span class="hint">
                ${w.opened_by} 开 · 留影 ${w.snapshots.length} 份
              </span>
              ${w.snapshots.length === 0
                ? html`<p class="hint" style="margin:0.25rem 0 0;">该窗口暂无留影。</p>`
                : html`
                    <table style="margin-top:0.35rem;">
                      <thead>
                        <tr>
                          <th>留影编号</th>
                          <th>留影时间</th>
                          <th>笔数</th>
                          <th>留影人</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        ${w.snapshots.map(
                          (s) => html`
                            <tr>
                              <td>${s.id}</td>
                              <td>${this.fmt(s.created_at)}</td>
                              <td>${s.item_count}</td>
                              <td>${s.created_by}</td>
                              <td>
                                <span
                                  class="clickable"
                                  @click=${() => this.openSnapshot(s.id)}
                                >
                                  看明细
                                </span>
                              </td>
                            </tr>
                          `
                        )}
                      </tbody>
                    </table>
                  `}
            </div>
          `
        )}
      </section>
    `;
  }

  // 分区三：留影明细（冻结值 + 在线当前状态 + 分叉）
  private renderZoneDetail() {
    if (!this.detail) {
      return html`
        <section>
          <h2><span class="zone-no">三区</span>留影明细</h2>
          <p class="hint">从上方选择一份留影查看明细。</p>
        </section>
      `;
    }
    const h = this.detail.header;
    return html`
      <section>
        <h2>
          <span class="zone-no">三区</span>留影 #${h.id} 明细
          <span class="tag frozen">${h.window_name}</span>
          <span class="tag ${h.window_status === "open" ? "ok" : "frozen"}">
            ${h.window_status === "open" ? "窗口开启中" : "窗口已关闭"}
          </span>
        </h2>
        <p class="hint" style="margin-top:0;">
          留影人 ${h.created_by} · 留影于 ${this.fmt(h.created_at)} ·
          共 <strong>${h.item_count}</strong> 笔，下列均为当刻冻结抄录值。
        </p>
        <table>
          <thead>
            <tr>
              <th>单据编号</th>
              <th>机组</th>
              <th>偏航°</th>
              <th>留影状态（冻结）</th>
              <th>在线当前状态</th>
              <th>新旧分叉</th>
            </tr>
          </thead>
          <tbody>
            ${this.detail.items.map((it) => {
              const diverged = it.current_status !== it.status_frozen;
              return html`
                <tr class=${diverged ? "diverged" : ""}>
                  <td>${it.log_id}</td>
                  <td>${it.turbine_code}</td>
                  <td>${it.yaw_err_deg}</td>
                  <td>
                    <span class="tag ${this.statusTagClass(it.status_frozen)}">
                      ${this.statusText(it.status_frozen)}
                    </span>
                  </td>
                  <td>
                    <span class="tag ${this.statusTagClass(it.current_status)}">
                      ${this.statusText(it.current_status)}
                    </span>
                    ${it.current_verdict ? html`（${it.current_verdict}）` : null}
                  </td>
                  <td>
                    ${diverged
                      ? html`<span class="tag fork">已分叉</span>`
                      : html`<span class="hint">一致</span>`}
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
