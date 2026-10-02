import { describe, it, expect } from "vitest";
import { atVisibleFloor, backfillClearedUpTo, dropCleared, effectiveFloor, floorAtClear, seqFromRecordKey } from "./clearFloor";

describe("floorAtClear —— 清空那一刻的位点取最大的已知最新", () => {
  it("四个来源取大；NaN/负数当 0；全空是 0", () => {
    expect(floorAtClear(10, 30, 20, 5)).toBe(30);
    expect(floorAtClear(Number.NaN, 7)).toBe(7);
    expect(floorAtClear()).toBe(0);
    expect(floorAtClear(-3)).toBe(0);
  });
});

describe("dropCleared", () => {
  const list = [{ convSeq: 0 }, { convSeq: 5 }, { convSeq: 10 }, { convSeq: 11 }];
  it("丢掉 <= 位点的，位点之后与 convSeq<=0（被拒/发送中）的保留", () => {
    expect(dropCleared(list, 10).map((m) => m.convSeq)).toEqual([0, 11]);
  });
  it("位点 0 原样返回同一个数组", () => { expect(dropCleared(list, 0)).toBe(list); });
});

describe("effectiveFloor / atVisibleFloor —— 服务端下界与清空位点各存各的，用时取大", () => {
  it("开区间口径：服务端 floorSeq 是最小真消息（含），折成 floorSeq-1；位点本来就是「<= 它都没了」", () => {
    expect(effectiveFloor(500, 0)).toBe(499);
    expect(effectiveFloor(0, 0)).toBe(0);
    expect(effectiveFloor(undefined, undefined)).toBe(0);
    expect(effectiveFloor(500, 800)).toBe(800);   // 位点更大取位点
    expect(effectiveFloor(900, 800)).toBe(899);   // 服务端下界更大取它
  });

  it("上滚闸：最早渲染那条踩在服务端下界 / 位点的下一条上都算到顶；下界之上放行；都未知恒 false", () => {
    expect(atVisibleFloor(500, 500, 0)).toBe(true);
    expect(atVisibleFloor(501, 500, 0)).toBe(false);
    expect(atVisibleFloor(801, 0, 800)).toBe(true);    // 位点 800 ⇒ 801 是最早可见的一条
    expect(atVisibleFloor(802, 0, 800)).toBe(false);
    expect(atVisibleFloor(3, 0, 0)).toBe(false);       // 未知下界不许当到顶
    expect(atVisibleFloor(3, undefined, undefined)).toBe(false);
  });
});

describe("backfillClearedUpTo —— 老库回填（升级前清空过的会话没有任何痕迹）", () => {
  it("游标以内有本地消息：位点 = 最小本地 seq - 1", () => { expect(backfillClearedUpTo(100, 41)).toBe(40); });
  it("游标以内本地一条没有：位点 = 游标", () => { expect(backfillClearedUpTo(100, 0)).toBe(100); });
  it("最早一条就是 1（没清过）：位点 0", () => { expect(backfillClearedUpTo(100, 1)).toBe(0); });
  it("游标 <= 0 的会话不回填", () => { expect(backfillClearedUpTo(0, 0)).toBe(0); expect(backfillClearedUpTo(-1, 5)).toBe(0); });
});

describe("seqFromRecordKey", () => {
  it("从记录键里解出 conv_seq；被拒消息 / 非法键是 0", () => {
    expect(seqFromRecordKey("o|c1|42")).toBe(42);
    expect(seqFromRecordKey("o|c1|c:cm-1")).toBe(0);
    expect(seqFromRecordKey("o|c1|abc")).toBe(0);
  });
});
