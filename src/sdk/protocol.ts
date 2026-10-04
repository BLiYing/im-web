// 协议常量与类型，对齐 IMServer/docs/PROTOCOL.md。
// 这是 Web 端"协议 SDK"的一部分，与 iOS 的 IMProtocol/IMMessageModel 对应。

import type { PresenceLevel } from "./presence";
import type { MentionSpan } from "../mention";

export const T = {
  PING: "ping",
  PONG: "pong",
  SEND_MSG: "send_msg",
  ACK: "ack",
  NEW_MSG: "new_msg",
  RECEIPT: "receipt",
  TYPING: "typing",
  PRESENCE: "presence",
  WATCH: "watch",
  SYNC_REQ: "sync_req",
  SYNC_RESP: "sync_resp",
  FRIEND: "friend",
  GROUP: "group",
  MSG_OP: "msg_op",
  CONV_UPDATE: "conv_update",
  /** 账号级客户端配置版本变更（M4-7 自动下载策略）：收到即重拉 GET /download-settings。 */
  CAPS_UPDATE: "capabilities_update",
  /** 账号级通知设置版本变更（M5，PROTOCOL §6.13）：private/group/badge 迁到服务端后的多端同步信号，
   *  与上面的 CAPS_UPDATE 是两个独立版本序列，不要混用；收到即重拉 GET /notify-settings。 */
  NOTIFY_SETTINGS_UPDATE: "notify_settings_update",
  /** 「仅为我删除」多设备同步（任务2）：本人另一端删了某条 → 本端物理移除该 (conv_id, conv_seq)。 */
  MSG_HIDDEN: "msg_hidden",
  /**
   * 超级群（2 万人量级）的轻量投递信号：一帧带一批「某会话最新到 conv_seq 了」。
   * 超级群**不推全文** new_msg——2 万人数千在线推全文约 50MB/s，算术上不成立。
   * 正文在**打开该会话时**经 sync_req 拉。见 IMServer/docs/design/SUPERGROUP_DESIGN.md §5。
   */
  CONV_BUMP: "conv_bump",
  /**
   * 消息窗口：**以某条消息为锚点**取一段上下文（IMServer/docs/design/MESSAGE_WINDOW_DESIGN.md）。
   * 与 SYNC_REQ 的分工：sync 是"按游标推进、可推进本地已同步位点"；window 是"一次性快照，
   * 不推进任何位点"。所有"跳到第 X 条"的场景走它——一次请求直达，不用从边缘翻页。
   */
  WINDOW_REQ: "window_req",
  WINDOW_RESP: "window_resp",
  VOICE_TRANSCRIPT: "voice_transcript", // 语音转文字结果（服务端识别，只推给请求者）
  ERROR: "error",
} as const;

/** 消息操作 op（对齐后端 protocol.MsgOp*）。 */
export const OP = { RECALL: "recall", EDIT: "edit", PIN: "pin", DELETE: "delete" } as const;

export interface Envelope {
  type: string;
  seq?: number;
  data?: any;
}

export type MessageStatus = "sending" | "sent" | "failed" | "received";

