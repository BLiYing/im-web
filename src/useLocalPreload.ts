import { useCallback, useRef, type MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { ChatMessage, Conversation } from "./sdk/protocol";

// 本地库预载：把会话的本地消息 / 连续同步游标 / 删除墓碑读进内存，并向 SDK 登记会话（重连补哪些、超级群 max_gap=0）。
// 从 App.tsx 平移出来（preloadLocal 函数体未改），新增 preloadNew 供「会话刷新」用。
//
// 为什么要有 preloadNew（2026-09-11 查明）：开窗 / 翻页 / conv_bump 投递的消息也会触发会话刷新，
// 旧写法每次都 preloadLocal(全部会话) + syncTracked(全部)——整份 getAll 每个会话的本地消息（结果被
// 「内存优先」的 preload 丢掉）再给所有会话发一帧 sync_req。已预载过的会话既不缺本地消息、也有
// 重连补偿兜着同步，真正要登记的只有刷新里新冒出来的会话。

interface Deps {
  clientRef: MutableRefObject<IMClient | null>;
  seenByConv: MutableRefObject<Record<string, Set<number>>>;
  deletedByConv: MutableRefObject<Record<string, Set<number>>>;
  preloadMsgs: (loaded: Record<string, ChatMessage[]>) => void;
}

export function useLocalPreload({ clientRef, seenByConv, deletedByConv, preloadMsgs }: Deps) {
  // 本 client 已登记过的会话。换 client（登录 / 切号新建）即作废：游标、墓碑、SDK 的登记表都按 client 走。
  const doneRef = useRef<{ client: IMClient | null; ids: Set<string> }>({ client: null, ids: new Set() });
  const doneFor = useCallback((client: IMClient): Set<string> => {
    if (doneRef.current.client !== client) doneRef.current = { client, ids: new Set() };
    return doneRef.current.ids;
  }, []);

  // 登录后从本地库（IndexedDB）预载各会话历史 → 打开会话即秒显，刷新不丢已下载的历史；
  // 同时读取独立的连续同步游标；本地消息最大值与服务端 latest 都不能证明中间没有空洞。
  const preloadLocal = useCallback(async (convs: Conversation[]) => {
    const client = clientRef.current;
    if (!client) return;
    const done = doneFor(client);
    const loaded: Record<string, ChatMessage[]> = {};
    for (const c of convs) {
      const local = await client.loadLocal(c.conv_id);
      const continuousCursor = await client.loadSyncCursor(c.conv_id);
      // is_super 决定 max_gap=0：超级群正文只在打开会话时按需拉，连上时永不自动补
      // （SUPERGROUP_DESIGN §5 早有此规定，OFFLINE_BACKLOG_DESIGN §4.5 把它落到 sync 帧上）。
      client.trackConversation(c.conv_id, continuousCursor, c.is_super === true);
      done.add(c.conv_id); // 登记完（游标已作基线）才算数：preloadNew 对「已登记」的会话传 0 当游标
      // 载入删除墓碑（须早于 syncTracked）：被删的 conv_seq 进内存墓碑，onMessage 收到服务端重推时直接丢弃。
      const del = await client.loadDeletedSeqs(c.conv_id);
      if (del.length) deletedByConv.current[c.conv_id] = new Set(del);
      if (local.length === 0) continue;
      loaded[c.conv_id] = local;
      const seen = (seenByConv.current[c.conv_id] ??= new Set());
      local.forEach((m) => m.convSeq > 0 && seen.add(m.convSeq)); // 防服务端同步重复回显
    }
    if (Object.keys(loaded).length) preloadMsgs(loaded);
  }, [clientRef, doneFor, seenByConv, deletedByConv, preloadMsgs]);

  /** 会话刷新用：只预载本 client 还没登记过的会话，返回它们的 conv_id（调用方只同步这几个）。
   *  已登记过的只刷新超级群标记（群可能刚升级）：`trackConversation` 的游标基线只在首次登记时设，
   *  这里传的 0 不会把它盖掉。 */
  const preloadNew = useCallback(async (convs: Conversation[]): Promise<string[]> => {
    const client = clientRef.current;
    if (!client) return [];
    const done = doneFor(client);
    const fresh = convs.filter((c) => !done.has(c.conv_id));
    for (const c of convs) {
      if (done.has(c.conv_id)) client.trackConversation(c.conv_id, 0, c.is_super === true);
    }
    if (fresh.length) await preloadLocal(fresh);
    return fresh.map((c) => c.conv_id);
  }, [clientRef, doneFor, preloadLocal]);

  return { preloadLocal, preloadNew };
}
