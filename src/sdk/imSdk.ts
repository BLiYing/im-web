// IMClient —— Web 端协议 SDK（对应 iOS 的 IMSocketManager）。
// 职责：登录换 token、WebSocket 连接、收发、心跳、重连、增量同步、回执；不含任何 UI。
// 默认走同源相对路径（开发期由 Vite 代理到后端，见 vite.config.ts）。

import { T, OP, type Envelope, type ChatMessage, type Conversation, type ConvUpdate, type UserCard, type FriendEntry, type MyProfile, type GroupInfo, type GroupSummary, type MsgOpPatch, type Favorite } from "./protocol";
import { presenceFromFrame, type Presence } from "./presence";
import * as localStore from "./localStore";
import { LOG_TAG, logger } from "../logging/logger";
import { tracedFetch, tracedUpload, type UploadProgressHandler } from "./http";
import { startChunkedUpload, CHUNKED_THRESHOLD } from "./chunkedUpload";

const PING_INTERVAL_MS = 25_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const SEND_TIMEOUT_MS = 10_000; // 发出后多久没收到 ack 即判定"发送失败"（断网/发不出去）

export type ConnState = "disconnected" | "connecting" | "connected";

/** 富媒体发送选项。mediaW/mediaH/duration/fileSize 为 M4+ 媒体元数据（PROTOCOL §4.1），
 *  由**发送端量出**：收端据此按原比例预留气泡、显视频时长角标、算上传进度分母。 */
export interface MediaSendOptions {
  forwardFrom?: string;
  groupId?: string;
  poster?: string;
  fileName?: string;
  fileSize?: number;
  mediaW?: number;
  mediaH?: number;
  /** 视频时长（毫秒）。 */
  duration?: number;
}

export interface IMClientHandlers {
  onState?: (state: ConnState) => void;
  onMessage?: (msg: ChatMessage) => void;
  /** 发送结果：成功时带 server 分配的 convSeq。 */
  onAck?: (clientMsgId: string, ok: boolean, convSeq: number, serverTs?: number) => void;
  /** 对端回执：from 已读/送达到 upToSeq（用于已读双勾）。 */
  onReceipt?: (convId: string, from: string, status: string, upToSeq: number) => void;
  /** 某用户上线。presence 只报**变化**，初始值须由 HTTP 快照提供（会话列表 peer_presence）；
   *  服务端不推下线，靠 presence.onlineUntil 到期本地降级（见 sdk/presence.ts）。 */
  onPresence?: (user: string, presence: Presence) => void;
  /** 对端正在输入。 */
  onTyping?: (convId: string, from: string) => void;
  /** 好友关系变更（申请/同意/拒绝/拉黑/删除）：提示刷新通讯录。 */
  onFriend?: (event: string, from: string) => void;
  /** 群成员/资料变更（invite/leave/remove/role/transfer/profile）：提示刷新该群与会话列表。 */
  onGroup?: (event: string, convId: string, from: string, target: string) => void;
  /** 鉴权失效（账号不存在/密码错/被封/token 失效）：会话已失效，应退回登录页（而非无限重连）。 */
  onAuthError?: (msg: string) => void;
  /** 某条消息被服务端拒收（如被拉黑）：把该 client_msg_id 标记为发送失败并提示原因。
   *  code 为服务端业务码（200102 被拉黑 / 200103 非好友 …），UI 据此决定是否给恢复入口。 */
  onMsgRejected?: (clientMsgId: string, msg: string, code: number) => void;
  /** 消息操作（撤回/编辑/置顶）应用到某条消息：UI 据 patch 更新该条（convSeq 定位）。 */
  onMsgOp?: (convId: string, targetConvSeq: number, patch: MsgOpPatch) => void;
  /** 我发起的消息操作被拒（如撤回超时 300008）：回滚提示。 */
  onMsgOpFailed?: (op: string, convId: string, targetConvSeq: number, msg: string) => void;
  /** 会话级设置变更（置顶/免打扰/标未读/删除会话，M4.5）：多端同步，UI 据完整状态覆盖本地会话列表。 */
  onConvUpdate?: (u: ConvUpdate) => void;
}

/** 是否"鉴权失败"类错误码（对齐 errcode / iOS IMIsAuthErrorCode）→ 退回登录，而非当网络问题重试。 */
function isAuthCode(code: number | undefined): boolean {
  return code === 200001 || code === 200002 || code === 200003 || code === 100101 || code === 100102;
}

