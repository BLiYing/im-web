// IMClient —— Web 端协议 SDK（对应 iOS 的 IMSocketManager）。
// 职责：登录换 token、WebSocket 连接、收发、心跳、重连、增量同步、回执；不含任何 UI。
// 默认走同源相对路径（开发期由 Vite 代理到后端，见 vite.config.ts）。

import { T, OP, type Envelope, type ChatMessage, type Conversation, type ConvUpdate, type UserCard, type MyProfile, type MsgOpPatch, type PinnedMessage, } from "./protocol";
import { createProbeWatchdog, runWake } from "./wake";
import { platform } from "../platform";
import { IMRestApi, FAVORITES_PAGE_SIZE } from "./imSdk.rest";
import { parseConvBumpItems } from "./convBump";
import { planEntryWindow, planJumpToLatest, planBumpCatchUp, nextHistoryFloor, type WindowPlan } from "../windowPlan";
import { shouldHealGap, nextSyncCursor } from "./syncCursor";
import type { ConvBumpItem, WindowMeta } from "./protocol";
import { presenceFromFrame, type Presence } from "./presence";
import { type MentionSpan } from "../mention";
import { parseIncomingMessage } from "./parseMessage";
import * as localStore from "./localStore";
import { loadRanges, registerRange, updateRangesHead } from "./localStore.ranges";
import { addRange, normalizeRanges, type SeqRange } from "./ranges";
import { LOG_TAG, logger } from "../logging/logger";
import { tracedFetch, tracedUpload, fetchEnvelope, callJson, setTokenRescue, type UploadProgressHandler } from "./http";
// isAuthCode：「鉴权失败类错误码」判据（对齐 errcode / iOS IMIsAuthErrorCode），与续期同源，故同住一个模块。
import { acquireToken, createRenewer, isDeadCredential as isAuthCode } from "./tokenSession";
import { startChunkedUpload, CHUNKED_THRESHOLD } from "./chunkedUpload";
import { friendlyMessage } from "./errcode";
import * as voiceApi from "./voiceApi"; import { t } from "../i18n";

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
  /** **仅失败重发**指定：沿用原 client_msg_id 吃服务端幂等去重（见 sdk/resend.ts）。首发一律不传。 */
  clientMsgId?: string;
}

export interface IMClientHandlers {
  onState?: (state: ConnState) => void;
  onMessage?: (msg: ChatMessage, live: boolean) => void;   // live=true 实时 new_msg；false=同步/开窗批量（离线积压、翻页）。**面向用户的提示必须先看这一位**：批量投递是历史，提示它等于把历史重提一遍（桌面端曾因此重连后一次弹几十条通知）
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
  /** 续期凭据变了，**须立刻落盘**：登录下发、改密码轮换（新的一枚）、或凭据已死（空串=清掉）。
   *  端上存它而不是明文密码——密码不可吊销，"注销某台设备"对存密码的客户端完全无效。 */
  onRefreshToken?: (refreshToken: string) => void;
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
  /**
   * 超级群轻量信号：一批「某会话最新到 conv_seq 了」。**没有正文**——
   * UI 据此刷新会话列表那一行（预览+角标），真要看内容得进会话时 sync。
   */
  onConvBump?: (items: ConvBumpItem[]) => void;
  /**
   * 窗口到达：消息本身已走常规落库，这里只回传**边界信息**。
   * 调用方据 anchorFound 决定是滚动高亮还是提示"原消息已被删除"。
   */
  onWindow?: (meta: WindowMeta) => void;
  /**
   * 一页历史到达（loadOlder / loadNewer / openConversation 发出的单页 sync_req 的响应，含被拒与空页）。
   * 消息本身已走 onMessage 逐条上屏，这里只告诉 UI「那次请求结束了」——UI 的分页忙标志据此解除，
   * 不必再靠"渲染集边界动了没"去猜（页里全是本地已有的、或已到可见下界回空页时边界就不会动）。
   * count=本页实际下发条数（被拒时为 0）。
   */
  onHistoryPage?: (convId: string, since: number, count: number) => void;
  /**
   * 该会话的「本地有哪几段」变了（预热/整页落库/开窗）。UI 据此重算渲染切段——
   * 切段要判断"两条消息之间是没下载、还是本就不成为消息"，只能问区间清单。
   */
  onRanges?: (convId: string) => void;
  /** 语音转文字结果到达（服务端识别完成，见 IMServer docs/design/VOICE_TRANSCRIBE_DESIGN.md §3.2）。 */
  onVoiceTranscript?: (convId: string, convSeq: number, status: string, text: string) => void;
}

export { FAVORITES_PAGE_SIZE };  // 实处在 imSdk.rest.ts；调用点仍从 imSdk 引入，位置变化不外溢

export class IMClient extends IMRestApi {
  private ws: WebSocket | null = null;
  private seq = 0;
  /** 登录凭据（公开句柄）。重连要用它重新 /login——登录接口不认内部 ID。 */
  private username = "";
  private uid = "";
  private password = ""; // 登录密码（为空=开发期免密直签）；仅用于（重）连时换 token
  private sessionToken = ""; // 扫码登录标记（置位=本会话无密码可回退）：重连探活失效时无法 /login 自愈，一律回登录
  /** 长效续期凭据（180 天绝对寿命）：免密换新 access token，替代"把明文密码存本地反复重放"。
   *  两类会话都有（密码登录由 /login 下发，扫码登录由 qr/login/poll 一次性下发）。 */
  private refreshToken = "";
  /** 过期救援（单飞）：HTTP 层撞 100102 时调。凭据已死 → 擦掉 + 停重连 + 回登录页。 */
  private renewToken = createRenewer({
    getRefreshToken: () => this.refreshToken,
    onRenewed: (token) => { this.token = token; },
    onDead: (code, message) => {
      this.refreshToken = ""; this.handlers.onRefreshToken?.("");
      this.manualClose = true; // 别让"凭据已死"退化成一次临时抖动被自动重连盖过去
      this.handlers.onAuthError?.(message || t("common.login_expired"), code);
    },
  });

