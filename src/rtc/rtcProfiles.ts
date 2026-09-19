// 通话界面显示名：备注（仅本机）> 昵称 > @句柄；都没有返回 undefined。
// 与 App 的 displayNameOf 同序，但**不落到「未命名用户」**：没解析到时让 Kit 先显示 uid，
// 名片拉回来后再重画（同时触发 useUserProfiles 去拉）。
export function rtcNameOf(
  remarks: ReadonlyMap<string, string>, uid: string, nickname?: string, username?: string,
): string | undefined {
  const remark = remarks.get(uid)?.trim();
  if (remark) return remark;
  const nick = nickname?.trim();
  if (nick) return nick;
  const handle = username?.trim();
  return handle ? `@${handle}` : undefined;
}

/** 邀请候选人所需的成员字段（`GroupMember` 的子集，便于单测）。 */
export interface InviteMemberLike {
  user_id: string;
  nickname?: string;
  username?: string;
  avatar_url?: string;
}

export interface InviteCandidateOut {
  uid: string;
  name: string;
  avatarUrl?: string;
  selectable: boolean;
  unselectableReason?: string;
}

/**
 * 群成员 → 「添加成员」候选人：排除自己；`participantUids`（在通话里 + 振铃中）置灰不可选；
 * `query` 非空按名字 / @句柄 / uid 本地过滤。名字与通话界面同一条链：`nameOf`（备注 > 昵称 > @句柄），
 * 解析不到再用成员表自带的昵称 / 句柄，最后才是 uid。纯函数。
 */
export function buildInviteCandidates(
  members: readonly InviteMemberLike[], selfUid: string, participantUids: readonly string[], query: string,
  nameOf: (uid: string) => string | undefined, avatarOf: (uid: string) => string | undefined,
): InviteCandidateOut[] {
  const inCall = new Set(participantUids);
  const q = query.trim().toLowerCase();
  const out: InviteCandidateOut[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    if (!m.user_id || m.user_id === selfUid || seen.has(m.user_id)) continue;
    seen.add(m.user_id);
    const name = nameOf(m.user_id) ?? (m.nickname?.trim() || (m.username ? `@${m.username}` : m.user_id));
    if (q && ![name, m.username ?? "", m.user_id].some((s) => s.toLowerCase().includes(q))) continue;
    const busy = inCall.has(m.user_id);
    const avatarUrl = avatarOf(m.user_id) || m.avatar_url || undefined;
    out.push({
      uid: m.user_id, name, selectable: !busy,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(busy ? { unselectableReason: "已在通话中" } : {}),
    });
  }
  return out;
}
