import { describe, it, expect, vi } from "vitest";
import { keyedDebounce } from "./keyedDebounce";

describe("keyedDebounce — 置顶横幅重拉合并", () => {
  it("同一会话连续触发只跑一次，不同会话各跑一次", () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const kick = keyedDebounce(300, (k) => calls.push(k));
      for (let i = 0; i < 100; i++) kick("g1");
      kick("g2");
      vi.advanceTimersByTime(299);
      expect(calls).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(calls.sort()).toEqual(["g1", "g2"]);
      kick("g1");
      vi.advanceTimersByTime(300);
      expect(calls.filter((k) => k === "g1")).toHaveLength(2);
      // 退出登录：挂着的全部撤掉，之后不再触发。
      kick("g1"); kick("g3");
      kick.cancelAll();
      vi.advanceTimersByTime(1000);
      expect(calls).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
