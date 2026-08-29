// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useContactShare, CONTACT_MAX_SELECTION } from "./useContactShare";
import { parseContactCard } from "./contactCard";
import type { ChatMessage, Conversation, FriendEntry } from "./sdk/protocol";

const friend = (id: string, nickname: string, remark?: string): FriendEntry =>
  ({ user_id: id, nickname, remark, status: "accepted", avatar_url: `/a/${id}.jpg` } as FriendEntry);
const conv = (id: string): Conversation =>
  ({ conv_id: id, peer: "1002", is_group: false } as Conversation);

function setup(over: Partial<Parameters<typeof useContactShare>[0]> = {}) {
  const sendMedia = vi.fn(() => "cm-1");
  const appendMsg = vi.fn();
  const setForwarding = vi.fn();
  const setForwardMode = vi.fn();
  const setForwardVerb = vi.fn();
  const setToast = vi.fn();
  const deps = {
    clientRef: { current: { sendMedia } } as never,
    setToast, uid: "1001",
    friends: [friend("1002", "小明", "老王"), friend("1003", "小红")],
    conversations: [conv("u_1001_u_1002")],
    currentConvRef: { current: "u_1001_u_1002" },
    appendMsg, setAttachPanel: vi.fn(), setForwardMode, setForwarding, setForwardVerb,
    ...over,
  } as Parameters<typeof useContactShare>[0];
  const { result } = renderHook(() => useContactShare(deps));
  return { result, sendMedia, appendMsg, setForwarding, setForwardMode, setForwardVerb, setToast };
}

describe("入口①：选好友 → 确认 → 发进当前会话", () => {
  it("快照取真实昵称，**不是备注**（备注不得外发）", () => {
    const { result, sendMedia } = setup();
    act(() => result.current.openContactPicker());
    act(() => result.current.toggleContactPick("1002"));
    act(() => result.current.confirmContactPick());
    expect(result.current.cardConfirm).toEqual([
      { userId: "1002", nickname: "小明", avatarUrl: "/a/1002.jpg" },
    ]);
    act(() => result.current.sendContactCards(result.current.cardConfirm!));
    const [content, ct] = sendMedia.mock.calls[0] as unknown as [string, string];
    expect(ct).toBe("contact");
    expect(parseContactCard(content)!.nickname).toBe("小明"); // 昵称
    expect(content).not.toContain("老王");                     // 备注绝不外发
  });

  it("逐条独立发出，本地乐观回显 status=sending", () => {
    const { result, sendMedia, appendMsg } = setup();
    act(() => result.current.openContactPicker());
    act(() => result.current.toggleContactPick("1002"));
    act(() => result.current.toggleContactPick("1003"));
    act(() => result.current.confirmContactPick());
    act(() => result.current.sendContactCards(result.current.cardConfirm!));
    expect(sendMedia).toHaveBeenCalledTimes(2);
    expect(appendMsg).toHaveBeenCalledTimes(2);
    const m = appendMsg.mock.calls[0][1] as ChatMessage;
    expect(m.status).toBe("sending");
    expect(m.contentType).toBe("contact");
  });

  it("达上限后再勾选被忽略", () => {
    const many = Array.from({ length: 12 }, (_, i) => friend(`20${i}`, `n${i}`));
    const { result } = setup({ friends: many });
    act(() => result.current.openContactPicker());
    for (const f of many) act(() => result.current.toggleContactPick(f.user_id));
    expect(result.current.cardPicker!.selected).toHaveLength(CONTACT_MAX_SELECTION);
  });

  it("再次点击已选中的可取消", () => {
    const { result } = setup();
    act(() => result.current.openContactPicker());
    act(() => result.current.toggleContactPick("1002"));
    act(() => result.current.toggleContactPick("1002"));
    expect(result.current.cardPicker!.selected).toEqual([]);
  });
});

describe("入口②③：交给转发选择页", () => {
  // 回归护栏：曾把 from 填成 uid，收方卡片上方会出现「转发自 <10位内部ID>」——
  // 既是错的语义（分享名片不是转发），又把内部 ID 露到界面上。
  it("合成消息的 from 必须留空，否则会带出 forwardFrom", () => {
    const { result, setForwarding, setForwardMode, setForwardVerb } = setup();
    act(() => result.current.shareContactCard({ userId: "1003", nickname: "小红" }));
    expect(setForwardMode).toHaveBeenCalledWith("each");
    // 分享名片不是转发，吐司动词要置成「发送」（与 iOS IMContactShare 一致）。
    expect(setForwardVerb).toHaveBeenCalledWith("发送");
    const [msgs] = setForwarding.mock.calls[0] as [ChatMessage[]];
    expect(msgs[0].from).toBe("");
    expect(msgs[0].forwardFrom).toBeUndefined();
    expect(msgs[0].fromNickname).toBeUndefined();
    expect(msgs[0].contentType).toBe("contact");
    expect(msgs[0].convSeq).toBeGreaterThan(0); // 否则会被当成未发出的占位过滤掉
  });

  it("uid 为空 → 不进转发流程，出提示", () => {
    const { result, setForwarding, setToast } = setup();
    act(() => result.current.shareContactCard({ userId: "" }));
    expect(setForwarding).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalled();
  });
});

// 回归：从好友项构造名片时**必须带上 username**。
//
// 2026-08-29 实测踩过：协议加了 un、buildContactCard 加了参数、显示端也改了，
// 唯独这一步的映射漏了 username → un 永远不写进 JSON → 收端副标题永远是空的。
// 「三处都改对了却看不到效果」正是这种源头丢字段的典型症状。
describe("名片构造必须带 username", () => {
  it("confirmContactPick 把好友的 username 带进 ContactCard", async () => {
    const friendWithHandle = {
      user_id: "4820571639", username: "xiaoming", nickname: "小明",
      avatar_url: "/a.jpg", status: "accepted", updated_at: 1,
    } as FriendEntry;
    const { result } = setup({ friends: [friendWithHandle] });

    act(() => result.current.openContactPicker());
    act(() => result.current.toggleContactPick("4820571639"));
    act(() => result.current.confirmContactPick());

    const cards = result.current.cardConfirm!;
    expect(cards).toHaveLength(1);
    expect(cards[0].username).toBe("xiaoming");   // ← 漏了这个字段就前功尽弃
    expect(cards[0].userId).toBe("4820571639");
    expect(cards[0].nickname).toBe("小明");
  });
});
