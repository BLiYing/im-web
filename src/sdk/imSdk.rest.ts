// IMClient 的 **REST 转发面**（下载策略 / 设备 / 好友·会话设置 / 群 / 二维码 / 收藏）。
//
// 这一层每个方法都只做同一件事：把当前 token 交给对应的**无状态 HTTP 模块**（sdk/*Api.ts）。
// 它们没有自己的状态、没有时序、也不碰 WebSocket——和 IMClient 里那些真正有状态的东西
// （连接、重连、游标、区间清单、发送队列）放在一起只是历史原因，正是体量门禁说的
// 「如拆按域分」那一刀（scripts/check-file-size.sh 的 grandfather 注释）。
//
// 用基类而不是独立模块，是为了**调用点一处不动**：`client.listGroups()` 仍是 client 上的方法。
// token 因此是 `protected`——IMClient 负责登录/重连时写它，这里只读。

import { fetchDownloadSettings, putDownloadSettings, type DownloadSettingsResult } from "./downloadSettingsApi";
import { listDevices, revokeDevice, revokeOtherDevices } from "./devicesApi";
import { qrMyCard, qrResetMyCard, groupQR, groupQRReset, qrResolve } from "./qrApi";
import { addFavorite, listFavorites, deleteFavorite, type FavoriteDraft } from "./favoritesApi";
import * as groupApi from "./groupApi";
import * as contactApi from "./contactApi";
import type { UserCard, FriendEntry, GroupInfo, GroupSummary, Favorite, GroupBan, QRCard, QRResolved, JoinRequest, DeviceView } from "./protocol";

/** 收藏列表每页条数。滚到底自动加载下一页（见 useFavorites）。 */
export const FAVORITES_PAGE_SIZE = 60;

export abstract class IMRestApi {
  /** 当前 JWT。IMClient 在登录/重连/续期时写它；本类只读。 */
  protected token = "";

  /** 账号级自动下载策略（M4-7）：读 / 整体替换。实现在 sdk/downloadSettingsApi.ts（无状态 HTTP）。 */
  downloadSettings(): Promise<DownloadSettingsResult> { return fetchDownloadSettings(this.token); }
  saveDownloadSettings(s: unknown): Promise<DownloadSettingsResult> { return putDownloadSettings(this.token, s); }

  // ---- 已登录设备 / 多设备管理（P2）：无状态 HTTP，实现在 sdk/devicesApi.ts ----
  listDevices(): Promise<DeviceView[]> { return listDevices(this.token); }
  revokeDevice(sid: string): Promise<void> { return revokeDevice(this.token, sid); }
  revokeOtherDevices(): Promise<void> { return revokeOtherDevices(this.token); }

