import { describe, it, expect } from "vitest";
import { compactCount, unreadBadgeText } from "./unreadBadge";

describe("未读角标格式化（Telegram 三档）", () => {
  it("三位数原样显示——这正是改动的意义，不再一律 99+", () => {
    expect(unreadBadgeText(7)).toBe("7");
    expect(unreadBadgeText(99)).toBe("99");
    expect(unreadBadgeText(342)).toBe("342");
    expect(unreadBadgeText(999)).toBe("999");
  });

  it("千位起缩写", () => {
    expect(compactCount(1000)).toBe("1K");
    expect(compactCount(1234)).toBe("1.2K");
    expect(compactCount(5000)).toBe("5K");
    expect(compactCount(12345)).toBe("12.3K");
    expect(compactCount(999999)).toBe("999.9K");
  });

  it("百万起缩写", () => {
    expect(compactCount(1_000_000)).toBe("1M");
    expect(compactCount(1_250_000)).toBe("1.2M");
  });

  it("撞服务端上限才补 +（诚实：至少这么多）", () => {
    expect(unreadBadgeText(10000, true)).toBe("10K+");
    expect(unreadBadgeText(10000, false)).toBe("10K");
  });

  it("0 与非法值不渲染角标", () => {
    expect(unreadBadgeText(0)).toBe("");
    expect(unreadBadgeText(-1)).toBe("");
    expect(unreadBadgeText(NaN)).toBe("");
  });
});
