import { describe, it, expect } from "vitest";
import { contiguousSegments, visibleSlice } from "./renderWindow";

const mk = (...seqs: number[]) => seqs.map((convSeq) => ({ convSeq }));
const seqs = (ms: { convSeq: number }[]) => ms.map((m) => m.convSeq);
/** 生成 [from, to] 的连续消息。 */
const run = (from: number, to: number) => mk(...Array.from({ length: to - from + 1 }, (_, i) => from + i));

describe("连续段划分", () => {
  it("全连续就是一段", () => {
    expect(contiguousSegments(mk(1, 2, 3))).toHaveLength(1);
  });

  it("按缺口切开", () => {
    const segs = contiguousSegments(mk(1, 2, 100, 101, 102));
    expect(segs.map(seqs)).toEqual([[1, 2], [100, 101, 102]]);
  });

  it("待发消息（conv_seq=0）不切断尾段——否则刚发的消息会从窗口里消失", () => {
    const segs = contiguousSegments(mk(10, 11, 0, 0));
    expect(segs.map(seqs)).toEqual([[10, 11, 0, 0]]);
  });
});

describe("渲染切片", () => {
  it("贴最新：取尾段最后 size 条", () => {
    expect(seqs(visibleSlice(run(1, 500), null, 200))).toEqual(seqs(run(301, 500)));
  });

  it("本地不足一窗就全给", () => {
    expect(seqs(visibleSlice(run(1, 50), null, 200))).toEqual(seqs(run(1, 50)));
  });

  describe("有缺口时（2026-09-03 实测现场）", () => {
    // 客户端游标停在 1，尾巴上是最新一页；中间三万条从未下载。
    const gapped = [...mk(1), ...run(29802, 30001)];

    it("贴最新时**绝不**把缺口另一侧的旧岛拼进来", () => {
      const got = seqs(visibleSlice(gapped, null, 200));
      expect(got).toEqual(seqs(run(29802, 30001)));
      expect(got).not.toContain(1); // 拼进来就是「#1 上面紧接着 #29802」那种静默错乱
    });

    it("取回更早一页后，以原顶部为锚点开窗 → 窗口真的往前移了", () => {
      // 上滑时把 anchor 定在当时的顶部 29802，然后服务端补回 29602..29801。
      const after = [...mk(1), ...run(29602, 30001)];
      const got = seqs(visibleSlice(after, 29802, 200));
      // 关键断言：最小 seq 必须**变小**——它不变的话屏幕纹丝不动，
      // 而加载标志位正是靠"最小 seq 下降"复位的，不降就永远卡在"加载中"。
      expect(Math.min(...got)).toBeLessThan(29802);
      expect(got).toContain(29802); // 用户原来看的那条仍在窗口里，不会被甩走
      expect(got).toHaveLength(200); // DOM 仍有上限
      expect(got).not.toContain(1);  // 依然不跨缺口
    });

    it("锚点落在旧岛上时，窗口只给旧岛那一段", () => {
      expect(seqs(visibleSlice(gapped, 1, 200))).toEqual([1]);
    });

    it("锚点已不在本地（被删）→ 回退贴最新，而不是给空", () => {
      expect(seqs(visibleSlice(gapped, 12345, 200))).toEqual(seqs(run(29802, 30001)));
    });
  });

  // 2026-09-03 用户实测现场：18 条消息的「20000人大群」，seq 14 是被「为所有人删除」的图片，
  // seq 16/17/18 是三条 msg_op 事件行（两次置顶 + 一次删除），seq 15 是系统消息。
  // 本地实际存下来的是 1..13 和 15——只看 seq 连号，尾段被切成 [15] 一条，界面看着就是空会话。
  describe("占了 conv_seq 但不成为消息的行（msg_op / 已删墓碑 / 对我不可见）", () => {
    const local = [...run(1, 13), ...mk(15)]; // 14 被删；16~18 是 msg_op，本就不入库

    it("区间清单说 [1,18] 都下载过 → 不切段，尾段是全部 14 条", () => {
      const segs = contiguousSegments(local, [{ lo: 1, hi: 18 }]);
      expect(segs.length).toBe(1);
      expect(segs[0].length).toBe(14);
    });

    it("贴最新时整段都在窗口里，而不是只剩最后那条系统消息", () => {
      const win = visibleSlice(local, null, 200, [{ lo: 1, hi: 18 }]);
      expect(win.length).toBe(14);
      expect(win[0].convSeq).toBe(1);
    });

    it("没有区间清单可依时保守切开——宁可多切一刀，也不能把缺口两侧静默拼起来", () => {
      expect(contiguousSegments(local).length).toBe(2);
    });

    it("真缺口（跨区间）照旧切开：老岛 [1,1] 与尾页 [29802,30001] 分属两段", () => {
      const gapped = [...mk(1), ...run(29802, 29805)];
      const ranges = [{ lo: 1, hi: 1 }, { lo: 29802, hi: 30001 }];
      const segs = contiguousSegments(gapped, ranges);
      expect(segs.length).toBe(2);
      expect(segs[1][0].convSeq).toBe(29802);
    });
  });

  it("锚点在段首/段尾时窗口不越界", () => {
    const all = run(1, 500);
    expect(visibleSlice(all, 1, 200)).toHaveLength(200);
    expect(seqs(visibleSlice(all, 1, 200))[0]).toBe(1);
    expect(visibleSlice(all, 500, 200)).toHaveLength(200);
    expect(seqs(visibleSlice(all, 500, 200)).at(-1)).toBe(500);
  });
});
