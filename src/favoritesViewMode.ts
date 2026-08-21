// 收藏「以消息模式 / 以聊天模式查看」偏好持久化（FAVORITES_DESIGN §14 ④，对齐 iOS NSUserDefaults）。
// 写法同 optedIn.ts：localStorage 读写各自 try/catch，失败回默认「消息模式」。
export type FavoritesViewMode = "messages" | "chats";

export const FAVORITES_VIEW_MODE_KEY = "im.favorites.viewMode";

export const VIEW_MODE_LABELS: Record<FavoritesViewMode, string> = {
  messages: "以消息模式查看", chats: "以聊天模式查看",
};

export function loadFavoritesViewMode(): FavoritesViewMode {
  try { return localStorage.getItem(FAVORITES_VIEW_MODE_KEY) === "chats" ? "chats" : "messages"; }
  catch { return "messages"; }
}

export function saveFavoritesViewMode(mode: FavoritesViewMode): void {
  try { localStorage.setItem(FAVORITES_VIEW_MODE_KEY, mode); } catch { /* 配额满等，忽略 */ }
}
