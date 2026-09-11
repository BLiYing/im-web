// 会话内搜索「服务端命中翻页」的纯逻辑（OFFLINE_BACKLOG_DESIGN §4.9 第 1 项的后半）。
//
// 服务端 `messages/search` 按 conv_seq **倒序**一页页给（cursor = 上一页的 next_cursor，从最新往回翻），
// 而命中集在两端都按**升序**用（下标 0 = 最早，▲ = 更旧）。所以「再要一页」拿回来的是**更旧**的一批，
// 要拼到命中集**前面**——当前下标随之整体后移，这正是最容易算错、算错了又不报错的地方
// （表现是 ▲ 一下跳到了别的命中上），故单独成函数、配单测。与 iOS `IMChatSearchPaging` 同语义。

export interface SearchHit {
  convSeq: number;
  timestamp: number;
}

/**
 * 服务端可能回一页 0 条却仍 has_more：它先取 limit+1 条再按「仅为我删除」等逐人隐藏过滤，
 * 隐藏项多时单页展示数会少于 limit（见 IMServer `internal/conversation/search.go` 的 searchPage）。
 * 一次 ▲ 里连续遇到空页时最多再往前翻这么多页——满屏隐藏项的会话不能把一次点击变成无界请求。
 */
export const MAX_EMPTY_PAGES = 5;

/**
 * 把更旧的一页并到升序命中集前面。`page` 顺序不限（服务端给的是倒序）。
 *
 * 返回新命中集与**真正新增的条数**：调用方用它把当前下标落到新增那批里最新的一条
 * （`added - 1`），也就是紧挨着原来最旧命中的上一条。
 *
 * 只收比当前最旧命中**还旧**的项：游标按 conv_seq 往回走，正常不会越界；防的是重复页 / 游标回退
 * 把已有命中再塞一遍，那会让计数虚涨、下标错位。
 */
export function prependOlderHits(
  current: readonly SearchHit[],
  page: readonly SearchHit[],
): { hits: SearchHit[]; added: number } {
  const oldest = current.length > 0 ? current[0].convSeq : Number.POSITIVE_INFINITY;
  const bySeq = new Map<number, SearchHit>();
  for (const h of page) {
    if (h.convSeq > 0 && h.convSeq < oldest) bySeq.set(h.convSeq, h);
  }
  const older = [...bySeq.values()].sort((a, b) => a.convSeq - b.convSeq);
  return { hits: [...older, ...current], added: older.length };
}
