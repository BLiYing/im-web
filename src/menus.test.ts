import { describe, it, expect, vi } from "vitest";
import { buildMessageActions, buildConversationActions, type MessageCtx, type ConvCtx } from "./menus";
import type { ChatMessage, Conversation } from "./sdk/protocol";

// 纯注册表测试（node 环境，无 DOM）：只验证 visible 谓词与顺序，不渲染 React。
function msg(over: Partial<ChatMessage>): ChatMessage {
  return {
    convId: "u_1001_u_2002", from: "2002", content: "hi", contentType: "text",
    convSeq: 5, timestamp: 1, status: "received", ...over,
  };
}

function conv(over: Partial<Conversation>): Conversation {
  return {
    conv_id: "u_1001_u_2002", peer: "2002", last_message: null,
    latest_conv_seq: 10, unread: 0, read_seq: 0, peer_read_seq: 0, ...over,
  };
}

const msgHandlers = {
  copy: vi.fn(), reply: vi.fn(), forward: vi.fn(), favorite: vi.fn(), download: vi.fn(), edit: vi.fn(), translate: vi.fn(), multiSelect: vi.fn(), recall: vi.fn(), delete: vi.fn(), reportMsg: vi.fn(), reportUser: vi.fn(), cancelSend: vi.fn(), comingSoon: vi.fn(),
};
const convHandlers = { setPinned: vi.fn(), setMuted: vi.fn(), markRead: vi.fn(), markUnread: vi.fn(), delete: vi.fn() };

const visibleIds = <C>(actions: { id: string; visible: (c: C) => boolean }[], ctx: C) =>
  actions.filter((a) => a.visible(ctx)).map((a) => a.id);

describe("buildMessageActions", () => {
  it("返回固定顺序的全部 id", () => {
    const ids = buildMessageActions(msgHandlers).map((a) => a.id);
    expect(ids).toEqual([
      "copy", "reply", "forward", "favorite", "download", "recall", "edit",
      "multiSelect", "translate", "reportMsg", "reportUser", "cancelSend", "delete",
    ]);
  });

  it("撤回仅在 本人 && 已落库 && 未撤回 && 2min 窗口内 可见", () => {
    const actions = buildMessageActions(msgHandlers);
    const find = (ctx: MessageCtx) => actions.find((a) => a.id === "recall")!.visible(ctx);
    const now = Date.now();
    expect(find({ m: msg({ from: "1001", convSeq: 5, timestamp: now }), uid: "1001" })).toBe(true);  // 我发的、刚发
    expect(find({ m: msg({ from: "2002", convSeq: 5, timestamp: now }), uid: "1001" })).toBe(false); // 对方发的
    expect(find({ m: msg({ from: "1001", convSeq: 0, timestamp: now }), uid: "1001" })).toBe(false); // 未落库
    expect(find({ m: msg({ from: "1001", convSeq: 5, timestamp: now - 3 * 60 * 1000 }), uid: "1001" })).toBe(false); // 超 2min
    expect(find({ m: msg({ from: "1001", convSeq: 5, timestamp: now, recalledAt: now }), uid: "1001" })).toBe(false); // 已撤回
  });

  it("举报项仅对对方消息可见；删除/复制对自己消息也可见", () => {
    const mine = { m: msg({ from: "1001", convSeq: 5 }), uid: "1001" };
    const theirs = { m: msg({ from: "2002", convSeq: 5 }), uid: "1001" };
    expect(visibleIds(buildMessageActions(msgHandlers), mine)).not.toContain("reportMsg");
    expect(visibleIds(buildMessageActions(msgHandlers), mine)).not.toContain("reportUser");
    expect(visibleIds(buildMessageActions(msgHandlers), theirs)).toContain("reportMsg");
    expect(visibleIds(buildMessageActions(msgHandlers), theirs)).toContain("reportUser");
    expect(visibleIds(buildMessageActions(msgHandlers), mine)).toContain("delete");
    expect(visibleIds(buildMessageActions(msgHandlers), mine)).toContain("copy");
  });

  it("收藏仅在已落库(convSeq>0)时可见：未发出的乐观行 content 是本地 blob:，收藏会存成死链", () => {
    const actions = buildMessageActions(msgHandlers);
    const find = (ctx: MessageCtx) => actions.find((a) => a.id === "favorite")!.visible(ctx);
    expect(find({ m: msg({ convSeq: 5, content: "/uploads/x.jpg", contentType: "image" }), uid: "1001" })).toBe(true);
    expect(find({ m: msg({ convSeq: 0, content: "blob:http://x", contentType: "image" }), uid: "1001" })).toBe(false); // 上传中乐观行
    expect(find({ m: msg({ convSeq: 5, content: "", contentType: "text" }), uid: "1001" })).toBe(false);              // 空内容
    expect(find({ m: msg({ convSeq: 5, content: "hi", contentType: "system" }), uid: "1001" })).toBe(false);          // 系统消息
  });

  it("取消发送仅在 本人 && 未发出(convSeq=0) && sending|failed && 媒体/文件 时可见", () => {
    const actions = buildMessageActions(msgHandlers);
    const find = (ctx: MessageCtx) => actions.find((a) => a.id === "cancelSend")!.visible(ctx);
    expect(find({ m: msg({ from: "1001", convSeq: 0, status: "sending", contentType: "video" }), uid: "1001" })).toBe(true);
    expect(find({ m: msg({ from: "1001", convSeq: 0, status: "failed", contentType: "file" }), uid: "1001" })).toBe(true);
    expect(find({ m: msg({ from: "1001", convSeq: 0, status: "sending", contentType: "text" }), uid: "1001" })).toBe(false);  // 文本无上传可取消
    expect(find({ m: msg({ from: "1001", convSeq: 5, status: "sending", contentType: "image" }), uid: "1001" })).toBe(false); // 已发出→走撤回
    expect(find({ m: msg({ from: "2002", convSeq: 0, status: "sending", contentType: "image" }), uid: "1001" })).toBe(false); // 非本人
  });

  it("删除对 发送中且未落库(convSeq=0) 的本地件隐藏（要撤走用取消发送，防僵尸上传）", () => {
    const actions = buildMessageActions(msgHandlers);
    const find = (ctx: MessageCtx) => actions.find((a) => a.id === "delete")!.visible(ctx);
    expect(find({ m: msg({ from: "1001", convSeq: 0, status: "sending", contentType: "file" }), uid: "1001" })).toBe(false);
    expect(find({ m: msg({ from: "1001", convSeq: 0, status: "failed", contentType: "file" }), uid: "1001" })).toBe(true); // 失败行可删
    expect(find({ m: msg({ convSeq: 5, status: "received" }), uid: "1001" })).toBe(true);
  });

  it("多选对 撤回墓碑/未落库(convSeq=0) 隐藏", () => {
    const actions = buildMessageActions(msgHandlers);
    const find = (ctx: MessageCtx) => actions.find((a) => a.id === "multiSelect")!.visible(ctx);
    expect(find({ m: msg({ convSeq: 5, recalledAt: 1 }), uid: "1001" })).toBe(false);
    expect(find({ m: msg({ convSeq: 0, status: "sending" }), uid: "1001" })).toBe(false);
    expect(find({ m: msg({ convSeq: 5 }), uid: "1001" })).toBe(true);
  });

  it("run 路由到真实处理器 / comingSoon", () => {
    const actions = buildMessageActions(msgHandlers);
    const ctx: MessageCtx = { m: msg({}), uid: "1001" };
    actions.find((a) => a.id === "copy")!.run(ctx);
    expect(msgHandlers.copy).toHaveBeenCalledWith(ctx.m);
    actions.find((a) => a.id === "reply")!.run(ctx);
    expect(msgHandlers.reply).toHaveBeenCalledWith(ctx.m);
  });
});

