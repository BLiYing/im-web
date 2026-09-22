// 个人名片消息（content_type=contact）的 content 解析 / 构造 / 预览（纯函数，可单测）。
// content 是极小的 JSON 快照 {"u","un","n","a"}——内部 ID / username / 昵称 / 头像 URL（后三者为发送时冻结的快照）。
// 协议见 IMServer docs/PROTOCOL.md §4.1，设计见 docs/design/CONTACT_CARD_DESIGN.md。
// 与 iOS Common/IMContactCard.m 逐条同口径（解析三态、预览文案），两端不得漂移。
import { t as i18nT, type Args } from "./i18n";

/** contact 消息的 content_type 常量（与后端 store.ContentTypeContact 一致）。 */
export const CONTACT_CONTENT_TYPE = "contact";

/** 解析后的名片快照。 */
export interface ContactCard {
  /** u：**内部 ID**（必有）。点卡片发起聊天/加好友用它，**不得展示**。 */
  userId: string;
  /** un：公开句柄快照，卡片副标题显示 @xxx。老消息无此字段 → undefined → 副标题不显示标识。 */
  username?: string;
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
  return { userId, username: trimmed(d.un), nickname: trimmed(d.n), avatarUrl: trimmed(d.a) };
}

/**
 * 构造 contact 消息的 content JSON；userId 为空返回 null。
 * ⚠️ nickname 必须传**真实昵称**，**绝不能传备注**（displayNameOf 的结果）——
 * 备注是查看者私有的，发出去就是泄露"我给你起的外号"（设计文档 §2.4）。
 */
export function buildContactCard(
  userId: string | undefined | null,
  username?: string | null,
  nickname?: string | null,
  avatarUrl?: string | null,
): string | null {
  const u = (userId ?? "").trim();
  if (!u) return null;
  const out: Record<string, string> = { u };
  const un = (username ?? "").trim();
  if (un) out.un = un;
  const n = (nickname ?? "").trim();
  if (n) out.n = n;
  const a = (avatarUrl ?? "").trim();
  if (a) out.a = a;
  return JSON.stringify(out);
}

/**
 * 会话列表 / 置顶横幅 / 合并转发条目 / 收藏预览的文案：`[个人名片] 小明`。
 *
 * 无昵称退 `@username`；**绝不回落 userId**——那是 10 位随机数字内部 ID，而这条预览会出现在
 * 会话列表/引用条上（与服务端 contactReplySnapshot、iOS IMContactCardPreview 同口径）。
 * 两者皆无或解析失败回落裸 `[个人名片]`（不崩、不漏 JSON 原文）。
 *
 * 2026-09-22 P3 修复：此前硬编码中文，不跟 App 语言（与 iOS IMContactCardPreview 早已本地化不同，
 * 是本端遗留的 SYMMETRY 缺口）。`translate` 默认模块级 `t()`；组件内传 `useT()` 的 `tr` 以便即时重渲染。
 */
export function contactCardPreview(content: string | undefined | null, translate: (key: string, args?: Args) => string = i18nT): string {
  const c = parseContactCard(content);
  if (!c) return translate("quote.snapshot.contact");
  if (c.nickname) return translate("quote.snapshot.contact_named", { name: c.nickname });
  if (c.username) return translate("quote.snapshot.contact_named", { name: `@${c.username}` });
  return translate("quote.snapshot.contact");
}
