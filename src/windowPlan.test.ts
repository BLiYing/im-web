import { describe, it, expect } from "vitest";
import { entryWindowAnchor, planEntryWindow, moreLocalAbove, floorFromWindow, nextHistoryFloor } from "./windowPlan";
import type { SeqRange } from "./sdk/ranges";

const base = { contextBefore: 10, historyPage: 200 };
const plan = (o: Partial<Parameters<typeof planEntryWindow>[0]>) =>
  planEntryWindow({ ...base, readSeq: 0, latestSeq: 0, unread: 0, ranges: [], head: 0, localNewest: 1e9, ...o });

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
  // anchor=0 在 window_req 里是「取最新」的哨兵（与 sync_req 的 since=0＝「从头」相反），
  // 所以这一档必须落在 1 上：否则新成员拿回最新 10 条，可见即读把 read_seq 推到头。
  it("一条都没读过（readSeq=0）但有未读 —— 是有未读，锚点收到 1，绝不能是「取最新」的 0", () => {
    const a = entryWindowAnchor({ ...base, readSeq: 0, latestSeq: 110019, unread: 10000 });
    expect(a).toEqual({ anchor: 1, before: 10, after: 200 });
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

  // /code-review 2026-09-09 抓出的 P0：「清空聊天记录」当时只删消息、不删清单，
  // 于是刷新后清单仍说齐全 → 判 local → 一个请求都不发 → 会话恒空且上滑/点↓ 都不自愈。
  // 存储侧已改成同事务一起清，但**老库里已经孤立的清单追不回来**，这道闸得长期留着。
  it("清单说齐全、但本地一条消息都没有（清空过）→ 仍旧问服务端", () => {
    expect(plan({ head: 1000, ranges: [{ lo: 1, hi: 1000 }], localNewest: 0 }).source).toBe("server");
  });

  it("本地最新一条还落在要覆盖的那一页之下 → 也算没有，问服务端", () => {
    expect(plan({ head: 1000, ranges: [{ lo: 1, hi: 1000 }], localNewest: 700 }).source).toBe("server");
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
    expect(moreLocalAbove([{ lo: 1, hi: 500 }], 300, 299)).toBe(true);
  });

  it("当前最早一条正是段首 → 上面是缺口或到顶，去问服务端", () => {
    expect(moreLocalAbove([{ lo: 300, hi: 500 }], 300, 299)).toBe(false);
  });

  // 这一条钉住 C3 的核心：seq 连号判据在这里是错的。
  // 300 与 301 之间隔着 msg_op 事件行/墓碑（占号不成消息），本地明明齐全，
  // 按 `有没有 seq-1 这条消息` 判会判成"到边界了" ⇒ 空跑一次请求 + 窗口提前切锚点模式。
  it("段内相邻两条之间隔着占号行 —— 清单说齐全就是齐全，不看 seq-1 在不在", () => {
    expect(moreLocalAbove([{ lo: 1, hi: 500 }], 301, 299)).toBe(true);
  });

  // /code-review 2026-09-09：第一版这道闸只问「本地任意位置还有没有更早的」，
  // 于是缺口另一侧旧岛里的那一条会让它判真 —— 展开分支展不出东西、滑窗分支锚点原地不动。
  it("更早的那一条在**缺口另一侧的旧岛**里（不在上沿这一段内）→ 判否，去问服务端", () => {
    const ranges: SeqRange[] = [{ lo: 1, hi: 100 }, { lo: 300, hi: 500 }];
    expect(moreLocalAbove(ranges, 300, /* 旧岛里的 */ 100)).toBe(false);
  });

  it("清单不可用（空/未预热）→ 退回 seq 连号判定", () => {
    expect(moreLocalAbove([], 300, 299)).toBe(true);
    expect(moreLocalAbove([], 300, 250)).toBe(false);
  });

  it("锚点不在任何已知段里（本地发出去还没登记）→ 同样退回连号判定", () => {
    expect(moreLocalAbove([{ lo: 1, hi: 100 }], 300, 299)).toBe(true);
  });

  it("清单说上面还有、但内存里一条更早的都没有 → 判否（不许无声卡住）", () => {
    // 清单可以合法地覆盖一段没有任何消息的号（整段都是 msg_op 事件行 / 墓碑）。
    expect(moreLocalAbove([{ lo: 1, hi: 500 }], 300, 0)).toBe(false);
  });

  it("已经是第一条 → 没有更早的", () => {
    expect(moreLocalAbove([{ lo: 1, hi: 500 }], 1, 0)).toBe(false);
  });
});

describe("nextHistoryFloor —— 下界怎么合并（对端 iOS IMChatMergeHistoryFloor）", () => {
  it("只往小里收：后来报上来的更大值不理它", () => {
    expect(nextHistoryFloor(500, [200, 300], 0)).toBe(200);
    expect(nextHistoryFloor(200, [500, 600], 0)).toBe(200);
  });

  it("原先未知 → 取新值；新值算不出来 → 保持原样", () => {
    expect(nextHistoryFloor(undefined, [500], 0)).toBe(500);
    expect(nextHistoryFloor(0, [500], 0)).toBe(500);
    expect(nextHistoryFloor(500, [], 0)).toBe(500);   // 空窗且 anchor=0：算不出，别把已知的下界丢了
    expect(nextHistoryFloor(undefined, [], 0)).toBe(0);
  });

  it("整窗都是占号行 → 退回 anchor（那同样断言了 anchor 之下没有）", () => {
    expect(nextHistoryFloor(undefined, [], 620)).toBe(620);
  });
});

describe("floorFromWindow —— has_before=false 时把可见下界记在哪一条", () => {
  it("取本窗最小 seq（不是 anchor）", () => {
    expect(floorFromWindow([49999, 50003, 50001], 50200)).toBe(49999);
  });

  // 2026-09-10 /code-review（两端同一个洞）：喂进来的必须是**客户端留下来的那批行**，
  // 不是整窗 d.messages。窗里的 msg_op 事件行与「为所有人删除」的墓碑占号却被 processIncoming
  // 丢掉；拿它们当下界，闸就钉在一条永远渲染不出来的号上，而 oldestRendered 只数真实消息
  // → atHistoryFloor 恒假 → 每次滑到顶都再空问一次，永不收敛。
  it("下界必须落在渲染得出来的号上：墓碑 seq=1 被丢掉时，下界是 2 而不是 1", () => {
    const kept = [2, 3, 4];              // seq=1 是墓碑，processIncoming 不产出
    expect(floorFromWindow(kept, 0)).toBe(2);
  });

  it("整窗都是占号行（一条消息都没带回）→ 退回 anchor", () => {
    expect(floorFromWindow([], 50200)).toBe(50200);
  });

  it("anchor=0（取最新）且空窗 → 0，即「仍然未知」，不许当成到顶", () => {
    expect(floorFromWindow([], 0)).toBe(0);
  });
});
