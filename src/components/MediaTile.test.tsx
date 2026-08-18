// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MediaTile } from "./MediaTile";
import type { ChatMessage } from "../sdk/protocol";
import type { DownloadState } from "../download";

afterEach(cleanup);

const img = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  convId: "c", from: "u2", content: "https://x/img.jpg", contentType: "image",
  convSeq: 5, timestamp: 0, status: "sent", fileSize: 2048, ...over,
});
const gate = (phase: DownloadState["phase"]): DownloadState => ({ phase, received: 0, total: 2048 });
const noop = () => {};

describe("MediaTile 两 variant 的门控徽标/尺寸差异（合并自 gallery + detail 两处旧 tile）", () => {
  it("gallery：容器是 div；detail：容器是 button", () => {
    const g = render(<MediaTile variant="gallery" m={img()} gate={undefined} onClick={noop} onMenu={noop} onMediaError={noop} />);
    expect(g.container.querySelector("div.gallery-item")).toBeTruthy();
    cleanup();
    const d = render(<MediaTile variant="detail" m={img()} gate={undefined} onClick={noop} onMenu={noop} onMediaError={noop} />);
    expect(d.container.querySelector("button.detail-media-tile")).toBeTruthy();
  });

  it("失效格：gallery 显 ⊘ 徽标且不显尺寸；detail 无徽标但仍显尺寸", () => {
    const g = render(<MediaTile variant="gallery" m={img()} gate={gate("expired")} onClick={noop} onMenu={noop} onMediaError={noop} />);
    expect(g.container.querySelector(".play-badge.expired")).toBeTruthy(); // ⊘
    expect(g.container.querySelector(".detail-media-size")).toBeNull();    // 失效不显尺寸
    cleanup();
    const d = render(<MediaTile variant="detail" m={img()} gate={gate("expired")} onClick={noop} onMenu={noop} onMediaError={noop} />);
    expect(d.container.querySelector(".play-badge.expired")).toBeNull();   // 无 ⊘
    expect(d.container.querySelector(".detail-media-dl")).toBeNull();      // 也无 ↓
    expect(d.container.querySelector(".detail-media-size")?.textContent).toBe("2 KB"); // 仍显尺寸
  });

  it("未下载（非失效）：两 variant 都显 ↓ + 尺寸", () => {
    for (const variant of ["gallery", "detail"] as const) {
      const r = render(<MediaTile variant={variant} m={img()} gate={gate("notStarted")} onClick={noop} onMenu={noop} onMediaError={noop} />);
      expect(r.container.querySelector(".detail-media-dl")?.textContent).toBe("↓");
      expect(r.container.querySelector(".detail-media-size")).toBeTruthy();
      expect(r.container.querySelector("img.gate-blur")).toBeNull(); // 无 thumb 时用 gate-empty
      expect(r.container.querySelector(".gate-empty")).toBeTruthy();
      cleanup();
    }
  });

  it("就绪视频：gallery 用 play-badge ▶，detail 用 detail-media-play ▶", () => {
    const vid = img({ contentType: "video", posterUrl: "https://x/p.jpg" });
    const g = render(<MediaTile variant="gallery" m={vid} gate={undefined} onClick={noop} onMenu={noop} onMediaError={noop} />);
    expect(g.container.querySelector(".play-badge")?.textContent).toBe("▶");
    expect(g.container.querySelector(".detail-media-play")).toBeNull();
    cleanup();
    const d = render(<MediaTile variant="detail" m={vid} gate={undefined} onClick={noop} onMenu={noop} onMediaError={noop} />);
    expect(d.container.querySelector(".detail-media-play")?.textContent).toBe("▶");
  });

  it("点击回传消息；右键 preventDefault 并回传菜单事件", () => {
    const onClick = vi.fn();
    const onMenu = vi.fn();
    const r = render(<MediaTile variant="gallery" m={img()} gate={undefined} onClick={onClick} onMenu={onMenu} onMediaError={noop} />);
    const tile = r.container.querySelector(".gallery-item")!;
    fireEvent.click(tile);
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ convSeq: 5 }));
    fireEvent.contextMenu(tile);
    expect(onMenu).toHaveBeenCalledTimes(1);
  });
});
