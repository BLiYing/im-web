// 相册聚簇（M4+）：同 group_id 的多图/视频在消息流中合并渲染为一个 Telegram 式宫格。
// 纯函数，App 渲染与单测共用；与 iOS IMChatViewController 的 isAlbumMember/... 语义对齐。
import type { ChatMessage } from "./sdk/protocol";

/** 相册成员判定：有 group_id 的图片/视频且未撤回（撤回成员单独显示墓碑、退出宫格）。 */
export const isAlbumMember = (m: ChatMessage): boolean =>
  !!m.groupId && !m.recalledAt && (m.contentType === "image" || m.contentType === "video");

/** 同组全部成员（按消息顺序）。 */
export const albumMembers = (list: ChatMessage[], groupId: string): ChatMessage[] =>
  list.filter((m) => m.groupId === groupId && isAlbumMember(m));

/** 第 i 条是否该组的"主行"（组内首个成员渲染整个宫格，其余成员行跳过渲染）。 */
export function isAlbumLeader(list: ChatMessage[], i: number): boolean {
  const m = list[i];
  if (!m || !isAlbumMember(m)) return false;
  for (let j = 0; j < i; j++) {
    const p = list[j];
    if (p.groupId === m.groupId && isAlbumMember(p)) return false;
  }
  return true;
}

/** 宫格行模式（Telegram 近似）：如 3 → [1,2]=首行 1 大块 + 次行 2 块。9 封顶（selectionLimit=9）。 */
export function albumRowPattern(n: number): number[] {
  switch (n) {
    case 1: return [1];
    case 2: return [2];
    case 3: return [1, 2];
    case 4: return [2, 2];
    case 5: return [2, 3];
    case 6: return [3, 3];
    case 7: return [1, 3, 3];
    case 8: return [2, 3, 3];
    default: return [3, 3, 3];
  }
}