export class IMClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private uid = "";
  private password = ""; // 登录密码（为空=开发期免密直签）；仅用于（重）连时换 token
  private token = ""; // 登录后保存，供 HTTP API（会话列表等）带 Bearer
  private state: ConnState = "disconnected";
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private connectionGeneration = 0; // 使切账号/新重连之前仍在途的登录与 socket 回调失效
  private manualClose = false;
  private syncedSeq = new Map<string, number>(); // convId -> 已连续接上的 conv_seq（不能用“见过的最大值”越过空洞）
  private tracked = new Set<string>(); // 重连后需增量同步的会话
  private syncingConvs = new Set<string>(); // 正在断线补偿/空洞自愈，避免连发消息触发重复 sync_req
  private syncPending = new Map<number, string[]>(); // request seq -> convIds；响应/错误时精确释放 in-flight
  private pagedPending = new Set<number>(); // 聊天历史单页请求 seq；与自动补偿请求严格区分
  private pendingSends = new Map<string, { convId: string; content: string; contentType: string; timestamp: number; fileName?: string; fileSize?: number; replyToConvSeq?: number; replySnapshot?: string; replyToFrom?: string; forwardFrom?: string; groupId?: string; poster?: string; mediaW?: number; mediaH?: number; duration?: number }>(); // client_msg_id -> 待确认发送（ack 后落库）
  private pendingOps = new Map<string, { op: string; convId: string; targetConvSeq: number }>(); // client_msg_id -> 待确认的消息操作（撤回/编辑/置顶），供失败回滚
  private sendTimers = new Map<string, number>(); // client_msg_id -> 发送超时计时器（超时未 ack → 标失败）
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
    if (this.uid && this.uid !== uid) {
      // IMClient 是可复用 SDK；切换账号时绝不能沿用上个 uid 的会话游标。
      this.syncedSeq.clear();
      this.tracked.clear();
      this.syncingConvs.clear();
      this.syncPending.clear();
      this.pagedPending.clear();
      this.pendingOps.clear();
      this.sendTimers.forEach((timer) => clearTimeout(timer));
      this.sendTimers.clear();
      this.pendingSends.clear();
      this.token = "";
    }
    this.uid = uid;
    this.password = password;
    this.manualClose = false;
    this.clearReconnectTimer();
    logger.info(LOG_TAG.ws, "connect_requested", { user_id: uid });
    await this.openSocket(true);
  }

  disconnect(): void {
    logger.info(LOG_TAG.ws, "disconnect_requested", { user_id: this.uid });
    this.manualClose = true;
    this.connectionGeneration++;
    this.stopPing();
    this.clearReconnectTimer();
    this.sendTimers.forEach((t) => clearTimeout(t)); // 退出后别再触发"发送失败"回调
    this.sendTimers.clear();
    this.pendingSends.clear();
    this.syncedSeq.clear();
    this.tracked.clear();
    this.syncingConvs.clear();
    this.syncPending.clear();
    this.pagedPending.clear();
    this.pendingOps.clear();
    this.ws?.close(1000);
    this.ws = null;
    this.setState("disconnected");
  }

  /** 拉取当前用户的会话列表（GET /api/v1/conversations，带 Bearer token）。 */
  async fetchConversations(): Promise<Conversation[]> {
    const resp = await tracedFetch("/api/v1/conversations", {
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

  /** 链接富预览：抓取 URL 的 OG 元信息（后端带 SSRF 防护 + 缓存）。失败抛错，调用方回退纯链接。 */
  async linkPreview(url: string): Promise<{ url: string; title?: string; description?: string; image?: string; site_name?: string }> {
    return await this.api(`/api/v1/link-preview?url=${encodeURIComponent(url)}`);
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

  /**
   * 发好友申请：POST /api/v1/friends/request。
   * 返回 true 表示**已直接成为好友、无需对方确认**（对方先申请过我；或我曾单向删除对方而对方仍视我为好友）。
   * 调用方据此**不要提示「已发送好友申请」**——那会让用户误以为还要等对方通过；刷新界面即可。
   */
  async requestFriend(userId: string): Promise<boolean> {
    const r = await this.api(`/api/v1/friends/request`, { method: "POST", body: JSON.stringify({ user_id: userId }) });
    return (r as { outcome?: string } | undefined)?.outcome === "accepted";
  }

  /** 删除好友：DELETE /api/v1/friends/{id}。 */
  async removeFriend(userId: string): Promise<void> {
    await this.api(`/api/v1/friends/${encodeURIComponent(userId)}`, { method: "DELETE" });
  }

  /** 设置好友备注名（空串=清除）：POST /api/v1/friends/remark。 */
  async setRemark(userId: string, remark: string): Promise<void> {
    await this.api(`/api/v1/friends/remark`, { method: "POST", body: JSON.stringify({ user_id: userId, remark }) });
  }

  // ---- 会话管理（M4.5）----

  /** 更新会话级设置（置顶/免打扰/标未读，整体替换）：PUT /api/v1/conversations/{id}/settings。 */
  async updateConvSettings(convId: string, s: { pinned_at: number; muted: boolean; marked_unread: boolean }): Promise<void> {
    await this.api(`/api/v1/conversations/${encodeURIComponent(convId)}/settings`, { method: "PUT", body: JSON.stringify(s) });
  }

  /** 删除会话（仅本人，记 cleared_at 不删消息）：DELETE /api/v1/conversations/{id}。 */
  async deleteConversation(convId: string): Promise<void> {
    await this.api(`/api/v1/conversations/${encodeURIComponent(convId)}`, { method: "DELETE" });
  }

  // ---- 群聊（M3）----

  /** 建群：owner=自己，memberIds=初始成员。返回群资料+成员。 */
  async createGroup(name: string, memberIds: string[], avatarUrl = ""): Promise<GroupInfo> {
    return (await this.api("/api/v1/groups", {
      method: "POST",
      body: JSON.stringify({ name, avatar_url: avatarUrl, member_ids: memberIds }),
    })) as GroupInfo;
  }

  /** 我的群列表。 */
  async listGroups(): Promise<GroupSummary[]> {
    const data = await this.api("/api/v1/groups");
    return (data?.groups ?? []) as GroupSummary[];
  }

  /** 群资料 + 成员（须为群成员）。 */
  async fetchGroup(convId: string): Promise<GroupInfo> {
    return (await this.api(`/api/v1/groups/${encodeURIComponent(convId)}`)) as GroupInfo;
  }

  /** 改群资料（群主/管理员）。 */
  async updateGroup(convId: string, name: string, avatarUrl: string): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}`, {
      method: "PUT", body: JSON.stringify({ name, avatar_url: avatarUrl }),
    });
  }

  /** 邀请入群（任意成员可邀）。 */
  async inviteToGroup(convId: string, memberIds: string[]): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/members`, {
      method: "POST", body: JSON.stringify({ member_ids: memberIds }),
    });
  }

  /** 退群（群主须先转让）。 */
  async leaveGroup(convId: string): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/members/me`, { method: "DELETE" });
  }

  /** 解散群（仅群主）：DELETE /api/v1/groups/{id} → 广播 dissolve，全体退群。 */
  async dissolveGroup(convId: string): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}`, { method: "DELETE" });
  }

  /** 移除成员（须权限高于对方）。 */
  async removeGroupMember(convId: string, userId: string): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
  }

  /** 设/撤管理员（仅群主）：role=admin|member。 */
  async setGroupRole(convId: string, userId: string, role: "admin" | "member"): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/members/${encodeURIComponent(userId)}/role`, {
      method: "PUT", body: JSON.stringify({ role }),
    });
  }

  /** 转让群主（仅群主；原群主降为普通成员）。 */
  async transferGroup(convId: string, userId: string): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/transfer`, {
      method: "POST", body: JSON.stringify({ user_id: userId }),
    });
  }

  // ---- 收藏（M4-4）----

  /** 收藏一条内容（快照）：POST /api/v1/favorites。 */
  async addFavorite(f: { content_type?: string; content: string; source_conv_id?: string; source_conv_seq?: number; source_from?: string }): Promise<void> {
    await this.api("/api/v1/favorites", { method: "POST", body: JSON.stringify(f) });
  }
  /** 我的收藏列表：GET /api/v1/favorites。 */
  async listFavorites(): Promise<Favorite[]> {
    const data = await this.api("/api/v1/favorites");
    return (data?.favorites ?? []) as Favorite[];
  }
  /** 删除收藏：DELETE /api/v1/favorites/{id}。 */
  async deleteFavorite(id: number): Promise<void> {
    await this.api(`/api/v1/favorites/${id}`, { method: "DELETE" });
  }

  /** 翻译文本（M4-5）：POST /api/v1/translate → 译文（服务端代理 + 缓存）。 */
  async translate(text: string, targetLang = "zh"): Promise<string> {
    const data = await this.api("/api/v1/translate", { method: "POST", body: JSON.stringify({ text, target_lang: targetLang }) });
    return (data?.translation ?? "") as string;
  }

  /** 举报（AG）：POST /api/v1/reports。targetType=message|user|group。 */
  async report(targetType: "message" | "user" | "group", targetId: string, reason: string, convId = ""): Promise<void> {
    await this.api("/api/v1/reports", {
      method: "POST",
      body: JSON.stringify({ target_type: targetType, target_id: targetId, conv_id: convId, reason }),
    });
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
   *  latestSeq 仅用于选择 UI 首屏窗口，不代表此前消息已经连续持久化。 */
  openConversation(convId: string, readSeq: number, latestSeq: number): void {
    if (!convId) return;
    const newlyTracked = !this.tracked.has(convId);
    this.tracked.add(convId);
    if (!this.syncedSeq.has(convId)) this.syncedSeq.set(convId, 0);
    if (newlyTracked) this.sendSyncReq([convId]);
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
    if (!this.isSocketOpen()) return;
    const requestSeq = ++this.seq;
    this.pagedPending.add(requestSeq);
    this.send({ type: T.SYNC_REQ, seq: requestSeq, data: { cursors: [{ conv_id: convId, since_conv_seq: since }] } });
  }

  /** 发送文本，返回 client_msg_id。opts.replyTo=引用回复（M4-2）；opts.forwardFrom=转发溯源（M4-3）。 */
  sendText(content: string, to: string, convId: string, opts?: { replyTo?: { convSeq: number; preview: string; from?: string }; forwardFrom?: string }): string {
    return this.sendContent(content, "text", to, convId, opts);
  }

  /** 发送富媒体（图片/文件，M4-6）：content=已上传的 URL，contentType=image|video|file。
   *  opts.forwardFrom=转发溯源；opts.groupId=相册分组；opts.poster=视频封面首帧 URL（M4+，收端直显免解码）。 */
  sendMedia(url: string, contentType: string, to: string, convId: string, opts?: MediaSendOptions): string {
    return this.sendContent(url, contentType, to, convId, opts);
  }

  /** 上传图片/文件（M4-6）：multipart → {url, contentType, size}。
   *  onProgress 非空时走 XHR（fetch 拿不到上行进度），回调的 sent/total 是**请求体**字节数。 */
  /**
   * 上传文件：≥8MB 走分片（init/chunk/status/complete，可经 chunkedTaskFor(key) 暂停/继续/取消，
   * 断网自动退避续传、上传会话过期自动换会话重传——与 iOS 同一套语义）；小文件一次性 multipart。
   * key 建议传消息的 localId，气泡的 ⏸/↑/✕ 才能定位到任务；不传则不可暂停。
   */
  async uploadFile(file: File, onProgress?: UploadProgressHandler, key?: string): Promise<{ url: string; contentType: string; size: number }> {
    if (file.size >= CHUNKED_THRESHOLD) {
      // onProgress 与 startChunkedUpload 的进度回调签名一致，直接透传（无需包一层 identity lambda）。
      return startChunkedUpload(file, this.token, key ?? crypto.randomUUID(), onProgress);
    }
    const fd = new FormData();
    fd.append("file", file);
    const auth = { Authorization: `Bearer ${this.token}` };
    let body: { code: number; message?: string; data: Record<string, unknown> };
    if (onProgress) {
      const { text } = await tracedUpload("/api/v1/upload", fd, { headers: auth, onProgress });
      // 代理/网关可能回非 JSON（502 的 HTML 等）：与 fetch 分支一样降级成统一错误，别把解析异常抛给用户。
      try { body = JSON.parse(text || "{}"); } catch { body = { code: -1, data: {} }; }
    } else {
      const resp = await tracedFetch("/api/v1/upload", { method: "POST", headers: auth, body: fd });
      body = await resp.json().catch(() => ({ code: -1, data: {} }));
    }
    if (body.code !== 0 || !body.data) throw new Error(friendlyMessage(body.code, body.message || "上传失败"));
    const serverSize = Number(body.data.size);
    return {
      url: body.data.url as string,
      contentType: body.data.content_type as string,
      size: Number.isFinite(serverSize) && serverSize > 0 ? serverSize : file.size,
    };
  }

  /** 共用发送通道：content + content_type + 可选引用/转发。 */
  private sendContent(content: string, contentType: string, to: string, convId: string, opts?: MediaSendOptions & { replyTo?: { convSeq: number; preview: string; from?: string } }): string {
    const clientMsgId = crypto.randomUUID();
    // ack 后落库：记住内容类型 + 引用定位/快照 + 转发溯源 + 相册分组 + 视频封面（本端即时预览，重进会话仍在）。
    this.pendingSends.set(clientMsgId, { convId, content, contentType, timestamp: Date.now(),
      fileName: opts?.fileName, fileSize: opts?.fileSize, replyToConvSeq: opts?.replyTo?.convSeq, replySnapshot: opts?.replyTo?.preview, replyToFrom: opts?.replyTo?.from, forwardFrom: opts?.forwardFrom, groupId: opts?.groupId, poster: opts?.poster,
      mediaW: opts?.mediaW, mediaH: opts?.mediaH, duration: opts?.duration });
    this.sendTimers.set(clientMsgId, window.setTimeout(() => {
      this.sendTimers.delete(clientMsgId);
      this.pendingSends.delete(clientMsgId);
      logger.warn(LOG_TAG.ws, "ack_timeout", {
        client_msg_id: clientMsgId,
        conv_id: convId,
        content_type: contentType,
        timeout_ms: SEND_TIMEOUT_MS,
      });
      this.handlers.onAck?.(clientMsgId, false, 0);
    }, SEND_TIMEOUT_MS));
    const data: Record<string, unknown> = { client_msg_id: clientMsgId, conv_id: convId, to, content_type: contentType, content };
    if (opts?.replyTo && opts.replyTo.convSeq > 0) { data.reply_to = { conv_seq: opts.replyTo.convSeq }; }
    if (opts?.forwardFrom) { data.forward_from = opts.forwardFrom; }
    if (opts?.groupId) { data.group_id = opts.groupId; }
    if (opts?.poster) { data.poster = opts.poster; }
    if (contentType === "file" && opts?.fileName) { data.file_name = opts.fileName; }
    // 媒体元数据（M4+，PROTOCOL §4.1）：尺寸/时长/字节数由发送端量出，收端据此按原比例排版 + 显时长角标。
    if (opts?.mediaW && opts.mediaW > 0) { data.media_w = opts.mediaW; }
    if (opts?.mediaH && opts.mediaH > 0) { data.media_h = opts.mediaH; }
    if (opts?.duration && opts.duration > 0) { data.duration = opts.duration; }
    if (opts?.fileSize !== undefined && opts.fileSize > 0) { data.file_size = opts.fileSize; }
    if (contentType === "image" || contentType === "video") {
      // 媒体上行的唯一收口 → "到底带没带尺寸/时长"以此为准（含转发路径）。不记 content/正文。
      const fields = {
        client_msg_id: clientMsgId, conv_id: convId, content_type: contentType,
        media_w: data.media_w ?? 0, media_h: data.media_h ?? 0, duration_ms: data.duration ?? 0,
        bytes: data.file_size ?? 0, has_poster: Boolean(opts?.poster), forwarded: Boolean(opts?.forwardFrom),
      };
      if (data.media_w && data.media_h) logger.info(LOG_TAG.media, "media_meta_attached", fields);
      else logger.warn(LOG_TAG.media, "media_meta_missing", fields); // 收端只能回退，排版异常的头号根因
    }
    this.send({ type: T.SEND_MSG, seq: ++this.seq, data });
    return clientMsgId;
  }

  /** 撤回自己的消息（M4-1）。发出 msg_op；成功由服务端广播回 msg_op 帧应用，失败（超窗等）回 onMsgOpFailed。 */
  recallMessage(convId: string, targetConvSeq: number): string {
    return this.sendMsgOp(OP.RECALL, convId, targetConvSeq, {});
  }

  /** 编辑自己的文本消息（M4-5）。成功由服务端广播回 msg_op 帧应用（内容+已编辑标）。 */
  editMessage(convId: string, targetConvSeq: number, content: string): string {
    return this.sendMsgOp(OP.EDIT, convId, targetConvSeq, { content });
  }

  /** 发一条 msg_op（撤回/编辑/置顶），返回其 client_msg_id（供对账/回滚）。 */
  private sendMsgOp(op: string, convId: string, targetConvSeq: number, extra: { content?: string; pinned?: boolean }): string {
    const clientMsgId = crypto.randomUUID();
    this.pendingOps.set(clientMsgId, { op, convId, targetConvSeq });
    this.send({
      type: T.MSG_OP, seq: ++this.seq,
      data: { op, conv_id: convId, target_conv_seq: targetConvSeq, client_msg_id: clientMsgId, ...extra },
    });
    return clientMsgId;
  }

  /** 应用一条消息操作到本地（落库 + 通知 UI）。data 来自实时 msg_op 帧或 sync 的 msg_op 事件行负载。 */
  private applyMsgOp(
    data: { op?: string; conv_id?: string; target_conv_seq?: number; content?: string; client_msg_id?: string },
    advanceCursorTo = 0,
  ): void {
    const convId = data.conv_id || "";
    const target = data.target_conv_seq || 0;
    if (!convId || !target) return;
    let patch: MsgOpPatch;
    if (data.op === OP.RECALL) patch = { recalledAt: Date.now() };
    else if (data.op === OP.EDIT) patch = { editedAt: Date.now(), content: data.content ?? "" };
    else if (data.op === OP.PIN) patch = { pinnedAt: Date.now() };
    else return; // 未知 op：忽略不崩
    void localStore.applyMsgOpLocal(this.uid, convId, target, patch, advanceCursorTo);
    if (data.client_msg_id) this.pendingOps.delete(data.client_msg_id); // 我方操作成功回执
    this.handlers.onMsgOp?.(convId, target, patch);
  }

  // ---- 内部 ----

  private async openSocket(throwOnLoginError = false): Promise<void> {
    const generation = ++this.connectionGeneration;
    const uid = this.uid;
    const password = this.password;
    const previousSocket = this.ws;
    this.ws = null;
    previousSocket?.close(1000);
    this.stopPing();
    this.setState("connecting");
    logger.info(LOG_TAG.ws, "connecting", {
      user_id: uid,
      attempt: this.reconnectAttempts + 1,
    });
    let token: string;
    try {
      token = await this.fetchToken(uid, password);
      if (generation !== this.connectionGeneration || this.manualClose || uid !== this.uid) return;
      this.token = token;
    } catch (e) {
      if (generation !== this.connectionGeneration || this.manualClose || uid !== this.uid) return;
      this.setState("disconnected");
      logger.warn(LOG_TAG.ws, "login_failed", {
        user_id: uid,
        code: (e as { code?: number }).code,
        message: (e as Error).message,
      });
      if (throwOnLoginError) {
        // 首次进入若只是网络不可达，UI 可先展示按 uid 隔离的本地缓存，同时 SDK 在后台继续重连。
        if (!isAuthCode((e as { code?: number }).code) && !this.manualClose) this.scheduleReconnect();
        throw e;
      }
      // 重连：鉴权失效（账号没了/密码错/token 失效）→ 退回登录，不无限重试；网络失败 → 继续重试。
      const code = (e as { code?: number }).code;
      if (isAuthCode(code)) {
        this.manualClose = true; // 停止后续自动重连
        this.handlers.onAuthError?.((e as Error).message || "登录已失效，请重新登录");
      } else if (!this.manualClose) {
        this.scheduleReconnect();
      }
      return;
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onopen = () => {
      if (ws !== this.ws || generation !== this.connectionGeneration) return;
      logger.info(LOG_TAG.ws, "connected", {
        user_id: uid,
        tracked_conversations: this.tracked.size,
      });
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.startPing();
      this.sendSyncReq([...this.tracked]); // 重连补偿
    };
    ws.onmessage = (ev) => {
      if (ws === this.ws && generation === this.connectionGeneration) this.onFrame(ev.data);
    };
    ws.onclose = (event) => {
      if (ws !== this.ws || generation !== this.connectionGeneration) return;
      this.ws = null;
      logger.warn(LOG_TAG.ws, "disconnected", {
        user_id: uid,
        code: event.code,
        reason: event.reason || "-",
        clean: event.wasClean,
        manual: this.manualClose,
      });
      this.stopPing();
      this.syncingConvs.clear(); // 此连接上未返回的 sync_resp 已失效，重连后重新补偿
      this.syncPending.clear();
      this.pagedPending.clear();
      this.setState("disconnected");
      if (!this.manualClose) this.scheduleReconnect();
    };
    ws.onerror = () => {
      if (ws !== this.ws || generation !== this.connectionGeneration) return;
      logger.warn(LOG_TAG.ws, "socket_error", { user_id: uid });
      ws.close();
    };
  }

  /** POST /api/v1/login 换 token。带 password=真账号登录；password 空=开发期免密直签。失败抛带服务端文案的 Error。 */
  private async fetchToken(uid: string, password: string): Promise<string> {
    const body = await fetchJSON("/api/v1/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: uid, password }),
    });
    if (body.code !== 0 || !body.data?.token) {
      const e = new Error(friendlyMessage(body.code, body.message || "登录失败")) as Error & { code?: number };
      e.code = body.code; // 带上业务码，供重连区分 鉴权失败 vs 网络失败
      throw e;
    }
    return body.data.token as string;
  }

  private onFrame(raw: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(raw);
    } catch {
      logger.warn(LOG_TAG.ws, "invalid_frame", { bytes: new TextEncoder().encode(raw).byteLength });
      return;
    }
    const d = env.data || {};
    switch (env.type) {
      case T.ACK: {
        const timer = this.sendTimers.get(d.client_msg_id); // ack 到了 → 取消超时判失败
        if (timer !== undefined) { clearTimeout(timer); this.sendTimers.delete(d.client_msg_id); }
        // ACK 只确认当前消息，不证明此前所有序号都已连续同步，不能越级推进历史游标。
        // 自己发的消息（本端不会再经 new_msg 回显）→ ack 拿到 conv_seq 后落库，刷新后仍在。
        const pend = this.pendingSends.get(d.client_msg_id);
        if (pend && d.conv_seq > 0) {
          logger.info(LOG_TAG.ws, "ack_received", {
            client_msg_id: d.client_msg_id,
            conv_id: d.conv_id,
            conv_seq: d.conv_seq,
            duration_ms: Math.max(0, Date.now() - pend.timestamp),
          });
          void localStore.saveMessage(this.uid, {
            serverMsgId: d.server_msg_id, convId: pend.convId, from: this.uid, content: pend.content,
            contentType: pend.contentType, convSeq: d.conv_seq, timestamp: pend.timestamp, status: "sent",
            fileName: pend.fileName, fileSize: pend.fileSize,
            replyToConvSeq: pend.replyToConvSeq, replySnapshot: pend.replySnapshot, replyToFrom: pend.replyToFrom, forwardFrom: pend.forwardFrom,
            groupId: pend.groupId, posterUrl: pend.poster,
            mediaW: pend.mediaW, mediaH: pend.mediaH, duration: pend.duration,
          });
          this.pendingSends.delete(d.client_msg_id);
        }
        this.handlers.onAck?.(d.client_msg_id, true, d.conv_seq, d.timestamp);
        break;
      }
      case T.NEW_MSG:
        this.processIncoming(d);
        break;
      case T.SYNC_RESP: {
        const responseSeq = typeof env.seq === "number" ? env.seq : 0;
        const isPaged = this.pagedPending.has(responseSeq);
        if (isPaged) this.pagedPending.delete(responseSeq);
        const requestedConvs = this.syncPending.get(responseSeq) ?? [];
        this.syncPending.delete(responseSeq);
        requestedConvs.forEach((convId) => this.syncingConvs.delete(convId));
        for (const conv of d.conversations || []) {
          for (const m of conv.messages || []) this.processIncoming(m, false);
          if (isPaged) {
            // 聊天历史分页只返回一页，不参与自动追平。
          } else if (conv.has_more && conv.conv_id) {
            const responseLatest = Number(conv.latest_conv_seq) || 0;
            const continuous = this.syncedSeq.get(conv.conv_id) ?? 0;
            if (continuous === responseLatest) {
              this.sendSyncReq([conv.conv_id]); // 只从本页实际连续处理完成的位置继续翻页
            } else {
              logger.warn(LOG_TAG.ws, "sync_page_not_contiguous", {
                conv_id: conv.conv_id,
                response_latest_seq: responseLatest,
                continuous_seq: continuous,
              });
            }
          }
        }
        break;
      }
      case T.RECEIPT:
        this.handlers.onReceipt?.(d.conv_id, d.from, d.status, d.up_to_conv_seq);
        break;
      case T.PRESENCE:
        this.handlers.onPresence?.(d.user, presenceFromFrame(d));
        break;
      case T.TYPING:
        this.handlers.onTyping?.(d.conv_id, d.from);
        break;
      case T.FRIEND:
        this.handlers.onFriend?.(d.event, d.from);
        break;
      case T.GROUP:
        this.handlers.onGroup?.(d.event, d.conv_id, d.from, d.target ?? "");
        break;
      case T.MSG_OP: // 实时消息操作帧（撤回/编辑/置顶）：应用到本地
        this.applyMsgOp(d);
        break;
      case T.CONV_UPDATE: // 会话级设置变更（置顶/免打扰/标未读/删除会话，M4.5）：多端同步
        this.handlers.onConvUpdate?.({
          conv_id: d.conv_id, action: d.action,
          pinned_at: d.pinned_at ?? 0, muted: !!d.muted, marked_unread: !!d.marked_unread,
          cleared_at: d.cleared_at ?? 0,
        });
        break;
      case T.PONG:
        break;
      case T.ERROR: {
        const responseSeq = typeof env.seq === "number" ? env.seq : 0;
        const syncConvs = this.syncPending.get(responseSeq) ?? [];
        this.syncPending.delete(responseSeq);
        syncConvs.forEach((convId) => this.syncingConvs.delete(convId));
        this.pagedPending.delete(responseSeq);
        const cmid = d.client_msg_id;
        // 消息操作被拒（如撤回超时 300008）：回滚提示，不动消息本身。
        const op = cmid ? this.pendingOps.get(cmid) : undefined;
        if (op) {
          this.pendingOps.delete(cmid);
          logger.warn(LOG_TAG.ws, "message_operation_rejected", {
            client_msg_id: cmid,
            operation: op.op,
            conv_id: op.convId,
            code: d.code,
            message: d.message,
          });
          this.handlers.onMsgOpFailed?.(op.op, op.convId, op.targetConvSeq, d.message || "操作失败");
          break;
        }
        // 带 client_msg_id 的错误 = 对某条 send_msg 的拒绝（如被拉黑）：标记该条失败 + 提示。
        if (cmid) {
          const timer = this.sendTimers.get(cmid);
          if (timer !== undefined) { clearTimeout(timer); this.sendTimers.delete(cmid); }
          const note = d.message || "发送失败";
          // 被拒（如被拉黑）服务端永不接受、无 conv_seq → 把该条按失败态 + 系统提示落库，刷新/重进会话仍在。
          const pend = this.pendingSends.get(cmid);
          if (pend) {
            logger.warn(LOG_TAG.ws, "message_rejected", {
              client_msg_id: cmid,
              conv_id: pend.convId,
              content_type: pend.contentType,
              code: d.code,
              message: note,
            });
            // 字段集必须与 ACK 落库一致（见上面 handleAck）：此前这里把 contentType 写死 "text"
            // 且丢掉 groupId/poster/尺寸等，导致被拒的图片/视频刷新后退化成一条显示 URL 的文本气泡，
            // 且相册因 groupId 丢失而散成一条条独立消息（各带一个红❗）。
            void localStore.saveRejected(this.uid, {
              clientMsgId: cmid, convId: pend.convId, from: this.uid,
              content: pend.content, contentType: pend.contentType,
              convSeq: 0, timestamp: pend.timestamp, status: "failed", note,
              fileName: pend.fileName, fileSize: pend.fileSize,
              replyToConvSeq: pend.replyToConvSeq, replySnapshot: pend.replySnapshot,
              replyToFrom: pend.replyToFrom, forwardFrom: pend.forwardFrom,
              groupId: pend.groupId, posterUrl: pend.poster,
              mediaW: pend.mediaW, mediaH: pend.mediaH, duration: pend.duration,
            });
          }
          this.pendingSends.delete(cmid);
          this.handlers.onMsgRejected?.(cmid, note, Number(d.code) || 0);
        }
        break;
      }
    }
  }

  private processIncoming(d: any, healRealtimeGap = true): void {
    const convId = typeof d.conv_id === "string" ? d.conv_id : "";
    const convSeq = Number(d.conv_seq) || 0;
    const prevSynced = this.syncedSeq.get(convId) ?? 0;
    const isNextContiguous = convSeq > 0 && convSeq === prevSynced + 1;
    // msg_op 事件行（撤回/编辑/置顶，来自 sync 补拉）：应用其效果、不作气泡渲染、不入库为消息。
    if (d.content_type === "msg_op") {
      try {
        this.applyMsgOp(
          JSON.parse(typeof d.content === "string" ? d.content : "{}"),
          isNextContiguous ? convSeq : 0,
        );
      } catch {
        /* 非法负载：忽略不崩 */
      }
      if (isNextContiguous) this.updateSynced(convId, convSeq);
      return;
    }
    const msg: ChatMessage = {
      serverMsgId: d.server_msg_id,
      convId: d.conv_id,
      from: d.from,
      fromNickname: d.from_nickname || undefined, // 群消息冗余带发送者昵称（空不占字段）
      content: typeof d.content === "string" ? d.content : "",
      contentType: d.content_type || "text",
      fileName: d.file_name || undefined,
      fileSize: d.file_size !== undefined && Number(d.file_size) >= 0 ? Number(d.file_size) : undefined,
      convSeq: d.conv_seq || 0,
      timestamp: d.timestamp || 0,
      status: "received",
      // 直加载/同步已带派生状态（服务端冗余下发）：撤回消息直接渲染墓碑，不依赖回放 op 事件。
      recalledAt: d.recalled_at || undefined,
      recalledBy: d.recalled_by || undefined,
      editedAt: d.edited_at || undefined,
      pinnedAt: d.pinned_at || undefined,
      replyToConvSeq: d.reply_to_conv_seq || undefined,
      replySnapshot: d.reply_snapshot || undefined,
      replyToFrom: d.reply_to_from || undefined,
      forwardFrom: d.forward_from || undefined,
      groupId: d.group_id || undefined,
      posterUrl: d.poster || undefined,
      mediaW: Number(d.media_w) > 0 ? Number(d.media_w) : undefined,
      mediaH: Number(d.media_h) > 0 ? Number(d.media_h) : undefined,
      duration: Number(d.duration) > 0 ? Number(d.duration) : undefined,
    };
    // 离线空洞自愈：conv_seq 由服务端连续分配，若收到的序号跳过了已同步位点之后的中间段，
    // 说明中间有未拉到的（离线）消息 → 先用当前（较低）位点 since 补拉缺口，
    // 避免这条实时消息把 synced 推过空洞、造成中间几条被永久漏掉。
    if (healRealtimeGap && shouldHealGap(prevSynced, msg.convSeq, this.tracked.has(msg.convId))) {
      logger.warn(LOG_TAG.ws, "sequence_gap_detected", {
        conv_id: msg.convId,
        previous_seq: prevSynced,
        incoming_seq: msg.convSeq,
      });
      this.sendSyncReq([msg.convId]); // since=prevSynced（此刻尚未 update）→ 拉回 [prevSynced+1 .. ]
    }
    if (isNextContiguous) this.updateSynced(msg.convId, msg.convSeq);
    this.sendReceipt(msg.convId, msg.convSeq);
    // 连续消息与游标同事务提交；非连续消息只落消息，游标仍停在空洞前。
    void localStore.saveIncomingMessage(this.uid, msg, isNextContiguous);
    this.handlers.onMessage?.(msg);
  }

  /** 读取某会话的本地持久化消息（IndexedDB），供 UI 启动时秒载。 */
  loadLocal(convId: string): Promise<ChatMessage[]> {
    return localStore.loadConversation(this.uid, convId);
  }

  /** 读取当前 uid 命名空间内独立持久化的连续同步游标。 */
  loadSyncCursor(convId: string): Promise<number> {
    return localStore.loadSyncCursor(this.uid, convId);
  }

  /** 登记会话用于（重）连后增量同步。基线只在首次登记时设置，不能用稍后见到的较大值越过空洞。 */
  trackConversation(convId: string, syncedSeq: number): void {
    if (!convId) return;
    this.tracked.add(convId);
    if (!this.syncedSeq.has(convId)) this.syncedSeq.set(convId, Math.max(0, syncedSeq));
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
    // connect() 在 WebSocket OPEN 之前即可返回；此时不能先占用 in-flight，onopen 会统一补发。
    if (!this.isSocketOpen()) return;
    const pending = convIds.filter((c) => c && !this.syncingConvs.has(c));
    const cursors = pending.map((c) => ({ conv_id: c, since_conv_seq: this.syncedSeq.get(c) ?? 0 }));
    if (cursors.length === 0) return;
    pending.forEach((c) => this.syncingConvs.add(c));
    const requestSeq = ++this.seq;
    this.syncPending.set(requestSeq, pending);
    this.send({ type: T.SYNC_REQ, seq: requestSeq, data: { cursors } });
  }

  private updateSynced(convId: string, seq: number): void {
    if (!convId || !seq) return;
    if (seq > (this.syncedSeq.get(convId) ?? 0)) this.syncedSeq.set(convId, seq);
  }

  private send(env: Envelope): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(env));
      return;
    }
    if (env.type !== T.PING && env.type !== T.TYPING) {
      logger.warn(LOG_TAG.ws, "send_skipped_not_connected", {
        type: env.type,
        state: this.state,
      });
    }
  }

  private isSocketOpen(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
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
    if (this.reconnectTimer !== null || this.manualClose) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    logger.info(LOG_TAG.ws, "reconnect_scheduled", {
      attempt: this.reconnectAttempts,
      delay_ms: delay,
    });
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualClose) void this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(s: ConnState): void {
    if (this.state === s) return;
    logger.debug(LOG_TAG.ws, "state_changed", { from: this.state, to: s });
    this.state = s;
    this.handlers.onState?.(s);
  }
}

/** 离线空洞自愈判定（纯函数，导出供单测）：实时消息跳过“已连续位置+1”即补拉。
 *  初始位置为 0 但首条直接是较大序号同样是空洞，不能当作已同步。 */
export function shouldHealGap(prevSynced: number, incomingConvSeq: number, tracked: boolean): boolean {
  return tracked && prevSynced >= 0 && incomingConvSeq > prevSynced + 1;
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
    resp = await tracedFetch(path, init);
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
    300201: "群不存在",
    300202: "群名不能为空且不超过 30 字",
    300203: "你不在该群中",
    // 300204 不映射：服务端会带具体原因（如"群主需先转让群主再退群"），透传更有用。
    300205: "群成员已达上限",
  };
  return map[code] || fallback || `请求失败(${code})`;
}
