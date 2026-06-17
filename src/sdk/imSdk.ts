// IMClient —— Web 端协议 SDK（对应 iOS 的 IMSocketManager）。
// 职责：登录换 token、WebSocket 连接、收发、心跳、重连、增量同步、回执；不含任何 UI。
// 默认走同源相对路径（开发期由 Vite 代理到后端，见 vite.config.ts）。

import { T, type Envelope, type ChatMessage, type Conversation, type UserCard, type FriendEntry, type MyProfile } from "./protocol";
import * as localStore from "./localStore";

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
  /** 好友关系变更（申请/同意/拒绝/拉黑/删除）：提示刷新通讯录。 */
  onFriend?: (event: string, from: string) => void;
}

export class IMClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private uid = "";
  private password = ""; // 登录密码（为空=开发期免密直签）；仅用于（重）连时换 token
  private token = ""; // 登录后保存，供 HTTP API（会话列表等）带 Bearer
  private state: ConnState = "disconnected";
  private pingTimer: number | null = null;
  private reconnectAttempts = 0;
  private manualClose = false;
  private syncedSeq = new Map<string, number>(); // convId -> 已同步到的最大 conv_seq
  private tracked = new Set<string>(); // 重连后需增量同步的会话
  private pagedPending = new Set<string>(); // 正在分页加载的会话（抑制 has_more 自动向前翻页）
  private pendingSends = new Map<string, { convId: string; content: string; timestamp: number }>(); // client_msg_id -> 待确认发送（ack 后落库）
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

  /** 连接：先登录换 token，再用 ?token= 连 ws。password 为空走开发期免密直签。
   *  首次登录失败（如密码错误）会抛错给调用方显示；之后的断线重连仍静默重试。 */
  async connect(uid: string, password = ""): Promise<void> {
    this.uid = uid;
    this.password = password;
    this.manualClose = false;
    await this.openSocket(true);
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

  /** 带 Bearer 的 HTTP 调用，统一解析 errcode 信封（code!=0 抛错）。 */
  private async api(path: string, init?: RequestInit): Promise<any> {
    const body = await fetchJSON(path, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
    });
    if (body.code !== 0) throw new Error(friendlyMessage(body.code, body.message));
    return body.data;
  }

  /** 找人：按 q 搜索用户（昵称/手机号/uid/标签，后端去 phone、排除自己）。 */
  async searchUsers(q: string, limit = 20): Promise<UserCard[]> {
    const data = await this.api(`/api/v1/users/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    return (data?.users ?? []) as UserCard[];
  }

  /** 好友/申请列表（status 为空=全部：accepted/pending/requested/blocked）。 */
  async listFriends(status = ""): Promise<FriendEntry[]> {
    const data = await this.api(`/api/v1/friends${status ? `?status=${encodeURIComponent(status)}` : ""}`);
    return (data?.friends ?? []) as FriendEntry[];
  }

  /** 好友动作（申请/同意/拒绝/拉黑/解黑）：POST /api/v1/friends/{action} body {user_id}。 */
  async friendAction(action: "request" | "accept" | "reject" | "block" | "unblock", userId: string): Promise<void> {
    await this.api(`/api/v1/friends/${action}`, { method: "POST", body: JSON.stringify({ user_id: userId }) });
  }

  /** 删除好友：DELETE /api/v1/friends/{id}。 */
  async removeFriend(userId: string): Promise<void> {
    await this.api(`/api/v1/friends/${encodeURIComponent(userId)}`, { method: "DELETE" });
  }

  /** 读取本人资料（含 phone）：GET /api/v1/users/me。 */
  async fetchMyProfile(): Promise<MyProfile> {
    const data = await this.api("/api/v1/users/me");
    return data as MyProfile;
  }

  /** 整体更新本人资料（PUT 语义）：PUT /api/v1/users/me。 */
  async updateMyProfile(p: { nickname: string; avatar_url: string; phone: string; tags: string[] }): Promise<MyProfile> {
    const data = await this.api("/api/v1/users/me", { method: "PUT", body: JSON.stringify(p) });
    return data as MyProfile;
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
    this.pendingSends.set(clientMsgId, { convId, content, timestamp: Date.now() }); // ack 后落库
    const env: Envelope = {
      type: T.SEND_MSG,
      seq: ++this.seq,
      data: { client_msg_id: clientMsgId, conv_id: convId, to, content_type: "text", content },
    };
    this.send(env);
    return clientMsgId;
  }

  // ---- 内部 ----

  private async openSocket(throwOnLoginError = false): Promise<void> {
    this.setState("connecting");
    let token: string;
    try {
      token = await this.fetchToken();
      this.token = token;
    } catch (e) {
      this.setState("disconnected");
      if (throwOnLoginError) throw e; // 首次登录失败 → 交 UI 显示（密码错误等）
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

  /** POST /api/v1/login 换 token。带 password=真账号登录；password 空=开发期免密直签。失败抛带服务端文案的 Error。 */
  private async fetchToken(): Promise<string> {
    const body = await fetchJSON("/api/v1/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.uid, password: this.password }),
    });
    if (body.code !== 0 || !body.data?.token) {
      throw new Error(friendlyMessage(body.code, body.message || "登录失败"));
    }
    return body.data.token as string;
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
      case T.ACK: {
        this.updateSynced(d.conv_id, d.conv_seq);
        // 自己发的消息（本端不会再经 new_msg 回显）→ ack 拿到 conv_seq 后落库，刷新后仍在。
        const pend = this.pendingSends.get(d.client_msg_id);
        if (pend && d.conv_seq > 0) {
          void localStore.saveMessage(this.uid, {
            convId: pend.convId, from: this.uid, content: pend.content, contentType: "text",
            convSeq: d.conv_seq, timestamp: pend.timestamp, status: "sent",
          });
          this.pendingSends.delete(d.client_msg_id);
        }
        this.handlers.onAck?.(d.client_msg_id, true, d.conv_seq);
        break;
      }
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
      case T.FRIEND:
        this.handlers.onFriend?.(d.event, d.from);
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
    // 离线空洞自愈：conv_seq 由服务端连续分配，若收到的序号跳过了已同步位点之后的中间段，
    // 说明中间有未拉到的（离线）消息 → 先用当前（较低）位点 since 补拉缺口，
    // 避免这条实时消息把 synced 推过空洞、造成中间几条被永久漏掉。
    const prevSynced = this.syncedSeq.get(msg.convId) ?? 0;
    if (shouldHealGap(prevSynced, msg.convSeq, this.tracked.has(msg.convId))) {
      this.sendSyncReq([msg.convId]); // since=prevSynced（此刻尚未 update）→ 拉回 [prevSynced+1 .. ]
    }
    this.updateSynced(msg.convId, msg.convSeq);
    this.sendReceipt(msg.convId, msg.convSeq);
    void localStore.saveMessage(this.uid, msg); // 收到/同步到的消息落本地库
    this.handlers.onMessage?.(msg);
  }

  /** 读取某会话的本地持久化消息（IndexedDB），供 UI 启动时秒载。 */
  loadLocal(convId: string): Promise<ChatMessage[]> {
    return localStore.loadConversation(this.uid, convId);
  }

  /** 登记会话用于（重）连后增量同步，并把同步基线设为 max(现有, syncedSeq)。
   *  syncedSeq 传本地已落库的最大 conv_seq → 重连/刷新只补更新的消息，不重拉历史。 */
  trackConversation(convId: string, syncedSeq: number): void {
    if (!convId) return;
    this.tracked.add(convId);
    if (syncedSeq > (this.syncedSeq.get(convId) ?? 0)) this.syncedSeq.set(convId, syncedSeq);
  }

  /** 对所有已登记会话发一次增量同步（从各自基线补新消息）。 */
  syncTracked(): void {
    this.sendSyncReq([...this.tracked]);
  }

  /** 缓存 / 读取会话列表（localStorage，按本人 uid 隔离）。 */
  cacheConversations(convs: Conversation[]): void {
    localStore.saveConversations(this.uid, convs);
  }
  cachedConversations(): Conversation[] {
    return localStore.loadConversations(this.uid);
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

/** 离线空洞自愈判定（纯函数，导出供单测）：实时/同步消息的 conv_seq 跳过了"已同步位点+1"，
 *  且该会话在跟踪中、且非初始(prevSynced>0) → 需补拉缺口。 */
export function shouldHealGap(prevSynced: number, incomingConvSeq: number, tracked: boolean): boolean {
  return tracked && prevSynced > 0 && incomingConvSeq > prevSynced + 1;
}

/** 注册账号：POST /api/v1/register {username, password}。成功 resolve，失败抛带服务端文案的 Error。
 *  独立于连接（注册时还没建 IMClient/socket），故为模块级函数。 */
export async function registerAccount(username: string, password: string): Promise<void> {
  const body = await fetchJSON("/api/v1/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (body.code !== 0) {
    throw new Error(friendlyMessage(body.code, body.message || "注册失败"));
  }
}

/** fetch + 解析 JSON，把"连不上 / 空响应"这类传输层失败转成友好中文（区别于业务错误码）。 */
async function fetchJSON(path: string, init?: RequestInit): Promise<any> {
  let resp: Response;
  try {
    resp = await fetch(path, init);
  } catch {
    throw new Error("无法连接服务器，请确认后端已启动"); // fetch reject：网络/连接失败
  }
  try {
    return await resp.json();
  } catch {
    throw new Error("服务器无响应，请确认后端已启动"); // 空/非 JSON：原"Unexpected end of JSON input"
  }
}

/** 业务错误码 → 友好中文（对齐 errcode / iOS IMFriendlyMessageForCode）。未收录回退服务端原文。
 *  隐私：被拉黑/密码错误等用模糊文案，不暴露"你被对方拉黑了"。导出供单测。 */
export function friendlyMessage(code: number, fallback: string): string {
  const map: Record<number, string> = {
    100101: "登录已失效，请重新登录",
    100102: "登录已失效，请重新登录",
    200001: "用户不存在",
    200002: "密码错误",
    200003: "账号已被封禁",
    200004: "用户名已被注册",
    200101: "你们已经是好友了",
    200102: "暂时无法添加对方为好友", // 被拉黑：不暴露
    200103: "对方不是你的好友",
    200104: "不能添加自己为好友",
    200105: "申请已发出，等待对方同意",
    200106: "没有待处理的好友申请",
  };
  return map[code] || fallback || `请求失败(${code})`;
}
