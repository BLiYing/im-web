// 自动删除消息（v2 会话级共享、不追溯）：触发时机 + 清理执行 + 会话级改档位的唯一写路径；per-conv 状态 = {sec, from}，过期窗口 [from, now-sec*1000]（AUTO_DELETE_DESIGN §3）。
// 纯判定在 autoDelete.ts；这里只管状态与副作用。清理 = 复用「仅为我删除」的**本地**移除路径
// （IMClient.removeMessagesLocal：墓碑 + onMessageRemoved → App 既有处理：聊天页气泡 / 详情媒体库 / 置顶 / 查看器），
// **不调**服务端 hide 接口。会话列表预览 / 未读本地重算（patchConvAfterSweep，并写回会话缓存），随后 onMessageRemoved 已触发列表节流刷新取权威值。
// 触发：会话档位变化 / 内存消息表载入 / 连接状态变化 / 页面回可见 / 前台每 30 秒；多路触发走单飞合并。
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { ChatMessage, Conversation, ConvUpdate } from "./sdk/protocol";
import type { MsgMap } from "./messageStore";
import { expired, expiredSeqs, needsConfirm, patchConvAfterSweep, sanitizeState, stateOf, tierLabel, type AutoDeleteState } from "./autoDelete";
import { t } from "./i18n";

export const SWEEP_INTERVAL_MS = 30_000;

export interface UseAutoDeleteOptions {
  clientRef: MutableRefObject<IMClient | null>;
  uid: string;
  conversations: Conversation[];
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  msgsByConv: MsgMap;
  connState: string;
  refreshConversations: () => Promise<unknown>;
  askConfirm: (message: string, opts?: { title?: string; okText?: string; cancelText?: string; danger?: boolean }) => Promise<boolean>;
  setToast: (msg: string) => void;
}

export interface UseAutoDelete {
  /** 入库过滤：该会话此刻按本机时钟是否已过期（接给 IMClient handlers.isExpired）。 */
  isExpired: (convId: string, timestamp: number) => boolean;
  /** conv_update 帧：就地覆盖档位 sec+from（不等列表重拉）；sec>0 且 sec/from 有变化 → 立即清理该会话。 */
  applyConvUpdate: (u: ConvUpdate) => void;
  /** 改本会话档位。新>0 且 ≠ 当前先弹说明性确认（非 destructive）；成功后用回包 sec+from 更新并扫一遍。返回 false = 取消或失败（调用方回滚选中态）；300204 → toast autodel.group_admin_only。 */
  setConvAutoDelete: (c: Conversation, sec: number) => Promise<boolean>;
}

