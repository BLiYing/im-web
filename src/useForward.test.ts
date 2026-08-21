// @vitest-environment jsdom
// useForward（阶段 6 抽出）：目标上限、逐条/合并转发编排、执行后收尾、多选批量转发。
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useForward, MAX_FORWARD_TARGETS, type ForwardDeps } from "./useForward";
import type { ChatMessage, Conversation } from "./sdk/protocol";
import type { IMClient } from "./sdk/imSdk";

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({ convId: "c1", from: "u2", fromNickname: "小明", content: "你好", contentType: "text", convSeq: 1, timestamp: 1, status: "sent", ...over } as ChatMessage);
const conv = (over: Partial<Conversation> = {}): Conversation => ({ conv_id: "u_u1_u_u3", peer: "u3", peer_nickname: "老王", latest_conv_seq: 0, unread: 0, read_seq: 0, peer_read_seq: 0, ...over } as Conversation);
function mount(over: Partial<ForwardDeps> = {}) {
  const client = { sendText: vi.fn(() => "cm-t"), sendMedia: vi.fn(() => "cm-m") };
  const deps: ForwardDeps = {
    uid: "u1", peer: "u2", groupConvId: "", clientRef: { current: client as unknown as IMClient }, setToast: vi.fn(),
    appendMsg: vi.fn(), msgsByConv: {}, groupInfos: {}, selected: new Set(), setMenu: vi.fn(), exitSelectMode: vi.fn(), ...over,
  };
  return { ...renderHook(() => useForward(deps)), deps, client };
}

describe("useForward", () => {
  it("多选目标上限 MAX_FORWARD_TARGETS：超限 toast 且不加入", () => {
    const { result, deps } = mount();
    for (let i = 0; i < MAX_FORWARD_TARGETS; i++) act(() => result.current.toggleForwardTarget(`c${i}`));
    expect(result.current.forwardTargets).toHaveLength(MAX_FORWARD_TARGETS);
    act(() => result.current.toggleForwardTarget("overflow"));
    expect(result.current.forwardTargets).toHaveLength(MAX_FORWARD_TARGETS);
    expect(deps.setToast).toHaveBeenCalledWith(`最多选择 ${MAX_FORWARD_TARGETS} 个会话`);
  });
  it("逐条：forwardMessage 打开选择器 → sendForwardToTarget 走 sendText(带 forwardFrom) + 乐观 appendMsg", () => {
    const { result, deps, client } = mount();
    act(() => result.current.forwardMessage(msg()));
    expect(deps.setMenu).toHaveBeenCalledWith(null);
    expect(result.current.forwarding).toHaveLength(1);
    act(() => result.current.sendForwardToTarget(conv()));
    expect(client.sendText).toHaveBeenCalledWith("你好", "u3", "u_u1_u_u3", { forwardFrom: "小明" });
    expect(deps.appendMsg).toHaveBeenCalledWith("u_u1_u_u3", expect.objectContaining({ clientMsgId: "cm-t", content: "你好", status: "sending", forwardFrom: "小明" }));
  });
  it("合并：mode=merged → 打包 chat_record 一条 sendMedia", () => {
    const { result, client } = mount();
    act(() => { result.current.setForwardMode("merged"); result.current.setForwarding([msg({ convSeq: 1 }), msg({ convSeq: 2, content: "在吗" })]); });
    act(() => result.current.sendForwardToTarget(conv()));
    expect(client.sendMedia).toHaveBeenCalledTimes(1);
    const [json, ct] = (client.sendMedia as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ct).toBe("chat_record");
    expect(JSON.parse(json as string).items).toHaveLength(2);
  });
  it("doForwardToTargets：发出后关闭选择器、退出多选、单条 toast", () => {
    const { result, deps } = mount();
    act(() => result.current.forwardMessage(msg()));
    act(() => result.current.doForwardToTargets([conv()]));
    expect(result.current.forwarding).toBeNull();
    expect(deps.exitSelectMode).toHaveBeenCalled();
    expect(deps.setToast).toHaveBeenCalledWith("已转发到 老王");
  });
  it("forwardSelected：按 selected 收集当前会话已确认消息（排除撤回）打开选择器", () => {
    const list = [msg({ convSeq: 1 }), msg({ convSeq: 2, recalledAt: 1 }), msg({ convSeq: 3 })];
    const { result } = mount({ msgsByConv: { u_u1_u_u2: list }, selected: new Set([1, 2, 3]) });
    act(() => result.current.forwardSelected());
    expect(result.current.forwarding?.map((m) => m.convSeq)).toEqual([1, 3]);
    expect(result.current.forwardMode).toBe("each");
  });
});
