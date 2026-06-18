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
  copy: vi.fn(), delete: vi.fn(), reportMsg: vi.fn(), reportUser: vi.fn(), comingSoon: vi.fn(),
};
const convHandlers = { markRead: vi.fn(), delete: vi.fn(), comingSoon: vi.fn() };

const visibleIds = <C>(actions: { id: string; visible: (c: C) => boolean }[], ctx: C) =>
  actions.filter((a) => a.visible(ctx)).map((a) => a.id);

describe("buildMessageActions", () => {
  it("返回固定顺序的全部 id", () => {
    const ids = buildMessageActions(msgHandlers).map((a) => a.id);
    expect(ids).toEqual([
      "copy", "reply", "forward", "favorite", "recall",
      "multiSelect", "translate", "reportMsg", "reportUser", "delete",
    ]);
  });

  it("撤回仅在 m.from===uid && convSeq>0 时可见", () => {
    const actions = buildMessageActions(msgHandlers);
    const find = (ctx: MessageCtx) => actions.find((a) => a.id === "recall")!.visible(ctx);
    expect(find({ m: msg({ from: "1001", convSeq: 5 }), uid: "1001" })).toBe(true);  // 我发的、已落库
    expect(find({ m: msg({ from: "2002", convSeq: 5 }), uid: "1001" })).toBe(false); // 对方发的
    expect(find({ m: msg({ from: "1001", convSeq: 0 }), uid: "1001" })).toBe(false); // 我发的、未落库
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

  it("run 路由到真实处理器 / comingSoon", () => {
    const actions = buildMessageActions(msgHandlers);
    const ctx: MessageCtx = { m: msg({}), uid: "1001" };
    actions.find((a) => a.id === "copy")!.run(ctx);
    expect(msgHandlers.copy).toHaveBeenCalledWith(ctx.m);
    actions.find((a) => a.id === "reply")!.run(ctx);
    expect(msgHandlers.comingSoon).toHaveBeenCalledWith("引用");
  });
});

describe("buildConversationActions", () => {
  it("返回固定顺序的全部 id", () => {
    expect(buildConversationActions(convHandlers).map((a) => a.id)).toEqual([
      "pin", "mute", "markRead", "delete",
    ]);
  });

  it("设为已读仅在 unread>0 时可见", () => {
    const actions = buildConversationActions(convHandlers);
    const find = (ctx: ConvCtx) => actions.find((a) => a.id === "markRead")!.visible(ctx);
    expect(find({ c: conv({ unread: 3 }) })).toBe(true);
    expect(find({ c: conv({ unread: 0 }) })).toBe(false);
  });
});
