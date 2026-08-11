import { describe, expect, it } from "vitest";
import { textTier, charCountLabel } from "./longtext";

describe("textTier", () => {
  it("short for brief content", () => {
    expect(textTier("今晚八点老地方见")).toBe("short");
    expect(textTier("")).toBe("short");
    expect(textTier(null)).toBe("short");
    expect(textTier("a".repeat(299))).toBe("short");
  });

  it("long by char count", () => {
    expect(textTier("a".repeat(300))).toBe("long");
    expect(textTier("字".repeat(500))).toBe("long");
  });

  it("long by line count even when short chars", () => {
    expect(textTier(Array(10).fill("行").join("\n"))).toBe("long");
    expect(textTier(Array(9).fill("行").join("\n"))).toBe("short");
  });

  it("huge by char count", () => {
    expect(textTier("a".repeat(2000))).toBe("huge");
    expect(textTier("字".repeat(2500))).toBe("huge");
  });

  it("huge by line count", () => {
    expect(textTier(Array(60).fill("x").join("\n"))).toBe("huge");
    expect(textTier(Array(59).fill("x").join("\n"))).toBe("long");
  });

  it("counts by code point, not UTF-16 units", () => {
    // 1000 个 emoji（每个 2 个 UTF-16 单元 = 2000 units）应按 1000 码点算，不到 huge
    expect(textTier("😀".repeat(1000))).toBe("long");
  });
});

describe("charCountLabel", () => {
  it("formats with thousands separator", () => {
    expect(charCountLabel("字".repeat(8400))).toBe("约 8,400 字");
    expect(charCountLabel("")).toBe("约 0 字");
  });
});
