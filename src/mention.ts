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

/**
 * 文本切段：普通段 `mention=false`，被 @ 的 token 段 `mention=true`（供渲染层高亮）。
 * `uid` 仅**按片段切段**（segmentMentionsBySpans）时有：那条路不查成员表，uid 直接来自消息。
 */
export interface MentionSegment { text: string; mention: boolean; uid?: string }

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

// ===== @ 片段（mention_spans，2026-09-01）=====
//
// 老做法是收端拿「本群成员昵称表」去正文里找 `@昵称` token 决定高亮。超级群不下发成员表，
// 于是**普通成员的 @ 在大群里既不高亮也点不动**。改由发送方在插入 token 时记下位置随消息走。
// 协议与约束见 IMServer/docs/PROTOCOL.md §4.1「@提及」，对应 Telegram 的 messageEntityMentionName。
//
// **偏移单位是 UTF-16 码元**——JS 的 String 索引天生就是 UTF-16，所以这里的 `i` 直接就是偏移，
// 不需要任何换算。**千万别为了"更直观"改成码点**（`[...text]`）：那样 emoji 一出现就与
// iOS 的 NSString 索引和服务端校验全部对不上。

/** 一段 @ 提及：从哪里开始、多长、指向谁。`uid` 为空串=@所有人（只高亮不可点）。 */
export interface MentionSpan { offset: number; length: number; uid: string }

/** 扫描出的一个 token（内部用：既供发送侧生成片段，也供渲染侧的老路切段）。 */
interface MentionToken { offset: number; length: number; uid: string; name: string }

/**
 * 按 token 边界扫描文本里的 `@名字`。边界规则与 containsMentionToken 完全一致
 * （token 后须紧跟空白或字符串结尾；长名优先，防 `@小美` 误命中 `@小美丽`）。
 *
 * `nameToUid` 里同名多人时只能记住一个 uid——这是**片段**的固有限制（一段文本只能链向一个人）。
 * `mentions`（谁收到强提醒）不受影响，仍由 resolveMentions 按每个候选独立判定，两个同名的人都会收到。
 */
function scanMentionTokens(text: string, nameToUid: Record<string, string>): MentionToken[] {
  const names = Object.keys(nameToUid).filter((n) => !!n).sort((a, b) => b.length - a.length);
  const out: MentionToken[] = [];
  if (!text || names.length === 0) return out;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "@") {
      let hit: string | null = null;
      for (const n of names) {
        const token = `@${n}`;
        if (text.startsWith(token, i)) {
          const after = i + token.length;
          if (after >= text.length || /\s/.test(text[after])) { hit = n; break; }
        }
      }
      if (hit) {
        out.push({ offset: i, length: hit.length + 1, uid: nameToUid[hit], name: hit });
        i += hit.length + 1;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

/**
 * 发送前算出 @ 片段。与 resolveMentions 同源同规则，只是多记了位置。
 *
 * @param candidates  uid → 显示名（输入框回填 token 时记下的）
 * @param mentionAll  这条消息是否真的在 @所有人（resolveMentionAll 的结果）
 */
export function resolveMentionSpans(
  text: string, candidates: MentionCandidates, mentionAll: boolean,
): MentionSpan[] {
  const nameToUid: Record<string, string> = {};
  // 先放成员，再放"所有人"——同名成员碰上字面「所有人」时以 @所有人 为准（与服务端校验一致：
  // 空 uid 只在 mention_all 时合法，反过来若把成员 uid 记在"所有人"上，服务端会因不在 mentions 里而丢弃）。
  for (const [uid, name] of Object.entries(candidates)) {
    if (uid && name && !(name in nameToUid)) nameToUid[name] = uid;
  }
  if (mentionAll) nameToUid[MENTION_ALL_LABEL] = "";
  return scanMentionTokens(text, nameToUid).map(({ offset, length, uid }) => ({ offset, length, uid }));
}

/**
 * 渲染侧：按服务端下发的片段把文本切段。**不需要任何成员表**——这就是这套机制的全部意义。
 *
 * 片段与本地文本对不上时（编辑过的老消息、折叠截断、脏数据）**逐段跳过**，调用方据此回落到
 * 按昵称扫文本的老路。判据是 `text[offset] === "@"` 且不越界——与服务端 normalizeMentionSpans
 * 同一条判据，两边都不信任偏移。
 */
export function segmentMentionsBySpans(text: string, spans: MentionSpan[]): MentionSegment[] {
  if (!text) return [];
  const valid = spans
    .filter((s) => s && s.length > 0 && s.offset >= 0 && s.offset + s.length <= text.length && text[s.offset] === "@")
    .sort((a, b) => a.offset - b.offset);
  if (valid.length === 0) return [{ text, mention: false }];
  const segs: MentionSegment[] = [];
  let at = 0;
  for (const s of valid) {
    if (s.offset < at) continue; // 与前一段重叠，丢弃
    if (s.offset > at) segs.push({ text: text.slice(at, s.offset), mention: false });
    segs.push({ text: text.slice(s.offset, s.offset + s.length), mention: true, uid: s.uid });
    at = s.offset + s.length;
  }
  if (at < text.length) segs.push({ text: text.slice(at), mention: false });
  return segs;
}

/** 从 WS/本地库读到的原始值解析片段（脏数据安全：非数组/字段类型不对一律丢弃该项）。 */
export function parseMentionSpans(raw: unknown): MentionSpan[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: MentionSpan[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const offset = Number(o.offset), length = Number(o.length);
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length <= 0) continue;
    out.push({ offset, length, uid: typeof o.user_id === "string" ? o.user_id : "" });
  }
  return out.length > 0 ? out : undefined;
}
