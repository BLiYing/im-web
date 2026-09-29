// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { faviconBadgeLabel, faviconBadgeState, faviconTitleOf, hasMarkedUnreadConv, faviconBadgeKey, drawFaviconBadge, resetFaviconBadgeForTests } from "./faviconBadge";
import type { Conversation } from "./sdk/protocol";

const conv = (over: Partial<Conversation>): Conversation => ({
  conv_id: "c1", peer: "u2", is_group: false, unread: 0, read_seq: 0, peer_read_seq: 0, ...over,
} as Conversation);

describe("faviconBadgeLabel（99+ 边界）", () => {
  it("<=99 原样显示", () => {
    expect(faviconBadgeLabel(0)).toBe("0");
    expect(faviconBadgeLabel(1)).toBe("1");
    expect(faviconBadgeLabel(99)).toBe("99");
  });
  it("超过 99 显示 99+", () => {
    expect(faviconBadgeLabel(100)).toBe("99+");
    expect(faviconBadgeLabel(999)).toBe("99+");
  });
  it("防御：负数/小数收成非负整数", () => {
    expect(faviconBadgeLabel(-5)).toBe("0");
    expect(faviconBadgeLabel(3.7)).toBe("3");
  });
});

describe("faviconBadgeState（count/hasMarkedUnread → none/dot/number）", () => {
  it("count>0 → number，label 走 faviconBadgeLabel", () => {
    expect(faviconBadgeState(3, false)).toEqual({ kind: "number", label: "3" });
    expect(faviconBadgeState(150, false)).toEqual({ kind: "number", label: "99+" });
  });
  it("count>0 时即使有 marked_unread 也是 number（数字优先）", () => {
    expect(faviconBadgeState(2, true)).toEqual({ kind: "number", label: "2" });
  });
  it("count=0 且 hasMarkedUnread=true → dot", () => {
    expect(faviconBadgeState(0, true)).toEqual({ kind: "dot" });
  });
  it("count=0 且 hasMarkedUnread=false → none", () => {
    expect(faviconBadgeState(0, false)).toEqual({ kind: "none" });
  });
});

describe("hasMarkedUnreadConv", () => {
  it("任意会话 marked_unread=true → true", () => {
    expect(hasMarkedUnreadConv([conv({ marked_unread: false }), conv({ conv_id: "c2", marked_unread: true })])).toBe(true);
  });
  it("全部 false/缺省 → false", () => {
    expect(hasMarkedUnreadConv([conv({}), conv({ conv_id: "c2", marked_unread: false })])).toBe(false);
  });
  it("空数组 → false", () => {
    expect(hasMarkedUnreadConv([])).toBe(false);
  });
});

describe("faviconTitleOf（标题前缀）", () => {
  it("number 状态加 (n) 前缀", () => {
    expect(faviconTitleOf({ kind: "number", label: "3" }, "IM Web")).toBe("(3) IM Web");
    expect(faviconTitleOf({ kind: "number", label: "99+" }, "IM Web")).toBe("(99+) IM Web");
  });
  it("dot 状态恢复原标题（不加前缀）", () => {
    expect(faviconTitleOf({ kind: "dot" }, "IM Web")).toBe("IM Web");
  });
  it("none 状态恢复原标题", () => {
    expect(faviconTitleOf({ kind: "none" }, "IM Web")).toBe("IM Web");
  });
});

describe("faviconBadgeKey（去重键，数字不变不重画）", () => {
  it("相同 number 状态给出相同 key", () => {
    expect(faviconBadgeKey({ kind: "number", label: "3" })).toBe(faviconBadgeKey({ kind: "number", label: "3" }));
  });
  it("不同数字给出不同 key", () => {
    expect(faviconBadgeKey({ kind: "number", label: "3" })).not.toBe(faviconBadgeKey({ kind: "number", label: "4" }));
  });
  it("number/dot/none 三种 kind 两两不同", () => {
    const keys = [faviconBadgeKey({ kind: "number", label: "3" }), faviconBadgeKey({ kind: "dot" }), faviconBadgeKey({ kind: "none" })];
    expect(new Set(keys).size).toBe(3);
  });
});

describe("drawFaviconBadge（异步解码乱序）", () => {
  // jsdom 没有真 canvas / 图片解码：换成可控的假对象，手动决定哪次 onload 先回来。
  const pending: Array<{ onload: (() => void) | null }> = [];
  class FakeImage {
    onload: (() => void) | null = null;
    set src(_v: string) { pending.push(this); }
  }
  let drawn = "";
  beforeEach(() => {
    pending.length = 0;
    resetFaviconBadgeForTests();
    document.head.innerHTML = '<link rel="icon" href="/favicon.png">';
    vi.stubGlobal("Image", FakeImage);
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") return realCreate(tag);
      const ctx = new Proxy({}, { get: (_t, k) => (k === "fillText" ? (text: string) => { drawn = text; } : () => undefined), set: () => true });
      return { width: 0, height: 0, getContext: () => ctx, toDataURL: () => `data:badge-${drawn}` } as unknown as HTMLCanvasElement;
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("先发起的「3」比后发起的「5」晚解码完：最终仍是 5", () => {
    drawFaviconBadge(faviconBadgeState(3, false));
    drawFaviconBadge(faviconBadgeState(5, false));
    const [first, second] = pending;
    second.onload?.();
    first.onload?.();
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;
    expect(link.href).toBe("data:badge-5");
  });

  it("画数字途中切回 none：迟到的 onload 不得把角标盖回去", () => {
    drawFaviconBadge(faviconBadgeState(3, false));
    drawFaviconBadge(faviconBadgeState(0, false));
    pending[0].onload?.();
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;
    expect(link.href).toMatch(/favicon\.png$/);
  });
});