  /** 当前 JWT（只读），给不挂在 IMClient 上的无状态 HTTP 模块用（sdk/serverConfigApi.ts 等）。
   *  **别在外面另存一份**：登录路径有密码/免密/扫码三条，各自拿到 token 的时机不同，
   *  外部副本必然漂移——第一版就这么错过，结果是静默 401、界面只表现为"列表是空的"。 */
  get authToken(): string { return this.token; }
  private state: ConnState = "disconnected";
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private wakeStop: (() => void) | null = null;           // 浏览器唤醒监听的拆除函数（见 sdk/wake.ts）
  private probeWatchdog = createProbeWatchdog(() => { if (!this.manualClose) this.ws?.close(); }); // 探活无 PONG → 关掉僵尸 socket，交既有重连
  private connectionGeneration = 0; // 使切账号/新重连之前仍在途的登录与 socket 回调失效
  private manualClose = false;
  private syncedSeq = new Map<string, number>(); // convId -> 已连续接上的 conv_seq（不能用“见过的最大值”越过空洞）
  private tracked = new Set<string>(); // 重连后需增量同步的会话
  private watched: string[] = []; // 当前在线态关注全集（watch），onopen/重连后自动重发
  private syncingConvs = new Set<string>(); // 正在断线补偿/空洞自愈，避免连发消息触发重复 sync_req
  // 离线积压（OFFLINE_BACKLOG_DESIGN §4.4/§4.5）：
  private superConvs = new Set<string>();  // 超级群：max_gap=0，正文只在打开会话时按需取，永不自动补拉
  private headSeq = new Map<string, number>(); // convId -> 服务端最新位点（sync_resp.head_conv_seq / conv_bump.latest_seq）
  private gapped = new Set<string>();       // 收到过 too_long，即本地对该会话有缺口
  // 可见下界的**位点**（未知为 0），由 window_resp 的 has_before=false 记下；此前靠 `上沿 > 1`
  // 猜，而 G2 把新成员的下界抬到入群位点，那个猜法对他们恒真。为什么是位点不是布尔：见 floorFromWindow。
  private floorSeq = new Map<string, number>();
  // 区间清单的**内存镜像**（IndexedDB 里那份为准，这里只为让渲染层能同步读到）。
  // 渲染切段必须知道"两条消息之间那些 conv_seq 到底是没下载、还是下载过但本就不是一条消息"——
  // msg_op 事件行、已被「为所有人删除」的墓碑、对我不可见的行都会占掉 conv_seq 却永远不成为消息。
  // 只看 seq 连不连号会把它们全当成缺口（2026-09-03 实测：18 条的大群里删了一张图，
  // 尾段被切成"最后那条系统消息"一条，界面看着就是空的）。
  private convRanges = new Map<string, SeqRange[]>();
  // delivered 回执合批（§4.8）：回执是**单调位点**，合批零语义损失，而逐条发在补拉 10 万条时
  // 就是 10 万个上行帧、且服务端每帧要做一次群快照 + 成员鉴权。
  private pendingReceipts = new Map<string, number>(); // convId -> 待上报的最大 conv_seq
  private receiptTimer: ReturnType<typeof setTimeout> | null = null;
  private syncPending = new Map<number, string[]>(); // request seq -> convIds；响应/错误时精确释放 in-flight
  private pendingSends = new Map<string, { convId: string; content: string; contentType: string; timestamp: number; fileName?: string; fileSize?: number; caption?: string; mentions?: string[]; mentionAll?: boolean; mentionSpans?: MentionSpan[]; replyToConvSeq?: number; replySnapshot?: string; replyToFrom?: string; forwardFrom?: string; groupId?: string; poster?: string; mediaW?: number; mediaH?: number; duration?: number; thumb?: string; waveform?: string }>(); // client_msg_id -> 待确认发送（ack 后落库）
  private pendingOps = new Map<string, { op: string; convId: string; targetConvSeq: number }>(); // client_msg_id -> 待确认的消息操作（撤回/编辑/置顶），供失败回滚
  private sendTimers = new Map<string, number>(); // client_msg_id -> 发送超时计时器（超时未 ack → 标失败）
  private readonly historyPage = 200; // 每页历史条数（与服务端 syncPageLimit 对齐）
  private readonly contextBefore = 10; // 进会话时未读分割线上方保留的已读上下文条数
  // maxGap：连上时**顺手补齐**与**留成缺口**的分水岭（两端同值，CHAT_UX §2 三端契约）。
  // 2 页 = 400 条：正常用户离线一晚攒的量远在此之下，走的还是老路径，什么都没变；
  // 只有"10 万条大群"这种会话才会留缺口——而那种会话本来就不该被当作本地齐全。
  private readonly maxGap = 400;
  private handlers: IMClientHandlers;

  constructor(handlers: IMClientHandlers = {}) {
    super();
    this.handlers = handlers;
  }

  get currentState(): ConnState {
    return this.state;
  }
  get userId(): string {
    return this.uid;
  }

  /** 连接：先登录换 token，再用 ?token= 连 ws。password 为空走开发期免密直签。
   *  首次登录失败（如密码错误）会抛错给调用方显示；之后的断线重连仍静默重试。
   *
   *  **入参是 username（公开句柄），不是内部 ID**——登录接口只认前者。
   *  真正的身份（10 位内部 ID）由登录响应带回并写进 this.uid，之后一切 conv_id 推导、
   *  本地库分区、接口参数都用它。见 IMServer/docs/ACCOUNT_IDENTITY_REDESIGN.md。 */
  async connect(username: string, password = "", refreshToken = ""): Promise<void> {
    if (this.uid && this.username !== username) {
      // IMClient 是可复用 SDK；切换账号时绝不能沿用上个 uid 的会话游标。
      this.syncedSeq.clear();
      this.tracked.clear();
      this.syncingConvs.clear();
      this.syncPending.clear();
      this.pendingOps.clear();
      this.sendTimers.forEach((timer) => clearTimeout(timer));
      this.sendTimers.clear();
      this.pendingSends.clear();
      this.token = "";
    }
    this.username = username;
    this.password = password;
    this.refreshToken = refreshToken;
    this.sessionToken = ""; // 密码登录路径：清掉可能残留的扫码 token，避免重连误用旧会话
    this.manualClose = false;
    this.clearReconnectTimer();
    setTokenRescue(this.renewToken); // HTTP 层撞 100102 即自动续期重试（见 sdk/http.ts callJson）
    this.wakeStop ??= platform().subscribeWake((r) => this.reconnectNow(r));
    logger.info(LOG_TAG.ws, "connect_requested", { username, via: refreshToken ? "refresh" : "credential" });
    await this.openSocket(true);
  }