export interface ChatMessage {
  clientMsgId?: string;
  serverMsgId?: string;
  convId: string;
  from: string;
  /** 发送者昵称（仅群聊消息带，服务端冗余下发；空回退 uid）。 */
  fromNickname?: string;
  /** 发送者在本群角色（仅群聊、且为 owner/admin 时带；成员表未加载/发送者已退群时的徽标兜底，见 senderRole）。 */
  fromRole?: string;
  content: string;
  contentType: string;
  fileName?: string;
  /** file 消息原始字节数；界面只格式化，不重新下载计算。 */
  fileSize?: number;
  /** 图文/视频文/文件文随附文本（Telegram 图说模型）：仅 image/video/file 有；渲染在媒体/文件卡下方，空=纯媒体。 */
  caption?: string;
  convSeq: number;
  timestamp: number;
  status: MessageStatus;
  /** 发送失败时的系统提示（如被拉黑拒收），在该条下方居中显示；微信式，不弹窗。 */
  note?: string;
  /**
   * note 对应的服务端错误码（如 200103 非好友），决定系统行是否附带可点击的恢复入口。
   * ⚠️ **瞬态、不落 IndexedDB**：仅本次会话有效，刷新后 note 文案仍在但链接消失；
   * 点该条重试会立即重新拿到拒收码并再次显示链接，故恢复路径不会永久丢失（与 iOS 同取舍）。
   */
  noteCode?: number;
  /** M4 消息操作派生状态（只在被操作过的消息上出现）。 */
  recalledAt?: number;  // >0=已撤回（渲染居中系统行"撤回了一条消息"，隐藏原气泡）
  recalledBy?: string;  // 撤回操作者 uid
  editedAt?: number;    // >0=已编辑（标"已编辑"，M4-5）
  pinnedAt?: number;    // >0=聊天内置顶（M4）
  replyToConvSeq?: number; // 引用回复的目标 conv_seq（点击跳转，M4-2）
  replySnapshot?: string;  // 引用目标的降级快照（气泡顶部引用条）
  /**
   * P3：引用快照的结构化种类（recalled/chat_record/file/voice/contact/call/other）。
   * 本机据此把 `replySnapshotArgs` 代入本地语言的文案键渲染引用条（见 sysEventRender.ts）；
   * 空 = 老消息/未识别 → 回退 `replySnapshot` 整句（该整句本身也要按 App 语言本地化，不能再硬编码中文）。
   */
  replySnapshotKind?: string;
  /** replySnapshotKind 对应的参数（如 {title}/{name}/{duration_ms}），字面全部来自服务端，key 名对齐 IMServer store 常量注释。 */
  replySnapshotArgs?: Record<string, string>;
  replyToFrom?: string;    // 被引用消息发送者 uid（M4-x）：群聊引用条显示发送者，本地解析显示名；单聊不显示
  forwardFrom?: string;    // 转发溯源"转发自 X"（M4-3）
  groupId?: string;        // 相册分组 ID（M4+）：同批多图/视频聚簇渲染宫格；空=普通消息
  posterUrl?: string;      // 视频封面首帧图 URL（M4+）：发送时生成上传，收端直显封面（免解码原视频）；空=非视频/无封面
  /** M4+ 媒体像素宽高（image/video，发送端量出）：据此按原比例预留气泡尺寸，免加载完跳版；0/缺省=未知。 */
  mediaW?: number;
  mediaH?: number;
  /** M4+ 视频时长（**毫秒**）：封面左上角显 mm:ss；0/缺省=未知或非视频。 */
  duration?: number;
  /** M4-7 极小模糊预览（~20px JPEG 的 data URI，image/video 带）：**未下载**卡片的模糊占位。空=回退中性占位。 */
  thumb?: string;
  /** voice 振幅指纹（base64，原始字节 ≤120，每字节 0~100 振幅百分比）：收端不下载音频即可画气泡波形；空=退化等高条纹。P0。 */
  waveform?: string;
  /** M4-8 被 @ 的成员 uid（仅群聊，服务端已按当时成员集过滤）：收端据此高亮气泡内 @昵称。 */
  mentions?: string[];
  /** 每个 @ token 在文本里的位置（UTF-16 码元偏移）。有它就直接高亮，不必反查群成员表
   *  ——超级群不下发成员表，老路在那里对普通成员失效。见 IMServer/docs/PROTOCOL.md §4.1。 */
  mentionSpans?: MentionSpan[];
  /** M4-8 @所有人（发送时服务端已校验发送者为群主/管理员）。 */
  mentionAll?: boolean;
  /**
   * 系统消息（contentType==="system"）的结构化分段：把整句拆成「固定文案 / 某人的名字」。
   * 服务端生成时只能填公开昵称，拿到 uid 后**本端**才能把名字换成我的备注、并挂点击跳资料页。
   * 空 = 历史系统消息（服务端当时没存）或非系统消息 → 回退按 content 整句渲染。
   */
  sysSegments?: SysSegment[];
  /**
   * P3：系统消息/系统通知单聊的结构化事件名（对齐后端 store.SysEvent 与 SysEventNotice 前缀常量，
   * 如 `member_remove`/`new_device_login`）。本机据此把 `sysArgs` 代入本地语言的文案键渲染（见
   * sysEventRender.ts）；空 = 老消息/未识别事件 → 回退 `sysSegments`/`content`（不改变现有回退路径）。
   */
  sysEvent?: string;
  /** sysEvent 对应的参数（如 {name}/{at}/{ip}），字面全部来自服务端，key 名对齐 IMServer store 常量注释。 */
  sysArgs?: Record<string, string>;
}

