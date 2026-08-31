// @vitest-environment jsdom
// FavoritesModal 的**分页触发**护栏（2026-08-30 /code-review）。
//
// 背景：`canAutoLoad` 曾要求 `!kind`，但组件里有个 effect 保证 kind 恒为某个存在的分类
// （B 方案页签无「全部」），于是这个条件恒 false —— 滚到底自动加载一次都没触发过，
// 第一页（60 条）之后的收藏根本拉不出来。这里钉死"有分类签也要能翻页"。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { FavoritesModal } from "./FavoritesModal";
import type { Conversation, Favorite } from "../../sdk/protocol";

afterEach(cleanup);

const fav = (id: number, over: Partial<Favorite> = {}): Favorite =>
  ({ id, content_type: "text", content: `收藏 ${id}`, source_conv_id: "c1", source_conv_seq: id, source_from: "u2", created_at: 1, ...over } as Favorite);

function mount(over: Partial<Parameters<typeof FavoritesModal>[0]> = {}) {
  const onLoadMore = vi.fn();
  const props = {
    favorites: [fav(1), fav(2), fav(3)],
    total: 90, loadingMore: false, onLoadMore,
    sourceLabel: () => "小明",
    actions: [],
    glue: { gateOf: () => undefined, mediaSrc: () => "", onGateTap: vi.fn(), onOpenFile: vi.fn(), onMediaError: vi.fn() },
    myUid: "u1", conversations: [] as Conversation[],
    convDisplayLabel: (c: Conversation) => c.conv_id, convAvatarUrl: () => undefined,
    onOpenMedia: vi.fn(), onOpenLink: vi.fn(), onOpenRecord: vi.fn(), onOpenContact: vi.fn(),
    onClose: vi.fn(), fetchLinkPreview: vi.fn(async () => ({ url: "" })),
    ...over,
  };
  const r = render(<FavoritesModal {...props} />);
  return { ...r, onLoadMore };
}

/** jsdom 里 scrollHeight/clientHeight 恒 0 → 见底判据必然成立，滚动一次即触发。 */
const scrollList = (c: ReturnType<typeof render>) => {
  const list = c.container.querySelector(".fav-list");
  expect(list).not.toBeNull();
  fireEvent.scroll(list!);
};

describe("FavoritesModal 滚到底自动加载下一页", () => {
  it("浏览态滚到底 → onLoadMore（分类签恒有值，不能因此判为「已过滤」）", () => {
    const c = mount();
    scrollList(c);
    expect(c.onLoadMore).toHaveBeenCalled();
  });

  it("已加载条数达到 total → 不再请求", () => {
    const c = mount({ total: 3 });
    scrollList(c);
    expect(c.onLoadMore).not.toHaveBeenCalled();
  });

  it("上一页在途（loadingMore）→ 不叠加请求", () => {
    const c = mount({ loadingMore: true });
    scrollList(c);
    expect(c.onLoadMore).not.toHaveBeenCalled();
  });

  it("搜索态（客户端过滤已加载集合）→ 不自动翻页", () => {
    const c = mount();
    const input = c.container.querySelector(".fav-search input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "收藏 1" } });
    scrollList(c);
    expect(c.onLoadMore).not.toHaveBeenCalled();
  });
});
