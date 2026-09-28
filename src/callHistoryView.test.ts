// callHistoryView 纯逻辑测试：未接判定、全部/未接过滤+自动续页判据、群通话人数、日期分组、对端 uid、行文案。
// 覆盖设计文档 §6 测试点 2/4/7。
import { describe, it, expect } from "vitest";
import type { CallHistoryRecord } from "im-rtc-call-engine";
import { dayHeader } from "./time";
import {
  callHistoryLine, callHistoryPeerUid, filterHistoryRecords, groupCallSize, groupHistoryByDay,
  isMissedHistoryRecord, needsAutoContinue,
} from "./callHistoryView";

const rec = (over: Partial<CallHistoryRecord> = {}): CallHistoryRecord => ({
  callId: "c1", roomId: "r1", caller: "u1", mediaType: "audio", isGroup: false,
  reason: "hangup", endedBy: "", durationSec: 30, startedAtMs: Date.now(),
  connectedAtMs: Date.now(), endedAtMs: Date.now(), userData: "", chatGroupId: "",
  members: [], ...over,
});

describe("isMissedHistoryRecord：我是被叫且 durationSec=0 才算未接", () => {
  it("我是被叫、没接通 → 未接", () => {
    expect(isMissedHistoryRecord(rec({ caller: "peer", durationSec: 0 }), "me")).toBe(true);
  });
  it("我是被叫、接通了 → 不算未接", () => {
    expect(isMissedHistoryRecord(rec({ caller: "peer", durationSec: 12 }), "me")).toBe(false);
  });
  it("我是主叫、没接通（对方未接）→ 不算「我」未接", () => {
    expect(isMissedHistoryRecord(rec({ caller: "me", durationSec: 0 }), "me")).toBe(false);
  });
  it("我是主叫、接通了 → 不算未接", () => {
    expect(isMissedHistoryRecord(rec({ caller: "me", durationSec: 12 }), "me")).toBe(false);
  });
});

describe("filterHistoryRecords", () => {
  const records = [
    rec({ callId: "a", caller: "peer", durationSec: 0 }),   // 未接
    rec({ callId: "b", caller: "me", durationSec: 20 }),    // 我打出去、接通
    rec({ callId: "c", caller: "peer", durationSec: 15 }),  // 对方打来、我接了
    rec({ callId: "d", caller: "peer2", durationSec: 0 }),  // 未接
  ];
  it("all：原样返回（新数组）", () => {
    const out = filterHistoryRecords(records, "all", "me");
    expect(out).toEqual(records);
    expect(out).not.toBe(records);
  });
  it("missed：只留未接", () => {
    expect(filterHistoryRecords(records, "missed", "me").map((r) => r.callId)).toEqual(["a", "d"]);
  });
});

describe("groupCallSize（与 im-rtc-web Demo peerText 同算法）", () => {
  it("发起人已在 members 里：直接取 members.length", () => {
    const r = rec({ isGroup: true, caller: "me", members: [{ uid: "me", state: "x" }, { uid: "a", state: "x" }, { uid: "b", state: "x" }] });
    expect(groupCallSize(r)).toBe(3);
  });
  it("发起人不在 members 里：members.length + 1", () => {
    const r = rec({ isGroup: true, caller: "me", members: [{ uid: "a", state: "x" }, { uid: "b", state: "x" }] });
    expect(groupCallSize(r)).toBe(3);
  });
  it("members 为空：max(0,1) + 1（边界，逐字对齐 Demo 公式）", () => {
    const r = rec({ isGroup: true, caller: "me", members: [] });
    expect(groupCallSize(r)).toBe(2);
  });
});

describe("callHistoryPeerUid：单聊对端", () => {
  it("我是被叫 → 对端是 caller", () => {
    expect(callHistoryPeerUid(rec({ caller: "peer" }), "me")).toBe("peer");
  });
  it("我是主叫 → 对端是 members 里第一个不是我的人", () => {
    const r = rec({ caller: "me", members: [{ uid: "me", state: "x" }, { uid: "peer", state: "x" }] });
    expect(callHistoryPeerUid(r, "me")).toBe("peer");
  });
  it("我是主叫但 members 里找不到旁人（异常数据）→ 空串兜底，不崩溃", () => {
    const r = rec({ caller: "me", members: [{ uid: "me", state: "x" }] });
    expect(callHistoryPeerUid(r, "me")).toBe("");
  });
});

