import { describe, it, expect, vi, afterEach } from "vitest";
import { ReceiptBatcher } from "./receiptBatch";

// 从 imSdk.ts 拆出来的 delivered 回执合批：行为必须与拆之前一字不差（短窗口内每会话只发一帧、位点取最大）。
afterEach(() => { vi.useRealTimers(); });

describe("ReceiptBatcher", () => {
  it("窗口内同一会话只发一帧，位点取最大；不同会话各发一帧", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const b = new ReceiptBatcher(emit, 120);
    b.push("a", 3); b.push("a", 9); b.push("a", 5); b.push("b", 2);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(emit.mock.calls).toEqual([["a", 9], ["b", 2]]);
    vi.advanceTimersByTime(1000);
    expect(emit).toHaveBeenCalledTimes(2);      // 发完即清，不会重发
  });

  it("空会话 / 非正位点忽略", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const b = new ReceiptBatcher(emit);
    b.push("", 3); b.push("a", 0); b.push("a", -1);
    vi.advanceTimersByTime(500);
    expect(emit).not.toHaveBeenCalled();
  });

  it("clear 丢弃未发的回执并取消计时器（切账号后旧账号的回执不许发出去）", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const b = new ReceiptBatcher(emit);
    b.push("a", 3);
    b.clear();
    vi.advanceTimersByTime(500);
    expect(emit).not.toHaveBeenCalled();
    b.push("a", 4);                              // 清过之后仍可正常使用
    vi.advanceTimersByTime(500);
    expect(emit.mock.calls).toEqual([["a", 4]]);
  });

  it("flush 立即发出", () => {
    const emit = vi.fn();
    const b = new ReceiptBatcher(emit, 10_000);
    b.push("a", 7);
    b.flush();
    expect(emit.mock.calls).toEqual([["a", 7]]);
  });
});