/** 系统消息的一个可渲染片段（对齐后端 protocol.SysSegment）。 */
export interface SysSegment {
  /** 非空 = 这段是某人的名字：按本地显示名重渲染 + 可点。空 = 固定文案，原样显示。 */
  uid?: string;
  /** 服务端生成时的字面（公开昵称/固定文案）。**不含任何人的私有备注**——这条消息全群可见。 */
  text: string;
}

/** 引用回复定位（发送时上行只带 convSeq，preview 为本端即时预览；服务端会冻结权威快照）。 */
export interface ReplyTo {
  convSeq: number;
  preview: string;
}

/** 一条收藏（对齐后端 store.Favorite，M4-4）。内容快照，不引用原 conv_seq。 */
export interface Favorite {
  id: number;
  content_type: string;
  content: string;
  caption?: string; // 图说随附文本快照（收藏整体，2026-08-19）：媒体/文件收藏下方显示；老收藏缺省
  file_name?: string; // 文件收藏原文件名（§8.1，对齐后端）：空回退从 URL 反推；老收藏缺省
  file_size?: number;
  duration?: number; // 视频/语音时长（毫秒；媒体宫格角标） // 文件收藏原字节数（§8.1）：副行显真实大小；老收藏缺省/0
  thumb?: string; // 磨砂占位缩略 dataURI（图片/视频未下载态）
  waveform?: string; // 语音振幅指纹 base64（voice 收藏迷你播放器画波形）；老收藏缺省→退化等高条纹
  poster?: string; // 视频封面首帧 URL（收端直显免解码；Web 解不了 HEVC 时靠它出封面）；老收藏缺省
  media_w?: number; // 媒体像素宽（图片/视频）：收端按原比例定框，转发不丢宽高；老收藏缺省/0
  media_h?: number;
  source_conv_id: string;
  source_conv_seq: number;
  source_from: string;
  created_at: number;
}

/** msg_op 应用到某条消息的补丁（撤回/编辑/置顶）。 */
/** 会话置顶消息（G0，GET /conversations/{id}/pinned 的一项）：顶部横幅与置顶列表的渲染源。
 *  字段是横幅所需最小集——点它跳到聊天里那条消息本体，不在这里重建富渲染。 */
export interface PinnedMessage {
  convSeq: number;
  serverMsgId: string;
  from: string;
  fromNickname?: string; // 仅群聊带（空则回退 uid）
  contentType: string;
  content: string;
  caption?: string; // 图说随附文本：置顶横幅/列表「有字显字」（媒体带 caption 时显文字而非 [图片]）
  timestamp: number;
  pinnedAt: number;
}

export interface MsgOpPatch {
  recalledAt?: number;
  recalledBy?: string;
  editedAt?: number;
  pinnedAt?: number;
  content?: string; // edit：新文本
}

