// @vitest-environment jsdom
// useFavorites（阶段 6 抽出）：收藏快照、打开两态、删除、从收藏发送（复用转发簇）、转发/复制收藏。
import { describe, it, expect, vi , afterEach } from "vitest";
import { renderHook, act, waitFor , cleanup } from "@testing-library/react";
import { fakeClientRef } from "./testing/fakeIMClient";
import { useFavorites, type FavoritesDeps } from "./useFavorites";
import type { ChatMessage, Conversation, Favorite } from "./sdk/protocol";
afterEach(cleanup); // 多次 renderHook：卸载前一用例（CODING_STYLE §八）

const fav = (over: Partial<Favorite> = {}): Favorite => ({ id: 7, content_type: "text", content: "收藏的话", source_conv_id: "c1", source_conv_seq: 3, source_from: "u2", created_at: 1, ...over } as Favorite);
function mount(over: Partial<FavoritesDeps> = {}) {
  const client = { addFavorite: vi.fn(async () => ({})), listFavorites: vi.fn(async () => [fav()]), deleteFavorite: vi.fn(async () => ({})) };
  const deps: FavoritesDeps = {
    clientRef: fakeClientRef(client), setToast: vi.fn(), setMenu: vi.fn(), setAttachPanel: vi.fn(),
    saveMessageToDisk: vi.fn(async () => {}), conversations: [{ conv_id: "c1", peer: "u2" } as Conversation], currentConvRef: { current: "c1" },
    setForwardMode: vi.fn(), setForwarding: vi.fn(), sendForwardToTarget: vi.fn(),
    msgsByConv: {}, selected: new Set<number>(), exitSelectMode: vi.fn(), ...over,
  };
  return { ...renderHook(() => useFavorites(deps)), deps, client };
}
const m: ChatMessage = { convId: "c1", from: "u2", content: "hi", contentType: "text", convSeq: 5, timestamp: 1, status: "sent", caption: undefined } as ChatMessage;

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
