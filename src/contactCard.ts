// 个人名片消息（content_type=contact）的 content 解析 / 构造 / 预览（纯函数，可单测）。
// content 是极小的 JSON 快照 {"u","n","a"}——uid / 发送时冻结的昵称 / 头像 URL。
// 协议见 IMServer docs/PROTOCOL.md §4.1，设计见 docs/CONTACT_CARD_DESIGN.md。
// 与 iOS Common/IMContactCard.m 逐条同口径（解析三态、预览文案），两端不得漂移。

/** contact 消息的 content_type 常量（与后端 store.ContentTypeContact 一致）。 */
export const CONTACT_CONTENT_TYPE = "contact";

/** 解析后的名片快照。 */
export interface ContactCard {
  /** u（必有，解析成功即非空） */
  userId: string;
  /** n（发送时冻结的**真实昵称**，非备注） */
  nickname?: string;
  /** a（可空 → 回退首字母圈） */
  avatarUrl?: string;
}

/** 空白字符串视作「无」，与 iOS 的 trimmedString 同归一化。 */
function trimmed(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

/**
 * 解析 contact 消息的 content JSON。**非法 JSON / 非对象 / 缺 u → null**：
 * 调用方据此降级（气泡显一行灰字不可点；详情页/收藏页**直接不收录**——列表里不该出现点不动的空行）。
 */
export function parseContactCard(content: string | undefined | null): ContactCard | null {
  if (typeof content !== "string" || content.length === 0) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch {
    return null;
  }
  // 数组也是 object，须显式排除（JSON.parse("[…]") 不抛）。
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const d = obj as Record<string, unknown>;
  const userId = trimmed(d.u);
  if (!userId) return null;
  return { userId, nickname: trimmed(d.n), avatarUrl: trimmed(d.a) };
}

/**
 * 构造 contact 消息的 content JSON；userId 为空返回 null。
 * ⚠️ nickname 必须传**真实昵称**，**绝不能传备注**（displayNameOf 的结果）——
 * 备注是查看者私有的，发出去就是泄露"我给你起的外号"（设计文档 §2.4）。
 */
export function buildContactCard(
  userId: string | undefined | null,
  nickname?: string | null,
  avatarUrl?: string | null,
): string | null {
  const u = (userId ?? "").trim();
  if (!u) return null;
  const out: Record<string, string> = { u };
  const n = (nickname ?? "").trim();
  if (n) out.n = n;
  const a = (avatarUrl ?? "").trim();
  if (a) out.a = a;
  return JSON.stringify(out);
}

/**
 * 会话列表 / 置顶横幅 / 合并转发条目 / 收藏预览的文案：`[个人名片] 小明`。
 * 无昵称回落 uid；解析失败回落裸 `[个人名片]`（不崩、不漏 JSON 原文）。
 */
export function contactCardPreview(content: string | undefined | null): string {
  const c = parseContactCard(content);
  if (!c) return "[个人名片]";
  return `[个人名片] ${c.nickname || c.userId}`;
}
