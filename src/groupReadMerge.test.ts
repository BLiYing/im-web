import { describe, it, expect } from "vitest";
import { keepHigherGroupRead } from "./groupReadMerge";
import type { Conversation } from "./sdk/protocol";

const row = (conv_id: string, group_read_seq?: number) => ({ conv_id, group_read_seq } as Conversation);

describe("keepHigherGroupRead：列表整表刷新时群全员已读位点取大", () => {
  it("迟到的旧快照不能把 group_read 推来的更大值退回去", () => {
    const out = keepHigherGroupRead([row("g_a", 10)], [row("g_a", 8)]);
    expect(out[0].group_read_seq).toBe(10);
  });
  it("快照更新时用快照值；新冒出的会话原样保留", () => {
    const out = keepHigherGroupRead([row("g_a", 10)], [row("g_a", 12), row("g_b", 3)]);
    expect(out.map((c) => c.group_read_seq)).toEqual([12, 3]);
  });
  it("本地没有任何群位点时直接返回快照（不复制）", () => {
    const next = [row("u_x"), row("g_a", 5)];
    expect(keepHigherGroupRead([row("u_x")], next)).toBe(next);
  });
});
