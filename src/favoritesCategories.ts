// 收藏分类（纯逻辑，可单测；与 iOS IMChatDetailTabs / FAVORITES_DESIGN §3 同口径）。
// 「全部」恒置首且默认；其余（媒体/文件/链接/语音/文本）仅在存在该类收藏时出现（present-only）。
// 归类判定与详情页对齐：链接 = content_type==='link' 或 text 且整体形如 URL（isUrlText）。
import type { Favorite } from "./sdk/protocol";
import { isUrlText } from "./messageContent";

/** 分类种类。all 恒有；其余为动态段。 */
export type FavoriteKind = "all" | "media" | "file" | "link" | "voice" | "text";

/** 段中文标题（chips / 范围前缀 chip / 空态文案共用）。 */
export const CATEGORY_LABELS: Record<FavoriteKind, string> = {
  all: "全部", media: "媒体", file: "文件", link: "链接", voice: "语音", text: "文本",
};

/** 动态段的固定出现顺序（全部之后），新增 content_type 在此加一行即可。 */
const DYNAMIC_ORDER: Exclude<FavoriteKind, "all">[] = ["media", "file", "link", "voice", "text"];

/** 某条收藏是否属于给定分类（all 恒真）。 */
export function matchesCategory(f: Favorite, kind: FavoriteKind): boolean {
  const ct = f.content_type;
  switch (kind) {
    case "all": return true;
    case "media": return ct === "image" || ct === "video";
    case "file": return ct === "file";
    // 链接 = 显式 link 类型，或整段就是一个 URL 的文本（与详情页/iOS IMLooksLikeURL 对齐）。
    case "link": return ct === "link" || (ct === "text" && isUrlText(f.content));
    case "voice": return ct === "audio" || ct === "voice";
    // 文本 = 纯 text 且不是 URL（URL 归「链接」，不重复计入文本）。
    case "text": return ct === "text" && !isUrlText(f.content);
  }
}

/** 从收藏列表推导有序分类：[全部] + 按 DYNAMIC_ORDER 仅保留存在者。 */
export function deriveCategories(favs: Favorite[]): FavoriteKind[] {
  const out: FavoriteKind[] = ["all"];
  for (const kind of DYNAMIC_ORDER) {
    if (favs.some((f) => matchesCategory(f, kind))) out.push(kind);
  }
  return out;
}
