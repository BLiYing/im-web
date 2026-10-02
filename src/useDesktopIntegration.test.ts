// @vitest-environment jsdom
// 桌面集成的接线测试：`notifyInbound` 现在是 alertDecision + alertPlayer + notifySettings 的
// 真正接线点（NOTIFICATIONS_DESIGN），这里只验证「接对了」——判据本身的正确性由
// alertDecision.test.ts 的 32 条共用向量兜底，不在这里重复。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { PENDING_CONV_WAIT_MS, useDesktopIntegration } from "./useDesktopIntegration";
import { resetPlatformForTests, type DesktopBridge } from "./platform";
import { DEFAULT_NOTIFY_SETTINGS, type NotifySettings } from "./notifySettings";
import { t } from "./i18n";
import type { ChatMessage, Conversation } from "./sdk/protocol";

vi.mock("./alertPlayer", () => ({ playAlertSound: vi.fn(), preloadAlertSounds: vi.fn() }));
vi.mock("./rtc/rtcCall", () => ({ getCallEngine: vi.fn(() => null) }));

import { playAlertSound, preloadAlertSounds } from "./alertPlayer";
import { getCallEngine } from "./rtc/rtcCall";

afterEach(cleanup);

const conv = (over: Partial<Conversation>): Conversation =>
  ({ conv_id: "c1", peer: "u2", unread: 0, is_group: false, ...over } as Conversation);

const msg = (over: Partial<ChatMessage>): ChatMessage =>
  ({ convId: "c1", from: "u2", content: "hi", contentType: "text", ...over } as ChatMessage);

let notifyMock: ReturnType<typeof vi.fn<NonNullable<DesktopBridge["notify"]>>>;
let setBadgeMock: ReturnType<typeof vi.fn<NonNullable<DesktopBridge["setBadge"]>>>;

function setupDesktopBridge(): void {
  notifyMock = vi.fn<NonNullable<DesktopBridge["notify"]>>().mockResolvedValue(true);
  setBadgeMock = vi.fn<NonNullable<DesktopBridge["setBadge"]>>().mockResolvedValue(true);
  const bridge: DesktopBridge = { contract: 1, deviceId: "d1", deviceName: "IM Desktop", notify: notifyMock, setBadge: setBadgeMock };
  (window as unknown as { imDesktop?: DesktopBridge }).imDesktop = bridge;
  resetPlatformForTests();
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);   // jsdom 无 canvas：通知头像走「画不了」那条路
  vi.mocked(playAlertSound).mockClear();
  vi.mocked(preloadAlertSounds).mockClear();
  vi.mocked(getCallEngine).mockReturnValue(null);
  delete (window as unknown as { imDesktop?: DesktopBridge }).imDesktop;
  resetPlatformForTests();
});
afterEach(() => {
  delete (window as unknown as { imDesktop?: DesktopBridge }).imDesktop;
  resetPlatformForTests();
});

function mount(conversations: Conversation[], notifySettings: NotifySettings = DEFAULT_NOTIFY_SETTINGS, currentConvId = "") {
  return renderHook(() => useDesktopIntegration({ conversations, selfUid: "me", currentConvId, notifySettings }));
}

describe("提示音预热", () => {
  it("挂载即预热当前选中的私聊/群聊提示音（不等第一条消息）；换了选择再预热新的", () => {
    const settings = (priv: NotifySettings["private"]["sound"]): NotifySettings => ({
      ...DEFAULT_NOTIFY_SETTINGS,
      private: { ...DEFAULT_NOTIFY_SETTINGS.private, sound: priv },
      group: { ...DEFAULT_NOTIFY_SETTINGS.group, sound: "chime" },
    });
    const { rerender } = renderHook(
      ({ s }: { s: NotifySettings }) => useDesktopIntegration({ conversations: [], selfUid: "me", currentConvId: "", notifySettings: s }),
      { initialProps: { s: settings("chord") } });
    expect(preloadAlertSounds).toHaveBeenCalledTimes(1);
    expect(preloadAlertSounds).toHaveBeenLastCalledWith(["chord", "chime"]);
    rerender({ s: settings("chord") });   // 设置对象换了引用、选择没变：不重复预热
    expect(preloadAlertSounds).toHaveBeenCalledTimes(1);
    rerender({ s: settings("rise") });
    expect(preloadAlertSounds).toHaveBeenLastCalledWith(["rise", "chime"]);
  });
});

