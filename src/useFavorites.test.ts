// @vitest-environment jsdom
// useFavorites（阶段 6 抽出）：收藏快照、打开两态、删除、从收藏发送（复用转发簇）、转发/复制收藏。
import { describe, it, expect, vi , afterEach } from "vitest";
import { renderHook, act, waitFor , cleanup } from "@testing-library/react";
import { fakeClientRef } from "./testing/fakeIMClient";
import { useFavorites, type FavoritesDeps } from "./useFavorites";
import type { ChatMessage, Conversation, Favorite } from "./sdk/protocol";
afterEach(cleanup); // 多次 renderHook：卸载前一用例（CODING_STYLE §八）

const fav = (over: Partial<Favorite> = {}): Favorite => ({ id: 7, content_type: "text", content: "收藏的话", source_conv_id: "c1", source_conv_seq: 3, source_from: "u2", created_at: 1, ...over } as Favorite);
function mount(over: Partial<FavoritesDeps> = {}, injected?: Record<string, unknown>) {
  const client = injected ?? { addFavorite: vi.fn(async () => ({})), listFavorites: vi.fn(async () => ({ items: [fav()], total: 1 })), deleteFavorite: vi.fn(async () => ({})) };
  const deps: FavoritesDeps = {
    clientRef: fakeClientRef(client), setToast: vi.fn(), setMenu: vi.fn(), setAttachPanel: vi.fn(),
    saveMessageToDisk: vi.fn(async () => {}), conversations: [{ conv_id: "c1", peer: "u2" } as Conversation], currentConvRef: { current: "c1" },
    setForwardMode: vi.fn(), setForwarding: vi.fn(), sendForwardToTarget: vi.fn(),
    msgsByConv: {}, selected: new Set<number>(), exitSelectMode: vi.fn(), ...over,
  };
  return { ...renderHook(() => useFavorites(deps)), deps, client };
}
const m: ChatMessage = { convId: "c1", from: "u2", content: "hi", contentType: "text", convSeq: 5, timestamp: 1, status: "sent", caption: undefined } as ChatMessage;

describe("useFavorites 分页（滚到底加载）", () => {
  /** 造一个分页 mock：总共 total 条，每页 pageSize 条，id 连续。 */
  function pagedClient(total: number, pageSize = 60) {
    return {
      addFavorite: vi.fn(async () => ({})),
      deleteFavorite: vi.fn(async () => ({})),
      listFavorites: vi.fn(async (offset = 0) => ({
        items: Array.from({ length: Math.max(0, Math.min(pageSize, total - offset)) },
          (_, i) => fav({ id: offset + i + 1 })),
        total,
      })),
    };
  }

  it("openFavorites 只拉第一页，total 来自服务端而非已加载条数", async () => {
    const client = pagedClient(150);
    const { result } = mount({}, client);
    act(() => result.current.openFavorites());
    await waitFor(() => expect(result.current.favorites?.length).toBe(60));
    expect(result.current.favTotal).toBe(150); // 标题要显示 150，不是 60
    expect(client.listFavorites).toHaveBeenCalledTimes(1);
    expect(client.listFavorites).toHaveBeenCalledWith(0);
  });

  it("loadMoreFavorites 按已加载条数作 offset 追加，不重不漏", async () => {
    const client = pagedClient(150);
    const { result } = mount({}, client);
    act(() => result.current.openFavorites());
    await waitFor(() => expect(result.current.favorites?.length).toBe(60));

    act(() => result.current.loadMoreFavorites());
    await waitFor(() => expect(result.current.favorites?.length).toBe(120));
    expect(client.listFavorites).toHaveBeenLastCalledWith(60);

    act(() => result.current.loadMoreFavorites());
    await waitFor(() => expect(result.current.favorites?.length).toBe(150));
    // id 连续 1..150 且无重复 —— offset 算错会立刻在这里现形。
    const ids = result.current.favorites!.map((f) => f.id);
    expect(new Set(ids).size).toBe(150);
    expect(ids[0]).toBe(1);
    expect(ids[149]).toBe(150);
  });

  it("到底后再触发不发请求（按 total 判断，不靠「上一页是否装满」）", async () => {
    const client = pagedClient(60); // 恰好一页装满：靠 items.length 判断会以为还有下一页
    const { result } = mount({}, client);
    act(() => result.current.openFavorites());
    await waitFor(() => expect(result.current.favorites?.length).toBe(60));

    act(() => result.current.loadMoreFavorites());
    await waitFor(() => expect(client.listFavorites).toHaveBeenCalledTimes(1)); // 没有第二次
  });

  it("删除一条后 favTotal 跟着减（否则标题显示还有一条没加载）", async () => {
    const client = pagedClient(3);
    const { result } = mount({}, client);
    act(() => result.current.openFavorites());
    await waitFor(() => expect(result.current.favTotal).toBe(3));

    act(() => result.current.removeFavorite(1));
    await waitFor(() => expect(result.current.favTotal).toBe(2));
    expect(result.current.favorites?.some((f) => f.id === 1)).toBe(false);
  });

  it("重复 id 不会被追加两次（删除后 offset 前移会让同一条被读两次，重复 key 会让列表渲染错位）", async () => {
    const client = {
      addFavorite: vi.fn(async () => ({})),
      deleteFavorite: vi.fn(async () => ({})),
      // 第二页故意回一条与第一页重复的（id=1）。
      listFavorites: vi.fn(async (offset = 0) =>
        offset === 0 ? { items: [fav({ id: 1 }), fav({ id: 2 })], total: 4 }
                     : { items: [fav({ id: 2 }), fav({ id: 3 })], total: 4 }),
    };
    const { result } = mount({}, client);
    act(() => result.current.openFavorites());
    await waitFor(() => expect(result.current.favorites?.length).toBe(2));

    act(() => result.current.loadMoreFavorites());
    await waitFor(() => expect(result.current.favorites?.length).toBe(3)); // 2 + 1（去掉重复的 id=2）
    const ids = result.current.favorites!.map((f) => f.id);
    expect(ids).toEqual([1, 2, 3]);
  });
});

