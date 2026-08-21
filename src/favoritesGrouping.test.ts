import { describe, it, expect } from "vitest";
import {
  groupFavoritesBySource, sourceGroupName, favoritePreviewText, isMineFavorite, MINE_GROUP_KEY,
} from "./favoritesGrouping";
import type { Favorite } from "./sdk/protocol";

function fav(over: Partial<Favorite>): Favorite {
  return {
    id: 1, content_type: "text", content: "hi",
    source_conv_id: "u_1001_u_2002", source_conv_seq: 5, source_from: "2002",
    created_at: 1, ...over,
  };
}

describe("isMineFavorite / 「我的」桶规则（§14 ③）", () => {
  it("自己发的归我的", () => { expect(isMineFavorite(fav({ source_from: "1001" }), "1001")).toBe(true); });
  it("无来源会话归我的", () => { expect(isMineFavorite(fav({ source_conv_id: "" }), "1001")).toBe(true); });
  it("别人发的、有来源 → 不归我的", () => { expect(isMineFavorite(fav({ source_from: "2002" }), "1001")).toBe(false); });
});

describe("groupFavoritesBySource", () => {
  it("空列表 → []", () => { expect(groupFavoritesBySource([], "1001")).toEqual([]); });

  it("按 source_conv_id 分组；组间按最近收藏倒序；组内倒序；自己发的/无来源归「我的」", () => {
    const favs = [
      fav({ id: 1, source_conv_id: "g_1", source_from: "3003", created_at: 10 }),
      fav({ id: 2, source_conv_id: "u_1001_u_2002", source_from: "2002", created_at: 50 }),
      fav({ id: 3, source_conv_id: "g_1", source_from: "3003", created_at: 30 }),
      fav({ id: 4, source_conv_id: "u_1001_u_2002", source_from: "1001", created_at: 20 }), // 自己发的 → 我的
      fav({ id: 5, source_conv_id: "", source_from: "", created_at: 40 }),                   // 无来源 → 我的
    ];
    const groups = groupFavoritesBySource(favs, "1001");
    expect(groups.map((g) => g.key)).toEqual(["u_1001_u_2002", MINE_GROUP_KEY, "g_1"]); // 50 > 40 > 30
    expect(groups[0].items.map((f) => f.id)).toEqual([2]);
    expect(groups[1].isMine).toBe(true);
    expect(groups[1].convId).toBeNull();
    expect(groups[1].items.map((f) => f.id)).toEqual([5, 4]);
    expect(groups[2].items.map((f) => f.id)).toEqual([3, 1]);
    expect(groups[2].latest.id).toBe(3);
  });
});

describe("sourceGroupName", () => {
  const [known, mine] = groupFavoritesBySource([
    fav({ id: 1, source_conv_id: "g_1", source_from: "3003", created_at: 2 }),
    fav({ id: 2, source_conv_id: "", source_from: "", created_at: 1 }),
  ], "1001");
  it("已知会话用解析名", () => { expect(sourceGroupName(known, () => "设计组")).toBe("设计组"); });
  it("来源已不存在 → 显 conv_id 兜底、不隐藏", () => { expect(sourceGroupName(known, () => undefined)).toBe("g_1"); });
  it("「我的」固定名", () => { expect(sourceGroupName(mine, () => "x")).toBe("我的"); });
});

describe("favoritePreviewText", () => {
  it("媒体/文件/记录/文本口径", () => {
    expect(favoritePreviewText(fav({ content_type: "image" }))).toBe("[图片]");
    expect(favoritePreviewText(fav({ content_type: "image", caption: "白板" }))).toBe("[图片] 白板");
    expect(favoritePreviewText(fav({ content_type: "video" }))).toBe("[视频]");
    expect(favoritePreviewText(fav({ content_type: "file", file_name: "a.xlsx" }))).toBe("a.xlsx");
    expect(favoritePreviewText(fav({ content_type: "file" }))).toBe("[文件]");
    expect(favoritePreviewText(fav({ content_type: "chat_record", content: "{}" }))).toBe("[聊天记录]");
    expect(favoritePreviewText(fav({ content_type: "text", content: "笔记" }))).toBe("笔记");
  });
});
