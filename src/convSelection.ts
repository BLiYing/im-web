// 会话列表「编辑模式」选择集（纯逻辑、可单测；设计 IMServer/docs/design/CONV_LIST_EDIT_MODE_DESIGN.md §2）。
// 按会话 ID 记录；切文件夹 Tab 时由调用方换成空集；全选只管当前列表。
// 三端同口径：iOS `IMConversationSelection`、Android `ConversationSelection.kt`（共用向量 docs/conformance/conv_selection.json）。
import type { Conversation } from "./sdk/protocol";

export type ConvSelection = ReadonlySet<string>;

export const EMPTY_SELECTION: ConvSelection = new Set<string>();

/** 「有未读」：未读数 > 0 或手动标为未读——与单条右键菜单「设为已读」的出现条件同口径。 */
export function convHasUnread(c: Pick<Conversation, "unread" | "marked_unread">): boolean {
  return (c.unread ?? 0) > 0 || !!c.marked_unread;
}

export function toggleSel(sel: ConvSelection, id: string): ConvSelection {
  if (!id) return sel;
  const next = new Set(sel);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** 选中 list 内全部会话（保留 list 之外已选的项）。 */
export function selectAllIn(sel: ConvSelection, list: Conversation[]): ConvSelection {
  const next = new Set(sel);
  for (const c of list) next.add(c.conv_id);
  return next;
}

/** 把 list 中 [from, to] 两端（含）之间的会话全部选中（Shift 连选；Web 独有）。找不到端点时原样返回。 */
export function selectRangeIn(sel: ConvSelection, list: Conversation[], from: string, to: string): ConvSelection {
  const a = list.findIndex((c) => c.conv_id === from);
  const b = list.findIndex((c) => c.conv_id === to);
  if (a < 0 || b < 0) return sel;
  const next = new Set(sel);
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(list[i].conv_id);
  return next;
}

/** list 非空且其中每一项都已选中。 */
export function isAllSelectedIn(sel: ConvSelection, list: Conversation[]): boolean {
  return list.length > 0 && list.every((c) => sel.has(c.conv_id));
}

/** 只保留仍存在于 list 的 ID（他端删除 / 退群 / 切范围后剔除）；没变化时返回原对象，免得白白触发重渲染。 */
export function pruneTo(sel: ConvSelection, list: Conversation[]): ConvSelection {
  if (sel.size === 0) return sel;
  const alive = new Set(list.map((c) => c.conv_id));
  const next = new Set([...sel].filter((id) => alive.has(id)));
  return next.size === sel.size ? sel : next;
}

/** 选中项里至少有一项有未读（「已读」按钮可用）。 */
export function hasUnreadIn(sel: ConvSelection, list: Conversation[]): boolean {
  return list.some((c) => sel.has(c.conv_id) && convHasUnread(c));
}

/** 按 list 顺序取出已选会话。 */
export function selectedIn(sel: ConvSelection, list: Conversation[]): Conversation[] {
  return list.filter((c) => sel.has(c.conv_id));
}

export interface BatchResult<T> { succeeded: T[]; failed: T[] }

/**
 * 有界并发的批量执行器：同时在途最多 limit 个，全部结束后一次性返回（成功 / 失败各保持 items 顺序）。
 * 会话列表批量已读 / 删除用它压住逐条接口的瞬时请求量（设计 §4）。work 抛错即该项失败。
 */
export async function runBounded<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<BatchResult<T>> {
  const ok = new Array<boolean>(items.length).fill(false);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { await work(items[i]); ok[i] = true; } catch { ok[i] = false; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return { succeeded: items.filter((_, i) => ok[i]), failed: items.filter((_, i) => !ok[i]) };
}
