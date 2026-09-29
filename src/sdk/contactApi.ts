// 联系人 / 好友关系 / 会话级设置的 HTTP 读写。
//
// 与 groupApi / qrApi / devicesApi 同一类：**无状态一次性请求**，不碰 socket 也不碰本地库。
// IMClient 保留同名薄方法转调，调用方零改动（CODING_STYLE §7 按域拆）。

import { callJson } from "./http";
import type { UserCard, FriendEntry } from "./protocol";

/** 与 IMClient.api 同款：带 Bearer，有 body 时补 JSON Content-Type。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(token: string, path: string, init?: RequestInit): Promise<any> {
  return await callJson(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
}

/** 找人：按 q 搜索用户（昵称/手机号/uid/标签，后端去 phone、排除自己）。 */
export async function searchUsers(token: string, q: string, limit = 20): Promise<UserCard[]> {
  const data = await api(token, `/api/v1/users/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  return (data?.users ?? []) as UserCard[];
}

/** 好友/申请列表（status 为空=全部：accepted/pending/requested/blocked）。 */
export async function listFriends(token: string, status = ""): Promise<FriendEntry[]> {
  const data = await api(token, `/api/v1/friends${status ? `?status=${encodeURIComponent(status)}` : ""}`);
  return (data?.friends ?? []) as FriendEntry[];
}

/** 好友动作（同意/拒绝/拉黑/解黑）：POST /api/v1/friends/{action} body {user_id}。
 *  **不含 request**：发申请要带验证消息且要读 outcome，走下面的 requestFriend。 */
export async function friendAction(token: string, action: "accept" | "reject" | "block" | "unblock", userId: string): Promise<void> {
  await api(token, `/api/v1/friends/${action}`, { method: "POST", body: JSON.stringify({ user_id: userId }) });
}

/**
 * 发好友申请：POST /api/v1/friends/request。
 * 返回 true 表示**已直接成为好友、无需对方确认**（对方先申请过我；或我曾单向删除对方而对方仍视我为好友）。
 * 调用方据此**不要提示「已发送好友申请」**——那会让用户误以为还要等对方通过；刷新界面即可。
 */
export async function requestFriend(token: string, userId: string, hello = ""): Promise<boolean> {
  const r = await api(token, `/api/v1/friends/request`, { method: "POST", body: JSON.stringify({ user_id: userId, hello }) });
  return (r as { outcome?: string } | undefined)?.outcome === "accepted";
}

/** 删除好友：DELETE /api/v1/friends/{id}。 */
export async function removeFriend(token: string, userId: string): Promise<void> {
  await api(token, `/api/v1/friends/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

/** 设置好友备注名（空串=清除）：POST /api/v1/friends/remark。 */
export async function setRemark(token: string, userId: string, remark: string): Promise<void> {
  await api(token, `/api/v1/friends/remark`, { method: "POST", body: JSON.stringify({ user_id: userId, remark }) });
}

// —— 会话管理（M4.5）——

/** 更新会话级设置（置顶/免打扰/标未读，整体替换）：PUT /api/v1/conversations/{id}/settings。
 *  注：remark 已从 settings 拆出走 setConvRemark；本端点服务端会保留现有 remark 不清空。
 *  `mute_until` 可选（NOTIFICATIONS_P1_DESIGN §5.2）：省略时若本次 `muted=true` 且当前正处于未到期的
 *  定时免打扰，服务端保留原到期时间；显式传值则照写；`muted=false` 时服务端一律清 0。
 *  **改置顶/标未读等只想原样带回 `muted` 的调用方不要传本字段**，否则会把定时免打扰意外变成永久。 */
export async function updateConvSettings(token: string, convId: string, s: { pinned_at: number; muted: boolean; mute_until?: number; marked_unread: boolean }): Promise<void> {
  await api(token, `/api/v1/conversations/${encodeURIComponent(convId)}/settings`, { method: "PUT", body: JSON.stringify(s) });
}

/** 设置会话备注（G1，仅本人可见、多端同步）：PUT /api/v1/conversations/{id}/remark。留空即清除。
 *  与设置三开关解耦（各走各端点，互不覆盖）；变更经 conv_update 同步全端。 */
export async function setConvRemark(token: string, convId: string, remark: string): Promise<void> {
  await api(token, `/api/v1/conversations/${encodeURIComponent(convId)}/remark`, { method: "PUT", body: JSON.stringify({ remark }) });
}

/** 删除会话（仅本人，记 cleared_at 不删消息）：DELETE /api/v1/conversations/{id}。 */
export async function deleteConversation(token: string, convId: string): Promise<void> {
  await api(token, `/api/v1/conversations/${encodeURIComponent(convId)}`, { method: "DELETE" });
}
