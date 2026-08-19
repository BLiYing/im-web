import { describe, it, expect } from "vitest";
import { replyPreviewOf } from "./messageContent";
import type { ChatMessage } from "./sdk/protocol";

// 图说 caption（Telegram 模型）引用降级快照「有字显字」：图文/视频文/文件文带 caption 时引用条显 caption 文字，
// 无 caption 回退 [图片]/[视频]/[文件] token（与服务端冻结的 reply_snapshot 同口径）。
const mk = (p: Partial<ChatMessage>): ChatMessage => ({
  convId: "c", from: "u", content: "", contentType: "text", convSeq: 1, timestamp: 0, status: "sent", ...p,
});

describe("replyPreviewOf caption（图说引用快照）", () => {
  it("图文带 caption → 显 caption 文字", () => {
    expect(replyPreviewOf(mk({ contentType: "image", content: "/x.jpg", caption: "周末爬山拍的" }))).toBe("周末爬山拍的");
  });
  it("视频文带 caption → 显 caption 文字", () => {
    expect(replyPreviewOf(mk({ contentType: "video", content: "/x.mp4", caption: "录了段现场" }))).toBe("录了段现场");
  });
  it("文件文带 caption → caption 压过 [文件] 名", () => {
    expect(replyPreviewOf(mk({ contentType: "file", content: "/x__r.pdf", fileName: "r.pdf", caption: "看第3页" }))).toBe("看第3页");
  });
  it("无 caption 的图片 → 回退 [图片]", () => {
    expect(replyPreviewOf(mk({ contentType: "image", content: "/x.jpg" }))).toBe("[图片]");
  });
  it("caption 超 60 字截断", () => {
    const long = "字".repeat(80);
    expect(replyPreviewOf(mk({ contentType: "image", caption: long }))).toBe("字".repeat(60));
  });
});
