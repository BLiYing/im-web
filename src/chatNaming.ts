// chatNaming：「这个人 / 这个会话在**本机**叫什么、用哪张头像」的一组解析器。
//
// 从 App.tsx 抽出（2026-09-05，CODING_STYLE §7 ③「纯逻辑 → 自由函数 + 单测」）。它们本就是
// 一族**只读派生**——输入全是 React 状态，输出只是字符串/URL，没有 setter、没有副作用。
// 留在 App 里的唯一理由是"顺手"，代价是十几条口径散在两百行注释之间，改一条很难确认还有哪几条同源。
//
// ## 两条纪律
//
// **① 这里的结果只用于本机渲染，绝不写进要发出去的字节。** 备注（remark）仅自己可见，
// 把它写进合并转发条目名 / @token / 系统消息就是把私房名发给别人——见 ../IMServer/docs/UI.md
// 「备注 · 隐私红线」。对外可见名走各自的 public 口径（如 useForward 的 `nameOf`），不走本文件。
//
// **② 兜底链末级绝不是内部 ID。** 账号体系重构后 uid 是 10 位随机数字，露在界面上就是 bug
//（../IMServer/docs/design/ACCOUNT_IDENTITY_REDESIGN.md §7.5）。统一经 `displayNameOf`
// 落到 `@username` 或「未命名用户」。
//
// ## 为什么是工厂而不是 Hook
// 调用点在 App 的**登录早退之后**（`if (phase === "login") return …`），那里不能再调 Hook。
// 工厂每次渲染重建一组闭包，成本与原先内联定义完全相同（原本也是每渲染重建的箭头函数）。
import type { ChatMessage, Conversation, FriendEntry, GroupInfo, GroupMember, UserCard } from "./sdk/protocol";
import { displayNameOf } from "./remarks";
import { resolvePeerAvatar, resolvePeerNickname } from "./peerAvatar";

export interface NamingSources {
  /** uid → 我给他起的备注（`remarkMap(friends)`）。 */
  remarks: Map<string, string>;
  friends: FriendEntry[];
  conversations: Conversation[];
  groupInfos: Record<string, GroupInfo>;
  /** 资料面板拉到的对端名片（`GET /users/{id}` 的权威值，比列表缓存新）。 */
  peerCards: Record<string, UserCard>;
  /** 找人结果（可能为 null=未搜索）。 */
  searchResults: UserCard[] | null;
  /** useUserProfiles 的批量解析缓存：优先级最低，但**超级群里它是唯一还有东西的那一层**
   *  ——成员表只含群主+管理员，普通成员在别处一律查不到。 */
  profileCards: Record<string, UserCard>;
}

export interface NameResolvers {
  labelOf: (id: string, nick: string, username?: string) => string;
  friendLabel: (f: FriendEntry) => string;
  convLabel: (c: Conversation) => string;
  convDisplayLabel: (c: Conversation) => string;
  convAvatarUrl: (c: Conversation) => string | undefined;
  peerAvatar: (id: string) => string | undefined;
  peerNick: (id: string) => string | undefined;
  peerUsername: (id: string) => string | undefined;
  groupRemark: (cid: string) => string;
  memberNick: (cid: string, id: string) => string;
  localNameOf: (id: string, cid: string, fallback?: string) => string;
  senderLabel: (m: ChatMessage) => string;
  groupMemberLabel: (m: Pick<GroupMember, "user_id"> & { group_nickname?: string; nickname?: string }) => string;
  senderRole: (m: ChatMessage) => "owner" | "admin" | undefined;
  senderAvatar: (m: ChatMessage) => string | undefined;
}

