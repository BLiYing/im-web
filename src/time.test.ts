import { afterEach, describe, it, expect } from "vitest";
import { formatTime, conversationTime, dayHeader } from "./time";
import { setPref } from "./i18n";

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

// 会话列表四段式（IMServer docs/UI_SPEC.md §5.1，2026-09-07 三端拍板）。
// 用相对「现在」的偏移构造，避免依赖固定日历日。
describe("conversationTime：会话列表四段式", () => {
  const dayAt = (offsetDays: number, h = 10, m = 30) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };

  it("今天 → 时分，且跟随 12/24 小时制设置", () => {
    expect(conversationTime(dayAt(0, 9, 5), "24")).toBe("09:05");
    expect(conversationTime(dayAt(0, 9, 5), "12")).toBe("9:05 AM");
  });

  it("昨天 → 「昨天」（不是时分——旧行为把上周的消息显示成 14:30，是本次要修的 bug）", () => {
    expect(conversationTime(dayAt(-1), "24")).toBe("昨天");
    // 小时制对「昨天」无影响
    expect(conversationTime(dayAt(-1), "12")).toBe("昨天");
  });

  it("更早 → 含「日」的日期，且与日期分隔胶囊 dayHeader 逐字一致", () => {
    const old = dayAt(-30);
    const s = conversationTime(old, "24");
    expect(s).toMatch(/日$/);
    expect(s).not.toMatch(/:/);
    // 刻意共用同一套词汇：除今天那一段外，两者对同一时间必须给出同一字符串
    expect(s).toBe(dayHeader(old));
  });

  it("跨年 → 带年份", () => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 2);
    expect(conversationTime(d.getTime(), "24")).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日$/);
  });

  it("空/0 → 空串", () => {
    expect(conversationTime(0, "24")).toBe("");
  });
});

describe("英文界面（多语言）", () => {
  afterEach(() => setPref("zh-Hans"));
  it("会话列表四段式与日期分隔用英文词汇", () => {
    setPref("en");
    const now = new Date();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    expect(conversationTime(y.getTime())).toBe("Yesterday");
    expect(dayHeader(now.getTime())).toBe("Today");
    const old = new Date(2020, 8, 21, 10, 0).getTime();
    expect(conversationTime(old)).toBe("Sep 21, 2020");
    const thisYear = new Date(now.getFullYear(), 0, 5, 10, 0);
    if (!isSameDayAsToday(thisYear)) expect(conversationTime(thisYear.getTime())).toBe("Jan 5");
  });
});
function isSameDayAsToday(d: Date) { const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); }
