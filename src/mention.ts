/**
 * 群 @提及的纯逻辑（M4-8）——输入框 token 的识别、回填与还原。
 *
 * 与 iOS `IMChatViewController` 的 activeMentionQuery / insertMentionToken / resolvedMentionsInText
 * 逐条对齐，两端行为必须一致：
 *  - `@` 后出现空白即视为这次提及结束（用户在正常打字，不该再弹面板）；
 *  - 回填的是纯文本 `@显示名 `，发送时按"文本里是否还留着该 token"复核——
 *    用户手动删掉 token 就自动不再 @ 他（草图 §07-06）；
 *  - 半角 `@` 与中文输入法的全角 `＠` 都认。
 *
 * 设计依据：IMServer/docs/GROUP_READ_UX_SKETCH.html §03。
 */

/** 触发提及的字符（半角 + 全角）。 */
import { filterByQuery } from "./listSearch";

const AT_CHARS = ["@", "＠"];

/**
 * 被 @ 者候选：**uid → 显示名**。
 *
 * 键必须是 uid 而非显示名：群里同名成员很常见，以显示名为键会让后选中的人覆盖先选中的人，
 * 结果只有一个 uid 能被 @（另一个人明明在文本里被 @ 了却收不到任何提醒）。与 iOS 的
 * `mentionCandidates`（uid → 显示名）同向。
 */
export type MentionCandidates = Record<string, string>;

/** @所有人 在输入框里的显示名（与 iOS 一致）。 */
export const MENTION_ALL_LABEL = "所有人";

/**
 * 取"正在输入的 @查询词"：光标前最近一个 `@` 到光标之间、且不含空白的片段。
 * 返回 null 表示当前不在 @ 输入态（不该弹面板）。
 */
export function activeMentionQuery(text: string, caret: number): string | null {
  if (!text || caret <= 0 || caret > text.length) return null;
  const head = text.slice(0, caret);
  let at = -1;
  for (const ch of AT_CHARS) {
    at = Math.max(at, head.lastIndexOf(ch));
  }
  if (at < 0) return null;
  const q = head.slice(at + 1);
  if (/\s/.test(q)) return null; // @ 后已打过空白 → 这次提及已结束
  return q;
}

/**
 * 回填 token：把"正在输入的 @query"整体替换为 `@显示名 `（尾随空格便于继续打字）。
 * 返回新文本与新光标位置（调用方据此设置输入框 selection）。
 */
export function applyMentionToken(text: string, caret: number, displayName: string): { text: string; caret: number } {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const head = text.slice(0, safeCaret);
  let at = -1;
  for (const ch of AT_CHARS) {
    at = Math.max(at, head.lastIndexOf(ch));
  }
  const after = at < 0 ? text.slice(safeCaret) : text.slice(safeCaret);
  // 尾随空格便于继续打字；但光标后本就以空格开头时不再补，否则会留下双空格。
  const token = `@${displayName}${/^\s/.test(after) ? "" : " "}`;
  if (at < 0) {
    // 兜底：没找到 @（如从工具栏按钮触发）就在光标处插入。
    return { text: head + token + after, caret: safeCaret + token.length };
  }
  const before = text.slice(0, at);
  return { text: before + token + after, caret: before.length + token.length };
}

/**
 * 文本里是否存在一个**完整的** `@名字` token。
 *
 * 必须按 token 边界判定，不能用裸子串：昵称互为前缀时（「小美」/「小美丽」），
 * `"@小美丽 开会".includes("@小美")` 为真，会把根本没被提及的「小美」也算进 mentions，
 * 让他收到一条穿透免打扰的错误强提醒。这里要求 token 后面紧跟**空白或字符串结尾**。
 * （iOS `IMChatTextContainsMentionToken` 是同一套判定。）
 */
export function containsMentionToken(text: string, displayName: string): boolean {
  if (!text || !displayName) return false;
  const needle = `@${displayName}`;
  let from = 0;
  for (;;) {
    const idx = text.indexOf(needle, from);
    if (idx < 0) return false;
    const after = idx + needle.length;
    if (after >= text.length || /\s/.test(text[after])) return true; // 到结尾 / 后接空白 = 完整 token
    from = idx + 1; // 命中的是更长名字的前缀，继续往后找
  }
}

