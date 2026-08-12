// 相册聚簇纯函数单测（M4+）。
import { describe, expect, it } from "vitest";
import { albumMembers, albumRowPattern, isAlbumLeader, isAlbumMember, isViewableMedia, mediaIdentity } from "./album";
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

  it("可查看媒体判定：图片/视频·未撤回，含单张（不要求 groupId，任务3 查看器/媒体库口径）", () => {
    expect(isViewableMedia(msg({}))).toBe(true);                         // 单张图片：无 groupId 也算
    expect(isViewableMedia(msg({ contentType: "video" }))).toBe(true);
    expect(isViewableMedia(msg({ groupId: "g1" }))).toBe(true);          // 相册成员也算
    expect(isViewableMedia(msg({ contentType: "text" }))).toBe(false);
    expect(isViewableMedia(msg({ contentType: "file" }))).toBe(false);
    expect(isViewableMedia(msg({ recalledAt: 1 }))).toBe(false);         // 撤回不可看
  });

  describe("mediaIdentity（查看器翻页定位标识，任务3 回归）", () => {
    it("优先用 convSeq（会话内唯一）", () => {
      expect(mediaIdentity(msg({ convSeq: 81 }))).toBe("s81");
      expect(mediaIdentity(msg({ convSeq: 81 }))).not.toBe(mediaIdentity(msg({ convSeq: 80 })));
    });
    it("本地待发件 convSeq=0 才回退 clientMsgId", () => {
      expect(mediaIdentity(msg({ convSeq: 0, clientMsgId: "outbox-x" }))).toBe("coutbox-x");
    });
    it("回归：入站消息 clientMsgId 全为 undefined，仍能靠 convSeq 各自唯一定位（修复点最后一张却跳到最前）", () => {
      // 模拟 imSdk.processIncoming 产出的入站媒体：均无 clientMsgId，仅 convSeq 递增。
      const list = [msg({ convSeq: 78 }), msg({ convSeq: 80 }), msg({ convSeq: 81, contentType: "image" })];
      const last = list[2]; // 最后一张照片
      const idx = list.findIndex((m) => mediaIdentity(m) === mediaIdentity(last));
      expect(idx).toBe(2); // 精确定位到末尾（旧实现用 clientMsgId 会误判为 0）
      // 反证旧实现的坑：clientMsgId 全 undefined → 一律命中第 0 条。
      const badIdx = list.findIndex((m) => m.clientMsgId === last.clientMsgId);
      expect(badIdx).toBe(0);
    });
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
