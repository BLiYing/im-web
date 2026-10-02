import { describe, it, expect } from "vitest";
import { unreadBelowCount } from "./unreadBelow";

describe("↓N 取数判据", () => {
  it("本地齐全时数已渲染的", () => {
    expect(unreadBelowCount({ hasGap: false, head: 500, pendingRead: 300, loadedBelow: 42, localNewest: 500, coveredBelowFrontier: false, floor: 0 })).toBe(42);
  });

  it("有缺口时不数本地——这正是 2026-09-02 实测撞到的那个 ↓195", () => {
    // 现场：单聊积压 1 万条，窗口只加载 200 条，DOM 里数出来 195。
    // 195 看着就是个正常数字，不报错、不空白，只是它本该是 10000。
    const loadedBelow = 195;
    expect(unreadBelowCount({ hasGap: true, head: 20001, pendingRead: 10001, loadedBelow, localNewest: 10200, coveredBelowFrontier: false, floor: 0 })).toBe(10000);
    // 退化成数 DOM 就会红：
    expect(unreadBelowCount({ hasGap: true, head: 20001, pendingRead: 10001, loadedBelow, localNewest: 10200, coveredBelowFrontier: false, floor: 0 })).not.toBe(loadedBelow);
  });

  it("head 超过本地最新一条 → 即便 hasGap 尚未置位也不数本地", () => {
    // iOS 同款判据的实测现场（2026-09-03）：窗口贴着**本地**最新一条（看上去 at_tail），
    // 但服务端还领先一万条，数出来是 185——正好是窗口里读位点之后的条数，像个正常数字。
    // hasGap 是连接级内存标志，刷新/重连后会短暂为空，故必须有这条不依赖它的证据。
    expect(unreadBelowCount({ hasGap: false, head: 110019, pendingRead: 100019, loadedBelow: 185, localNewest: 100219, coveredBelowFrontier: false, floor: 0 }))
      .toBe(10000);
  });

  it("本地已追平 head → 数本地（localNewest 不该把正常会话误判成有缺口）", () => {
    expect(unreadBelowCount({ hasGap: false, head: 500, pendingRead: 300, loadedBelow: 42, localNewest: 500, coveredBelowFrontier: false, floor: 0 })).toBe(42);
  });

  it("已滚到最新则为 0，不出负数", () => {
    expect(unreadBelowCount({ hasGap: true, head: 20001, pendingRead: 20001, loadedBelow: 0, localNewest: 20001, coveredBelowFrontier: false, floor: 0 })).toBe(0);
    expect(unreadBelowCount({ hasGap: true, head: 20001, pendingRead: 99999, loadedBelow: 0, localNewest: 20001, coveredBelowFrontier: false, floor: 0 })).toBe(0);
  });

  it("head 未知（老服务端/尚未收到）时退回数本地，不编造数字", () => {
    expect(unreadBelowCount({ hasGap: true, head: 0, pendingRead: 10, loadedBelow: 7, localNewest: 10, coveredBelowFrontier: false, floor: 0 })).toBe(7);
  });

  it("随向下滚动递减", () => {
    const at = (pendingRead: number) =>
      unreadBelowCount({ hasGap: true, head: 20001, pendingRead, loadedBelow: 195, localNewest: 10200, coveredBelowFrontier: false, floor: 0 });
    expect(at(10001)).toBe(10000);
    expect(at(15001)).toBe(5000);
    expect(at(20000)).toBe(1);
  });
});

// 2026-09-05 实测（libeyond 在「20000人大群」，Web 同现场复现）：滚到底再往上滑，↓ 按钮恒显 1。
// 会话最后一条是 `op=pin` 的 msg_op **事件行**（head=110031），最后一条真消息是 110030。
// 旧判据拿 seq 连不连号猜"下面还有没下载的"，把那个事件行数成了一条不存在的未读。
describe("↓N：占了 conv_seq 却不是消息的行不该被数成未读", () => {
  it("区间覆盖住 (pendingRead, head] → 数本地（0），哪怕 head 比最后一条消息大", () => {
    expect(unreadBelowCount({
      hasGap: false, head: 110031, pendingRead: 110030, loadedBelow: 0,
      localNewest: 110030,          // 最后一条**消息**
      coveredBelowFrontier: true,   // 区间清单覆盖到 110031（含那个事件行）
      floor: 0,
    })).toBe(0);
  });

  // 这条最要紧：hasGap 是**连接级**标志，大群几乎必然置位（收过 too_long），
  // 只要它压过覆盖判据，上面那条修复就等于没做——现场正是这么复现的。
  it("hasGap 置位但区间已覆盖住下方 → 仍数本地（缺口在已滚入位点之上，与「下面还有多少」无关）", () => {
    expect(unreadBelowCount({
      hasGap: true, head: 110031, pendingRead: 110030, loadedBelow: 0,
      localNewest: 110030, coveredBelowFrontier: true, floor: 0,
    })).toBe(0);
  });

  it("真有没下载的消息（区间盖不住下方）→ 仍按 head−pendingRead 报", () => {
    expect(unreadBelowCount({
      hasGap: false, head: 110031, pendingRead: 100031, loadedBelow: 185,
      localNewest: 100231, coveredBelowFrontier: false, floor: 0,
    })).toBe(10000);
  });

  it("head 未知（0）时覆盖判据不生效，仍退回数本地", () => {
    expect(unreadBelowCount({
      hasGap: true, head: 0, pendingRead: 300, loadedBelow: 42, localNewest: 500, coveredBelowFrontier: true, floor: 0,
    })).toBe(42);
  });
});

// §6.7：清空聊天记录之后，读位点还停在被清掉的那一段里。位点以内的号对本端不存在——
// 不下界化的话，`head − pendingRead` 把用户刚清掉的几千条数成「↓ 未读」，而且怎么滚都消不掉。
describe("↓N：有效可见下界（清空位点 / 服务端下界）以内的号不算", () => {
  it("可见范围内一条都没有（head <= floor）→ 0，哪怕读位点远低于 head", () => {
    expect(unreadBelowCount({
      hasGap: true, head: 5000, pendingRead: 100, loadedBelow: 0, localNewest: 0, coveredBelowFrontier: false, floor: 5000,
    })).toBe(0);
  });

  it("读位点落在下界以内：从下界数起，不把被清掉的那一段算成未读", () => {
    expect(unreadBelowCount({
      hasGap: true, head: 5010, pendingRead: 100, loadedBelow: 3, localNewest: 5003, coveredBelowFrontier: false, floor: 5000,
    })).toBe(10);                    // 不是 5010 - 100
  });

  it("下界不高于读位点时行为与没有下界完全一样", () => {
    expect(unreadBelowCount({
      hasGap: true, head: 20001, pendingRead: 10001, loadedBelow: 195, localNewest: 10200, coveredBelowFrontier: false, floor: 50,
    })).toBe(10000);
  });
});
