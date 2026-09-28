// @vitest-environment jsdom
// useCallHistory：首页/翻页、到底停止、callEnd 重拉首页并让在途翻页请求作废（generation 计数器）。
// engine 用受控 fake（外部决定何时 resolve），不碰真实网络/SDK。
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CallEngine } from "im-rtc-call-engine";
import type { CallHistoryPage, CallHistoryRecord } from "im-rtc-call-engine";
import { getCallEngine } from "./rtc/rtcCall";
import { useCallHistory } from "./useCallHistory";

vi.mock("./rtc/rtcCall", () => ({ getCallEngine: vi.fn() }));

afterEach(cleanup);

const rec = (callId: string, over: Partial<CallHistoryRecord> = {}): CallHistoryRecord => ({
  callId, roomId: "r", caller: "peer", mediaType: "audio", isGroup: false,
  reason: "hangup", endedBy: "", durationSec: 10, startedAtMs: 1,
  connectedAtMs: 1, endedAtMs: 1, userData: "", chatGroupId: "", members: [], ...over,
});

/** 受控 fake：fetchCallHistory 不自动 resolve，测试按需驱动，便于精确摆出「在途请求」时序。 */
function controllableEngine() {
  const pending: { cursor?: number; resolve: (p: CallHistoryPage) => void; reject: (e: unknown) => void }[] = [];
  const fetchCallHistory = vi.fn((opts: { cursor?: number }) => new Promise<CallHistoryPage>((resolve, reject) => {
    pending.push({ cursor: opts.cursor, resolve, reject });
  }));
  const listeners = new Set<() => void>();
  const on = vi.fn((event: string, cb: () => void) => {
    if (event !== "callEnd") return () => {};
    listeners.add(cb);
    return () => listeners.delete(cb);
  });
  return {
    engine: { fetchCallHistory, on } as unknown as CallEngine,
    pending,
    emitCallEnd: () => listeners.forEach((cb) => cb()),
  };
}

describe("useCallHistory", () => {
  it("首页加载成功后 records/hasMore 更新", async () => {
    const { engine, pending } = controllableEngine();
    vi.mocked(getCallEngine).mockReturnValue(engine);
    const { result } = renderHook(() => useCallHistory("me"));
    await waitFor(() => expect(pending.length).toBe(1));
    expect(pending[0].cursor).toBeUndefined(); // 首页不传 cursor
    act(() => pending[0].resolve({ records: [rec("a"), rec("b")], nextCursor: 2 }));
    await waitFor(() => expect(result.current.records.length).toBe(2));
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBe("");
  });

  it("到底（nextCursor=null）后 loadMore 不再发请求", async () => {
    const { engine, pending } = controllableEngine();
    vi.mocked(getCallEngine).mockReturnValue(engine);
    const { result } = renderHook(() => useCallHistory("me"));
    await waitFor(() => expect(pending.length).toBe(1));
    act(() => pending[0].resolve({ records: [rec("a")], nextCursor: null }));
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    act(() => result.current.loadMore());
    expect(pending.length).toBe(1); // 未新增请求
  });

  it("callEnd 重拉首页，作废在途的旧翻页请求（generation 计数器，不被旧应答覆盖）", async () => {
    const { engine, pending, emitCallEnd } = controllableEngine();
    vi.mocked(getCallEngine).mockReturnValue(engine);
    const { result } = renderHook(() => useCallHistory("me"));

    // ① 首页成功。
    await waitFor(() => expect(pending.length).toBe(1));
    act(() => pending[0].resolve({ records: [rec("a"), rec("b")], nextCursor: 2 }));
    await waitFor(() => expect(result.current.records.map((r) => r.callId)).toEqual(["a", "b"]));

    // ② 翻页发起但不 resolve（模拟仍在路上）。
    act(() => result.current.loadMore());
    await waitFor(() => expect(pending.length).toBe(2));
    expect(pending[1].cursor).toBe(2);

    // ③ callEnd 到达：重拉首页（第 3 个请求，不传 cursor）。
    act(() => emitCallEnd());
    await waitFor(() => expect(pending.length).toBe(3));
    expect(pending[2].cursor).toBeUndefined();

    // ④ 新首页（③）先 resolve。
    act(() => pending[2].resolve({ records: [rec("x"), rec("y")], nextCursor: null }));
    await waitFor(() => expect(result.current.records.map((r) => r.callId)).toEqual(["x", "y"]));

    // ⑤ 旧翻页请求（②）这时才姗姗来迟地 resolve（真实网络里常见的乱序应答）：
    // 代数已作废，**不该**把 "stale" 追加进已经刷新过的列表——这正是 generation 计数器要挡的场景
    // （若退化成"谁后到谁生效"，这里会错误变成 ["x","y","stale"]）。
    act(() => pending[1].resolve({ records: [rec("stale")], nextCursor: null }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.records.map((r) => r.callId)).toEqual(["x", "y"]); // 不含 "a" "b" "stale"
  });

  it("engine 未就绪（未登录/引擎没起来）→ network 错误态，不抛异常", async () => {
    vi.mocked(getCallEngine).mockReturnValue(null);
    const { result } = renderHook(() => useCallHistory("me"));
    await waitFor(() => expect(result.current.error).toBe("network"));
    expect(result.current.records).toEqual([]);
  });
});