describe("notifyInbound：接线", () => {
  it("窗口不在焦点、非自己发的普通消息 → 放声音 + 弹桌面系统通知", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { result } = mount([conv({ muted: false })]);
    result.current.notifyInbound(msg({}));
    expect(playAlertSound).toHaveBeenCalledWith("default", DEFAULT_NOTIFY_SETTINGS.desktop.volume);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][2]).toBe("c1"); // convId 透传
  });

  it("带上 convSeq——之后撤回 / 别处已读要靠它把这条通知收回去", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { result } = mount([conv({})]);
    result.current.notifyInbound(msg({ convSeq: 42 }));
    expect(notifyMock.mock.calls[0][3]?.convSeq).toBe(42);
  });

  it("自己发的消息 → 不响不弹", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { result } = mount([conv({})]);
    result.current.notifyInbound(msg({ from: "me" }));
    expect(playAlertSound).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("没有 convId 的畸形消息 → 直接短路，不响不弹", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { result } = mount([conv({})]);
    result.current.notifyInbound(msg({ convId: "" }));
    expect(playAlertSound).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("消息预览关闭（该类型 preview=false）→ 系统通知正文换成「新消息」，标题不变", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const settings: NotifySettings = { ...DEFAULT_NOTIFY_SETTINGS, private: { ...DEFAULT_NOTIFY_SETTINGS.private, preview: false } };
    const { result } = mount([conv({})], settings);
    result.current.notifyInbound(msg({ content: "秘密内容" }));
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const [title, body] = notifyMock.mock.calls[0];
    expect(body).toBe(t("notif.preview.hidden"));
    expect(body).not.toContain("秘密内容");
    expect(title).toBeTruthy();
  });

  it("免打扰且未 @我 → 不响不弹；@我 穿透", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { result } = mount([conv({ muted: true })]);
    result.current.notifyInbound(msg({}));
    expect(playAlertSound).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    result.current.notifyInbound(msg({ mentions: ["me"] }));
    expect(playAlertSound).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  // 定时免打扰（NOTIFICATIONS_P1_DESIGN §4.3）：到期后按未免打扰算，来消息照常响铃/弹通知。
  it("定时免打扰未到期 → 不响不弹；已过期 → 视同未免打扰，照常响铃弹通知", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const now = Date.now();
    const { result: future } = mount([conv({ muted: true, mute_until: now + 60_000 })]);
    future.current.notifyInbound(msg({}));
    expect(playAlertSound).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();

    const { result: expired } = mount([conv({ muted: true, mute_until: now - 1 })]);
    expired.current.notifyInbound(msg({}));
    expect(playAlertSound).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it("窗口在焦点、但在看别的会话 → 只响声音，不弹系统通知（§3.1「当前行为是完全没声音」的修复点）", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = mount([conv({})], DEFAULT_NOTIFY_SETTINGS, "other-conv");
    result.current.notifyInbound(msg({}));
    expect(playAlertSound).toHaveBeenCalledTimes(1);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("正在看这个会话（窗口聚焦 + convId 匹配当前会话）→ 全不", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = mount([conv({})], DEFAULT_NOTIFY_SETTINGS, "c1");
    result.current.notifyInbound(msg({}));
    expect(playAlertSound).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("通话中（getCallEngine 状态非 idle）→ 不响不弹", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.mocked(getCallEngine).mockReturnValue({ state: { call: { state: "connected" } } } as unknown as ReturnType<typeof getCallEngine>);
    const { result } = mount([conv({})]);
    result.current.notifyInbound(msg({}));
    expect(playAlertSound).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("浏览器构建（无 imDesktop 桥）：只响声音，从不弹系统通知", () => {
    // 不调 setupDesktopBridge：platform() 回落 webPlatform。
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { result } = mount([conv({})]);
    result.current.notifyInbound(msg({}));
    expect(playAlertSound).toHaveBeenCalledTimes(1);
  });

  it("群消息：通知正文带上发送人（经 bindCallbacks 的 senderOf 取显示名）", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { result } = mount([conv({ conv_id: "g1", is_group: true })]);
    result.current.bindCallbacks({ titleOf: () => "产品组", senderOf: () => "张三", onOpenConversation: () => {} });
    result.current.notifyInbound(msg({ convId: "g1", content: "开会" }));
    const [title, body] = notifyMock.mock.calls[0];
    expect(title).toBe("产品组");
    expect(body).toBe(t("push.group_body", { sender: "张三", text: "开会" }));
  });

  it("群消息使用群聊的提示音", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const settings: NotifySettings = { ...DEFAULT_NOTIFY_SETTINGS, group: { ...DEFAULT_NOTIFY_SETTINGS.group, sound: "drop" } };
    const { result } = mount([conv({ conv_id: "g1", is_group: true })], settings);
    result.current.notifyInbound(msg({ convId: "g1" }));
    expect(playAlertSound).toHaveBeenCalledWith("drop", settings.desktop.volume);
  });
});

describe("badge：includeMuted 接线", () => {
  const convs = [conv({ unread: 3 }), conv({ conv_id: "c2", unread: 99, muted: true })];

  it("includeMuted=false（默认）：免打扰会话不计入角标", async () => {
    setupDesktopBridge();
    mount(convs, DEFAULT_NOTIFY_SETTINGS);
    await waitFor(() => expect(setBadgeMock).toHaveBeenCalledWith(3));
  });

  it("includeMuted=true：免打扰会话按未读全额计入", async () => {
    setupDesktopBridge();
    const settings: NotifySettings = { ...DEFAULT_NOTIFY_SETTINGS, badge: { includeMuted: true } };
    mount(convs, settings);
    await waitFor(() => expect(setBadgeMock).toHaveBeenCalledWith(102));
  });
});

describe("clearNotifications：透传到桥", () => {
  it("撤回 / 别处已读的收回请求原样交给桌面桥", () => {
    const clearMock = vi.fn<NonNullable<DesktopBridge["clearNotifications"]>>().mockResolvedValue(1);
    (window as unknown as { imDesktop?: DesktopBridge }).imDesktop =
      { contract: 1, deviceId: "d1", deviceName: "IM Desktop", clearNotifications: clearMock };
    resetPlatformForTests();
    const { result } = mount([]);
    result.current.clearNotifications({ convId: "c1", convSeqs: [7] });
    result.current.clearNotifications({ convId: "c1", upTo: 9 });
    expect(clearMock.mock.calls).toEqual([[{ convId: "c1", convSeqs: [7] }], [{ convId: "c1", upTo: 9 }]]);
  });

  it("旧壳没有这条桥 / 浏览器版：空操作，不抛", () => {
    setupDesktopBridge();   // 这座假桥没有 clearNotifications
    const { result } = mount([]);
    expect(() => result.current.clearNotifications({ convId: "c1", upTo: 9 })).not.toThrow();
  });
});

// 2026-10-02 用户实测：新加好友后对方发的第一条，桌面通知标题是「新消息」——那一刻会话列表里还没有这一行。
describe("新会话的第一条消息：等会话列表带回这一行再提醒", () => {
  const props = (conversations: Conversation[]) =>
    ({ conversations, selfUid: "me", currentConvId: "", notifySettings: DEFAULT_NOTIFY_SETTINGS });

  it("会话还没到 → 先不弹；列表刷新带回它 → 用会话名弹", () => {
    setupDesktopBridge();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { result, rerender } = renderHook((p: ReturnType<typeof props>) => useDesktopIntegration(p), { initialProps: props([]) });
    result.current.bindCallbacks({ titleOf: () => "用户4984", senderOf: () => "发送人兜底", onOpenConversation: () => {} });
    result.current.notifyInbound(msg({ convId: "c9", from: "u4984", convSeq: 1 }));
    expect(notifyMock).not.toHaveBeenCalled();
    rerender(props([conv({ conv_id: "c9", peer: "u4984" })]));
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toBe("用户4984");
  });

  it("一直等不到（拉列表失败）→ 到点按发送人兜底，仍然只弹一次", () => {
    vi.useFakeTimers();
    try {
      setupDesktopBridge();
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      const { result } = mount([]);
      result.current.bindCallbacks({ titleOf: () => "新消息", senderOf: () => "用户4984", onOpenConversation: () => {} });
      result.current.notifyInbound(msg({ convId: "c9", from: "u4984", convSeq: 1 }));
      vi.advanceTimersByTime(PENDING_CONV_WAIT_MS);
      expect(notifyMock).toHaveBeenCalledTimes(1);
      expect(notifyMock.mock.calls[0][0]).toBe("用户4984");
      vi.advanceTimersByTime(PENDING_CONV_WAIT_MS);
      expect(notifyMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