/** 会话列表项里的最后一条消息（对齐后端 conversation.MessageView）。 */
export interface ConvLastMessage {
  server_msg_id: string;
  from: string;
  from_nickname?: string; // 发送者昵称（仅群聊填：预览"昵称: 内容"）
  content_type: string;
  content: string;
  caption?: string; // 图文/视频文/文件文随附文本：预览"有字显字"（有 caption 显 caption，否则显 [图片]/[视频]/[文件]）
  duration?: number; // 语音/视频时长毫秒：voice 客户端预览 "[语音] m:ss"；video 显时长角标；其他类型 0
  conv_seq: number;
  timestamp: number;
  recalled_at?: number; // >0=最后一条是撤回消息（预览显示"撤回了一条消息"，原文已脱敏）
  /** 仅系统消息：与消息流同一份分段，列表预览据此把名字换成本机显示名（不挂点击）。空=历史消息，回退 content。 */
  sys_segments?: SysSegment[];
  /** P3：与消息流同一个 sys_event/sys_args（服务端 conversation.MessageView 冗余下发），列表预览按
   *  §1 同一套算法本地化整句（不挂点击，见 sysEventRender.ts）；空=历史消息，回退 sys_segments/content。 */
  sys_event?: string;
  sys_args?: Record<string, string>;
}

/** window_resp 的边界信息（消息本身走 processIncoming 常规落库，不在此重复）。 */
export interface WindowMeta {
  convId: string;
  /** 服务端原样回显的请求锚点。用来丢弃"回的是更早那次开窗"的迟到帧（用户连点两个定位入口）。 */
  anchor: number;
  /**
   * 锚点消息**是否存在且对我可见**。
   * false = 真的没有这条（已删除/不可见）——据此可以放心提示「原消息已被删除」。
   * 此前只能靠"往前翻满 N 页还没见到"来猜，猜错就报出假的删除提示。
   */
  anchorFound: boolean;
  hasBefore: boolean; // 窗口上方还有更早的
  hasAfter: boolean;  // 窗口下方还有更新的
}

/** 部署级能力/配额（对齐后端 GET /api/v1/server-config）。 */
export interface ServerConfig {
  max_group_members: number;       // 标准群成员上限（部署配置，端上不得硬编码）
  supergroup_enabled: boolean;     // 本部署是否提供超级群 → 决定相关入口显隐
  max_supergroup_members: number;  // 超级群上限；supergroup_enabled=false 时无意义
}

/** conv_bump 的一条信号（对齐后端 protocol.ConvBumpItem）。 */
export interface ConvBumpItem {
  conv_id: string;
  latest_seq: number;      // 该会话当前最新 conv_seq
  from?: string;           // 最新一条的发送者 uid
  from_nickname?: string;  // 群内昵称优先
  preview?: string;        // 截断后的预览文本（够会话列表显示那一行；正文另拉）
}

