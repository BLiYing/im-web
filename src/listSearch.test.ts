import { describe, it, expect } from "vitest";
import { normalizeQuery, matchesQuery, filterByQuery } from "./listSearch";

// 四处列表搜索（转发选择 / 邀请成员 / 建群选好友 / @面板）共用这套口径，
// 口径漂了会同时影响四个页面，故在这里一次性锁住。
describe("normalizeQuery", () => {
  it("裁两端空白并转小写；空/全空白 → 空串（= 没在搜）", () => {
    expect(normalizeQuery("  AbC ")).toBe("abc");
    expect(normalizeQuery("   ")).toBe("");
    expect(normalizeQuery(null)).toBe("");
    expect(normalizeQuery(undefined)).toBe("");
  });
});

describe("matchesQuery", () => {
  it("任一字段命中即命中，大小写不敏感", () => {
    expect(matchesQuery("li", ["Alice", "1001"])).toBe(true);
    expect(matchesQuery("1001", ["Alice", "1001"])).toBe(true);
    expect(matchesQuery("zzz", ["Alice", "1001"])).toBe(false);
  });

  it("空 query 恒命中（调用方可以不写分支）", () => {
    expect(matchesQuery("", ["Alice"])).toBe(true);
    expect(matchesQuery("  ", ["Alice"])).toBe(true);
  });

  it("nil/空字段自动跳过，不会让所有人命中", () => {
    expect(matchesQuery("a", [null, undefined, ""])).toBe(false);
    expect(matchesQuery("a", [null, "Alice"])).toBe(true);
  });

  it("中文子串直接命中（本期不做拼音首字母）", () => {
    expect(matchesQuery("老王", ["王小二", "老王", "1001"])).toBe(true);
    expect(matchesQuery("lw", ["王小二", "老王", "1001"])).toBe(false);
  });
});

describe("filterByQuery", () => {
  const items = [
    { id: "1001", name: "Alice", remark: "老王" },
    { id: "1002", name: "Bob" },
  ];
  const fields = (i: (typeof items)[number]) => [i.name, i.remark, i.id];

  it("按任一字段收窄", () => {
    expect(filterByQuery(items, "老王", fields).map((i) => i.id)).toEqual(["1001"]);
    expect(filterByQuery(items, "bo", fields).map((i) => i.id)).toEqual(["1002"]);
  });

  it("空 query 原样返回同一个数组引用（不做无谓复制）", () => {
    expect(filterByQuery(items, "  ", fields)).toBe(items);
  });
});
