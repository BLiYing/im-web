// 渲染窗口的切片规则（IMServer/docs/design/OFFLINE_BACKLOG_DESIGN.md §4.7）。
//
// 为什么要单独成文件并配测试：这段逻辑同时要满足三件互相拉扯的事——
//   ① DOM 有上限（W2 的初衷：3 万条会话曾渲染 4000+ 条、近 3 万节点）；
//   ② 有缺口时**不能跨缺口拼接**（本地同时存着缺口两侧的消息，按下标切必然横跨）；
//   ③ 取回更早一页后窗口必须真的**往前移**，否则屏幕纹丝不动、加载标志位永远复位不了。
// 三条里漏任何一条，表现都是"界面正常但行为悄悄错"，靠肉眼极难发现（②③ 都是实测踩出来的）。

import { coversSpan, type SeqRange } from "./sdk/ranges";

/** 切片只关心 conv_seq，故用最小结构约束，避免把 ChatMessage 的全部字段拖进来。 */
export interface SeqLike {
  convSeq: number;
}

/**
 * 把本地消息切成**连续段**（入参需按 conv_seq 升序）。
 *
 * `convSeq === 0` 是待发/失败的本地消息（还没拿到服务端序号），它们**不切断段**——
 * 排序后它们必在末尾，属于尾段的一部分，切断了刚发的消息就会从窗口里消失。
 *
 * **「连续」判的是"中间有没有没下载的东西"，不是"seq 连不连号"**（2026-09-03 实测踩出来的）。
 * 一个 conv_seq 会被这些占掉却永远不成为一条消息：msg_op 事件行（撤回/编辑/置顶/为所有人删除）、
 * 已被删除的墓碑、对我不可见的行。只看 `seq === lastSeq + 1`，它们全都被当成缺口：
 * 18 条消息的群里删掉一张图（seq 14）、后面跟着三条 msg_op，尾段就只剩 seq 15 那条系统消息，
 * 用户看到的是一个**空会话**，点一下置顶消息跳过去才发现消息都还在。
 *
 * 所以传入区间清单 `ranges`（"本地已齐全的段"）：两条消息落在**同一个**区间里，
 * 中间缺的那几个 seq 就是上面那些"下载过但不成为消息"的，不切；跨区间才是真没下载，切。
 * `ranges` 为空（清单还没预热好 / 老库）时退回 seq 连号判定——宁可多切一刀，也不能把
 * 缺口两侧静默拼在一起（那是**无声**的错，比多切一刀严重得多）。
 */
export function contiguousSegments<T extends SeqLike>(all: T[], ranges: SeqRange[] = []): T[][] {
  const segs: T[][] = [];
  let cur: T[] = [];
  let lastSeq = 0;
  for (const m of all) {
    if (m.convSeq > 0 && lastSeq > 0 && cur.length > 0 && !joined(lastSeq, m.convSeq, ranges)) {
      segs.push(cur);
      cur = [];
    }
    cur.push(m);
    if (m.convSeq > 0) lastSeq = m.convSeq;
  }
  if (cur.length > 0) segs.push(cur);
  return segs;
}

/** 相邻两条已渲染消息之间是否**没有未下载的东西**（即可以紧挨着渲染）。 */
function joined(prevSeq: number, curSeq: number, ranges: SeqRange[]): boolean {
  if (curSeq === prevSeq + 1) return true;                 // 真·挨着
  if (ranges.length === 0) return false;                   // 无清单可依 → 保守切开
  return coversSpan(ranges, prevSeq, curSeq);              // 同一段内 → 中间那些 seq 已下载过，只是不成为消息
}

/**
 * 取当前该渲染的那一窗。
 *
 * anchor 为空 → 贴最新：取**尾段**的最后 size 条。
 * anchor 命中某段 → 在**那一段内**以它为中心开窗；锚点不在本地则回退到贴最新。
 *
 * 关键是"段内"：`allLocal` 是一个横跨缺口的扁平数组，按下标切窗必然会把缺口另一侧的
 * 旧岛拼进来——两段不相邻的历史紧挨着渲染，时间戳还是递增的，看不出任何异常。
 */
export function visibleSlice<T extends SeqLike>(all: T[], anchor: number | null, size: number, ranges: SeqRange[] = []): T[] {
  if (all.length === 0 || size <= 0) return [];
  const segs = contiguousSegments(all, ranges);
  const tail = segs[segs.length - 1];
  if (anchor === null) return tail.length <= size ? tail : tail.slice(-size);

  const seg = segs.find((s) => s.some((m) => m.convSeq === anchor));
  if (!seg) return tail.length <= size ? tail : tail.slice(-size); // 锚点已不在本地（被删）
  if (seg.length <= size) return seg;
  const at = seg.findIndex((m) => m.convSeq === anchor);
  const half = Math.floor(size / 2);
  const lo = Math.min(Math.max(0, at - half), seg.length - size);
  return seg.slice(lo, lo + size);
}
