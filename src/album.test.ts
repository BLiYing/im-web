// 相册聚簇纯函数单测（M4+）。
import { describe, expect, it } from "vitest";
import { albumMembers, albumRowPattern, isAlbumLeader, isAlbumMember } from "./album";
import type { ChatMessage } from "./sdk/protocol";

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  convId: "c", from: "u", content: "/uploads/x.jpg", contentType: "image",
  convSeq: 0, timestamp: 0, status: "received", ...over,
});

describe("album clustering", () => {
  it("成员判定：需要 groupId + 图片/视频 + 未撤回", () => {
    expect(isAlbumMember(msg({ groupId: "g1" }))).toBe(true);
    expect(isAlbumMember(msg({ groupId: "g1", contentType: "video" }))).toBe(true);
    expect(isAlbumMember(msg({}))).toBe(false); // 无 groupId
    expect(isAlbumMember(msg({ groupId: "g1", contentType: "text" }))).toBe(false);
    expect(isAlbumMember(msg({ groupId: "g1", recalledAt: 1 }))).toBe(false); // 撤回退出宫格
  });

  it("主行=组内首个成员；中间夹其他消息不影响聚簇", () => {
    const list = [
      msg({ groupId: "g1", convSeq: 1 }),
      msg({ contentType: "text", content: "hi", convSeq: 2 }),
      msg({ groupId: "g1", convSeq: 3 }),
      msg({ groupId: "g2", convSeq: 4 }),
    ];
    expect(isAlbumLeader(list, 0)).toBe(true);
    expect(isAlbumLeader(list, 1)).toBe(false); // 非成员
    expect(isAlbumLeader(list, 2)).toBe(false); // g1 从行
    expect(isAlbumLeader(list, 3)).toBe(true);  // g2 自成一组
    expect(albumMembers(list, "g1")).toHaveLength(2);
  });

  it("撤回的成员退出宫格：剩 1 个成员时它成为主行", () => {
    const list = [
      msg({ groupId: "g1", convSeq: 1, recalledAt: 99 }),
      msg({ groupId: "g1", convSeq: 2 }),
    ];
    expect(isAlbumLeader(list, 0)).toBe(false);
    expect(isAlbumLeader(list, 1)).toBe(true);
    expect(albumMembers(list, "g1")).toHaveLength(1);
  });

  it("行模式总块数等于成员数（1..9）", () => {
    for (let n = 1; n <= 9; n++) {
      const total = albumRowPattern(n).reduce((a, b) => a + b, 0);
      expect(total).toBe(n);
    }
  });
});
