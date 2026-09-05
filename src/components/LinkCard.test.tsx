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

// 卡片异步长出来会把气泡撑高。外面那套「进会话贴底 / 新消息贴底」在卡片出现之前就跑完了，
// 所以卡片必须主动喊一声，否则最后一条被挤到视口下方（2026-09-05 实测 113px）。
// **关键是「没有图片时也要喊」**——旧实现只挂 `<img onLoad>`，而多数站点的 OG 预览没有图。
describe("LinkCard 高度变化要通知 onMediaLoad（贴底才不会被挤掉）", () => {
  it("预览无图：卡片出现时仍通知一次", async () => {
    const onMediaLoad = vi.fn();
    const fetchPreview = async (u: string): Promise<LinkPreview> => ({ url: u, title: "无图标题" });
    render(<LinkCard url="https://c.example/z" fetchPreview={fetchPreview} onMediaLoad={onMediaLoad} />);
    await waitFor(() => expect(screen.getByText("无图标题")).toBeTruthy());
    await waitFor(() => expect(onMediaLoad).toHaveBeenCalled());
  });

  it("抓不到 og（不出卡片、高度不变）→ 不通知，免得白白把用户拽回底部", async () => {
    const onMediaLoad = vi.fn();
    const url = "https://d.example/z";
    const fetchPreview = async (): Promise<LinkPreview> => { throw new Error("boom"); };
    render(<LinkCard url={url} fetchPreview={fetchPreview} onMediaLoad={onMediaLoad} />);
    await waitFor(() => expect(linkPreviewCache.get(url)).toBe(null));
    expect(onMediaLoad).not.toHaveBeenCalled();
  });

  it("cardOnly 分支（文本内混排 URL）同样通知", async () => {
    const onMediaLoad = vi.fn();
    const fetchPreview = async (u: string): Promise<LinkPreview> => ({ url: u, title: "混排标题" });
    render(<LinkCard url="https://e.example/z" cardOnly fetchPreview={fetchPreview} onMediaLoad={onMediaLoad} />);
    await waitFor(() => expect(screen.getByText("混排标题")).toBeTruthy());
    await waitFor(() => expect(onMediaLoad).toHaveBeenCalled());
  });
});
