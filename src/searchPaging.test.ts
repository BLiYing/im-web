import { describe, expect, it } from "vitest";
import { prependOlderHits, type SearchHit } from "./searchPaging";

const h = (seq: number): SearchHit => ({ convSeq: seq, timestamp: seq * 1000 });
const seqs = (hits: SearchHit[]) => hits.map((x) => x.convSeq);

describe("prependOlderHits", () => {
  it("服务端倒序的更旧一页 → 升序拼到前面，added 是新增条数", () => {
    const { hits, added } = prependOlderHits([h(200), h(250), h(300)], [h(150), h(100)]);
    expect(seqs(hits)).toEqual([100, 150, 200, 250, 300]);
    expect(added).toBe(2);
    // 调用方把下标落到 added-1：正是紧挨着原最旧(200)的上一条
    expect(hits[added - 1].convSeq).toBe(150);
  });

  it("重复页 / 游标回退带回的已有命中不再塞一遍（否则计数虚涨、下标错位）", () => {
    const { hits, added } = prependOlderHits([h(200), h(250)], [h(250), h(200), h(180)]);
    expect(seqs(hits)).toEqual([180, 200, 250]);
    expect(added).toBe(1);
  });

  it("页内自己重复的只算一条", () => {
    const { hits, added } = prependOlderHits([h(200)], [h(150), h(150)]);
    expect(seqs(hits)).toEqual([150, 200]);
    expect(added).toBe(1);
  });

  it("空页 → 原样返回、added=0", () => {
    const cur = [h(200)];
    const { hits, added } = prependOlderHits(cur, []);
    expect(seqs(hits)).toEqual([200]);
    expect(added).toBe(0);
  });

  it("当前命中集为空时整页都收", () => {
    const { hits, added } = prependOlderHits([], [h(30), h(10), h(20)]);
    expect(seqs(hits)).toEqual([10, 20, 30]);
    expect(added).toBe(3);
  });
});
