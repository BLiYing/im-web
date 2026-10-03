// 群聊域的 HTTP 读写（M3 建群/资料/成员 ~ G2 权限·禁言 ~ G3 入群申请）。
//
// 拆出的理由与 qrApi / devicesApi / favoritesApi 同一条（CODING_STYLE §7；imSdk.ts 文件头
// 也写着"如拆按域分（auth/messages/groups/qr）"）：这些是**无状态一次性请求**——不碰 socket、
// 不碰本地库、不依赖连接态，留在 IMClient 里只是把那个类撑胖。
// IMClient 保留同名薄方法转调，调用方零改动。

import { callJson } from "./http";
import type { GroupInfo, GroupSummary, GroupBan, JoinRequest } from "./protocol";

/** 与 IMClient.api 同款：带 Bearer，有 body 时补 JSON Content-Type。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(token: string, path: string, init?: RequestInit): Promise<any> {
  return await callJson(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
}

// —— 群聊（M3~G2）——

/** 建群：owner=自己，memberIds=初始成员。返回群资料+成员。 */
export async function createGroup(token: string, name: string, memberIds: string[], avatarUrl = ""): Promise<GroupInfo> {
  return (await api(token, "/api/v1/groups", {
    method: "POST",
    body: JSON.stringify({ name, avatar_url: avatarUrl, member_ids: memberIds }),
  })) as GroupInfo;
}

/** 我的群列表。 */
export async function listGroups(token: string): Promise<GroupSummary[]> {
  const data = await api(token, "/api/v1/groups");
  return (data?.groups ?? []) as GroupSummary[];
}

/** 群资料 + 成员（须为群成员）。 */
export async function fetchGroup(token: string, convId: string): Promise<GroupInfo> {
  return (await api(token, `/api/v1/groups/${encodeURIComponent(convId)}`)) as GroupInfo;
}

/**
 * 群消息已读/未读名单（M4-8）：**仅消息发送者本人**可调（他人调用服务端回 403）。
 * `enabled=false` 表示群规模超上限（>2000 人）——read/unread 为空，调用方应隐藏入口而非报错。
 * 不含读取时刻：已读位点语义是"读到 conv_seq 为止"，无法反推某人何时读到这一条。
 */
export async function fetchReadReceipts(token: string, convId: string, convSeq: number): Promise<{ read: string[]; unread: string[]; enabled: boolean }> {
  const data = await api(token, `/api/v1/conversations/${encodeURIComponent(convId)}/messages/${convSeq}/read-by`);
  return {
    read: Array.isArray(data?.read) ? (data.read as string[]) : [],
    unread: Array.isArray(data?.unread) ? (data.unread as string[]) : [],
    enabled: data?.enabled === true,
  };
}

/** 改群资料（群主/管理员）。 */
export async function updateGroup(token: string, convId: string, name: string, avatarUrl: string, intro = ""): Promise<void> {
  // 整体替换语义：name/avatar_url/intro 都回带当前值，省略即清空（后端 G1）。
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}`, {
    method: "PUT", body: JSON.stringify({ name, avatar_url: avatarUrl, intro }),
  });
}

/** 发布/撤下群公告（G1，群主/管理员）：text 空即撤下。 */
export async function setGroupAnnouncement(token: string, convId: string, text: string): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/announcement`, {
    method: "PUT", body: JSON.stringify({ text }),
  });
}

/** 群主/管理员自助全员禁言（G1）：until=0 解除 / -1 永久 / 其余到期毫秒时间戳。 */
export async function setGroupMute(token: string, convId: string, until: number): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/mute`, {
    method: "PUT", body: JSON.stringify({ until }),
  });
}

/** 我在本群的昵称（G1，任意成员）：空串=清除回退全局昵称。 */
export async function setGroupMyNickname(token: string, convId: string, nickname: string): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/members/me/nickname`, {
    method: "PUT", body: JSON.stringify({ nickname }),
  });
}

/** 群治理开关组（G2，群主/管理员整体替换）。 */
export async function setGroupSettings(token: string, convId: string, s: {
    join_approval: boolean; perm_invite: boolean; perm_edit_info: boolean; perm_pin: boolean; history_visible: boolean;
  }): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/settings`, {
    method: "PUT", body: JSON.stringify(s),
  });
}

/** 单独禁言成员（G2）：until=0 解禁 / -1 永久 / 其余到期毫秒。 */
export async function muteGroupMember(token: string, convId: string, userId: string, until: number): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/members/${encodeURIComponent(userId)}/mute`, {
    method: "PUT", body: JSON.stringify({ until }),
  });
}

