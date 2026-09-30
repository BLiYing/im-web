// @vitest-environment jsdom
// 查看器大图的事件接线（几何本身在 viewerZoom.test.ts）。jsdom 没有布局：offsetWidth/Height 恒 0，
// 所以这里只断言「倍率有没有变、单击/拖拽有没有分清」，不断言平移量。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ZoomableImage } from "./ZoomableImage";

afterEach(cleanup);

function mount(onTap = vi.fn(), onMaskClick = vi.fn()) {
  const { container } = render(
    <div className="viewer-mask" onClick={onMaskClick}>
      <ZoomableImage src="https://x/a.jpg" alt="大图" onTap={onTap} onError={vi.fn()} />
    </div>,
  );
  const img = container.querySelector("img.image-viewer") as HTMLImageElement;
  const mask = container.querySelector(".viewer-mask") as HTMLElement;
  return { img, mask, onTap, onMaskClick };
}
const scaleOf = (img: HTMLImageElement) => Number(/scale\(([\d.]+)\)/.exec(img.style.transform)?.[1] ?? 1);

describe("ZoomableImage", () => {
  it("初始 1×：不写 transform", () => {
    const { img } = mount();
    expect(img.style.transform).toBe("");
    expect(img.className).not.toContain("zoomed");
  });

  it("滚轮向上放大、向下缩回 1×；在遮罩（图外黑边）上滚也算", () => {
    const { img, mask } = mount();
    fireEvent.wheel(mask, { deltaY: -200 });
    const k = scaleOf(img);
    expect(k).toBeGreaterThan(1);
    fireEvent.wheel(img, { deltaY: -200 });
    expect(scaleOf(img)).toBeGreaterThan(k); // 连续滚动在上一次结果上累计
    fireEvent.wheel(mask, { deltaY: 5000 });
    fireEvent.wheel(mask, { deltaY: 5000 });
    fireEvent.wheel(mask, { deltaY: 5000 });
    fireEvent.wheel(mask, { deltaY: 5000 });
    expect(img.style.transform).toBe("");
  });

  it("滚轮事件被 preventDefault（拦 ctrl+wheel 的整页缩放）", () => {
    const { mask } = mount();
    const ev = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    mask.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("双击在 1× 与 2× 之间切换，且不冒泡成「点遮罩关闭」", () => {
    const { img, onMaskClick } = mount();
    fireEvent.doubleClick(img);
    expect(scaleOf(img)).toBe(2);
    fireEvent.doubleClick(img);
    expect(img.style.transform).toBe("");
    expect(onMaskClick).not.toHaveBeenCalled();
  });

  it("键盘 + 放大、- 缩小、0 复位；带 Cmd/Ctrl 的留给浏览器", () => {
    const { img } = mount();
    fireEvent.keyDown(window, { key: "+", metaKey: true });
    expect(img.style.transform).toBe("");
    fireEvent.keyDown(window, { key: "+" });
    fireEvent.keyDown(window, { key: "=" });
    expect(scaleOf(img)).toBeCloseTo(2.25);
    fireEvent.keyDown(window, { key: "-" });
    expect(scaleOf(img)).toBeCloseTo(1.5);
    fireEvent.keyDown(window, { key: "0" });
    expect(img.style.transform).toBe("");
  });

  it("单击回调 onTap，不关查看器", () => {
    const { img, onTap, onMaskClick } = mount();
    fireEvent.click(img);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onMaskClick).not.toHaveBeenCalled();
  });

  it("放大后拖拽：松手那一下 click 不算单击，也不关查看器", () => {
    const { img, onTap, onMaskClick } = mount();
    fireEvent.doubleClick(img);
    fireEvent.pointerDown(img, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    expect(img.className).toContain("dragging");
    fireEvent.pointerMove(img, { pointerId: 1, clientX: 160, clientY: 130 });
    fireEvent.pointerUp(img, { pointerId: 1, clientX: 160, clientY: 130 });
    expect(img.className).not.toContain("dragging");
    fireEvent.click(img);
    expect(onTap).not.toHaveBeenCalled();
    expect(onMaskClick).not.toHaveBeenCalled();
    // 下一次原地单击恢复正常
    fireEvent.pointerDown(img, { pointerId: 2, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(img, { pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.click(img);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("1× 时按下不进入拖拽态", () => {
    const { img } = mount();
    fireEvent.pointerDown(img, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    expect(img.className).not.toContain("dragging");
  });

  it("卸载后不再响应滚轮 / 键盘（监听已摘）", () => {
    const { mask } = mount();
    cleanup();
    expect(() => { fireEvent.wheel(mask, { deltaY: -100 }); fireEvent.keyDown(window, { key: "+" }); }).not.toThrow();
  });
});