/** 会话列表项（对齐后端 conversation.Summary）。 */
export interface Conversation {
  conv_id: string;
  is_group?: boolean;   // true=群聊（用 name/avatar_url/member_count），false=单聊（用 peer*）
  name?: string;        // 群名（仅群聊）
  avatar_url?: string;  // 群头像（仅群聊，空则回退群名首字母）
  member_count?: number; // 群成员数（仅群聊）
  /**
   * 超级群（2 万人量级）。为 true 时该会话：
   * 不显示已读双勾/「正在输入」/成员在线态，收到的是 conv_bump 信号而非全文消息，
   * 成员列表须走分页接口。**不要按 member_count 自己猜**——它跟群的类型走，不跟人数走。
   */
  is_super?: boolean;
  peer: string;
  peer_nickname?: string;   // 对端昵称（空则回退 uid）
  peer_remark?: string;     // 我对对端的备注名（显示优先级最高，仅自己可见）
  peer_avatar_url?: string; // 对端头像（data:/http，空则回退首字母圈）
  last_message: ConvLastMessage | null;
  latest_conv_seq: number;
  unread: number;
  /** 服务端未读计数撞到上限（真实值 ≥ unread）→ 角标补 "+"（OFFLINE_BACKLOG_DESIGN §6.1）。 */
  unread_capped?: boolean;
  read_seq: number; // 本人已读位点（首条未读 = convSeq > read_seq 的第一条）
  peer_read_seq: number; // 单聊对端已读位点（判断"我发的最后一条"是否已读 → 列表蓝双勾/灰单勾）
  /**
   * 群聊「全员已读位点」= min(其他成员已读位点)；单聊恒 0（走 peer_read_seq）。
   * 群聊据此判断「我发的、conv_seq ≤ 该位点」是否**全员已读** → 蓝双勾，否则灰单勾。
   * 非实时：仅随会话列表/sync 刷新（后端刻意不推群 receipt，避免 O(N²) 扇出）。
   */
  group_read_seq?: number;
  // 在线态快照（仅单聊）：presence 帧只报"变化"，进页面时的初始值取自这里。语义见 presence.ts。
  peer_presence?: PresenceLevel;
  peer_online_until?: number;
  peer_last_seen?: number;
  // M4.5 会话级设置（每用户私有；conv_update 帧多端同步）：
  pinned_at?: number;      // 置顶时间（0/缺省=未置顶；已置顶排在列表顶，越大越靠上）
  muted?: boolean;         // 免打扰（弱提示不响铃）——服务端按当前时刻算好的**有效值**（已到期定时免打扰回 false）
  /** 定时免打扰到期毫秒（0=永久或未免打扰，NOTIFICATIONS_P1_DESIGN §5）。**所有**判断"是否免打扰"的地方
   *  都要用 `muteState.ts#isMutedNow(muted, mute_until, now)`，不要单独读 `muted`（见该文件头注登记的清单）。 */
  mute_until?: number;
  marked_unread?: boolean; // 手动标为未读（红点，不计数）
  remark?: string;         // 会话备注（G1，仅本人可见、多端同步）：非空替代 name/群名显示
  /**
   * 未读区间内有人 @我（含 @所有人），仅群聊（M4-8）。
   * 列表显「[有人@我]」红字前缀，且**穿透免打扰**：命中时未读数仍高亮、不置灰。
   * 读过那条 @ 后服务端自动转 false，无需额外清除接口。
   */
  mention_unread?: boolean;
  /**
   * 待审入群申请数（G3，仅群聊且本人为群主/管理员时后端才下发；否则省略）。
   * 列表行「待审 N」红角标，供群管理者一眼看到有人等待审批。
   */
  pending_count?: number;
}

/** conv_update 帧负载（下行，M4.5-1）：会话级设置变更的完整状态，多端同步覆盖本地。 */
export interface ConvUpdate {
  conv_id: string;
  action: "settings" | "delete";
  pinned_at: number;
  muted: boolean;
  mute_until: number; // 定时免打扰到期毫秒（0=永久或未免打扰，§5）
  marked_unread: boolean;
  cleared_at?: number; // 仅 action=delete 带：删除位点
}

/** 用户名片（对齐后端 profile.Card；搜索结果不含 phone）。 */
export interface UserCard {
  /** 内部 ID（10 位数字，服务端分配）：接口参数与本地键，**不展示给用户**。 */
  user_id: string;
  /** 公开句柄，UI 上显示为 @xxx。仅 GET /users/{id} 与 /users/me 下发。 */
  username?: string;
  nickname: string;
  avatar_url: string;
  tags: string[];
  status: string;
}

/** 本人完整资料（GET /api/v1/users/me，含 phone；对齐 profile.Card）。 */
export interface MyProfile {
  user_id: string;
  /** 公开句柄（可改，登录用它）。设置页显示为 @xxx。 */
  username: string;
  nickname: string;
  avatar_url: string;
  phone: string;
  tags: string[];
  status: string;
}

/** 好友/申请关系状态（对齐后端 store.Friend*）。 */
export type FriendStatus = "accepted" | "pending" | "requested" | "blocked";

