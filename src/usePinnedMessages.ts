// 会话置顶消息（G0）的状态簇：置顶集合 + 重拉（立即 / 300ms 按会话合并）+ msg_op 对齐 + 置顶面板开合。
// 从 App.tsx 抽出（App 贴体量红线，CODING_STYLE §7 决策树①「有自己状态/生命周期的一簇逻辑 → Hook」）。
// 设计见 IMServer docs/design/PINNED_PANEL_DESIGN.md（v3：横幅恒显最新一条、点横幅开面板、长按取消 / 一键取消所有）。
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { MsgOpPatch, PinnedMessage } from "./sdk/protocol";
import { keyedDebounce } from "./keyedDebounce";
import { latestPinned } from "./pinned";
import { dropCleared } from "./sdk/clearFloor";
import { LOG_TAG, logger } from "./logging/logger";

/** 置顶重拉的合并窗口：批量删除 / 一键取消所有置顶带来的一串事件落在窗口里只拉一次（三端同 300ms，见 SYMMETRY *PinnedBanner*）。 */
const PINNED_REFRESH_COALESCE_MS = 300;

export function usePinnedMessages(clientRef: MutableRefObject<IMClient | null>, convId: string) {
  // conv_id -> 置顶集合（服务端按 pinned_at 倒序）。进会话拉一次，之后靠实时 msg_op{op:pin} 帧触发重拉。
  const [byConv, setByConv] = useState<Record<string, PinnedMessage[]>>({});
  // 镜像：WS 回调是登录那一刻建的闭包，读不到后续 state——判断「撤回/编辑的是不是置顶项」只能经 ref 取当前值。
  const ref = useRef(byConv);
  ref.current = byConv;
  const [panelOpen, setPanelOpen] = useState(false);

  // best-effort：拉不到就不显横幅，绝不打断聊天。
  // 拉取代次（按会话）：立即重拉与 300ms 合并重拉会并发，**只有最后发出的那份有资格落地**，先发后到的旧响应丢弃
  // （否则取消置顶后一份更早发出的响应晚到，会把刚摘掉的行又写回来；Android ChatBanners.reloadGen 同口径）。
  const gens = useRef<Record<string, number>>({});
  const refresh = useCallback(async (cid: string) => {
    if (!cid) return;
    const my = (gens.current[cid] = (gens.current[cid] ?? 0) + 1);
    try {
      const client = clientRef.current;
      const all = (await client?.fetchPinned(cid)) ?? [];
      // 「清空聊天记录」只记本机位点（服务端不知道）：位点以内的置顶消息本体已不可见，横幅不能再指向它们
      // （否则清空 → 删好友 → 重新加回后，仍显示清空前的旧置顶）。
      const floor = client ? Math.max(client.clearedUpToOf(cid), await client.loadClearedUpTo(cid)) : 0;
      const items = dropCleared(all, floor);
      if (my !== gens.current[cid]) return;
      setByConv((prev) => ({ ...prev, [cid]: items }));
    } catch (e) {
      logger.warn(LOG_TAG.ui, "fetch_pinned_failed", { conv_id: cid, message: (e as Error).message });
    }
  }, [clientRef]);
  const schedule = useMemo(() => keyedDebounce(PINNED_REFRESH_COALESCE_MS, (cid) => void refresh(cid)), [refresh]);

  /** 本地先摘掉一条（取消置顶帧到达时立刻生效：面板开着能实时看到那行消失，空集自动收起），随后合并重拉对齐。 */
  const dropLocal = useCallback((cid: string, seq: number) => {
    gens.current[cid] = (gens.current[cid] ?? 0) + 1; // 作废在途的旧拉取（它仍含这一条），随后的合并重拉会补上最新
    setByConv((prev) => (prev[cid]?.some((p) => p.convSeq === seq)
      ? { ...prev, [cid]: prev[cid].filter((p) => p.convSeq !== seq) } : prev));
  }, []);

  /** msg_op 应用到某条后的置顶对齐（App.onMsgOp 转调）。
   *  - 取消置顶（单条或批量帧逐条，pinnedAt=0）：本地摘除 + 合并重拉（批量帧 N 条只拉一次）；
   *  - 置顶：立即重拉（要服务端那份完整消息对象）；
   *  - 撤回/编辑命中置顶项也重拉：服务端列表剔除撤回、编辑改了文案；不刷会留一条指向墓碑/旧文案的横幅。 */
  const onMsgOp = useCallback((cid: string, seq: number, patch: MsgOpPatch) => {
    if (patch.pinnedAt === 0) { dropLocal(cid, seq); schedule(cid); return; }
    const touches = (patch.recalledAt !== undefined || patch.editedAt !== undefined)
      && (ref.current[cid] ?? []).some((p) => p.convSeq === seq);
    if (patch.pinnedAt !== undefined || touches) void refresh(cid);
  }, [dropLocal, schedule, refresh]);

  /** 消息被物理移除：**不看是否命中横幅**（置顶列表未加载完时会漏判），按会话合并无条件重拉；只管打开过的会话。 */
  const onRemoved = useCallback((cid: string, isCurrent: boolean) => {
    if (isCurrent || cid in ref.current) schedule(cid);
  }, [schedule]);

  // 进会话拉一次；切会话收起面板。
  useEffect(() => {
    setPanelOpen(false);
    if (convId) void refresh(convId);
  }, [convId, refresh]);

  const active = useMemo(() => byConv[convId] ?? [], [byConv, convId]);
  // 面板开着时集合变空（最后一条被取消 / 撤回 / 一键取消所有）→ 自动收起（Android 已有，iOS/Web 补齐，DESIGN §2.3）。
  useEffect(() => { if (panelOpen && active.length === 0) setPanelOpen(false); }, [panelOpen, active.length]);

  return { active, shown: latestPinned(active), refresh, schedule, onMsgOp, onRemoved, panelOpen, setPanelOpen };
}
