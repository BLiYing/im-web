// @vitest-environment jsdom
// useForward（阶段 6 抽出）：目标上限、逐条/合并转发编排、执行后收尾、多选批量转发。
import { describe, it, expect, vi , afterEach } from "vitest";
import { renderHook, act , cleanup } from "@testing-library/react";
import { fakeClientRef } from "./testing/fakeIMClient";
import { useForward, MAX_FORWARD_TARGETS, type ForwardDeps } from "./useForward";
import type { ChatMessage, Conversation } from "./sdk/protocol";
afterEach(cleanup); // 多次 renderHook：卸载前一用例（CODING_STYLE §八）

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({ convId: "c1", from: "u2", fromNickname: "小明", content: "你好", contentType: "text", convSeq: 1, timestamp: 1, status: "sent", ...over } as ChatMessage);
const conv = (over: Partial<Conversation> = {}): Conversation => ({ conv_id: "u_u1_u_u3", peer: "u3", peer_nickname: "老王", latest_conv_seq: 0, unread: 0, read_seq: 0, peer_read_seq: 0, ...over } as Conversation);
function mount(over: Partial<ForwardDeps> = {}) {
  const client = { sendText: vi.fn(() => "cm-t"), sendMedia: vi.fn(() => "cm-m") };
  const deps: ForwardDeps = {
    uid: "u1", peer: "u2", groupConvId: "", clientRef: fakeClientRef(client), setToast: vi.fn(),
    appendMsg: vi.fn(), msgsByConv: {}, groupInfos: {}, recordSenderAvatar: () => undefined,
    peerPublicName: "小明", myPublicName: "我自己", myUsername: "myhandle",
    selected: new Set(), setMenu: vi.fn(), exitSelectMode: vi.fn(), ...over,
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
  it("合并：条目带 ts/u/a（读端据此显时间、判连续同一人、查头像）", () => {
    const { result, client } = mount({ recordSenderAvatar: () => "/avatars/ab.jpg" });
    act(() => { result.current.setForwardMode("merged"); result.current.setForwarding([msg({ convSeq: 1, timestamp: 1700, from: "u2" })]); });
    act(() => result.current.sendForwardToTarget(conv()));
    const [json] = (client.sendMedia as ReturnType<typeof vi.fn>).mock.calls[0];
    // u 是**卡片内匿名序号**（s1/s2…），不是真 uid——真 uid 发给群外收件人会绕过
    // GET /users/{id} 的「不可枚举」防线（见 buildRecordSenderKeys）。
    expect(JSON.parse(json as string).items[0]).toMatchObject({ ts: 1700, u: "s1", a: "/avatars/ab.jpg" });
  });
  it("合并：取不到头像时不带 a（读端按 uid 兜底），其余字段照常", () => {
    const { result, client } = mount({ recordSenderAvatar: () => undefined });
    act(() => { result.current.setForwardMode("merged"); result.current.setForwarding([msg({ convSeq: 1, timestamp: 1700, from: "u2" })]); });
    act(() => result.current.sendForwardToTarget(conv()));
    const [json] = (client.sendMedia as ReturnType<typeof vi.fn>).mock.calls[0];
    const item = JSON.parse(json as string).items[0];
    expect(item).toMatchObject({ ts: 1700, u: "s1" });
    expect(item).not.toHaveProperty("a");
  });
  it("合并：u 是卡片内匿名序号，真 uid 绝不出现在 JSON 里（同一人复用同一个键）", () => {
    const { result, client } = mount();
    act(() => {
      result.current.setForwardMode("merged");
      result.current.setForwarding([
        msg({ convSeq: 1, from: "4827391056" }),
        msg({ convSeq: 2, from: "9173628401" }),
        msg({ convSeq: 3, from: "4827391056" }),
      ]);
    });
    act(() => result.current.sendForwardToTarget(conv()));
    const [json] = (client.sendMedia as ReturnType<typeof vi.fn>).mock.calls[0];
    const items = JSON.parse(json as string).items;
    expect(items.map((i: { u: string }) => i.u)).toEqual(["s1", "s2", "s1"]); // 判「连续同一人」照常可用
    expect(json as string).not.toContain("4827391056");
    expect(json as string).not.toContain("9173628401");
  });
  it("合并：单聊标题写双方公开名（微信式），群聊固定「群聊的聊天记录」不写群名", () => {
    const single = mount(); // groupConvId="" → 单聊
    act(() => { single.result.current.setForwardMode("merged"); single.result.current.setForwarding([msg({ convSeq: 1 })]); });
    act(() => single.result.current.sendForwardToTarget(conv()));
    const [j1] = (single.client.sendMedia as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(j1 as string).t).toBe("小明和我自己的聊天记录");

    cleanup();
    // 群聊：标题**不含群名**——收件人往往不在那个群里，群名本身就是信息且会被永久冻结进消息。
    const group = mount({ groupConvId: "g_1", peerPublicName: "", myPublicName: "我自己" });
    act(() => { group.result.current.setForwardMode("merged"); group.result.current.setForwarding([msg({ convSeq: 1 })]); });
    act(() => group.result.current.sendForwardToTarget(conv()));
    const [j2] = (group.client.sendMedia as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(j2 as string).t).toBe("群聊的聊天记录");
  });
  it("doForwardToTargets：发出后关闭选择器、退出多选、单条 toast", () => {
    const { result, deps } = mount();
    act(() => result.current.forwardMessage(msg()));
    act(() => result.current.doForwardToTargets([conv()]));
    expect(result.current.forwarding).toBeNull();
    expect(deps.exitSelectMode).toHaveBeenCalled();
    expect(deps.setToast).toHaveBeenCalledWith("已转发到 老王");
  });

  it("setForwardVerb 换动词后吐司用新词（分享名片走「已发送到」）", () => {
    const { result, deps } = mount();
    act(() => { result.current.setForwardVerb("发送"); result.current.forwardMessage(msg()); });
    act(() => result.current.doForwardToTargets([conv()]));
    expect(deps.setToast).toHaveBeenCalledWith("已发送到 老王");
  });
  it("取消选择页（closeForwardPicker）也复位动词：下一次真转发仍说「已转发到」", () => {
    const { result, deps } = mount();
    act(() => { result.current.setForwardVerb("发送"); result.current.forwardMessage(msg()); });
    act(() => result.current.closeForwardPicker());   // 用户点取消 / 点蒙层
    act(() => result.current.forwardMessage(msg()));  // 换成一次普通转发
    act(() => result.current.doForwardToTargets([conv()]));
    expect(deps.setToast).toHaveBeenLastCalledWith("已转发到 老王");
  });
  it("forwardSelected：按 selected 收集当前会话已确认消息（排除撤回）打开选择器", () => {
    const list = [msg({ convSeq: 1 }), msg({ convSeq: 2, recalledAt: 1 }), msg({ convSeq: 3 })];
    const { result } = mount({ msgsByConv: { u_u1_u_u2: list }, selected: new Set([1, 2, 3]) });
    act(() => result.current.forwardSelected());
    expect(result.current.forwarding?.map((m) => m.convSeq)).toEqual([1, 3]);
    expect(result.current.forwardMode).toBe("each");
  });
});