/** 好友/申请列表项（对齐后端 friend.Entry）。 */
export interface FriendEntry {
  /** 内部 ID（10 位数字）：接口参数与本地键，**不展示给用户**。 */
  user_id: string;
  /** 公开句柄，通讯录副标题渲染成 @xxx，并作为本地搜索维度（2026-08-29 加）。 */
  username?: string;
  nickname: string;
  remark?: string; // 我对该好友的私有备注名（显示优先级高于昵称）
  avatar_url: string;
  status: FriendStatus;
  updated_at: number;
  /** 黑名单标记，与 status 正交：我把对方拉黑了。拉黑的好友 status 仍为 accepted、仍在好友列表（带此标记）。 */
  blocked?: boolean;
  /** 好友申请的**验证消息**（申请理由）：只在 status=pending/requested 时有值，accepted 后服务端清空。
   *  老服务端/老数据不带它，端上按"没写理由"渲染，不要显示空引号或占位符。 */
  hello?: string;
}

/** 群成员角色（对齐后端 store.GroupRole*）。 */
export type GroupRole = "owner" | "admin" | "member";

/** 群成员（对齐后端 group.MemberView）。 */
export interface GroupMember {
  user_id: string;
  nickname: string;
  /** 公开句柄（成员行副标题渲染成 @xxx）。副标题此前显示 user_id——那是 10 位随机数字内部 ID。 */
  username?: string;
  group_nickname?: string; // 我在本群的昵称（G1，空=未设置；显示时优先于 nickname）
  avatar_url: string;
  role: GroupRole;
  joined_at: number;
  mute_until?: number; // 成员级禁言到期（G2；0=未禁言）
}

/** 群资料 + 成员列表（对齐后端 group.Info；conv_id 即群 topic_id）。 */
export interface GroupInfo {
  conv_id: string;
  name: string;
  owner: string;
  avatar_url: string;
  created_at: number;
  my_role: GroupRole;
  members: GroupMember[];
  // G1 群资料闭环字段。
  intro?: string;
  announcement?: string;
  announcement_by?: string;
  announcement_at?: number;
  member_count?: number;
  my_nickname?: string;
  mute_until?: number; // 全员禁言到期（0=未禁言）
  // G2 群治理开关组。
  join_approval?: boolean;
  perm_invite?: boolean;
  perm_edit_info?: boolean;
  perm_pin?: boolean;
  history_visible?: boolean;
  my_mute_until?: number; // 我的成员级禁言到期（G2）
  /**
   * 超级群（2 万人量级）。为 true 时 `members` **只含我自己**——服务端不再一次性下发全量成员
   * （2 万人约 2.5MB），成员列表须走 `GET /groups/{id}/members?cursor=&limit=` 分页。
   * `member_count` 仍是真实人数，标题「群名（N人）」照常用它。
   */
  is_super?: boolean;
  pending_count?: number; // 待审入群申请数（G3，仅群主/管理员下发）
}

/** 名片码/群码返回体（QRCODE P0；端本地据 url 生成二维码图片）。 */
export interface QRCard {
  url: string;
  token: string;
  expires_at: number; // 0=长期有效（名片码）
  inviter?: string; // 群码：邀请人 uid
}

/** resolve kind=user 的 data（扫名片码后展示的对方资料）。 */
export interface QRUserCard {
  user_id: string;
  /** 公开句柄，扫码结果卡显示 @xxx（2026-08-29 加）。 */
  username?: string;
  nickname: string;
  avatar_url: string;
  relation: "stranger" | "friend" | "self" | "blocked";
}

/** resolve kind=group 的 data（扫群码后的群预览 + 准入判定）。 */
export interface QRGroupCard {
  group_id: string;
  name: string;
  avatar_url: string;
  member_count: number;
  inviter_nickname: string;
  intro?: string; // 群简介（可空；未入群预览也可见，草图 §05）
  joined: boolean;
  joinable: boolean;
  reason: string; // "" 可直接入群 | approval 可申请需审批 | joined | full | banned | invite_revoked（改为仅管理员可邀请、此码失效）
}

