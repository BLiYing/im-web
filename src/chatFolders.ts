// 会话文件夹（聊天文件夹）：用户自建的手动分类，一个会话可在多个文件夹内、仍留在「全部」。
// 服务端口径 IMServer/docs/PROTOCOL.md §6.15，设计 IMServer/docs/design/CHAT_FOLDERS_DESIGN.md。
// 纯逻辑（无 React / 无 IO，单测直接钉）；三端同口径：iOS IMChatFolderLogic、Android ChatFolderLogic，
// 共用向量 IMServer/docs/conformance/chat_folder_logic.json。

import type { Conversation } from "./sdk/protocol";
import { isMutedNow } from "./muteState";

/** 一个文件夹（folder_update 与 REST 同形）。 */
export interface ChatFolder {
  id: string;
  name: string;
  position: number;
  /** 成员会话 id（按加入先后；永不为 null）。 */
  conv_ids: string[];
}

/** 服务端下发的上限（随 GET / 写响应的 `limits`）；未拿到时用设计默认值。 */
export interface FolderLimits { max_folders: number; max_convs: number; max_name: number }

export const DEFAULT_FOLDER_LIMITS: FolderLimits = { max_folders: 10, max_convs: 100, max_name: 12 };

/** 某用户全部文件夹的快照 + 单调版本。 */
export interface FolderSnapshot { version: number; folders: ChatFolder[]; limits: FolderLimits }

export const EMPTY_FOLDER_SNAPSHOT: FolderSnapshot = { version: 0, folders: [], limits: DEFAULT_FOLDER_LIMITS };

/** Tab 角标：count=0 不显示；muted=true 表示主数值为 0、仅静音会话有未读（灰色）。 */
export interface FolderBadge { count: number; muted: boolean }

/**
 * 把服务端 JSON（`{version, folders[], limits?}`）规整成快照。形状不对返回 null（调用方丢弃，别当成「空表」）。
 * `limits` 缺失沿用 [fallbackLimits]（帧不带 limits）。
 */
export function parseFolderSnapshot(raw: unknown, fallbackLimits: FolderLimits = DEFAULT_FOLDER_LIMITS): FolderSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.folders)) return null;
  const folders: ChatFolder[] = [];
  for (const f of o.folders) {
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || typeof r.name !== "string" || !r.name) continue;
    const ids = Array.isArray(r.conv_ids) ? r.conv_ids.filter((x): x is string => typeof x === "string" && x !== "") : [];
    folders.push({ id: r.id, name: r.name, position: Number(r.position) || 0, conv_ids: ids });
  }
  folders.sort((a, b) => a.position - b.position);
  const lim = (o.limits && typeof o.limits === "object" ? o.limits : null) as Record<string, unknown> | null;
  const pos = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);
  const limits: FolderLimits = lim
    ? {
        max_folders: pos(lim.max_folders, fallbackLimits.max_folders),
        max_convs: pos(lim.max_convs, fallbackLimits.max_convs),
        max_name: pos(lim.max_name, fallbackLimits.max_name),
      }
    : fallbackLimits;
  return { version: Number(o.version) || 0, folders, limits };
}

/**
 * 是否采纳 [incoming]：**版本严格更新才替换**（同版本的帧 / 乱序的旧帧 / 自己写入回包之后才到的同一版帧一律丢弃）。
 */
export function shouldApplySnapshot(current: number, incoming: number): boolean {
  return incoming > current;
}

/** 按会话顺序保序过滤出 folder 内的会话（folder=null 即「全部」，原样返回同一数组）。 */
export function filterConversations(convs: Conversation[], folder: ChatFolder | null): Conversation[] {
  if (!folder) return convs;
  const set = new Set(folder.conv_ids);
  return convs.filter((c) => set.has(c.conv_id));
}

/**
 * 某范围（folder=null = 全部）的 Tab 角标（设计 §3.3）：未读**消息条数**之和；
 * 静音会话不计入主数值（@我 仍计 1）；手动「标为未读」计 1；只有静音会话有未读时灰显。
 */
export function folderBadge(convs: Conversation[], folder: ChatFolder | null, now: number): FolderBadge {
  const set = folder ? new Set(folder.conv_ids) : null;
  let main = 0;
  let mutedSum = 0;
  for (const c of convs) {
    if (set && !set.has(c.conv_id)) continue;
    const n = c.unread > 0 ? c.unread : c.marked_unread ? 1 : 0;
    if (n <= 0) continue;
    if (isMutedNow(!!c.muted, c.mute_until, now)) {
      if (c.mention_unread) main += 1; else mutedSum += n;
    } else {
      main += n;
    }
  }
  return main > 0 ? { count: main, muted: false } : { count: mutedSum, muted: mutedSum > 0 };
}

/** Tab 下标：0 = 「全部」，i = 第 i 个文件夹；选中的文件夹已被删则回落 0。 */
export function folderTabIndex(selectedId: string | null, folders: ChatFolder[]): number {
  if (!selectedId) return 0;
  const i = folders.findIndex((f) => f.id === selectedId);
  return i < 0 ? 0 : i + 1;
}

/** 含该会话的全部文件夹（按 position 升序）。 */
export function foldersContaining(folders: ChatFolder[], convId: string): ChatFolder[] {
  return folders.filter((f) => f.conv_ids.includes(convId));
}

/** 文件夹名按 Unicode 码点计长（与服务端 rune 口径一致，emoji 算 1）。 */
export function runeLength(s: string): number {
  return Array.from(s).length;
}
