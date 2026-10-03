import { describe, expect, it } from "vitest";
import { bubbleLayoutClass } from "./bubbleLayout";

// 文本气泡时间在文字下方（与 Android BubbleTimeMeta 同版式）；仅 text，其它类型维持原版式。
describe("bubbleLayoutClass", () => {
  it("text -> text-stack", () => expect(bubbleLayoutClass("text")).toBe(" text-stack"));
  it.each(["image", "video", "voice", "file", "contact_card", "chat_record", "call"])("%s -> 无", (t) =>
    expect(bubbleLayoutClass(t)).toBe(""));
});
