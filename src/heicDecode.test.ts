import { describe, expect, it } from "vitest";
import { isHeicLike } from "./heicDecode";

describe("isHeicLike", () => {
  it("按扩展名识别 HEIC / HEIF（大小写、带 query）", () => {
    expect(isHeicLike("/uploads/a.heic")).toBe(true);
    expect(isHeicLike("https://x/IMG_1.HEIF?token=1")).toBe(true);
  });
  it("其它格式与无扩展名不命中", () => {
    expect(isHeicLike("/uploads/a.jpg")).toBe(false);
    expect(isHeicLike("a.heic.jpg")).toBe(false);
    expect(isHeicLike("")).toBe(false);
  });
});
