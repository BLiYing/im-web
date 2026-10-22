// 自动删除消息：过期判定 + 档位 + 确认规则 + 扫描规划。读三端共用向量
// （testing/autoDelete.vectors.json，源 IMServer docs/conformance/auto_delete.json）。
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import vectors from "./testing/autoDelete.vectors.json";
import { translate } from "./i18n";
import type { ChatMessage, Conversation } from "./sdk/protocol";
import {
  AUTO_DELETE_TIERS, dropV1AutoDelete, sanitizeState, expired, expiredSeqs, expiryWindow, fromAfterSystemMessage, needsConfirm, patchConvAfterSweep, tierLabel, tierUnit,
  AUTO_DELETE_CUSTOM_TIERS, AUTO_DELETE_FIXED_TIERS, isCustomTier,
} from "./autoDelete";

const V = vectors as unknown as {
  expired: { name: string; now: number; sec: number; from: number; ts: number; expect: boolean }[];
  window: { name: string; now: number; sec: number; from: number; expect: { lo: number; hi: number } | null }[];
  from_after_system_message: { sys_ts: number; sec: number; expect_from: number }[];
  valid_sec: number[];
  invalid_sec: number[];
};

describe("auto_delete 共用向量（v2）", () => {
  for (const c of V.expired) it(`expired：${c.name}`, () => expect(expired(c.ts, c.sec, c.from, c.now)).toBe(c.expect));
  for (const c of V.window) it(`window：${c.name}`, () => expect(expiryWindow(c.sec, c.from, c.now)).toEqual(c.expect));
  for (const c of V.from_after_system_message) {
    it(`from_after_system_message(${c.sys_ts}, ${c.sec})`, () => expect(fromAfterSystemMessage(c.sys_ts, c.sec)).toBe(c.expect_from));
  }
  it("档位白名单与向量一致", () => {
    expect([...AUTO_DELETE_TIERS]).toEqual(V.valid_sec);
    for (const s of V.invalid_sec) expect(AUTO_DELETE_TIERS.includes(s as never)).toBe(false);
  });
  it("本地副本与源向量一致（源在本机时才比）", () => {
    const abs = new URL("../../IMServer/docs/conformance/auto_delete.json", import.meta.url);
    if (!existsSync(abs)) return;
    expect(JSON.parse(readFileSync(abs, "utf8"))).toEqual(vectors);
  });
});

describe("expired 与 window 互为印证", () => {
  it("ts 在窗口内当且仅当过期", () => {
    for (const sec of [0, 120, 86400, 2592000]) for (const from of [0, 50_000_000_000]) {
      const now = 60_000_000_000;
      const w = expiryWindow(sec, from, now);
      for (const ts of [0, from - 1, from, now - sec * 1000 - 1, now - sec * 1000, now - sec * 1000 + 1, now]) {
        expect(!!w && ts >= w.lo && ts <= w.hi).toBe(expired(ts, sec, from, now));
      }
    }
  });
});

describe("确认规则（v2：说明性，不追溯）", () => {
  it("新>0 且 ≠ 当前才确认（开启 / 改档位各一次）；关闭、不变不确认", () => {
    expect(needsConfirm(0, 86400)).toBe(true);
    expect(needsConfirm(2592000, 604800)).toBe(true); // 缩短
    expect(needsConfirm(86400, 604800)).toBe(true); // 放宽也弹（from 会重置）
    expect(needsConfirm(86400, 0)).toBe(false);
    expect(needsConfirm(86400, 86400)).toBe(false);
    expect(needsConfirm(0, 0)).toBe(false);
  });
});

