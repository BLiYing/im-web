// 收藏分类（纯逻辑，可单测；与 iOS IMChatDetailTabs / FAVORITES_DESIGN §3 · §14 同口径）。
// v1：「全部」恒置首且默认；B 方案（§14 ①）：**无「全部」**，页签 = [媒体|文件|链接|语音|文本|聊天记录] 仅存在者。
// 归类判定与详情页对齐：链接 = content_type==='link' 或 text 且整体形如 URL（isUrlText）；
// 聊天记录 = content_type==='chat_record' 或内容形如合并转发 JSON（老收藏兜底），且**文本段排除记录**。
import type { Favorite } from "./sdk/protocol";
import { looksLikeChatRecordJSON, firstURLInText } from "./messageContent";

/** 分类种类。all 仅 v1/兼容用；B 方案页签不含 all。 */
export type FavoriteKind = "all" | "media" | "file" | "link" | "voice" | "text" | "record";

/** 段中文标题（chips / 范围前缀 chip / 空态文案共用）。 */
export const CATEGORY_LABELS: Record<FavoriteKind, string> = {
  all: "全部", media: "媒体", file: "文件", link: "链接", voice: "语音", text: "文本", record: "聊天记录",
};

/** 动态段的固定出现顺序（全部之后），新增 content_type 在此加一行即可。 */
const DYNAMIC_ORDER: Exclude<FavoriteKind, "all">[] = ["media", "file", "link", "voice", "text", "record"];

/** 是否聊天记录收藏（显式类型或 JSON 形态兜底）。 */
function isRecord(f: Favorite): boolean {
  return f.content_type === "chat_record" || looksLikeChatRecordJSON(f.content);
}

/** 某条收藏是否属于给定分类（all 恒真）。 */
export function matchesCategory(f: Favorite, kind: FavoriteKind): boolean {
  const ct = f.content_type;
  switch (kind) {
    case "all": return true;
    case "media": return ct === "image" || ct === "video";
    case "file": return ct === "file";
    // 链接 = 显式 link 类型，或 text 且**含 URL**（草图 §D：混排文本"看看 https://xxx"也进链接分类；
    // 与聊天页/详情页 §C 视图口径一致——数据不重分类、视图按需过滤）。
    case "link": return ct === "link" || (ct === "text" && firstURLInText(f.content) !== null);
    case "voice": return ct === "audio" || ct === "voice";
    // 文本 = 纯 text 且不含 URL、不是聊天记录 JSON（各归链接/记录，不重复计入）。
    case "text": return ct === "text" && firstURLInText(f.content) === null && !isRecord(f);
    case "record": return isRecord(f);
  }
}

/**
 * 从收藏列表推导有序分类。
 * - `includeAll: true`（v1 默认）：[全部] + 按 DYNAMIC_ORDER 仅保留存在者。
 * - `includeAll: false`（B 方案）：仅存在者，按 媒体<文件<链接<语音<文本<聊天记录；无收藏 → []。
 */
export function deriveCategories(favs: Favorite[], opts: { includeAll?: boolean } = {}): FavoriteKind[] {
  const out: FavoriteKind[] = opts.includeAll === false ? [] : ["all"];
  for (const kind of DYNAMIC_ORDER) {
    if (favs.some((f) => matchesCategory(f, kind))) out.push(kind);
  }
  return out;
}

/** B 方案默认页签（§14 ②）：有媒体停「媒体」，否则首个存在签；无收藏 → null。 */
export function defaultCategory(cats: FavoriteKind[]): FavoriteKind | null {
  if (cats.includes("media")) return "media";
  return cats.find((k) => k !== "all") ?? null;
}
