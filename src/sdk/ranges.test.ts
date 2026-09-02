import { describe, it, expect } from "vitest";
import {
  normalizeRanges, addRange, hasSeq, coversSpan, isComplete,
  contiguousUpTo, gapBefore, gapAfter, rangeContaining,
} from "./ranges";

describe("区间清单（本地有哪几段）", () => {
  it("归一化：排序 + 合并重叠", () => {
    expect(normalizeRanges([{ lo: 10, hi: 20 }, { lo: 1, hi: 5 }, { lo: 15, hi: 30 }]))
      .toEqual([{ lo: 1, hi: 5 }, { lo: 10, hi: 30 }]);
  });

  it("相邻区间必须合并——否则拉全了也永远判成有缺口", () => {
    // conv_seq 是连续整数，[1,10] 与 [11,20] 之间没有空隙。
    expect(normalizeRanges([{ lo: 1, hi: 10 }, { lo: 11, hi: 20 }])).toEqual([{ lo: 1, hi: 20 }]);
    expect(isComplete(normalizeRanges([{ lo: 1, hi: 10 }, { lo: 11, hi: 20 }]), 20)).toBe(true);
  });

  it("丢弃非法区间（hi<lo、0、非数）而不是抛错", () => {
    expect(normalizeRanges([{ lo: 5, hi: 1 }, { lo: 0, hi: 0 }, { lo: NaN, hi: 3 }, { lo: 2, hi: 4 }]))
      .toEqual([{ lo: 2, hi: 4 }]);
  });

  it("addRange 不修改入参", () => {
    const before = [{ lo: 1, hi: 5 }];
    const after = addRange(before, 6, 9);
    expect(before).toEqual([{ lo: 1, hi: 5 }]);
    expect(after).toEqual([{ lo: 1, hi: 9 }]);
  });

  it("hasSeq / rangeContaining", () => {
    const rs = [{ lo: 1, hi: 5 }, { lo: 100, hi: 200 }];
    expect(hasSeq(rs, 3)).toBe(true);
    expect(hasSeq(rs, 50)).toBe(false);
    expect(rangeContaining(rs, 150)).toEqual({ lo: 100, hi: 200 });
    expect(rangeContaining(rs, 50)).toBeNull();
  });

  it("coversSpan 要求同一段完整覆盖，跨段不算", () => {
    const rs = [{ lo: 1, hi: 5 }, { lo: 10, hi: 20 }];
    expect(coversSpan(rs, 2, 4)).toBe(true);
    expect(coversSpan(rs, 4, 12)).toBe(false); // 中间 6..9 是缺口
  });

  describe("isComplete", () => {
    it("有缺口即不齐全", () => {
      expect(isComplete([{ lo: 1, hi: 5 }, { lo: 100, hi: 200 }], 200)).toBe(false);
    });
    it("单段覆盖到 head 即齐全", () => {
      expect(isComplete([{ lo: 1, hi: 200 }], 200)).toBe(true);
    });
    it("尾巴差一条就不算齐全", () => {
      expect(isComplete([{ lo: 1, hi: 199 }], 200)).toBe(false);
    });
    it("history_visible 抬高的下界之下不算缺口", () => {
      // 新成员看不到入群前的消息，那一段本来就永远拿不到，不能算"有缺口"，
      // 否则会话内搜索会被永久判成"必须走服务端"。
      expect(isComplete([{ lo: 101, hi: 200 }], 200, 100)).toBe(true);
      expect(isComplete([{ lo: 102, hi: 200 }], 200, 100)).toBe(false);
    });
    it("会话在我可见范围内一条都没有 → 齐全", () => {
      expect(isComplete([], 0)).toBe(true);
      expect(isComplete([], 100, 100)).toBe(true);
    });
  });

  it("contiguousUpTo 就是 synced_conv_seq 的等价物", () => {
    expect(contiguousUpTo([{ lo: 1, hi: 50 }, { lo: 100, hi: 200 }])).toBe(50);
    expect(contiguousUpTo([{ lo: 100, hi: 200 }])).toBe(0); // 头上就断了 → 一条都不连续
    expect(contiguousUpTo([{ lo: 101, hi: 200 }], 100)).toBe(200); // 下界抬到 100 后是连续的
  });

  describe("翻页取段", () => {
    it("gapBefore：从当前段的 lo 往前取一页", () => {
      expect(gapBefore([{ lo: 100, hi: 200 }], 150, 20)).toEqual({ lo: 80, hi: 99 });
    });
    it("gapBefore：锚点不在任何段里时以锚点本身为上界", () => {
      expect(gapBefore([], 50, 20)).toEqual({ lo: 31, hi: 50 });
    });
    it("gapBefore：到 floor 就停，不越过可见下界", () => {
      expect(gapBefore([{ lo: 100, hi: 200 }], 150, 500, 0)).toEqual({ lo: 1, hi: 99 });
      expect(gapBefore([{ lo: 1, hi: 200 }], 150, 20)).toBeNull();
      expect(gapBefore([{ lo: 101, hi: 200 }], 150, 20, 100)).toBeNull();
    });
    it("gapAfter：对称，且不越过 head", () => {
      expect(gapAfter([{ lo: 1, hi: 100 }], 50, 20, 500)).toEqual({ lo: 101, hi: 120 });
      expect(gapAfter([{ lo: 1, hi: 100 }], 50, 20, 110)).toEqual({ lo: 101, hi: 110 });
      expect(gapAfter([{ lo: 1, hi: 100 }], 50, 20, 100)).toBeNull();
    });
  });

  it("反复登记同一段是幂等的（重拉不该把清单撑大）", () => {
    let rs = addRange([], 1, 100);
    for (let i = 0; i < 5; i++) rs = addRange(rs, 1, 100);
    expect(rs).toEqual([{ lo: 1, hi: 100 }]);
  });

  it("缺口只会收窄：两段之间补上中段即合并成一段", () => {
    let rs = normalizeRanges([{ lo: 1, hi: 50 }, { lo: 151, hi: 200 }]);
    expect(isComplete(rs, 200)).toBe(false);
    rs = addRange(rs, 51, 150);
    expect(rs).toEqual([{ lo: 1, hi: 200 }]);
    expect(isComplete(rs, 200)).toBe(true);
  });
});