describe("时长折算 / 18 档 / 自定义行判定", () => {
  const D = 86400;
  it("折算优先级：年 > 月 > 周 > 天 > 小时 > 分钟", () => {
    const cases: [number, string, number][] = [
      [120, "minute", 2], [3600, "hour", 1], [D, "day", 1], [6 * D, "day", 6], [7 * D, "week", 1], [21 * D, "week", 3],
      [30 * D, "month", 1], [60 * D, "month", 2], [180 * D, "month", 6], [365 * D, "year", 1], [730 * D, "year", 2], [90, "minute", 2],
    ];
    for (const [sec, unit, count] of cases) expect(tierUnit(sec)).toEqual({ key: `autodel.unit.${unit}`, count });
  });
  it("18 档升序且与向量 valid_sec 一致（不含 0）", () => {
    expect(AUTO_DELETE_CUSTOM_TIERS).toHaveLength(18);
    expect([...AUTO_DELETE_CUSTOM_TIERS]).toEqual([...V.valid_sec].filter((s) => s > 0));
    expect([...AUTO_DELETE_CUSTOM_TIERS]).toEqual([...AUTO_DELETE_CUSTOM_TIERS].sort((a, b) => a - b));
  });
  it("固定行 5 个；非固定档（含 1 小时、3 天、1 年）归自定义行", () => {
    expect(AUTO_DELETE_FIXED_TIERS).toEqual([0, 120, D, 7 * D, 30 * D]);
    for (const s of AUTO_DELETE_FIXED_TIERS) expect(isCustomTier(s)).toBe(false);
    for (const s of [3600, 3 * D, 14 * D, 365 * D]) expect(isCustomTier(s)).toBe(true);
  });
  it("文案：中英文与关闭兜底", () => {
    const zh = (k: string, a?: Record<string, string | number>) => translate("zh-Hans", k, a);
    const en = (k: string, a?: Record<string, string | number>) => translate("en", k, a);
    expect(tierLabel(zh, 0)).toBe("关闭");
    expect(tierLabel(zh, 120)).toBe("2 分钟");
    expect(tierLabel(zh, 3 * D)).toBe("3 天");
    expect(tierLabel(zh, 30 * D)).toBe("1 个月");
    expect(tierLabel(zh, 365 * D)).toBe("1 年");
    expect(tierLabel(en, D)).toBe("1 day");
    expect(tierLabel(en, 2 * D)).toBe("2 days");
  });
});

const msg = (seq: number, ts: number, from = "u2"): ChatMessage =>
  ({ convId: "c", from, content: "x", contentType: "text", convSeq: seq, timestamp: ts, status: "sent" }) as ChatMessage;

describe("expiredSeqs（v2 窗口）", () => {
  const now = 200_000_000;
  it("只挑已确认（convSeq>0）且落在 [from, now-sec*1000] 的", () => {
    const list = [msg(1, 100_000_000), msg(2, 113_600_000), msg(3, 113_600_001), msg(0, 1)];
    expect(expiredSeqs(list, { sec: 86400, from: 0 }, now)).toEqual([1, 2]);
  });
  it("from 之前的老消息永不挑（不追溯）", () => {
    const list = [msg(1, 100_000_000), msg(2, 113_600_000), msg(3, 50_000_000)];
    expect(expiredSeqs(list, { sec: 86400, from: 110_000_000 }, now)).toEqual([2]);
  });
  it("关闭档位恒空", () => expect(expiredSeqs([msg(1, 1)], { sec: 0, from: 0 }, now)).toEqual([]));
});

describe("patchConvAfterSweep", () => {
  const ad = { sec: 86400, from: 0 };
  const NOW = 200_000_000;
  const old = NOW - 90_000_000; // 已满 1 天
  const conv = {
    conv_id: "c", peer: "u2", unread: 3, read_seq: 1, latest_conv_seq: 4,
    last_message: { server_msg_id: "s4", from: "u2", content_type: "text", content: "hi", conv_seq: 4, timestamp: old },
  } as unknown as Conversation;
  it("末条过期 → 预览改为幸存的最新一条，未读扣掉被清的他人未读", () => {
    const out = patchConvAfterSweep(conv, [msg(2, old), msg(4, old)], [msg(5, NOW)], "u1", ad, NOW);
    expect(out.last_message?.conv_seq).toBe(5);
    expect(out.unread).toBe(1);
  });
  it("全部过期 → 预览空、未读 0，会话行字段不丢", () => {
    const out = patchConvAfterSweep(conv, [msg(2, old), msg(3, old), msg(4, old)], [], "u1", ad, NOW);
    expect(out.last_message).toBeNull();
    expect(out.unread).toBe(0);
    expect(out.conv_id).toBe("c");
  });
  it("末条没被清 → 预览不动；自己发的不扣未读", () => {
    const fresh = { ...conv, last_message: { ...conv.last_message!, timestamp: NOW } } as Conversation;
    const out = patchConvAfterSweep(fresh, [msg(2, old, "u1")], [msg(4, NOW)], "u1", ad, NOW);
    expect(out.last_message).toBe(fresh.last_message);
    expect(out.unread).toBe(3);
  });
});

