import { describe, it, expect } from "vitest";
import { deriveCategories, matchesCategory, CATEGORY_LABELS, type FavoriteKind } from "./favoritesCategories";
import type { Favorite } from "./sdk/protocol";

function fav(over: Partial<Favorite>): Favorite {
  return {
    id: 1, content_type: "text", content: "hi",
    source_conv_id: "u_1001_u_2002", source_conv_seq: 5, source_from: "2002",
    created_at: 1, ...over,
  };
}

describe("matchesCategory", () => {
  it("all 恒真", () => {
    for (const ct of ["text", "image", "video", "file", "link", "audio"]) {
      expect(matchesCategory(fav({ content_type: ct }), "all")).toBe(true);
    }
  });

  it("媒体 = image|video", () => {
    expect(matchesCategory(fav({ content_type: "image" }), "media")).toBe(true);
    expect(matchesCategory(fav({ content_type: "video" }), "media")).toBe(true);
    expect(matchesCategory(fav({ content_type: "file" }), "media")).toBe(false);
  });

  it("文件 = file", () => {
    expect(matchesCategory(fav({ content_type: "file" }), "file")).toBe(true);
    expect(matchesCategory(fav({ content_type: "image" }), "file")).toBe(false);
  });

  it("链接 = link 类型 或 text 且整段是 URL（与详情页 isUrlText 对齐）", () => {
    expect(matchesCategory(fav({ content_type: "link", content: "https://a.com" }), "link")).toBe(true);
    expect(matchesCategory(fav({ content_type: "text", content: "https://a.com/x" }), "link")).toBe(true);
    expect(matchesCategory(fav({ content_type: "text", content: "看看 https://a.com" }), "link")).toBe(false);
    expect(matchesCategory(fav({ content_type: "text", content: "普通文本" }), "link")).toBe(false);
  });

  it("语音 = audio|voice", () => {
    expect(matchesCategory(fav({ content_type: "audio" }), "voice")).toBe(true);
    expect(matchesCategory(fav({ content_type: "voice" }), "voice")).toBe(true);
    expect(matchesCategory(fav({ content_type: "text" }), "voice")).toBe(false);
  });

  it("文本 = text 且非 URL（URL 归链接，不计入文本）", () => {
    expect(matchesCategory(fav({ content_type: "text", content: "笔记" }), "text")).toBe(true);
    expect(matchesCategory(fav({ content_type: "text", content: "https://a.com" }), "text")).toBe(false);
    expect(matchesCategory(fav({ content_type: "link", content: "https://a.com" }), "text")).toBe(false);
  });
});

describe("deriveCategories", () => {
  it("空列表只有「全部」", () => {
    expect(deriveCategories([])).toEqual<FavoriteKind[]>(["all"]);
  });

  it("全部恒置首、默认；仅保留存在的类，且按固定顺序", () => {
    const favs = [
      fav({ id: 1, content_type: "text", content: "笔记" }),
      fav({ id: 2, content_type: "image", content: "https://a.com/1.jpg" }),
      fav({ id: 3, content_type: "link", content: "https://a.com" }),
    ];
    const cats = deriveCategories(favs);
    expect(cats[0]).toBe("all"); // 全部置首
    expect(cats).toEqual<FavoriteKind[]>(["all", "media", "link", "text"]); // 顺序：媒体<文件<链接<语音<文本；文件/语音缺席
    expect(cats).not.toContain("file");
    expect(cats).not.toContain("voice");
  });

  it("URL 文本使「链接」段出现、且计入文本判定被排除", () => {
    const favs = [fav({ id: 1, content_type: "text", content: "https://a.com" })];
    const cats = deriveCategories(favs);
    expect(cats).toContain("link");
    expect(cats).not.toContain("text");
  });

  it("每个动态段都有中文标题", () => {
    for (const k of ["all", "media", "file", "link", "voice", "text"] as FavoriteKind[]) {
      expect(CATEGORY_LABELS[k]).toBeTruthy();
    }
  });
});
