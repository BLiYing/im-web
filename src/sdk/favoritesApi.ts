// 收藏（M4-4）的 HTTP 读写。
//
// 与 serverConfigApi / downloadSettingsApi 同一类：无状态一次性请求，不碰 socket、不碰本地库。
// 从 imSdk.ts 抽出来是为了让那个已达体量上限的文件不再因为「又加一个 REST 接口」而长
// （CODING_STYLE §7）。IMClient 仍保留同名薄方法转调，调用方无需改动。

import { callJson } from "./http";
import type { Favorite } from "./protocol";

/** 收藏一条内容的快照入参（字段与后端 favorite.Favorite 对齐）。 */
export interface FavoriteDraft {
  content_type?: string; content: string; caption?: string;
  file_name?: string; file_size?: number; duration?: number;
  waveform?: string; thumb?: string; poster?: string;
  media_w?: number; media_h?: number;
  source_conv_id?: string; source_conv_seq?: number; source_from?: string;
}

function auth(token: string, init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  };
}

/** 收藏一条内容（快照）：POST /api/v1/favorites。 */
export async function addFavorite(token: string, f: FavoriteDraft): Promise<void> {
  await callJson("/api/v1/favorites", auth(token, { method: "POST", body: JSON.stringify(f) }));
}

/**
 * 我的收藏列表：GET /api/v1/favorites?limit&offset。
 *
 * 返回 items 与**服务端总数** total。total 用来判断"还有没有下一页"与显示总条数——
 * 只按 items.length 判断会在最后一页恰好装满时永远停不下来（多发一次空请求才知道到底了）。
 */
export async function listFavorites(token: string, offset = 0, limit = 30): Promise<{ items: Favorite[]; total: number }> {
  const data = await callJson(`/api/v1/favorites?limit=${limit}&offset=${offset}`, auth(token));
  return {
    items: (data?.favorites ?? []) as Favorite[],
    // 老服务端不返回 page 时退化成"就这一页"，UI 不会显示错的总数、也不会误以为还有更多。
    total: typeof data?.page?.total === "number" ? data.page.total : (data?.favorites?.length ?? 0),
  };
}

/** 删除收藏：DELETE /api/v1/favorites/{id}。 */
export async function deleteFavorite(token: string, id: number): Promise<void> {
  await callJson(`/api/v1/favorites/${id}`, auth(token, { method: "DELETE" }));
}
