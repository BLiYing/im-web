import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./sdk/protocol";
import { mediaItemToMessage, mergeServerOlder, prependOlderMedia } from "./mediaServerPaging";

const M = (seq: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  convId: "g", from: "u", content: `/uploads/${seq}.jpg`, contentType: "image", convSeq: seq, timestamp: seq, status: "received", ...extra,
});
const seqs = (ms: readonly ChatMessage[]) => ms.map((m) => m.convSeq);

describe("prependOlderMedia", () => {
  it("更旧一页拼到前面且升序，只收比本地最旧还旧的", () => {
    const r = prependOlderMedia(200, [], [M(150), M(100), M(250), M(200)]); // 250、200 都不比本地最旧（200）更旧：不收
    expect(seqs(r.added)).toEqual([100, 150]);
    expect(seqs(r.older)).toEqual([100, 150]);
  });
  it("已续拉过的再来一页：接在更前面，重复页不再塞", () => {
    const first = prependOlderMedia(200, [], [M(150), M(100)]);
    const second = prependOlderMedia(200, first.older, [M(100), M(80), M(60)]);
    expect(seqs(second.added)).toEqual([60, 80]);
    expect(seqs(second.older)).toEqual([60, 80, 100, 150]);
  });
  it("撤回 / 空内容 / 非正 seq 不进时间线", () => {
    const r = prependOlderMedia(200, [], [M(150, { recalledAt: 1 }), M(140, { content: "" }), M(0), M(130)]);
    expect(seqs(r.added)).toEqual([130]);
  });
});

describe("mergeServerOlder", () => {
  it("本地后来又往上翻出的同样几张不重复", () => {
    expect(seqs(mergeServerOlder([M(60), M(80), M(100)], [M(90), M(120)]))).toEqual([60, 80, 90, 120]);
  });
  it("没有续拉内容原样返回本地", () => {
    const local = [M(5)];
    expect(mergeServerOlder([], local)).toBe(local);
  });
});

describe("mediaItemToMessage", () => {
  it("服务端字段映射到查看器要的消息；空串字段不带", () => {
    const m = mediaItemToMessage("g", {
      conv_seq: 7, server_msg_id: "s7", sender: "u", content_type: "video", content: "/uploads/v.mp4", timestamp: 9,
      poster: "/uploads/p.jpg", thumb: "", media_w: 640, media_h: 480, duration: 3000,
    });
    expect(m).toMatchObject({ convId: "g", convSeq: 7, contentType: "video", posterUrl: "/uploads/p.jpg", mediaW: 640, status: "received" });
    expect(m.thumb).toBeUndefined();
  });
});
