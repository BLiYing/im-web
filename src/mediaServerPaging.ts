// 会话媒体「服务端续拉」的纯逻辑（OFFLINE_BACKLOG_DESIGN §4.9 第 5 项）。
//
// 本地有缺口且在线时，查看器左右翻页 / 媒体库里「前后没别的图了」是假的——缺口里的图本地没有。
// 这时在本地那一段之上，往**更旧**的方向用 `GET /conversations/{id}/media` 续拉。对称 Android
// `MediaTimeline.prependOlder` + `ConvQueryFloor.media`、iOS `IMMediaPaging`。
//
// 服务端按 conv_seq 倒序给（cursor = 上页最后一条，之后只会更旧），时间线按升序用。拼错的表现是翻页时跳到别的图上
// 或同一张出现两次，界面照常不报错——所以抽成纯函数单测。

import type { ChatMessage } from "./sdk/protocol";
import type { ConvMediaItem } from "./sdk/convQueriesApi";

/** 一次续拉里连续遇到「空页但仍 has_more」时最多再往前翻几页（同搜索翻页，服务端逐人隐藏过滤会让一页一条不剩）。 */
export const MAX_EMPTY_MEDIA_PAGES = 5;

/** 服务端媒体项 → 查看器/媒体库认的轻量消息（只有展示与定位所需字段；撤回/删除由服务端滤掉）。 */
export function mediaItemToMessage(convId: string, i: ConvMediaItem): ChatMessage {
  return {
    convId,
    from: i.sender,
    fromNickname: i.from_nickname || undefined,
    content: i.content,
    contentType: i.content_type,
    caption: i.caption || undefined,
    fileName: i.file_name || undefined,
    fileSize: i.file_size || undefined,
    convSeq: i.conv_seq,
    timestamp: i.timestamp,
    status: "received",
    posterUrl: i.poster || undefined,
    thumb: i.thumb || undefined,
    mediaW: i.media_w || undefined,
    mediaH: i.media_h || undefined,
    duration: i.duration || undefined,
    groupId: i.group_id || undefined,
    serverMsgId: i.server_msg_id || undefined,
  };
}

/**
 * 把更旧的一页并到升序时间线前面。只收比当前最旧一条**还旧**的、去重的、有内容的项；返回新增的（升序）。
 * 调用方拿 `added` 决定「翻页落到新增那批里最新的一条」（紧挨着原来最旧的上一条）。
 */
export function prependOlderMedia(
  oldestLocalSeq: number,
  olderSoFar: readonly ChatMessage[],
  page: readonly ChatMessage[],
): { older: ChatMessage[]; added: ChatMessage[] } {
  const oldest = Math.min(
    oldestLocalSeq > 0 ? oldestLocalSeq : Number.POSITIVE_INFINITY,
    olderSoFar.length > 0 ? olderSoFar[0].convSeq : Number.POSITIVE_INFINITY,
  );
  const bySeq = new Map<number, ChatMessage>();
  for (const m of page) {
    if (m.convSeq > 0 && m.convSeq < oldest && !m.recalledAt && m.content) bySeq.set(m.convSeq, m);
  }
  const added = [...bySeq.values()].sort((a, b) => a.convSeq - b.convSeq);
  return { older: [...added, ...olderSoFar], added };
}

/**
 * 把服务端续拉来的「更旧」并到本地可视媒体前面，去掉与本地重叠的（本地后来又往上翻出了同样的几张时别重复）。
 * @param local 本地可视媒体（升序）
 */
export function mergeServerOlder(older: readonly ChatMessage[], local: readonly ChatMessage[]): ChatMessage[] {
  if (older.length === 0) return local as ChatMessage[];
  const localOldest = local.length > 0 ? Math.min(...local.map((m) => m.convSeq).filter((s) => s > 0)) : Number.POSITIVE_INFINITY;
  const keep = older.filter((m) => m.convSeq < localOldest);
  return keep.length === 0 ? (local as ChatMessage[]) : [...keep, ...local];
}
