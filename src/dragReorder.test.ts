import { describe, it, expect } from "vitest";
import { clampOffset, dragTarget, moveItem, shiftFor } from "./dragReorder";

describe("dragReorder", () => {
  it("落点按位移四舍五入并夹在列表内", () => {
    expect(dragTarget(0, 0, 50, 5)).toBe(0);
    expect(dragTarget(0, 74, 50, 5)).toBe(1);   // 1.48 → 1
    expect(dragTarget(0, 76, 50, 5)).toBe(2);   // 1.52 → 2
    expect(dragTarget(2, -120, 50, 5)).toBe(0); // 夹到首
    expect(dragTarget(2, 999, 50, 5)).toBe(4);  // 夹到末
    expect(dragTarget(2, 80, 0, 5)).toBe(2);    // 行高未知：原地
  });
  it("位移不能把行拖出列表", () => {
    expect(clampOffset(-500, 1, 50, 4)).toBe(-50);
    expect(clampOffset(500, 1, 50, 4)).toBe(100);
    expect(clampOffset(30, 1, 50, 4)).toBe(30);
  });
  it("被拖行下移时，落点之间的行各上让一格；上移时下让一格", () => {
    // 0 → 2：行 1、2 上让
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 0, 2, 50))).toEqual([0, -50, -50, 0]);
    // 3 → 1：行 1、2 下让
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, 50))).toEqual([0, 50, 50, 0]);
    expect(shiftFor(1, -1, 0, 50)).toBe(0); // 没在拖
  });
  it("moveItem 不改入参", () => {
    const a = ["a", "b", "c", "d"];
    expect(moveItem(a, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(a, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(a).toEqual(["a", "b", "c", "d"]);
    expect(moveItem(a, 9, 0)).toEqual(a);
  });
});
