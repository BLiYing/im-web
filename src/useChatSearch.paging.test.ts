// @vitest-environment jsdom
//
// 会话内搜索的服务端翻页（「只能拿一页」那条欠账）。钉的都是翻错了也不报错的：
//   · 翻到最旧命中再按 ▲ 没去要下一页——计数写着 50+，却永远翻不过去；
//   · 要下一页没带 cursor——拿回来还是第一页，命中集原地打转；
//   · 更旧的命中拼错位置 / 当前下标没跟着挪——▲ 一下跳到了别的命中上；
//   · 词在请求途中改了——旧词的第二页混进新词的命中集；
//   · 服务端过滤出空页但仍 has_more——停在原地，用户以为到头了。
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, cleanup, waitFor, act } from "@testing-library/react";
import { useChatSearch, type ChatSearchDeps } from "./useChatSearch";
import type { ChatMessage } from "./sdk/protocol";
import * as api from "./sdk/convQueriesApi";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.useRealTimers(); });

const CONV = "g_gap";
const LOCAL_TAIL = [{ convId: CONV, from: "u2", content: "尾巴", contentType: "text", convSeq: 1000,
  timestamp: 1_700_000_000_000, status: "received" } as ChatMessage];

/** 服务端一页：seqs 按服务端的**倒序**给。 */
const page = (seqs: number[], hasMore: boolean, nextCursor: number): api.ConvSearchPage => ({
  conv_id: CONV, has_more: hasMore, next_cursor: nextCursor,
  items: seqs.map((s) => ({ conv_seq: s, server_msg_id: `s${s}`, sender: "u2", content_type: "text", content: "积压", timestamp: s })),
});

function mount(over: Partial<ChatSearchDeps> = {}) {
  const deps: ChatSearchDeps = {
    searchOpen: true, setSearchOpen: vi.fn(), searchQuery: "积压", setSearchQuery: vi.fn(),
    allMessages: LOCAL_TAIL, convId: CONV, groupConvId: CONV, uid: "u1", groupInfos: {}, conversations: [],
    locateInChat: vi.fn(), setToast: vi.fn(), localComplete: false, online: true, getToken: () => "tok",
    ...over,
  };
  return { deps, ...renderHook((p: ChatSearchDeps) => useChatSearch(p), { initialProps: deps }) };
}

const hitSeqs = (r: { current: ReturnType<typeof useChatSearch> }) => r.current.searchHits.map((h) => h.convSeq);
/** 首页命中到达时 Hook 会在下一帧（rAF）自动「跳最新」。不等它落地就按 ▲，那一跳会晚于翻页的定位触发，
 *  「最后一次跳到哪」就被它盖掉——测的就不是翻页了。 */
const settleDefaultJump = () => new Promise((r) => setTimeout(r, 50));

describe("会话内搜索 · 服务端翻页", () => {
  it("▲ 翻过最旧命中 → 带 next_cursor 要下一页，拼到前面并落到紧挨着的那一条", async () => {
    const spy = vi.spyOn(api, "searchConvMessages")
      .mockResolvedValueOnce(page([300, 250, 200], true, 200))
      .mockResolvedValueOnce(page([150, 100], false, 0));
    const { result, deps } = mount();
    await waitFor(() => expect(hitSeqs(result)).toEqual([200, 250, 300]));
    expect(result.current.hitsTruncated).toBe(true);
    await settleDefaultJump();

    act(() => result.current.gotoSearchHit(0));
    act(() => result.current.gotoSearchHit(-1));

    await waitFor(() => expect(hitSeqs(result)).toEqual([100, 150, 200, 250, 300]));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][2]).toBe("积压");
    expect(spy.mock.calls[1][3]).toEqual(expect.objectContaining({ cursor: 200 }));
    expect(result.current.searchHitIdx).toBe(1);                       // 150：紧挨着原最旧的 200
    expect(deps.locateInChat).toHaveBeenLastCalledWith(CONV, 150);
    expect(result.current.hitsTruncated).toBe(false);                   // 服务端说没有更多了
  });

  it("没有更多页（has_more=false）→ 在最旧命中上按 ▲ 不发请求", async () => {
    const spy = vi.spyOn(api, "searchConvMessages").mockResolvedValueOnce(page([300, 200], false, 0));
    const { result } = mount();
    await waitFor(() => expect(hitSeqs(result)).toEqual([200, 300]));
    act(() => result.current.gotoSearchHit(0));
    act(() => result.current.gotoSearchHit(-1));
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("本地齐全的会话不走服务端 → 越界按 ▲ 一个请求都不发", async () => {
    const spy = vi.spyOn(api, "searchConvMessages");
    const { result } = mount({ localComplete: true, searchQuery: "尾巴" });
    await waitFor(() => expect(hitSeqs(result)).toEqual([1000]));
    act(() => result.current.gotoSearchHit(-1));
    await new Promise((r) => setTimeout(r, 400));
    expect(spy).not.toHaveBeenCalled();
  });

  it("翻页途中改了关键词 → 旧词的下一页丢弃，不混进新词的命中集", async () => {
    let releaseOld: (p: api.ConvSearchPage) => void = () => {};
    const spy = vi.spyOn(api, "searchConvMessages")
      .mockResolvedValueOnce(page([300, 200], true, 200))
      .mockImplementationOnce(() => new Promise((res) => { releaseOld = res; }))
      .mockResolvedValueOnce(page([900], false, 0));
    const { result, rerender, deps } = mount();
    await waitFor(() => expect(hitSeqs(result)).toEqual([200, 300]));
    act(() => result.current.gotoSearchHit(0));
    act(() => result.current.gotoSearchHit(-1));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

    rerender({ ...deps, searchQuery: "新词" });
    await waitFor(() => expect(hitSeqs(result)).toEqual([900]));
    await act(async () => { releaseOld(page([150, 100], false, 0)); await Promise.resolve(); });
    await new Promise((r) => setTimeout(r, 50));
    expect(hitSeqs(result)).toEqual([900]);
  });

  it("服务端过滤出空页但仍 has_more → 一次 ▲ 里接着往前翻，直到拿到命中", async () => {
    const spy = vi.spyOn(api, "searchConvMessages")
      .mockResolvedValueOnce(page([300], true, 300))
      .mockResolvedValueOnce(page([], true, 250))
      .mockResolvedValueOnce(page([120], false, 0));
    const { result, deps } = mount();
    await waitFor(() => expect(hitSeqs(result)).toEqual([300]));
    await settleDefaultJump();
    act(() => result.current.gotoSearchHit(-1));
    await waitFor(() => expect(hitSeqs(result)).toEqual([120, 300]));
    expect(spy.mock.calls.map((c) => c[3]?.cursor)).toEqual([undefined, 300, 250]);
    expect(result.current.searchHitIdx).toBe(0);
    expect(deps.locateInChat).toHaveBeenLastCalledWith(CONV, 120);
  });
});
