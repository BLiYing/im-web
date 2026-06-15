// IMClient —— Web 端协议 SDK（对应 iOS 的 IMSocketManager）。
// 职责：登录换 token、WebSocket 连接、收发、心跳、重连、增量同步、回执；不含任何 UI。
// 默认走同源相对路径（开发期由 Vite 代理到后端，见 vite.config.ts）。

import { T, type Envelope, type ChatMessage, type Conversation } from "./protocol";

const PING_INTERVAL_MS = 25_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export type ConnState = "disconnected" | "connecting" | "connected";

export interface IMClientHandlers {
  onState?: (state: ConnState) => void;
  onMessage?: (msg: ChatMessage) => void;
  /** 发送结果：成功时带 server 分配的 convSeq。 */
  onAck?: (clientMsgId: string, ok: boolean, convSeq: number) => void;
  /** 对端回执：from 已读/送达到 upToSeq（用于已读双勾）。 */
  onReceipt?: (convId: string, from: string, status: string, upToSeq: number) => void;
  /** 在线状态变化：某用户上线/离线。 */
  onPresence?: (user: string, status: string) => void;
  /** 对端正在输入。 */
  onTyping?: (convId: string, from: string) => void;
}

export class IMClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private uid = "";
  private token = ""; // 登录后保存，供 HTTP API（会话列表等）带 Bearer
  private state: ConnState = "disconnected";
  private pingTimer: number | null = null;
  private reconnectAttempts = 0;
  private manualClose = false;
  private syncedSeq = new Map<string, number>(); // convId -> 已同步到的最大 conv_seq
  private tracked = new Set<string>(); // 重连后需增量同步的会话
  private pagedPending = new Set<string>(); // 正在分页加载的会话（抑制 has_more 自动向前翻页）
  private readonly historyPage = 200; // 每页历史条数（与服务端 syncPageLimit 对齐）
  private readonly contextBefore = 10; // 进会话时未读分割线上方保留的已读上下文条数
  private handlers: IMClientHandlers;

  constructor(handlers: IMClientHandlers = {}) {
    this.handlers = handlers;
  }

  get currentState(): ConnState {
    return this.state;
  }
  get userId(): string {
    return this.uid;
  }

  /** 连接：先登录换 token，再用 ?token= 连 ws。 */
  async connect(uid: string): Promise<void> {
    this.uid = uid;
    this.manualClose = false;
    await this.openSocket();
  }

  disconnect(): void {
    this.manualClose = true;
    this.stopPing();
    this.ws?.close(1000);
    this.ws = null;
    this.setState("disconnected");
  }

  /** 拉取当前用户的会话列表（GET /api/v1/conversations，带 Bearer token）。 */
  async fetchConversations(): Promise<Conversation[]> {
    const resp = await fetch("/api/v1/conversations", {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const body = await resp.json();
    if (body.code !== 0) throw new Error(body.message || "fetch conversations failed");
    return (body.data?.conversations ?? []) as Conversation[];
  }

  /** 进会话：建立重连基线 + 加载初始可视窗口（见 CHAT_UX §3）。
   *  - 有未读（latestSeq>readSeq）：从 readSeq-上下文 起一页，锚定到首条未读；
   *  - 无未读：加载最近一页，贴底。
   *  reconnect 基线设为 latestSeq（增量补偿只取更新的消息；中间历史靠分页加载）。 */
  openConversation(convId: string, readSeq: number, latestSeq: number): void {
    if (!convId) return;
    this.tracked.add(convId);
    this.syncedSeq.set(convId, latestSeq);
    const since =
      latestSeq > readSeq
        ? Math.max(0, readSeq - this.contextBefore) // 有未读 → 锚到首条未读附近
        : Math.max(0, latestSeq - this.historyPage); // 无未读 → 最近一页
    this.requestPage(convId, since);
  }

  /** 加载 oldestSeq 之前的一页（上滚到顶触发）。 */
  loadOlder(convId: string, oldestSeq: number): void {
    if (!convId || oldestSeq <= 1) return;
    this.requestPage(convId, Math.max(0, oldestSeq - 1 - this.historyPage)); // [oldestSeq-页 .. oldestSeq-1]
  }

  /** 加载 newestSeq 之后的一页（下滚到底、且还没到 latest 时触发）。 */
  loadNewer(convId: string, newestSeq: number): void {
    if (!convId) return;
    this.requestPage(convId, newestSeq); // [newestSeq+1 .. newestSeq+页]
  }

  /** 发一页分页请求：指定游标、单页、不自动向前翻页（由 SYNC_RESP 的 pagedPending 抑制）。 */
  private requestPage(convId: string, since: number): void {
    this.pagedPending.add(convId);
    this.send({ type: T.SYNC_REQ, seq: ++this.seq, data: { cursors: [{ conv_id: convId, since_conv_seq: since }] } });
  }

  /** 发送文本，返回 client_msg_id。 */
  sendText(content: string, to: string, convId: string): string {
    const clientMsgId = crypto.randomUUID();
    const env: Envelope = {
      type: T.SEND_MSG,
      seq: ++this.seq,
      data: { client_msg_id: clientMsgId, conv_id: convId, to, content_type: "text", content },
    };
    this.send(env);
    return clientMsgId;
  }

  // ---- 内部 ----

  private async openSocket(): Promise<void> {
    this.setState("connecting");
    let token: string;
    try {
      const resp = await fetch("/api/v1/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: this.uid }),
      });
      const body = await resp.json();
      if (body.code !== 0 || !body.data?.token) {
        throw new Error(body.message || "login failed");
      }
      token = body.data.token;
      this.token = token;
    } catch (e) {
      if (!this.manualClose) this.scheduleReconnect();
      return;
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.startPing();
      this.sendSyncReq([...this.tracked]); // 重连补偿
    };
    ws.onmessage = (ev) => this.onFrame(ev.data);
    ws.onclose = () => {
      this.stopPing();
      this.setState("disconnected");
      if (!this.manualClose) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private onFrame(raw: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(raw);
    } catch {
      return;
    }
    const d = env.data || {};
    switch (env.type) {
      case T.ACK:
        this.updateSynced(d.conv_id, d.conv_seq);
        this.handlers.onAck?.(d.client_msg_id, true, d.conv_seq);
        break;
      case T.NEW_MSG:
        this.processIncoming(d);
        break;
      case T.SYNC_RESP:
        for (const conv of d.conversations || []) {
          const isPaged = conv.conv_id && this.pagedPending.has(conv.conv_id);
          for (const m of conv.messages || []) this.processIncoming(m);
          if (isPaged) {
            this.pagedPending.delete(conv.conv_id); // 分页：单页，不自动向前翻页
          } else if (conv.has_more && conv.conv_id) {
            this.sendSyncReq([conv.conv_id]); // 重连增量：继续翻到最新
          }
        }
        break;
      case T.RECEIPT:
        this.handlers.onReceipt?.(d.conv_id, d.from, d.status, d.up_to_conv_seq);
        break;
      case T.PRESENCE:
        this.handlers.onPresence?.(d.user, d.status);
        break;
      case T.TYPING:
        this.handlers.onTyping?.(d.conv_id, d.from);
        break;
      case T.PONG:
        break;
      case T.ERROR:
        // 业务错误：code/message（见 errcode）。此处简单忽略，UI 可订阅扩展。
        break;
    }
  }

  private processIncoming(d: any): void {
    const msg: ChatMessage = {
      serverMsgId: d.server_msg_id,
      convId: d.conv_id,
      from: d.from,
      content: typeof d.content === "string" ? d.content : "",
      contentType: d.content_type || "text",
      convSeq: d.conv_seq || 0,
      timestamp: d.timestamp || 0,
      status: "received",
    };
    this.updateSynced(msg.convId, msg.convSeq);
    this.sendReceipt(msg.convId, msg.convSeq);
    this.handlers.onMessage?.(msg);
  }

  /** 发送"正在输入"给会话对端（临时态）。 */
  sendTyping(convId: string): void {
    if (convId) this.send({ type: T.TYPING, data: { conv_id: convId } });
  }

  /** 上报已读到 upToSeq（对端据此显示已读双勾）。 */
  markRead(convId: string, upToSeq: number): void {
    if (convId && upToSeq > 0) {
      this.send({ type: T.RECEIPT, data: { conv_id: convId, status: "read", up_to_conv_seq: upToSeq } });
    }
  }

  private sendReceipt(convId: string, upTo: number): void {
    if (!convId) return;
    this.send({ type: T.RECEIPT, data: { conv_id: convId, status: "delivered", up_to_conv_seq: upTo } });
  }

  private sendSyncReq(convIds: string[]): void {
    const cursors = convIds.map((c) => ({ conv_id: c, since_conv_seq: this.syncedSeq.get(c) ?? 0 }));
    if (cursors.length === 0) return;
    this.send({ type: T.SYNC_REQ, seq: ++this.seq, data: { cursors } });
  }

  private updateSynced(convId: string, seq: number): void {
    if (!convId || !seq) return;
    if (seq > (this.syncedSeq.get(convId) ?? 0)) this.syncedSeq.set(convId, seq);
  }

  private send(env: Envelope): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(env));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => this.send({ type: T.PING, seq: ++this.seq }), PING_INTERVAL_MS);
  }
  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    window.setTimeout(() => {
      if (!this.manualClose) void this.openSocket();
    }, delay);
  }

  private setState(s: ConnState): void {
    if (this.state === s) return;
    this.state = s;
    this.handlers.onState?.(s);
  }
}