export function makeNameResolvers(s: NamingSources): NameResolvers {
  const { remarks, friends, conversations, groupInfos, peerCards, searchResults, profileCards } = s;

  const labelOf = (id: string, nick: string, username?: string) => displayNameOf(id, remarks, nick, username);
  // 好友显示名优先级：备注名 > 昵称 > @句柄 > 占位。
  const friendLabel = (f: FriendEntry) => displayNameOf(f.user_id, remarks, f.remark || f.nickname, f.username);
  // 会话对端显示名：备注 > 昵称 > 占位。
  // 会话列表**不下发 username**（§7.4），故末级只能到占位——那也好过露出内部 ID。
  const convLabel = (c: Conversation) => displayNameOf(c.peer, remarks, c.peer_remark || c.peer_nickname);
  const convDisplayLabel = (c: Conversation) => (c.is_group ? ((c.remark || "").trim() || c.name || "群聊") : convLabel(c));
  const convAvatarUrl = (c: Conversation) => (c.is_group ? c.avatar_url : c.peer_avatar_url);

  // 对端头像/昵称的多来源兜底（会话 > 好友 > 任一群成员表 > 名片/搜索/解析缓存）：
  // 从没聊过的群成员点开单聊/资料卡时没有会话行，不兜底就只剩首字母圈（而群里气泡是正常的）。
  const peerSources = () => ({
    conversations, friends, groups: Object.values(groupInfos),
    search: [...Object.values(peerCards), ...(searchResults ?? []), ...Object.values(profileCards)],
  });
  const peerAvatar = (id: string) => resolvePeerAvatar(id, peerSources());
  const peerNick = (id: string) => resolvePeerNickname(id, peerSources());
  // 公开句柄只有 `GET /users/{id}` 的权威名片带（好友/会话列表不下发，见 PROTOCOL「用户标识」）。
  // 拿不到就 undefined，由调用方**整行隐藏**——绝不回退到内部 ID。
  const peerUsername = (id: string) => peerCards[id]?.username || undefined;

  // 群备注（G1，仅本人可见）——**服务端多端同步**：从会话列表状态读该会话的 remark
  //（随 /conversations 拉取，conv_update 后自动刷新）。
  const groupRemark = (cid: string): string =>
    (conversations.find((c) => c.conv_id === cid)?.remark || "").trim();

  // 群成员昵称（气泡回退用）：群昵称 > 全局昵称 > 全局解析缓存 > 空串（调用方走自己的兜底）。
  const memberNick = (cid: string, id: string): string => {
    const m = groupInfos[cid]?.members.find((x) => x.user_id === id);
    const local = (m?.group_nickname && m.group_nickname.trim()) || (m?.nickname && m.nickname.trim()) || "";
    if (local) return local;
    // 成员表给不出：超级群不下发成员集、或发送者已退群。问全局解析器（缺的由 App 的
    // unresolvedViewUids effect 批量补上）；仍拿不到回空串。
    return (profileCards[id]?.nickname ?? "").trim();
  };

  /** 某人在**本机**的显示名：备注 > 群昵称/全局昵称 > fallback（一般是服务端字面）> 占位。
   *  系统消息里的名字、引用条发送者、typing 副标题共用；会发出去的内容一律不经过这里。 */
  const localNameOf = (id: string, cid: string, fallback?: string): string =>
    displayNameOf(id, remarks, memberNick(cid, id) || fallback);

  const senderLabel = (m: ChatMessage): string =>
    displayNameOf(m.from, remarks, m.fromNickname || memberNick(m.convId, m.from));

  /** 群成员在**本机**列表里的显示名：备注 > 群昵称 > 全局昵称 > 占位。
   *  成员列表/已读回执/成员菜单确认文案都用它；会发出去的内容（@token 等）仍用公开名。 */
  const groupMemberLabel = (m: Pick<GroupMember, "user_id"> & { group_nickname?: string; nickname?: string }): string =>
    displayNameOf(m.user_id, remarks, m.group_nickname || m.nickname);

  // 发送者在本群的角色（群主/管理员气泡徽标）：**优先本群成员表的当前角色**（晋升/降级后老消息
  // 随之变化，微信式）；成员表未加载 / 发送者已退群查不到时，回退消息自带 from_role 兜底
  //（服务端仅对 owner/admin 冗余下发）。
  const senderRole = (m: ChatMessage): "owner" | "admin" | undefined => {
    const gm = groupInfos[m.convId]?.members.find((x) => x.user_id === m.from);
    const role = gm?.role ?? m.fromRole;
    return role === "owner" ? "owner" : role === "admin" ? "admin" : undefined;
  };

  // 群成员头像 URL（气泡左侧头像列）：成员表 → 全局解析缓存 → undefined（Avatar 回退首字母圈）。
  // **超级群里走到第二层是常态而非例外**：成员表只含群主+管理员，不兜底的话满屏普通成员
  // 的气泡头像全是首字母圈（消息自带 from_nickname 却没有 from_avatar）。
  const senderAvatar = (m: ChatMessage): string | undefined => {
    const url = groupInfos[m.convId]?.members.find((x) => x.user_id === m.from)?.avatar_url;
    return url || profileCards[m.from]?.avatar_url || undefined;
  };

  return {
    labelOf, friendLabel, convLabel, convDisplayLabel, convAvatarUrl,
    peerAvatar, peerNick, peerUsername, groupRemark,
    memberNick, localNameOf, senderLabel, groupMemberLabel, senderRole, senderAvatar,
  };
}
