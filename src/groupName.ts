// 建群默认群名：把「我 + 已选成员」的**公开名**拼成一个候选群名（用户可改）。
//
// 单独一个文件是因为 iOS 有同名同规则的 `IMDefaultGroupName`（Common/IMGroupNameDefault.h），
// 两端必须逐字同规则——"拼字符串 + 按 rune 截断"这类逻辑埋在各自的 UI 代码里最容易长歪，
// 抽成纯函数才好用单测钉死。
//
// ⚠️ **只能用公开名（昵称），绝不能用备注**：群名会随建群请求发到服务端、写进系统消息
// 「X 创建了群聊「…」」、出现在**全群每个人**的会话列表里。拿备注拼群名 = 把我给对方起的
// 私下称呼广播给全群。这条是 docs/UI.md 的隐私红线（合并转发卡片标题曾栽过同一个坑：
// 标题取了"备注优先"的显示名，把「老王」泄露给了对方）。
// 所以本文件**不导出**任何读备注的东西，调用方也别把 friendLabel/displayNameOf 传进来。

/** 群名上限（rune），与服务端 group.MaxGroupNameLen 一致。 */
export const MAX_GROUP_NAME_LEN = 30;

/** 按 rune（码点）数长度：emoji 与中文都算 1，与服务端 `len([]rune(name))` 同口径。 */
export function runeLength(s: string): number {
  return Array.from(s).length;
}

/** 按 rune 截断到 n 个码点（不补省略号）。 */
export function truncateRunes(s: string, n: number): string {
  const rs = Array.from(s);
  return rs.length <= n ? s : rs.slice(0, Math.max(0, n)).join("");
}

/** 一个人的**公开名**：昵称 → @用户名 → 内部 ID 兜底。**不读备注**（见文件头）。 */
export function publicNameOf(u: { nickname?: string; username?: string; user_id?: string }): string {
  const nick = (u.nickname ?? "").trim();
  if (nick) return nick;
  const uname = (u.username ?? "").trim();
  if (uname) return `@${uname}`;
  return (u.user_id ?? "").trim();
}

/**
 * 默认群名：names 按顺序用「、」连接，**放不下的名字直接不要**（结果恒 ≤ maxLen）。
 * 调用方负责把**自己排在第一位**（建群人是群主，群名以他打头）。
 * 空名字会被跳过；全空返回 ""（调用方据此让「创建」保持置灰）。
 *
 * **不补省略号**（2026-09-05 用户要求）：这是个可改的**候选**群名，不是被裁短的完整名——
 * 结尾挂个「…」既占掉一个可用字，又会被头像圈的「取末两字」规则拿去显示成「2…」。
 */
export function defaultGroupName(names: string[], maxLen = MAX_GROUP_NAME_LEN): string {
  const parts: string[] = [];
  for (const raw of names) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    const candidate = [...parts, name].join("、");
    if (runeLength(candidate) <= maxLen) {
      parts.push(name);
      continue;
    }
    // 放不下这一个就到此为止；一个都没放下（首名本身超长）时硬截首名。
    if (parts.length === 0) return truncateRunes(name, maxLen);
    break;
  }
  return parts.join("、");
}
