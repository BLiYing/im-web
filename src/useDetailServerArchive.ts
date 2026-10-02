// 资料页「媒体 / 文件 / 语音」页签的服务端分页（OFFLINE_BACKLOG_DESIGN §4.9 第 5 项）。
//
// 页签数据源原本是本地历史（`detailMsgs`）。本地有缺口且在线时，缺口里的图 / 文件 / 语音本地没有——
// 页签给出的是一份看着正常、其实残缺的答案。这时按类型向 `GET /conversations/{id}/media` 要（新→旧、游标分页），
// 并进本地结果：两边都是事实，按 convSeq 去重取并集；服务端页没翻到的更旧部分由「滚到底续拉」补。
// 链接页签服务端没有可索引的列（链接不是独立 content_type），仍只看本地。
//
// 本地齐全（`enabled=false`）时什么都不做，与改造前一样。换会话 / 开关翻转整份重置，旧页回来对不上代次就丢。

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./sdk/protocol";
import { fetchConvMedia, type MediaKind } from "./sdk/convQueriesApi";
import { mediaItemToMessage } from "./mediaServerPaging";

export type ArchiveKind = "media" | "file" | "voice";
export const ARCHIVE_KINDS: ArchiveKind[] = ["media", "file", "voice"];

interface KindState { hasMore: boolean; loading: boolean }
const fresh = (): Record<ArchiveKind, KindState> => ({
  media: { hasMore: true, loading: false }, file: { hasMore: true, loading: false }, voice: { hasMore: true, loading: false },
});

/** 并集去重（按 convSeq，本地优先：本地行字段更全）。纯函数，单测在 useDetailServerArchive.test.ts。 */
export function unionByConvSeq(local: readonly ChatMessage[], server: readonly ChatMessage[]): ChatMessage[] {
  if (server.length === 0) return local as ChatMessage[];
  const seen = new Set(local.filter((m) => m.convSeq > 0).map((m) => m.convSeq));
  const extra = server.filter((m) => m.convSeq > 0 && !seen.has(m.convSeq));
  return extra.length === 0 ? (local as ChatMessage[]) : [...local, ...extra];
}

export interface DetailArchive {
  /** 把服务端已拉到的并进本地页签数据源。 */
  merge: (local: ChatMessage[]) => ChatMessage[];
  hasMore: (k: ArchiveKind) => boolean;
  loading: (k: ArchiveKind) => boolean;
  loadMore: (k: ArchiveKind) => void;
}

export function useDetailServerArchive(o: {
  convId: string;
  /** 详情开着、本地有缺口且在线。 */
  enabled: boolean;
  getToken: () => string;
  clearedUpTo: number;
}): DetailArchive {
  const [server, setServer] = useState<{ convId: string; list: ChatMessage[] }>({ convId: o.convId, list: [] });
  const [state, setState] = useState(fresh);
  const cursorRef = useRef<Record<ArchiveKind, number>>({ media: 0, file: 0, voice: 0 });
  const genRef = useRef(0);
  const busyRef = useRef<Record<ArchiveKind, boolean>>({ media: false, file: false, voice: false });
  const listRef = useRef<ChatMessage[]>([]);
  const oRef = useRef(o);
  oRef.current = o;

  const loadMore = useCallback((k: ArchiveKind) => {
    const cur = oRef.current;
    if (!cur.enabled || busyRef.current[k]) return;
    const token = cur.getToken();
    if (!token) return;
    busyRef.current[k] = true;
    setState((s) => ({ ...s, [k]: { ...s[k], loading: true } }));
    const gen = genRef.current;
    void fetchConvMedia(token, cur.convId, k as MediaKind, { cursor: cursorRef.current[k], limit: 60, clearedUpTo: cur.clearedUpTo })
      .then((page) => {
        if (gen !== genRef.current) return;   // 会话 / 开关在途中变了：这页属于上一次
        cursorRef.current[k] = page.next_cursor;
        const more = !!page.has_more && page.next_cursor > 0;
        const items = page.items.map((i) => mediaItemToMessage(cur.convId, i));
        listRef.current = unionByConvSeq(listRef.current, items);
        setServer({ convId: cur.convId, list: listRef.current });
        setState((s) => ({ ...s, [k]: { hasMore: more, loading: false } }));
      })
      .catch(() => {
        // 失败（离线）：这一类停在已有的那段，不再自动重试；本地那份照常能看
        if (gen === genRef.current) setState((s) => ({ ...s, [k]: { hasMore: false, loading: false } }));
      })
      .finally(() => { if (gen === genRef.current) busyRef.current[k] = false; });
  }, []);

  // 换会话 / 开关翻转：整份重置；开着就把三类的第一页都要一遍（页签要靠它决定出不出现）
  useEffect(() => {
    genRef.current += 1;
    cursorRef.current = { media: 0, file: 0, voice: 0 };
    busyRef.current = { media: false, file: false, voice: false };
    listRef.current = [];
    setServer({ convId: o.convId, list: [] });
    setState(fresh());
    if (o.enabled) for (const k of ARCHIVE_KINDS) loadMore(k);
  }, [o.convId, o.enabled, loadMore]);

  const merge = useCallback(
    (local: ChatMessage[]) => (server.convId === o.convId ? unionByConvSeq(local, server.list) : local),
    [server, o.convId],
  );
  return {
    merge,
    hasMore: (k) => o.enabled && state[k].hasMore,
    loading: (k) => state[k].loading,
    loadMore,
  };
}
