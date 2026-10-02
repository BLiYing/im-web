// @vitest-environment jsdom
/**
 * useLocalPreload：会话刷新只登记新冒出来的会话（2026-09-11）。
 *
 * 旧写法每次会话刷新（开窗 / 翻页 / conv_bump / 实时消息都会触发）都 preloadLocal(全部会话)：
 * 整份 getAll 每个会话的本地消息再丢掉，外加对全部会话 sync。错了界面照常，只是越用越慢——
 * 所以按「会怎么错」钉。App 的接线在 App.conversationRefresh.test.tsx，SDK 契约在 sdk/syncTracked.test.ts。
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalPreload } from "./useLocalPreload";
import { fakeClientRef } from "./testing/fakeIMClient";
import type { ChatMessage, Conversation } from "./sdk/protocol";

const conv = (id: string, over: Partial<Conversation> = {}) => ({ conv_id: id, ...over } as Conversation);

function fakeClient(loadLocal = vi.fn(async (cid: string) => [{ convId: cid, convSeq: 1 } as ChatMessage])) {
  return {
    loadLocal,
    loadSyncCursor: vi.fn(async () => 42),
    loadClearedUpTo: vi.fn(async () => 0),
    loadDeletedSeqs: vi.fn(async () => [] as number[]),
    trackConversation: vi.fn(),
  };
}

function setup(client = fakeClient()) {
  const clientRef = fakeClientRef(client);
  const preloadMsgs = vi.fn();
  const seenByConv = { current: {} as Record<string, Set<number>> };
  const deletedByConv = { current: {} as Record<string, Set<number>> };
  const { result } = renderHook(() => useLocalPreload({ clientRef, seenByConv, deletedByConv, preloadMsgs }));
  return { client, clientRef, preloadMsgs, result };
}

const loadedIds = (c: ReturnType<typeof fakeClient>) => c.loadLocal.mock.calls.map((a) => a[0]);

describe("preloadNew（会话刷新用）", () => {
  it("已预载过的会话不再整份重读本地库，也不算作要同步的", async () => {
    const { client, result } = setup();
    await act(() => result.current.preloadLocal([conv("a"), conv("b")]));
    let fresh: string[] = ["未返回"];
    await act(async () => { fresh = await result.current.preloadNew([conv("a"), conv("b")]); });
    expect(fresh).toEqual([]);
    expect(loadedIds(client)).toEqual(["a", "b"]);
  });

  it("刷新里新冒出来的会话才预载，按本地游标登记，并返回它", async () => {
    const { client, result } = setup();
    await act(() => result.current.preloadLocal([conv("a")]));
    let fresh: string[] = [];
    await act(async () => { fresh = await result.current.preloadNew([conv("a"), conv("c")]); });
    expect(fresh).toEqual(["c"]);
    expect(loadedIds(client)).toEqual(["a", "c"]);
    expect(client.trackConversation).toHaveBeenCalledWith("c", 42, false, 0);
  });

  it("已登记的会话只刷新超级群标记（群刚升级），游标传 0——SDK 不拿它盖基线", async () => {
    const { client, result } = setup();
    await act(() => result.current.preloadLocal([conv("g")]));
    client.trackConversation.mockClear();
    await act(async () => { await result.current.preloadNew([conv("g", { is_super: true })]); });
    expect(client.trackConversation.mock.calls).toEqual([["g", 0, true]]);
  });

  it("换了 client（重新登录 / 切号）就重新预载：登记表跟着 client 走", async () => {
    const { result, clientRef } = setup();
    await act(() => result.current.preloadLocal([conv("a")]));
    const next = fakeClient();
    clientRef.current = next as never;
    let fresh: string[] = [];
    await act(async () => { fresh = await result.current.preloadNew([conv("a")]); });
    expect(fresh).toEqual(["a"]);
    expect(loadedIds(next)).toEqual(["a"]);
  });

  it("首次预载还没登记完时又来一次刷新：不能拿 0 抢先登记它（基线只认第一次，会把游标占成 0）", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const client = fakeClient(vi.fn(async (cid: string) => { await gate; return [{ convId: cid, convSeq: 1 } as ChatMessage]; }));
    const { result } = setup(client);
    let first: Promise<void> = Promise.resolve();
    let second: Promise<string[]> = Promise.resolve([]);
    act(() => { first = result.current.preloadLocal([conv("a")]); });
    act(() => { second = result.current.preloadNew([conv("a")]); });
    await act(async () => { release(); await first; await second; });
    expect(client.trackConversation.mock.calls.filter((a) => a[1] === 0)).toEqual([]);
  });

  // §6.7：本机清空位点必须在**首个 sync_req 之前**交给 SDK（登记时一并带上），否则重登后第一批补拉回来的页
  // 没有位点可挡，刚清空的会话又被塞满。读位点却不传＝清空只在本进程内有效，重启就失效。
  it("本机清空位点随登记一起交给 SDK（trackConversation 的第 4 个参数）", async () => {
    const client = fakeClient();
    client.loadClearedUpTo.mockImplementation(async () => 77);
    const { result } = setup(client);
    await act(() => result.current.preloadLocal([conv("a")]));
    expect(client.trackConversation).toHaveBeenCalledWith("a", 42, false, 77);
  });
});
