import { describe, it, expect } from "vitest";
import { pickQuerySource } from "./convQuerySource";
import { addRange, isComplete } from "./sdk/ranges";

describe("整会话问题问谁（§4.9 三态）", () => {
  it("本地齐全 → 一律本地，联不联网都一样", () => {
    expect(pickQuerySource(true, true)).toBe("local");
    expect(pickQuerySource(true, false)).toBe("local");
  });

  it("有缺口 + 在线 → 服务端", () => {
    expect(pickQuerySource(false, true)).toBe("server");
  });

  it("有缺口 + 离线 → 本地但降级（可以少，不可以错；少了要说出来）", () => {
    expect(pickQuerySource(false, false)).toBe("local-degraded");
  });

  it("与区间清单串起来：正常用户（离线一晚补齐）走本地，大群积压走服务端", () => {
    // 正常会话：连上时差 30 条，≤max_gap 顺手补齐 → 齐全 → 本地，什么都没变。
    const normal = addRange([{ lo: 1, hi: 970 }], 971, 1000);
    expect(isComplete(normal, 1000)).toBe(true);
    expect(pickQuerySource(isComplete(normal, 1000), true)).toBe("local");

    // 大群：积压 10 万条被判 too_long，本地只有旧的一段 + 后来开窗看的一段。
    const gapped = addRange([{ lo: 1, hi: 1200 }], 99_800, 100_000);
    expect(isComplete(gapped, 100_000)).toBe(false);
    expect(pickQuerySource(isComplete(gapped, 100_000), true)).toBe("server");
    expect(pickQuerySource(isComplete(gapped, 100_000), false)).toBe("local-degraded");
  });
});
