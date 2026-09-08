// 角标与「要不要弹通知」的护栏。这两条判错不会崩、不会报错，只会**骚扰用户**或**漏掉消息**，
// 属于典型的「没人会在开发时发现」，所以逐条钉住。
import { describe, expect, it } from "vitest";
import { badgeCountOf, notifyBodyOf, shouldNotify, type NotifyContext } from "./desktopNotify";
import type { ChatMessage, Conversation } from "./sdk/protocol";

const conv = (over: Partial<Conversation>): Conversation =>
  ({ conv_id: "c1", peer: "u2", unread: 0, ...over } as Conversation);

const msg = (over: Partial<ChatMessage>): ChatMessage =>
  ({ convId: "c1", from: "u2", content: "hi", contentType: "text", ...over } as ChatMessage);

const ctx = (over: Partial<NotifyContext> = {}): NotifyContext => ({
  selfUid: "me", currentConvId: "", windowFocused: false, muted: false, mentionsMe: false, ...over,
});

describe("badgeCountOf", () => {
  it("普通会话按未读条数累加", () => {
    expect(badgeCountOf([conv({ unread: 3 }), conv({ unread: 2 })])).toBe(5);
  });

  it("**免打扰不计入**——否则用户得为了消红点去点开他明确说不想被打扰的会话", () => {
    expect(badgeCountOf([conv({ unread: 3 }), conv({ unread: 99, muted: true })])).toBe(3);
  });

  it("免打扰里 @我 计 1（不放大成条数）——免打扰是「别为每条烦我」，不是「@我也别说」", () => {
    expect(badgeCountOf([conv({ unread: 99, muted: true, mention_unread: true })])).toBe(1);
  });

  it("空列表 / 未读缺失 → 0，不产出 NaN", () => {
    expect(badgeCountOf([])).toBe(0);
    expect(badgeCountOf([conv({ unread: undefined as unknown as number })])).toBe(0);
  });
});

describe("shouldNotify", () => {
  it("窗口在后台、非自己发的普通消息 → 通知", () => {
    expect(shouldNotify(msg({}), ctx())).toBe(true);
  });

  it("**自己发的不通知**（多端抄送会把自己的消息推回来）", () => {
    expect(shouldNotify(msg({ from: "me" }), ctx())).toBe(false);
  });

  it("窗口在前台 → 不通知，消息本来就在眼前", () => {
    expect(shouldNotify(msg({}), ctx({ windowFocused: true }))).toBe(false);
  });

  it("正看着这个会话 → 不通知", () => {
    expect(shouldNotify(msg({ convId: "c1" }), ctx({ windowFocused: true, currentConvId: "c1" }))).toBe(false);
  });

  it("免打扰 → 不通知", () => {
    expect(shouldNotify(msg({}), ctx({ muted: true }))).toBe(false);
  });

  it("免打扰但 @我 → 通知（唯一穿透）", () => {
    expect(shouldNotify(msg({}), ctx({ muted: true, mentionsMe: true }))).toBe(true);
  });

  it("**免打扰会话里自己发的消息不能被 mention 分支救回来**——排除顺序不能反", () => {
    expect(shouldNotify(msg({ from: "me" }), ctx({ muted: true, mentionsMe: true }))).toBe(false);
  });

  it("**群系统消息不通知**——它渲染成居中系统行，且正文会落成「[消息]」，大群里这类事件很密", () => {
    expect(shouldNotify(msg({ contentType: "system", content: "张三 加入了群聊" }), ctx())).toBe(false);
  });

  it("已撤回的不通知（同步时可能带着撤回标记过来）", () => {
    expect(shouldNotify(msg({ recalledAt: Date.now() }), ctx())).toBe(false);
  });

  it("没有 convId 的畸形消息 → 不通知（点了也不知道该开哪个会话）", () => {
    expect(shouldNotify(msg({ convId: "" }), ctx())).toBe(false);
  });
});

describe("notifyBodyOf", () => {
  it("文本直接显，长文截断", () => {
    expect(notifyBodyOf(msg({ content: "你好" }))).toBe("你好");
    expect(notifyBodyOf(msg({ content: "x".repeat(300) })).length).toBe(120);
  });

  it("**媒体消息不能把 URL 显出来**——content 是 /uploads/xxx，显出来就是一串路径", () => {
    expect(notifyBodyOf(msg({ contentType: "image", content: "/uploads/a.jpg" }))).toBe("[图片]");
    expect(notifyBodyOf(msg({ contentType: "voice", content: "/uploads/a.m4a" }))).toBe("[语音]");
  });

  it("有图说时优先显图说（比「[图片]」有信息量）", () => {
    expect(notifyBodyOf(msg({ contentType: "image", content: "/uploads/a.jpg", caption: "看这个" }))).toBe("看这个");
  });

  it("文件显文件名", () => {
    expect(notifyBodyOf(msg({ contentType: "file", content: "/uploads/x", fileName: "报告.pdf" }))).toBe("[文件] 报告.pdf");
  });
});
