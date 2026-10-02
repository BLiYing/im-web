import { describe, it, expect, vi, afterEach } from "vitest";
import * as http from "./http";
import { dropClearedDays, dropClearedItems, fetchConvCalendar, fetchConvMedia, hasMoreAboveFloor, searchConvMessages } from "./convQueriesApi";

// §6.7：这三个查询问的是**服务端**，服务端还留着用户本机清空掉的消息——结果里 conv_seq <= 清空位点的要滤掉，
// 否则搜得到刚清掉的东西。位点为 0（没清过）时必须原样返回。
afterEach(() => { vi.restoreAllMocks(); });

const item = (conv_seq: number) => ({ conv_seq, server_msg_id: `s${conv_seq}`, sender: "u", content_type: "text", content: "x", timestamp: conv_seq });

describe("dropClearedItems / hasMoreAboveFloor / dropClearedDays（纯函数）", () => {
  it("位点（含）以内滤掉；位点 0 原样返回同一数组", () => {
    const items = [item(30), item(20), item(10)];
    expect(dropClearedItems(items, 20).map((i) => i.conv_seq)).toEqual([30]);
    expect(dropClearedItems(items, 0)).toBe(items);
  });
  it("游标已落到位点+1 及以下时不再翻页（剩下的全在位点以内）", () => {
    expect(hasMoreAboveFloor(true, 100, 20)).toBe(true);
    expect(hasMoreAboveFloor(true, 21, 20)).toBe(false);
    expect(hasMoreAboveFloor(false, 100, 20)).toBe(false);
  });
  it("日历：当天第一条在位点以内的日子丢掉", () => {
    const days = [{ day_start_ms: 1, count: 3, first_conv_seq: 5 }, { day_start_ms: 2, count: 1, first_conv_seq: 25 }];
    expect(dropClearedDays(days, 20).map((d) => d.first_conv_seq)).toEqual([25]);
    expect(dropClearedDays(days, 0)).toBe(days);
  });
});

describe("三个服务端查询的出口都滤", () => {
  it("会话内搜索：滤掉位点以内的命中，并把「还有更早」收口", async () => {
    vi.spyOn(http, "callJson").mockResolvedValue({ conv_id: "c", items: [item(30), item(20), item(10)], next_cursor: 10, has_more: true });
    const page = await searchConvMessages("t", "c", "x", { clearedUpTo: 20 });
    expect(page.items.map((i) => i.conv_seq)).toEqual([30]);
    expect(page.has_more).toBe(false);   // 游标 10 <= 位点+1：剩下的都已清掉
    const raw = await searchConvMessages("t", "c", "x");   // 没清过：原样
    expect(raw.items).toHaveLength(3);
    expect(raw.has_more).toBe(true);
  });

  it("媒体库：同上", async () => {
    vi.spyOn(http, "callJson").mockResolvedValue({ conv_id: "c", items: [item(30), item(5)], next_cursor: 5, has_more: true });
    const page = await fetchConvMedia("t", "c", "image", { clearedUpTo: 20 });
    expect(page.items.map((i) => i.conv_seq)).toEqual([30]);
    expect(page.has_more).toBe(false);
  });

  it("日历：已清空的日子不再打点", async () => {
    vi.spyOn(http, "callJson").mockResolvedValue({ conv_id: "c", days: [{ day_start_ms: 1, count: 3, first_conv_seq: 5 }, { day_start_ms: 2, count: 1, first_conv_seq: 25 }] });
    const res = await fetchConvCalendar("t", "c", 0, 1, 0, 20);
    expect(res.days.map((d) => d.first_conv_seq)).toEqual([25]);
  });
});
