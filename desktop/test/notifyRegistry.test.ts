// 已弹通知的登记表：撤回 / 别处已读 / 窗口回到前台时收哪几条。
// 收错的代价是「撤回了一条，另一条还没读的也没了」或「畸形请求把全部通知清空」，都是不测就会出的错。
import { describe, expect, it } from "vitest";
import { createNotifyRegistry, parseNotifyScope, type Closable } from "../src/main/notifyRegistry";

function fake(): Closable & { closed: number } {
  const n = { closed: 0, close() { n.closed += 1; } };
  return n;
}

function seeded() {
  const reg = createNotifyRegistry();
  const a1 = fake(), a2 = fake(), a3 = fake(), b1 = fake();
  reg.add("a", 1, a1);
  reg.add("a", 2, a2);
  reg.add("a", 3, a3);
  reg.add("b", 1, b1);
  return { reg, a1, a2, a3, b1 };
}

describe("createNotifyRegistry.clear", () => {
  it("撤回/删除：只收 convSeqs 里那几条，同会话别的、别的会话同 seq 的都留着", () => {
    const { reg, a1, a2, a3, b1 } = seeded();
    expect(reg.clear({ convId: "a", convSeqs: [2] })).toBe(1);
    expect([a1.closed, a2.closed, a3.closed, b1.closed]).toEqual([0, 1, 0, 0]);
    expect(reg.size()).toBe(3);
  });

  it("别处已读：收 ≤ upTo 的，读位点之后新来的留着", () => {
    const { reg, a1, a2, a3, b1 } = seeded();
    expect(reg.clear({ convId: "a", upTo: 2 })).toBe(2);
    expect([a1.closed, a2.closed, a3.closed, b1.closed]).toEqual([1, 1, 0, 0]);
  });

  it("不带 convId = 全部（窗口回到前台）", () => {
    const { reg, a1, a2, a3, b1 } = seeded();
    expect(reg.clear({})).toBe(4);
    expect([a1.closed, a2.closed, a3.closed, b1.closed]).toEqual([1, 1, 1, 1]);
    expect(reg.size()).toBe(0);
  });

  it("收过的不会再收第二次；用户自己划掉的（forget）不再 close", () => {
    const { reg, a1, a2 } = seeded();
    reg.forget(a2);
    reg.clear({ convId: "a", upTo: 2 });
    reg.clear({ convId: "a", upTo: 2 });
    expect([a1.closed, a2.closed]).toEqual([1, 0]);
  });

  it("超出上限只放手最旧的（不 close），登记数不再涨", () => {
    const reg = createNotifyRegistry(2);
    const n1 = fake(), n2 = fake(), n3 = fake();
    reg.add("a", 1, n1); reg.add("a", 2, n2); reg.add("a", 3, n3);
    expect(reg.size()).toBe(2);
    expect(reg.clear({ convId: "a" })).toBe(2);
    expect([n1.closed, n2.closed, n3.closed]).toEqual([0, 1, 1]);
  });
});

describe("parseNotifyScope（IPC 入参是 unknown）", () => {
  it("正常形状原样收", () => {
    expect(parseNotifyScope({ convId: "a", convSeqs: [1, 2] })).toEqual({ convId: "a", convSeqs: [1, 2] });
    expect(parseNotifyScope({ convId: "a", upTo: 5 })).toEqual({ convId: "a", upTo: 5 });
    expect(parseNotifyScope({ convId: "a" })).toEqual({ convId: "a" });
  });

  it("认不准就返回 null，绝不退化成「全部」", () => {
    expect(parseNotifyScope(null)).toBeNull();
    expect(parseNotifyScope({})).toBeNull();
    expect(parseNotifyScope({ convId: "" })).toBeNull();
    expect(parseNotifyScope({ convId: 1 })).toBeNull();
    expect(parseNotifyScope({ convId: "a", convSeqs: [] })).toBeNull();
    expect(parseNotifyScope({ convId: "a", convSeqs: ["1", 0] })).toBeNull();
    expect(parseNotifyScope({ convId: "a", upTo: 0 })).toBeNull();
  });
});
