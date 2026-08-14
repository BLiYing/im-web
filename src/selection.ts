// 带上限的有序多选切换：已选则移除；未选且未到上限则追加；到上限则拒绝并标记溢出。
// 纯函数，供转发目标多选（上限 9）等场景复用与单测。
export function toggleCapped(list: string[], id: string, max: number): { next: string[]; overflow: boolean } {
  if (list.includes(id)) return { next: list.filter((x) => x !== id), overflow: false };
  if (list.length >= max) return { next: list, overflow: true };
  return { next: [...list, id], overflow: false };
}
