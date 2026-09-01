// @vitest-environment jsdom
// VirtualList 的**滚动订阅**回归。
//
// 为什么这条非在 jsdom 里钉不可：它要验的是「React 提交阶段先跑子组件的 layout effect、
// 再给祖先赋 ref」这个时序——挂载那一帧 scrollElRef.current 还是 null，虚拟化器订阅不到
// 滚动容器，此后永远停在 offset 0（列表只渲染开头几行，往下滚一片空白）。
// 浏览器里量不出来：面板隐藏时 rAF 冻结、程序化 scrollTop 压根不派发 scroll 事件，
// 量到的"窗口不动"分不清是真 bug 还是探针坏了（2026-09-01 实测踩过整整一轮）。
// jsdom 里 React 的提交顺序完全一致，且 scroll 事件可以确定性派发。
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { useRef } from "react";
import { render, cleanup, act } from "@testing-library/react";
import { VirtualList } from "./VirtualList";

afterEach(cleanup);
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

const ROW_H = 40;
const VIEWPORT_H = 600;

beforeAll(() => {
  // jsdom 没有布局，尺寸恒为 0 → 虚拟化器算不出可见区、直接退到零高度兜底，那样这条测什么都验不到。
  // 打桩给出高度：带 data-scrollhost 的是滚动容器（600），其余按行高（40）。
  // **两套 API 都要打**：虚拟化器量滚动容器用的是 offsetWidth/offsetHeight（virtual-core 的 getRect），
  // 而本组件量 scrollMargin / 行高用的是 getBoundingClientRect。只打一套 → 仍走兜底、测了个寂寞。
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) { return this.dataset?.scrollhost !== undefined ? VIEWPORT_H : ROW_H; },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 400 });
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const h = (this as HTMLElement).dataset?.scrollhost !== undefined ? VIEWPORT_H : ROW_H;
    return { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: h, width: 400, height: h,
             toJSON: () => ({}) } as DOMRect;
  };
});

/** 滚动父在 VirtualList 的**祖先**上，且挂载后不再重渲染——正是出 bug 的那种形状。 */
function Host({ items }: { items: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-scrollhost="" style={{ height: VIEWPORT_H, overflowY: "auto" }}>
      <VirtualList items={items} scrollElRef={ref} getKey={(s) => s}
        estimateSize={ROW_H} renderRow={(s) => <div className="row">{s}</div>} />
    </div>
  );
}

describe("VirtualList", () => {
  const items = Array.from({ length: 500 }, (_, i) => `u${i}`);
  const indices = (c: HTMLElement) =>
    [...c.querySelectorAll("[data-index]")].map((e) => Number((e as HTMLElement).dataset.index));

  it("滚动父在祖先上时也能订阅到滚动：滚下去后渲染窗口跟着走", () => {
    const { container } = render(<Host items={items} />);
    const host = container.querySelector("[data-scrollhost]") as HTMLElement;

    const before = indices(container);
    expect(before.length).toBeLessThan(60);        // 500 行不全进 DOM
    expect(Math.min(...before)).toBe(0);           // 初始窗口在开头
    // 视口 600 / 行高 40 = 15 行可见，+ overscan 8 → 23。**必须比零高度兜底的 16 行多**，
    // 否则这条测的其实是兜底路径（虚拟化器根本没量到容器），下面的断言也就失去意义。
    expect(before.length).toBe(23);

    // jsdom 无布局，scrollTop 的 setter 不生效 → 直接定义属性，再派发 scroll（与真实滚动同路径）。
    Object.defineProperty(host, "scrollTop", { value: 4000, writable: true, configurable: true });
    act(() => { host.dispatchEvent(new Event("scroll")); });

    const after = indices(container);
    // 4000px / 40px = 第 100 行附近。窗口没跟着走 = 虚拟化器没订阅上滚动容器，此测即红。
    expect(Math.min(...after)).toBeGreaterThan(50);
    expect(after.length).toBeLessThan(60);         // 跟着走的同时仍只渲染一小撮
  });
});
