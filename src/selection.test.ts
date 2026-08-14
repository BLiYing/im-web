import { describe, it, expect } from "vitest";
import { toggleCapped } from "./selection";

describe("toggleCapped", () => {
  it("未选 → 追加（保序）", () => {
    expect(toggleCapped(["a"], "b", 3)).toEqual({ next: ["a", "b"], overflow: false });
  });

  it("已选 → 移除", () => {
    expect(toggleCapped(["a", "b"], "a", 3)).toEqual({ next: ["b"], overflow: false });
  });

  it("到上限再追加 → 拒绝并溢出，原列表不变", () => {
    const list = ["a", "b", "c"];
    const r = toggleCapped(list, "d", 3);
    expect(r).toEqual({ next: ["a", "b", "c"], overflow: true });
    expect(r.next).toBe(list); // 原引用返回（未复制）
  });

  it("到上限但移除已选项仍可行（不算溢出）", () => {
    expect(toggleCapped(["a", "b", "c"], "b", 3)).toEqual({ next: ["a", "c"], overflow: false });
  });

  it("max=9 边界：第 9 个可加，第 10 个溢出", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `c${i}`);
    expect(toggleCapped(nine.slice(0, 8), "c8", 9).overflow).toBe(false);
    expect(toggleCapped(nine, "c9", 9).overflow).toBe(true);
  });
});
