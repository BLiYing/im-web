// shareTargets：分享 / 转发选择页「最近聊天 + 我的好友 + 我的群聊」的选择模型（纯逻辑，无 React）。
// 交互契约见 IMServer/docs/design/sketches/SHARE_PICKER_UX_SKETCH.html ⑦。
//
// 核心约定：**选中集只存 conv_id**，三个来源共用一份——
//   · 最近聊天：会话自带 conv_id；
//   · 好友：按协议在本地算 `convIdFor(我, 好友)`（u_<a>_u_<b>，两 uid 按字符串升序），与服务端建会话同口径；
//   · 群：GET /api/v1/groups 返回的 conv_id（g_xxx）。
// 于是同一个人 / 群在任何列表里勾选状态天然一致，上限也天然按「合计」算。
//
// 没聊过的好友 / 会话已删的群也要能发：这里把它们**合成成 Conversation 形状**（只填 conv_id/is_group/peer/
// 名字/头像），所以下游 onForward → sendForwardToTarget 等调用方一行不用改（它们只读这几个字段）。
// 发出后服务端回 ack → App 节流刷新会话列表，新会话自然出现。
import { SYSTEM_UID, convIdFor, type ChatMessage, type Conversation, type FriendEntry, type GroupSummary } from "./sdk/protocol";
import { filterByQuery } from "./listSearch";
import { replyPreviewOf } from "./messageContent";
import { t } from "./i18n"; // 非组件模块：调用时刻取语言，不在模块顶层求值

/** 可选的好友：已互加（accepted），排除拉黑、已注销、系统通知账号和自己。
 *  顺序与 Web 通讯录页同口径（`updated_at` 降序）：Web 通讯录本就没有 A–Z 分组 / 字母索引，选择页不另起一套
 *  （iOS / Android 的好友子页有分组，是因为它们复用了各自带分组的好友页）。 */
export function pickableFriends(friends: FriendEntry[], myUid: string): FriendEntry[] {
  return friends.filter((f) => f.status === "accepted" && !f.blocked && !f.deleted
    && f.user_id !== SYSTEM_UID && f.user_id !== myUid)
    .sort((a, b) => b.updated_at - a.updated_at);
}

/** 好友 → 会话形状的目标（conv_id 按协议本地推导）。 */
export function friendTarget(myUid: string, f: FriendEntry): Conversation {
  return {
    conv_id: convIdFor(myUid, f.user_id), is_group: false, peer: f.user_id,
    peer_nickname: f.nickname || (f.username ? `@${f.username}` : ""),
    peer_remark: f.remark, peer_avatar_url: f.avatar_url,
    last_message: null, latest_conv_seq: 0, unread: 0, read_seq: 0, peer_read_seq: 0,
  };
}

/** 群（我的群列表一项）→ 会话形状的目标。 */
export function groupTarget(g: GroupSummary): Conversation {
  return {
    conv_id: g.conv_id, is_group: true, peer: "", name: g.name, avatar_url: g.avatar_url,
    last_message: null, latest_conv_seq: 0, unread: 0, read_seq: 0, peer_read_seq: 0,
  };
}

/** 可选择的最近会话：排除系统通知单聊（只读会话，服务端拒 send_msg to=system）。 */
export function isSendableConv(c: Conversation): boolean {
  return !!c.is_group || c.peer !== SYSTEM_UID;
}

/** conv_id → 目标。**已有会话优先**（它带着备注 / 最新名字等更全的字段），好友 / 群只补缺。 */
export function buildTargetIndex(recent: Conversation[], friends: Conversation[], groups: Conversation[]): Map<string, Conversation> {
  const idx = new Map<string, Conversation>();
  for (const c of [...recent, ...friends, ...groups]) if (!idx.has(c.conv_id)) idx.set(c.conv_id, c);
  return idx;
}

/** 选中集（勾选顺序）→ 目标列表；索引里找不到的（如混进来的系统通知）丢弃。 */
export function resolveTargets(ids: string[], idx: Map<string, Conversation>): Conversation[] {
  return ids.map((id) => idx.get(id)).filter((c): c is Conversation => !!c);
}

/** 剔掉索引里解析不到的选中 id，保持勾选顺序（幽灵选中不该占名额）。 */
export function prunedTargets(ids: string[], idx: Map<string, Conversation>): string[] {
  return ids.filter((id) => idx.has(id));
}

export interface ShareSearchSections { recent: Conversation[]; friends: Conversation[]; groups: Conversation[] }

/** 主页搜索：同时搜三处，按 conv_id 去重——已在「最近聊天」里出现的人 / 群不在好友、群聊分组重复。 */
export function searchShareSections(q: string, recent: Conversation[], friends: Conversation[], groups: Conversation[],
  label: (c: Conversation) => string): ShareSearchSections {
  const keys = (c: Conversation) => [label(c), c.peer];
  const r = filterByQuery(recent, q, keys);
  const seen = new Set(recent.map((c) => c.conv_id));
  const notSeen = (list: Conversation[]) => list.filter((c) => !seen.has(c.conv_id));
  return { recent: r, friends: filterByQuery(notSeen(friends), q, keys), groups: filterByQuery(notSeen(groups), q, keys) };
}

/** 确认面板的内容预览（纯派生），复用引用条的现成口径 `replyPreviewOf`（图片 → [图片]、文件 → [文件] 名、
 *  合并记录 → [聊天记录] 标题、名片 → [个人名片] 昵称……），不另起一套：
 *  · 1 条 → 该条摘要；文本给**全文**（群邀请要看得到链接，引用条那 60 字截断会把它截掉，视觉上由 CSS 限高）；
 *  · 合并转发多条 → [聊天记录]；
 *  · 逐条转发多条 →「[逐条转发] N 条消息」（share.preview.each_messages，三端同键）。 */
export function forwardPreview(msgs: ChatMessage[], mode: "each" | "merged"): string {
  if (msgs.length === 0) return "";
  if (msgs.length > 1) return mode === "merged" ? t("preview.chat_record") : t("share.preview.each_messages", { count: msgs.length });
  const m = msgs[0];
  return (m.contentType || "text") === "text" ? m.content : replyPreviewOf(m);
}

/** 群二维码 / 邀请链接「发送给朋友」：合成一条待发文本消息（「邀请你加入群聊「群名」」+ 换行 + `/q/g/<token>` 链接），
 *  喂进转发选择页——与「分享名片」同一条路（useContactShare.shareContactCard）。
 *  `from` 留空：转发路径取 `origin = forwardFrom || fromNickname || from`，留空才不会被标成「转发自 xxx」。 */
export function groupInviteMessage(groupName: string, url: string): ChatMessage {
  return {
    clientMsgId: `invite-${url}`, convId: "", from: "",
    content: `${t("share.group_invite.text", { name: groupName })}\n${url}`, contentType: "text",
    convSeq: 1, // >0：转发路径按"已确认消息"处理（0 会被当成未发出的占位过滤掉）
    timestamp: Date.now(), status: "sent",
  };
}
