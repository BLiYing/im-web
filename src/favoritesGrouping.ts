// 收藏「聊天模式」分组（纯逻辑，可单测；FAVORITES_DESIGN §14 ④ ③）：
// 按 source_conv_id 分组为来源会话列表；自己发的 / 无来源 → 「我的」；按组内最近收藏时间倒序。
// 来源会话显示名由调用方解析（备注 > 群名/昵称 > uid），来源已不存在时显 conv_id 兜底、不隐藏。
import type { Favorite } from "./sdk/protocol";
import { looksLikeChatRecordJSON } from "./messageContent";

/** 「我的」桶的分组键（与真实 conv_id 不冲突）。 */
export const MINE_GROUP_KEY = "__mine__";

export interface FavoriteSourceGroup {
  key: string;            // 分组键：conv_id 或 MINE_GROUP_KEY
  convId: string | null;  // 来源会话 id（「我的」为 null）
  isMine: boolean;
  items: Favorite[];      // 组内收藏，按 created_at 倒序
  latest: Favorite;       // 最近一条（预览 + 排序依据）
}

/** 归「我的」：自己发的，或无来源会话。 */
export function isMineFavorite(f: Favorite, myUid: string): boolean {
  return !f.source_conv_id || (!!myUid && f.source_from === myUid);
}

/** 分组 + 排序（组间按最近收藏倒序；组内亦倒序）。 */
export function groupFavoritesBySource(favs: Favorite[], myUid: string): FavoriteSourceGroup[] {
  const map = new Map<string, Favorite[]>();
  for (const f of favs) {
    const key = isMineFavorite(f, myUid) ? MINE_GROUP_KEY : f.source_conv_id;
    const arr = map.get(key);
    if (arr) arr.push(f); else map.set(key, [f]);
  }
  const groups: FavoriteSourceGroup[] = [];
  for (const [key, items] of map) {
    items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    groups.push({ key, convId: key === MINE_GROUP_KEY ? null : key, isMine: key === MINE_GROUP_KEY, items, latest: items[0] });
  }
  groups.sort((a, b) => (b.latest.created_at || 0) - (a.latest.created_at || 0));
  return groups;
}

/** 来源组显示名：「我的」固定；已知会话走 resolve；来源已不存在 → 显 conv_id 兜底（§14 ③，不隐藏）。 */
export function sourceGroupName(g: FavoriteSourceGroup, resolve: (convId: string) => string | undefined): string {
  if (g.isMine || !g.convId) return "我的";
  return resolve(g.convId) || g.convId;
}

/** 最近一条收藏的单行预览（与会话列表 [图片]/[文件] 口径一致）。 */
export function favoritePreviewText(f: Favorite): string {
  const ct = f.content_type;
  if (ct === "image") return f.caption ? `[图片] ${f.caption}` : "[图片]";
  if (ct === "video") return f.caption ? `[视频] ${f.caption}` : "[视频]";
  if (ct === "file") return (f.file_name && f.file_name.trim()) || (f.caption ? `[文件] ${f.caption}` : "[文件]");
  if (ct === "audio" || ct === "voice") return "[语音]";
  if (ct === "chat_record" || looksLikeChatRecordJSON(f.content)) return "[聊天记录]";
  return f.content;
}
