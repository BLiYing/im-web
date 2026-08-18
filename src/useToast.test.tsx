// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useToast } from "./useToast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useToast", () => {
  it("setToast 显示，1.8s 后自动消失", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.setToast("已保存"));
    expect(result.current.toast).toBe("已保存");
    act(() => { vi.advanceTimersByTime(1800); });
    expect(result.current.toast).toBeNull();
  });

  it("接连两条：后到重置计时，不被前一条的定时器提前清掉", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.setToast("第一条"));
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => result.current.setToast("第二条"));
    act(() => { vi.advanceTimersByTime(1000); }); // 第一条的 1.8s 已过，但其定时器应已被 cleanup
    expect(result.current.toast).toBe("第二条");
    act(() => { vi.advanceTimersByTime(800); });
    expect(result.current.toast).toBeNull();
  });

  it("comingSoon 拼「（开发中）」后缀", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.comingSoon("视频通话"));
    expect(result.current.toast).toBe("视频通话（开发中）");
  });
});
