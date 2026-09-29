import { describe, expect, it } from "vitest";
import { SCROLLBAR_MIN_THUMB_PX, scrollbarThumb } from "./chatScrollbar";

describe("消息列表滚动条滑块", () => {
  it("一屏放得下全部内容时不显示（null）", () => {
    expect(scrollbarThumb(0, 400, 600)).toBeNull();
    expect(scrollbarThumb(0, 600, 600)).toBeNull();
  });

  it("按比例算滑块高度与位置", () => {
    // 内容 2000，视口 600 → 滑块高 = 600*600/2000 = 180；顶在最上时 top=0
    const top = scrollbarThumb(0, 2000, 600)!;
    expect(top.height).toBeCloseTo(180, 5);
    expect(top.top).toBe(0);

    // 滚到底（scrollTop = 2000-600 = 1400）→ 滑块贴底：top = clientHeight - thumbHeight
    const bottom = scrollbarThumb(1400, 2000, 600)!;
    expect(bottom.top).toBeCloseTo(600 - 180, 5);
  });

  it("内容极长时滑块不低于最小可视高度", () => {
    const thumb = scrollbarThumb(0, 200_000, 600)!;
    expect(thumb.height).toBe(SCROLLBAR_MIN_THUMB_PX);
  });

  it("滚动位置夹在 [0, maxScrollTop] 之外时滑块位置仍落在合法范围内", () => {
    const overshoot = scrollbarThumb(999_999, 2000, 600)!;
    expect(overshoot.top).toBeLessThanOrEqual(600 - overshoot.height);
    const negative = scrollbarThumb(-100, 2000, 600)!;
    expect(negative.top).toBeGreaterThanOrEqual(0);
  });
});
