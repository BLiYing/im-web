// 「清除到位点」例程（OFFLINE_BACKLOG_DESIGN §6.7 清空聊天记录 / §6.7.1 删除会话）：存储事务 + 内存镜像对齐。
// 从 imSdk.ts 抽出（文件体量红线）；IMClient 只经 ClearHost 把自己的内存镜像递进来，行为与抽出前逐行一致。
import type { ChatMessage } from "./protocol";
import * as localStore from "./localStore";
import { loadRanges } from "./localStore.ranges";
import { clipRangesThrough, normalizeRanges, type SeqRange } from "./ranges";

export type ClearSource = "local" | "frame" | "align";
export interface ClearHost {
  uid: string;
  clearedSeq: Map<string, number>; floorSeq: Map<string, number>; headSeq: Map<string, number>; syncedSeq: Map<string, number>;
  convRanges: Map<string, SeqRange[]>; gapped: Set<string>;
  raiseCleared(convId: string, seq: number): void;
  updateSynced(convId: string, seq: number): void;
  onRanges(convId: string): void;
  onConvCleared(convId: string, floor: number, advanced: boolean, ctx: { source: ClearSource; retained: boolean }): void;
}

/** 清空聊天记录（仅本机，§6.7）：存储事务里删消息 + 清区间 + 抬位点 + 推游标，再对齐内存镜像。`knownLatest` 传会话列表 latest（head/游标这里补）。 */
export async function clearConversationImpl(h: ClearHost, convId: string, knownLatest = 0, exact = false): Promise<number> {
  const known = exact ? knownLatest : Math.max(knownLatest, h.headSeq.get(convId) ?? 0, h.syncedSeq.get(convId) ?? 0);
  h.raiseCleared(convId, known);   // 先乐观抬内存位点（只增不减，无害）：存储往返期间到的 sync/window 页要被它挡住，别又冒上屏
  await localStore.clearMessages(h.uid, convId, known, exact);
  const floor = await localStore.loadClearedUpTo(h.uid, convId);
  h.raiseCleared(convId, floor);
  h.updateSynced(convId, floor);
  await reloadRangesAfterClear(h, convId, floor);
  if ((h.headSeq.get(convId) ?? 0) <= floor) h.gapped.delete(convId);   // 位点追上 head：可见范围内已无缺口
  h.onRanges(convId);
  return floor;
}

/** 清空后重建区间镜像：精确清除会留下位点之后的段（存储里还在），镜像不能整个丢掉，否则那些真消息被当成「没下载」。 */
async function reloadRangesAfterClear(h: ClearHost, convId: string, floor: number): Promise<void> {
  const stored = await loadRanges(h.uid, convId).then((r) => r.ranges).catch(() => [] as SeqRange[]);
  const kept = normalizeRanges([...clipRangesThrough(h.convRanges.get(convId) ?? [], floor), ...clipRangesThrough(stored, floor)]);
  if (kept.length > 0) h.convRanges.set(convId, kept); else h.convRanges.delete(convId);
}

/** 「清除到位点」（§6.7.1 删除会话）：清空例程 + 丢服务端下界缓存；`at>0` 走精确位点（保留其后新消息），否则取本机 head。 */
export async function clearToFloorImpl(h: ClearHost, c: string, at = 0, source: ClearSource = "local"): Promise<number> {
  h.floorSeq.delete(c);
  const before = h.clearedSeq.get(c) ?? 0;   // 只看**本标签内存镜像**：存储是各标签页共享的，别的标签 / 先到的对齐写过它，不代表本标签的 UI 清过
  const f = await clearConversationImpl(h, c, at, at > 0);
  const retained = (await localStore.loadConversation(h.uid, c).catch(() => [] as ChatMessage[])).some((m) => m.convSeq > f);
  h.onConvCleared(c, f, f > before, { source, retained });
  return f;
}
