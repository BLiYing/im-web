// 协议常量与类型，对齐 IMServer/docs/PROTOCOL.md。
// 这是 Web 端"协议 SDK"的一部分，与 iOS 的 IMProtocol/IMMessageModel 对应。

export const T = {
  PING: "ping",
  PONG: "pong",
  SEND_MSG: "send_msg",
  ACK: "ack",
  NEW_MSG: "new_msg",
  RECEIPT: "receipt",
  SYNC_REQ: "sync_req",
  SYNC_RESP: "sync_resp",
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
  last_message: ConvLastMessage | null;
  latest_conv_seq: number;
  unread: number;
}

/** 会话 id：两个 uid 规范排序，保证收发双方一致（对齐协议示例 u_{a}_u_{b}）。 */
export function convIdFor(a: string, b: string): string {
  const [x, y] = [String(a), String(b)].sort();
  return `u_${x}_u_${y}`;
}
