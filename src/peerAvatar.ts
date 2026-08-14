// 对端头像/昵称的多来源兜底解析。
//
// 背景（bug）：单聊头像与资料卡头像原本只读会话行的 peer_avatar_url。
// 从「群成员 → 点头像 → 资料卡 → 发消息进单聊」这条路进来时，若与该成员从没建立过单聊，
// 就没有任何会话行，头像只能回退首字母圈（群里气泡头像却正常，因为气泡读的是群成员表）。
// 这里按「会话 > 好友 > 任一已加载群的成员表 > 搜索结果」的优先级从内存兜底解析，消除该差异。
//
// 纯函数、无副作用，便于单测；只认结构上必要的字段。

interface ConvLike {
  peer?: string;
  peer_avatar_url?: string;
  peer_nickname?: string;
}
interface FriendLike {
  user_id: string;
  avatar_url?: string;
  nickname?: string;
}
interface MemberLike {
  user_id: string;
  avatar_url?: string;
  nickname?: string;
}
interface GroupLike {
  members: MemberLike[];
}
interface CardLike {
  user_id: string;
  avatar_url?: string;
  nickname?: string;
}

export interface PeerSources {
  conversations: ConvLike[];
  friends: FriendLike[];
  groups: GroupLike[];
  search?: CardLike[] | null;
}

/** 空白字符串视作「无」，只在真正拿到非空值时命中。 */
function firstNonEmpty(...vals: Array<string | undefined>): string | undefined {
  for (const v of vals) {
    if (v && v.trim()) return v;
  }
  return undefined;
}

/** 跨所有已加载群的成员表按 uid 查一次（命中即返回）。 */
function findMemberAcrossGroups(id: string, groups: GroupLike[]): MemberLike | undefined {
  for (const g of groups) {
    const m = g.members.find((x) => x.user_id === id);
    if (m) return m;
  }
  return undefined;
}

/** 对端头像 URL：会话 > 好友 > 群成员 > 搜索结果；全空返回 undefined（调用方回退首字母圈）。 */
export function resolvePeerAvatar(id: string, src: PeerSources): string | undefined {
  const conv = src.conversations.find((c) => c.peer === id);
  const friend = src.friends.find((f) => f.user_id === id);
  const member = findMemberAcrossGroups(id, src.groups);
  const card = (src.search ?? []).find((c) => c.user_id === id);
  return firstNonEmpty(conv?.peer_avatar_url, friend?.avatar_url, member?.avatar_url, card?.avatar_url);
}

/** 对端昵称：同源同序（头像回退不到时，名字也别只显示 uid）。全空返回 undefined。 */
export function resolvePeerNickname(id: string, src: PeerSources): string | undefined {
  const conv = src.conversations.find((c) => c.peer === id);
  const friend = src.friends.find((f) => f.user_id === id);
  const member = findMemberAcrossGroups(id, src.groups);
  const card = (src.search ?? []).find((c) => c.user_id === id);
  return firstNonEmpty(conv?.peer_nickname, friend?.nickname, member?.nickname, card?.nickname);
}
