// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { LinkCard, linkPreviewCache, type LinkPreview } from "./LinkCard";

afterEach(cleanup);
beforeEach(() => linkPreviewCache.clear()); // 进程内缓存跨用例复用，逐例清空隔离

describe("LinkCard 预览抓取：并发去重 + 负缓存", () => {
  it("同一 URL 多个气泡同时挂载：只发一次 fetchPreview，两张卡都拿到结果", async () => {
    const fetchPreview = vi.fn(async (u: string): Promise<LinkPreview> => ({ url: u, title: "标题" }));
    const url = "https://a.example/x";
    render(<><LinkCard url={url} fetchPreview={fetchPreview} /><LinkCard url={url} fetchPreview={fetchPreview} /></>);
    await waitFor(() => expect(screen.getAllByText("标题")).toHaveLength(2));
    expect(fetchPreview).toHaveBeenCalledTimes(1); // 在途 Promise 复用，未各发一次
  });

  it("抓取失败 → 负缓存 null；再次挂载同 URL 不重抓", async () => {
    const fetchPreview = vi.fn(async (): Promise<LinkPreview> => { throw new Error("boom"); });
    const url = "https://b.example/y";
    render(<LinkCard url={url} fetchPreview={fetchPreview} />);
    await waitFor(() => expect(linkPreviewCache.get(url)).toBe(null));
    cleanup();
    render(<LinkCard url={url} fetchPreview={fetchPreview} />); // 命中负缓存，提前返回
    expect(fetchPreview).toHaveBeenCalledTimes(1);
  });
});
