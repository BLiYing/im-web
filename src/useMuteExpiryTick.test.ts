// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useMuteExpiryTick } from "./useMuteExpiryTick";
import type { Conversation } from "./sdk/protocol";

afterEach(cleanup);

const conv = (over: Partial<Conversation>): Conversation =>
  ({ conv_id: "c1", peer: "u2", unread: 0, is_group: false, ...over } as Conversation);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useMuteExpiryTick（NOTIFICATIONS_P1_DESIGN §4.4：到期刷新，不发网络请求）", () => {
  it("挂一个定时器，到最近未来 mute_until 时强制重渲染一次", () => {
    const now = Date.now();
    let renders = 0;
    const conversations = [conv({ muted: true, mute_until: now + 1000 }), conv({ conv_id: "c2", muted: false, mute_until: 0 })];
    renderHook(() => { useMuteExpiryTick(conversations); renders++; });
    const before = renders;
    act(() => { vi.advanceTimersByTime(999); });
    expect(renders).toBe(before); // 还没到点：不重渲染
    act(() => { vi.advanceTimersByTime(60); }); // 过 1000 + 50ms 余量
    expect(renders).toBeGreaterThan(before);
  });

  it("永久免打扰（mute_until=0）与未免打扰的会话不挂定时器（没有未来到期点，不设 setTimeout）", () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const conversations = [conv({ muted: true, mute_until: 0 }), conv({ conv_id: "c2", muted: false, mute_until: Date.now() + 1000 })];
    renderHook(() => useMuteExpiryTick(conversations));
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("已过期的 mute_until 不再挂定时器（不是未来的到期点）", () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const conversations = [conv({ muted: true, mute_until: Date.now() - 1000 })];
    renderHook(() => useMuteExpiryTick(conversations));
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("window focus / visibilitychange 也强制重渲染一次（后台期间定时器可能没跑）", () => {
    let renders = 0;
    renderHook(() => { useMuteExpiryTick([]); renders++; });
    const before = renders;
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(renders).toBeGreaterThan(before);
    const afterFocus = renders;
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(renders).toBeGreaterThan(afterFocus);
  });
});