describe("buildConversationActions", () => {
  it("返回固定顺序的全部 id（置顶/免打扰/已读未读为切换对）", () => {
    expect(buildConversationActions(convHandlers).map((a) => a.id)).toEqual([
      "pin", "unpin", "mute", "unmute", "markRead", "markUnread", "delete",
    ]);
  });

  it("置顶↔取消置顶按 pinned_at 互斥可见", () => {
    const actions = buildConversationActions(convHandlers);
    expect(visibleIds(actions, { c: conv({ pinned_at: 0 }) })).toContain("pin");
    expect(visibleIds(actions, { c: conv({ pinned_at: 0 }) })).not.toContain("unpin");
    expect(visibleIds(actions, { c: conv({ pinned_at: 123 }) })).toContain("unpin");
    expect(visibleIds(actions, { c: conv({ pinned_at: 123 }) })).not.toContain("pin");
  });

  it("静音↔取消静音按 muted 互斥可见", () => {
    const actions = buildConversationActions(convHandlers);
    expect(visibleIds(actions, { c: conv({ muted: false }) })).toContain("mute");
    expect(visibleIds(actions, { c: conv({ muted: true }) })).toContain("unmute");
    expect(visibleIds(actions, { c: conv({ muted: true }) })).not.toContain("mute");
  });

  it("设为已读在 有未读 或 手动标未读 时可见；标为未读在 已读态 可见", () => {
    const actions = buildConversationActions(convHandlers);
    const vis = (ctx: ConvCtx, id: string) => actions.find((a) => a.id === id)!.visible(ctx);
    expect(vis({ c: conv({ unread: 3 }) }, "markRead")).toBe(true);
    expect(vis({ c: conv({ unread: 0, marked_unread: true }) }, "markRead")).toBe(true);
    expect(vis({ c: conv({ unread: 0, marked_unread: false }) }, "markRead")).toBe(false);
    expect(vis({ c: conv({ unread: 0, marked_unread: false }) }, "markUnread")).toBe(true);
    expect(vis({ c: conv({ unread: 3 }) }, "markUnread")).toBe(false);
    expect(vis({ c: conv({ unread: 0, marked_unread: true }) }, "markUnread")).toBe(false);
  });

  it("run 路由到真实处理器（切换传入目标状态）", () => {
    const actions = buildConversationActions(convHandlers);
    const c0 = conv({ pinned_at: 0, muted: false });
    actions.find((a) => a.id === "pin")!.run({ c: c0 });
    expect(convHandlers.setPinned).toHaveBeenCalledWith(c0, true);
    actions.find((a) => a.id === "mute")!.run({ c: c0 });
    expect(convHandlers.setMuted).toHaveBeenCalledWith(c0, true);
    actions.find((a) => a.id === "delete")!.run({ c: c0 });
    expect(convHandlers.delete).toHaveBeenCalledWith(c0);
  });
});
