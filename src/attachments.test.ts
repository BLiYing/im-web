import { describe, expect, it } from "vitest";
import { attachmentContentType, shouldSendAsMediaBatch } from "./attachments";

describe("附件入口语义", () => {
  it("图片或视频入口保持媒体类型和批量宫格能力", () => {
    expect(attachmentContentType("media", "image")).toBe("image");
    expect(attachmentContentType("media", "video")).toBe("video");
    expect(shouldSendAsMediaBatch("media")).toBe(true);
  });

  it("文件入口选择图片或视频仍强制发送为 file", () => {
    expect(attachmentContentType("file", "image")).toBe("file");
    expect(attachmentContentType("file", "video")).toBe("file");
    expect(attachmentContentType("file", "file")).toBe("file");
    expect(shouldSendAsMediaBatch("file")).toBe(false);
  });
});
