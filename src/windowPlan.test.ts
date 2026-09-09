import { describe, it, expect } from "vitest";
import { entryWindowAnchor, planEntryWindow, moreLocalAbove, moreLocalBelow } from "./windowPlan";
import type { SeqRange } from "./sdk/ranges";

const base = { contextBefore: 10, historyPage: 200 };
const plan = (o: Partial<Parameters<typeof planEntryWindow>[0]>) =>
  planEntryWindow({ ...base, readSeq: 0, latestSeq: 0, unread: 0, ranges: [], head: 0, ...o });

describe("entryWindowAnchor —— 进会话锚在哪", () => {
  it("有未读：锚到已读位点，上方留上下文、下方要一页", () => {
    expect(entryWindowAnchor({ ...base, readSeq: 500, latestSeq: 900, unread: 400 }))
      .toEqual({ anchor: 500, before: 10, after: 200 });
  });

  it("无未读：anchor=0 即取最新", () => {
    expect(entryWindowAnchor({ ...base, readSeq: 900, latestSeq: 900, unread: 0 }))
      .toEqual({ anchor: 0, before: 200, after: 0 });
  });

  // 2026-09-03 实测：发送方自己灌了一万条，服务端未读排除本人消息 ⇒ unread=0 而 latest≫read。
  // 判据若用 latestSeq > readSeq，这里会锚到一万条之前：不贴底、↓N 一大串，像"消息没发出去"。
  it("发送方 latest 远大于 read 但 unread=0 —— 仍然取最新，不许锚到一万条之前", () => {
    expect(entryWindowAnchor({ ...base, readSeq: 100019, latestSeq: 110019, unread: 0 }).anchor).toBe(0);
  });

  // 2026-09-03 user13028 实测：多判一个 readSeq>0 会把首次进群的新成员当成"无未读"直接贴最新，
  // 紧接着「可见即读」把 read_seq 一路推到头 —— 十万条未读进一次会话清零。
  it("一条都没读过（readSeq=0）但有未读 —— 是有未读，锚点就是 0 而不是取最新", () => {
    const a = entryWindowAnchor({ ...base, readSeq: 0, latestSeq: 110019, unread: 10000 });
    expect(a).toEqual({ anchor: 0, before: 10, after: 200 });
  });
});

describe("planEntryWindow —— 这一窗问本地还是问服务端", () => {
  it("无未读 + 尾部一页本地齐全 → 不打网络", () => {
    expect(plan({ head: 1000, ranges: [{ lo: 1, hi: 1000 }] })).toEqual({ source: "local" });
  });

  it("无未读 + 尾部一页缺一条 → 问服务端", () => {
    // [801,1000] 是要覆盖的那一页，本地只到 999 ⇒ 不算齐全。
    expect(plan({ head: 1000, ranges: [{ lo: 1, hi: 999 }] }))
      .toEqual({ source: "server", anchor: 0, before: 200, after: 0 });
  });

  // 红线：判成 local 是**无声的错**，用户会看到一段静默残缺的历史。
  it("head 未知（0）且列表快照也没有 latest → 一律问服务端，不许乐观判本地", () => {
    expect(plan({ head: 0, latestSeq: 0, ranges: [{ lo: 1, hi: 999999 }] }).source).toBe("server");
  });

  it("有未读 + 锚点上下都齐全 → 不打网络", () => {
    expect(plan({ readSeq: 500, latestSeq: 900, unread: 400, head: 900, ranges: [{ lo: 1, hi: 900 }] }))
      .toEqual({ source: "local" });
  });

  it("有未读 + 锚点下方那一页只到一半 → 问服务端", () => {
    expect(plan({ readSeq: 500, latestSeq: 900, unread: 400, head: 900, ranges: [{ lo: 1, hi: 600 }] }))
      .toEqual({ source: "server", anchor: 500, before: 10, after: 200 });
  });

  // 覆盖判定必须落在**同一段**里：跨两段说明中间有缺口。
  it("锚点两侧分属两个岛（中间有缺口）→ 问服务端", () => {
    const ranges: SeqRange[] = [{ lo: 1, hi: 500 }, { lo: 502, hi: 900 }];
    expect(plan({ readSeq: 500, latestSeq: 900, unread: 400, head: 900, ranges }).source).toBe("server");
  });

  it("要覆盖的区间被 head 截断时按 head 收口（会话总共就 30 条也能判本地齐全）", () => {
    expect(plan({ readSeq: 20, latestSeq: 30, unread: 10, head: 30, ranges: [{ lo: 1, hi: 30 }] }))
      .toEqual({ source: "local" });
  });

  it("下界不许穿到 0 以下（锚点很靠前时从 1 起算）", () => {
    expect(plan({ readSeq: 3, latestSeq: 30, unread: 10, head: 30, ranges: [{ lo: 1, hi: 30 }] }))
      .toEqual({ source: "local" });
  });
});

