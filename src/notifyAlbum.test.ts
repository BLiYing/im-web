// 相册（宫格）通知聚合：同相册只占一个通知位，算错会「连弹 9 条」或「把不同相册并成一条」。
import { describe, expect, it } from "vitest";
import { ALBUM_TTL_MS, albumBody, albumKindOf, createAlbumTracker } from "./notifyAlbum";
import { t } from "./i18n";
import type { ChatMessage } from "./sdk/protocol";

const img = (seq: number, over: Partial<ChatMessage> = {}): ChatMessage =>
  ({ convId: "g_1", convSeq: seq, from: "u2", contentType: "image", groupId: "alb1", ...over } as ChatMessage);

describe("albumKindOf", () => {
  it("只认带 groupId 的图片 / 视频", () => {
    expect(albumKindOf(img(1))).toBe("image");
    expect(albumKindOf(img(1, { contentType: "video" }))).toBe("video");
    expect(albumKindOf(img(1, { groupId: undefined }))).toBeNull();
    expect(albumKindOf(img(1, { contentType: "text" }))).toBeNull();
  });
});

describe("createAlbumTracker", () => {
  it("同相册逐条累加，第一张 count=1", () => {
    const tr = createAlbumTracker();
    const counts = [1, 2, 3].map((s) => tr.note(img(s), 1000)!.count);
    expect(counts).toEqual([1, 2, 3]);
  });

  it("重投的同一条不重复计；不同相册 / 不同会话互不影响", () => {
    const tr = createAlbumTracker();
    tr.note(img(1), 0);
    expect(tr.note(img(1), 0)!.count).toBe(1);
    expect(tr.note(img(2, { groupId: "alb2" }), 0)!.count).toBe(1);
    expect(tr.note(img(2, { convId: "g_2" }), 0)!.count).toBe(1);
  });

  it("图与视频混合 → mixed；非相册消息返回 null", () => {
    const tr = createAlbumTracker();
    tr.note(img(1), 0);
    expect(tr.note(img(2, { contentType: "video" }), 0)!.kind).toBe("mixed");
    expect(tr.note(img(3, { groupId: undefined }), 0)).toBeNull();
  });

  it("过了保质期再来的同 groupId 当新相册", () => {
    const tr = createAlbumTracker();
    tr.note(img(1), 0);
    expect(tr.note(img(2), ALBUM_TTL_MS + 1)!.count).toBe(1);
  });
});

describe("albumBody", () => {
  it("按类型选文案并带张数", () => {
    expect(albumBody("image", 9)).toBe(t("preview.album_images", { count: 9 }));
    expect(albumBody("video", 3)).toBe(t("preview.album_videos", { count: 3 }));
    expect(albumBody("mixed", 4)).toBe(t("preview.album_media", { count: 4 }));
    expect(albumBody("image", 9)).toContain("9");
  });
});
