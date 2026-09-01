// @vitest-environment jsdom
// useUserProfiles 的行为回归。盯住的是"看着能用、其实在刷接口"或"一次抖动毁十分钟"那几类：
// 合并成一次请求、同一 uid 不重复问、查无此人有负缓存、**失败不写负缓存**、换号即清空。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUserProfiles } from "./useUserProfiles";
import * as api from "./sdk/userProfileApi";
import type { UserCard } from "./sdk/protocol";

const card = (id: string): UserCard =>
  ({ user_id: id, nickname: `昵称${id}`, avatar_url: `/a/${id}.jpg`, tags: [], status: "active" });

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchSpy = vi.spyOn(api, "fetchUserProfilesBatch");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 推进合并窗口并排空微任务——两者都要，否则 await 出来的 setState 还没落到 hook 上。 */
async function flush() {
  await act(async () => {
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useUserProfiles", () => {
  it("把一次渲染里的多个 uid 合并成一次请求，并落进 cards", async () => {
    fetchSpy.mockResolvedValue({ users: [card("u1"), card("u2")], missing: [] });
    const { result } = renderHook(() => useUserProfiles("tok"));

    // 分三次声明（模拟多个 cell 各问各的）——合并窗口内只该发一次。
    act(() => {
      result.current.request(["u1"]);
      result.current.request(["u2", "u1"]);
      result.current.request(["", null, undefined, "  "]); // 空值一律丢弃
    });
    expect(fetchSpy).not.toHaveBeenCalled(); // 合并窗口内不发
    await flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]).toEqual(["u1", "u2"]);
    expect(result.current.cards.u1?.avatar_url).toBe("/a/u1.jpg");
    expect(result.current.cards.u2?.nickname).toBe("昵称u2");
  });

  it("已解析过的 uid 不再重复请求（cellForRow 那样每次渲染都问也不会刷接口）", async () => {
    fetchSpy.mockResolvedValue({ users: [card("u1")], missing: [] });
    const { result } = renderHook(() => useUserProfiles("tok"));
    act(() => { result.current.request(["u1"]); });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    act(() => { result.current.request(["u1"]); result.current.request(["u1"]); });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // 没有第二次
  });

  it("查无此人写负缓存：同一个 uid 不会每次渲染都重问一遍", async () => {
    fetchSpy.mockResolvedValue({ users: [], missing: ["ghost"] });
    const { result } = renderHook(() => useUserProfiles("tok"));
    act(() => { result.current.request(["ghost"]); });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.cards.ghost).toBeUndefined(); // 没有卡片，调用方走自己的兜底

    act(() => { result.current.request(["ghost"]); });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // 负缓存挡住了
  });

  it("**请求失败不写负缓存**，但要退避一小会——否则断网时会以渲染频率反复打同一个接口", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => useUserProfiles("tok"));
    act(() => { result.current.request(["u1"]); });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.cards.u1).toBeUndefined();

    // 退避窗口内：App 每重渲染一次就会重新声明这批 uid，**不该**每次都真发请求。
    // 没有退避的话服务端 60 次/分的配额几秒烧光，之后一直 429，网络恢复了也解析不出来。
    fetchSpy.mockResolvedValue({ users: [card("u1")], missing: [] });
    for (let i = 0; i < 5; i++) {
      act(() => { result.current.request(["u1"]); });
      await flush();
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 退避过去后照常重试——失败**不是**负缓存，那个 uid 还在屏幕上就该再问。
    await act(async () => { vi.advanceTimersByTime(6000); });
    act(() => { result.current.request(["u1"]); });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.cards.u1?.nickname).toBe("昵称u1");
  });

  it("超过单批上限时分批发，不是一把塞给服务端被整批拒", async () => {
    const many = Array.from({ length: api.USER_BATCH_MAX + 5 }, (_, i) => `u${i}`);
    fetchSpy.mockImplementation(async (_t: string, ids: string[]) =>
      ({ users: ids.map(card), missing: [] }));
    const { result } = renderHook(() => useUserProfiles("tok"));
    act(() => { result.current.request(many); });
    await flush();
    await flush(); // 第二批由第一批的 finally 排出

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((fetchSpy.mock.calls[0][1] as string[]).length).toBe(api.USER_BATCH_MAX);
    expect((fetchSpy.mock.calls[1][1] as string[]).length).toBe(5);
  });

  it("没有 token 时不发请求，也不把待解析队列攒着（登录后一次性涌出一大批早已离屏的 uid）", async () => {
    const { result } = renderHook(() => useUserProfiles(""));
    act(() => { result.current.request(["u1", "u2"]); });
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("换号（token 变了）即清空缓存", async () => {
    fetchSpy.mockResolvedValue({ users: [card("u1")], missing: [] });
    const { result, rerender } = renderHook(({ t }) => useUserProfiles(t), { initialProps: { t: "tok1" } });
    act(() => { result.current.request(["u1"]); });
    await flush();
    expect(result.current.cards.u1).toBeDefined();

    rerender({ t: "tok2" });
    expect(result.current.cards.u1).toBeUndefined();
    // 清空后同一个 uid 应该能被重新解析（不是被"已问过"的标记永久挡住）。
    act(() => { result.current.request(["u1"]); });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
