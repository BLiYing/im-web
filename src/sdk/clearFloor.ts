// 「清空聊天记录」的**本机清空位点** `clearedUpTo` 的纯逻辑（IMServer/docs/design/OFFLINE_BACKLOG_DESIGN.md §6.7）。
//
// 对端：Android `data/ClearFloor.kt`。**要一致的是不变式，不是代码形状**：
//   · 位点只增不减、纯本机；清空时 = 本机所知的会话最新；
//   · `conv_seq <= 位点` 的消息不再落库、不进内存、不算缺口、不再问服务端；位点之后的新消息照常收；
//   · 有效可见下界 = max(服务端 has_before=false 记下的 floorSeq, 位点)——两个量各存各的，用时取大，
//     **不要混成一个变量**（服务端下界会随群设置变小、会在重连时清掉；位点永不回退）。
//
// 桌面主进程（SQLite）引不了本文件（两套独立依赖树，TS6059），`desktop/src/main/sqliteStore.ts` 里有三行
// 平行实现；护栏是两侧共跑的 `localStore.contract.clear.ts`。

/** 清空那一刻该取的位点：本机所知的最新位置取大（含已有位点——只增不减）。 */
export function floorAtClear(...known: number[]): number {
  return Math.max(0, ...known.map((n) => (Number.isFinite(n) ? n : 0)));
}

/** 丢掉 `conv_seq <= 位点` 的消息（sync / window 页里可能又把用户清掉的那段带回来）。`convSeq<=0`（被拒/发送中）不受影响。 */
export function dropCleared<T extends { convSeq: number }>(list: T[], clearedUpTo: number): T[] {
  return clearedUpTo <= 0 ? list : list.filter((m) => m.convSeq <= 0 || m.convSeq > clearedUpTo);
}

/**
 * 有效可见下界（**开区间口径**：`conv_seq <= 返回值` 的消息对本端不存在）= 服务端下界与本机清空位点取大。
 *
 * 两个输入口径不同，这里一处归一：`clearedUpTo` 本来就是「≤ 它都没了」；而服务端记下的 `floorSeq` 是
 * `has_before=false` 那一窗里**最小的真消息** seq（它本身可见），所以折成 `floorSeq - 1`。
 * 所有「floor 以下不用再问 / 不要求清单覆盖」的判据（planEntryWindow / planJumpToLatest / planBumpCatchUp /
 * unreadBelow / isComplete）吃这一个量；两个原始值各存各的，不混成一个变量。
 */
export function effectiveFloor(serverFloorSeq: number | undefined, clearedUpTo: number | undefined): number {
  return Math.max((serverFloorSeq ?? 0) > 0 ? (serverFloorSeq as number) - 1 : 0, clearedUpTo ?? 0, 0);
}

/**
 * 上滚闸：`oldestSeq`（当前渲染的最早一条）是否已踩在可见下界上、再往上不会有东西。
 * 服务端下界是「最小真消息」（含），清空位点是「≤ 它都没了」，所以位点的下一条（`位点+1`）就是最早可见的一条。
 * 两者都未知（0）时恒 false——未知下界不许当成到顶。
 */
export function atVisibleFloor(oldestSeq: number, serverFloorSeq: number | undefined, clearedUpTo: number | undefined): boolean {
  const earliestVisible = Math.max(serverFloorSeq ?? 0, (clearedUpTo ?? 0) > 0 ? (clearedUpTo as number) + 1 : 0);
  return earliestVisible > 0 && oldestSeq <= earliestVisible;
}

/**
 * 老库回填：升级前清空过的会话没有任何痕迹，按「游标以内本地没有的那一截 = 清掉的」推位点。
 * @param cursor      同步游标（<=0 的会话不回填，返回 0）
 * @param minLocalSeq 游标以内最小的本地消息 conv_seq（0 = 一条都没有）
 *
 * 误伤面：群 `history_visible` 抬高的下界、开头几条是不落库的事件行——那些序号下本来就没有可显示的东西，当下界无害。
 */
export function backfillClearedUpTo(cursor: number, minLocalSeq: number): number {
  if (!(cursor > 0)) return 0;
  return minLocalSeq > 0 ? Math.max(0, minLocalSeq - 1) : cursor;
}

/** 从消息记录键 `owner|convId|convSeq` 里解出 conv_seq；被拒消息（`c:` 型）与非法键返回 0。 */
export function seqFromRecordKey(id: string): number {
  const tail = id.slice(id.lastIndexOf("|") + 1);
  if (tail.startsWith("c:")) return 0;
  const n = Number(tail);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
