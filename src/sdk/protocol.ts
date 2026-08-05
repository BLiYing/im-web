// 协议常量与类型，对齐 IMServer/docs/PROTOCOL.md。
// 这是 Web 端"协议 SDK"的一部分，与 iOS 的 IMProtocol/IMMessageModel 对应。

import type { PresenceLevel } from "./presence";

export const T = {
  PING: "ping",
  PONG: "pong",
  SEND_MSG: "send_msg",
  ACK: "ack",
  NEW_MSG: "new_msg",
  RECEIPT: "receipt",
  TYPING: "typing",
  PRESENCE: "presence",
  SYNC_REQ: "sync_req",
  SYNC_RESP: "sync_resp",
  FRIEND: "friend",
  GROUP: "group",
  MSG_OP: "msg_op",
  CONV_UPDATE: "conv_update",
  ERROR: "error",
} as const;

/** 消息操作 op（对齐后端 protocol.MsgOp*）。 */
export const OP = { RECALL: "recall", EDIT: "edit", PIN: "pin" } as const;

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
  content: string;
  contentType: string;
  fileName?: string;
  /** file 消息原始字节数；界面只格式化，不重新下载计算。 */
  fileSize?: number;
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
  replyToFrom?: string;    // 被引用消息发送者 uid（M4-x）：群聊引用条显示发送者，本地解析显示名；单聊不显示
  forwardFrom?: string;    // 转发溯源"转发自 X"（M4-3）
  groupId?: string;        // 相册分组 ID（M4+）：同批多图/视频聚簇渲染宫格；空=普通消息
  posterUrl?: string;      // 视频封面首帧图 URL（M4+）：发送时生成上传，收端直显封面（免解码原视频）；空=非视频/无封面
  /** M4+ 媒体像素宽高（image/video，发送端量出）：据此按原比例预留气泡尺寸，免加载完跳版；0/缺省=未知。 */
  mediaW?: number;
  mediaH?: number;
  /** M4+ 视频时长（**毫秒**）：封面左上角显 mm:ss；0/缺省=未知或非视频。 */
  duration?: number;
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
  source_conv_id: string;
  source_conv_seq: number;
  source_from: string;
  created_at: number;
}

/** msg_op 应用到某条消息的补丁（撤回/编辑/置顶）。 */
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
  conv_seq: number;
  timestamp: number;
  recalled_at?: number; // >0=最后一条是撤回消息（预览显示"撤回了一条消息"，原文已脱敏）
}

/** 会话列表项（对齐后端 conversation.Summary）。 */
export interface Conversation {
  conv_id: string;
  is_group?: boolean;   // true=群聊（用 name/avatar_url/member_count），false=单聊（用 peer*）
  name?: string;        // 群名（仅群聊）
  avatar_url?: string;  // 群头像（仅群聊，空则回退群名首字母）
  member_count?: number; // 群成员数（仅群聊）
  peer: string;
  peer_nickname?: string;   // 对端昵称（空则回退 uid）
  peer_remark?: string;     // 我对对端的备注名（显示优先级最高，仅自己可见）
  peer_avatar_url?: string; // 对端头像（data:/http，空则回退首字母圈）
  last_message: ConvLastMessage | null;
  latest_conv_seq: number;
  unread: number;
  read_seq: number; // 本人已读位点（首条未读 = convSeq > read_seq 的第一条）
  peer_read_seq: number; // 单聊对端已读位点（判断"我发的最后一条"是否已读 → 列表绿✓✓/灰✓）
  // 在线态快照（仅单聊）：presence 帧只报"变化"，进页面时的初始值取自这里。语义见 presence.ts。
  peer_presence?: PresenceLevel;
  peer_online_until?: number;
  peer_last_seen?: number;
  // M4.5 会话级设置（每用户私有；conv_update 帧多端同步）：
  pinned_at?: number;      // 置顶时间（0/缺省=未置顶；已置顶排在列表顶，越大越靠上）
  muted?: boolean;         // 免打扰（弱提示不响铃）
  marked_unread?: boolean; // 手动标为未读（红点，不计数）
}

/** conv_update 帧负载（下行，M4.5-1）：会话级设置变更的完整状态，多端同步覆盖本地。 */
export interface ConvUpdate {
  conv_id: string;
  action: "settings" | "delete";
  pinned_at: number;
  muted: boolean;
  marked_unread: boolean;
  cleared_at?: number; // 仅 action=delete 带：删除位点
}

/** 用户名片（对齐后端 profile.Card；搜索结果不含 phone）。 */
export interface UserCard {
  user_id: string;
  nickname: string;
  avatar_url: string;
  tags: string[];
  status: string;
}

/** 本人完整资料（GET /api/v1/users/me，含 phone；对齐 profile.Card）。 */
export interface MyProfile {
  user_id: string;
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
  user_id: string;
  nickname: string;
  remark?: string; // 我对该好友的私有备注名（显示优先级高于昵称）
  avatar_url: string;
  status: FriendStatus;
  updated_at: number;
  /** 黑名单标记，与 status 正交：我把对方拉黑了。拉黑的好友 status 仍为 accepted、仍在好友列表（带此标记）。 */
  blocked?: boolean;
}

/** 群成员角色（对齐后端 store.GroupRole*）。 */
export type GroupRole = "owner" | "admin" | "member";

/** 群成员（对齐后端 group.MemberView）。 */
export interface GroupMember {
  user_id: string;
  nickname: string;
  avatar_url: string;
  role: GroupRole;
  joined_at: number;
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
}

/** 我的群列表项（对齐后端 group.Summary）。 */
export interface GroupSummary {
  conv_id: string;
  name: string;
  owner: string;
  avatar_url: string;
  created_at: number;
}

/** 会话 id：两个 uid 规范排序，保证收发双方一致（对齐协议示例 u_{a}_u_{b}）。 */
export function convIdFor(a: string, b: string): string {
  const [x, y] = [String(a), String(b)].sort();
  return `u_${x}_u_${y}`;
}
