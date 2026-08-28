// IMClient —— Web 端协议 SDK（对应 iOS 的 IMSocketManager）。
// 职责：登录换 token、WebSocket 连接、收发、心跳、重连、增量同步、回执；不含任何 UI。
// 默认走同源相对路径（开发期由 Vite 代理到后端，见 vite.config.ts）。

import { T, OP, type Envelope, type ChatMessage, type Conversation, type ConvUpdate, type UserCard, type FriendEntry, type MyProfile, type GroupInfo, type GroupSummary, type MsgOpPatch, type Favorite, type PinnedMessage, type GroupBan, type QRCard, type QRResolved, type JoinRequest, type DeviceView } from "./protocol";
import { presenceFromFrame, type Presence } from "./presence";
import * as localStore from "./localStore";
import { LOG_TAG, logger } from "../logging/logger";
import { tracedFetch, tracedUpload, fetchEnvelope, callJson, type UploadProgressHandler } from "./http";
import { startChunkedUpload, CHUNKED_THRESHOLD } from "./chunkedUpload";
import { friendlyMessage } from "./errcode";
import * as voiceApi from "./voiceApi";

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
  /** 极小模糊预览（~20px 缩略 JPEG 的 data URL，M4-7）：收端未下载时放大+模糊显占位。 */
  thumb?: string;
  /** 语音振幅指纹（voice P1，base64，原始字节 ≤120）：收端不下载音频即可画气泡波形。 */
  waveform?: string;
  /** 图文/视频文/文件文随附文本（Telegram 图说模型）：与媒体同生为一条消息。仅 image/video/file 有效；空=纯媒体。 */
  caption?: string;
  /** 配文里的 @提及（仅群聊）：被 @ 成员 uid 列表，随媒体消息上行，服务端据此做被@强提醒（与文本消息同口径）。 */
  mentions?: string[];
  /** 配文 @所有人（仅群聊、群主/管理员）。 */
  mentionAll?: boolean;
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
  /** 群成员/资料变更（invite/leave/remove/role/transfer/profile；G3 加 join_request/join_result）：提示刷新该群与会话列表。
   *  result 仅 join_result 帧带（approved|rejected），其余为空。 */
  onGroup?: (event: string, convId: string, from: string, target: string, result: string) => void;
  /** 鉴权失效（账号不存在/密码错/被封/token 失效）：会话已失效，应退回登录页（而非无限重连）。
   *  code 为业务码，供 UI 区分处理：100101 吊销/被踢=强制退登（直接跳登录），100102 过期=可留看本地缓存。 */
  onAuthError?: (msg: string, code?: number) => void;
  /** 某条消息被服务端拒收（如被拉黑）：把该 client_msg_id 标记为发送失败并提示原因。
   *  code 为服务端业务码（200102 被拉黑 / 200103 非好友 …），UI 据此决定是否给恢复入口。 */
  onMsgRejected?: (clientMsgId: string, msg: string, code: number) => void;
  /** 消息操作（撤回/编辑/置顶）应用到某条消息：UI 据 patch 更新该条（convSeq 定位）。 */
  onMsgOp?: (convId: string, targetConvSeq: number, patch: MsgOpPatch) => void;
  /** 某条消息被**物理移除**（任务2）：为所有人删除（op=delete，全体成员）或仅为我删除（msg_hidden，本人多端）。
   *  UI 据 (convId, convSeq) 从消息列表 / 详情文件列表移除该条，区别于 recall 的"改状态显墓碑"。 */
  onMessageRemoved?: (convId: string, targetConvSeq: number) => void;
  /** 我发起的消息操作被拒（如撤回超时 300008）：回滚提示。 */
  onMsgOpFailed?: (op: string, convId: string, targetConvSeq: number, msg: string) => void;
  /** 会话级设置变更（置顶/免打扰/标未读/删除会话，M4.5）：多端同步，UI 据完整状态覆盖本地会话列表。 */
  onConvUpdate?: (u: ConvUpdate) => void;
  /** 账号级客户端配置版本变更（M4-7 自动下载策略）：另一端改了策略，本端应重拉。 */
  onCapabilitiesUpdate?: (version: number) => void;
  /** 语音转文字结果到达（服务端识别完成，见 IMServer docs/VOICE_TRANSCRIBE_DESIGN.md §3.2）。 */
  onVoiceTranscript?: (convId: string, convSeq: number, status: string, text: string) => void;
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
  private sessionToken = ""; // 扫码登录标记（置位=本会话无密码可回退）：重连探活失效时无法 /login 自愈，一律回登录
  private token = ""; // 登录后保存，供 HTTP API（会话列表等）带 Bearer
  private state: ConnState = "disconnected";
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private connectionGeneration = 0; // 使切账号/新重连之前仍在途的登录与 socket 回调失效
  private manualClose = false;
  private syncedSeq = new Map<string, number>(); // convId -> 已连续接上的 conv_seq（不能用“见过的最大值”越过空洞）
  private tracked = new Set<string>(); // 重连后需增量同步的会话
  private watched: string[] = []; // 当前在线态关注全集（watch），onopen/重连后自动重发
  private syncingConvs = new Set<string>(); // 正在断线补偿/空洞自愈，避免连发消息触发重复 sync_req
  private syncPending = new Map<number, string[]>(); // request seq -> convIds；响应/错误时精确释放 in-flight
  private pagedPending = new Set<number>(); // 聊天历史单页请求 seq；与自动补偿请求严格区分
  private pendingSends = new Map<string, { convId: string; content: string; contentType: string; timestamp: number; fileName?: string; fileSize?: number; caption?: string; mentions?: string[]; mentionAll?: boolean; replyToConvSeq?: number; replySnapshot?: string; replyToFrom?: string; forwardFrom?: string; groupId?: string; poster?: string; mediaW?: number; mediaH?: number; duration?: number; thumb?: string; waveform?: string }>(); // client_msg_id -> 待确认发送（ack 后落库）
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
    this.sessionToken = ""; // 密码登录路径：清掉可能残留的扫码 token，避免重连误用旧会话
    this.manualClose = false;
    this.clearReconnectTimer();
    logger.info(LOG_TAG.ws, "connect_requested", { user_id: uid });
    await this.openSocket(true);
  }

  /** 用扫码登录换来的 JWT 直接建立会话（无密码）。
   *  断线重连复用该 token 并做一次鉴权探活：被踢下线/过期(auth 码)即回登录，网络失败继续重试。 */
  async connectWithToken(uid: string, token: string): Promise<void> {
    if (this.uid && this.uid !== uid) {
      // 与 connect() 同款切账号清理：绝不沿用上个 uid 的游标/在途状态。
      this.syncedSeq.clear();
      this.tracked.clear();
      this.syncingConvs.clear();
      this.syncPending.clear();
      this.pagedPending.clear();
      this.pendingOps.clear();
      this.sendTimers.forEach((timer) => clearTimeout(timer));
      this.sendTimers.clear();
      this.pendingSends.clear();
    }
    this.uid = uid;
    this.password = "";
    this.sessionToken = token;
    this.token = token;
    this.manualClose = false;
    this.clearReconnectTimer();
    logger.info(LOG_TAG.ws, "connect_requested", { user_id: uid, via: "qr_login" });
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
    this.sessionToken = ""; // 退出后不再复用扫码 token
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

  /** 带 Bearer 的 HTTP 调用，统一解析 errcode 信封（code!=0 抛带 .code 的 Error）。
   *  信封解包 / 业务码 → 中文文案 / 传输层友好文案由 sdk/http.ts 的 callJson 统一负责；这里只贴
   *  client 状态（token 头、body 时的 Content-Type）。 */
  private async api(path: string, init?: RequestInit): Promise<any> {
    return await callJson(path, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
    });
  }

  /** 拉账号级自动下载策略（M4-7）。返回 `{version, settings}`；未设置过时后端回出厂默认。 */
  async downloadSettings(): Promise<{ version: number; settings: unknown }> {
    return (await this.api("/api/v1/download-settings")) as { version: number; settings: unknown };
  }

  /** 保存自动下载策略（整体替换）：后端规整 + bump 版本 + 推 capabilities_update 给本账号其它端。
   *  请求体**就是 settings 本身**（后端直接 Decode 进 downloadsettings.Settings），不要再包一层。 */
  async saveDownloadSettings(settings: unknown): Promise<{ version: number; settings: unknown }> {
    return (await this.api("/api/v1/download-settings", {
      method: "PUT", body: JSON.stringify(settings),
    })) as { version: number; settings: unknown };
  }

  /** 恢复出厂默认（草图 §05-3「重置自动下载设置」）。 */
  async resetDownloadSettings(): Promise<{ version: number; settings: unknown }> {
    return (await this.api("/api/v1/download-settings/reset", { method: "POST" })) as { version: number; settings: unknown };
  }

  // ---- 已登录设备 / 多设备管理（P2）----

  /** 我的登录设备列表（本机置顶、在线优先）：GET /api/v1/devices。 */
  async listDevices(): Promise<DeviceView[]> {
    const data = await this.api("/api/v1/devices");
    return (data?.devices ?? []) as DeviceView[];
  }

  /** 踢下线某设备（吊销 sid + 断活连接）：POST /api/v1/devices/{sid}/revoke。踢本机=退出登录。 */
  async revokeDevice(sid: string): Promise<void> {
    await this.api(`/api/v1/devices/${encodeURIComponent(sid)}/revoke`, { method: "POST" });
  }

  /** 退出除本机外的所有设备（换密码后常见动作）：POST /api/v1/devices/revoke-others。 */
  async revokeOtherDevices(): Promise<void> {
    await this.api("/api/v1/devices/revoke-others", { method: "POST" });
  }

  /** 修改密码：POST /api/v1/users/me/password {old_password,new_password}。
   *  成功后服务端会**自动下线本账号其它全部设备**（只保留当前，安全默认），无需前端再调 revoke-others。
   *  失败抛带 .code 的 Error（200002=旧密码错，100001/参数类=强度不足等），文案已本地化。 */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.api("/api/v1/users/me/password", {
      method: "POST",
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
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

  /** 更新会话级设置（置顶/免打扰/标未读，整体替换）：PUT /api/v1/conversations/{id}/settings。
   *  注：remark 已从 settings 拆出走 setConvRemark；本端点服务端会保留现有 remark 不清空。 */
  async updateConvSettings(convId: string, s: { pinned_at: number; muted: boolean; marked_unread: boolean }): Promise<void> {
    await this.api(`/api/v1/conversations/${encodeURIComponent(convId)}/settings`, { method: "PUT", body: JSON.stringify(s) });
  }

  /** 设置会话备注（G1，仅本人可见、多端同步）：PUT /api/v1/conversations/{id}/remark。留空即清除。
   *  与设置三开关解耦（各走各端点，互不覆盖）；变更经 conv_update 同步全端。 */
  async setConvRemark(convId: string, remark: string): Promise<void> {
    await this.api(`/api/v1/conversations/${encodeURIComponent(convId)}/remark`, { method: "PUT", body: JSON.stringify({ remark }) });
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

  /**
   * 群消息已读/未读名单（M4-8）：**仅消息发送者本人**可调（他人调用服务端回 403）。
   * `enabled=false` 表示群规模超上限（>2000 人）——read/unread 为空，调用方应隐藏入口而非报错。
   * 不含读取时刻：已读位点语义是"读到 conv_seq 为止"，无法反推某人何时读到这一条。
   */
  async fetchReadReceipts(convId: string, convSeq: number): Promise<{ read: string[]; unread: string[]; enabled: boolean }> {
    const data = await this.api(`/api/v1/conversations/${encodeURIComponent(convId)}/messages/${convSeq}/read-by`);
    return {
      read: Array.isArray(data?.read) ? (data.read as string[]) : [],
      unread: Array.isArray(data?.unread) ? (data.unread as string[]) : [],
      enabled: data?.enabled === true,
    };
  }

  /** 改群资料（群主/管理员）。 */
  async updateGroup(convId: string, name: string, avatarUrl: string, intro = ""): Promise<void> {
    // 整体替换语义：name/avatar_url/intro 都回带当前值，省略即清空（后端 G1）。
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}`, {
      method: "PUT", body: JSON.stringify({ name, avatar_url: avatarUrl, intro }),
    });
  }

  /** 发布/撤下群公告（G1，群主/管理员）：text 空即撤下。 */
  async setGroupAnnouncement(convId: string, text: string): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/announcement`, {
      method: "PUT", body: JSON.stringify({ text }),
    });
  }

  /** 群主/管理员自助全员禁言（G1）：until=0 解除 / -1 永久 / 其余到期毫秒时间戳。 */
  async setGroupMute(convId: string, until: number): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/mute`, {
      method: "PUT", body: JSON.stringify({ until }),
    });
  }

  /** 我在本群的昵称（G1，任意成员）：空串=清除回退全局昵称。 */
  async setGroupMyNickname(convId: string, nickname: string): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/members/me/nickname`, {
      method: "PUT", body: JSON.stringify({ nickname }),
    });
  }

  /** 群治理开关组（G2，群主/管理员整体替换）。 */
  async setGroupSettings(convId: string, s: {
    join_approval: boolean; perm_invite: boolean; perm_edit_info: boolean; perm_pin: boolean; history_visible: boolean;
  }): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/settings`, {
      method: "PUT", body: JSON.stringify(s),
    });
  }

  /** 单独禁言成员（G2）：until=0 解禁 / -1 永久 / 其余到期毫秒。 */
  async muteGroupMember(convId: string, userId: string, until: number): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/members/${encodeURIComponent(userId)}/mute`, {
      method: "PUT", body: JSON.stringify({ until }),
    });
  }

  /** 移出成员带封禁档（G2）：ban=none|cooldown|forever。 */
  async removeGroupMemberWithBan(convId: string, userId: string, ban: "none" | "cooldown" | "forever"): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/members/${encodeURIComponent(userId)}?ban=${ban}`, { method: "DELETE" });
  }

  /** 群黑名单列表（G2，群主/管理员）。 */
  async fetchGroupBans(convId: string): Promise<GroupBan[]> {
    const data = await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/bans`);
    return (data?.bans ?? []) as GroupBan[];
  }

  /** 解除拉黑（G2，群主/管理员）。 */
  async unbanGroupMember(convId: string, userId: string): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/bans/${encodeURIComponent(userId)}`, { method: "DELETE" });
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

  // ---- 二维码体系（QRCODE P0）----

  /** 我的名片码（懒生成，长期有效）。 */
  async qrMyCard(): Promise<QRCard> {
    return (await this.api(`/api/v1/qr/me`)) as QRCard;
  }

  /** 重置名片码（旧码立即失效）。 */
  async qrResetMyCard(): Promise<QRCard> {
    return (await this.api(`/api/v1/qr/me/reset`, { method: "POST" })) as QRCard;
  }

  /** 群二维码（须成员；perm_invite=1 时仅群主/管理员；7 天内复用同一枚）。 */
  async groupQR(convId: string): Promise<QRCard> {
    return (await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/qr`)) as QRCard;
  }

  /** 重置群码（群主/管理员）。 */
  async groupQRReset(convId: string): Promise<QRCard> {
    return (await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/qr/reset`, { method: "POST" })) as QRCard;
  }

  /** 扫码解析管道：raw=扫到的原文（URL 或裸 token）→ {kind, data}。失效码抛 200110。 */
  async qrResolve(raw: string): Promise<QRResolved> {
    return (await this.api(`/api/v1/qr/resolve`, {
      method: "POST", body: JSON.stringify({ raw }),
    })) as QRResolved;
  }

  // ---- 入群路径（G3）----

  /** 凭群码入群（token 可为完整 URL 或裸 token）。成功返回群资料；需审批时抛 300210。 */
  async joinGroupByCode(token: string, hello = ""): Promise<GroupInfo> {
    return (await this.api(`/api/v1/groups/join`, {
      method: "POST", body: JSON.stringify({ token, hello }),
    })) as GroupInfo;
  }

  /** 待审入群申请（群主/管理员）；status 空=全部。 */
  async fetchJoinRequests(convId: string, status = "pending"): Promise<JoinRequest[]> {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    const data = await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/join-requests${q}`);
    return (data?.requests ?? []) as JoinRequest[];
  }

  /** 审批一条入群申请（群主/管理员）：accept=true→approve，false→reject。 */
  async decideJoinRequest(convId: string, userId: string, accept: boolean): Promise<void> {
    await this.api(`/api/v1/groups/${encodeURIComponent(convId)}/join-requests/${encodeURIComponent(userId)}`, {
      method: "POST", body: JSON.stringify({ action: accept ? "approve" : "reject" }),
    });
  }

  // ---- 收藏（M4-4）----

  /** 收藏一条内容（快照）：POST /api/v1/favorites。 */
  async addFavorite(f: { content_type?: string; content: string; caption?: string; file_name?: string; file_size?: number; duration?: number; waveform?: string; thumb?: string; poster?: string; media_w?: number; media_h?: number; source_conv_id?: string; source_conv_seq?: number; source_from?: string }): Promise<void> {
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

  /** 读取他人在线态快照：GET /api/v1/users/{id}。
   *  会话列表只覆盖「已有会话」的对端；从通讯录打开一个从没聊过的好友时没有任何快照来源，
   *  presence 帧又只在对方**恰好此刻上线**时才到，故需要这条兜底（对齐 iOS 的同名调用）。
   *  服务端仅对好友下发在线态，非好友返回空态。 */
  async fetchUserPresence(userId: string): Promise<Presence> {
    const data = await this.api(`/api/v1/users/${encodeURIComponent(userId)}`);
    return presenceFromFrame(data);
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
  sendText(content: string, to: string, convId: string, opts?: { replyTo?: { convSeq: number; preview: string; from?: string }; forwardFrom?: string; mentions?: string[]; mentionAll?: boolean }): string {
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

  /** 上传语音（voice P1）。实现在 sdk/voiceApi.ts（voice 域已拆出）。 */
  async uploadVoice(blob: Blob, fileName: string): Promise<{ url: string; size: number }> {
    return voiceApi.uploadVoice(this.token, blob, fileName);
  }

  /**
   * 上传头像（方案 C）：走**专用端点** `/api/v1/avatar`，服务端内容寻址落 `uploads/avatars/`，
   * 返回 `/avatars/<hash>.jpg` 相对 URL。与聊天媒体分离、永不清理（见 docs/AVATAR_STORAGE_DESIGN.md）。
   * 入参为裁切并缩到 ≤256px 的 JPEG blob；头像小，一次性 multipart，无需分片/进度。
   */
  async uploadAvatar(blob: Blob): Promise<{ url: string }> {
    const fd = new FormData();
    fd.append("file", blob, "avatar.jpg"); // 文件名带 .jpg，命中服务端扩展名白名单
    const auth = { Authorization: `Bearer ${this.token}` };
    const resp = await tracedFetch("/api/v1/avatar", { method: "POST", headers: auth, body: fd });
    const body = await resp.json().catch(() => ({ code: -1, data: {} as Record<string, unknown> }));
    if (body.code !== 0 || !body.data) throw new Error(friendlyMessage(body.code, body.message || "头像上传失败"));
    return { url: body.data.url as string };
  }

  /** 共用发送通道：content + content_type + 可选引用/转发。 */
  private sendContent(content: string, contentType: string, to: string, convId: string, opts?: MediaSendOptions & { replyTo?: { convSeq: number; preview: string; from?: string }; mentions?: string[]; mentionAll?: boolean }): string {
    const clientMsgId = crypto.randomUUID();
    // ack 后落库：记住内容类型 + 引用定位/快照 + 转发溯源 + 相册分组 + 视频封面（本端即时预览，重进会话仍在）。
    this.pendingSends.set(clientMsgId, { convId, content, contentType, timestamp: Date.now(),
      fileName: opts?.fileName, fileSize: opts?.fileSize, caption: opts?.caption,
      mentions: opts?.mentions, mentionAll: opts?.mentionAll, // 落库供刷新后 @ 高亮与转发重发（强提醒）
      replyToConvSeq: opts?.replyTo?.convSeq, replySnapshot: opts?.replyTo?.preview, replyToFrom: opts?.replyTo?.from, forwardFrom: opts?.forwardFrom, groupId: opts?.groupId, poster: opts?.poster,
      mediaW: opts?.mediaW, mediaH: opts?.mediaH, duration: opts?.duration, thumb: opts?.thumb, waveform: opts?.waveform });
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
    if (opts?.thumb) { data.thumb = opts.thumb; } // 极小模糊预览（M4-7），收端未下载时显模糊占位
    if (opts?.waveform) { data.waveform = opts.waveform; } // voice 振幅指纹（P1），收端画气泡波形免下载音频
    // @提及（M4-8，仅群聊有意义）：服务端会按当时群成员集过滤/去重，并校验 @所有人 的群角色权限。
    if (opts?.mentions && opts.mentions.length > 0) { data.mentions = opts.mentions; }
    if (opts?.mentionAll) { data.mention_all = true; }
    if (contentType === "file" && opts?.fileName) { data.file_name = opts.fileName; }
    // caption（图文/视频文/文件文随附文本）：仅 image/video/file 带上行（服务端也只对这三类收下）。
    if ((contentType === "image" || contentType === "video" || contentType === "file") && opts?.caption) { data.caption = opts.caption; }
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

  /** 为所有人删除（任务2）：发出 msg_op op=delete；发送者本人或群主/管理员可删（后端校验），
   *  成功由服务端广播回 msg_op 帧，收端物理移除该条（无墓碑，区别于 recall）。失败回 onMsgOpFailed。 */
  deleteMessageForEveryone(convId: string, targetConvSeq: number): string {
    return this.sendMsgOp(OP.DELETE, convId, targetConvSeq, {});
  }

  /** 聊天内置顶 / 取消置顶（G0）。群内限群主/管理员（服务端 300006 权威），单聊任一方可置顶。
   *  成功由服务端广播回 msg_op 帧应用（onMsgOp 带 pinnedAt 补丁），失败回 onMsgOpFailed。 */
  pinMessage(convId: string, targetConvSeq: number, pinned: boolean): string {
    return this.sendMsgOp(OP.PIN, convId, targetConvSeq, { pinned });
  }

  /** 拉会话当前置顶消息集合（G0，进会话时回填顶部横幅；之后靠实时 msg_op 帧增量维护，不轮询）。 */
  async fetchPinned(convId: string): Promise<PinnedMessage[]> {
    const data = await this.api(`/api/v1/conversations/${encodeURIComponent(convId)}/pinned`);
    const items = (data?.items ?? []) as Array<Record<string, any>>;
    return items.map((it) => ({
      convSeq: it.conv_seq ?? 0,
      serverMsgId: it.server_msg_id ?? "",
      from: it.sender ?? "",
      fromNickname: it.from_nickname || undefined,
      contentType: it.content_type ?? "text",
      content: it.content ?? "",
      caption: it.caption || undefined, // 图说：置顶横幅「有字显字」
      timestamp: it.timestamp ?? 0,
      pinnedAt: it.pinned_at ?? 0,
    }));
  }

  /** 语音转文字（服务端识别）。实现在 sdk/voiceApi.ts（voice 域已拆出）。 */
  async transcribeVoice(convId: string, convSeq: number): Promise<{ status: string; text: string }> {
    return voiceApi.transcribeVoice(this.token, convId, convSeq);
  }

  /** 仅为我删除（任务2）：走 REST 落 per-user 隐藏表 → 本端立即物理移除 → 服务端推 msg_hidden 同步本人其它设备。 */
  async hideMessage(convId: string, targetConvSeq: number): Promise<void> {
    await this.api("/api/v1/messages/hide", {
      method: "POST",
      body: JSON.stringify({ conv_id: convId, conv_seq: targetConvSeq }),
    });
    await this.removeMessageLocal(convId, targetConvSeq, 0);
  }

  /** 登录后拉本账号隐藏消息全集并本地移除（catch-up：补收敛离线期间在其它设备产生的「仅为我删除」）。best-effort。
   *  每次重连都拉全集以捕捉离线窗口内在别端产生的隐藏；但用 uid 维度的 appliedHidden 记忆已处理项，
   *  避免每次重连对同一批旧隐藏重复 markMessageDeleted + 触发列表刷新（只对本会话新出现的隐藏做实际移除）。 */
  private appliedHidden = new Set<string>(); // "uid|convId|convSeq"：本会话已应用过的隐藏（uid 入键，换账号自然不串）
  async fetchHidden(): Promise<void> {
    try {
      const data = await this.api("/api/v1/messages/hidden");
      const items = (data?.items ?? []) as Array<{ conv_id?: string; conv_seq?: number }>;
      for (const it of items) {
        if (!it.conv_id || !it.conv_seq) continue;
        const key = `${this.uid}|${it.conv_id}|${it.conv_seq}`;
        if (this.appliedHidden.has(key)) continue; // 已处理过：跳过重复移除/刷新
        this.appliedHidden.add(key);
        await this.removeMessageLocal(it.conv_id, it.conv_seq, 0);
      }
    } catch (e) {
      logger.warn(LOG_TAG.ws, "fetch_hidden_failed", { message: (e as Error).message });
    }
  }

  /** 物理移除某条消息（落墓碑防重同步复现 + 通知 UI）。为所有人删除 / 仅为我删除 / msg_hidden 共用。 */
  private async removeMessageLocal(convId: string, targetConvSeq: number, advanceCursorTo: number): Promise<void> {
    await localStore.markMessageDeleted(this.uid, convId, { convSeq: targetConvSeq });
    if (advanceCursorTo > 0) await localStore.advanceSyncCursor(this.uid, convId, advanceCursorTo);
    this.handlers.onMessageRemoved?.(convId, targetConvSeq);
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
    data: {
      op?: string; conv_id?: string; target_conv_seq?: number; content?: string; client_msg_id?: string;
      pinned?: boolean; timestamp?: number;
    },
    advanceCursorTo = 0,
  ): void {
    const convId = data.conv_id || "";
    const target = data.target_conv_seq || 0;
    if (!convId || !target) return;
    // 为所有人删除（任务2）：物理移除该条，不走 patch（区别于 recall 的改状态显墓碑）。
    if (data.op === OP.DELETE) {
      if (data.client_msg_id) this.pendingOps.delete(data.client_msg_id); // 我方操作成功回执
      void this.removeMessageLocal(convId, target, advanceCursorTo);
      return;
    }
    let patch: MsgOpPatch;
    if (data.op === OP.RECALL) patch = { recalledAt: Date.now() };
    else if (data.op === OP.EDIT) patch = { editedAt: Date.now(), content: data.content ?? "" };
    // 置顶：**必须看 data.pinned**——取消置顶（pinned:false）与置顶走同一个 op，
    // 早先一律 `pinnedAt: Date.now()` 会把「取消置顶」也记成置顶（G0 接横幅时发现并修）。
    // 时间取服务端 timestamp（多端一致），缺省才回退本地时钟。
    else if (data.op === OP.PIN) patch = { pinnedAt: data.pinned === false ? 0 : (data.timestamp || Date.now()) };
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
        this.handlers.onAuthError?.((e as Error).message || "登录已失效，请重新登录", code);
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
      void this.fetchHidden(); // 「仅为我删除」catch-up（任务2）：补收敛离线期间在其它设备产生的隐藏
      if (this.watched.length) {
        // watch 连接级易失，重连重发；诊断记一条与首次 watch_sent 区分（看重连是否补上）。
        logger.info(LOG_TAG.ws, "watch_resent", { count: this.watched.length, targets: this.watched });
        this.send({ type: T.WATCH, data: { set: this.watched } });
      }
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

  /** 取本次（重）连要用的 token。首次登录走 POST /api/v1/login（password 真账号 / 空=免密直签）。
   *
   *  **重连关键**：有现成 token（扫码会话，或密码会话重连时上一枚）时**先拿它探活 /devices**，
   *  在重登之前发现吊销——否则密码会话重连直接 /login 会重新签发新会话，把「踢下线」自愈掉。
   *   - 探活 code=0：复用该 token（顺带省一次 /login）。
   *   - code=100101 吊销：一律抛（两类会话都强制回登录）。
   *   - 其它失效（如 100102 过期）：扫码会话无密码救不了→抛回登录；**密码会话**才落到下面 /login 自愈。
   *  抛出的 auth 码由 openSocket 现有分支路由到 onAuthError；网络失败抛非 auth 错，继续重连。 */
  private async fetchToken(uid: string, password: string): Promise<string> {
    if (this.token) {
      const probe = await fetchEnvelope("/api/v1/devices", {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (probe.code === 0) return this.token; // 仍有效，复用
      if (probe.code === 100101 || this.sessionToken) {
        // 100101 吊销(两类会话)；或扫码会话无密码、任何失效都救不了 → 回登录。
        const e = new Error(friendlyMessage(probe.code, probe.message || "登录已失效")) as Error & { code?: number };
        e.code = probe.code;
        throw e;
      }
      // 密码会话 + 非吊销（如 100102 过期）→ 落下去用 /login 重新签发（自愈）。
    }
    const body = await fetchEnvelope<{ token?: string }>("/api/v1/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: uid, password, platform: "web", device_id: webDeviceId(), device_name: webDeviceName() }),
    });
    if (body.code !== 0 || !body.data?.token) {
      const e = new Error(friendlyMessage(body.code, body.message || "登录失败")) as Error & { code?: number };
      e.code = body.code; // 带上业务码，供重连区分 鉴权失败 vs 网络失败
      throw e;
    }
    return body.data.token;
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
            fileName: pend.fileName, fileSize: pend.fileSize, caption: pend.caption,
            mentions: pend.mentions, mentionAll: pend.mentionAll,
            replyToConvSeq: pend.replyToConvSeq, replySnapshot: pend.replySnapshot, replyToFrom: pend.replyToFrom, forwardFrom: pend.forwardFrom,
            groupId: pend.groupId, posterUrl: pend.poster,
            mediaW: pend.mediaW, mediaH: pend.mediaH, duration: pend.duration, thumb: pend.thumb, waveform: pend.waveform,
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
            continue;
          }
          const convId = typeof conv.conv_id === "string" ? conv.conv_id : "";
          if (!convId) continue;
          // 权威覆盖位点：服务端断言 (since, covered] 内每个 conv_seq 要么已下发、要么对本人不可见
          // （G2 history_visible 抬入群下界、「仅为我删除」隐藏项）。据此把游标直接推过这些永远拿不到的
          // 可见性空洞——不能用 latest_conv_seq（只记实际下发的最大序号，会漏跳过的空洞导致游标永久卡死）。
          const covered = Number(conv.covered_conv_seq) || 0;
          const before = this.syncedSeq.get(convId) ?? 0;
          const next = nextSyncCursor(before, covered);
          if (next > before) {
            this.updateSynced(convId, next);
            void localStore.advanceSyncCursor(this.uid, convId, next); // 消息已先落库，再持久化游标
            if (conv.has_more) this.sendSyncReq([convId]); // 从新游标继续翻页
          }
        }
        break;
      }
      case T.RECEIPT:
        this.handlers.onReceipt?.(d.conv_id, d.from, d.status, d.up_to_conv_seq);
        break;
      case T.PRESENCE:
        // 诊断：在线态链路的「收到」书挡，与本端 watch_sent、服务端 presence_online_broadcast 对账。
        logger.info(LOG_TAG.ws, "presence_applied", { user: d.user, status: d.status });
        this.handlers.onPresence?.(d.user, presenceFromFrame(d));
        break;
      case T.TYPING:
        this.handlers.onTyping?.(d.conv_id, d.from);
        break;
      case T.FRIEND:
        this.handlers.onFriend?.(d.event, d.from);
        break;
      case T.GROUP:
        this.handlers.onGroup?.(d.event, d.conv_id, d.from, d.target ?? "", d.result ?? "");
        break;
      case T.CAPS_UPDATE: // 账号级配置版本变更（M4-7）：另一端改了自动下载策略 → 本端重拉
        this.handlers.onCapabilitiesUpdate?.(Number(d.version) || 0);
        break;
      case T.MSG_OP: // 实时消息操作帧（撤回/编辑/置顶/为所有人删除）：应用到本地
        this.applyMsgOp(d);
        break;
      case T.VOICE_TRANSCRIPT: // 语音转文字结果（服务端识别完成）：交给 UI 展开面板
        this.handlers.onVoiceTranscript?.(String(d.conv_id ?? ""), Number(d.conv_seq) || 0,
          String(d.status ?? ""), String(d.text ?? ""));
        break;
      case T.MSG_HIDDEN: // 「仅为我删除」多设备同步（任务2）：本人另一端删了 → 本端物理移除
        if (d.conv_id && d.conv_seq) void this.removeMessageLocal(d.conv_id, Number(d.conv_seq), 0);
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
              fileName: pend.fileName, fileSize: pend.fileSize, caption: pend.caption,
              mentions: pend.mentions, mentionAll: pend.mentionAll,
              replyToConvSeq: pend.replyToConvSeq, replySnapshot: pend.replySnapshot,
              replyToFrom: pend.replyToFrom, forwardFrom: pend.forwardFrom,
              groupId: pend.groupId, posterUrl: pend.poster,
              mediaW: pend.mediaW, mediaH: pend.mediaH, duration: pend.duration, thumb: pend.thumb,
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
    // 「为所有人删除」直加载/同步收敛（任务2）：目标行带 deleted_at>0 → 物理移除、不入库为可见消息。
    // 对齐 recalled_at 的直渲染：不再仅依赖单独的 msg_op 事件行（拿到目标行却漏事件行时会误显已删文件）。
    if (Number(d.deleted_at) > 0 && convId && convSeq > 0) {
      void this.removeMessageLocal(convId, convSeq, isNextContiguous ? convSeq : 0);
      if (isNextContiguous) this.updateSynced(convId, convSeq);
      return;
    }
    const msg: ChatMessage = {
      serverMsgId: d.server_msg_id,
      convId: d.conv_id,
      from: d.from,
      fromNickname: d.from_nickname || undefined, // 群消息冗余带发送者昵称（空不占字段）
      fromRole: d.from_role || undefined,         // 群主/管理员气泡徽标兜底（仅 owner/admin 带）
      content: typeof d.content === "string" ? d.content : "",
      contentType: d.content_type || "text",
      fileName: d.file_name || undefined,
      fileSize: d.file_size !== undefined && Number(d.file_size) >= 0 ? Number(d.file_size) : undefined,
      caption: typeof d.caption === "string" && d.caption ? d.caption : undefined, // 图文/视频文/文件文随附文本（Telegram 图说模型）
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
      // 未下载卡片的模糊占位（M4-7）：**只认内联 data:image/ 的 JPEG/PNG**。门控的意义就是"用户点之前绝不碰网络"，
      // 若放行远程 URL，渲染 <img src> 时会在用户未下载前就去拉对端内容（追踪像素 / 泄漏 IP）——必须挡掉。
      thumb: typeof d.thumb === "string" && /^data:image\//.test(d.thumb) ? d.thumb : undefined,
      // voice 振幅指纹（P0，base64）：服务端已校验解码后 ≤120 字节；本地只做类型收口，不再验长度。
      waveform: typeof d.waveform === "string" ? d.waveform : undefined,
      // @提及（M4-8）：脏数据安全——只收字符串数组，非数组一律按"未 @ 任何人"。
      mentions: Array.isArray(d.mentions) ? (d.mentions as unknown[]).filter((x): x is string => typeof x === "string") : undefined,
      mentionAll: d.mention_all === true || undefined,
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

  /** 读取某会话被本地删除的 conv_seq（内存墓碑），供收帧时拦住服务端重同步的复现。 */
  loadDeletedSeqs(convId: string): Promise<number[]> {
    return localStore.loadDeletedSeqs(this.uid, convId);
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

  /** 上报「当前要显示在线态的用户全集」（全量替换语义，见 PROTOCOL §5.5）：服务端只把这些人的
   *  presence 变化推给本连接，并对新增者回一帧 presence 快照。空数组=取消全部关注（如退出聊天页）。
   *  订阅是连接级易失态——SDK 记住当前集合，onopen（含重连）自动重发，调用方无需管重连。 */
  watchUsers(userIDs: string[]): void {
    this.watched = Array.isArray(userIDs) ? userIDs.filter(Boolean) : [];
    // 诊断：在线态订阅链路的「发出」书挡，与服务端 watch_registered、onPresence 收到对账。
    logger.info(LOG_TAG.ws, "watch_sent", { count: this.watched.length, targets: this.watched });
    this.send({ type: T.WATCH, data: { set: this.watched } });
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

/** sync 游标推进规则（纯函数，导出供单测）：服务端 covered_conv_seq 权威覆盖 (since, covered]——
 *  区间内每个序号要么已下发、要么对本人不可见（history_visible 抬入群下界 / 「仅为我删除」隐藏项）。
 *  据此把游标推过永远拿不到的可见性空洞，破解死循环；covered 未超过当前游标则不动（空页/已追平）。 */
export function nextSyncCursor(before: number, covered: number): number {
  return covered > before ? covered : before;
}

/** 注册账号：POST /api/v1/register {username, password}。成功 resolve，失败抛带服务端文案的 Error。
 *  独立于连接（注册时还没建 IMClient/socket），故为模块级函数。 */
export async function registerAccount(username: string, password: string): Promise<void> {
  const body = await fetchEnvelope("/api/v1/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (body.code !== 0) {
    throw new Error(friendlyMessage(body.code, body.message || "注册失败"));
  }
}

/** 概括本机为「浏览器 · 系统」，登录时上报作设备名（供设备管理页展示）。尽力而为，非精确。
 *  与后端 webDeviceName(UA) 同源，但浏览器端直接读 navigator，命中率更高。 */
export function webDeviceName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  if (!ua) return "网页版";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "浏览器";
  const os = /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/** 本机稳定设备 ID（对齐 iOS 的 device_id）：首次生成一枚 UUID 落 localStorage，之后复用。
 *  后端按 (uid, device_id) 顶替去重——没有它，Web 每次刷新/重登都新建一条 session，设备列表会堆满同一台。
 *  localStorage 不可用（隐私模式/禁用）或读写抛错时回退每会话临时 ID，功能降级为不去重，但不崩。 */
const DEVICE_ID_KEY = "im.deviceId";
export function webDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID(); // localStorage 不可用：退化为一次性 ID（不去重，但不阻断登录）
  }
}

