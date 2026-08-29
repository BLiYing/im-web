import { describe, it, expect } from "vitest";
import { deriveCategories, defaultCategory, matchesCategory, CATEGORY_LABELS, type FavoriteKind } from "./favoritesCategories";
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

  it("链接 = link 类型 或 text 且含 URL（草图 §D：text 混排 URL 也归链接）", () => {
    expect(matchesCategory(fav({ content_type: "link", content: "https://a.com" }), "link")).toBe(true);
    expect(matchesCategory(fav({ content_type: "text", content: "https://a.com/x" }), "link")).toBe(true);
    expect(matchesCategory(fav({ content_type: "text", content: "看看 https://a.com" }), "link")).toBe(true);
    expect(matchesCategory(fav({ content_type: "text", content: "普通文本" }), "link")).toBe(false);
    // "text 混排 URL"归链接 → 文本分类不再包含它（避免重复计入）。
    expect(matchesCategory(fav({ content_type: "text", content: "看看 https://a.com" }), "text")).toBe(false);
    expect(matchesCategory(fav({ content_type: "text", content: "普通文本" }), "text")).toBe(true);
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

  const RECORD_JSON = JSON.stringify({ t: "设计组的聊天记录", items: [{ from: "2002", content: "hi", content_type: "text", timestamp: 1 }] });
  it("聊天记录 = chat_record 类型 或 形如合并转发 JSON；文本段排除记录", () => {
    expect(matchesCategory(fav({ content_type: "chat_record", content: RECORD_JSON }), "record")).toBe(true);
    expect(matchesCategory(fav({ content_type: "text", content: RECORD_JSON }), "record")).toBe(true);
    expect(matchesCategory(fav({ content_type: "text", content: RECORD_JSON }), "text")).toBe(false);
    expect(matchesCategory(fav({ content_type: "text", content: "笔记" }), "record")).toBe(false);
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

  it("B 方案（includeAll:false）：无「全部」，仅存在者按 媒体<文件<链接<语音<文本<聊天记录；空 → []", () => {
    expect(deriveCategories([], { includeAll: false })).toEqual([]);
    const favs = [
      fav({ id: 1, content_type: "chat_record", content: "{}" }),
      fav({ id: 2, content_type: "text", content: "笔记" }),
      fav({ id: 3, content_type: "file", content: "https://a.com/a.zip" }),
      fav({ id: 4, content_type: "image", content: "https://a.com/1.jpg" }),
    ];
    expect(deriveCategories(favs, { includeAll: false })).toEqual<FavoriteKind[]>(["media", "file", "text", "record"]);
  });

  it("默认签：有媒体停媒体，否则首个存在签；空 → null", () => {
    expect(defaultCategory(["file", "media", "text"])).toBe("media");
    expect(defaultCategory(["file", "text"])).toBe("file");
    expect(defaultCategory([])).toBeNull();
  });

  it("每个动态段都有中文标题", () => {
    for (const k of ["all", "media", "file", "link", "voice", "text", "record"] as FavoriteKind[]) {
      expect(CATEGORY_LABELS[k]).toBeTruthy();
    }
  });
});

// 名片分类（CONTACT_CARD_DESIGN §7.3）：置末、精确匹配、脏名片不计入。
describe("名片分类", () => {
  const contact = (content: string) => ({ id: 1, content_type: "contact", content } as Favorite);
  it("按 content_type 精确匹配，不被文本/链接/记录抢走", () => {
    const f = contact('{"u":"1002","n":"小明"}');
    expect(matchesCategory(f, "contact")).toBe(true);
    expect(matchesCategory(f, "all")).toBe(true);
    expect(matchesCategory(f, "text")).toBe(false);
    expect(matchesCategory(f, "link")).toBe(false);
    expect(matchesCategory(f, "record")).toBe(false);
  });
  it("脏名片（解析不出）不计入——列表里不该出现点不动的空行", () => {
    expect(matchesCategory(contact('{"n":"小明"}'), "contact")).toBe(false);
    expect(matchesCategory(contact("garbage"), "contact")).toBe(false);
  });
  it("动态分类里置末（在聊天记录之后）", () => {
    const cats = deriveCategories([
      contact('{"u":"1002"}'),
      { id: 2, content_type: "text", content: "hello" } as Favorite,
    ], { includeAll: false });
    expect(cats).toEqual(["text", "contact"]);
    expect(CATEGORY_LABELS.contact).toBe("名片");
  });
});
