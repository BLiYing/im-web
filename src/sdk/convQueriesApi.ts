// 「关于整个会话」的三个服务端查询（docs/design/OFFLINE_BACKLOG_DESIGN.md §4.9）。
//
// 它们回答的都是**整会话**问题：这个词一共出现在哪些消息里、哪几天有消息、这类媒体一共有哪些。
// 本地库在离线积压被留成缺口后只有其中几段，继续用本地算会得到一个"看起来正常、其实残缺"的答案——
// 那是最难发现的一类错（MESSAGE_WINDOW_DESIGN §5.1 的教训）。
//
// **不是**要取代本地：本地齐全时仍走本地（秒回、离线可用），只有有缺口且在线时才问服务端。
// 分流规则见 useChatSearch 与 §4.9 的三态表。
//
// 后端对应：IMServer/cmd/imserver/handlers_backlog.go、handlers_conversation.go。

import { callJson } from "./http";

async function get<T>(token: string, path: string): Promise<T> {
  return (await callJson(path, { headers: { Authorization: `Bearer ${token}` } })) as T;
}

export interface ConvSearchItem {
  conv_seq: number;
  server_msg_id: string;
  sender: string;
  from_nickname?: string;
  content_type: string;
  content: string;
  caption?: string;
  timestamp: number;
}

export interface ConvSearchPage {
  conv_id: string;
  items: ConvSearchItem[];
  next_cursor: number;
  has_more: boolean;
}

/**
 * 会话内检索（服务端权威）。`from` 非空时叠加「来自某人」过滤——本地有缺口时这一筛也必须
 * 由服务端给，否则缺口里那些人的消息会静默漏掉。cursor=0 表示从最新开始，按 conv_seq 倒序。
 */
export function searchConvMessages(
  token: string, convId: string, q: string, opts: { from?: string; cursor?: number; limit?: number } = {},
): Promise<ConvSearchPage> {
  const p = new URLSearchParams({ q });
  if (opts.from) p.set("from", opts.from);
  if (opts.cursor) p.set("cursor", String(opts.cursor));
  if (opts.limit) p.set("limit", String(opts.limit));
  return get<ConvSearchPage>(token, `/api/v1/conversations/${encodeURIComponent(convId)}/messages/search?${p}`);
}

export interface CalendarDay {
  day_start_ms: number;
  count: number;
  /** 当天第一条：点这一天就拿它当锚点开窗（复用既有 window_req，不另造跳转接口）。 */
  first_conv_seq: number;
}

/**
 * 日历按天聚合。**必须给 from/to**（服务端有跨度上限）：客户端按可见月份问，
 * 不设区间就等于一次请求扫完整个会话，正是本设计通篇在避免的。
 * utcOffsetMs 用本机时区——切天必须按用户所在时区，否则整张日历错位一格。
 */
export function fetchConvCalendar(
  token: string, convId: string, fromMs: number, toMs: number, utcOffsetMs: number,
): Promise<{ conv_id: string; days: CalendarDay[] }> {
  const p = new URLSearchParams({
    from: String(Math.floor(fromMs)), to: String(Math.floor(toMs)), utc_offset_ms: String(Math.floor(utcOffsetMs)),
  });
  return get(token, `/api/v1/conversations/${encodeURIComponent(convId)}/calendar?${p}`);
}

export interface ConvMediaItem extends ConvSearchItem {
  file_name?: string;
  file_size?: number;
  poster?: string;
  thumb?: string;
  media_w?: number;
  media_h?: number;
  duration?: number;
  group_id?: string;
}

export type MediaKind = "image" | "video" | "media" | "file" | "voice";

/** 会话媒体分页（按类型，conv_seq 倒序）。媒体查看器左右翻页与媒体库都用它。 */
export function fetchConvMedia(
  token: string, convId: string, kind: MediaKind, opts: { cursor?: number; limit?: number } = {},
): Promise<{ conv_id: string; items: ConvMediaItem[]; next_cursor: number; has_more: boolean }> {
  const p = new URLSearchParams({ kind });
  if (opts.cursor) p.set("cursor", String(opts.cursor));
  if (opts.limit) p.set("limit", String(opts.limit));
  return get(token, `/api/v1/conversations/${encodeURIComponent(convId)}/media?${p}`);
}

/** 本机时区相对 UTC 的偏移（毫秒，东八区 = +28800000）。 */
export function localUtcOffsetMs(): number {
  return -new Date().getTimezoneOffset() * 60_000;
}