  /** 用扫码登录换来的 JWT 直接建立会话（无密码）。
   *  断线重连复用该 token 并做一次鉴权探活：被踢下线/过期(auth 码)即回登录，网络失败继续重试。 */
  async connectWithToken(uid: string, token: string, refreshToken = ""): Promise<void> {
    if (this.uid && this.uid !== uid) {
      // 与 connect() 同款切账号清理：绝不沿用上个 uid 的游标/在途状态。
      this.syncedSeq.clear();
      this.tracked.clear();
      this.syncingConvs.clear();
      this.syncPending.clear();
      this.pendingOps.clear();
      this.sendTimers.forEach((timer) => clearTimeout(timer));
      this.sendTimers.clear();
      this.pendingSends.clear();
    }
    this.uid = uid;
    this.password = "";
    this.sessionToken = token;
    this.token = token;
    this.refreshToken = refreshToken; // 2026-09-06 起扫码登录也下发；空=老票据，仍是 24h 会话
    this.manualClose = false;
    this.clearReconnectTimer();
    setTokenRescue(this.renewToken);
    this.wakeStop ??= platform().subscribeWake((r) => this.reconnectNow(r));
    logger.info(LOG_TAG.ws, "connect_requested", { user_id: uid, via: "qr_login" });
    await this.openSocket(true);
  }

  /** **立即重连/探活**：浏览器唤醒信号（`online` / 标签页重新可见）触发，也可手动调。
   *  判据与动作见 `sdk/wake.ts`（指数退避最长 30s，断网恢复干等一档是用户能直接看见的"卡住"）。 */
  reconnectNow(reason: string): void {
    const action = runWake(this.state, this.manualClose, {
      probe: () => { this.send({ type: T.PING, seq: ++this.seq }); this.probeWatchdog.arm(); },
      reconnect: () => { this.clearReconnectTimer(); this.reconnectAttempts = 0; void this.openSocket(); },
    });
    if (action === "none") logger.debug(LOG_TAG.ws, "wake_ignored", { reason, state: this.state, manual: this.manualClose });
    else logger.info(LOG_TAG.ws, "wake", { reason, action, attempts: this.reconnectAttempts });
  }

