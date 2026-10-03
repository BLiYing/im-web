// @vitest-environment jsdom
// useMediaServerPaging：有缺口且在线才续拉；游标 / 空页上限 / 换会话丢旧页 / 清空位点 / 离线降级。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ChatMessage } from "./sdk/protocol";

const fetchConvMedia = vi.fn();
vi.mock("./sdk/convQueriesApi", () => ({ fetchConvMedia: (...a: unknown[]) => fetchConvMedia(...a) }));
import { useMediaServerPaging } from "./useMediaServerPaging";
afterEach(cleanup);
beforeEach(() => { fetchConvMedia.mockReset(); }); // 别写成表达式体：返回的 mock 会被 vitest 当 teardown 回调再调用一次

const item = (seq: number) => ({ conv_seq: seq, server_msg_id: `s${seq}`, sender: "u", content_type: "image", content: `/u/${seq}.jpg`, timestamp: seq });
const local = (seq: number) => ({ convId: "g", from: "u", content: `/u/${seq}.jpg`, contentType: "image", convSeq: seq, timestamp: seq, status: "received" }) as ChatMessage;
const base = { convId: "g", enabled: true, oldestLocalSeq: 200, newestLocalSeq: 300, getToken: () => "tok", clearedUpTo: 0 };

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
    expect(result.current.hasMore).toBe(true);        // 只结束这一次，不永久置假
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

  it("本地窗口后来上翻得比服务端游标还旧：游标取最小，不从更新处重复翻、也不把 hasMore 永久置假", async () => {
    fetchConvMedia.mockResolvedValueOnce({ conv_id: "g", items: [item(150)], next_cursor: 150, has_more: true });
    fetchConvMedia.mockResolvedValueOnce({ conv_id: "g", items: [item(40)], next_cursor: 40, has_more: true });
    const { result, rerender } = renderHook((p) => useMediaServerPaging(p), { initialProps: base });
    await act(async () => { await result.current.loadOlder(); });
    rerender({ ...base, oldestLocalSeq: 100 });   // 用户把本地窗口上翻到 100（比服务端游标 150 更旧）
    await act(async () => { await result.current.loadOlder(); });
    expect(fetchConvMedia.mock.calls[1][3]).toMatchObject({ cursor: 100 });
  });

  it("连翻 6 页全是空页：只结束这一次，hasMore 不被永久置假（下次还能要）", async () => {
    fetchConvMedia.mockResolvedValue({ conv_id: "g", items: [], next_cursor: 50, has_more: true });
    const { result } = renderHook(() => useMediaServerPaging(base));
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.hasMore).toBe(true);
  });

  it("enabled 翻转（掉线）：已续拉来的留着，查看器停在续拉来的那一张不会消失", async () => {
    fetchConvMedia.mockResolvedValueOnce({ conv_id: "g", items: [item(150)], next_cursor: 150, has_more: true });
    const { result, rerender } = renderHook((p) => useMediaServerPaging(p), { initialProps: base });
    await act(async () => { await result.current.loadOlder(); });
    rerender({ ...base, enabled: false });
    expect(result.current.merge([local(200)]).map((m) => m.convSeq)).toEqual([150, 200]);
    expect(result.current.hasMore).toBe(false);
  });

  it("换会话那一帧：上个会话续拉来的不闪进新会话", async () => {
    fetchConvMedia.mockResolvedValueOnce({ conv_id: "g", items: [item(150)], next_cursor: 150, has_more: true });
    const frames: { conv: string; seqs: number[] }[] = [];   // 每一次渲染（含 effect 重置之前那一帧）的合并结果
    const { result, rerender } = renderHook((p) => {
      const h = useMediaServerPaging(p);
      frames.push({ conv: p.convId, seqs: h.merge([local(200)]).map((m) => m.convSeq) });
      return h;
    }, { initialProps: base });
    await act(async () => { await result.current.loadOlder(); });
    rerender({ ...base, convId: "other" });
    expect(frames.filter((f) => f.conv === "other").every((f) => f.seqs.join() === "200")).toBe(true);
  });

  it("向更新续拉：用 after=本地最新，升序拼到后面，游标接着用上一页最末", async () => {
    fetchConvMedia.mockResolvedValueOnce({ conv_id: "g", items: [item(320), item(310)], next_cursor: 320, has_more: true });
    fetchConvMedia.mockResolvedValueOnce({ conv_id: "g", items: [item(400)], next_cursor: 0, has_more: false });
    const { result } = renderHook(() => useMediaServerPaging(base));
    let added: ChatMessage[] | null = null;
    await act(async () => { added = await result.current.loadNewer(); });
    expect(fetchConvMedia.mock.calls[0][3]).toMatchObject({ after: 300, limit: 60 });
    expect(added!.map((m) => m.convSeq)).toEqual([310, 320]);
    expect(result.current.hasMoreNewer).toBe(true);
    await act(async () => { await result.current.loadNewer(); });
    expect(fetchConvMedia.mock.calls[1][3]).toMatchObject({ after: 320 });
    expect(result.current.hasMoreNewer).toBe(false);
    expect(result.current.merge([local(200), local(300)]).map((m) => m.convSeq)).toEqual([200, 300, 310, 320, 400]);
  });

  it("向更新失败（离线）回 null 且不再宣称有更新的", async () => {
    fetchConvMedia.mockImplementation(() => Promise.reject(new Error("offline")));
    const { result } = renderHook(() => useMediaServerPaging(base));
    let added: ChatMessage[] | null = [];
    await act(async () => { added = await result.current.loadNewer(); });
    expect(added).toBeNull();
    expect(result.current.hasMoreNewer).toBe(false);
  });

  it("本地齐全（enabled=false）：向更新也不发请求", async () => {
    const { result } = renderHook(() => useMediaServerPaging({ ...base, enabled: false }));
    await act(async () => { await result.current.loadNewer(); });
    expect(fetchConvMedia).not.toHaveBeenCalled();
    expect(result.current.hasMoreNewer).toBe(false);
  });

  it("向更新：服务端说 has_more 却一直没有可并进来的（重复页 / 全被过滤）→ 只翻到上限就停下这一次，不无界空转", async () => {
    fetchConvMedia.mockResolvedValue({ conv_id: "g", items: [item(250)], next_cursor: 250, has_more: true });   // 250 不比本地最新 300 更新
    const { result } = renderHook(() => useMediaServerPaging(base));
    let added: ChatMessage[] | null = null;
    await act(async () => { added = await result.current.loadNewer(); });
    expect(added).toEqual([]);
    expect(fetchConvMedia).toHaveBeenCalledTimes(6);   // 1 + MAX_EMPTY_MEDIA_PAGES
  });

  it("同 enabled 下换会话：上个会话置假的 hasMore / hasMoreNewer 回到 true", async () => {
    fetchConvMedia.mockImplementation(() => Promise.reject(new Error("offline")));
    const { result, rerender } = renderHook((p) => useMediaServerPaging(p), { initialProps: base });
    await act(async () => { await result.current.loadOlder(); await result.current.loadNewer(); });
    expect(result.current.hasMore).toBe(false);
    expect(result.current.hasMoreNewer).toBe(false);
    rerender({ ...base, convId: "other" });   // enabled 没变
    expect(result.current.hasMore).toBe(true);
    expect(result.current.hasMoreNewer).toBe(true);
  });

  it("向更新：空页却仍 has_more（逐人隐藏）→ 用服务端游标接着往后翻，有上限", async () => {
    fetchConvMedia.mockResolvedValueOnce({ conv_id: "g", items: [], next_cursor: 350, has_more: true });
    fetchConvMedia.mockResolvedValueOnce({ conv_id: "g", items: [item(360)], next_cursor: 0, has_more: false });
    const { result } = renderHook(() => useMediaServerPaging(base));
    let added: ChatMessage[] | null = null;
    await act(async () => { added = await result.current.loadNewer(); });
    expect(fetchConvMedia.mock.calls[1][3]).toMatchObject({ after: 350 });   // 第二次用的是服务端游标，不是原地重复
    expect(added!.map((m) => m.convSeq)).toEqual([360]);
  });

  it("向更新：没有起点（newestLocalSeq=0）不发请求——after=0 在服务端是「从下界起」", async () => {
    const { result } = renderHook(() => useMediaServerPaging({ ...base, newestLocalSeq: 0 }));
    let added: ChatMessage[] | null = null;
    await act(async () => { added = await result.current.loadNewer(); });
    expect(added).toEqual([]);
    expect(fetchConvMedia).not.toHaveBeenCalled();
  });
});