describe("useFavorites", () => {
  it("favoriteMessage：关菜单 + addFavorite 快照（含来源三元组）+ toast", async () => {
    const { result, deps, client } = mount();
    act(() => result.current.favoriteMessage(m));
    expect(deps.setMenu).toHaveBeenCalledWith(null);
    await waitFor(() => expect(deps.setToast).toHaveBeenCalledWith("已收藏"));
    expect(client.addFavorite).toHaveBeenCalledWith(expect.objectContaining({ content_type: "text", content: "hi", source_conv_id: "c1", source_conv_seq: 5, source_from: "u2" }));
  });
  it("favoriteSelected：批量收藏当前会话所选（跳过撤回/系统/空内容）+ 汇总 toast + 退出多选", async () => {
    const msgsByConv = { c1: [
      { convId: "c1", from: "u2", content: "a", contentType: "text", convSeq: 5, timestamp: 1, status: "sent" },
      { convId: "c1", from: "u2", content: "b", contentType: "text", convSeq: 6, timestamp: 1, status: "sent" },
      { convId: "c1", from: "u2", content: "", contentType: "text", convSeq: 7, timestamp: 1, status: "sent" }, // 空内容跳过
    ] as ChatMessage[] };
    const { result, deps, client } = mount({ msgsByConv, selected: new Set([5, 6, 7]) });
    act(() => result.current.favoriteSelected());
    await waitFor(() => expect(client.addFavorite).toHaveBeenCalledTimes(2)); // 只收 5、6（7 空内容跳过）
    await waitFor(() => expect(deps.setToast).toHaveBeenCalledWith("已收藏 2 条"));
    expect(deps.exitSelectMode).toHaveBeenCalled();
  });
  it("openFavorites=浏览态 / openFavoritesPick=发送态（并收起附件面板）；closeFavorites 复位", async () => {
    const { result, deps } = mount();
    act(() => result.current.openFavorites());
    await waitFor(() => expect(result.current.favorites).toHaveLength(1));
    expect(result.current.favPick).toBe(false);
    act(() => result.current.openFavoritesPick());
    expect(deps.setAttachPanel).toHaveBeenCalledWith(false);
    await waitFor(() => expect(result.current.favPick).toBe(true));
    act(() => result.current.closeFavorites());
    expect(result.current.favorites).toBeNull(); expect(result.current.favPick).toBe(false);
  });
  it("removeFavorite：deleteFavorite 后从列表剔除", async () => {
    const { result, client } = mount();
    act(() => result.current.openFavorites());
    await waitFor(() => expect(result.current.favorites).toHaveLength(1));
    act(() => result.current.removeFavorite(7));
    await waitFor(() => expect(result.current.favorites).toHaveLength(0));
    expect(client.deleteFavorite).toHaveBeenCalledWith(7);
  });
  it("sendFavoritesToCurrent：合成消息交给 sendForwardToTarget(当前会话) + 收起 + toast", () => {
    const { result, deps } = mount();
    act(() => result.current.sendFavoritesToCurrent([fav()]));
    expect(deps.sendForwardToTarget).toHaveBeenCalledWith(expect.objectContaining({ conv_id: "c1" }), expect.arrayContaining([expect.objectContaining({ content: "收藏的话" })]));
    expect(deps.setToast).toHaveBeenCalledWith("已发送");
  });
  it("forwardFavorite → 逐条模式打开选择器；copyFavorite → 剪贴板 + toast", async () => {
    const write = vi.fn(async () => {}); Object.assign(navigator, { clipboard: { writeText: write } });
    const { result, deps } = mount();
    act(() => result.current.forwardFavorite(fav()));
    expect(deps.setForwardMode).toHaveBeenCalledWith("each");
    expect(deps.setForwarding).toHaveBeenCalledWith([expect.objectContaining({ content: "收藏的话" })]);
    act(() => result.current.copyFavorite(fav()));
    expect(write).toHaveBeenCalledWith("收藏的话"); expect(deps.setToast).toHaveBeenCalledWith("已复制");
  });
});
