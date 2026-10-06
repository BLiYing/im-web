// 相册聚簇纯函数单测（M4+）。
import { describe, expect, it } from "vitest";
import { albumMembers, albumRowPattern, albumTickState, isAlbumLeader, isAlbumMember, isViewableMedia, msgKey, resolveJumpTarget } from "./album";
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

  describe("msgKey（查看器翻页定位标识，任务3 回归）", () => {
    it("优先用 convSeq（会话内唯一）", () => {
      expect(msgKey(msg({ convSeq: 81 }))).toBe("s81");
      expect(msgKey(msg({ convSeq: 81 }))).not.toBe(msgKey(msg({ convSeq: 80 })));
    });
    it("本地待发件 convSeq=0 才回退 clientMsgId", () => {
      expect(msgKey(msg({ convSeq: 0, clientMsgId: "outbox-x" }))).toBe("coutbox-x");
    });
    it("回归：入站消息 clientMsgId 全为 undefined，仍能靠 convSeq 各自唯一定位（修复点最后一张却跳到最前）", () => {
      // 模拟 imSdk.processIncoming 产出的入站媒体：均无 clientMsgId，仅 convSeq 递增。
      const list = [msg({ convSeq: 78 }), msg({ convSeq: 80 }), msg({ convSeq: 81, contentType: "image" })];
      const last = list[2]; // 最后一张照片
      const idx = list.findIndex((m) => msgKey(m) === msgKey(last));
      expect(idx).toBe(2); // 精确定位到末尾（旧实现用 clientMsgId 会误判为 0）
      // 反证旧实现的坑：clientMsgId 全 undefined → 一律命中第 0 条。
      const badIdx = list.findIndex((m) => m.clientMsgId === last.clientMsgId);
      expect(badIdx).toBe(0);
    });
    it("React key 契约：混合列表（文本/文件/入站媒体，均无 clientMsgId）每条 key 唯一，永不塌成同一值", () => {
      // 4 处渲染站点（列表/相册/系统行/详情）都改用 msgKey——旧实现 `clientMsgId ?? serverMsgId ?? i`
      // 对入站消息退化到数组下标 i，向上翻页 prepend 时下标平移→React 错绑 DOM。此测断言身份稳定不塌。
      const list = [
        msg({ convSeq: 78, contentType: "text", content: "hi" }),
        msg({ convSeq: 79, contentType: "file", content: "/uploads/a.pdf" }),
        msg({ convSeq: 80, contentType: "image" }),
        msg({ convSeq: 81, contentType: "video" }),
      ];
      const keys = list.map(msgKey);
      expect(new Set(keys).size).toBe(list.length); // 全唯一
      expect(keys).toEqual(["s78", "s79", "s80", "s81"]);
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

  describe("resolveJumpTarget（定位到聊天位置：相册高亮那一格，任务3 回归）", () => {
    const list = [
      msg({ convSeq: 10, content: "hi", contentType: "text" }), // 普通文本
      msg({ groupId: "g1", convSeq: 20 }),                       // 相册 leader
      msg({ groupId: "g1", convSeq: 21 }),                       // 相册非 leader 成员
      msg({ groupId: "g1", convSeq: 22, contentType: "video" }),// 相册非 leader 成员（视频）
      msg({ convSeq: 30 }),                                      // 单张图片（无 groupId）
    ];

    it("非相册消息 → 定位消息行本身", () => {
      expect(resolveJumpTarget(list, 10)).toEqual({ kind: "message", seq: 10 });
      expect(resolveJumpTarget(list, 30)).toEqual({ kind: "message", seq: 30 });
    });

    it("相册 leader → 高亮该格 tile，leaderSeq 指向自己", () => {
      expect(resolveJumpTarget(list, 20)).toEqual({ kind: "album-tile", seq: 20, leaderSeq: 20 });
    });

    it("相册非 leader 成员 → 高亮各自的格子，回退主行=leader（20），修复只闪整条主行", () => {
      expect(resolveJumpTarget(list, 21)).toEqual({ kind: "album-tile", seq: 21, leaderSeq: 20 });
      expect(resolveJumpTarget(list, 22)).toEqual({ kind: "album-tile", seq: 22, leaderSeq: 20 });
    });

    it("撤回的 leader 退组后：leaderSeq 落到剩余首个成员，而非已退出的撤回件", () => {
      const withRecalled = [
        msg({ groupId: "g2", convSeq: 40, recalledAt: 99 }), // 撤回 → 退出宫格
        msg({ groupId: "g2", convSeq: 41 }),
        msg({ groupId: "g2", convSeq: 42 }),
      ];
      expect(resolveJumpTarget(withRecalled, 42)).toEqual({ kind: "album-tile", seq: 42, leaderSeq: 41 });
    });

    it("目标 seq 不在列表（已删/未加载）：无 groupId 可判 → 按普通消息行处理，交上层跨窗口定位", () => {
      expect(resolveJumpTarget(list, 999)).toEqual({ kind: "message", seq: 999 });
    });
  });

  it("行模式总块数等于成员数（1..9）", () => {
    for (let n = 1; n <= 9; n++) {
      const total = albumRowPattern(n).reduce((a, b) => a + b, 0);
      expect(total).toBe(n);
    }
  });
});

describe("albumTickState（READ_TICK_DESIGN §4）", () => {
  const mk = (seqs: number[], over: Partial<ChatMessage> = {}) =>
    seqs.map((s) => msg({ groupId: "g", convSeq: s, from: "me", status: "sent", ...over }));
  it("对方的相册 / 空组 → none", () => {
    expect(albumTickState(mk([1, 2]), false, 9)).toBe("none");
    expect(albumTickState([], true, 9)).toBe("none");
  });
  it("任一失败 → none（优先于发送中）", () => {
    const ms = [...mk([1]), msg({ groupId: "g", convSeq: 0, status: "failed" }), msg({ groupId: "g", convSeq: 0, status: "sending" })];
    expect(albumTickState(ms, true, 9)).toBe("none");
  });
  it("仍有未发出成员 → sending", () => {
    expect(albumTickState([...mk([1]), msg({ groupId: "g", convSeq: 0, status: "sending" })], true, 9)).toBe("sending");
    expect(albumTickState(mk([0]), true, 9)).toBe("sending");
  });
  it("全部发出：看末条 convSeq 与已读位点（首条已读但末条未读 → 仍单勾）", () => {
    expect(albumTickState(mk([5, 6, 7]), true, 6)).toBe("sent");
    expect(albumTickState(mk([5, 6, 7]), true, 7)).toBe("read");
    expect(albumTickState(mk([5, 6, 7]), true, 0)).toBe("sent");
  });
  it("重载同步回来的自己的消息（status=received，convSeq>0）按已发出处理", () => {
    expect(albumTickState(mk([5, 6], { status: "received" }), true, 6)).toBe("read");
  });
  it("hidden（超级群）已发出 → none，但发送中仍显「…」", () => {
    expect(albumTickState(mk([5, 6]), true, 9, true)).toBe("none");
    expect(albumTickState(mk([0]), true, 9, true)).toBe("sending");
  });
});