export function useAutoDelete(o: UseAutoDeleteOptions): UseAutoDelete {
  const { clientRef, uid, conversations, setConversations, msgsByConv, connState, refreshConversations, askConfirm, setToast } = o;
  const adRef = useRef<Record<string, AutoDeleteState>>({});
  const convsRef = useRef<Conversation[]>(conversations);
  const msgsRef = useRef<MsgMap>(msgsByConv);
  const uidRef = useRef(uid);
  convsRef.current = conversations; msgsRef.current = msgsByConv; uidRef.current = uid;
  // 档位表随会话列表同步（渲染期写，入库过滤要读最新值；applyConvUpdate / setConvAutoDelete 另会立即写入）。
  const next: Record<string, AutoDeleteState> = {};
  for (const c of conversations) if ((c.auto_delete_sec ?? 0) > 0) next[c.conv_id] = stateOf(c);
  adRef.current = next;
  const secSig = Object.entries(next).map(([id, a]) => `${id}:${a.sec}:${a.from}`).join(","); // sec 或 from 变化都触发全量扫

  const isExpired = useCallback((convId: string, ts: number) => {
    const a = adRef.current[convId];
    return !!a && expired(ts, a.sec, a.from, Date.now());
  }, []);

  // —— 清理：单飞 + 置脏补扫 ——
  const running = useRef(false);
  const dirty = useRef(false);
  const cacheDirty = useRef(false); // 本地重算过会话行 → 提交后把列表写回缓存，别让刷新页面又读到旧预览
  const queued = useRef<Set<string> | "all">("all");
  const sweepOne = useCallback(async (client: IMClient, cid: string) => {
    const ad = adRef.current[cid] ?? { sec: 0, from: 0 };
    const list: ChatMessage[] = msgsRef.current[cid] ?? [];
    const now = Date.now();
    const seqs = new Set(expiredSeqs(list, ad, now));
    const removed = list.filter((m) => seqs.has(m.convSeq));
    const survivors = list.filter((m) => !seqs.has(m.convSeq));
    if (seqs.size > 0) await client.removeMessagesLocal(cid, [...seqs]);
    // 会话行无论内存里有没有被清的消息都要对一遍：预览那条可能不在内存窗口（刷新 / 缓存 / 列表刷新带回旧预览）。
    setConversations((prev) => prev.map((c) => {
      if (c.conv_id !== cid) return c;
      const n = patchConvAfterSweep(c, removed, survivors, uidRef.current, ad, now);
      if (n !== c) cacheDirty.current = true;
      return n;
    }));
  }, [setConversations]);
  const sweep = useCallback((ids?: string[]) => {
    if (ids) { if (queued.current !== "all") ids.forEach((i) => (queued.current as Set<string>).add(i)); } else queued.current = "all";
    if (running.current) { dirty.current = true; return; }
    running.current = true;
    void (async () => {
      try {
        do {
          dirty.current = false;
          const client = clientRef.current;
          const want = queued.current; queued.current = new Set();
          if (!client) break;
          const targets = want === "all" ? Object.keys(adRef.current) : [...want].filter((i) => (adRef.current[i]?.sec ?? 0) > 0);
          for (const cid of targets) await sweepOne(client, cid);
        } while (dirty.current);
      } catch { /* 清理是 best-effort：下一轮（30s / 回前台）会再扫 */ } finally { running.current = false; }
    })();
  }, [clientRef, sweepOne]);

  useEffect(() => {
    if (!cacheDirty.current) return;
    cacheDirty.current = false;
    clientRef.current?.cacheConversations(conversations);
  }, [conversations, clientRef]);
  // 列表被刷新 / 缓存回填后预览那条可能又是过期的：预览签名变了就补扫（patch 后签名再变一次，第二轮是空操作）。
  const lastSig = conversations.filter((c) => (c.auto_delete_sec ?? 0) > 0).map((c) => `${c.conv_id}:${c.last_message?.conv_seq ?? 0}`).join(",");
  const msgConvCount = Object.keys(msgsByConv).length;
  useEffect(() => { sweep(); }, [secSig, lastSig, msgConvCount, connState, sweep]); // 档位变 / 预载完成 / 重连 → 全量扫（内存过滤，开销小）
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") sweep(); };
    const id = window.setInterval(tick, SWEEP_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick); // 回前台补扫
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [sweep]);

  /** 就地覆盖某会话的 sec+from（两个字段永远一起写）；返回 sec>0 且与之前不同（该触发扫描）。 */
  const setState = useCallback((cid: string, rawSec: number, rawFrom: number): boolean => {
    const { sec, from } = sanitizeState(rawSec, rawFrom);
    const prev = adRef.current[cid];
    const changed = sec > 0 && (prev?.sec !== sec || prev?.from !== from);
    if (sec > 0) adRef.current[cid] = { sec, from }; else delete adRef.current[cid];
    setConversations((list) => list.map((c) => (c.conv_id === cid ? { ...c, auto_delete_sec: sec, auto_delete_from: from } : c)));
    return changed;
  }, [setConversations]);

  const applyConvUpdate = useCallback((u: ConvUpdate) => {
    if (u.action !== "settings" || !u.conv_id) return;
    if (setState(u.conv_id, u.auto_delete_sec, u.auto_delete_from ?? 0)) sweep([u.conv_id]);
  }, [setState, sweep]);

  const setConvAutoDelete = useCallback(async (c: Conversation, sec: number): Promise<boolean> => {
    if (sec === (c.auto_delete_sec ?? 0)) return true;
    if (needsConfirm(c.auto_delete_sec ?? 0, sec)) {
      const key = c.is_group ? "autodel.confirm.message_group" : "autodel.confirm.message";
      const ok = await askConfirm(t(key, { period: tierLabel(t, sec) }), { title: t("autodel.confirm.title"), okText: t("autodel.confirm.action") });
      if (!ok) return false;
    }
    let echo: { auto_delete_sec: number; auto_delete_from: number } | undefined;
    try {
      // 唯一显式带 auto_delete_sec 的 PUT（其余调用点一律省略，避免本地过期缓存覆盖别人刚设的共享档位）。
      echo = await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: c.pinned_at ?? 0, muted: !!c.muted, marked_unread: !!c.marked_unread, auto_delete_sec: sec });
    } catch (e) {
      setToast(t((e as { code?: number }).code === 300204 ? "autodel.group_admin_only" : "autodel.save_failed"));
      return false;
    }
    // 用回包的 sec+from 一起覆盖（不能只写 sec：旧 from 会让新档位追溯清历史）；没有回包就等 conv_update / 列表回灌。
    if (echo && setState(c.conv_id, echo.auto_delete_sec, echo.auto_delete_from)) sweep([c.conv_id]);
    void refreshConversations();
    return true;
  }, [askConfirm, clientRef, refreshConversations, setState, setToast, sweep]);

  return { isExpired, applyConvUpdate, setConvAutoDelete };
}
