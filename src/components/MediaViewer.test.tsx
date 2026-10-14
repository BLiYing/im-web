// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MediaViewer } from "./MediaViewer";
import type { ChatMessage } from "../sdk/protocol";
import { ChatActionsProvider, type ChatActions } from "../ChatActionsContext";

afterEach(cleanup);

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  convId: "c", from: "u2", content: "https://x/a.jpg", contentType: "image",
  convSeq: 3, timestamp: 0, status: "sent", ...over,
});
const noops = {
  onClose: vi.fn(), onDismissMore: vi.fn(), onStartVideo: vi.fn(), onVideoError: vi.fn(), onImageError: vi.fn(),
  onNav: vi.fn(), onToggleMore: vi.fn(), onOpenGallery: vi.fn(), onLocate: vi.fn(), onFavorite: vi.fn(),
  onCopy: vi.fn(), onForward: vi.fn(), onDelete: vi.fn(),
};
const base = {
  ...noops, videoUnplayable: false, videoStarted: false, isExpired: false, unsupported: false,
  mediaKey: "k", viewerIdx: -1, viewerCount: 1, chatTitle: "会话", more: false,
};

describe("MediaViewer 分支与动作", () => {
  it("图片：渲染大图；点遮罩关闭", () => {
    const onClose = vi.fn();
    const { container } = render(<MediaViewer {...base} m={msg()} onClose={onClose} />);
    expect(container.querySelector("img.image-viewer")).toBeTruthy();
    fireEvent.click(container.querySelector(".viewer-mask")!);
    expect(onClose).toHaveBeenCalled();
  });

  it("视频未开始：显封面 + ▶，点播放按钮 onStartVideo", () => {
    const onStartVideo = vi.fn();
    render(<MediaViewer {...base} m={msg({ contentType: "video", posterUrl: "https://x/p.jpg" })} onStartVideo={onStartVideo} />);
    expect(screen.getByAltText("视频封面")).toBeTruthy();
    fireEvent.click(screen.getByTitle("播放"));
    expect(onStartVideo).toHaveBeenCalled();
  });

  it("视频未开始且无封面无缩略（转发丢了元数据的老消息）：退回 <video> 首帧，不留一个孤零零的 ▶", () => {
    const onStartVideo = vi.fn();
    const onVideoError = vi.fn();
    const { container } = render(
      <MediaViewer {...base} m={msg({ contentType: "video", content: "/uploads/v.mp4" })} onStartVideo={onStartVideo} onVideoError={onVideoError} />,
    );
    expect(container.querySelector("img.viewer-video-cover")).toBeNull(); // 没有 src 的 <img> 什么都画不出来
    const cover = container.querySelector("video.viewer-video-cover") as HTMLVideoElement;
    expect(cover.getAttribute("src")).toBe("/uploads/v.mp4#t=0.1");
    expect(cover.controls).toBe(false); // 仍是封面待点，不是播放器
    fireEvent.click(cover);
    expect(onStartVideo).toHaveBeenCalled();
    fireEvent.error(cover); // 首帧都解不出（HEVC / 404）→ 直接进降级卡，不必等用户点播放
    expect(onVideoError).toHaveBeenCalled();
  });

  it("视频未开始：只有磨砂缩略也算有封面，不预拉原视频", () => {
    const { container } = render(<MediaViewer {...base} m={msg({ contentType: "video", thumb: "data:image/jpeg;base64,AA" })} />);
    expect(container.querySelector("img.viewer-video-cover")).toBeTruthy();
    expect(container.querySelector("video")).toBeNull();
  });

  it("视频不可播：非失效显 HEVC 提示 + 下载入口；失效显已失效文案", () => {
    render(<MediaViewer {...base} m={msg({ contentType: "video" })} videoUnplayable={true} isExpired={false} />);
    expect(screen.getByText(/HEVC/)).toBeTruthy();
    expect(screen.getByText("下载后用本地播放器打开")).toBeTruthy();
    cleanup();
    render(<MediaViewer {...base} m={msg({ contentType: "video" })} videoUnplayable={true} isExpired={true} />);
    expect(screen.getByText("视频已失效")).toBeTruthy();
    expect(screen.queryByText("下载后用本地播放器打开")).toBeNull();
  });

  it("图片/视频已失效：同一张失效页（八角 ✕ + 文案），无破图、不给下载入口", () => {
    const { container } = render(<MediaViewer {...base} m={msg({ thumb: "data:image/jpeg;base64,AA" })} isExpired={true} />);
    expect(screen.getByText("图片已失效")).toBeTruthy();
    expect(container.querySelector(".viewer-expired svg")).toBeTruthy();
    expect(container.querySelector("a[download]")).toBeNull();
    cleanup();
    const v = render(<MediaViewer {...base} m={msg({ contentType: "video" })} isExpired={true} />);
    expect(screen.getByText("视频已失效")).toBeTruthy();
    expect(v.container.querySelector("video")).toBeNull();
  });

  it("不支持的图片格式（HEIC）：降级卡 + 下载入口", () => {
    render(<MediaViewer {...base} m={msg({ thumb: "https://x/t.jpg" })} unsupported={true} />);
    expect(screen.getByText(/HEIC/)).toBeTruthy();
    expect(screen.getByText("下载后用本地程序打开")).toBeTruthy();
  });

  it("翻页箭头：中间项显上一/下一；两端各自隐藏；点击回传方向", () => {
    const onNav = vi.fn();
    const { rerender } = render(<MediaViewer {...base} m={msg()} viewerIdx={1} viewerCount={3} onNav={onNav} />);
    fireEvent.click(screen.getByTitle("上一张（←）"));
    fireEvent.click(screen.getByTitle("下一张（→）"));
    expect(onNav).toHaveBeenNthCalledWith(1, -1);
    expect(onNav).toHaveBeenNthCalledWith(2, 1);
    rerender(<MediaViewer {...base} m={msg()} viewerIdx={0} viewerCount={3} onNav={onNav} />);
    expect(screen.queryByTitle("上一张（←）")).toBeNull();
    rerender(<MediaViewer {...base} m={msg()} viewerIdx={2} viewerCount={3} onNav={onNav} />);
    expect(screen.queryByTitle("下一张（→）")).toBeNull();
  });

  it("更多浮层：删除回传 onDelete；视频无「复制」、图片有「复制」", () => {
    const onDelete = vi.fn();
    render(<MediaViewer {...base} m={msg()} more={true} onDelete={onDelete} />);
    expect(screen.getByText("复制")).toBeTruthy(); // 图片有复制
    fireEvent.click(screen.getByText("删除"));
    expect(onDelete).toHaveBeenCalled();
    cleanup();
    render(<MediaViewer {...base} m={msg({ contentType: "video" })} videoStarted={true} more={true} />);
    expect(screen.queryByText("复制")).toBeNull(); // 视频不提供复制
  });

  it("fromGallery 时不显示「媒体库」按钮", () => {
    const { rerender } = render(<MediaViewer {...base} m={msg()} fromGallery={false} />);
    expect(screen.getByTitle("媒体库")).toBeTruthy();
    rerender(<MediaViewer {...base} m={msg()} fromGallery={true} />);
    expect(screen.queryByTitle("媒体库")).toBeNull();
  });

  it("左上角有关闭按钮，点击回传 onClose（不冒泡成二次关闭）", () => {
    const onClose = vi.fn();
    render(<MediaViewer {...base} m={msg()} onClose={onClose} />);
    fireEvent.click(screen.getByTitle("关闭"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("更多浮层：媒体库里打开的没有收藏/复制；失效页再去掉转发与下载，只留定位与删除", () => {
    render(<MediaViewer {...base} m={msg()} more={true} fromGallery={true} />);
    expect(screen.queryByText("收藏")).toBeNull();
    expect(screen.queryByText("复制")).toBeNull();
    expect(screen.getByText("转发")).toBeTruthy();
    cleanup();
    render(<MediaViewer {...base} m={msg()} more={true} isExpired={true} />);
    expect(screen.queryByText("收藏")).toBeNull();
    expect(screen.queryByText("复制")).toBeNull();
    expect(screen.queryByText("转发")).toBeNull();
    expect(screen.queryByText("下载")).toBeNull();
    expect(screen.getByText("定位到聊天位置")).toBeTruthy();
    expect(screen.getByText("删除")).toBeTruthy();
  });

  it("进查看器复验一次（命中浏览器缓存的图不会 onError）；已失效的不再探", () => {
    const probeExpiry = vi.fn();
    const wrap = (ui: React.ReactElement) => (
      <ChatActionsProvider value={{ probeExpiry } as unknown as ChatActions}>{ui}</ChatActionsProvider>
    );
    render(wrap(<MediaViewer {...base} m={msg()} />));
    expect(probeExpiry).toHaveBeenCalledTimes(1);
    cleanup();
    probeExpiry.mockClear();
    render(wrap(<MediaViewer {...base} m={msg()} isExpired={true} />));
    expect(probeExpiry).not.toHaveBeenCalled();
  });
});
