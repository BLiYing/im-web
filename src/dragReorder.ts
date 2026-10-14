// 列表长按拖动排序的纯算法（会话文件夹管理页用；与 iOS 编辑态 / Android 同口径）。
// 拖动期间**不改列表顺序**，只让被拖行跟手位移、其余行按落点让出一格；松手才一次性换序并提交。

/** 被拖行（下标 from）累计位移 offset 对应的落点下标，夹在 [0, n-1]。rowH<=0 时原地。 */
export function dragTarget(from: number, offset: number, rowH: number, n: number): number {
  if (from < 0 || n <= 0) return from;
  if (rowH <= 0) return from;
  return Math.min(n - 1, Math.max(0, from + Math.round(offset / rowH)));
}

/** 位移的合法范围：不能把行拖出列表首 / 末。 */
export function clampOffset(offset: number, from: number, rowH: number, n: number): number {
  return Math.min((n - 1 - from) * rowH, Math.max(-from * rowH, offset));
}

/** 第 i 行此刻应让出的垂直位移（被拖行本身不走这里）：落点之间的行各让一格。 */
export function shiftFor(i: number, from: number, target: number, rowH: number): number {
  if (from < 0) return 0;
  if (from < target && i > from && i <= target) return -rowH;
  if (target < from && i >= target && i < from) return rowH;
  return 0;
}

/** 返回把 from 位的元素挪到 to 位后的新数组（不改入参）。 */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = arr.slice();
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.min(Math.max(to, 0), out.length), 0, x);
  return out;
}
