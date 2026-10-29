import { describe, expect, it } from "vitest";
import { BIO_WARN_RUNES, MAX_BIO_RUNES, bioRunes, clampBio } from "./profileBio";

describe("个性签名规整（PROFILE_BIO_DESIGN §2.2）", () => {
  it("按码点计长：emoji 代理对算一个，与服务端 rune 口径一致", () => {
    expect(MAX_BIO_RUNES).toBe(70);
    expect(BIO_WARN_RUNES).toBe(60);
    expect(bioRunes("😀😀")).toBe(2);
    expect(bioRunes("慢慢来")).toBe(3);
  });
  it("换行折成空格", () => {
    expect(clampBio("a\nb")).toBe("a b");
    expect(clampBio("a\r\n\r\nb")).toBe("a b");
  });
  it("超长按码点截断且不劈开代理对", () => {
    expect(clampBio("字".repeat(90))).toBe("字".repeat(70));
    expect(clampBio("😀".repeat(80))).toBe("😀".repeat(70));
    expect(clampBio("字".repeat(70))).toBe("字".repeat(70));
  });
});