/** POST /qr/resolve 返回：kind 决定 data 形状。 */
export interface QRResolved {
  kind: "user" | "group" | "unknown";
  data: QRUserCard | QRGroupCard | { text: string };
}

/** 扫码登录票据状态（QR P1，对齐后端 loginState*）。consumed 为已领取 token 的终态。 */
export type QRLoginState = "new" | "scanned" | "confirmed" | "consumed" | "expired" | "rejected";

/** POST /qr/login/new 返回：poll_key 仅此一次出现（防截屏劫持，不进二维码）。 */
export interface QRLoginTicket {
  ticket: string;
  url: string; // 二维码内容串（端本地生成图片）
  expires_at: number;
  poll_key: string;
}

/** GET /qr/login/poll 返回：state 变即返回；confirmed 首次领取时带一次性 token。 */
export interface QRLoginPollResult {
  state: QRLoginState;
  token?: string; // 仅 confirmed 首次领取时带
  /** 长效续期凭据，与 token 同批一次性下发（2026-09-06 起）。**可能缺**——会话登记降级、
   *  或后端尚未升级；缺了本会话就退化成"这枚 token 24h 用完即回登录页"。 */
  refresh_token?: string;
  uid?: string; // scanned/confirmed 时回显，供 Web 确认账号
  nickname?: string;
}

/** GET /api/v1/devices 列表一项（多设备管理 P2，对齐后端 device.DeviceView）。 */
export interface DeviceView {
  session_id: string;
  platform: string; // ios | android | web | desktop | ""
  device_name: string;
  app_version?: string;
  login_ip?: string;
  login_loc?: string;
  created_at: number;
  last_active_at: number;
  online: boolean;
  current: boolean; // 本机（当前 JWT 的 sid）
}

/** 入群申请一项（G3；对齐后端 group.JoinRequestView）。 */
export interface JoinRequest {
  user_id: string;
  nickname: string;
  avatar_url: string;
  hello: string;
  status: "pending" | "approved" | "rejected";
  created_at: number;
  decided_by?: string;
  decided_at?: number;
  /** 成员邀请转待审时的邀请人昵称（后端 inviter_nickname；解析处映射）；非空时该行用「由 X 邀请」替代附言。 */
  inviterNickname?: string;
}

/** 群黑名单一项（G2）。 */
export interface GroupBan {
  user_id: string;
  // 被拉黑者资料（后端 group.BanView 同批下发）：黑名单页只能显示这两个，
  // user_id 是解除拉黑的接口参数，**不得展示**（内部 ID 零 UI 露出，见
  // ../IMServer/docs/design/ACCOUNT_IDENTITY_REDESIGN.md §7.5）。
  username?: string;
  nickname?: string;
  avatar_url?: string;
  banned_by: string;
  banned_at: number;
  expires_at: number; // 0=永久
}

/** 我的群列表项（对齐后端 group.Summary）。 */
export interface GroupSummary {
  conv_id: string;
  name: string;
  /** 群主内部 ID：只用来判定「我是不是群主」，**不得展示**（见下两个字段）。 */
  owner: string;
  /** 群主展示资料（后端 group.Summary 同批下发）：副标题走 `备注 → owner_nickname → @owner_username`。 */
  owner_nickname?: string;
  owner_username?: string;
  avatar_url: string;
  created_at: number;
}

/** 会话 id：两个 uid 规范排序，保证收发双方一致（对齐协议示例 u_{a}_u_{b}）。 */
export function convIdFor(a: string, b: string): string {
  const [x, y] = [String(a), String(b)].sort();
  return `u_${x}_u_${y}`;
}

/** 系统通知账号的**内部 ID**（Telegram 777000 同款取值；后端 store.SystemUserID）。
 *
 *  ⚠️ 别与消息类型 `content_type === "system"` 混淆——两者过去字面相同，账号侧已改为 "777000"，
 *  消息类型侧保持不变。判断「这个会话/这个人是不是系统账号」一律用它，不要再写字面量。 */
export const SYSTEM_UID = "777000";
