// 会话媒体（查看器翻页 / 媒体库）的服务端续拉 hook（OFFLINE_BACKLOG_DESIGN §4.9 第 5 项）。
// 纯判据在 mediaServerPaging.ts；这里只管游标 / 在途守卫 / 查询代次 / 空页上限。
//
// 只在 `enabled`（本地有缺口且在线，即 pickQuerySource === "server"）时才会去问服务端；
// 否则 `loadOlder` 是空操作，`hasMore` 恒假——本地齐全时与改造前完全一样。
// 换会话 / 开关翻转就整份重置：旧会话在途的页回来对不上代次就丢（同 useChatSearch 的 searchGenRef）。

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./sdk/protocol";
import { fetchConvMedia } from "./sdk/convQueriesApi";
import { MAX_EMPTY_MEDIA_PAGES, mediaItemToMessage, mergeServerOlder, prependOlderMedia } from "./mediaServerPaging";

export interface MediaServerPaging {
  /** 把服务端续拉来的更旧项并到本地可视媒体（升序）前面。 */
  merge: (localAsc: ChatMessage[]) => ChatMessage[];
  /** 服务端是否还有更旧的页（只在 enabled 时可能为真）。 */
  hasMore: boolean;
  loading: boolean;
  /** 续拉一页；回新增的（升序），调用方把落点放在最后一条（紧挨着原来最旧的）。失败回 null（离线降级，别说「没有更多」）。 */
  loadOlder: () => Promise<ChatMessage[] | null>;
}

export function useMediaServerPaging(o: {
  convId: string;
  enabled: boolean;
  /** 本地消息（任意类型）里最旧的 conv_seq（>0）；续拉从它往更旧取。未知传 0。 */
  oldestLocalSeq: number;
  getToken: () => string;
  clearedUpTo: number;
}): MediaServerPaging {
  const [olderState, setOlder] = useState<{ convId: string; list: ChatMessage[] }>({ convId: o.convId, list: [] });
  // 换会话那一帧 effect 还没来得及重置：按 convId 过滤，别让上个会话的续拉结果闪进新会话
  const older = olderState.convId === o.convId ? olderState.list : [];
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const cursorRef = useRef(0);
  const genRef = useRef(0);
  const loadingRef = useRef(false);
  const olderRef = useRef<ChatMessage[]>([]);
  olderRef.current = older;
  const oRef = useRef(o);
  oRef.current = o;

  // 换会话才整份重置；enabled 翻转（掉线 / 重连 / 缺口补齐）只重置「还有没有更多」——已续拉来的留着，
  // 否则查看器正停在续拉来的那一张时它会凭空消失（viewerIdx 变 -1，箭头没了）。
  useEffect(() => {
    genRef.current += 1;
    loadingRef.current = false;
    cursorRef.current = 0;
    setOlder({ convId: o.convId, list: [] }); setLoading(false);
  }, [o.convId]);
  useEffect(() => {
    genRef.current += 1;   // enabled 变了：在途的页属于上一种状态，丢掉
    loadingRef.current = false; setLoading(false);
    setHasMore(o.enabled);
  }, [o.enabled]);

  const loadOlder = useCallback(async (): Promise<ChatMessage[] | null> => {
    const cur = oRef.current;
    if (!cur.enabled || loadingRef.current) return [];
    const token = cur.getToken();
    if (!token) return null;
    loadingRef.current = true; setLoading(true);
    const gen = genRef.current;
    try {
      for (let attempt = 0; attempt <= MAX_EMPTY_MEDIA_PAGES; attempt++) {
        // 游标取已知三者的最小：服务端上一页游标 / 已续拉的最旧 / 本地最旧（本地窗口后来上翻得更旧时，别从更新处重复翻一遍）
        const known = [cursorRef.current, olderRef.current[0]?.convSeq ?? 0, cur.oldestLocalSeq].filter((n) => n > 0);
        const cursor = known.length > 0 ? Math.min(...known) : 0;
        const page = await fetchConvMedia(token, cur.convId, "media", { cursor, limit: 60, clearedUpTo: cur.clearedUpTo });
        if (gen !== genRef.current) return [];   // 会话 / 开关在途中变了：这页属于上一次
        cursorRef.current = page.next_cursor;
        const more = !!page.has_more && page.next_cursor > 0;
        const { older: next, added } = prependOlderMedia(cur.oldestLocalSeq, olderRef.current, page.items.map((i) => mediaItemToMessage(cur.convId, i)));
        if (added.length === 0 && more) continue;   // 空页却仍 has_more（逐人隐藏过滤）：接着往前翻，有上限
        olderRef.current = next; setOlder({ convId: cur.convId, list: next }); setHasMore(more);
        return added;
      }
      return [];   // 连翻 6 页全是空页：只结束这一次，下一次（再翻 / 再滚）还能接着要，不永久置假
    } catch {
      if (gen === genRef.current) setHasMore(false);   // 离线 / 失败：停在已有的那段，由调用方说一句
      return null;
    } finally {
      if (gen === genRef.current) { loadingRef.current = false; setLoading(false); }
    }
  }, []);

  const merge = useCallback((localAsc: ChatMessage[]) => mergeServerOlder(older, localAsc), [older]);

  return { merge, hasMore: o.enabled && hasMore, loading, loadOlder };
}
