import type { ChatMessage } from "./protocol";
import type { MentionSpan } from "../mention";

/** 一条已发出、还在等 ack 的消息的发送参数（imSdk 按 client_msg_id 暂存；ack / 被拒时据此落库）。 */
export interface PendingSend {
  convId: string; content: string; contentType: string; timestamp: number;
  fileName?: string; fileSize?: number; caption?: string;
  mentions?: string[]; mentionAll?: boolean; mentionSpans?: MentionSpan[];
  replyToConvSeq?: number; replySnapshot?: string; replyToFrom?: string; forwardFrom?: string;
  groupId?: string; poster?: string; mediaW?: number; mediaH?: number; duration?: number; thumb?: string; waveform?: string;
}

/**
 * 把暂存的发送参数还原成一条自己发的 ChatMessage。ack 成功落库与被拒落失败件**共用这一份字段集**——
 * 此前两处各抄一遍：被拒那份曾把 contentType 写死 "text" 且丢掉 groupId/poster/尺寸，被拒的图片/视频
 * 刷新后退化成一条显示 URL 的文本气泡、相册散成一条条独立消息；后来补齐时又漏了 waveform。
 */
export function pendingToMessage(uid: string, p: PendingSend, over: Pick<ChatMessage, "convSeq" | "status"> & Partial<ChatMessage>): ChatMessage {
  return {
    convId: p.convId, from: uid, content: p.content, contentType: p.contentType, timestamp: p.timestamp,
    fileName: p.fileName, fileSize: p.fileSize, caption: p.caption,
    mentions: p.mentions, mentionAll: p.mentionAll, mentionSpans: p.mentionSpans,
    replyToConvSeq: p.replyToConvSeq, replySnapshot: p.replySnapshot, replyToFrom: p.replyToFrom, forwardFrom: p.forwardFrom,
    groupId: p.groupId, posterUrl: p.poster,
    mediaW: p.mediaW, mediaH: p.mediaH, duration: p.duration, thumb: p.thumb, waveform: p.waveform,
    ...over,
  } as ChatMessage;
}