/** 文本切段：普通段 `mention=false`，被 @ 的 token 段 `mention=true`（供渲染层高亮）。 */
export interface MentionSegment { text: string; mention: boolean }

/**
 * 把文本按已知 `@显示名` token 切成"普通/高亮"段，供气泡渲染层给 @提及上色。
 *
 * 与 `containsMentionToken` 同一套 token 边界规则（token 后须紧跟空白或字符串结尾），
 * 因此 `@小美` 不会误命中 `@小美丽`；`displayNames` 按长度降序优先匹配，保证长名先中。
 * 只认半角 `@`（回填 token 一律半角，见 applyMentionToken）。names 为空时原样返回单段。
 */
export function segmentMentions(text: string, displayNames: string[]): MentionSegment[] {
  const names = [...new Set(displayNames.filter((n) => !!n))].sort((a, b) => b.length - a.length);
  if (!text) return [];
  if (names.length === 0) return [{ text, mention: false }];
  const segs: MentionSegment[] = [];
  let buf = "";
  let i = 0;
  const flush = () => { if (buf) { segs.push({ text: buf, mention: false }); buf = ""; } };
  while (i < text.length) {
    let hit: string | null = null;
    if (text[i] === "@") {
      for (const n of names) {
        const token = `@${n}`;
        if (text.startsWith(token, i)) {
          const after = i + token.length;
          if (after >= text.length || /\s/.test(text[after])) { hit = n; break; }
        }
      }
    }
    if (hit) {
      flush();
      segs.push({ text: `@${hit}`, mention: true });
      i += hit.length + 1;
    } else {
      buf += text[i];
      i += 1;
    }
  }
  flush();
  return segs;
}

/**
 * 发送前把文本还原成被 @ 的 uid 列表：只保留**文本里仍存在完整 token** 的候选。
 * 结果去重且顺序稳定（按候选表插入序），便于测试与日志比对。
 */
export function resolveMentions(text: string, candidates: MentionCandidates): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const [uid, name] of Object.entries(candidates)) {
    if (!name || !uid) continue;
    if (containsMentionToken(text, name) && !out.includes(uid)) out.push(uid);
  }
  return out;
}

/** @所有人 是否仍生效：既要标记在、文本里也要还留着完整的 `@所有人` token。 */
export function resolveMentionAll(text: string, pending: boolean): boolean {
  return pending && containsMentionToken(text, MENTION_ALL_LABEL);
}

/** 面板候选项（uid + 展示名 + 角色，角色用于「群主/管理员」标）。 */
export interface MentionCandidateMember {
  userId: string;
  /** 群内**公开名**（昵称/uid）。选中后插进消息的 token 就是它，故不能放我的私有备注。 */
  displayName: string;
  /**
   * 我给这人起的备注（仅本人可见）。**只参与匹配、不参与插入**——
   * 备注写进消息文本就等于把私房名发给全群了。面板行把它作为副标记显示（见 Composer）。
   */
  remark?: string;
  role?: string;
}

/**
 * 按「昵称 / 我给他起的备注 / uid」子串过滤（大小写不敏感）。空 query 返回全部。
 * 说明：拼音首字母匹配需额外索引，本期先做子串——中文昵称直接键入汉字即可命中。
 */
export function filterMentionMembers<T extends MentionCandidateMember>(members: T[], query: string): T[] {
  return filterByQuery(members, query, (m) => [m.displayName, m.remark, m.userId]);
}

/** 我能否 @所有人：仅群主/管理员（服务端另有校验，这里只决定面板是否渲染该行）。 */
export function canMentionAll(myRole: string | undefined): boolean {
  return myRole === "owner" || myRole === "admin";
}

/**
 * 该 content_type 是否计入未读——**与服务端 conversation.unreadCount 同口径**（M4-8）。
 *
 * `msg_op` 事件行（撤回/编辑/置顶）是操作、`system` 系统消息（改名/入群/禁言）是群内留痕，
 * 两者都不是"有人跟我说话了"，均不计未读。未读分割线与 ↓N 的定位必须照此排除，
 * 否则分割线会落在不计数的行上、与角标数字对不上（iOS 对应 IMContentTypeCountsAsUnread）。
 */
export function countsAsUnread(contentType: string | undefined): boolean {
  return contentType !== "system" && contentType !== "msg_op";
}