// 合并转发条目名是**打包时烧进 JSON、原样发给收件人**的，不能放只在本机成立的称呼。
// 旧实现把自己的条目写死「我」，收件人打开卡片看到的就是一排「我」（2026-09-05 用户实测）。
describe("合并转发条目名：自己那一支必须是公开名，不是「我」", () => {
  const recordOf = (client: { sendMedia: ReturnType<typeof vi.fn> }) =>
    JSON.parse(client.sendMedia.mock.calls[0][0] as string) as { t: string; items: { n: string }[] };

  it("自己发的条目用自己的昵称", () => {
    const { result, client } = mount();
    act(() => result.current.setForwardMode("merged"));
    act(() => result.current.setForwarding([msg({ from: "u1", content: "我说的" }), msg({ from: "u2", content: "他说的" })]));
    act(() => result.current.sendForwardToTarget(conv()));
    const rec = recordOf(client);
    expect(rec.items.map((i) => i.n)).toEqual(["我自己", "小明"]);
    expect(rec.items.map((i) => i.n)).not.toContain("我");
  });

  it("昵称为空时退到 @句柄，仍不落内部 ID", () => {
    const { result, client } = mount({ myPublicName: "" });
    act(() => result.current.setForwardMode("merged"));
    act(() => result.current.setForwarding([msg({ from: "u1", content: "我说的" })]));
    act(() => result.current.sendForwardToTarget(conv()));
    expect(recordOf(client).items[0].n).toBe("@myhandle");
  });
});
