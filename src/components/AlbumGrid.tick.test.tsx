// @vitest-environment jsdom
// 相册右下角胶囊：发送中「…」/ 已发灰单勾 / 已读蓝双勾 / none 仅时间（READ_TICK_DESIGN §4）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AlbumGrid } from "./AlbumGrid";
import type { AlbumTick } from "../album";
import type { ChatMessage } from "../sdk/protocol";

afterEach(cleanup);
const members: ChatMessage[] = [1, 2].map((s) => ({
  convId: "c", from: "me", content: "/x.jpg", contentType: "image", groupId: "g",
  convSeq: s, timestamp: 1, status: "sent",
} as ChatMessage));

const meta = (tick?: AlbumTick) => {
  const { container } = render(
    <AlbumGrid members={members} timeLabel="12:00" tick={tick} progress={{}} gateFor={() => false}
      onOpen={vi.fn()} onMenu={vi.fn()} />);
  return container.querySelector(".album-meta")!;
};

describe("AlbumGrid 状态胶囊", () => {
  it("none / 缺省：只有时间", () => {
    expect(meta("none").textContent).toBe("12:00");
    expect(meta().querySelector(".rtick")).toBeNull();
  });
  it("sending：时间 + …", () => { expect(meta("sending").textContent).toBe("12:00 …"); });
  it("sent：灰单勾；read：蓝双勾（.read）", () => {
    expect(meta("sent").querySelector(".rtick.read")).toBeNull();
    expect(meta("sent").querySelector(".rtick")).not.toBeNull();
    expect(meta("read").querySelector(".rtick.read")).not.toBeNull();
  });
});
