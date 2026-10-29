// 「清除所有对话」的本机批量清除（CLEAR_ALL_CONVERSATIONS_DESIGN §4）。复用 §6.7.1 「清除到位点」例程的各个零件
// （clearRoutine.ts：raiseCleared / reloadRangesAfterClear / onConvCleared），只是把 N 次存储事务合成一次：
//   存储 `clearMessagesBatch`（单事务，位点取服务端 cleared_at）→ 逐会话对齐内存镜像 → 逐会话通知 UI。
// 之后到达的 conv_update(delete) 回声走 clearToFloor：本标签位点已抬高 → advanced=false → 不重复清 UI，幂等。
import * as localStore from "./localStore";
import { reloadRangesAfterClear, type ClearHost } from "./clearRoutine";

export async function clearAllToFloorsImpl(h: ClearHost, items: { convId: string; clearedAt: number }[]): Promise<void> {
  const list = items.filter((i) => i.convId && i.clearedAt > 0);
  if (list.length === 0) return;
  const before = new Map(list.map((i) => [i.convId, h.clearedSeq.get(i.convId) ?? 0]));   // 只看本标签内存镜像（同 clearToFloorImpl）
  for (const i of list) { h.floorSeq.delete(i.convId); h.raiseCleared(i.convId, i.clearedAt); }   // 先乐观抬位点：存储往返期间到的 sync/window 页要被它挡住
  await localStore.clearMessagesBatch(h.uid, list.map((i) => ({ convId: i.convId, at: i.clearedAt })));
  for (const i of list) {
    const c = i.convId;
    const floor = Math.max(i.clearedAt, await localStore.loadClearedUpTo(h.uid, c));
    h.raiseCleared(c, floor);
    h.updateSynced(c, floor);
    await reloadRangesAfterClear(h, c, floor);
    if ((h.headSeq.get(c) ?? 0) <= floor) h.gapped.delete(c);
    h.onRanges(c);
    // source=align：不关聊天页（正开着的会话保持打开且为空）；batch：UI 侧别为每个会话各发一次置顶网络重拉。retained 批量路径不读盘（无消费方）。
    h.onConvCleared(c, floor, floor > (before.get(c) ?? 0), { source: "align", retained: false, batch: true });
  }
}