/** 移出成员带封禁档（G2）：ban=none|cooldown|forever。 */
export async function removeGroupMemberWithBan(token: string, convId: string, userId: string, ban: "none" | "cooldown" | "forever"): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/members/${encodeURIComponent(userId)}?ban=${ban}`, { method: "DELETE" });
}

/** 群黑名单列表（G2，群主/管理员）。 */
export async function fetchGroupBans(token: string, convId: string): Promise<GroupBan[]> {
  const data = await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/bans`);
  return (data?.bans ?? []) as GroupBan[];
}

/** 解除拉黑（G2，群主/管理员）。 */
export async function unbanGroupMember(token: string, convId: string, userId: string): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/bans/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

/**
 * 邀请入群。**返回实际加入的 uid `added`，及转待审的 uid `pending`**（服务端 `{added,pending}`）——不是传进去的那批：
 * 群开了「进群确认」时普通成员邀请的人进 pending（等群主/管理员审批），不是「已在群里」。
 * 已在群里的人会被服务端跳过，且这属于**幂等成功**而非错误。
 * 超级群下这事是常态：`GET /groups/{id}` 对超级群只回我自己，端上算不出完整的"已在群里"
 * 排除集，老成员照样会出现在候选里。调用方须按 added 与所选数量的差给反馈。
 */
export async function inviteToGroup(token: string, convId: string, memberIds: string[]): Promise<{ added: string[]; pending: string[] }> {
  const d = await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/members`, {
    method: "POST", body: JSON.stringify({ member_ids: memberIds }),
  }) as { added?: string[]; pending?: string[] } | undefined;
  return { added: d?.added ?? [], pending: d?.pending ?? [] };
}

/** 退群（群主须先转让）。 */
export async function leaveGroup(token: string, convId: string): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/members/me`, { method: "DELETE" });
}

/** 解散群（仅群主）：DELETE /api/v1/groups/{id} → 广播 dissolve，全体退群。 */
export async function dissolveGroup(token: string, convId: string): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}`, { method: "DELETE" });
}

/** 移除成员（须权限高于对方）。 */
export async function removeGroupMember(token: string, convId: string, userId: string): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

/** 设/撤管理员（仅群主）：role=admin|member。 */
export async function setGroupRole(token: string, convId: string, userId: string, role: "admin" | "member"): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/members/${encodeURIComponent(userId)}/role`, {
    method: "PUT", body: JSON.stringify({ role }),
  });
}

/** 转让群主（仅群主；原群主降为普通成员）。 */
export async function transferGroup(token: string, convId: string, userId: string): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/transfer`, {
    method: "POST", body: JSON.stringify({ user_id: userId }),
  });
}

// —— 入群路径（G3）——

/** 凭群码入群。`code` 可为完整 URL 或裸 token；成功返回群资料，需审批时抛 300210。
 *  两个"token"别混：`token` 是登录凭证，`code` 是群码——服务端请求体里的字段名仍叫 token。 */
export async function joinGroupByCode(token: string, code: string, hello = ""): Promise<GroupInfo> {
  return (await api(token, `/api/v1/groups/join`, {
    method: "POST", body: JSON.stringify({ token: code, hello }),
  })) as GroupInfo;
}

/** 待审入群申请（群主/管理员）；status 空=全部。 */
export async function fetchJoinRequests(token: string, convId: string, status = "pending"): Promise<JoinRequest[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/join-requests${q}`);
  return ((data?.requests ?? []) as (JoinRequest & { inviter_nickname?: string })[]).map(({ inviter_nickname, ...r }) =>
    inviter_nickname ? { ...r, inviterNickname: inviter_nickname } : r);
}

/** 审批一条入群申请（群主/管理员）：accept=true→approve，false→reject。 */
export async function decideJoinRequest(token: string, convId: string, userId: string, accept: boolean): Promise<void> {
  await api(token, `/api/v1/groups/${encodeURIComponent(convId)}/join-requests/${encodeURIComponent(userId)}`, {
    method: "POST", body: JSON.stringify({ action: accept ? "approve" : "reject" }),
  });
}
