import { describe, it, expect, vi } from "vitest";
import { alignClearedFromList } from "./clearAlign";

describe("alignClearedFromList —— 列表 cleared_at 触发清除（§6.7.1 触发点③）", () => {
  it("超过本机位点的跑例程（带 cleared_at）；内存没载入但存储已对齐的跳过；一项失败不挡后面", async () => {
    const run = vi.fn(async (c: string) => { if (c === "boom") throw new Error("x"); });
    await alignClearedFromList(
      [{ conv_id: "boom", cleared_at: 9 }, { conv_id: "new", cleared_at: 40 }, { conv_id: "stored", cleared_at: 30 }, { conv_id: "plain" }],
      () => 0, async (c) => (c === "stored" ? 30 : 0), run,
    );
    expect(run.mock.calls).toEqual([["boom", 9], ["new", 40]]);
  });
});