describe("groupHistoryByDay：按自然日分组，与 time.ts#dayHeader 同一套日期计算", () => {
  const dayAt = (offsetDays: number, h = 10) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(h, 0, 0, 0);
    return d.getTime();
  };

  it("同一天的多条记录分到一组，跨天分开，顺序不变（倒序输入）", () => {
    const records = [
      rec({ callId: "t1", startedAtMs: dayAt(0, 20) }),
      rec({ callId: "t2", startedAtMs: dayAt(0, 10) }),
      rec({ callId: "y1", startedAtMs: dayAt(-1, 21) }),
    ];
    const groups = groupHistoryByDay(records);
    expect(groups).toHaveLength(2);
    expect(groups[0].records.map((r) => r.callId)).toEqual(["t1", "t2"]);
    expect(groups[0].label).toBe(dayHeader(dayAt(0, 20)));
    expect(groups[1].records.map((r) => r.callId)).toEqual(["y1"]);
    expect(groups[1].label).toBe(dayHeader(dayAt(-1, 21)));
  });

  it("空输入 → 空数组", () => {
    expect(groupHistoryByDay([])).toEqual([]);
  });

  it("非连续但同一天的记录（中间被跨天记录打断）各自成组，不回并前面的组", () => {
    // 分组只顺序扫描相邻桶，不做「同 key 合并」——这是有意的（输入已按时间倒序，理论上不会发生，
    // 但纯函数不该对输入顺序做未声明的假设，这里钉住行为，不是要求它去合并）。
    const records = [
      rec({ callId: "a", startedAtMs: dayAt(0, 20) }),
      rec({ callId: "b", startedAtMs: dayAt(-1, 10) }),
      rec({ callId: "c", startedAtMs: dayAt(0, 8) }),
    ];
    const groups = groupHistoryByDay(records);
    expect(groups.map((g) => g.records.map((r) => r.callId))).toEqual([["a"], ["b"], ["c"]]);
  });
});

describe("needsAutoContinue：「未接」tab 自动续页判据（§3.5）", () => {
  const missedPage = (n: number) => Array.from({ length: n }, (_, i) => rec({ callId: `m${i}`, caller: "peer", durationSec: 0 }));

  it("all tab 永不自动续页", () => {
    expect(needsAutoContinue("all", missedPage(1), "me", 5, 20)).toBe(false);
  });
  it("missed tab、已到底（nextCursor=null）不再续页", () => {
    expect(needsAutoContinue("missed", missedPage(1), "me", null, 20)).toBe(false);
  });
  it("missed tab、未接数不够一页量、还有下一页 → 续页", () => {
    expect(needsAutoContinue("missed", missedPage(3), "me", 5, 20)).toBe(true);
  });
  it("missed tab、未接数已够一页量 → 不再自动续页", () => {
    expect(needsAutoContinue("missed", missedPage(20), "me", 5, 20)).toBe(false);
  });
});

describe("callHistoryLine：reason 文案复用 callRecord.ts，群聊拼「群{kind}通话 · N人」", () => {
  it("接通了：与聊天气泡同一句「通话时长 mm:ss」，不算未接", () => {
    const r = rec({ caller: "peer", durationSec: 30, reason: "hangup" });
    const line = callHistoryLine(r, "me");
    expect(line.text).toBe("通话时长 00:30");
    expect(line.missed).toBe(false);
    expect(line.outgoing).toBe(false);
  });
  it("我是被叫、未接通、no_answer → 「未接来电」+ missed", () => {
    const r = rec({ caller: "peer", durationSec: 0, reason: "no_answer" });
    const line = callHistoryLine(r, "me");
    expect(line.text).toBe("未接来电");
    expect(line.missed).toBe(true);
  });
  it("我是主叫、取消 → 「已取消」，不算未接（caller===me）", () => {
    const r = rec({ caller: "me", durationSec: 0, reason: "cancel" });
    const line = callHistoryLine(r, "me");
    expect(line.text).toBe("已取消");
    expect(line.missed).toBe(false);
    expect(line.outgoing).toBe(true);
  });
  it("群通话：文案是「群{语音|视频}通话 · N人」，不是气泡的叙述句", () => {
    const r = rec({
      isGroup: true, caller: "me", mediaType: "video", durationSec: 0,
      members: [{ uid: "a", state: "x" }, { uid: "b", state: "x" }],
    });
    const line = callHistoryLine(r, "me");
    expect(line.text).toBe("群视频通话 · 3人"); // members 2 人 + 发起人不在其中 +1
    expect(line.icon).toBe("video");
  });
  it("callId 缺失（异常数据）→ 兜底「通话未接通」，不崩溃", () => {
    const r = rec({ callId: "", caller: "peer", durationSec: 0 });
    expect(callHistoryLine(r, "me").text).toBe("通话未接通");
  });
});
