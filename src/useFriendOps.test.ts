// @vitest-environment jsdom
import { describe, it, expect, vi , afterEach } from "vitest";
import { renderHook, act , cleanup } from "@testing-library/react";
import { fakeClientRef } from "./testing/fakeIMClient";
import { useFriendOps, type FriendOpsDeps } from "./useFriendOps";
afterEach(cleanup); // 多次 renderHook：卸载前一用例（CODING_STYLE §八）
function mount(client: Record<string, unknown> = {}) {
  const c = { searchUsers: vi.fn(async () => [{ user_id: "u9", nickname: "老王", tags: [] }]), listFriends: vi.fn(async () => [{ user_id: "b1", status: "blocked" }]), friendAction: vi.fn(async () => {}), ...client };
  const deps: FriendOpsDeps = { clientRef: fakeClientRef(c), setToast: vi.fn(), refreshFriends: vi.fn(async () => {}) };
  return { ...renderHook(() => useFriendOps(deps)), deps, c };
}
describe("useFriendOps", () => {
  it("doSearch：空词 → 结果置 null；有词 → searchUsers 结果；失败 → toast", async () => {
    const { result, deps, c } = mount();
    act(() => result.current.setSearchQ("  "));
    await act(async () => { await result.current.doSearch(); });
    expect(result.current.searchResults).toBeNull();
    act(() => result.current.setSearchQ("老王"));
    await act(async () => { await result.current.doSearch(); });
    expect(result.current.searchResults?.[0].user_id).toBe("u9");
    c.searchUsers.mockRejectedValueOnce(new Error("boom"));
    await act(async () => { await result.current.doSearch(); });
    expect(deps.setToast).toHaveBeenCalledWith("搜索失败：boom");
  });
  it("doFriendAction：执行期间 busyUser=对端，完成后刷新好友并解锁；失败 toast 仍解锁", async () => {
    const { result, deps } = mount();
    let seenBusy: string | null = null;
    await act(async () => { await result.current.doFriendAction("u9", async () => { seenBusy = result.current.busyUser; }); });
    expect(deps.refreshFriends).toHaveBeenCalled(); expect(result.current.busyUser).toBeNull();
    await act(async () => { await result.current.doFriendAction("u9", async () => { throw new Error("x"); }); });
    expect(deps.setToast).toHaveBeenCalledWith("操作失败：x"); expect(result.current.busyUser).toBeNull();
    void seenBusy;
  });
  it("openBlacklist 拉 blocked 列表；unblock 调 friendAction(unblock) 并从列表移除 + 刷新好友", async () => {
    const { result, deps, c } = mount();
    await act(async () => { await result.current.openBlacklist(); });
    expect(result.current.blockedList?.map((f) => f.user_id)).toEqual(["b1"]);
    await act(async () => { await result.current.unblock("b1"); });
    expect(c.friendAction).toHaveBeenCalledWith("unblock", "b1");
    expect(result.current.blockedList).toEqual([]); expect(deps.refreshFriends).toHaveBeenCalled();
  });
});
