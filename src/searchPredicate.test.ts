import { describe, it, expect } from "vitest";
import { messageMatchesNeedle, hitSnippet, activeDayKeys } from "./searchPredicate";

describe("messageMatchesNeedle", () => {
  it("text content 命中（大小写不敏感）", () => {
    expect(messageMatchesNeedle({ contentType: "text", content: "Q3 预算终稿" }, "预算")).toBe(true);
    expect(messageMatchesNeedle({ content: "Hello World" }, "world")).toBe(true); // 缺 contentType 视作 text
  });
  it("媒体/文件的 content(URL) 不参与命中", () => {
    expect(messageMatchesNeedle({ contentType: "file", content: "https://cdn/abc123.bin" }, "abc123")).toBe(false);
    expect(messageMatchesNeedle({ contentType: "image", content: "https://cdn/pic.png" }, "pic")).toBe(false);
  });
  it("caption 命中（任意类型）", () => {
    expect(messageMatchesNeedle({ contentType: "image", caption: "现场 budget 照片" }, "budget")).toBe(true);
  });
  it("file_name 命中（P2）", () => {
    expect(messageMatchesNeedle({ contentType: "file", content: "https://cdn/x", fileName: "季度预算.xlsx" }, "预算")).toBe(true);
  });
  it("needle 空 → false", () => {
    expect(messageMatchesNeedle({ contentType: "text", content: "anything" }, "")).toBe(false);
  });
});

describe("hitSnippet", () => {
  it("文件名命中且带无关 caption → 显文件名（不显 caption，避免副行无高亮像误命中）", () => {
    expect(hitSnippet({ contentType: "file", content: "https://cdn/x", caption: "see attached", fileName: "budget.xlsx" }, "budget"))
      .toBe("budget.xlsx");
  });
  it("caption 命中 → 显 caption", () => {
    expect(hitSnippet({ contentType: "image", caption: "现场 budget 照片", fileName: "IMG_1.jpg" }, "budget")).toBe("现场 budget 照片");
  });
  it("text 命中 → 显 content", () => {
    expect(hitSnippet({ contentType: "text", content: "Q3 预算终稿已发" }, "预算")).toBe("Q3 预算终稿已发");
  });
  it("needle 空 → 回退 caption>fileName>content", () => {
    expect(hitSnippet({ contentType: "file", content: "https://cdn/x", fileName: "a.bin" }, "")).toBe("a.bin");
    expect(hitSnippet({ contentType: "image", caption: "cap", fileName: "b.jpg" }, "")).toBe("cap");
  });
});

describe("activeDayKeys", () => {
  const d = (s: string) => new Date(s).getTime();
  it("按本机时区聚合日键（M 为 0 基），排除撤回/系统/未确认", () => {
    const keys = activeDayKeys([
      { timestamp: d("2026-08-18T09:00:00"), convSeq: 1 },
      { timestamp: d("2026-08-18T20:00:00"), convSeq: 2 }, // 同日去重
      { timestamp: d("2026-08-19T10:00:00"), convSeq: 3 },
      { timestamp: d("2026-08-20T10:00:00"), convSeq: 4, recalledAt: 1 }, // 撤回排除
      { timestamp: d("2026-08-21T10:00:00"), convSeq: 0 }, // 未确认排除
      { timestamp: d("2026-08-22T10:00:00"), convSeq: 5, contentType: "system" }, // 系统排除
    ]);
    expect(keys.has("2026-7-18")).toBe(true); // 8 月 → getMonth()=7
    expect(keys.has("2026-7-19")).toBe(true);
    expect(keys.size).toBe(2);
  });
});
