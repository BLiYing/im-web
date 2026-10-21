// 自动删除消息：触发时机 + 清理执行 + 会话级改档位的唯一写路径（AUTO_DELETE_DESIGN §3）。
// 纯判定在 autoDelete.ts；这里只管状态与副作用。清理 = 复用「仅为我删除」的**本地**移除路径
// （IMClient.removeMessagesLocal：墓碑 + onMessageRemoved → App 既有处理：聊天页气泡 / 详情媒体库 / 置顶 / 查看器），
// **不调**服务端 hide 接口。会话列表预览 / 未读本地重算（patchConvAfterSweep），随后 onMessageRemoved 已触发列表节流刷新取权威值。
// 触发：会话档位变化 / 内存消息表载入 / 连接状态变化 / 页面回可见 / 前台每 30 秒；多路触发走单飞合并。
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { ChatMessage, Conversation, ConvUpdate } from "./sdk/protocol";
import type { MsgMap } from "./messageStore";
import { expired, expiredSeqs, needsConfirm, patchConvAfterSweep, periodKey } from "./autoDelete";
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
  /** conv_update 帧：就地覆盖档位（不等列表重拉）并按需立即清理。 */
  applyConvUpdate: (u: ConvUpdate) => void;
  /** 改本会话档位。开启 / 缩短先确认；成功后立即清理。返回 false = 取消或失败（调用方回滚选中态）。 */
  setConvAutoDelete: (c: Conversation, sec: number) => Promise<boolean>;
}

export function useAutoDelete(o: UseAutoDeleteOptions): UseAutoDelete {
  const { clientRef, uid, conversations, setConversations, msgsByConv, connState, refreshConversations, askConfirm, setToast } = o;
  const secRef = useRef<Record<string, number>>({});
  const convsRef = useRef<Conversation[]>(conversations);
  const msgsRef = useRef<MsgMap>(msgsByConv);
  const uidRef = useRef(uid);
  convsRef.current = conversations; msgsRef.current = msgsByConv; uidRef.current = uid;
  const secSig = conversations.filter((c) => (c.auto_delete_sec ?? 0) > 0).map((c) => `${c.conv_id}:${c.auto_delete_sec}`).join(",");
  // 档位表随会话列表同步（渲染期写，入库过滤要读最新值；applyConvUpdate / setConvAutoDelete 另会立即写入）。
  const next: Record<string, number> = {};
  for (const c of conversations) if ((c.auto_delete_sec ?? 0) > 0) next[c.conv_id] = c.auto_delete_sec!;
  secRef.current = next;

  const isExpired = useCallback((convId: string, ts: number) => expired(ts, secRef.current[convId] ?? 0, Date.now()), []);

  // —— 清理：单飞 + 置脏补扫 ——
  const running = useRef(false);
  const dirty = useRef(false);
  const queued = useRef<Set<string> | "all">("all");
  const sweepOne = useCallback(async (client: IMClient, cid: string) => {
    const sec = secRef.current[cid] ?? 0;
    const list: ChatMessage[] = msgsRef.current[cid] ?? [];
    const seqs = new Set(expiredSeqs(list, sec, Date.now()));
    if (seqs.size === 0) return;
    const removed = list.filter((m) => seqs.has(m.convSeq));
    const survivors = list.filter((m) => !seqs.has(m.convSeq));
    await client.removeMessagesLocal(cid, [...seqs]);
    setConversations((prev) => prev.map((c) => (c.conv_id === cid ? patchConvAfterSweep(c, removed, survivors, uidRef.current) : c)));
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
          const targets = want === "all" ? Object.keys(secRef.current) : [...want].filter((i) => (secRef.current[i] ?? 0) > 0);
          for (const cid of targets) await sweepOne(client, cid);
        } while (dirty.current);
      } catch { /* 清理是 best-effort：下一轮（30s / 回前台）会再扫 */ } finally { running.current = false; }
    })();
  }, [clientRef, sweepOne]);

  const msgConvCount = Object.keys(msgsByConv).length;
  useEffect(() => { sweep(); }, [secSig, msgConvCount, connState, sweep]); // 档位变 / 预载完成 / 重连 → 全量扫（内存过滤，开销小）
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") sweep(); };
    const id = window.setInterval(tick, SWEEP_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick); // 回前台补扫
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [sweep]);

  const setSec = useCallback((cid: string, sec: number) => {
    if (sec > 0) secRef.current[cid] = sec; else delete secRef.current[cid];
    setConversations((prev) => prev.map((c) => (c.conv_id === cid ? { ...c, auto_delete_sec: sec } : c)));
  }, [setConversations]);

  const applyConvUpdate = useCallback((u: ConvUpdate) => {
    if (u.action !== "settings" || !u.conv_id) return;
    setSec(u.conv_id, u.auto_delete_sec);
    if (u.auto_delete_sec > 0) sweep([u.conv_id]);
  }, [setSec, sweep]);

  const setConvAutoDelete = useCallback(async (c: Conversation, sec: number): Promise<boolean> => {
    const old = c.auto_delete_sec ?? 0;
    if (sec === old) return true;
    if (needsConfirm(old, sec)) {
      const ok = await askConfirm(t("autodel.confirm.message", { period: t(periodKey(sec)) }),
        { title: t("autodel.confirm.title"), okText: t("autodel.confirm.action"), danger: true });
      if (!ok) return false;
    }
    try {
      await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: c.pinned_at ?? 0, muted: !!c.muted, marked_unread: !!c.marked_unread, auto_delete_sec: sec });
    } catch { setToast(t("autodel.save_failed")); return false; }
    setSec(c.conv_id, sec);
    sweep([c.conv_id]); // 确认后立即本地清理
    void refreshConversations();
    return true;
  }, [askConfirm, clientRef, refreshConversations, setSec, setToast, sweep]);

  return { isExpired, applyConvUpdate, setConvAutoDelete };
}
