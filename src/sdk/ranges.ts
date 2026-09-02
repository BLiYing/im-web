// 「本地有哪几段」区间清单（docs/design/OFFLINE_BACKLOG_DESIGN.md §4.2）。
//
// 本地库从「整本账的副本」变成「看过的页的复印件 + 一张目录」。这个文件就是那张目录的
// 纯逻辑部分：一组按 conv_seq 的**闭区间**，互不相交、升序、相邻即合并。
//
// 为什么值得单独成文件并配单测：这套区间代数是整个方案的正确性底座——
// 「本地齐不齐」这个判断一旦算错，上层就会拿一段残缺数据去回答"整个会话"的问题，
// 而那种错误**不报错、不崩溃，只是答案悄悄不对**（MESSAGE_WINDOW_DESIGN §5.1 的教训）。
// 纯函数 + 单测钉死，比在 IndexedDB 事务里调试便宜得多。

/** 闭区间 [lo, hi]，lo ≤ hi，均为 conv_seq。 */
export interface SeqRange {
  lo: number;
  hi: number;
}

/**
 * 归一化：过滤非法项 → 升序 → 合并重叠与**相邻**区间。
 *
 * 相邻也要合并（`hi + 1 === lo`）：conv_seq 是连续整数，[1,10] 与 [11,20] 之间没有空隙，
 * 留成两段会让 `isComplete` 永远判 false，于是一个明明已经拉全的会话被永久当作"有缺口"。
 */
export function normalizeRanges(ranges: SeqRange[]): SeqRange[] {
  const valid = ranges
    .filter((r) => Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.lo >= 1 && r.hi >= r.lo)
    .sort((a, b) => a.lo - b.lo);
  const out: SeqRange[] = [];
  for (const r of valid) {
    const last = out[out.length - 1];
    if (last && r.lo <= last.hi + 1) {
      if (r.hi > last.hi) last.hi = r.hi;
    } else {
      out.push({ lo: r.lo, hi: r.hi });
    }
  }
  return out;
}

/** 登记一段"我已齐全"，返回归一化后的新清单（不修改入参）。 */
export function addRange(ranges: SeqRange[], lo: number, hi: number): SeqRange[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo || hi < 1) return normalizeRanges(ranges);
  return normalizeRanges([...ranges, { lo: Math.max(1, lo), hi }]);
}

/** 某个 conv_seq 是否在本地已齐全的区间内。 */
export function hasSeq(ranges: SeqRange[], seq: number): boolean {
  return ranges.some((r) => seq >= r.lo && seq <= r.hi);
}

/** 整段 [lo, hi] 是否被**同一个**区间完整覆盖（跨两段说明中间有缺口，不算覆盖）。 */
export function coversSpan(ranges: SeqRange[], lo: number, hi: number): boolean {
  if (hi < lo) return false;
  return ranges.some((r) => r.lo <= lo && r.hi >= hi);
}

/** 找出包含 seq 的那一段；不在任何段内返回 null。 */
export function rangeContaining(ranges: SeqRange[], seq: number): SeqRange | null {
  return ranges.find((r) => seq >= r.lo && seq <= r.hi) ?? null;
}

/**
 * 本地是否**齐全**：从 floor+1 一路连续到 head。
 *
 * floor 是可见下界（G2 history_visible 把新成员的下界抬到入群位点），默认 0。
 * head ≤ floor（会话在我可见范围内一条都没有）时视为齐全——没有东西可缺。
 */
export function isComplete(ranges: SeqRange[], head: number, floor = 0): boolean {
  if (head <= floor) return true;
  return coversSpan(ranges, floor + 1, head);
}

/**
 * 「从 floor 起连续到哪」——即 synced_conv_seq 的等价物。
 *
 * 刻意让它由区间清单**派生**而不是各存一份：两份状态迟早会不一致，
 * 而不一致的方向如果是"游标比实际靠前"，就等于宣称拉过其实没拉的那段，正是丢消息的经典成因。
 */
export function contiguousUpTo(ranges: SeqRange[], floor = 0): number {
  const first = ranges.find((r) => r.lo <= floor + 1 && r.hi > floor);
  return first ? first.hi : floor;
}

/**
 * 向上翻页时下一段要取的区间：返回 [目标 lo, 目标 hi]，已到 floor 则返回 null。
 *
 * anchor 是当前视图最早那条。若它落在某个已知段里，缺口在该段的 lo 之前；
 * 否则以 anchor 本身为上界。取满 count 条或到 floor 为止。
 */
export function gapBefore(ranges: SeqRange[], anchor: number, count: number, floor = 0): SeqRange | null {
  const seg = rangeContaining(ranges, anchor);
  const upper = (seg ? seg.lo : anchor + 1) - 1; // 已知段之前的第一条
  if (upper <= floor) return null;
  return { lo: Math.max(floor + 1, upper - count + 1), hi: upper };
}

/**
 * 向下翻页时下一段要取的区间：已到 head 则返回 null。
 * 语义与 gapBefore 对称（anchor 是当前视图最新那条）。
 */
export function gapAfter(ranges: SeqRange[], anchor: number, count: number, head: number): SeqRange | null {
  const seg = rangeContaining(ranges, anchor);
  const lower = (seg ? seg.hi : anchor - 1) + 1;
  if (lower > head) return null;
  return { lo: lower, hi: Math.min(head, lower + count - 1) };
}
