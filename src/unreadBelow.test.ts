import { describe, it, expect } from "vitest";
import { unreadBelowCount } from "./unreadBelow";

describe("↓N 取数判据", () => {
  it("本地齐全时数已渲染的", () => {
    expect(unreadBelowCount({ hasGap: false, head: 500, pendingRead: 300, loadedBelow: 42 })).toBe(42);
  });

  it("有缺口时不数本地——这正是 2026-09-02 实测撞到的那个 ↓195", () => {
    // 现场：单聊积压 1 万条，窗口只加载 200 条，DOM 里数出来 195。
    // 195 看着就是个正常数字，不报错、不空白，只是它本该是 10000。
    const loadedBelow = 195;
    expect(unreadBelowCount({ hasGap: true, head: 20001, pendingRead: 10001, loadedBelow })).toBe(10000);
    // 退化成数 DOM 就会红：
    expect(unreadBelowCount({ hasGap: true, head: 20001, pendingRead: 10001, loadedBelow })).not.toBe(loadedBelow);
  });

  it("已滚到最新则为 0，不出负数", () => {
    expect(unreadBelowCount({ hasGap: true, head: 20001, pendingRead: 20001, loadedBelow: 0 })).toBe(0);
    expect(unreadBelowCount({ hasGap: true, head: 20001, pendingRead: 99999, loadedBelow: 0 })).toBe(0);
  });

  it("head 未知（老服务端/尚未收到）时退回数本地，不编造数字", () => {
    expect(unreadBelowCount({ hasGap: true, head: 0, pendingRead: 10, loadedBelow: 7 })).toBe(7);
  });

  it("随向下滚动递减", () => {
    const at = (pendingRead: number) =>
      unreadBelowCount({ hasGap: true, head: 20001, pendingRead, loadedBelow: 195 });
    expect(at(10001)).toBe(10000);
    expect(at(15001)).toBe(5000);
    expect(at(20000)).toBe(1);
  });
});
