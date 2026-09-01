// @vitest-environment jsdom
// useMemberSearch 的行为回归。盯住的都是"界面看着正常、结果悄悄错"的那几类：
// 走没走服务端、过期响应有没有被丢弃、失败会不会把结果清成"没有匹配"、换群会不会串。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMemberSearch, MEMBER_SEARCH_DEBOUNCE_MS } from "./useMemberSearch";
import * as api from "./sdk/serverConfigApi";
import type { GroupMember } from "./sdk/protocol";

const member = (id: string): GroupMember => ({ user_id: id, role: "member" } as GroupMember);
const page = (ids: string[], hasMore = false, next = "") =>
  ({ members: ids.map(member), next_cursor: next, has_more: hasMore });

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchSpy = vi.spyOn(api, "fetchGroupMembersPage");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 推进去抖计时器并把微任务排空——两者都要，否则 await 出来的 setState 还没落到 hook 上。 */
async function flush() {
  await act(async () => {
    vi.advanceTimersByTime(MEMBER_SEARCH_DEBOUNCE_MS + 10);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useMemberSearch", () => {
  it("输入后经去抖打服务端，把结果放进 results 并进入搜索态", async () => {
    fetchSpy.mockResolvedValue(page(["u1", "u2"]));
    const { result } = renderHook(() => useMemberSearch("g1", "tok"));

    act(() => { result.current.setQuery("big"); });
    expect(fetchSpy).not.toHaveBeenCalled(); // 去抖窗口内不该发请求
    await flush();

    expect(fetchSpy).toHaveBeenCalledWith("tok", "g1", { q: "big", limit: 50 });
    expect(result.current.results.map((m) => m.user_id)).toEqual(["u1", "u2"]);
    expect(result.current.needle).toBe("big"); // 搜索态：界面据此切成"显示结果"
  });

  it("连续打字只发最后一次（去抖），且**丢弃过期响应**", async () => {
    // 第一次请求故意慢：它 resolve 时用户已经改了词，此时若不丢弃，
    // 列表会闪回旧关键词的答案——iOS @人选择器早就踩过这条。
    let resolveSlow: ((v: unknown) => void) | undefined;
    fetchSpy
      .mockImplementationOnce(() => new Promise((r) => { resolveSlow = r; }))
      .mockResolvedValueOnce(page(["新词命中"]));

    const { result } = renderHook(() => useMemberSearch("g1", "tok"));
    act(() => { result.current.setQuery("旧词"); });
    await flush();                                  // 发出第 1 次（挂起）
    act(() => { result.current.setQuery("新词"); });
    await flush();                                  // 发出第 2 次（立即返回）
    expect(result.current.results.map((m) => m.user_id)).toEqual(["新词命中"]);

    // 迟到的第 1 次现在才回 —— 必须被丢弃。
    await act(async () => { resolveSlow?.(page(["旧词命中"])); await Promise.resolve(); });
    expect(result.current.results.map((m) => m.user_id)).toEqual(["新词命中"]);
  });

  it("清空搜索词 → 回浏览态（results 清空、needle 为空）", async () => {
    fetchSpy.mockResolvedValue(page(["u1"]));
    const { result } = renderHook(() => useMemberSearch("g1", "tok"));
    act(() => { result.current.setQuery("big"); });
    await flush();
    expect(result.current.needle).toBe("big");

    act(() => { result.current.setQuery(""); });
    expect(result.current.needle).toBe("");
    expect(result.current.results).toEqual([]);
  });

  it("请求失败**保留上一次结果**，不清空成「没有匹配」", async () => {
    fetchSpy.mockResolvedValueOnce(page(["u1"]));
    const { result } = renderHook(() => useMemberSearch("g1", "tok"));
    act(() => { result.current.setQuery("big"); });
    await flush();
    expect(result.current.results).toHaveLength(1);

    fetchSpy.mockRejectedValueOnce(new Error("网断了"));
    act(() => { result.current.setQuery("bigg"); });
    await flush();
    // 清空会让用户以为"查无此人"，而不是网络问题——这两件事必须能分辨。
    expect(result.current.results.map((m) => m.user_id)).toEqual(["u1"]);
    expect(result.current.failed).toBe(true);
  });

  it("结果分页：loadMore 追加下一页，并按 user_id 去重", async () => {
    fetchSpy.mockResolvedValueOnce(page(["u1", "u2"], true, "u2"));
    const { result } = renderHook(() => useMemberSearch("g1", "tok"));
    act(() => { result.current.setQuery("big"); });
    await flush();
    expect(result.current.hasMore).toBe(true);

    // 第二页与第一页重叠 u2（游标翻页期间有人进群/退群会真的发生）。
    fetchSpy.mockResolvedValueOnce(page(["u2", "u3"], false, ""));
    await act(async () => { result.current.loadMore(); await Promise.resolve(); });
    expect(result.current.results.map((m) => m.user_id)).toEqual(["u1", "u2", "u3"]);
    expect(fetchSpy).toHaveBeenLastCalledWith("tok", "g1", { q: "big", cursor: "u2", limit: 50 });
    expect(result.current.hasMore).toBe(false);
  });

  it("换群整体复位——上个群的搜索结果绝不能留在新群里", async () => {
    fetchSpy.mockResolvedValue(page(["u1"]));
    const { result, rerender } = renderHook(({ cid }) => useMemberSearch(cid, "tok"),
      { initialProps: { cid: "g1" } });
    act(() => { result.current.setQuery("big"); });
    await flush();
    expect(result.current.results).toHaveLength(1);

    rerender({ cid: "g2" });
    expect(result.current.query).toBe("");
    expect(result.current.needle).toBe("");
    expect(result.current.results).toEqual([]);
  });

  it("纯空白搜索词不发请求（normalizeQuery 归一后为空）", async () => {
    const { result } = renderHook(() => useMemberSearch("g1", "tok"));
    act(() => { result.current.setQuery("   "); });
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.needle).toBe("");
  });

  it("没有 token 时不发请求（未登录/token 还没就位）", async () => {
    const { result } = renderHook(() => useMemberSearch("g1", ""));
    act(() => { result.current.setQuery("big"); });
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
