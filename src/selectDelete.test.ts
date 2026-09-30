import { describe, it, expect } from "vitest";
import { planBatchDelete, runBatch } from "./selectDelete";

const m = (convSeq: number, from: string) => ({ convSeq, from });

describe("planBatchDelete — 多选删除给哪几档", () => {
  it("全是我发的：可为所有人删除", () => {
    const p = planBatchDelete([m(1, "me"), m(2, "me"), m(3, "u2")], new Set([2, 1]), "me");
    expect(p).toEqual({ seqs: [1, 2], canEveryone: true });
  });

  it("混选了别人的消息：只剩仅为我删除", () => {
    expect(planBatchDelete([m(1, "me"), m(2, "u2")], new Set([1, 2]), "me").canEveryone).toBe(false);
  });

  it("群主/管理员：别人的消息也可为所有人删除；普通成员不行", () => {
    const msgs = [m(1, "u2"), m(2, "u3")];
    expect(planBatchDelete(msgs, new Set([1, 2]), "me", "owner").canEveryone).toBe(true);
    expect(planBatchDelete(msgs, new Set([1, 2]), "me", "admin").canEveryone).toBe(true);
    expect(planBatchDelete(msgs, new Set([1, 2]), "me", "member").canEveryone).toBe(false);
  });

  it("所选消息不在内存里（窗口滑走）：查不到发送者，按不可为所有人删除算", () => {
    expect(planBatchDelete([m(1, "me")], new Set([1, 9]), "me")).toEqual({ seqs: [1, 9], canEveryone: false });
  });

  it("空选 / 只有本地未落库件：没有可删目标，也不给第二档（管理员也一样）", () => {
    expect(planBatchDelete([], new Set(), "me", "owner")).toEqual({ seqs: [], canEveryone: false });
    expect(planBatchDelete([m(0, "me")], new Set([0]), "me")).toEqual({ seqs: [], canEveryone: false });
  });
});

describe("runBatch — 逐条执行", () => {
  it("每条都跑一次；单条失败不打断其余，返回失败条数", async () => {
    const done: number[] = [];
    const failed = await runBatch([1, 2, 3, 4, 5], async (s) => {
      if (s === 2 || s === 4) throw new Error("boom");
      done.push(s);
    });
    expect(failed).toBe(2);
    expect(done.sort()).toEqual([1, 3, 5]);
  });

  it("并发不超过上限", async () => {
    let running = 0, peak = 0;
    await runBatch(Array.from({ length: 12 }, (_, i) => i + 1), async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
    }, 3);
    expect(peak).toBe(3);
  });

  it("空列表：不跑、0 失败", async () => {
    expect(await runBatch([], async () => { throw new Error("never"); })).toBe(0);
  });
});
