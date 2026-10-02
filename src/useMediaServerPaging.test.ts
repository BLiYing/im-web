// @vitest-environment jsdom
// useMediaServerPaging：有缺口且在线才续拉；游标 / 空页上限 / 换会话丢旧页 / 清空位点 / 离线降级。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ChatMessage } from "./sdk/protocol";

const fetchConvMedia = vi.fn();
vi.mock("./sdk/convQueriesApi", () => ({ fetchConvMedia: (...a: unknown[]) => fetchConvMedia(...a) }));
import { useMediaServerPaging } from "./useMediaServerPaging";
afterEach(cleanup);
beforeEach(() => fetchConvMedia.mockReset());

const item = (seq: number) => ({ conv_seq: seq, server_msg_id: `s${seq}`, sender: "u", content_type: "image", content: `/u/${seq}.jpg`, timestamp: seq });
const local = (seq: number) => ({ convId: "g", from: "u", content: `/u/${seq}.jpg`, contentType: "image", convSeq: seq, timestamp: seq, status: "received" }) as ChatMessage;
const base = { convId: "g", enabled: true, oldestLocalSeq: 200, getToken: () => "tok", clearedUpTo: 0 };

describe("useMediaServerPaging", () => {
  it("续拉一页：从本地最旧往更旧取，回新增，并并到本地前面", async () => {
    fetchConvMedia.mockResolvedValueOnce({ conv_id: "g", items: [item(150), item(100)], next_cursor: 100, has_more: true });
    const { result } = renderHook(() => useMediaServerPaging(base));
    let added: ChatMessage[] | null = null;
    await act(async () => { added = await result.current.loadOlder(); });
    expect(fetchConvMedia.mock.calls[0][3]).toMatchObject({ cursor: 200, limit: 60, clearedUpTo: 0 });
    expect(added!.map((m) => m.convSeq)).toEqual([100, 150]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.merge([local(200), local(300)]).map((m) => m.convSeq)).toEqual([100, 150, 200, 300]);
  });

  it("第二页接着用服务端游标，不再回到本地最旧", async () => {
    fetchConvMedia.mockResolvedValueOnce({ conv_id: "g", items: [item(150)], next_cursor: 150, has_more: true });
    fetchConvMedia.mockResolvedValueOnce({ conv_id: "g", items: [item(100)], next_cursor: 0, has_more: false });
    const { result } = renderHook(() => useMediaServerPaging(base));
    await act(async () => { await result.current.loadOlder(); });
    await act(async () => { await result.current.loadOlder(); });
    expect(fetchConvMedia.mock.calls[1][3]).toMatchObject({ cursor: 150 });
    expect(result.current.hasMore).toBe(false);
  });

  it("空页却仍 has_more：接着往前翻，有上限", async () => {
    fetchConvMedia.mockResolvedValue({ conv_id: "g", items: [], next_cursor: 50, has_more: true });
    const { result } = renderHook(() => useMediaServerPaging(base));
    let added: ChatMessage[] | null = null;
    await act(async () => { added = await result.current.loadOlder(); });
    expect(added).toEqual([]);
    expect(fetchConvMedia).toHaveBeenCalledTimes(6);   // 1 + MAX_EMPTY_MEDIA_PAGES
    expect(result.current.hasMore).toBe(false);
  });

  it("失败（离线）回 null 且不再宣称有更多——调用方说一句降级提示", async () => {
    fetchConvMedia.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useMediaServerPaging(base));
    let added: ChatMessage[] | null = [];
    await act(async () => { added = await result.current.loadOlder(); });
    expect(added).toBeNull();
    expect(result.current.hasMore).toBe(false);
  });

  it("本地齐全（enabled=false）：不发请求、hasMore 恒假、merge 原样", async () => {
    const { result } = renderHook(() => useMediaServerPaging({ ...base, enabled: false }));
    await act(async () => { await result.current.loadOlder(); });
    expect(fetchConvMedia).not.toHaveBeenCalled();
    expect(result.current.hasMore).toBe(false);
    const l = [local(1)];
    expect(result.current.merge(l)).toBe(l);
  });

  it("清空位点原样透传给接口（过滤在 API 层）", async () => {
    fetchConvMedia.mockResolvedValueOnce({ conv_id: "g", items: [item(150)], next_cursor: 150, has_more: false });
    const { result } = renderHook(() => useMediaServerPaging({ ...base, clearedUpTo: 120 }));
    await act(async () => { await result.current.loadOlder(); });
    expect(fetchConvMedia.mock.calls[0][3]).toMatchObject({ clearedUpTo: 120 });
  });

  it("换会话：在途的旧页回来不进新会话", async () => {
    let resolve!: (v: unknown) => void;
    fetchConvMedia.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { result, rerender } = renderHook((p) => useMediaServerPaging(p), { initialProps: base });
    let pending: Promise<ChatMessage[] | null>;
    act(() => { pending = result.current.loadOlder(); });
    rerender({ ...base, convId: "other" });
    await act(async () => { resolve({ conv_id: "g", items: [item(150)], next_cursor: 150, has_more: true }); await pending; });
    expect(result.current.merge([local(200)]).map((m) => m.convSeq)).toEqual([200]);
  });
});
