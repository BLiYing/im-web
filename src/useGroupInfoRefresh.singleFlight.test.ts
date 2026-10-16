// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useGroupInfoRefresh } from "./useGroupInfoRefresh";
import type { GroupInfo } from "./sdk/protocol";

afterEach(cleanup);
// 群帧连发（一次邀请 100 人）时，refreshGroupInfo 必须单飞 + 置脏补拉：N 次调用至多 2 次 GET。
describe("useGroupInfoRefresh single-flight", () => {
  it("coalesces a burst of calls into at most two fetches", async () => {
    let n = 0;
    const fetchGroup = vi.fn(async () => ({ conv_id: "g1", member_count: ++n }) as unknown as GroupInfo);
    const clientRef = { current: { fetchGroup } } as never;
    const setGroupInfos = vi.fn();
    const { result } = renderHook(() => useGroupInfoRefresh(clientRef, setGroupInfos, "", {}, {}));
    const calls = Array.from({ length: 100 }, () => result.current("g1"));
    const infos = await Promise.all(calls);
    expect(fetchGroup).toHaveBeenCalledTimes(2);
    // 首个调用拿首轮结果；其余 99 个拿**补拉那一轮**（它们要的是调用之后的最新态）
    expect((infos[0] as unknown as { member_count: number }).member_count).toBe(1);
    expect(infos.slice(1).every((i) => (i as unknown as { member_count: number }).member_count === 2)).toBe(true);
    await result.current("g1"); // 在飞结束后可再次发起
    expect(fetchGroup).toHaveBeenCalledTimes(3);
  });

  it("failure clears cache; a call that joined the failed flight still gets its own re-fetch, then stops", async () => {
    const fetchGroup = vi.fn(async () => { throw new Error("403"); });
    const clientRef = { current: { fetchGroup } } as never;
    const setGroupInfos = vi.fn();
    const { result } = renderHook(() => useGroupInfoRefresh(clientRef, setGroupInfos, "", {}, {}));
    const [a, b] = await Promise.all([result.current("g1"), result.current("g1")]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(fetchGroup).toHaveBeenCalledTimes(2); // 并入的那次不被在飞的失败吞掉，但也不会无限重试
    expect(setGroupInfos).toHaveBeenCalledTimes(2); // 每次失败都清缓存
  });

  it("a joined call re-fetches even when the in-flight fetch failed (stale 403 must not stick)", async () => {
    let n = 0;
    const fetchGroup = vi.fn(async () => { if (++n === 1) throw new Error("403"); return { conv_id: "g1", member_count: 5 } as unknown as GroupInfo; });
    const clientRef = { current: { fetchGroup } } as never;
    const { result } = renderHook(() => useGroupInfoRefresh(clientRef, vi.fn(), "", {}, {}));
    const [a, b] = await Promise.all([result.current("g1"), result.current("g1")]);
    expect(a).toBeNull(); // 首个调用拿首轮（403）结果
    expect(b).not.toBeNull(); // 并入的调用拿补拉那一轮：纠正了过期的 403
  });

  it("frames trickling in over ~1s are rate-limited, not one GET per frame", async () => {
    const fetchGroup = vi.fn(async () => ({ conv_id: "g1" }) as unknown as GroupInfo);
    const clientRef = { current: { fetchGroup } } as never;
    const { result } = renderHook(() => useGroupInfoRefresh(clientRef, vi.fn(), "", {}, {}));
    const calls: Promise<unknown>[] = [];
    for (let i = 0; i < 30; i++) { calls.push(result.current("g1")); await new Promise((r) => setTimeout(r, 30)); } // ≈ 0.9s
    await Promise.all(calls);
    expect(fetchGroup.mock.calls.length).toBeLessThanOrEqual(8); // 30 帧 → 首轮 + 约每 200ms 一次补拉
    expect(fetchGroup.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("an account switch mid-flight does not reuse the old flight nor write its result into the new cache", async () => {
    let release!: (g: GroupInfo) => void;
    const oldFetch = vi.fn(() => new Promise<GroupInfo>((r) => { release = r; }));
    const newFetch = vi.fn(async () => ({ conv_id: "g1", member_count: 9 }) as unknown as GroupInfo);
    const clientRef = { current: { fetchGroup: oldFetch } } as unknown as { current: { fetchGroup: unknown } };
    const setGroupInfos = vi.fn();
    const { result } = renderHook(() => useGroupInfoRefresh(clientRef as never, setGroupInfos, "", {}, {}));
    const oldCall = result.current("g1");
    clientRef.current = { fetchGroup: newFetch }; // 换账号
    const fresh = await result.current("g1");
    expect(newFetch).toHaveBeenCalledTimes(1); // 没有并入旧账号的在飞请求
    expect((fresh as unknown as { member_count: number }).member_count).toBe(9);
    release({ conv_id: "g1", member_count: 1 } as unknown as GroupInfo);
    expect(await oldCall).toBeNull(); // 旧账号结果被丢弃
    expect(setGroupInfos).toHaveBeenCalledTimes(1); // 只有新账号那次写缓存
  });
});
