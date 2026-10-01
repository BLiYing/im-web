import { describe, it, expect } from "vitest";
import { batchDeleteTargetsOf, hiddenSeqsOf, planBatchDelete, summarizeBatch } from "./selectDelete";

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

describe("summarizeBatch — 服务端逐条结果对回请求", () => {
  it("成功的留作本地移除，失败/缺项都计入失败条数", () => {
    const r = summarizeBatch([1, 2, 3, 4], [
      { conv_seq: 1, ok: true }, { conv_seq: 2, ok: false, code: 300006 }, { conv_seq: 4, ok: true },
    ]);
    expect(r).toEqual({ okSeqs: [1, 4], failed: 2 });
  });

  it("响应里没有 results（异常形状）：整批按失败算", () => {
    expect(summarizeBatch([1, 2], undefined)).toEqual({ okSeqs: [], failed: 2 });
  });
});

describe("hiddenSeqsOf — msg_hidden 帧", () => {
  it("批量帧读 conv_seqs，单条帧退回 conv_seq", () => {
    expect(hiddenSeqsOf({ conv_seq: 3, conv_seqs: [3, 5, 9] })).toEqual([3, 5, 9]);
    expect(hiddenSeqsOf({ conv_seq: 7 })).toEqual([7]);
    expect(hiddenSeqsOf({})).toEqual([]);
  });
});

describe("batchDeleteTargetsOf — 批量删除广播帧", () => {
  it("一帧带全批：取出要删的消息与各自事件行的 op_conv_seq", () => {
    const d = { op: "delete", conv_id: "g", targets: [{ target_conv_seq: 3, op_conv_seq: 10 }, { target_conv_seq: 5, op_conv_seq: 11 }] };
    expect(batchDeleteTargetsOf(d)).toEqual({ seqs: [3, 5], opSeqs: [10, 11] });
  });

  it("单条 msg_op（没有 targets）/ 非删除：返回 null，走单条路径", () => {
    expect(batchDeleteTargetsOf({ op: "delete", target_conv_seq: 3 })).toBeNull();
    expect(batchDeleteTargetsOf({ op: "pin", targets: [] })).toBeNull();
  });
});
