import type { FriendEntry } from "./sdk/protocol";

/** 「新的朋友」页「已添加」段：只看最近 30 天、最多 50 条（设计 NEW_FRIENDS_DESIGN §1，三端同值）。 */
export const RECENT_ADDED_DAYS = 30;
export const RECENT_ADDED_MAX = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 最近成为好友的人：status=accepted 且 updated_at >= now-30d，updated_at 倒序，最多 50 条。
 *  updated_at / now 均为 Unix 毫秒（服务端 UnixMilli）。accepted 状态下 updated_at = 成为好友的时间
 *  （改备注/拉黑不动它）。不修改入参。 */
export function recentAdded(friends: FriendEntry[], now: number): FriendEntry[] {
  const since = now - RECENT_ADDED_DAYS * MS_PER_DAY;
  return friends
    .filter((f) => f.status === "accepted" && f.updated_at >= since)
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, RECENT_ADDED_MAX);
}
