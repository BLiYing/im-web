// @vitest-environment jsdom
// 接线测试：只验证「什么时候画、画的是什么状态、桌面版短路、数字不变不重画、标题前缀」。
// 状态计算本身（count/hasMarkedUnread → none/dot/number）由 faviconBadge.test.ts 的纯函数单测兜底。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useFaviconBadge } from "./useFaviconBadge";
import { resetPlatformForTests, type DesktopBridge } from "./platform";
import { resetFaviconBadgeForTests } from "./faviconBadge";
import type { Conversation } from "./sdk/protocol";

vi.mock("./faviconBadge", async () => {
  const actual = await vi.importActual<typeof import("./faviconBadge")>("./faviconBadge");
  return { ...actual, drawFaviconBadge: vi.fn() };
});
import { drawFaviconBadge } from "./faviconBadge";

afterEach(cleanup);

const conv = (over: Partial<Conversation>): Conversation =>
  ({ conv_id: "c1", peer: "u2", unread: 0, is_group: false, ...over } as Conversation);

beforeEach(() => {
  vi.mocked(drawFaviconBadge).mockClear();
  delete (window as unknown as { imDesktop?: DesktopBridge }).imDesktop;
  resetPlatformForTests();
  resetFaviconBadgeForTests();
  document.title = "IM Web";
});
afterEach(() => {
  delete (window as unknown as { imDesktop?: DesktopBridge }).imDesktop;
  resetPlatformForTests();
});

function mount(conversations: Conversation[], includeMuted = false) {
  return renderHook(({ convs, im }: { convs: Conversation[]; im: boolean }) => useFaviconBadge(convs, im), {
    initialProps: { convs: conversations, im: includeMuted },
  });
}

describe("useFaviconBadge：浏览器版", () => {
  it("有未读 → 画 number 状态，标题加前缀", () => {
    mount([conv({ unread: 3 })]);
    expect(drawFaviconBadge).toHaveBeenCalledWith({ kind: "number", label: "3" });
    expect(document.title).toBe("(3) IM Web");
  });

  it("无未读但有标记未读 → 画 dot，标题不加前缀", () => {
    mount([conv({ unread: 0, marked_unread: true })]);
    expect(drawFaviconBadge).toHaveBeenCalledWith({ kind: "dot" });
    expect(document.title).toBe("IM Web");
  });

  it("全部已读 → 画 none，标题恢复原样", () => {
    mount([conv({ unread: 0 })]);
    expect(drawFaviconBadge).toHaveBeenCalledWith({ kind: "none" });
    expect(document.title).toBe("IM Web");
  });

  it("数字不变（同一 key）→ 重渲染不重画", () => {
    const { rerender } = mount([conv({ unread: 3 })]);
    expect(drawFaviconBadge).toHaveBeenCalledTimes(1);
    rerender({ convs: [conv({ unread: 3, conv_id: "c2" })], im: false }); // 会话变了但未读数还是 3
    expect(drawFaviconBadge).toHaveBeenCalledTimes(1); // 没有第二次调用
  });

  it("数字变化 → 重新画并更新标题", () => {
    const { rerender } = mount([conv({ unread: 3 })]);
    rerender({ convs: [conv({ unread: 5 })], im: false });
    expect(drawFaviconBadge).toHaveBeenLastCalledWith({ kind: "number", label: "5" });
    expect(document.title).toBe("(5) IM Web");
  });

  it("超过 99 显示 99+", () => {
    mount([conv({ unread: 150 })]);
    expect(drawFaviconBadge).toHaveBeenCalledWith({ kind: "number", label: "99+" });
    expect(document.title).toBe("(99+) IM Web");
  });

  it("includeMuted 跟随通知设置：免打扰会话默认不计入，开了才计入", () => {
    const muted = [conv({ unread: 4, muted: true })];
    mount(muted, false);
    expect(drawFaviconBadge).toHaveBeenCalledWith({ kind: "none" }); // 默认口径：免打扰不计未读数
    vi.mocked(drawFaviconBadge).mockClear();
    mount(muted, true);
    expect(drawFaviconBadge).toHaveBeenCalledWith({ kind: "number", label: "4" });
  });
});

describe("useFaviconBadge：桌面版短路", () => {
  it("platform().isDesktop=true → 完全不画、不改标题（Dock 角标已经在管）", () => {
    const bridge: DesktopBridge = { contract: 1, deviceId: "d1", deviceName: "IM Desktop" };
    (window as unknown as { imDesktop?: DesktopBridge }).imDesktop = bridge;
    resetPlatformForTests();
    mount([conv({ unread: 3 })]);
    expect(drawFaviconBadge).not.toHaveBeenCalled();
    expect(document.title).toBe("IM Web");
  });
});