  disconnect(): void {
    logger.info(LOG_TAG.ws, "disconnect_requested", { user_id: this.uid });
    this.wakeStop?.(); this.wakeStop = null; this.probeWatchdog.clear();
    this.manualClose = true;
    this.connectionGeneration++;
    this.stopPing();
    this.clearReconnectTimer();
    this.sendTimers.forEach((tm) => clearTimeout(tm)); // 退出后别再触发"发送失败"回调
    this.sendTimers.clear();
    this.pendingSends.clear();
    this.syncedSeq.clear();
    this.tracked.clear();
    this.syncingConvs.clear();
    this.syncPending.clear();
    // 离线积压相关的连接级状态：切账号/退出必须一并清，否则新账号会继承上一个账号的
    // 缺口标记与 head 快照（同一个 convId 在两个账号下可见范围不同，串了就是错的）。
    if (this.receiptTimer !== null) { clearTimeout(this.receiptTimer); this.receiptTimer = null; }
    this.pendingReceipts.clear();
    this.superConvs.clear();
    this.headSeq.clear();
    this.convRanges.clear();
    this.gapped.clear();
    this.floorSeq.clear();
    this.pendingOps.clear();
    this.ws?.close(1000);
    this.ws = null;
    this.sessionToken = ""; // 退出后不再复用扫码 token
    this.refreshToken = "";  // 长效凭据同样不留：否则残留的在途请求还能续出一枚新 token
    setTokenRescue(null);
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

  /** 恢复出厂默认（草图 §05-3「重置自动下载设置」）。 */
  async resetDownloadSettings(): Promise<{ version: number; settings: unknown }> {
    return (await this.api("/api/v1/download-settings/reset", { method: "POST" })) as { version: number; settings: unknown };
  }

  /** 修改密码：POST /api/v1/users/me/password {old_password,new_password}。
   *  成功后服务端会**自动下线本账号其它全部设备**（只保留当前，安全默认），无需前端再调 revoke-others。
   *  失败抛带 .code 的 Error（200002=旧密码错，100001/参数类=强度不足等），文案已本地化。 */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const data = await this.api("/api/v1/users/me/password", {
      method: "POST",
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
    // 改密时服务端**轮换本机这枚续期凭据**（唯一的轮换点），新的一枚只在这次响应里出现。
    // 不接住的话本地那枚当场作废，下次冷启动就被弹回登录页——刚在本机改完密码就要重登。
    if (typeof data?.refresh_token === "string" && data.refresh_token) this.adoptRefreshToken(data.refresh_token);
  }

  /** 链接富预览：抓取 URL 的 OG 元信息（后端带 SSRF 防护 + 缓存）。失败抛错，调用方回退纯链接。 */
  async linkPreview(url: string): Promise<{ url: string; title?: string; description?: string; image?: string; site_name?: string }> {
    return await this.api(`/api/v1/link-preview?url=${encodeURIComponent(url)}`);
  }

  /** 翻译文本（M4-5）：POST /api/v1/translate → 译文（服务端代理 + 缓存）。 */
  async translate(text: string, targetLang = "zh"): Promise<string> {
    const data = await this.api("/api/v1/translate", { method: "POST", body: JSON.stringify({ text, target_lang: targetLang }) });
    return (data?.translation ?? "") as string;
  }

  /** 举报（AG）：POST /api/v1/reports。targetType=message|user|group。
   *  `convSeqs` 非空 = 多选态批量举报同一发送者的多条（2026-09-06）：服务端按**首条**作处置锚点
   *  合成**一张**工单（勾 N 条不会刷出 N 张单），≤100 条且 convId 必填；此时 targetId 传首条即可。 */
  async report(targetType: "message" | "user" | "group", targetId: string, reason: string, convId = "", convSeqs?: number[]): Promise<void> {
    await this.api("/api/v1/reports", {
      method: "POST",
      body: JSON.stringify({ target_type: targetType, target_id: targetId, conv_id: convId, reason, ...(convSeqs?.length ? { target_seqs: convSeqs } : {}) }),
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

  /** 读取他人完整名片：GET /api/v1/users/{id}（与 fetchUserPresence 同端点，取资料而非在线态）。
   *  资料面板据此把「入口透传的快照」换成服务端权威值——名片卡进来的就是一份冻结快照，
   *  不拉这一次就永远显示旧昵称旧头像（CONTACT_CARD_DESIGN §6）。
   *  已注销时 api() 抛出的 Error.code 为 200001，由调用方转空态。直接 as（同 searchUsers 口径）。 */
  async userProfile(userId: string): Promise<UserCard> {
    return (await this.api(`/api/v1/users/${encodeURIComponent(userId)}`)) as UserCard;
  }

  /** 整体更新本人资料（PUT 语义）：PUT /api/v1/users/me。 */
  async updateMyProfile(p: { nickname: string; avatar_url: string; phone: string; tags: string[] }): Promise<MyProfile> {
    const data = await this.api("/api/v1/users/me", { method: "PUT", body: JSON.stringify(p) });
    return data as MyProfile;
  }

  /** 修改公开句柄：POST /api/v1/users/me/username，回整张名片。
   *
   *  **不影响登录态**（服务端不吊销会话，JWT 带的是内部 ID + sid），但调用方须把新 username
   *  写回本地会话，否则刷新后的静默重登会拿旧名去 /login。旧名立即释放、可被他人注册。 */
  async updateMyUsername(username: string): Promise<MyProfile> {
    const data = await this.api("/api/v1/users/me/username", { method: "POST", body: JSON.stringify({ username }) });
    this.username = username; // 断线重连要用它重新 /login
    return data as MyProfile;
  }

  /** 进会话：建立重连基线 + 加载初始可视窗口（见 CHAT_UX §3）。
   *  - 有未读：从 readSeq-上下文 起一页，锚定到首条未读；
   *  - 无未读：加载最近一页，贴底。
   *  latestSeq 仅用于选择 UI 首屏窗口，不代表此前消息已经连续持久化。
   *
   *  **「有没有未读」必须传真实未读数，不能用 `latestSeq > readSeq` 顶替**（2026-09-03 修）：
   *  服务端的未读计数排除本人消息（`CountUnreadSince` 带 `sender <> ?`），所以**发送方**的读位点
   *  天然落后于自己刚发的那一堆——压测灌完 1 万条后，user1001 自己进会话时 unread=0 而
   *  latest 比 read_seq 大一万，旧判据据此锚到一万条之前的位置：不贴底、↓N 显示一大串，
   *  用户以为消息没发出去。iOS 一直用的就是真实未读数（entryUnread），此处对齐。 */
  openConversation(convId: string, readSeq: number, latestSeq: number, unread: number, localNewest = 0): void {
    if (!convId) return;
    const newlyTracked = !this.tracked.has(convId);
    this.tracked.add(convId);
    if (!this.syncedSeq.has(convId)) this.syncedSeq.set(convId, 0);
    if (newlyTracked) this.sendSyncReq([convId]);
    // 预热区间镜像：刷新后内存是空的，而"本地有哪几段"只有 IndexedDB 里那份记得。
    // 不预热的话，重进会话的第一屏又会按 seq 连号去切段，老毛病原样复现。
    void loadRanges(this.uid, convId).then(({ ranges, head }) => {
      if (ranges.length > 0) {
        const merged = normalizeRanges([...(this.convRanges.get(convId) ?? []), ...ranges]);
        this.convRanges.set(convId, merged);
        this.handlers.onRanges?.(convId);
      }
      if (head > 0) this.headSeq.set(convId, Math.max(this.headSeq.get(convId) ?? 0, head));
    }).catch(() => { /* 目录读不出来 → 当作没有，下面照常问服务端 */ })
      .finally(() => this.fetchEntryWindow(convId, readSeq, latestSeq, unread, localNewest));
  }

  /** 首屏取数（§4.6，规则见 windowPlan.ts）：先查目录再决定问谁。**刻意排在区间预热之后**——
   *  目录只有 IndexedDB 那份记得，不等它＝每次刷新后的第一次进会话都必然打一次网络。 */
  private fetchEntryWindow(convId: string, readSeq: number, latestSeq: number, unread: number, localNewest: number): void {
    const plan = planEntryWindow({
      ranges: this.rangesOf(convId), head: this.headSeq.get(convId) ?? 0, localNewest,
      readSeq, latestSeq, unread, contextBefore: this.contextBefore, historyPage: this.historyPage,
    });
    if (plan.source === "local") {
      // 本地已齐全：一个请求都不发。仍要报一次「取数结束」——忙标志只由响应帧解除，而这一路没有响应帧。
      this.handlers.onHistoryPage?.(convId, 0, 0);
      return;
    }
    this.requestWindow(convId, plan.anchor, plan.before, plan.after);
  }

  /** 加载 oldestSeq 之前的一页（上滚到本地这一段的头部触发；调用方先过 windowPlan.moreLocalAbove）。 */
  loadOlder(convId: string, oldestSeq: number): void {
    if (!convId || oldestSeq <= 1) return;
    if (oldestSeq <= (this.floorSeq.get(convId) ?? 0)) { this.handlers.onHistoryPage?.(convId, 0, 0); return; } // 已在可见下界
    this.requestWindow(convId, oldestSeq, this.historyPage, 0);
  }

  /** 加载 newestSeq 之后的一页（下滚到底、且还没到 latest 时触发）。 */
  loadNewer(convId: string, newestSeq: number): void {
    if (!convId) return;
    this.requestWindow(convId, newestSeq, 0, this.historyPage);
  }

  /**
   * **以某条消息为锚点取一段窗口**（IMServer/docs/design/MESSAGE_WINDOW_DESIGN.md）。
   *
   * anchor=0 表示"取最新"（进会话用）。所有"跳到第 X 条"的场景都走它——**一次请求直达**，
   * 不必像旧实现那样从最新往前翻最多 40 页（翻满还找不到就报出假的「已被删除」）。
   */
  requestWindow(convId: string, anchor: number, before: number, after: number): void {
    if (!convId || !this.isSocketOpen()) return;
    this.send({ type: T.WINDOW_REQ, seq: ++this.seq, data: { conv_id: convId, anchor, before, after } });
  }

  /**
   * ↓ 跳到底（C4，OFFLINE_BACKLOG_DESIGN §4.8）：最后一页本地不齐才 `window_req(anchor=0)`，判据见 windowPlan.planJumpToLatest。
   * **返回是否真的发了请求**——没发就不会有响应帧，调用方别挂着等「数据到了再滚」。
   */
  jumpToLatest(convId: string, latestSeq: number, localNewest: number): boolean {
    return this.runWindowPlan(convId, planJumpToLatest({
      ranges: this.rangesOf(convId), head: this.headOf(convId), latestSeq, localNewest, historyPage: this.historyPage,
    }));
  }

  /** 超级群 conv_bump 到了、会话正开着（C4）：只在贴底跟随时补，补哪一窗见 windowPlan.planBumpCatchUp。
   *  C4 之前这里是「从本地最大 seq 往后拉一页」（已删的 syncConversation）——用户停在旧岛上时拉回来的是缺口开头那一页。 */
  catchUpOnBump(convId: string, latestSeq: number, localNewest: number, following: boolean): boolean {
    return this.runWindowPlan(convId, planBumpCatchUp({
      ranges: this.rangesOf(convId), head: this.headOf(convId), latestSeq, localNewest, historyPage: this.historyPage, following,
    }));
  }

  private runWindowPlan(convId: string, plan: WindowPlan): boolean {
    if (!convId || plan.source === "local" || !this.isSocketOpen()) return false;
    this.requestWindow(convId, plan.anchor, plan.before, plan.after);
    return true;
  }

  /** 发送文本，返回 client_msg_id。opts.replyTo=引用回复（M4-2）；opts.forwardFrom=转发溯源（M4-3）。 */
  sendText(content: string, to: string, convId: string, opts?: { replyTo?: { convSeq: number; preview: string; from?: string }; forwardFrom?: string; mentions?: string[]; mentionAll?: boolean; mentionSpans?: MentionSpan[] }): string {
    return this.sendContent(content, "text", to, convId, opts);
  }

  /** 发送富媒体（图片/文件，M4-6）：content=已上传的 URL，contentType=image|video|file。
   *  opts.forwardFrom=转发溯源；opts.groupId=相册分组；opts.poster=视频封面首帧 URL（M4+，收端直显免解码）。 */
  sendMedia(url: string, contentType: string, to: string, convId: string, opts?: MediaSendOptions & { replyTo?: { convSeq: number; preview: string; from?: string } }): string {
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
    if (body.code !== 0 || !body.data) throw new Error(friendlyMessage(body.code, body.message || t("net.error.upload_failed")));
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
   * 返回 `/avatars/<hash>.jpg` 相对 URL。与聊天媒体分离、永不清理（见 docs/mechanism/AVATAR_STORAGE_DESIGN.md）。
   * 入参为裁切并缩到 ≤256px 的 JPEG blob；头像小，一次性 multipart，无需分片/进度。
   */
  async uploadAvatar(blob: Blob): Promise<{ url: string }> {
    const fd = new FormData();
    fd.append("file", blob, "avatar.jpg"); // 文件名带 .jpg，命中服务端扩展名白名单
    const auth = { Authorization: `Bearer ${this.token}` };
    const resp = await tracedFetch("/api/v1/avatar", { method: "POST", headers: auth, body: fd });
    const body = await resp.json().catch(() => ({ code: -1, data: {} as Record<string, unknown> }));
    if (body.code !== 0 || !body.data) throw new Error(friendlyMessage(body.code, body.message || t("net.error.avatar_upload_failed")));
    return { url: body.data.url as string };
  }

  /** 共用发送通道：content + content_type + 可选引用/转发。 */
  private sendContent(content: string, contentType: string, to: string, convId: string, opts?: MediaSendOptions & { replyTo?: { convSeq: number; preview: string; from?: string }; mentions?: string[]; mentionAll?: boolean; mentionSpans?: MentionSpan[] }): string {
    const clientMsgId = opts?.clientMsgId ?? crypto.randomUUID(); // 只有失败重发会指定（见 sdk/resend.ts）
    // ack 后落库：记住内容类型 + 引用定位/快照 + 转发溯源 + 相册分组 + 视频封面（本端即时预览，重进会话仍在）。
    this.pendingSends.set(clientMsgId, { convId, content, contentType, timestamp: Date.now(),
      fileName: opts?.fileName, fileSize: opts?.fileSize, caption: opts?.caption,
      mentions: opts?.mentions, mentionAll: opts?.mentionAll, mentionSpans: opts?.mentionSpans, // 落库供刷新后 @ 高亮与转发重发（强提醒）
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
    if (opts?.mentionSpans?.length) { data.mention_spans = opts.mentionSpans.map((sp) => ({ offset: sp.offset, length: sp.length, user_id: sp.uid })); }
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
    // 首次密码登录时 this.uid 还是空的（内部 ID 要等登录响应），故这里用 username 作日志与
    // 竞态校验的身份标识；扫码路径 this.username 为空、this.uid 已知，两者取其一即可。
    const identity = this.username || this.uid;
    const password = this.password;
    const previousSocket = this.ws;
    this.ws = null;
    previousSocket?.close(1000);
    this.stopPing(); this.probeWatchdog.clear();
    this.setState("connecting");
    logger.info(LOG_TAG.ws, "connecting", {
      user_id: identity,
      attempt: this.reconnectAttempts + 1,
    });
    let token: string;
    try {
      const got = await this.fetchToken(password);
      if (generation !== this.connectionGeneration || this.manualClose || identity !== (this.username || this.uid)) return;
      token = got.token;
      this.uid = got.uid; // 权威身份：一切本地分区/conv_id 推导从此刻起用它
      this.token = token;
    } catch (e) {
      if (generation !== this.connectionGeneration || this.manualClose || identity !== (this.username || this.uid)) return;
      this.setState("disconnected");
      logger.warn(LOG_TAG.ws, "login_failed", {
        user_id: identity,
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
        this.handlers.onAuthError?.((e as Error).message || t("common.login_expired"), code);
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
        user_id: this.uid,
        tracked_conversations: this.tracked.size,
      });
      this.reconnectAttempts = 0;
      this.floorSeq.clear();   // 下界会**变小**（群主关掉「仅可见入群后历史」），陈旧＝该会话再也翻不上去；head/gapped 自纠错，不清
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
        user_id: this.uid,
        code: event.code,
        reason: event.reason || "-",
        clean: event.wasClean,
        manual: this.manualClose,
      });
      this.stopPing();
      this.syncingConvs.clear(); // 此连接上未返回的 sync_resp 已失效，重连后重新补偿
      this.syncPending.clear();
      this.setState("disconnected");
      if (!this.manualClose) this.scheduleReconnect();
    };
    ws.onerror = () => {
      if (ws !== this.ws || generation !== this.connectionGeneration) return;
      logger.warn(LOG_TAG.ws, "socket_error", { user_id: this.uid });
      ws.close();
    };
  }

  /** 取本次（重）连要用的 token：判据与三条路（探活 / 续期 / 凭据登录）全在 `sdk/tokenSession.ts`。
   *  抛出的 auth 码由 openSocket 现有分支路由到 onAuthError；网络失败抛非 auth 错，继续重连。 */
  private async fetchToken(password: string): Promise<{ token: string; uid: string }> {
    const got = await acquireToken({
      token: this.token, refreshToken: this.refreshToken, username: this.username, password,
      qrSession: !!this.sessionToken, device: { deviceId: platform().deviceId(), deviceName: platform().deviceName() },
    }, this.uid);
    if (got.refreshToken) this.adoptRefreshToken(got.refreshToken); // 只有 /login 下发；触发登录的入口不止一处，故收口在此
    return { token: got.token, uid: got.uid };
  }

  /** 收下一枚新的续期凭据：内存记一份，并通知外层落盘（App 存 localStorage）。 */
  private adoptRefreshToken(token: string): void {
    this.refreshToken = token;
    this.handlers.onRefreshToken?.(token);
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
            mentions: pend.mentions, mentionAll: pend.mentionAll, mentionSpans: pend.mentionSpans,
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
        const requestedConvs = this.syncPending.get(responseSeq) ?? [];
        this.syncPending.delete(responseSeq);
        requestedConvs.forEach((convId) => this.syncingConvs.delete(convId));
        for (const conv of d.conversations || []) {
          const pageMsgs: ChatMessage[] = [];
          for (const m of conv.messages || []) this.processIncoming(m, false, (msg) => pageMsgs.push(msg));
          const convId = typeof conv.conv_id === "string" ? conv.conv_id : "";
          if (!convId) continue;
          // head 快照：服务端会话真实最新位点（仅在带了 max_gap 时下发）。↓N 计数与"还差多少"都用它。
          const head = Number(conv.head_conv_seq) || 0;
          if (head > 0) {
            this.headSeq.set(convId, Math.max(this.headSeq.get(convId) ?? 0, head));
            void updateRangesHead(this.uid, convId, head);
          }
          // 积压超过 max_gap（OFFLINE_BACKLOG_DESIGN §4.4）：服务端一条正文都没给，
          // 只告诉我们"最新到哪了"。**绝不推游标、绝不登记区间**——没下载就不许宣称拿到，
          // 那一段登记成缺口，之后由 window_req 按需开窗补。
          if (conv.too_long) {
            this.gapped.add(convId);
            logger.info(LOG_TAG.ws, "sync_backlog_too_long", {
              conv_id: convId, since: this.syncedSeq.get(convId) ?? 0, head,
            });
            continue;
          }
          // 权威覆盖位点：服务端断言 (since, covered] 内每个 conv_seq 要么已下发、要么对本人不可见
          // （G2 history_visible 抬入群下界、「仅为我删除」隐藏项）。据此把游标直接推过这些永远拿不到的
          // 可见性空洞——不能用 latest_conv_seq（只记实际下发的最大序号，会漏跳过的空洞导致游标永久卡死）。
          const covered = Number(conv.covered_conv_seq) || 0;
          const before = this.syncedSeq.get(convId) ?? 0;
          const next = nextSyncCursor(before, covered);
          if (next > before) {
            this.updateSynced(convId, next);
            // 整页原子提交：本页消息 + 游标推进 + 区间登记同一个事务（§4.8）。
            // 事务失败则三者都不动，下次从原位幂等重拉——"消息没落库就绝不越过"在页粒度上照旧成立。
            this.noteRange(convId, before + 1, next);
            void localStore.saveIncomingPage(this.uid, pageMsgs, next, before + 1, next, head)
              .then((okPage) => {
                if (okPage && conv.has_more) this.sendSyncReq([convId]); // 落库成功才继续翻页
              });
          }
          // 追平了就不再是"有缺口"（缺口只会收窄，不会扩大）。
          if (!conv.has_more && (head === 0 || next >= head)) this.gapped.delete(convId);
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
      case T.WINDOW_RESP: { // 锚点窗口到达：消息走常规落库，边界信息交给 UI 决定滚动/提示
        const pageMsgs: ChatMessage[] = [];
        for (const m of d.messages || []) this.processIncoming(m, false, (msg) => pageMsgs.push(msg));
        // 开窗拿回来的这一段同样"我已齐全"：服务端把 [min, max] 之间对我可见的都给了。
        // 不登记的话，下次上翻到这一段边缘还会误判成缺口，而且渲染切段会把它切开。
        //
        // **必须连同消息一起落盘**（2026-09-05 实测踩出来的）：此前只 `noteRange` 进内存镜像，
        // 消息倒是按条进了 IndexedDB。于是刷新一次，这一段的"我已齐全"就没了，而消息还在——
        // 渲染切段（renderWindow.contiguousSegments）没有清单可依就退回**按 seq 连号**判断，
        // 被 msg_op 事件行 / 墓碑 / 对我不可见的行一刀刀切成碎岛：20000 人大群里点置顶跳过去，
        // 本该是开窗取回的那 60 多条，实际只渲染出 seq 1..13 十三条，整屏都放得下。
        // 上一轮 ↓N 的「区间覆盖」判据同样吃这份清单，刷新后一并失效。
        // 走 saveIncomingPage 与 sync 那一路同款：消息 + 区间同一个事务；
        // **advanceTo 传 0**——一窗是会话中间的任意一段，连续同步游标绝不能被它推过去。
        {
          const convId = String(d.conv_id ?? "");
          const seqs = (d.messages || []).map((m: { conv_seq?: number }) => Number(m.conv_seq) || 0).filter((n: number) => n > 0);
          if (seqs.length > 0) {
            const lo = Math.min(...seqs);
            const hi = Math.max(...seqs);
            this.noteRange(convId, lo, hi);
            const head = this.headSeq.get(convId) ?? 0;
            if (pageMsgs.length > 0) void localStore.saveIncomingPage(this.uid, pageMsgs, 0, lo, hi, head);
            else void registerRange(this.uid, convId, lo, hi, head); // 整窗都是 msg_op/墓碑：只落区间
          }
        }
        {
          // 上滚/下滚/进会话都走这一路（§4.6/§4.7），分页忙标志靠「响应到了」复位；不报的话一次上滚之后永久 busy。
          const cid2 = String(d.conv_id ?? "");
          this.handlers.onHistoryPage?.(cid2, Number(d.anchor) || 0, (d.messages || []).length);
          // has_before=false ⇒ 本窗下沿即可见下界。**喂 pageMsgs 不是 d.messages**（见 nextHistoryFloor）
          const nf = d.has_before === false ? nextHistoryFloor(this.floorSeq.get(cid2), pageMsgs.map((m) => m.convSeq || 0), Number(d.anchor) || 0) : 0;
          if (nf > 0) this.floorSeq.set(cid2, nf);
        }
        this.handlers.onWindow?.({
          convId: String(d.conv_id ?? ""),
          anchor: Number(d.anchor) || 0,
          anchorFound: !!d.anchor_found,
          hasBefore: !!d.has_before,
          hasAfter: !!d.has_after,
        });
        break;
      }
      case T.CONV_BUMP: { // 超级群轻量信号（无正文）：刷列表那一行；正文进会话时再 sync
        const bumps = parseConvBumpItems(d);
        // head 快照跟着走（字段注释一直写着 conv_bump.latest_seq，代码此前没接）：
        // 超级群在线不推全文，不认这一路 head 就永远停在上次 sync 的值，↓N 跟着算错。
        for (const it of bumps) {
          if (it.conv_id && it.latest_seq > 0) {
            this.headSeq.set(it.conv_id, Math.max(this.headSeq.get(it.conv_id) ?? 0, it.latest_seq));
          }
        }
        this.handlers.onConvBump?.(bumps);
        break;
      }
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
          pinned_at: d.pinned_at ?? 0, muted: !!d.muted, mute_until: Number(d.mute_until) || 0, marked_unread: !!d.marked_unread,
          cleared_at: d.cleared_at ?? 0,
        });
        break;
      case T.PONG:
        this.probeWatchdog.clear(); break; // 唤醒探活的回执：连接确实活着
      case T.ERROR: {
        const responseSeq = typeof env.seq === "number" ? env.seq : 0;
        const syncConvs = this.syncPending.get(responseSeq) ?? [];
        this.syncPending.delete(responseSeq);
        syncConvs.forEach((convId) => this.syncingConvs.delete(convId));
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
          this.handlers.onMsgOpFailed?.(op.op, op.convId, op.targetConvSeq, d.message || t("common.action_failed"));
          break;
        }
        // 带 client_msg_id 的错误 = 对某条 send_msg 的拒绝（如被拉黑）：标记该条失败 + 提示。
        if (cmid) {
          const timer = this.sendTimers.get(cmid);
          if (timer !== undefined) { clearTimeout(timer); this.sendTimers.delete(cmid); }
          const note = d.message || t("common.send_failed");
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
              mentions: pend.mentions, mentionAll: pend.mentionAll, mentionSpans: pend.mentionSpans,
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

  /**
   * @param collect 非空时**不逐条落库**，而是把消息交给调用方整页写（§4.8）。
   *   实时路径仍逐条落（一条就是一页，且要立刻持久化）；补拉路径走整页事务。
   */
  private processIncoming(d: any, healRealtimeGap = true, collect?: (m: ChatMessage) => void): void {
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
    const msg: ChatMessage = parseIncomingMessage(d);
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
    // head 是"服务端最新到哪"的快照。实时消息本身就是新的 head 证据——不推它，
    // 有缺口会话的 ↓N（head − 已读）会永远停在旧值，看着就是"来了新消息但角标不动"。
    if (msg.convSeq > 0) {
      this.headSeq.set(msg.convId, Math.max(this.headSeq.get(msg.convId) ?? 0, msg.convSeq));
    }
    if (isNextContiguous) this.updateSynced(msg.convId, msg.convSeq);
    this.sendReceipt(msg.convId, msg.convSeq); // 合批：短窗口内每会话只发一帧最大位点
    if (collect) {
      collect(msg); // 整页落库由调用方在本页全部处理完后一次事务提交
    } else {
      // 连续消息推游标；**每条**实时消息都登记 [seq, seq]（C4 §4.8：跳号不补、登记成岛，紧接尾段则并进尾段）。
      // 走整页写：消息 + 游标 + 区间同一个事务，与 sync / window 两路同款。C4 之前实时消息从不进清单，
      // 于是 ↓ / 进会话 / ↓N 的「覆盖」判据对刚收到的那几条恒判不齐，要么白问服务端、要么尾部孤岛被当成最新。
      if (msg.convSeq > 0) {
        this.noteRange(msg.convId, msg.convSeq, msg.convSeq);
        void localStore.saveIncomingPage(this.uid, [msg], isNextContiguous ? msg.convSeq : 0, msg.convSeq, msg.convSeq, this.headSeq.get(msg.convId) ?? 0);
      }
    }
    this.handlers.onMessage?.(msg, !collect);   // 无 collect = new_msg 实时帧；有 collect = 同步/开窗批量
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
  trackConversation(convId: string, syncedSeq: number, isSuper = false): void {
    if (!convId) return;
    this.tracked.add(convId);
    if (isSuper) this.superConvs.add(convId);
    else this.superConvs.delete(convId); // 群可能被降级/误标，别让一次错误标记永久粘住
    if (!this.syncedSeq.has(convId)) this.syncedSeq.set(convId, Math.max(0, syncedSeq));
  }

  /** 登记「[lo, hi] 这一段我已齐全」到内存镜像，并通知 UI 重算渲染切段。
   *  **只在真的把这一段下发的消息都收下之后才调**——"没下载就不许登记"是这套区间的正确性底座。 */
  private noteRange(convId: string, lo: number, hi: number): void {
    if (!convId || hi < lo || hi < 1) return;
    const before = this.convRanges.get(convId);
    const next = addRange(before ?? [], lo, hi);
    this.convRanges.set(convId, next);
    if (!before || before.length !== next.length || before.some((r, i) => r.lo !== next[i].lo || r.hi !== next[i].hi)) {
      this.handlers.onRanges?.(convId);
    }
  }

  /** 本地已齐全的区间（内存镜像）。渲染切段用它判断"中间那几个 seq 是没下载、还是本就不是消息"。 */
  rangesOf(convId: string): SeqRange[] {
    return this.convRanges.get(convId) ?? [];
  }

  /** `oldestSeq` 是否已踩在服务端说过的可见下界上。UI 据此不再空跑注定回空页的上滚请求；未知下界恒 false。 */
  atHistoryFloor(convId: string, oldestSeq: number): boolean {
    const floor = this.floorSeq.get(convId) ?? 0;
    return floor > 0 && oldestSeq <= floor;
  }

  /** 该会话本地是否有缺口（收到过 too_long）。上层据此决定"整会话问题"问本地还是问服务端。 */
  hasGap(convId: string): boolean {
    return this.gapped.has(convId);
  }

  /** 服务端最新位点快照（未知为 0）：↓N 计数与"还差多少"都用它，不数本地。 */
  headOf(convId: string): number {
    return this.headSeq.get(convId) ?? 0;
  }

  /** 对已登记会话发一次增量同步（从各自基线补新消息）；给了 convIds 就只同步这几个（会话刷新里新冒出来的）。 */
  syncTracked(convIds?: string[]): void {
    this.sendSyncReq(convIds ?? [...this.tracked]);
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

  /** 排队一个 delivered 回执（只留最大值），短窗口内合并成一帧。 */
  private sendReceipt(convId: string, upTo: number): void {
    if (!convId || upTo <= 0) return;
    if (upTo > (this.pendingReceipts.get(convId) ?? 0)) this.pendingReceipts.set(convId, upTo);
    if (this.receiptTimer !== null) return;
    this.receiptTimer = setTimeout(() => this.flushReceipts(), 120);
  }

  /** 把排队的 delivered 回执各发一帧（每会话只发最大位点）。 */
  private flushReceipts(): void {
    if (this.receiptTimer !== null) {
      clearTimeout(this.receiptTimer);
      this.receiptTimer = null;
    }
    for (const [convId, upTo] of this.pendingReceipts) {
      this.send({ type: T.RECEIPT, data: { conv_id: convId, status: "delivered", up_to_conv_seq: upTo } });
    }
    this.pendingReceipts.clear();
  }

  private sendSyncReq(convIds: string[]): void {
    // connect() 在 WebSocket OPEN 之前即可返回；此时不能先占用 in-flight，onopen 会统一补发。
    if (!this.isSocketOpen()) return;
    const pending = convIds.filter((c) => c && !this.syncingConvs.has(c));
    // max_gap：超级群恒 0（正文只在打开会话时拉，SUPERGROUP_DESIGN §5），其余给 this.maxGap。
    // 服务端据此判超限就回 too_long 而不查消息表——"消息因为要显示才下载"的服务端一半。
    const cursors = pending.map((c) => ({
      conv_id: c,
      since_conv_seq: this.syncedSeq.get(c) ?? 0,
      max_gap: this.superConvs.has(c) ? 0 : this.maxGap,
    }));
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

/** 注册账号：POST /api/v1/register {username, password, nickname}。成功 resolve，失败抛带服务端文案的 Error。
 *  独立于连接（注册时还没建 IMClient/socket），故为模块级函数。
 *
 *  三个字段各司其职：username 是公开句柄兼登录名（`^[a-z0-9_]{5,32}$`，大小写不敏感唯一）；
 *  nickname 是显示名（必填，任意字符）。内部 ID 由服务端分配，客户端不能指定。 */
export async function registerAccount(username: string, password: string, nickname: string): Promise<void> {
  const body = await fetchEnvelope("/api/v1/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, nickname }),
  });
  if (body.code !== 0) {
    throw new Error(friendlyMessage(body.code, body.message || t("login.error.register_failed")));
  }
}

// webDeviceName / webDeviceId 已移入 src/platform/web.ts（D1 适配层）——「本机是什么设备」是宿主能力，
// 桌面端要报 `IM Desktop · macOS 15` 而非 UA 猜测。调用点改走 platform().deviceId() / .deviceName()。

