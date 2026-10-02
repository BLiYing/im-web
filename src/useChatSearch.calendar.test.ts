// @vitest-environment jsdom
// 📅 日历「开的那一刻复位到当月」回归（2026-09-24 浏览器实测发现）。
//
// calendarMonth 是 useChatSearch 单例状态，不随 closeInChatSearch / 切会话重置——在 A 会话把日历翻到
// 别的月再关掉，切到 B 会话点 📅，看到的是 A 会话翻到的那个月，与 iOS 每次呼出都是新的
// `IMChatDateJumpViewController`（天然从当月开）不对齐。修法：toggleCalendar 在**打开**那一刻把
// calendarMonth 复位到当月；只在打开时复位，不影响用户正在日历里翻月的操作。
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useChatSearch, type ChatSearchDeps } from "./useChatSearch";
import type { ChatMessage } from "./sdk/protocol";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const CONV = "u_conv";
const msg = (seq: number): ChatMessage =>
  ({ convId: CONV, from: "u2", content: "x", contentType: "text", convSeq: seq, timestamp: 1_700_000_000_000, status: "received" } as ChatMessage);

function mount(over: Partial<ChatSearchDeps> = {}) {
  const deps: ChatSearchDeps = {
    searchOpen: true, setSearchOpen: vi.fn(),
    searchQuery: "", setSearchQuery: vi.fn(),
    allMessages: [msg(1)],
    convId: CONV, groupConvId: "", uid: "u1",
    groupInfos: {}, conversations: [],
    locateInChat: vi.fn(), setToast: vi.fn(),
    localComplete: true, online: true, getToken: () => "",
    ...over,
  };
  return renderHook((p: ChatSearchDeps) => useChatSearch(p), { initialProps: deps });
}

describe("toggleCalendar：开的那一刻复位当月", () => {
  it("翻到别的月关掉再打开 → 回到当月，不留上次翻到的月份", () => {
    const { result } = mount();
    const now = new Date();
    const thisMonth = { y: now.getFullYear(), m: now.getMonth() };

    act(() => result.current.toggleCalendar()); // 打开
    expect(result.current.calendarOpen).toBe(true);
    expect(result.current.calendarMonth).toEqual(thisMonth);

    act(() => result.current.setCalendarMonth(() => ({ y: 2020, m: 0 }))); // 用户翻到很远的月份
    expect(result.current.calendarMonth).toEqual({ y: 2020, m: 0 });

    act(() => result.current.toggleCalendar()); // 关闭：不该动月份（用户可能只是手滑碰到）
    expect(result.current.calendarOpen).toBe(false);
    expect(result.current.calendarMonth).toEqual({ y: 2020, m: 0 });

    act(() => result.current.toggleCalendar()); // 再打开：必须复位回当月
    expect(result.current.calendarOpen).toBe(true);
    expect(result.current.calendarMonth).toEqual(thisMonth);
  });

  it("👤 来自 picker 与 📅 日历互斥：打开日历应关掉 picker", () => {
    const { result } = mount({ groupConvId: CONV }); // 群聊才有来自 picker
    act(() => result.current.openFromPicker());
    expect(result.current.searchFromPickerOpen).toBe(true);
    act(() => result.current.toggleCalendar());
    expect(result.current.calendarOpen).toBe(true);
    expect(result.current.searchFromPickerOpen).toBe(false);
  });
});

// 有缺口又没有服务端天表时：选日只认当天，不静默落到别的日子，也不谎称「没有消息」（§4.9 第 4 项，对齐 Android）。
describe("有缺口且离线：选日 / 今天", () => {
  const DAY = 86_400_000;
  const day0 = new Date(2026, 5, 10).getTime();
  const at = (seq: number, ts: number): ChatMessage => ({ ...msg(seq), timestamp: ts });

  it("选的那天本地没有、之后某天有 → 说需要联网，不跳（不再「已跳到最近的 X」）", () => {
    const setToast = vi.fn(), locateInChat = vi.fn();
    const { result } = mount({ localComplete: false, online: false, allMessages: [at(1, day0 - 5 * DAY), at(50, day0 + 3 * DAY)], setToast, locateInChat });
    act(() => result.current.jumpToDay(day0, "6/10"));
    expect(locateInChat).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith(expect.stringContaining("联网"));
  });

  it("选的那天本地就有 → 照常跳", () => {
    const locateInChat = vi.fn();
    const { result } = mount({ localComplete: false, online: false, allMessages: [at(1, day0 - 5 * DAY), at(20, day0 + 1000)], locateInChat });
    act(() => result.current.jumpToDay(day0, "6/10"));
    expect(locateInChat).toHaveBeenCalledWith(CONV, 20);
  });

  it("今天本地没有且没拿到天表 → 说需要联网，不宣布「今天没有消息」也不跳最新", () => {
    const setToast = vi.fn(), locateInChat = vi.fn();
    const { result } = mount({ localComplete: false, online: false, allMessages: [at(1, 1_600_000_000_000)], setToast, locateInChat });
    act(() => result.current.jumpToToday());
    expect(locateInChat).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith(expect.stringContaining("联网"));
  });

  it("本地齐全：行为不变（今天没有 → 跳最近一条并说明）", () => {
    const locateInChat = vi.fn();
    const { result } = mount({ localComplete: true, online: true, allMessages: [at(1, 1_600_000_000_000)], locateInChat });
    act(() => result.current.jumpToToday());
    expect(locateInChat).toHaveBeenCalledWith(CONV, 1);
  });
});