describe("patchConvAfterSweep：v2 越过窗口取 from 之前 / 末条不在内存 / 不可见行", () => {
  const NOW = 1_000_000;
  const base = {
    conv_id: "c", peer: "u2", unread: 3, read_seq: 0, latest_conv_seq: 9,
    last_message: { server_msg_id: "s4", from: "u2", content_type: "text", content: "hi", conv_seq: 4, timestamp: NOW - 5000 },
  } as unknown as Conversation;
  const op = (seq: number): ChatMessage => ({ ...msg(seq, NOW), contentType: "msg_op" }) as ChatMessage;
  const s1 = { sec: 1, from: 0 };

  it("末条按时间已过期但不在内存里（removed 为空）→ 预览空、未读归 0", () => {
    const out = patchConvAfterSweep(base, [], [], "u1", s1, NOW);
    expect(out.last_message).toBeNull();
    expect(out.unread).toBe(0);
  });
  it("末条未过期且不在 removed → 原样", () => {
    const out = patchConvAfterSweep(base, [], [], "u1", { sec: 3600, from: 0 }, NOW);
    expect(out.last_message).toBe(base.last_message);
    expect(out.unread).toBe(3);
  });
  it("幸存里的 msg_op 事件行不当预览：取最后一条可见的", () => {
    const out = patchConvAfterSweep(base, [msg(4, 1)], [msg(5, NOW), op(6)], "u1", s1, NOW);
    expect(out.last_message?.conv_seq).toBe(5);
  });
  it("幸存只有 msg_op → 预览空、未读 0", () => {
    const out = patchConvAfterSweep(base, [msg(4, 1)], [op(5), op(6)], "u1", s1, NOW);
    expect(out.last_message).toBeNull();
    expect(out.unread).toBe(0);
  });
  it("窗口清空后越过过期区间取 from 之前的幸存（seq 比被清末条小）当预览", () => {
    const ad = { sec: 1, from: NOW - 20_000 };
    const out = patchConvAfterSweep(base, [msg(3, NOW - 10_000), msg(4, NOW - 5000)], [msg(1, NOW - 90_000), msg(2, NOW - 80_000)], "u1", ad, NOW);
    expect(out.last_message?.conv_seq).toBe(2);
  });
  it("from 之前的幸存即便按档位『早已满期』也不是过期：不追溯", () => {
    const ad = { sec: 1, from: NOW - 20_000 };
    expect(expired(NOW - 80_000, ad.sec, ad.from, NOW)).toBe(false);
    const out = patchConvAfterSweep(base, [msg(4, NOW - 5000)], [msg(2, NOW - 80_000)], "u1", ad, NOW);
    expect(out.last_message?.conv_seq).toBe(2);
  });
  it("幸存按时间也已落在窗口内（回前台时钟跳变等）不当预览", () => {
    const out = patchConvAfterSweep(base, [msg(4, 1)], [msg(5, NOW - 9000)], "u1", s1, NOW);
    expect(out.last_message).toBeNull();
  });
});

describe("dropV1AutoDelete（本地缓存迁移）", () => {
  const c = (o: object) => ({ conv_id: "c", ...o }) as unknown as Conversation;
  it("v1 缓存（有 sec 无 from 字段）清零；v2 缓存 / 关闭态原样", () => {
    expect(dropV1AutoDelete(c({ auto_delete_sec: 86400 })).auto_delete_sec).toBe(0);
    const v2 = c({ auto_delete_sec: 86400, auto_delete_from: 5 });
    expect(dropV1AutoDelete(v2)).toBe(v2);
    const off = c({});
    expect(dropV1AutoDelete(off)).toBe(off);
  });
});

describe("sanitizeState（脏数据 from<=0 且 sec>0 当关闭）", () => {
  it("from<=0 归零；正常态与关闭态原样", () => {
    expect(sanitizeState(120, 0)).toEqual({ sec: 0, from: 0 });
    expect(sanitizeState(120, -1)).toEqual({ sec: 0, from: 0 });
    expect(sanitizeState(120, 500)).toEqual({ sec: 120, from: 500 });
    expect(sanitizeState(0, 0)).toEqual({ sec: 0, from: 0 });
  });
  it("dropV1AutoDelete 对 from=0 的 sec>0 也清零", () => {
    expect(dropV1AutoDelete({ conv_id: "c", auto_delete_sec: 86400, auto_delete_from: 0 } as unknown as Conversation).auto_delete_sec).toBe(0);
  });
});
