import { describe, it, expect } from "vitest";
import { parseChatRecord, recordItemPreview } from "./App";

// 合并转发「聊天记录」纯函数：解析 + 单条预览 token（含嵌套「套娃」→[聊天记录] 子标题）。
// 与 iOS IMMediaUtil 的 IMSummarizeRecord/IMRecordItemPreview 逐条对齐。
describe("chat_record 合并转发解析与预览", () => {
  it("parseChatRecord 解析标题与条目", () => {
    const json = JSON.stringify({ t: "群聊的聊天记录", items: [{ n: "1002", ct: "text", c: "你好" }] });
    const r = parseChatRecord(json);
    expect(r.t).toBe("群聊的聊天记录");
    expect(r.items).toHaveLength(1);
    expect(r.items[0].c).toBe("你好");
  });

  it("parseChatRecord 非法 JSON 回落默认标题、空条目", () => {
    const r = parseChatRecord("not-json");
    expect(r.t).toBe("聊天记录");
    expect(r.items).toEqual([]);
  });

  it("recordItemPreview 覆盖各消息类型的 token", () => {
    expect(recordItemPreview({ n: "a", ct: "text", c: "hi" })).toBe("hi");
    expect(recordItemPreview({ n: "a", ct: "image", c: "u" })).toBe("[图片]");
    expect(recordItemPreview({ n: "a", ct: "video", c: "u" })).toBe("[视频]");
    expect(recordItemPreview({ n: "a", ct: "file", c: "x", fn: "报表.xlsx" })).toBe("[文件] 报表.xlsx");
  });

  it("嵌套 chat_record 条目预览 = [聊天记录] 子标题（不铺 JSON 原文）", () => {
    const child = JSON.stringify({ t: "1002和1003的聊天记录", items: [{ n: "1002", ct: "text", c: "在吗" }] });
    const preview = recordItemPreview({ n: "1001", ct: "chat_record", c: child });
    expect(preview).toBe("[聊天记录] 1002和1003的聊天记录");
    expect(preview).not.toContain("items"); // 绝不能退化成 JSON 文本
  });

  it("嵌套子 JSON 非法时不叠加默认标题（避免「[聊天记录] 聊天记录」）", () => {
    expect(recordItemPreview({ n: "1001", ct: "chat_record", c: "garbled" })).toBe("[聊天记录]");
  });
});
