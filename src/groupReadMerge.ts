// 群「全员已读」位点合并（IMServer docs/design/GROUP_READ_REALTIME_DESIGN.md）。
import type { Conversation } from "./sdk/protocol";

/**
 * 会话列表整表刷新时，群行的 `group_read_seq` 与本地已有值**取较大**。
 *
 * 实时帧 `group_read` 只改本地行；若某次刷新的请求在推送之前发出、之后才回来，整表覆盖会把刚推来的
 * 更大值退回去（打开那个群时就按旧值播种，又停回单勾，直到下一次刷新）。位点单调，取大即正确。
 * Android 对应 `ReadTick.seed`（maxOf(existing, groupReadSeq)）。
 */
export function keepHigherGroupRead(prev: readonly Conversation[], next: Conversation[]): Conversation[] {
  const had = new Map<string, number>();
  for (const c of prev) if ((c.group_read_seq ?? 0) > 0) had.set(c.conv_id, c.group_read_seq!);
  if (had.size === 0) return next;
  return next.map((c) => {
    const old = had.get(c.conv_id) ?? 0;
    return old > (c.group_read_seq ?? 0) ? { ...c, group_read_seq: old } : c;
  });
}
