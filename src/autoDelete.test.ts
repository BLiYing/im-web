// 自动删除消息：过期判定 + 档位 + 确认规则 + 扫描规划。读三端共用向量
// （testing/autoDelete.vectors.json，源 IMServer docs/conformance/auto_delete.json）。
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import vectors from "./testing/autoDelete.vectors.json";
import type { ChatMessage, Conversation } from "./sdk/protocol";
import {
  AUTO_DELETE_TIERS, expired, expiredSeqs, floorTs, needsConfirm, patchConvAfterSweep, tierLabelKey,
} from "./autoDelete";

const V = vectors as unknown as {
  expired: { name: string; now: number; sec: number; ts: number; expect: boolean }[];
  floor_ts: { now: number; sec: number; expect: number }[];
  valid_sec: number[];
  invalid_sec: number[];
};

describe("auto_delete 共用向量", () => {
  for (const c of V.expired) it(`expired：${c.name}`, () => expect(expired(c.ts, c.sec, c.now)).toBe(c.expect));
  for (const c of V.floor_ts) it(`floorTs(${c.now}, ${c.sec})`, () => expect(floorTs(c.sec, c.now)).toBe(c.expect));
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

describe("expired 与 floorTs 互为印证", () => {
  it("ts <= floorTs 当且仅当过期", () => {
    for (const sec of [0, 86400, 604800, 2592000]) {
      const now = 5_000_000_000;
      for (const ts of [0, 1, now - sec * 1000 - 1, now - sec * 1000, now - sec * 1000 + 1, now]) {
        expect(ts <= floorTs(sec, now) && sec > 0).toBe(expired(ts, sec, now));
      }
    }
  });
});

describe("确认规则与档位文案键", () => {
  it("开启 / 缩短要确认；关闭、放宽、不变不确认", () => {
    expect(needsConfirm(0, 86400)).toBe(true);
    expect(needsConfirm(2592000, 604800)).toBe(true);
    expect(needsConfirm(86400, 0)).toBe(false);
    expect(needsConfirm(86400, 604800)).toBe(false);
    expect(needsConfirm(86400, 86400)).toBe(false);
    expect(needsConfirm(0, 0)).toBe(false);
  });
  it("档位文案键", () => {
    expect(tierLabelKey(0)).toBe("common.off");
    expect(tierLabelKey(86400)).toBe("autodel.day");
    expect(tierLabelKey(604800)).toBe("autodel.week");
    expect(tierLabelKey(2592000)).toBe("autodel.month");
    expect(tierLabelKey(123)).toBe("common.off");
  });
});

const msg = (seq: number, ts: number, from = "u2"): ChatMessage =>
  ({ convId: "c", from, content: "x", contentType: "text", convSeq: seq, timestamp: ts, status: "sent" }) as ChatMessage;

describe("expiredSeqs", () => {
  const now = 200_000_000;
  it("只挑已确认（convSeq>0）且过期的", () => {
    const list = [msg(1, 100_000_000), msg(2, 113_600_000), msg(3, 113_600_001), msg(0, 1)];
    expect(expiredSeqs(list, 86400, now)).toEqual([1, 2]);
  });
  it("关闭档位恒空", () => expect(expiredSeqs([msg(1, 1)], 0, now)).toEqual([]));
});

describe("patchConvAfterSweep", () => {
  const conv = {
    conv_id: "c", peer: "u2", unread: 3, read_seq: 1, latest_conv_seq: 4,
    last_message: { server_msg_id: "s4", from: "u2", content_type: "text", content: "hi", conv_seq: 4, timestamp: 50 },
  } as unknown as Conversation;
  it("末条过期 → 预览改为幸存的最新一条，未读扣掉被清的他人未读", () => {
    const survivors = [msg(3, 300)];
    const out = patchConvAfterSweep(conv, [msg(2, 10), msg(4, 50)], survivors, "u1");
    expect(out.last_message?.conv_seq).toBe(3);
    expect(out.unread).toBe(1);
  });
  it("全部过期 → 预览空、未读 0，会话行字段不丢", () => {
    const out = patchConvAfterSweep(conv, [msg(2, 10), msg(3, 20), msg(4, 50)], [], "u1");
    expect(out.last_message).toBeNull();
    expect(out.unread).toBe(0);
    expect(out.conv_id).toBe("c");
  });
  it("末条没被清 → 预览不动；自己发的不扣未读", () => {
    const out = patchConvAfterSweep(conv, [msg(2, 10, "u1")], [msg(4, 50)], "u1");
    expect(out.last_message).toBe(conv.last_message);
    expect(out.unread).toBe(3);
  });
});