  // ---- 找人 / 好友 / 会话设置：无状态 HTTP，实现在 sdk/contactApi.ts ----
  searchUsers(q: string, limit = 20): Promise<UserCard[]> { return contactApi.searchUsers(this.token, q, limit); }
  listFriends(status = ""): Promise<FriendEntry[]> { return contactApi.listFriends(this.token, status); }
  friendAction(action: "accept" | "reject" | "block" | "unblock", userId: string): Promise<void> { return contactApi.friendAction(this.token, action, userId); }
  requestFriend(userId: string, hello = ""): Promise<boolean> { return contactApi.requestFriend(this.token, userId, hello); }
  removeFriend(userId: string): Promise<void> { return contactApi.removeFriend(this.token, userId); }
  setRemark(userId: string, remark: string): Promise<void> { return contactApi.setRemark(this.token, userId, remark); }
  updateConvSettings(convId: string, s: { pinned_at: number; muted: boolean; mute_until?: number; marked_unread: boolean }): Promise<void> { return contactApi.updateConvSettings(this.token, convId, s); }
  setConvRemark(convId: string, remark: string): Promise<void> { return contactApi.setConvRemark(this.token, convId, remark); }
  deleteConversation(convId: string): Promise<void> { return contactApi.deleteConversation(this.token, convId); }
  // ---- 群聊 / 入群（M3~G3）：无状态 HTTP，实现在 sdk/groupApi.ts ----
  createGroup(name: string, memberIds: string[], avatarUrl = ""): Promise<GroupInfo> { return groupApi.createGroup(this.token, name, memberIds, avatarUrl); }
  listGroups(): Promise<GroupSummary[]> { return groupApi.listGroups(this.token); }
  fetchGroup(convId: string): Promise<GroupInfo> { return groupApi.fetchGroup(this.token, convId); }
  fetchReadReceipts(convId: string, convSeq: number): Promise<{ read: string[]; unread: string[]; enabled: boolean }> { return groupApi.fetchReadReceipts(this.token, convId, convSeq); }
  updateGroup(convId: string, name: string, avatarUrl: string, intro = ""): Promise<void> { return groupApi.updateGroup(this.token, convId, name, avatarUrl, intro); }
  setGroupAnnouncement(convId: string, text: string): Promise<void> { return groupApi.setGroupAnnouncement(this.token, convId, text); }
  setGroupMute(convId: string, until: number): Promise<void> { return groupApi.setGroupMute(this.token, convId, until); }
  setGroupMyNickname(convId: string, nickname: string): Promise<void> { return groupApi.setGroupMyNickname(this.token, convId, nickname); }
  setGroupSettings(convId: string, s: {   join_approval: boolean; perm_invite: boolean; perm_edit_info: boolean; perm_pin: boolean; history_visible: boolean; }): Promise<void> { return groupApi.setGroupSettings(this.token, convId, s); }
  muteGroupMember(convId: string, userId: string, until: number): Promise<void> { return groupApi.muteGroupMember(this.token, convId, userId, until); }
  removeGroupMemberWithBan(convId: string, userId: string, ban: "none" | "cooldown" | "forever"): Promise<void> { return groupApi.removeGroupMemberWithBan(this.token, convId, userId, ban); }
  fetchGroupBans(convId: string): Promise<GroupBan[]> { return groupApi.fetchGroupBans(this.token, convId); }
  unbanGroupMember(convId: string, userId: string): Promise<void> { return groupApi.unbanGroupMember(this.token, convId, userId); }
  inviteToGroup(convId: string, memberIds: string[]): Promise<string[]> { return groupApi.inviteToGroup(this.token, convId, memberIds); }
  leaveGroup(convId: string): Promise<void> { return groupApi.leaveGroup(this.token, convId); }
  dissolveGroup(convId: string): Promise<void> { return groupApi.dissolveGroup(this.token, convId); }
  removeGroupMember(convId: string, userId: string): Promise<void> { return groupApi.removeGroupMember(this.token, convId, userId); }
  setGroupRole(convId: string, userId: string, role: "admin" | "member"): Promise<void> { return groupApi.setGroupRole(this.token, convId, userId, role); }
  transferGroup(convId: string, userId: string): Promise<void> { return groupApi.transferGroup(this.token, convId, userId); }
  joinGroupByCode(token: string, hello = ""): Promise<GroupInfo> { return groupApi.joinGroupByCode(this.token, token, hello); }
  fetchJoinRequests(convId: string, status = "pending"): Promise<JoinRequest[]> { return groupApi.fetchJoinRequests(this.token, convId, status); }
  decideJoinRequest(convId: string, userId: string, accept: boolean): Promise<void> { return groupApi.decideJoinRequest(this.token, convId, userId, accept); }
  // ---- 二维码体系（QRCODE P0）：无状态 HTTP，实现在 sdk/qrApi.ts ----
  qrMyCard(): Promise<QRCard> { return qrMyCard(this.token); }
  qrResetMyCard(): Promise<QRCard> { return qrResetMyCard(this.token); }
  groupQR(convId: string): Promise<QRCard> { return groupQR(this.token, convId); }
  groupQRReset(convId: string): Promise<QRCard> { return groupQRReset(this.token, convId); }
  qrResolve(raw: string): Promise<QRResolved> { return qrResolve(this.token, raw); }

  // ---- 收藏（M4-4）：无状态 HTTP，实现在 sdk/favoritesApi.ts ----
  addFavorite(f: FavoriteDraft): Promise<void> { return addFavorite(this.token, f); }
  listFavorites(offset = 0, limit = FAVORITES_PAGE_SIZE): Promise<{ items: Favorite[]; total: number }> {
    return listFavorites(this.token, offset, limit);
  }
  deleteFavorite(id: number): Promise<void> { return deleteFavorite(this.token, id); }
}
