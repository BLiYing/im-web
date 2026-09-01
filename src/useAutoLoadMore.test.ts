// @vitest-environment jsdom
// useAutoLoadMore 的行为回归。盯的是两类会真出事的：
//  ① 内容不满一屏时不触发 → 「自动」变成「永远不动」；
//  ② 容器零高度时误触发 → 用户还没看见列表就把 400 页全拉下来。
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoLoadMore, AUTO_LOAD_THRESHOLD_PX } from "./useAutoLoadMore";

/** 造一个可控的滚动容器：jsdom 不做布局，三个尺寸属性得自己定义。 */
function makeScroller(dims: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  const el = document.createElement("div");
  const state = { ...dims, scrollTop: dims.scrollTop ?? 0 };
  for (const k of ["scrollHeight", "clientHeight"] as const) {
    Object.defineProperty(el, k, { get: () => state[k], configurable: true });
  }
  Object.defineProperty(el, "scrollTop", {
    get: () => state.scrollTop, set: (v: number) => { state.scrollTop = v; }, configurable: true,
  });
  document.body.appendChild(el);
  return { el, state, ref: { current: el as HTMLElement | null } };
}

let onLoadMore: Mock<() => void>;
beforeEach(() => { onLoadMore = vi.fn<() => void>(); });
afterEach(() => { document.body.innerHTML = ""; });

describe("useAutoLoadMore", () => {
  it("离底还远时不拉；滚到阈值内才拉", () => {
    const { el, state, ref } = makeScroller({ scrollHeight: 10000, clientHeight: 800, scrollTop: 0 });
    renderHook(() => useAutoLoadMore(ref, { enabled: true, onLoadMore, signal: 0 }));
    expect(onLoadMore).not.toHaveBeenCalled();

    // 距底 = 10000 - 8600 - 800 = 600 = 阈值（含等号）。
    act(() => { state.scrollTop = 10000 - 800 - AUTO_LOAD_THRESHOLD_PX; el.dispatchEvent(new Event("scroll")); });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("**内容不满一屏时首帧就自查**——否则滚动事件永远不会发生，「自动」等于没做", () => {
    const { ref } = makeScroller({ scrollHeight: 300, clientHeight: 800 });
    renderHook(() => useAutoLoadMore(ref, { enabled: true, onLoadMore, signal: 0 }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("**容器零高度不触发**：布局塌陷时用户还没看见列表，别把 400 页全拉下来", () => {
    const { el, ref } = makeScroller({ scrollHeight: 0, clientHeight: 0 });
    renderHook(() => useAutoLoadMore(ref, { enabled: true, onLoadMore, signal: 0 }));
    act(() => { el.dispatchEvent(new Event("scroll")); });
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("enabled=false（没有下一页/正在拉）时完全不挂监听", () => {
    const { el, ref } = makeScroller({ scrollHeight: 300, clientHeight: 800 });
    renderHook(() => useAutoLoadMore(ref, { enabled: false, onLoadMore, signal: 0 }));
    act(() => { el.dispatchEvent(new Event("scroll")); });
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("signal 变了（新一页落地）重新自查：新页仍填不满视口就接着拉", () => {
    const { ref, state } = makeScroller({ scrollHeight: 300, clientHeight: 800 });
    const { rerender } = renderHook(
      ({ n }) => useAutoLoadMore(ref, { enabled: true, onLoadMore, signal: n }),
      { initialProps: { n: 0 } });
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    state.scrollHeight = 600; // 又来了一页，还是不满一屏
    rerender({ n: 1 });
    expect(onLoadMore).toHaveBeenCalledTimes(2);

    // 这一页把视口填满且离底很远 → 停手（自动续拉不会无限空转）。
    state.scrollHeight = 10000;
    rerender({ n: 2 });
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("卸载后不再响应滚动（详情抽屉关掉了还在拉页 = 白烧流量）", () => {
    const { el, state, ref } = makeScroller({ scrollHeight: 10000, clientHeight: 800 });
    const { unmount } = renderHook(() => useAutoLoadMore(ref, { enabled: true, onLoadMore, signal: 0 }));
    unmount();
    act(() => { state.scrollTop = 9000; el.dispatchEvent(new Event("scroll")); });
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("滚动容器还没挂上（ref 为空）不报错、也不拉", () => {
    const ref = { current: null as HTMLElement | null };
    expect(() => renderHook(() => useAutoLoadMore(ref, { enabled: true, onLoadMore, signal: 0 }))).not.toThrow();
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