describe("moreLocalAbove —— 上滚时本地还有没有更早的", () => {
  it("当前最早一条在某段中间 → 本地展开，不打网络", () => {
    expect(moreLocalAbove([{ lo: 1, hi: 500 }], 300, { hasPrevSeq: false, hasAnyEarlier: true })).toBe(true);
  });

  it("当前最早一条正是段首 → 上面是缺口或到顶，去问服务端", () => {
    expect(moreLocalAbove([{ lo: 300, hi: 500 }], 300, { hasPrevSeq: true, hasAnyEarlier: true })).toBe(false);
  });

  // 这一条钉住 C3 的核心：seq 连号判据在这里是错的。
  // 300 与 301 之间隔着 msg_op 事件行/墓碑（占号不成消息），本地明明齐全，
  // 按 `有没有 seq-1 这条消息` 判会判成"到边界了" ⇒ 空跑一次请求 + 窗口提前切锚点模式。
  it("段内相邻两条之间隔着占号行 —— 清单说齐全就是齐全，不看 seq-1 在不在", () => {
    expect(moreLocalAbove([{ lo: 1, hi: 500 }], 301, { hasPrevSeq: false, hasAnyEarlier: true })).toBe(true);
  });

  it("清单不可用（空/未预热）→ 退回 seq 连号判定", () => {
    expect(moreLocalAbove([], 300, { hasPrevSeq: true, hasAnyEarlier: true })).toBe(true);
    expect(moreLocalAbove([], 300, { hasPrevSeq: false, hasAnyEarlier: true })).toBe(false);
  });

  it("锚点不在任何已知段里（本地发出去还没登记）→ 同样退回连号判定", () => {
    expect(moreLocalAbove([{ lo: 1, hi: 100 }], 300, { hasPrevSeq: true, hasAnyEarlier: true })).toBe(true);
  });

  it("清单说上面还有、但内存里一条更早的都没有 → 判否（不许无声卡住）", () => {
    // 清单可以合法地覆盖一段没有任何消息的号（整段都是 msg_op 事件行 / 墓碑）。
    expect(moreLocalAbove([{ lo: 1, hi: 500 }], 300, { hasPrevSeq: false, hasAnyEarlier: false })).toBe(false);
  });

  it("已经是第一条 → 没有更早的", () => {
    expect(moreLocalAbove([{ lo: 1, hi: 500 }], 1, { hasPrevSeq: true, hasAnyEarlier: true })).toBe(false);
  });
});

describe("moreLocalBelow —— 下滚时本地还有没有更新的（与上滚对称）", () => {
  it("在段中间 → 本地展开", () => {
    expect(moreLocalBelow([{ lo: 1, hi: 500 }], 300, false)).toBe(true);
  });

  it("正是段尾 → 去问服务端", () => {
    expect(moreLocalBelow([{ lo: 1, hi: 500 }], 500, true)).toBe(false);
  });

  it("段尾之下隔着占号行时同理：清单说到段尾了就是到段尾", () => {
    expect(moreLocalBelow([{ lo: 1, hi: 500 }], 499, false)).toBe(true);
  });

  it("清单不可用 → 退回连号判定", () => {
    expect(moreLocalBelow([], 300, true)).toBe(true);
  });
});
