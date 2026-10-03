// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ChatMessage } from "./sdk/protocol";

const fetchConvMedia = vi.fn();
vi.mock("./sdk/convQueriesApi", () => ({ fetchConvMedia: (...a: unknown[]) => fetchConvMedia(...a) }));
import { unionByConvSeq, useDetailServerArchive } from "./useDetailServerArchive";
afterEach(cleanup);
beforeEach(() => { fetchConvMedia.mockReset(); }); // 别写成表达式体：返回的 mock 会被 vitest 当 teardown 回调再调用一次

const item = (seq: number, type = "image") => ({ conv_seq: seq, server_msg_id: `s${seq}`, sender: "u", content_type: type, content: `/u/${seq}`, timestamp: seq });
const local = (seq: number): ChatMessage => ({ convId: "g", from: "u", content: `/u/${seq}`, contentType: "image", convSeq: seq, timestamp: seq, status: "received" });
const base = { convId: "g", enabled: true, getToken: () => "tok", clearedUpTo: 0 };
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };

describe("unionByConvSeq", () => {
  it("按 convSeq 去重，本地优先；convSeq<=0 的服务端项不收", () => {
    const l = [local(5)];
    const u = unionByConvSeq(l, [{ ...local(5), fileName: "x" }, local(9), local(0)]);
    expect(u.map((m) => m.convSeq)).toEqual([5, 9]);
    expect(u[0].fileName).toBeUndefined();   // 保留的是本地那行
  });
  it("服务端为空原样返回", () => { const l = [local(1)]; expect(unionByConvSeq(l, [])).toBe(l); });
});

describe("useDetailServerArchive", () => {
  it("开着就把三类各要第一页（cursor=0），并进本地", async () => {
    fetchConvMedia.mockImplementation(async (_t: string, _c: string, kind: string) => ({
      conv_id: "g", items: kind === "media" ? [item(30), item(20)] : kind === "file" ? [item(25, "file")] : [], next_cursor: 20, has_more: kind === "media",
    }));
    const { result } = renderHook(() => useDetailServerArchive(base));
    await flush();
    expect(fetchConvMedia.mock.calls.map((c) => c[2]).sort()).toEqual(["file", "media", "voice"]);
    expect(fetchConvMedia.mock.calls.every((c) => c[3].cursor === 0)).toBe(true);
    expect(result.current.merge([local(10)]).map((m) => m.convSeq).sort((a, b) => a - b)).toEqual([10, 20, 25, 30]);
    expect(result.current.hasMore("media")).toBe(true);
    expect(result.current.hasMore("file")).toBe(false);
  });

  it("loadMore 用该类上一页的游标", async () => {
    fetchConvMedia.mockResolvedValue({ conv_id: "g", items: [item(30)], next_cursor: 30, has_more: true });
    const { result } = renderHook(() => useDetailServerArchive(base));
    await flush();
    fetchConvMedia.mockClear();
    fetchConvMedia.mockResolvedValue({ conv_id: "g", items: [item(10)], next_cursor: 0, has_more: false });
    act(() => result.current.loadMore("media"));
    await flush();
    expect(fetchConvMedia.mock.calls[0][2]).toBe("media");
    expect(fetchConvMedia.mock.calls[0][3]).toMatchObject({ cursor: 30 });
    expect(result.current.hasMore("media")).toBe(false);
  });

  it("本地齐全（enabled=false）：不发请求、merge 原样", async () => {
    const { result } = renderHook(() => useDetailServerArchive({ ...base, enabled: false }));
    await flush();
    expect(fetchConvMedia).not.toHaveBeenCalled();
    const l = [local(1)];
    expect(result.current.merge(l)).toBe(l);
    expect(result.current.hasMore("media")).toBe(false);
  });

  it("失败（离线）：该类 hasMore 置假，不再重试", async () => {
    fetchConvMedia.mockImplementation(() => Promise.reject(new Error("offline")));  // 惰性：每次调用才造 rejection
    const { result } = renderHook(() => useDetailServerArchive(base));
    await flush();
    expect(result.current.hasMore("media")).toBe(false);
  });

  it("清空位点透传给接口", async () => {
    fetchConvMedia.mockResolvedValue({ conv_id: "g", items: [], next_cursor: 0, has_more: false });
    renderHook(() => useDetailServerArchive({ ...base, clearedUpTo: 77 }));
    await flush();
    expect(fetchConvMedia.mock.calls[0][3]).toMatchObject({ clearedUpTo: 77 });
  });

  it("换会话：在途旧页不进新会话", async () => {
    let resolve!: (v: unknown) => void;
    fetchConvMedia.mockReturnValueOnce(new Promise((r) => { resolve = r; })).mockResolvedValue({ conv_id: "x", items: [], next_cursor: 0, has_more: false });
    const { result, rerender } = renderHook((p) => useDetailServerArchive(p), { initialProps: base });
    rerender({ ...base, convId: "other" });
    await act(async () => { resolve({ conv_id: "g", items: [item(99)], next_cursor: 99, has_more: true }); await Promise.resolve(); });
    await flush();
    expect(result.current.merge([local(1)]).map((m) => m.convSeq)).toEqual([1]);
    expect(result.current.hasMore("media")).toBe(false);   // 旧页的 has_more=true 不能污染新会话的状态
  });

  it("enabled 翻转（掉线→重连）：已拉到的留着，不重发已要过的类", async () => {
    fetchConvMedia.mockResolvedValue({ conv_id: "g", items: [item(30)], next_cursor: 0, has_more: false });
    const { result, rerender } = renderHook((p) => useDetailServerArchive(p), { initialProps: base });
    await flush();
    expect(fetchConvMedia).toHaveBeenCalledTimes(3);
    rerender({ ...base, enabled: false });   // 掉线
    await flush();
    expect(result.current.merge([local(10)]).map((m) => m.convSeq).sort((a, b) => a - b)).toEqual([10, 30]);   // 事实别丢
    rerender({ ...base, enabled: true });    // 重连
    await flush();
    expect(fetchConvMedia).toHaveBeenCalledTimes(3);   // 三类都要过第一页：不重发
    expect(result.current.merge([local(10)]).map((m) => m.convSeq).sort((a, b) => a - b)).toEqual([10, 30]);
  });

  it("enabled 翻转时从没要成功过的类，重连后补要", async () => {
    fetchConvMedia.mockImplementation(() => Promise.reject(new Error("offline")));
    const { rerender } = renderHook((p) => useDetailServerArchive(p), { initialProps: base });
    await flush();
    fetchConvMedia.mockReset();
    fetchConvMedia.mockResolvedValue({ conv_id: "g", items: [], next_cursor: 0, has_more: false });
    rerender({ ...base, enabled: false });
    rerender({ ...base, enabled: true });
    await flush();
    expect(fetchConvMedia).toHaveBeenCalledTimes(3);   // 三类第一页都没成功过：重连后各补一次
  });
});
