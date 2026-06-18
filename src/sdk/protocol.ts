// 协议常量与类型，对齐 IMServer/docs/PROTOCOL.md。
// 这是 Web 端"协议 SDK"的一部分，与 iOS 的 IMProtocol/IMMessageModel 对应。

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
  ERROR: "error",
} as const;

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
  content: string;
  contentType: string;
  convSeq: number;
  timestamp: number;
  status: MessageStatus;
  /** 发送失败时的系统提示（如被拉黑拒收），在该条下方居中显示；微信式，不弹窗。 */
  note?: string;
}

/** 会话列表项里的最后一条消息（对齐后端 conversation.MessageView）。 */
export interface ConvLastMessage {
  server_msg_id: string;
  from: string;
  content_type: string;
  content: string;
  conv_seq: number;
  timestamp: number;
}

/** 会话列表项（对齐后端 conversation.Summary）。 */
export interface Conversation {
  conv_id: string;
  peer: string;
  peer_nickname?: string;   // 对端昵称（空则回退 uid）
  peer_remark?: string;     // 我对对端的备注名（显示优先级最高，仅自己可见）
  peer_avatar_url?: string; // 对端头像（data:/http，空则回退首字母圈）
  last_message: ConvLastMessage | null;
  latest_conv_seq: number;
  unread: number;
  read_seq: number; // 本人已读位点（首条未读 = convSeq > read_seq 的第一条）
  peer_read_seq: number; // 单聊对端已读位点（判断"我发的最后一条"是否已读 → 列表绿✓✓/灰✓）
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

/** 会话 id：两个 uid 规范排序，保证收发双方一致（对齐协议示例 u_{a}_u_{b}）。 */
export function convIdFor(a: string, b: string): string {
  const [x, y] = [String(a), String(b)].sort();
  return `u_${x}_u_${y}`;
}
