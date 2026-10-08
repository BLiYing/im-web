// @vitest-environment jsdom
// useCallHistory：首页/翻页、到底停止、callEnd 重拉首页并让在途翻页请求作废（generation 计数器）。
// engine 用受控 fake（外部决定何时 resolve），不碰真实网络/SDK。
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CallEngine } from "im-rtc-call-engine";
import type { CallHistoryPage, CallHistoryRecord } from "im-rtc-call-engine";
import { getCallEngine } from "./rtc/rtcCall";
import { useCallHistory } from "./useCallHistory";

// engineChangeListeners 用 vi.hoisted 声明：vi.mock 工厂会被提升到文件顶部，直接引用外层 const
// 在提升后可能还没初始化（TDZ），hoisted 是官方推荐的绕开方式。
const { engineChangeListeners } = vi.hoisted(() => ({ engineChangeListeners: [] as Array<() => void> }));

vi.mock("./rtc/rtcCall", () => ({
  // Kit 已登录：通话记录拉取前的 ensureRtcReady 直接放行（补登录本身由 im-rtc Kit 的单测覆盖）。
  ensureRtcReady: vi.fn(async () => true),
  getCallEngine: vi.fn(),
  onCallEngineChange: vi.fn((fn: () => void) => {
    engineChangeListeners.push(fn);
    return () => {
      const i = engineChangeListeners.indexOf(fn);
      if (i >= 0) engineChangeListeners.splice(i, 1);
    };
  }),
}));

/** 模拟 rtcCall.ts 的 registerCallEngine 在真实场景下的效果：引擎变了，通知所有订阅者。
 * 调用前先用 vi.mocked(getCallEngine).mockReturnValue(...) 把新引擎摆好。 */
function fireEngineChange(): void {
  engineChangeListeners.slice().forEach((fn) => fn());
}

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

  // /code-review 2026-09-29 发现：下面三条此前都会失败——engine 只在挂载那一刻读一次，
  // 后来才就绪/换了新实例都感知不到；未接自动续页失败后会立刻无限重试。

  it("挂载时引擎未就绪，之后才就绪：自动重新拉首页，不永久卡在 network 错误态", async () => {
    vi.mocked(getCallEngine).mockReturnValue(null);
    const { result } = renderHook(() => useCallHistory("me"));
    await waitFor(() => expect(result.current.error).toBe("network"));

    const { engine, pending } = controllableEngine();
    vi.mocked(getCallEngine).mockReturnValue(engine);
    act(() => fireEngineChange()); // 对应真实的 registerCallEngine(h.engine) 通知

    await waitFor(() => expect(pending.length).toBe(1));
    act(() => pending[0].resolve({ records: [rec("a")], nextCursor: null }));
    await waitFor(() => expect(result.current.records.length).toBe(1));
    expect(result.current.error).toBe("");
  });

  it("引擎更替后重新订阅新引擎的 callEnd，不再监听已经换掉的旧引擎", async () => {
    const engineA = controllableEngine();
    vi.mocked(getCallEngine).mockReturnValue(engineA.engine);
    const { result } = renderHook(() => useCallHistory("me"));
    await waitFor(() => expect(engineA.pending.length).toBe(1));
    act(() => engineA.pending[0].resolve({ records: [rec("a")], nextCursor: null }));
    await waitFor(() => expect(result.current.records.map((r) => r.callId)).toEqual(["a"]));

    // 换引擎（对应踢下线后重新登录）。
    const engineB = controllableEngine();
    vi.mocked(getCallEngine).mockReturnValue(engineB.engine);
    act(() => fireEngineChange());
    await waitFor(() => expect(engineB.pending.length).toBe(1)); // 引擎更替本身也重拉一次首页
    act(() => engineB.pending[0].resolve({ records: [rec("b")], nextCursor: null }));
    await waitFor(() => expect(result.current.records.map((r) => r.callId)).toEqual(["b"]));

    // 旧引擎发 callEnd：监听已经不在它身上了，不该触发新请求。
    act(() => engineA.emitCallEnd());
    expect(engineA.pending.length).toBe(1);
    expect(engineB.pending.length).toBe(1);

    // 新引擎发 callEnd：应该触发重拉首页。
    act(() => engineB.emitCallEnd());
    await waitFor(() => expect(engineB.pending.length).toBe(2));
  });

  it("未接自动续页遇到持续失败时停止自动重试（不打成死循环），点重试才继续", async () => {
    const { engine, pending } = controllableEngine();
    vi.mocked(getCallEngine).mockReturnValue(engine);
    const { result } = renderHook(() => useCallHistory("me"));
    act(() => result.current.setTab("missed"));

    await waitFor(() => expect(pending.length).toBe(1));
    // 首页 1 条非未接、还没到底 → 未接自动续页该发第 2 页。
    act(() => pending[0].resolve({ records: [rec("a", { caller: "me", durationSec: 5 })], nextCursor: 2 }));
    await waitFor(() => expect(pending.length).toBe(2));

    // 第 2 页失败：不该无限重试冒出第 3、4…个请求。
    act(() => pending[1].reject(new Error("boom")));
    await waitFor(() => expect(result.current.error).toBe("network"));
    await new Promise((r) => setTimeout(r, 20)); // 真死循环这里请求数会持续暴涨
    expect(pending.length).toBe(2);

    // 用户点重试：重新发一次（沿用同一游标），成功后错误态清空。
    act(() => result.current.retry());
    await waitFor(() => expect(pending.length).toBe(3));
    expect(pending[2].cursor).toBe(2);
    act(() => pending[2].resolve({ records: [], nextCursor: null }));
    await waitFor(() => expect(result.current.error).toBe(""));
  });
});
