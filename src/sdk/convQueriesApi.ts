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

/**
 * 本机清空位点（§6.7）以内的结果滤掉：这三个查询问的是**服务端**，而服务端还留着用户在本机清空掉的那些消息——
 * 不滤的话搜得到刚清掉的内容、日历给已清空的日子打点、媒体库里翻得出已清掉的图。位点为 0 原样返回。
 */
export function dropClearedItems<T extends { conv_seq: number }>(items: T[], clearedUpTo: number): T[] {
  return clearedUpTo > 0 ? items.filter((i) => i.conv_seq > clearedUpTo) : items;
}

/**
 * 服务端还能不能翻出位点之上的东西：游标是「上一页最后一条的 conv_seq」，之后的页只会更小。
 * 游标已落到 `位点 + 1` 及以下时，剩下的全在位点以内，别再翻了（否则清空过的大会话要空翻一串页）。
 */
export function hasMoreAboveFloor(hasMore: boolean, nextCursor: number, clearedUpTo: number): boolean {
  return !!hasMore && nextCursor > 0 && nextCursor > clearedUpTo + 1;
}

/** 日历：「当天第一条」在位点以内的日子，服务端的计数里掺着已清掉的消息——整天丢掉（位点之后本机新收的消息由本地打点补上）。 */
export function dropClearedDays(days: CalendarDay[], clearedUpTo: number): CalendarDay[] {
  return clearedUpTo > 0 ? days.filter((d) => d.first_conv_seq > clearedUpTo) : days;
}

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
export async function searchConvMessages(
  token: string, convId: string, q: string,
  opts: { from?: string; cursor?: number; limit?: number; clearedUpTo?: number } = {},
): Promise<ConvSearchPage> {
  const p = new URLSearchParams({ q });
  if (opts.from) p.set("from", opts.from);
  if (opts.cursor) p.set("cursor", String(opts.cursor));
  if (opts.limit) p.set("limit", String(opts.limit));
  const page = await get<ConvSearchPage>(token, `/api/v1/conversations/${encodeURIComponent(convId)}/messages/search?${p}`);
  const floor = opts.clearedUpTo ?? 0;
  if (floor <= 0) return page;
  return { ...page, items: dropClearedItems(page.items ?? [], floor), has_more: hasMoreAboveFloor(page.has_more, page.next_cursor, floor) };
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
export async function fetchConvCalendar(
  token: string, convId: string, fromMs: number, toMs: number, utcOffsetMs: number, clearedUpTo = 0,
): Promise<{ conv_id: string; days: CalendarDay[] }> {
  const p = new URLSearchParams({
    from: String(Math.floor(fromMs)), to: String(Math.floor(toMs)), utc_offset_ms: String(Math.floor(utcOffsetMs)),
  });
  const res = await get<{ conv_id: string; days: CalendarDay[] }>(token, `/api/v1/conversations/${encodeURIComponent(convId)}/calendar?${p}`);
  return { ...res, days: dropClearedDays(res.days ?? [], clearedUpTo) };
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
export async function fetchConvMedia(
  token: string, convId: string, kind: MediaKind, opts: { cursor?: number; limit?: number; clearedUpTo?: number; after?: number } = {},
): Promise<{ conv_id: string; items: ConvMediaItem[]; next_cursor: number; has_more: boolean }> {
  const p = new URLSearchParams({ kind });
  // after = 向更新方向（升序，紧挨 after 的最近 limit 条），与 cursor（向更旧）互斥
  if (opts.after) p.set("after", String(opts.after)); else if (opts.cursor) p.set("cursor", String(opts.cursor));
  if (opts.limit) p.set("limit", String(opts.limit));
  const page = await get<{ conv_id: string; items: ConvMediaItem[]; next_cursor: number; has_more: boolean }>(
    token, `/api/v1/conversations/${encodeURIComponent(convId)}/media?${p}`);
  const floor = opts.clearedUpTo ?? 0;
  // 向更新的一页：只丢位点以内的项；has_more / 游标不动（向新翻碰不到位点之下）
  if (opts.after) return { ...page, items: dropClearedItems(page.items ?? [], floor) };
  return { ...page, items: dropClearedItems(page.items ?? [], floor), has_more: floor > 0 ? hasMoreAboveFloor(page.has_more, page.next_cursor, floor) : page.has_more };
}

/** 本机时区相对 UTC 的偏移（毫秒，东八区 = +28800000）。 */
export function localUtcOffsetMs(): number {
  return -new Date().getTimezoneOffset() * 60_000;
}
