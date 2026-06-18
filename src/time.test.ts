import { describe, it, expect } from "vitest";
import { formatTime } from "./time";

// 用本地时分构造时间戳（formatTime 用 getHours/getMinutes，按本地时区，故与时区无关）。
const at = (h: number, m: number) => new Date(2026, 0, 1, h, m, 0).getTime();

describe("formatTime", () => {
  it("24 小时制 = HH:mm（补零）", () => {
    expect(formatTime(at(9, 5), "24")).toBe("09:05");
    expect(formatTime(at(0, 0), "24")).toBe("00:00");
    expect(formatTime(at(23, 0), "24")).toBe("23:00");
  });

  it("12 小时制 = h:mm AM/PM（午夜=12 AM，正午=12 PM）", () => {
    expect(formatTime(at(9, 5), "12")).toBe("9:05 AM");
    expect(formatTime(at(0, 0), "12")).toBe("12:00 AM");
    expect(formatTime(at(12, 30), "12")).toBe("12:30 PM");
    expect(formatTime(at(23, 0), "12")).toBe("11:00 PM");
  });

  it("空/0 时间戳 → 空串", () => {
    expect(formatTime(0, "24")).toBe("");
    expect(formatTime(0, "12")).toBe("");
  });
});
